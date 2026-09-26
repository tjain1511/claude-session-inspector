// Detects reads and writes of Claude Code's auto-memory notes inside transcript records.
// Memory lives at <claudeDir>/projects/<encoded-cwd>/memory/*.md (MEMORY.md is the index).
// Only what the record shows is reported: the tool, the path and, for writes, the content.

// Encoded project folder names and note files are plain [\w.-]; this skips globs and placeholders.
const MEMORY_PATH = /\/projects\/([\w.-]+)\/memory\/([\w.-]+\.md)(?![\w.*-])/g;
const CONTENT_CAP = 16 * 1024;

/** All distinct memory files a string mentions: [{project, file}] */
export function memoryPaths(s) {
  if (typeof s !== 'string' || !s.includes('/memory/')) return [];
  const out = [];
  const seen = new Set();
  for (const m of s.matchAll(MEMORY_PATH)) {
    const k = `${m[1]}/${m[2]}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ project: m[1], file: m[2] });
  }
  return out;
}

const MEMORY_DIR = /\/projects\/([\w.-]+)\/memory(?![\w.-]|\/[\w.-]+\.md)/g;
// A bare note name: at a word boundary, or right after `$VAR/`, `${VAR}/` or a quote (pathlib `M / "x.md"`).
const BARE_NOTE = /(?:^|[\s"'=(,;|&<>]|\$\{?\w+\}?\/)([\w.-]+\.md)(?![\w.*-])/g;

/**
 * Notes a shell command names relative to a memory folder it mentions (`cd …/memory && …`,
 * `M=…/memory; cat $M/a.md`). Only used when the command mentions exactly one memory folder;
 * the results are marked `inferred` and kept only if the note exists (see memoryReport).
 */
export function inferredMemoryPaths(cmd) {
  if (typeof cmd !== 'string' || !cmd.includes('/memory')) return [];
  const dirs = new Set([...cmd.matchAll(MEMORY_DIR)].map((m) => m[1]));
  if (dirs.size !== 1) return [];
  const [project] = dirs;
  const direct = new Set(memoryPaths(cmd).map((p) => p.file));
  // Text written by `cat`/`tee` heredocs or `echo`/`printf` strings is data (e.g. an index line naming a note), not a file access.
  const code = cmd
    .replace(/(\b(?:cat|tee)\b[^\n]*<<-?\s*(['"]?)(\w+)\2[^\n]*\n)[\s\S]*?\n\3(?=\n|$)/g, '$1')
    .replace(/\b(echo|printf)((?:\s+-\w+)*)\s+("(?:[^"\\]|\\.)*"|'[^']*')/g, '$1$2 ""');
  const out = [];
  const seen = new Set();
  for (const m of code.matchAll(BARE_NOTE)) {
    const file = m[1];
    if (direct.has(file) || seen.has(file)) continue;
    seen.add(file);
    out.push({ project, file, inferred: true });
  }
  return out;
}

const clip = (s) => (typeof s === 'string' ? (s.length > CONTENT_CAP ? s.slice(0, CONTENT_CAP) : s) : undefined);

// A shell command writes a file when the path is a redirection/tee target, or when it runs an
// in-place editor on it. Anything else that merely mentions the path (cat, head, grep, ls) reads.
function bashOp(cmd, file) {
  const f = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`\\brm\\s+(-\\w+\\s+)*[^\\n;|&]*${f}`).test(cmd)) return 'delete';
  if (new RegExp(`(>>|\\btee\\s+-a\\s+)\\s*["']?[^\\s;|&]*${f}`).test(cmd)) return 'append';
  if (new RegExp(`(>|\\btee\\s+)\\s*["']?[^\\s;|&]*${f}`).test(cmd)) return 'write';
  if (new RegExp(`\\bsed\\s+-i[^\\n;|&]*${f}`).test(cmd)) return 'edit';
  if (new RegExp(`\\bmv\\s+[^\\n;|&]*${f}`).test(cmd)) return 'write';
  if (/\bpython3?\b|\bnode\b|\bperl\b/.test(cmd) && /write|open\(.*['"]w/.test(cmd)) return 'edit';
  return 'read';
}

// `cat > file <<'EOF' … EOF` (or tee) carries the full new content of the file.
function heredocBody(cmd, file) {
  const f = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = cmd.match(new RegExp(`(?:>|\\btee\\s+)\\s*["']?[^\\s;|&]*${f}["']?[^\\n]*?<<-?\\s*(['"]?)(\\w+)\\1[^\\n]*\\n([\\s\\S]*?)\\n\\2(?:\\n|$)`));
  return m ? m[3] : null;
}

/** Memory operations performed by one tool_use block. */
export function memoryOpsFromToolUse(block) {
  const input = block.input && typeof block.input === 'object' ? block.input : {};
  const name = block.name || '';
  const ops = [];
  if (name === 'Write' || name === 'Edit' || name === 'MultiEdit' || name === 'Read') {
    for (const p of memoryPaths(String(input.file_path || ''))) {
      const op = { ...p, op: name === 'Write' ? 'write' : name === 'Read' ? 'read' : 'edit', tool: name };
      if (name === 'Write') op.content = clip(input.content);
      if (name === 'Edit') op.edits = [{ old: clip(input.old_string) ?? '', new: clip(input.new_string) ?? '' }];
      if (name === 'MultiEdit' && Array.isArray(input.edits)) op.edits = input.edits.slice(0, 20).map((e) => ({ old: clip(e?.old_string) ?? '', new: clip(e?.new_string) ?? '' }));
      ops.push(op);
    }
  } else if (name === 'Bash' && typeof input.command === 'string') {
    for (const p of [...memoryPaths(input.command), ...inferredMemoryPaths(input.command)]) {
      const op = bashOp(input.command, p.file);
      const entry = { ...p, op, tool: 'Bash', command: clip(input.command) };
      if (op === 'write' || op === 'append') {
        const body = heredocBody(input.command, p.file);
        if (body != null) entry.content = clip(body);
      }
      ops.push(entry);
    }
  }
  return ops;
}

/** Memory files injected into the context by an attachment record (MEMORY.md at session start). */
export function memoryOpsFromAttachment(att) {
  if (!att || typeof att !== 'object') return [];
  const paths = [];
  if (att.type === 'instructions' && Array.isArray(att.files)) for (const f of att.files) paths.push(String(f?.path || ''));
  if (att.type === 'nested_memory') paths.push(String(att.path || att.content?.path || ''));
  const ops = [];
  for (const p of paths) for (const m of memoryPaths(p)) ops.push({ ...m, op: 'loaded', tool: null });
  return ops;
}
