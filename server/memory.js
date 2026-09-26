// Reads Claude Code's auto-memory folders: <projectsDir>/<encoded-cwd>/memory/*.md.
// Each note is Markdown with a small YAML front matter (name, description, metadata.type, …);
// MEMORY.md is the index Claude loads at session start. Read-only, like everything else.
import fs from 'node:fs';
import path from 'node:path';

const MAX_NOTE_BYTES = 256 * 1024;

function unquote(v) {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    try {
      return t.startsWith('"') ? JSON.parse(t) : t.slice(1, -1).replace(/''/g, "'");
    } catch {
      return t.slice(1, -1);
    }
  }
  return t;
}

/** Split `---` front matter from the body and parse the simple nested key: value subset notes use. */
export function parseNote(text) {
  const src = String(text).replace(/\r\n/g, '\n');
  const m = src.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { frontmatter: null, frontmatterRaw: null, body: src };
  const root = {};
  const stack = [{ indent: -1, obj: root }];
  for (const line of m[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const kv = line.match(/^(\s*)([^:\s][^:]*?):\s*(.*)$/);
    if (!kv) continue;
    const indent = kv[1].length;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].obj;
    if (kv[3] === '') {
      const child = {};
      parent[kv[2]] = child;
      stack.push({ indent, obj: child });
    } else parent[kv[2]] = unquote(kv[3]);
  }
  return { frontmatter: root, frontmatterRaw: m[1], body: src.slice(m[0].length) };
}

/** `[[slug]]` references in a body. */
export function noteLinks(body) {
  return [...new Set([...String(body).matchAll(/\[\[([^\]\n]+)\]\]/g)].map((m) => m[1].trim()))];
}

/** MEMORY.md lines of the form `- [Title](file.md) — hook`. */
export function parseIndex(body) {
  const entries = [];
  for (const line of String(body).split('\n')) {
    const m = line.match(/^\s*[-*]\s*\[([^\]]+)\]\(([^)\s]+)\)\s*(?:[—–-]\s*)?(.*)$/);
    if (m) entries.push({ title: m[1].trim(), file: m[2].trim(), hook: m[3].trim() });
  }
  return entries;
}

function readNote(dir, file) {
  const full = path.join(dir, file);
  let st;
  try {
    st = fs.statSync(full);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  let text = '';
  try {
    const fd = fs.openSync(full, 'r');
    const buf = Buffer.alloc(Math.min(st.size, MAX_NOTE_BYTES));
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    text = buf.toString('utf8');
  } catch (e) {
    return { file, path: full, sizeBytes: st.size, mtime: st.mtime.toISOString(), error: e.code || e.message, body: '', frontmatter: null, frontmatterRaw: null, links: [] };
  }
  const n = parseNote(text);
  return { file, path: full, sizeBytes: st.size, mtime: st.mtime.toISOString(), truncated: st.size > MAX_NOTE_BYTES, ...n, links: noteLinks(n.body) };
}

/** Every project folder that has a memory directory, with its notes parsed. */
export function readMemoryDirs(projectsDir) {
  let projects = [];
  try {
    projects = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return [];
  }
  const out = [];
  for (const p of projects) {
    const dir = path.join(projectsDir, p.name, 'memory');
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    const notes = [];
    let index = null;
    for (const n of names.sort()) {
      if (!n.endsWith('.md')) continue;
      const note = readNote(dir, n);
      if (!note) continue;
      if (n === 'MEMORY.md') index = { ...note, entries: parseIndex(note.body) };
      else notes.push(note);
    }
    out.push({ dirName: p.name, dir, notes, index });
  }
  return out;
}
