// Adapter for Claude Code's on-disk transcript layout (observed in Claude Code 2.1.x):
//
//   <claudeDir>/projects/<encoded-cwd>/<session-uuid>.jsonl           main transcript
//   <claudeDir>/projects/<encoded-cwd>/<session-uuid>/subagents/agent-<id>.jsonl      sub-agent transcript
//   <claudeDir>/projects/<encoded-cwd>/<session-uuid>/subagents/agent-<id>.meta.json  {agentType, description, toolUseId}
//   <claudeDir>/projects/<encoded-cwd>/<session-uuid>/tool-results/<id>.txt           persisted large tool outputs
//   <claudeDir>/projects/<encoded-cwd>/memory/*.md                                   project memory (not a session)
//   <claudeDir>/CLAUDE.md, <claudeDir>/rules/**/*.md                                  global memory, loaded in every project
//   <claudeDir>/sessions/<pid>.json                                                   registry of running Claude processes
//
// Everything is read-only. All paths handed out to the HTTP layer are derived from the
// index, never from client input.
import fs from 'node:fs';
import path from 'node:path';
import { SessionSource } from './SessionSource.js';
import { readJsonlFrom, readRecordAt, readRecordAtLine } from './parser.js';
import { createSummaryState, reduceRecord, summaryFromState, memorySummary } from './summarize.js';
import { readMemoryDirs, readGlobalMemory } from '../memory.js';
import { GLOBAL_MEMORY, setGlobalMemoryDir } from './memory-ops.js';
import { normalizeRecords } from './normalize.js';
import { createContextState, reduceContext, contextFromState } from './context.js';
import { mergeRates, estimateCost, checkRates, FITTED_MODELS } from '../pricing.js';
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
    if (claudeDir) setGlobalMemoryDir(claudeDir);
    this.cache = cache;
    this.store = store;
    this.log = log;
    /** @type {Map<string, any>} sessionId -> entry */
    this.index = new Map();
    this.issues = [];
    this.registry = { at: 0, map: new Map() };
    this.lastDiscovery = null;
    /** sessionId -> {size, mtimeMs, context} */
    this.contextCache = new Map();
  }

  // ---------- indexing ----------

  /** Parse (or resume parsing) one transcript file, returning the reducer state. */
  indexFile(file, id, opts = {}) {
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
      state = createSummaryState(id, opts);
      offset = 0;
      line = 1;
      errors = [];
    }
    let partial = false;
    let guard = 0;
    while (guard++ < 10_000) {
      const r = readJsonlFrom(file, { offset, line, maxBytes: CHUNK });
      if (r.truncated) {
        state = createSummaryState(id, opts);
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
        const r = this.indexFile(file, `${entry.id}/${agentId}`, { isAgent: true });
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
    const rates = this.rates();
    const subagents = [...entry.subagents.values()].map((s) => {
      const sum = s.state ? summaryFromState(s.state) : null;
      const usageByModel = s.state?.usageByModel || {};
      const est = estimateCost(usageByModel, [], rates);
      return {
        agentId: s.agentId,
        agentType: s.meta?.agentType || null,
        description: s.meta?.description || null,
        toolUseId: s.meta?.toolUseId || null,
        spawnDepth: s.meta?.spawnDepth ?? null,
        counts: sum ? sum.counts : null,
        prompt: s.state?.firstPrompt || null,
        usage: s.state?.usage || null,
        usageByModel,
        estimate: est.byModel.length ? { totalUSD: est.totalUSD, complete: est.complete } : null,
        startedAt: s.state?.firstTs || null,
        endedAt: s.state?.lastTs || null,
        model: sum ? sum.model : null,
        sizeBytes: s.size ?? 0,
        error: s.error || null,
        memory: memorySummary(this.verifiedMemoryOps(s.state?.memoryOps)),
      };
    });
    base.memory = memorySummary(this.verifiedMemoryOps(entry.state?.memoryOps));
    return {
      ...base,
      estimate: estimateCost(base.usageByModel, subagents, rates),
      customName,
      title: customName || base.generatedTitle || 'Untitled session',
      project: { name: path.basename(cwd) || cwd, path: tildify(cwd), raw: cwd, dirName: entry.projectDirName },
      file: { path: tildify(entry.file), sizeBytes: entry.size ?? 0, mtime: entry.mtimeMs ? new Date(entry.mtimeMs).toISOString() : null, partialWrite: !!entry.partial },
      parseErrors: entry.errors?.length || 0,
      loadError: entry.error || null,
      live: reg ? { pid: reg.pid, status: reg.status, updatedAt: reg.updatedAt } : null,
      recentlyActive: recentMs < 2 * 60 * 1000,
      subagents,
    };
  }

  /** Effective $/MTok rate table: defaults overridden by the user's settings. */
  rates() {
    return mergeRates(this.store.getSettings().rates);
  }

  /** Rate table plus how well it reproduces the costs Claude Code itself recorded. */
  pricingReport() {
    const rates = this.rates();
    const records = [];
    for (const e of this.index.values()) if (e.state?.cost?.modelUsage) records.push(e.state.cost.modelUsage);
    return { rates, overrides: this.store.getSettings().rates || {}, accuracy: checkRates(records, rates), recordedSessions: records.length, fitted: [...FITTED_MODELS] };
  }

  /** Drop ops on bare note names guessed from a shell command unless that note exists on disk. */
  verifiedMemoryOps(ops = []) {
    return ops.filter((o) => !o.inferred || safeStat(path.join(this.projectsDir, o.project, 'memory', o.file))?.isFile());
  }

  /**
   * Every project's memory notes, each with the history of transcript records that read,
   * wrote, edited, deleted or loaded it. Notes that only exist in history (deleted since)
   * are included with `missing: true` so their last known content can still be inspected.
   */
  memoryReport() {
    const dirs = readMemoryDirs(this.projectsDir);
    const history = new Map(); // `${project}/${file}` -> ops
    const cwdOf = new Map();
    const direct = new Set();
    for (const e of this.index.values()) for (const st of [e.state, ...[...e.subagents.values()].map((x) => x.state)]) for (const op of st?.memoryOps || []) if (!op.inferred) direct.add(`${op.project}/${op.file}`);
    const push = (op, sessionId, agentId) => {
      const k = `${op.project}/${op.file}`;
      // A name guessed from `cd …/memory && …` counts only for a note that exists or was addressed by full path elsewhere.
      if (op.inferred && !direct.has(k) && !safeStat(path.join(this.projectsDir, op.project, 'memory', op.file))?.isFile()) return;
      if (!history.has(k)) history.set(k, []);
      history.get(k).push({ ...op, project: undefined, file: undefined, sessionId, agentId });
    };
    for (const e of this.index.values()) {
      if (e.state?.cwd && !cwdOf.has(e.projectDirName)) cwdOf.set(e.projectDirName, e.state.cwd);
      for (const op of e.state?.memoryOps || []) push(op, e.id, null);
      for (const sub of e.subagents.values()) for (const op of sub.state?.memoryOps || []) push(op, e.id, sub.agentId);
    }
    const byTs = (a, b) => (a.ts || '').localeCompare(b.ts || '');
    const projects = new Map(dirs.map((d) => [d.dirName, d]));
    // Global files can sit in subfolders (rules/x/y.md); project folder names never contain '/'.
    const splitKey = (k) => [k.slice(0, k.indexOf('/')), k.slice(k.indexOf('/') + 1)];
    for (const k of history.keys()) {
      const [dirName] = splitKey(k);
      if (dirName === GLOBAL_MEMORY) continue;
      if (!projects.has(dirName)) projects.set(dirName, { dirName, dir: path.join(this.projectsDir, dirName, 'memory'), notes: [], index: null, missingDir: true });
    }
    const out = [];
    const g = readGlobalMemory(this.claudeDir);
    const gOnDisk = new Set(g.notes.map((n) => n.file));
    const gNotes = g.notes.map((n) => ({ ...n, path: tildify(n.path), history: (history.get(`${GLOBAL_MEMORY}/${n.file}`) || []).sort(byTs) }));
    for (const [k, ops] of history) {
      const [dirName, file] = splitKey(k);
      // A global file sessions only tried to read may never have existed; list it only once something wrote it.
      if (dirName !== GLOBAL_MEMORY || gOnDisk.has(file) || !ops.some((o) => o.op !== 'read' && o.op !== 'loaded')) continue;
      gNotes.push({ file, path: tildify(path.join(g.dir, file)), kind: file.startsWith('rules/') ? 'rule' : 'user', missing: true, sizeBytes: 0, mtime: null, body: '', frontmatter: null, frontmatterRaw: null, links: [], history: ops.sort(byTs) });
    }
    const global = { dirName: GLOBAL_MEMORY, dir: tildify(g.dir), missingDir: false, scope: 'global', project: { name: 'Global', path: tildify(g.dir) }, notes: gNotes, index: null, userFile: tildify(g.userFile), rulesDir: tildify(g.rulesDir) };
    for (const d of projects.values()) {
      const onDisk = new Set(d.notes.map((n) => n.file));
      const notes = d.notes.map((n) => ({ ...n, path: tildify(n.path), history: (history.get(`${d.dirName}/${n.file}`) || []).sort(byTs) }));
      for (const [k, ops] of history) {
        const [dirName, file] = splitKey(k);
        if (dirName !== d.dirName || onDisk.has(file) || file === 'MEMORY.md') continue;
        notes.push({ file, path: tildify(path.join(d.dir, file)), missing: true, sizeBytes: 0, mtime: null, body: '', frontmatter: null, frontmatterRaw: null, links: [], history: ops.sort(byTs) });
      }
      const index = d.index ? { ...d.index, path: tildify(d.index.path), history: (history.get(`${d.dirName}/MEMORY.md`) || []).sort(byTs) } : null;
      const cwd = cwdOf.get(d.dirName) || decodeProjectDirName(d.dirName);
      if (!notes.length && !index) continue;
      out.push({ dirName: d.dirName, dir: tildify(d.dir), missingDir: !!d.missingDir, project: { name: path.basename(cwd) || cwd, path: tildify(cwd) }, notes, index });
    }
    const last = (p) => [p.index?.mtime, ...p.notes.map((n) => n.mtime || n.history.at(-1)?.ts)].filter(Boolean).sort().at(-1) || '';
    out.sort((a, b) => last(b).localeCompare(last(a)));
    // Global memory always comes first, even when empty, so it is clear where it would live.
    return { memoryDirName: 'memory', projects: [global, ...out] };
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

  /** The system prompt, tool/agent/skill listings and instructions the model was given (from attachment records). */
  readContext(id) {
    const entry = this.entryFor(id);
    const st = safeStat(entry.file);
    if (!st) throw Object.assign(new Error('file vanished'), { status: 404 });
    const hit = this.contextCache.get(id);
    if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.context;
    const state = createContextState();
    let offset = 0;
    let line = 1;
    let guard = 0;
    while (guard++ < 10_000) {
      const r = readJsonlFrom(entry.file, { offset, line, maxBytes: CHUNK });
      if (r.truncated) break;
      for (const rec of r.records) {
        try {
          reduceContext(state, rec);
        } catch {
          /* ignore malformed attachment */
        }
      }
      offset = r.offset;
      line = r.line;
      if ((r.records.length === 0 && r.errors.length === 0) || offset >= r.size) break;
    }
    const context = { id, ...contextFromState(state) };
    if (this.contextCache.size > 32) this.contextCache.delete(this.contextCache.keys().next().value);
    this.contextCache.set(id, { size: st.size, mtimeMs: st.mtimeMs, context });
    return context;
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
    let memoryTimer = null;
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
    const memoryChanged = () => {
      if (!memoryTimer) memoryTimer = setTimeout(() => { memoryTimer = null; onChange({ type: 'memory' }); }, 300);
    };
    try {
      const w = fs.watch(this.projectsDir, { recursive: true }, (_ev, filename) => {
        if (!filename) return;
        const rel = String(filename);
        if (/(^|[\\/])memory[\\/][^\\/]+\.md$/.test(rel)) {
          memoryChanged();
          return;
        }
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
    // Global memory: <claudeDir>/CLAUDE.md (watched through its folder so a first write is seen) and rules/.
    for (const [dir, recursive, test] of [[this.claudeDir, false, (f) => f === 'CLAUDE.md'], [path.join(this.claudeDir, 'rules'), true, (f) => f.endsWith('.md')]]) {
      try {
        const gw = fs.watch(dir, { recursive }, (_ev, filename) => filename && test(String(filename)) && memoryChanged());
        gw.on('error', () => {});
        watchers.push(gw);
      } catch {
        /* folder absent */
      }
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
      if (memoryTimer) clearTimeout(memoryTimer);
    };
  }
}
