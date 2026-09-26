// UI preferences persisted in localStorage (this origin is 127.0.0.1:<port>, local only).
import { useSyncExternalStore } from 'react';

export interface Settings {
  watch: boolean; // subscribe to live updates
  toolOutput: 'full' | 'truncated';
  timestamps: 'local' | 'relative';
  showMetadata: boolean; // show collapsed metadata/attachment rows in the timeline
  showThinking: boolean;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  showOutline: boolean; // turn-by-turn outline rail in the session viewer
  theme: 'system' | 'dark' | 'light';
  density: 'compact' | 'comfortable'; // compact: successful tool calls start collapsed to one row
  showAgents: boolean; // expanded sub-agent panel in the session header
  showTimeBar: boolean;
  compressIdle: boolean; // draw long waits for the user narrow in the time bar
}

const KEY = 'csv.settings.v1';
const DEFAULTS: Settings = {
  watch: true,
  toolOutput: 'truncated',
  timestamps: 'local',
  showMetadata: true,
  showThinking: true,
  sidebarWidth: 320,
  sidebarCollapsed: false,
  showOutline: false,
  theme: 'system',
  density: 'compact',
  showAgents: false,
  showTimeBar: true,
  compressIdle: true,
};

let current: Settings = load();
const listeners = new Set<() => void>();

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS };
}

export function getSettings() {
  return current;
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
  for (const l of listeners) l();
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const s = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
  return [s, updateSettings];
}
