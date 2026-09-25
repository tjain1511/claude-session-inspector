import type { SessionSummary } from '@/types/session';

export type TimeRange = 'all' | 'today' | 'yesterday' | '7d' | '30d' | 'custom';
export type Activity = 'tools' | 'errors' | 'long' | 'active' | 'subagents' | 'renamed';

export interface Filters {
  time: TimeRange;
  customFrom?: string; // yyyy-mm-dd
  customTo?: string;
  project: string; // '' = all; project.raw
  model: string; // '' = all
  activity: Activity[];
}

export const DEFAULT_FILTERS: Filters = { time: 'all', project: '', model: '', activity: [] };

export function isDefaultFilters(f: Filters) {
  return f.time === 'all' && !f.project && !f.model && f.activity.length === 0;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

export function timeBounds(f: Filters, now = new Date()): [number, number] | null {
  const today = startOfDay(now);
  const day = 86_400_000;
  switch (f.time) {
    case 'today':
      return [today, Infinity];
    case 'yesterday':
      return [today - day, today];
    case '7d':
      return [today - 6 * day, Infinity];
    case '30d':
      return [today - 29 * day, Infinity];
    case 'custom': {
      const from = f.customFrom ? startOfDay(new Date(f.customFrom + 'T00:00:00')) : -Infinity;
      const to = f.customTo ? startOfDay(new Date(f.customTo + 'T00:00:00')) + day : Infinity;
      return [from, to];
    }
    default:
      return null;
  }
}

export function matchesFilters(s: SessionSummary, f: Filters, now = new Date()): boolean {
  const b = timeBounds(f, now);
  if (b) {
    const t = Date.parse(s.endedAt || s.startedAt || '');
    if (!Number.isFinite(t) || t < b[0] || t >= b[1]) return false;
  }
  if (f.project && s.project.raw !== f.project) return false;
  if (f.model && !s.models.some((m) => m.name === f.model)) return false;
  for (const a of f.activity) {
    if (a === 'tools' && s.counts.toolCalls === 0) return false;
    if (a === 'errors' && s.counts.errors === 0) return false;
    if (a === 'long' && (s.durationMs ?? 0) < 30 * 60_000 && s.counts.messages < 60) return false;
    if (a === 'active' && !s.live && !s.recentlyActive) return false;
    if (a === 'subagents' && s.subagents.length === 0 && s.inFileAgentIds.length === 0) return false;
    if (a === 'renamed' && !s.customName) return false;
  }
  return true;
}

/** Instant, local text match on the fields we have in the summary. The server does the deep content search. */
export function matchesLocalQuery(s: SessionSummary, q: string): boolean {
  if (!q) return true;
  const hay = `${s.title}\n${s.customName || ''}\n${s.generatedTitle || ''}\n${s.firstPrompt || ''}\n${s.lastPrompt || ''}\n${s.project.path}\n${s.project.raw}\n${s.model || ''}\n${s.gitBranch || ''}\n${s.id}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => hay.includes(t));
}

export type DateGroup = 'Today' | 'Yesterday' | 'This week' | 'This month' | 'Earlier';

export function dateGroup(iso: string | null, now = new Date()): DateGroup {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return 'Earlier';
  const today = startOfDay(now);
  const day = 86_400_000;
  if (t >= today) return 'Today';
  if (t >= today - day) return 'Yesterday';
  if (t >= today - 6 * day) return 'This week';
  if (t >= today - 29 * day) return 'This month';
  return 'Earlier';
}
