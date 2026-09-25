// Locates Claude Code's data directory. Claude Code stores session transcripts as
// JSONL files under <configDir>/projects/<encoded-cwd>/<session-uuid>.jsonl.
// The config directory defaults to ~/.claude and can be overridden with CLAUDE_CONFIG_DIR.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

function exists(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Candidate Claude config directories in priority order for the current OS. */
export function candidateClaudeDirs() {
  const home = os.homedir();
  const out = [];
  const push = (p, source) => {
    if (p && !out.some((c) => c.path === p)) out.push({ path: p, source });
  };
  if (process.env.CLAUDE_CONFIG_DIR) push(path.resolve(process.env.CLAUDE_CONFIG_DIR), 'CLAUDE_CONFIG_DIR');
  push(path.join(home, '.claude'), 'default');
  if (process.platform === 'win32') {
    if (process.env.USERPROFILE) push(path.join(process.env.USERPROFILE, '.claude'), 'USERPROFILE');
    if (process.env.APPDATA) push(path.join(process.env.APPDATA, 'claude'), 'APPDATA');
  } else {
    const xdg = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
    push(path.join(xdg, 'claude'), 'XDG_CONFIG_HOME');
  }
  return out;
}

/**
 * Given a user-supplied or candidate directory, work out where the `projects` folder is.
 * Accepts either the config dir (~/.claude) or the projects dir itself.
 */
export function resolveProjectsDir(dir) {
  if (!dir) return null;
  const abs = path.resolve(dir);
  if (!exists(abs)) return { ok: false, reason: 'Directory does not exist', path: abs };
  if (path.basename(abs) === 'projects') {
    return { ok: true, claudeDir: path.dirname(abs), projectsDir: abs };
  }
  const projects = path.join(abs, 'projects');
  if (exists(projects)) return { ok: true, claudeDir: abs, projectsDir: projects };
  return { ok: false, reason: 'No "projects" folder found inside this directory', path: abs };
}

/** Full discovery report: every candidate, whether it exists, and which one was chosen. */
export function discoverClaudeDir(explicitDir) {
  const candidates = candidateClaudeDirs().map((c) => {
    const r = resolveProjectsDir(c.path);
    return { ...c, exists: exists(c.path), usable: !!(r && r.ok), reason: r && !r.ok ? r.reason : undefined };
  });
  if (explicitDir) {
    const r = resolveProjectsDir(explicitDir);
    return { candidates, explicit: { path: path.resolve(explicitDir), ...r }, chosen: r && r.ok ? r : null };
  }
  for (const c of candidates) {
    const r = resolveProjectsDir(c.path);
    if (r && r.ok) return { candidates, chosen: r };
  }
  return { candidates, chosen: null };
}
