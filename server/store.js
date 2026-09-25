// Small local metadata store: custom session names and server-side settings.
// Lives in ~/.claude-session-viewer; never touches Claude's own files.
import path from 'node:path';
import { APP_HOME, readJsonSafe, writeJsonAtomic } from './paths.js';

export const MAX_NAME_LENGTH = 120;

export class MetadataStore {
  constructor(dir = APP_HOME) {
    this.metaFile = path.join(dir, 'metadata.json');
    this.settingsFile = path.join(dir, 'settings.json');
    this.meta = readJsonSafe(this.metaFile, { version: 1, sessions: {} });
    if (!this.meta.sessions) this.meta.sessions = {};
    this.settings = readJsonSafe(this.settingsFile, { version: 1 });
  }
  getCustomName(sessionId) {
    return this.meta.sessions[sessionId]?.customName ?? null;
  }
  allCustomNames() {
    const out = {};
    for (const [id, m] of Object.entries(this.meta.sessions)) if (m?.customName) out[id] = m.customName;
    return out;
  }
  setCustomName(sessionId, name) {
    const trimmed = String(name ?? '').trim();
    if (!trimmed) throw new Error('Name cannot be empty');
    if (trimmed.length > MAX_NAME_LENGTH) throw new Error(`Name is longer than ${MAX_NAME_LENGTH} characters`);
    this.meta.sessions[sessionId] = { sessionId, customName: trimmed, updatedAt: new Date().toISOString() };
    writeJsonAtomic(this.metaFile, this.meta);
    return this.meta.sessions[sessionId];
  }
  clearCustomName(sessionId) {
    if (this.meta.sessions[sessionId]) {
      delete this.meta.sessions[sessionId];
      writeJsonAtomic(this.metaFile, this.meta);
    }
  }
  getSettings() {
    return { dataDir: this.settings.dataDir ?? null, rates: this.settings.rates && typeof this.settings.rates === 'object' ? this.settings.rates : {} };
  }
  setSettings(patch) {
    this.settings = { ...this.settings, ...patch };
    writeJsonAtomic(this.settingsFile, this.settings);
    return this.getSettings();
  }
}
