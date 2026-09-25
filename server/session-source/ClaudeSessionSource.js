// Adapter for Claude Code's on-disk transcript layout (observed in Claude Code 2.1.x):
//
//   <claudeDir>/projects/<encoded-cwd>/<session-uuid>.jsonl           main transcript
//   <claudeDir>/projects/<encoded-cwd>/<session-uuid>/subagents/agent-<id>.jsonl      sub-agent transcript
//   <claudeDir>/projects/<encoded-cwd>/<session-uuid>/subagents/agent-<id>.meta.json  {agentType, description, toolUseId}
//   <claudeDir>/projects/<encoded-cwd>/<session-uuid>/tool-results/<id>.txt           persisted large tool outputs
//   <claudeDir>/projects/<encoded-cwd>/memory/*.md                                   project memory (not a session)
//   <claudeDir>/sessions/<pid>.json                                                   registry of running Claude processes
//
// Everything is read-only. All paths handed out to the HTTP layer are derived from the
// index, never from client input.
import fs from 'node:fs';
import path from 'node:path';
import { SessionSource } from './SessionSource.js';
import { readJsonlFrom, readRecordAt, readRecordAtLine } from './parser.js';
import { createSummaryState, reduceRecord, summaryFromState } from './summarize.js';
import { normalizeRecords } from './normalize.js';
import { isUuid, isAgentId, tildify, readJsonSafe, decodeProjectDirName } from '../paths.js';

const CHUNK = 8 * 1024 * 1024;

