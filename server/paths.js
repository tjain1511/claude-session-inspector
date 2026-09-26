// Filesystem locations used by the viewer. Nothing here touches the network.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const APP_HOME =
  process.env.CLAUDE_SESSION_INSPECTOR_HOME || path.join(os.homedir(), '.claude-session-inspector');

// Home used before the rename to claude-session-inspector; its names and settings are carried over once.
const LEGACY_HOME = path.join(os.homedir(), '.claude-session-viewer');

export function ensureAppHome() {
  if (!process.env.CLAUDE_SESSION_INSPECTOR_HOME && !fs.existsSync(APP_HOME) && fs.existsSync(LEGACY_HOME)) {
    try {
      fs.renameSync(LEGACY_HOME, APP_HOME);
    } catch {
      // Leave the old folder alone and start fresh rather than fail to launch.
    }
  }
  fs.mkdirSync(path.join(APP_HOME, 'cache'), { recursive: true });
  return APP_HOME;
}

/** Replace the home directory prefix with `~` for display. */
export function tildify(p) {
  if (!p) return p;
  const home = os.homedir();
  if (p === home) return '~';
  if (p.startsWith(home + path.sep)) return '~' + p.slice(home.length);
  return p;
}

/** Claude Code encodes the working directory as a project folder name by replacing path separators with '-'. */
export function decodeProjectDirName(name) {
  // The encoding is lossy (a '-' inside a path segment is indistinguishable from a separator),
  // so callers should prefer the `cwd` recorded inside the session file when present.
  if (name.startsWith('-')) return '/' + name.slice(1).replace(/-/g, '/');
  return name.replace(/-/g, '/');
}

export function isUuid(s) {
  return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

export function isAgentId(s) {
  return typeof s === 'string' && /^agent-[0-9a-z]{1,64}$/i.test(s);
}

/** Atomic JSON write: write to a temp file then rename over the target. */
export function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

export function readJsonSafe(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
