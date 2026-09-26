// On-disk cache of per-file summary state so restarts do not re-parse ~100MB of
// transcripts. Keyed by absolute path; invalidated by size/mtime; resumable by offset.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { APP_HOME, readJsonSafe, writeJsonAtomic } from '../paths.js';

const CACHE_VERSION = 12;

export class SummaryCache {
  constructor(dir = path.join(APP_HOME, 'cache')) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }
  keyFor(file) {
    return crypto.createHash('sha1').update(file).digest('hex').slice(0, 20);
  }
  fileFor(file) {
    return path.join(this.dir, `${this.keyFor(file)}.json`);
  }
  get(file) {
    const v = readJsonSafe(this.fileFor(file));
    if (!v || v.v !== CACHE_VERSION || v.file !== file) return null;
    return v;
  }
  set(file, entry) {
    try {
      writeJsonAtomic(this.fileFor(file), { v: CACHE_VERSION, file, ...entry });
    } catch {
      /* cache is best-effort */
    }
  }
  clear() {
    for (const f of fs.readdirSync(this.dir)) {
      if (f.endsWith('.json')) fs.rmSync(path.join(this.dir, f), { force: true });
    }
  }
}
