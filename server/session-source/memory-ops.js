// Detects reads and writes of Claude Code's memory files inside transcript records.
// Project auto-memory lives at <claudeDir>/projects/<encoded-cwd>/memory/*.md (MEMORY.md is the index);
// global (user-level) memory is <claudeDir>/CLAUDE.md plus <claudeDir>/rules/**/*.md, loaded in every project.
// Only what the record shows is reported: the tool, the path and, for writes, the content.
import os from 'node:os';
import path from 'node:path';

/** Project key used for the user-level memory files, which belong to no single project. */
export const GLOBAL_MEMORY = '~global';

// Encoded project folder names and note files are plain [\w.-]; this skips globs and placeholders.
const MEMORY_PATH = /\/projects\/([\w.-]+)\/memory\/([\w.-]+\.md)(?![\w.*-])/g;
const CONTENT_CAP = 16 * 1024;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let globalPath = null;

/** Point global-memory detection at a config dir (defaults to CLAUDE_CONFIG_DIR or ~/.claude). */
export function setGlobalMemoryDir(dir) {
  const abs = path.resolve(dir);
  const roots = [esc(abs)];
  if (abs === path.join(os.homedir(), '.claude')) roots.push('~/\\.claude', '\\$HOME/\\.claude', '\\$\\{HOME\\}/\\.claude');
  // Anchored so a repo's own `.claude/CLAUDE.md` or `.claude/rules/` is not taken for the user's.
  globalPath = new RegExp(`(?:^|[\\s"'=(:])(?:${roots.join('|')})/(CLAUDE\\.md|rules/[\\w./-]+\\.md)(?![\\w.*-])`, 'g');
}
setGlobalMemoryDir(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));

/** All distinct memory files a string mentions: [{project, file}] */
export function memoryPaths(s) {
  if (typeof s !== 'string') return [];
  const out = [];
  const seen = new Set();
  const add = (project, file) => {
    const k = `${project}/${file}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ project, file });
  };
  if (s.includes('/memory/')) for (const m of s.matchAll(MEMORY_PATH)) add(m[1], m[2]);
  if (s.includes('.claude/')) for (const m of s.matchAll(globalPath)) if (!m[1].includes('..')) add(GLOBAL_MEMORY, m[1]);
  return out;
}

/**
 * A command with the data it carries blanked out: heredoc bodies (keeping the `cat > f <<EOF` line
 * itself; only `cat`/`tee` ones unless `allHeredocs`, since a script's body is code) and `echo`/`printf` strings. Text there — an index line, a script's string literal — is
 * content being written somewhere, not a file the command touches.
 */
function shellCode(cmd, allHeredocs = false) {
  const heredoc = allHeredocs ? /(<<-?\s*(['"]?)(\w+)\2[^\n]*\n)[\s\S]*?\n\3(?=\n|$)/g : /(\b(?:cat|tee)\b[^\n]*<<-?\s*(['"]?)(\w+)\2[^\n]*\n)[\s\S]*?\n\3(?=\n|$)/g;
  return cmd
    .replace(heredoc, '$1')
    .replace(/\b(echo|printf)((?:\s+-\w+)*)\s+("(?:[^"\\]|\\.)*"|'[^']*')/g, '$1$2 ""');
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
  const code = shellCode(cmd);
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
function bashOp(cmd, file, scripts = true) {
  const f = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`\\brm\\s+(-\\w+\\s+)*[^\\n;|&]*${f}`).test(cmd)) return 'delete';
  if (new RegExp(`(>>|\\btee\\s+-a\\s+)\\s*["']?[^\\s;|&]*${f}`).test(cmd)) return 'append';
  if (new RegExp(`(>|\\btee\\s+)\\s*["']?[^\\s;|&]*${f}`).test(cmd)) return 'write';
  if (new RegExp(`\\bsed\\s+-i[^\\n;|&]*${f}`).test(cmd)) return 'edit';
  if (new RegExp(`\\bmv\\s+[^\\n;|&]*${f}`).test(cmd)) return 'write';
  if (scripts && /\bpython3?\b|\bnode\b|\bperl\b/.test(cmd) && /write|open\(.*['"]w/.test(cmd)) return 'edit';
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
    // Global paths are counted only where the shell itself uses them: a script or heredoc that merely
    // mentions ~/.claude/CLAUDE.md (as this viewer's own sources do) neither reads nor writes it.
    const code = shellCode(input.command, true);
    const global = new Set(memoryPaths(code).filter((p) => p.project === GLOBAL_MEMORY).map((p) => p.file));
    const found = [...memoryPaths(input.command), ...inferredMemoryPaths(input.command)].filter((p) => p.project !== GLOBAL_MEMORY || global.has(p.file));
    for (const p of found) {
      const isGlobal = p.project === GLOBAL_MEMORY;
      // `CLAUDE.md` alone would also match a repo's own file in the same command.
      const needle = isGlobal ? `.claude/${p.file}` : p.file;
      const op = bashOp(isGlobal ? code : input.command, needle, !isGlobal);
      const entry = { ...p, op, tool: 'Bash', command: clip(input.command) };
      if (op === 'write' || op === 'append') {
        const body = heredocBody(input.command, needle);
        if (body != null) entry.content = clip(body);
      }
      ops.push(entry);
    }
  }
  return ops;
}

/** Memory files injected into the context by an attachment record (MEMORY.md, ~/.claude/CLAUDE.md at session start). */
export function memoryOpsFromAttachment(att) {
  if (!att || typeof att !== 'object') return [];
  const paths = [];
  if (att.type === 'instructions' && Array.isArray(att.files)) for (const f of att.files) paths.push(String(f?.path || ''));
  if (att.type === 'nested_memory') paths.push(String(att.path || att.content?.path || ''));
  const ops = [];
  for (const p of paths) for (const m of memoryPaths(p)) ops.push({ ...m, op: 'loaded', tool: null });
  return ops;
}