function safeStat(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

export class ClaudeSessionSource extends SessionSource {
  constructor({ projectsDir, claudeDir, cache, store, log = () => {} }) {
    super();
    this.projectsDir = projectsDir;
    this.claudeDir = claudeDir;
    this.cache = cache;
    this.store = store;
    this.log = log;
    /** @type {Map<string, any>} sessionId -> entry */
    this.index = new Map();
    this.issues = [];
    this.registry = { at: 0, map: new Map() };
    this.lastDiscovery = null;
  }

  // ---------- indexing ----------

  /** Parse (or resume parsing) one transcript file, returning the reducer state. */
  indexFile(file, id) {
    const st = safeStat(file);
    if (!st) throw new Error('file vanished');
    const cached = this.cache.get(file);
    if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs) {
      return { state: cached.state, offset: cached.offset, line: cached.line, errors: cached.errors || [], size: st.size, mtimeMs: st.mtimeMs, partial: cached.partial };
    }
    let state, offset, line, errors;
    if (cached && st.size >= cached.size && cached.offset <= st.size) {
      ({ state, offset, line } = cached);
      errors = cached.errors || [];
    } else {
      state = createSummaryState(id);
      offset = 0;
      line = 1;
      errors = [];
    }
    let partial = false;
    let guard = 0;
    while (guard++ < 10_000) {
      const r = readJsonlFrom(file, { offset, line, maxBytes: CHUNK });
      if (r.truncated) {
        state = createSummaryState(id);
        offset = 0;
        line = 1;
        errors = [];
        continue;
      }
      for (const rec of r.records) reduceRecord(state, rec.obj);
      for (const e of r.errors) if (errors.length < 50) errors.push(e);
      offset = r.offset;
      line = r.line;
      partial = r.partial;
      if (r.records.length === 0 && r.errors.length === 0) break; // nothing consumable left
      if (offset >= r.size) break;
    }
    const result = { state, offset, line, errors, size: st.size, mtimeMs: st.mtimeMs, partial };
    this.cache.set(file, result);
    return result;
  }

  indexSession(projectDirName, id) {
    const projectDir = path.join(this.projectsDir, projectDirName);
    const file = path.join(projectDir, `${id}.jsonl`);
    const prev = this.index.get(id);
    const entry = prev || { id, file, projectDirName, projectDir, dir: path.join(projectDir, id), subagents: new Map() };
    try {
      const r = this.indexFile(file, id);
      Object.assign(entry, { state: r.state, offset: r.offset, line: r.line, errors: r.errors, size: r.size, mtimeMs: r.mtimeMs, partial: r.partial, error: null });
    } catch (e) {
      entry.error = e.message;
      if (!entry.state) entry.state = createSummaryState(id);
    }
    this.indexSubagents(entry);
    this.index.set(id, entry);
    return entry;
  }

  indexSubagents(entry) {
    const dir = path.join(entry.dir, 'subagents');
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      entry.subagents = new Map();
      return;
    }
    const seen = new Set();
    for (const n of names) {
      const m = n.match(/^(agent-[0-9a-z]+)\.jsonl$/i);
      if (!m) continue;
      const agentId = m[1];
      seen.add(agentId);
      const file = path.join(dir, n);
      const sub = entry.subagents.get(agentId) || { agentId, file };
      sub.meta = readJsonSafe(path.join(dir, `${agentId}.meta.json`), sub.meta || null);
      try {
        const r = this.indexFile(file, `${entry.id}/${agentId}`);
        Object.assign(sub, { state: r.state, offset: r.offset, line: r.line, errors: r.errors, size: r.size, mtimeMs: r.mtimeMs, error: null });
      } catch (e) {
        sub.error = e.message;
      }
      entry.subagents.set(agentId, sub);
    }
    for (const k of [...entry.subagents.keys()]) if (!seen.has(k)) entry.subagents.delete(k);
  }

  async discover() {
    const t0 = Date.now();
    const issues = [];
    const seen = new Set();
    let projects = [];
    try {
      projects = fs.readdirSync(this.projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
    } catch (e) {
      const err = new Error(`Cannot read ${tildify(this.projectsDir)}: ${e.code || e.message}`);
      err.code = e.code;
      throw err;
    }
    for (const p of projects) {
      let files = [];
      try {
        files = fs.readdirSync(path.join(this.projectsDir, p.name));
      } catch (e) {
        issues.push({ path: tildify(path.join(this.projectsDir, p.name)), message: `unreadable project folder (${e.code || e.message})` });
        continue;
      }
      for (const f of files) {
        if (!f.endsWith('.jsonl')) continue;
        const id = f.slice(0, -6);
        if (!isUuid(id)) {
          issues.push({ path: tildify(path.join(this.projectsDir, p.name, f)), message: 'unexpected transcript file name (not a session uuid)' });
          continue;
        }
        seen.add(id);
        const entry = this.indexSession(p.name, id);
        if (entry.error) issues.push({ path: tildify(entry.file), sessionId: id, message: entry.error });
        for (const e of entry.errors || []) issues.push({ path: tildify(entry.file), sessionId: id, message: `line ${e.line}: ${e.message}` });
        for (const s of entry.subagents.values()) {
          if (s.error) issues.push({ path: tildify(s.file), sessionId: id, message: s.error });
          for (const e of s.errors || []) issues.push({ path: tildify(s.file), sessionId: id, message: `line ${e.line}: ${e.message}` });
        }
      }
    }
    for (const id of [...this.index.keys()]) if (!seen.has(id)) this.index.delete(id);
    this.issues = issues;
    this.lastDiscovery = {
      at: new Date().toISOString(),
      tookMs: Date.now() - t0,
      projectsDir: this.projectsDir,
      projects: projects.length,
      sessions: this.index.size,
      loaded: [...this.index.values()].filter((e) => !e.error).length,
      failed: [...this.index.values()].filter((e) => e.error).length,
      withParseErrors: [...this.index.values()].filter((e) => e.errors?.length).length,
      issues,
    };
    this.log(`indexed ${this.index.size} sessions in ${this.lastDiscovery.tookMs}ms`);
    return this.lastDiscovery;
  }

  // ---------- live status via Claude's own process registry ----------

  readRegistry() {
    if (Date.now() - this.registry.at < 2000) return this.registry.map;
    const map = new Map();
    const dir = path.join(this.claudeDir, 'sessions');
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      /* no registry on this install */
    }
    for (const n of names) {
      if (!n.endsWith('.json')) continue;
      const r = readJsonSafe(path.join(dir, n));
      if (!r || !r.sessionId) continue;
      let alive = false;
      if (Number.isInteger(r.pid)) {
        try {
          process.kill(r.pid, 0);
          alive = true;
        } catch (e) {
          alive = e.code === 'EPERM';
        }
      }
      if (alive) map.set(r.sessionId, { pid: r.pid, status: r.status || null, updatedAt: r.updatedAt || null, name: r.name || null });
    }
    this.registry = { at: Date.now(), map };
    return map;
  }

  // ---------- public API ----------

  summaryFor(entry) {
    const reg = this.readRegistry().get(entry.id) || null;
    const customName = this.store.getCustomName(entry.id);
    const base = summaryFromState(entry.state);
    const cwd = base.cwd || decodeProjectDirName(entry.projectDirName);
    const recentMs = base.endedAt ? Date.now() - Date.parse(base.endedAt) : Infinity;
    return {
      ...base,
      customName,
      title: customName || base.generatedTitle || 'Untitled session',
      project: { name: path.basename(cwd) || cwd, path: tildify(cwd), raw: cwd, dirName: entry.projectDirName },
      file: { path: tildify(entry.file), sizeBytes: entry.size ?? 0, mtime: entry.mtimeMs ? new Date(entry.mtimeMs).toISOString() : null, partialWrite: !!entry.partial },
      parseErrors: entry.errors?.length || 0,
      loadError: entry.error || null,
      live: reg ? { pid: reg.pid, status: reg.status, updatedAt: reg.updatedAt } : null,
      recentlyActive: recentMs < 2 * 60 * 1000,
      subagents: [...entry.subagents.values()].map((s) => ({
        agentId: s.agentId,
        agentType: s.meta?.agentType || null,
        description: s.meta?.description || null,
        toolUseId: s.meta?.toolUseId || null,
        spawnDepth: s.meta?.spawnDepth ?? null,
        counts: s.state ? summaryFromState(s.state).counts : null,
        startedAt: s.state?.firstTs || null,
        endedAt: s.state?.lastTs || null,
        model: s.state ? summaryFromState(s.state).model : null,
        sizeBytes: s.size ?? 0,
        error: s.error || null,
      })),
    };
  }

  listSessions() {
    const out = [];
    for (const e of this.index.values()) out.push(this.summaryFor(e));
    out.sort((a, b) => (b.endedAt || '').localeCompare(a.endedAt || ''));
    return out;
  }

  getSummary(id) {
    const e = this.index.get(id);
    return e ? this.summaryFor(e) : null;
  }

  entryFor(id) {
    if (!isUuid(id)) throw Object.assign(new Error('invalid session id'), { status: 400 });
    const e = this.index.get(id);
    if (!e) throw Object.assign(new Error('session not found'), { status: 404 });
    return e;
  }

  fileFor(entry, fileKey) {
    if (!fileKey || fileKey === 'main') return { file: entry.file, key: 'main' };
    if (!isAgentId(fileKey)) throw Object.assign(new Error('invalid file key'), { status: 400 });
    const sub = entry.subagents.get(fileKey);
    if (!sub) throw Object.assign(new Error('sub-agent not found'), { status: 404 });
    return { file: sub.file, key: fileKey };
  }

  readEvents(file, key, { from = 0, line = 1 } = {}) {
    const events = [];
    const errors = [];
    let offset = Math.max(0, Number(from) || 0);
    let ln = Math.max(1, Number(line) || 1);
    let partial = false;
    let size = 0;
    let restarted = false;
    let guard = 0;
    while (guard++ < 10_000) {
      const r = readJsonlFrom(file, { offset, line: ln, maxBytes: CHUNK });
      size = r.size;
      if (r.truncated) {
        if (restarted) break;
        restarted = true;
        offset = 0;
        ln = 1;
        events.length = 0;
        continue;
      }
      for (const ev of normalizeRecords(r.records, key)) events.push(ev);
      for (const e of r.errors) errors.push(e);
      offset = r.offset;
      ln = r.line;
      partial = r.partial;
      if (r.records.length === 0 && r.errors.length === 0) break;
      if (offset >= size) break;
    }
    return { events, errors, offset, line: ln, size, partial, restarted };
  }

  readSession(id, opts = {}) {
    const entry = this.entryFor(id);
    const r = this.readEvents(entry.file, 'main', opts);
    return { id, ...r, summary: this.summaryFor(entry) };
  }

  readSubagent(id, agentId, opts = {}) {
    const entry = this.entryFor(id);
    const { file, key } = this.fileFor(entry, agentId);
    const sub = entry.subagents.get(agentId);
    const r = this.readEvents(file, key, opts);
    return { id, agentId, meta: sub?.meta || null, ...r };
  }

  readRaw(id, fileKey, { line, offset, length }) {
    const entry = this.entryFor(id);
    const { file } = this.fileFor(entry, fileKey);
    const st = safeStat(file);
    if (!st) throw Object.assign(new Error('file vanished'), { status: 404 });
    if (Number.isInteger(offset) && Number.isInteger(length) && offset >= 0 && length > 0 && offset + length <= st.size) {
      try {
        return readRecordAt(file, offset, length);
      } catch {
        /* fall through to line scan */
      }
    }
    if (Number.isInteger(line) && line > 0) return readRecordAtLine(file, line);
    throw Object.assign(new Error('line or offset required'), { status: 400 });
  }

  /** Path to the session's sidecar folder (or its project folder if none exists). */
  revealTarget(id) {
    const entry = this.entryFor(id);
    return safeStat(entry.dir)?.isDirectory() ? entry.dir : entry.file;
  }

  search(query) {
    const terms = String(query || '')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (!terms.length) return null;
    const names = this.store.allCustomNames();
    const out = [];
    for (const e of this.index.values()) {
      const s = e.state;
      const head = `${names[e.id] || ''}\n${s.claudeCustomTitle || ''}\n${s.aiTitle || ''}\n${s.firstPrompt || ''}\n${s.cwd || ''}\n${Object.keys(s.models).join(' ')}`.toLowerCase();
      let ok = true;
      for (const t of terms) {
        if (!head.includes(t) && !s.digest.includes(t)) {
          let found = false;
          for (const sub of e.subagents.values()) if (sub.state?.digest.includes(t)) { found = true; break; }
          if (!found) { ok = false; break; }
        }
      }
      if (ok) out.push(e.id);
    }
    return out;
  }

  /** Re-index the session(s) affected by a changed path. Returns the session id or null. */
  reindexPath(rel) {
    const parts = rel.split(path.sep).filter(Boolean);
    if (parts.length < 2) return null;
    const projectDirName = parts[0];
    let id = null;
    if (parts.length === 2 && parts[1].endsWith('.jsonl')) id = parts[1].slice(0, -6);
    else if (parts.length >= 3) id = parts[1];
    if (!isUuid(id)) return null;
    const file = path.join(this.projectsDir, projectDirName, `${id}.jsonl`);
    if (!safeStat(file)) {
      if (this.index.has(id)) {
        this.index.delete(id);
        return { id, removed: true };
      }
      return null;
    }
    this.indexSession(projectDirName, id);
    return { id, removed: false };
  }

  watch(onChange) {
    const pending = new Set();
    let timer = null;
    let registryTimer = null;
    const flush = () => {
      timer = null;
      const updated = new Set();
      const removed = new Set();
      for (const rel of pending) {
        try {
          const r = this.reindexPath(rel);
          if (r) (r.removed ? removed : updated).add(r.id);
        } catch (e) {
          this.log(`reindex failed for ${rel}: ${e.message}`);
        }
      }
      pending.clear();
      if (updated.size || removed.size) onChange({ type: 'sessions', updated: [...updated], removed: [...removed] });
    };
    const watchers = [];
    try {
      const w = fs.watch(this.projectsDir, { recursive: true }, (_ev, filename) => {
        if (!filename) return;
        const rel = String(filename);
        if (!rel.endsWith('.jsonl')) return;
        pending.add(rel);
        if (!timer) timer = setTimeout(flush, 300);
      });
      w.on('error', (e) => this.log(`watch error: ${e.message}`));
      watchers.push(w);
    } catch (e) {
      this.log(`fs.watch unavailable (${e.message}); falling back to polling`);
      const poll = setInterval(() => {
        for (const entry of this.index.values()) {
          const st = safeStat(entry.file);
          if (st && (st.size !== entry.size || st.mtimeMs !== entry.mtimeMs)) pending.add(path.join(entry.projectDirName, `${entry.id}.jsonl`));
        }
        if (pending.size && !timer) timer = setTimeout(flush, 0);
      }, 3000);
      watchers.push({ close: () => clearInterval(poll) });
    }
    try {
      const rw = fs.watch(path.join(this.claudeDir, 'sessions'), () => {
        if (registryTimer) return;
        registryTimer = setTimeout(() => {
          registryTimer = null;
          this.registry.at = 0;
          onChange({ type: 'live' });
        }, 500);
      });
      rw.on('error', () => {});
      watchers.push(rw);
    } catch {
      /* no registry dir */
    }
    return () => {
      for (const w of watchers) try { w.close(); } catch { /* ignore */ }
      if (timer) clearTimeout(timer);
    };
  }
}
