#!/usr/bin/env node
// Local filesystem bridge for the Claude Session Viewer.
//
// Security model:
//  - Binds to 127.0.0.1 only. Never listens on other interfaces.
//  - Every API call must carry a per-launch random token that is only present in the HTML
//    we serve, so other local web pages cannot read sessions (blocks CSRF / DNS rebinding).
//  - Host and Origin headers are validated against the loopback address.
//  - Session ids and agent ids are validated; file paths are always resolved from the index.
//  - No outbound network calls, ever.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { discoverClaudeDir, resolveProjectsDir } from './discovery.js';
import { ClaudeSessionSource } from './session-source/ClaudeSessionSource.js';
import { SummaryCache } from './session-source/cache.js';
import { MetadataStore, MAX_NAME_LENGTH } from './store.js';
import { ensureAppHome, tildify, isUuid, isAgentId } from './paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');
const args = process.argv.slice(2);
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const PORT = Number(argValue('--port') || process.env.PORT || 4477);
const DEV = args.includes('--dev');
const NO_OPEN = args.includes('--no-open') || DEV;
const CLI_DIR = argValue('--dir');
const TOKEN = crypto.randomBytes(24).toString('hex');
const VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;

const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);

ensureAppHome();
const store = new MetadataStore();
const cache = new SummaryCache();

/** @type {ClaudeSessionSource|null} */
let source = null;
let discovery = null; // discovery report (candidates etc.)
let indexState = { status: 'idle', error: null, report: null };
let unwatch = () => {};
const sseClients = new Set();

function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(data);
    } catch {
      sseClients.delete(res);
    }
  }
}

async function initSource() {
  unwatch();
  unwatch = () => {};
  source = null;
  const explicit = CLI_DIR || store.getSettings().dataDir || undefined;
  discovery = discoverClaudeDir(explicit);
  if (!discovery.chosen) {
    indexState = { status: 'error', error: explicit ? `No Claude sessions found in ${tildify(path.resolve(explicit))}` : 'No Claude data directory found', report: null };
    return;
  }
  const { claudeDir, projectsDir } = discovery.chosen;
  source = new ClaudeSessionSource({ projectsDir, claudeDir, cache, store, log });
  await reindex();
  unwatch = source.watch((change) => {
    if (change.type === 'sessions') {
      const updated = change.updated.map((id) => source.getSummary(id)).filter(Boolean);
      broadcast({ type: 'sessions', updated, removed: change.removed });
    } else if (change.type === 'live') {
      broadcast({ type: 'live', sessions: source.listSessions().filter((s) => s.live).map((s) => ({ id: s.id, live: s.live })) });
    }
  });
}

async function reindex() {
  if (!source) return;
  indexState = { status: 'indexing', error: null, report: indexState.report };
  broadcast({ type: 'indexing', status: 'indexing' });
  try {
    const report = await source.discover();
    indexState = { status: 'ready', error: null, report };
  } catch (e) {
    indexState = { status: 'error', error: e.message, code: e.code, report: null };
  }
  broadcast({ type: 'indexing', status: indexState.status });
}

// ---------- helpers ----------

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.map': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  const payload = isJson ? JSON.stringify(body) : body;
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(payload);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(Object.assign(new Error('invalid JSON body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function loopbackHost(host) {
  if (!host) return false;
  const h = host.toLowerCase();
  return h === `127.0.0.1:${PORT}` || h === `localhost:${PORT}` || h === `[::1]:${PORT}`;
}

function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  rel = path.posix.normalize(rel);
  if (rel.includes('..')) return send(res, 400, 'bad path');
  const file = path.join(DIST, rel);
  if (!file.startsWith(DIST + path.sep)) return send(res, 400, 'bad path');
  let data;
  try {
    data = fs.readFileSync(file);
  } catch {
    if (rel === '/index.html') return send(res, 503, 'UI not built. Run: npm run build');
    // SPA fallback
    try {
      data = fs.readFileSync(path.join(DIST, 'index.html'));
      rel = '/index.html';
    } catch {
      return send(res, 404, 'not found');
    }
  }
  if (rel === '/index.html') {
    data = Buffer.from(data.toString('utf8').replace('<head>', `<head>\n<meta name="csv-token" content="${TOKEN}">`));
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(rel)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(data);
}

function statusPayload() {
  return {
    version: VERSION,
    status: indexState.status,
    error: indexState.error,
    errorCode: indexState.code || null,
    report: indexState.report,
    dataDir: source ? tildify(source.claudeDir) : null,
    projectsDir: source ? tildify(source.projectsDir) : null,
    candidates: (discovery?.candidates || []).map((c) => ({ ...c, path: tildify(c.path) })),
    explicit: discovery?.explicit ? { ...discovery.explicit, path: tildify(discovery.explicit.path) } : null,
    settings: store.getSettings(),
    platform: process.platform,
    canReveal: ['darwin', 'win32', 'linux'].includes(process.platform),
  };
}

function requireSource() {
  if (!source) throw Object.assign(new Error(indexState.error || 'no data directory'), { status: 503 });
  return source;
}

// ---------- API ----------

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const [, resource, id, sub, subId] = parts;
  const q = url.searchParams;
  // EventSource cannot set request headers, so the SSE endpoint alone accepts the token as a query param.
  const presented = req.headers['x-csv-token'] || (resource === 'events' ? q.get('token') : null);
  if (presented !== TOKEN) return send(res, 403, { error: 'missing or invalid token' });

  if (resource === 'status' && req.method === 'GET') return send(res, 200, statusPayload());

  if (resource === 'refresh' && req.method === 'POST') {
    if (!source) await initSource();
    else await reindex();
    return send(res, 200, statusPayload());
  }

  if (resource === 'settings') {
    if (req.method === 'GET') return send(res, 200, store.getSettings());
    if (req.method === 'PUT') {
      const body = await readBody(req);
      if ('dataDir' in body) {
        const v = body.dataDir == null || body.dataDir === '' ? null : String(body.dataDir);
        if (v) {
          if (v.length > 1024 || v.includes('\0')) return send(res, 400, { error: 'invalid path' });
          const r = resolveProjectsDir(v);
          if (!r.ok) return send(res, 400, { error: r.reason, path: tildify(r.path) });
        }
        store.setSettings({ dataDir: v });
        await initSource();
      }
      return send(res, 200, statusPayload());
    }
  }

  if (resource === 'events' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`data: ${JSON.stringify({ type: 'hello', status: indexState.status })}\n\n`);
    sseClients.add(res);
    const ping = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        /* closed */
      }
    }, 25000);
    req.on('close', () => {
      clearInterval(ping);
      sseClients.delete(res);
    });
    return;
  }

  if (resource === 'search' && req.method === 'GET') {
    const src = requireSource();
    const query = String(q.get('q') || '').slice(0, 500);
    return send(res, 200, { query, ids: src.search(query) });
  }

  if (resource === 'sessions') {
    const src = requireSource();
    if (!id && req.method === 'GET') return send(res, 200, { sessions: src.listSessions(), status: indexState.status, report: indexState.report });
    if (!isUuid(id)) return send(res, 400, { error: 'invalid session id' });

    if (!sub && req.method === 'GET') {
      const from = q.has('from') ? Number(q.get('from')) : 0;
      const line = q.has('line') ? Number(q.get('line')) : 1;
      return send(res, 200, src.readSession(id, { from, line }));
    }
    if (sub === 'summary' && req.method === 'GET') {
      const s = src.getSummary(id);
      return s ? send(res, 200, s) : send(res, 404, { error: 'session not found' });
    }
    if (sub === 'subagents' && subId && req.method === 'GET') {
      if (!isAgentId(subId)) return send(res, 400, { error: 'invalid agent id' });
      const from = q.has('from') ? Number(q.get('from')) : 0;
      const line = q.has('line') ? Number(q.get('line')) : 1;
      return send(res, 200, src.readSubagent(id, subId, { from, line }));
    }
    if (sub === 'raw' && req.method === 'GET') {
      const fileKey = q.get('file') || 'main';
      const line = q.has('line') ? Number(q.get('line')) : undefined;
      const offset = q.has('offset') ? Number(q.get('offset')) : undefined;
      const length = q.has('length') ? Number(q.get('length')) : undefined;
      const raw = src.readRaw(id, fileKey, { line, offset, length });
      if (raw == null) return send(res, 404, { error: 'record not found' });
      return send(res, 200, { raw });
    }
    if (sub === 'image' && req.method === 'GET') {
      const fileKey = q.get('file') || 'main';
      const line = Number(q.get('line'));
      const block = Number(q.get('block'));
      const raw = src.readRaw(id, fileKey, { line, offset: Number(q.get('offset')), length: Number(q.get('length')) });
      const b = raw?.message?.content?.[block];
      if (!b || b.type !== 'image' || b.source?.type !== 'base64' || !/^image\/(png|jpeg|gif|webp)$/.test(b.source.media_type || '')) {
        return send(res, 404, { error: 'image not found' });
      }
      res.writeHead(200, { 'Content-Type': b.source.media_type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end(Buffer.from(b.source.data, 'base64'));
    }
    if (sub === 'name') {
      if (req.method === 'PUT') {
        const body = await readBody(req);
        try {
          const m = store.setCustomName(id, body.name);
          const summary = src.getSummary(id);
          broadcast({ type: 'sessions', updated: summary ? [summary] : [], removed: [] });
          return send(res, 200, { ok: true, customName: m.customName, updatedAt: m.updatedAt, summary });
        } catch (e) {
          return send(res, 400, { error: e.message, maxLength: MAX_NAME_LENGTH });
        }
      }
      if (req.method === 'DELETE') {
        store.clearCustomName(id);
        const summary = src.getSummary(id);
        broadcast({ type: 'sessions', updated: summary ? [summary] : [], removed: [] });
        return send(res, 200, { ok: true, summary });
      }
    }
    if (sub === 'reveal' && req.method === 'POST') {
      const target = src.revealTarget(id);
      const cmd = process.platform === 'darwin' ? ['open', ['-R', target]] : process.platform === 'win32' ? ['explorer.exe', ['/select,', target]] : ['xdg-open', [path.dirname(target)]];
      execFile(cmd[0], cmd[1], (err) => err && log(`reveal failed: ${err.message}`));
      return send(res, 200, { ok: true });
    }
  }
  return send(res, 404, { error: 'not found' });
}

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  if (!loopbackHost(req.headers.host)) return send(res, 403, 'forbidden host');
  const origin = req.headers.origin;
  if (origin && !loopbackHost(origin.replace(/^https?:\/\//, ''))) return send(res, 403, 'forbidden origin');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET') return send(res, 405, 'method not allowed');
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) log('error', e.stack || e.message);
    return send(res, status, { error: e.message || 'internal error', code: e.code || null });
  }
});

server.listen(PORT, '127.0.0.1', async () => {
  const urlStr = `http://127.0.0.1:${PORT}/`;
  log(`Claude Session Viewer v${VERSION} listening on ${urlStr}${DEV ? ' (dev)' : ''}`);
  await initSource();
  if (source) log(`data dir: ${tildify(source.claudeDir)}`);
  else log(`no data directory: ${indexState.error}`);
  if (!NO_OPEN) {
    const opener = process.platform === 'darwin' ? ['open', [urlStr]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', urlStr]] : ['xdg-open', [urlStr]];
    execFile(opener[0], opener[1], () => {});
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Start with --port <n> to pick another.`);
    process.exit(1);
  }
  throw e;
});

process.on('SIGINT', () => {
  unwatch();
  server.close();
  process.exit(0);
});
