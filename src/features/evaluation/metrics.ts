// One catalogue of evaluation metrics, so the report, the comparison and the dashboard agree
// on names, formats and which direction is better. Observed metrics are counted from the
// transcript; derived ones (scores) come from fixed rules and are marked `derived`.
import type { CompactAnalysis, Outcome, Severity } from '@/types/analysis';
import { formatCost, formatDuration, formatNumber } from '@/utils/format';

export type MetricGroup = 'outcome' | 'activity' | 'engineering' | 'efficiency' | 'resources' | 'scores';
export type Better = 'lower' | 'higher' | 'neutral';

export interface Metric {
  id: string;
  label: string;
  group: MetricGroup;
  better: Better;
  derived?: boolean;
  hint: string;
  get: (a: CompactAnalysis) => number | null;
  format: (v: number | null, a?: CompactAnalysis) => string;
}

const int = (v: number | null) => (v == null ? '—' : v.toLocaleString());
const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const ms = (v: number | null) => (v == null ? '—' : formatDuration(v) || '0s');
const num = (v: number | null) => (v == null ? '—' : formatNumber(v));
const ratio = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}:1`);
const score = (v: number | null) => (v == null ? 'n/a' : String(v));

export const METRICS: Metric[] = [
  // --- activity ---
  { id: 'toolCalls', label: 'Tool calls', group: 'activity', better: 'neutral', hint: 'Every tool_use block in the main and sub-agent transcripts.', get: (a) => a.activity.toolCalls, format: int },
  { id: 'toolErrors', label: 'Tool errors', group: 'activity', better: 'lower', hint: 'Tool results flagged is_error.', get: (a) => a.activity.toolErrors, format: int },
  { id: 'toolErrorRate', label: 'Tool error rate', group: 'activity', better: 'lower', hint: 'Tool errors ÷ tool calls.', get: (a) => a.activity.toolErrorRate, format: pct },
  { id: 'commands', label: 'Shell commands', group: 'activity', better: 'neutral', hint: 'Bash calls.', get: (a) => a.activity.commands.total, format: int },
  { id: 'prompts', label: 'User prompts', group: 'activity', better: 'neutral', hint: 'Human messages in the main transcript.', get: (a) => a.task.prompts, format: int },
  { id: 'apiErrors', label: 'API errors', group: 'activity', better: 'lower', hint: 'Model API errors (infrastructure, not agent behaviour).', get: (a) => a.activity.apiErrors, format: int },
  { id: 'interruptions', label: 'Interruptions', group: 'activity', better: 'lower', hint: 'Times the user interrupted the agent.', get: (a) => a.activity.interruptions, format: int },
  { id: 'agents', label: 'Sub-agents', group: 'activity', better: 'neutral', hint: 'Sub-agent transcripts spawned.', get: (a) => a.activity.agents.count, format: int },
  // --- engineering ---
  { id: 'filesChanged', label: 'Files changed', group: 'engineering', better: 'neutral', hint: 'Distinct files written or edited successfully (Edit/Write/MultiEdit/NotebookEdit).', get: (a) => a.activity.files.changed, format: int },
  { id: 'filesRead', label: 'Files read', group: 'engineering', better: 'neutral', hint: 'Distinct files read with the Read tool.', get: (a) => a.activity.files.read, format: int },
  { id: 'edits', label: 'Edits', group: 'engineering', better: 'neutral', hint: 'Successful edit-tool calls plus shell commands that change files.', get: (a) => a.activity.edits, format: int },
  { id: 'linesAdded', label: 'Lines added', group: 'engineering', better: 'neutral', hint: 'From the recorded patches of successful edits and writes.', get: (a) => a.activity.files.linesAdded, format: int },
  { id: 'linesRemoved', label: 'Lines removed', group: 'engineering', better: 'neutral', hint: 'From the recorded patches of successful edits.', get: (a) => a.activity.files.linesRemoved, format: int },
  { id: 'testRuns', label: 'Test runs', group: 'engineering', better: 'neutral', hint: 'Shell commands recognised as a test runner.', get: (a) => a.activity.tests.runs, format: int },
  { id: 'testFailures', label: 'Failed test runs', group: 'engineering', better: 'lower', hint: 'Test runs that errored or reported failures.', get: (a) => a.activity.tests.failed, format: int },
  { id: 'buildRuns', label: 'Build / check runs', group: 'engineering', better: 'neutral', hint: 'Build, lint and typecheck commands.', get: (a) => a.activity.builds.runs, format: int },
  { id: 'commits', label: 'Commits', group: 'engineering', better: 'neutral', hint: 'Successful git commit commands.', get: (a) => a.activity.commands.git.commits, format: int },
  // --- efficiency (observed) ---
  { id: 'redundantReads', label: 'Redundant reads', group: 'efficiency', better: 'lower', hint: 'Same file range read again with no change to the file in between (within one context).', get: (a) => a.behavior.redundantReads, format: int },
  { id: 'repeatedCommands', label: 'Repeated commands', group: 'efficiency', better: 'lower', hint: 'Identical command re-run after it already succeeded, with nothing changed in between.', get: (a) => a.behavior.repeatedCommands, format: int },
  { id: 'identicalRetries', label: 'Retries without change', group: 'efficiency', better: 'lower', hint: 'A failed call re-issued with exactly the same input and nothing changed in between.', get: (a) => a.behavior.identicalRetries, format: int },
  { id: 'fixLoops', label: 'Fix loops', group: 'efficiency', better: 'neutral', hint: 'Fail → change something → try again sequences (expected when fixing tests).', get: (a) => a.behavior.fixLoops, format: int },
  { id: 'unresolvedChains', label: 'Unresolved failures', group: 'efficiency', better: 'lower', hint: 'Targets that kept failing and never succeeded afterwards.', get: (a) => a.behavior.unresolvedChains, format: int },
  { id: 'redundancyShare', label: 'Redundant share', group: 'efficiency', better: 'lower', hint: '(redundant reads + repeated commands + retries without change) ÷ tool calls.', get: (a) => a.behavior.redundancyShare, format: pct },
  { id: 'explorationRatio', label: 'Exploration ratio', group: 'efficiency', better: 'neutral', hint: 'Reads, searches and inspection commands per change. n/a when nothing was changed.', get: (a) => a.behavior.explorationRatio, format: ratio },
  { id: 'editThrashFiles', label: 'Thrashed files', group: 'efficiency', better: 'lower', hint: 'Files edited 5 or more times.', get: (a) => a.behavior.editThrashFiles, format: int },
  { id: 'editMisses', label: 'Edit misses', group: 'efficiency', better: 'lower', hint: 'Edit calls whose target text was not found (stale view of the file).', get: (a) => a.behavior.editMisses, format: int },
  { id: 'largeReads', label: 'Large reads', group: 'efficiency', better: 'lower', hint: 'Read results over 40k characters.', get: (a) => a.behavior.largeReads, format: int },
  // --- resources ---
  { id: 'wall', label: 'Wall clock', group: 'resources', better: 'neutral', hint: 'First to last record in the transcript (includes waiting for the user and resume gaps).', get: (a) => a.activity.timing.wallMs, format: ms },
  { id: 'active', label: 'Active time', group: 'resources', better: 'lower', hint: 'Model time + tool time + waiting on background tasks.', get: (a) => a.activity.timing.activeMs, format: ms },
  { id: 'modelMs', label: 'Model time', group: 'resources', better: 'neutral', hint: 'Gaps before assistant records: the model generating.', get: (a) => a.activity.timing.modelMs, format: ms },
  { id: 'toolMs', label: 'Tool time', group: 'resources', better: 'neutral', hint: 'Gaps before tool results: tools running (sub-agents run inside this).', get: (a) => a.activity.timing.toolMs + a.activity.timing.backgroundMs, format: ms },
  { id: 'tokensIn', label: 'Input tokens', group: 'resources', better: 'lower', hint: 'Uncached + cache read + cache write, main and sub-agents.', get: (a) => a.activity.tokens.totalIn, format: num },
  { id: 'tokensOut', label: 'Output tokens', group: 'resources', better: 'lower', hint: 'Generated tokens, main and sub-agents.', get: (a) => a.activity.tokens.totalOut, format: num },
  { id: 'cacheHit', label: 'Cache hit rate', group: 'resources', better: 'higher', hint: 'Cache-read tokens ÷ all input tokens.', get: (a) => a.activity.tokens.cacheHitRate, format: pct },
  { id: 'tokensPerCall', label: 'Tokens per tool call', group: 'resources', better: 'lower', hint: 'All tokens ÷ tool calls: how heavy each step was.', get: (a) => a.activity.tokens.perToolCall, format: num },
  { id: 'cost', label: 'Cost', group: 'resources', better: 'lower', hint: 'Recorded by Claude Code, or estimated from tokens × rate table (marked ≈).', get: (a) => a.activity.cost?.usd ?? null, format: (v, a) => (v == null ? '—' : `${a?.activity.cost?.estimated ? '≈' : ''}${formatCost(v)}`) },
  { id: 'costPerFile', label: 'Cost per changed file', group: 'resources', better: 'lower', hint: 'Cost ÷ files changed.', get: (a) => a.activity.cost?.perChangedFile ?? null, format: (v, a) => (v == null ? '—' : `${a?.activity.cost?.estimated ? '≈' : ''}${formatCost(v)}`) },
  // --- derived scores ---
  { id: 'overall', label: 'Overall score', group: 'scores', better: 'higher', derived: true, hint: '0.4·reliability + 0.35·efficiency + 0.25·verification.', get: (a) => a.scores.overall.value, format: score },
  { id: 'reliability', label: 'Reliability', group: 'scores', better: 'higher', derived: true, hint: '100 minus penalties for tool/API errors, unresolved failures, failing checks, interruptions.', get: (a) => a.scores.reliability.value, format: score },
  { id: 'efficiency', label: 'Efficiency', group: 'scores', better: 'higher', derived: true, hint: '100 minus penalties for redundancy, thrash, over-exploration, large reads.', get: (a) => a.scores.efficiency.value, format: score },
  { id: 'verification', label: 'Verification', group: 'scores', better: 'higher', derived: true, hint: 'Whether changes were checked by tests/builds and whether the last check passed. n/a when nothing changed.', get: (a) => a.scores.verification?.value ?? null, format: score },
];

export const METRIC_BY_ID = new Map(METRICS.map((m) => [m.id, m]));

export const GROUP_LABEL: Record<MetricGroup, string> = {
  outcome: 'Outcome',
  activity: 'Activity',
  engineering: 'Engineering',
  efficiency: 'Behaviour',
  resources: 'Time, tokens & cost',
  scores: 'Derived scores',
};

export const OUTCOME_LABEL: Record<Outcome, string> = {
  completed: 'Completed',
  interrupted: 'Interrupted',
  errored: 'Ended on error',
  incomplete: 'Stopped mid-work',
  unanswered: 'Unanswered',
  'in-progress': 'In progress',
  'no-task': 'No task',
  unknown: 'Unknown',
};

export const OUTCOME_TONE: Record<Outcome, 'ok' | 'warn' | 'error' | 'muted' | 'live'> = {
  completed: 'ok',
  interrupted: 'warn',
  errored: 'error',
  incomplete: 'warn',
  unanswered: 'muted',
  'in-progress': 'live',
  'no-task': 'muted',
  unknown: 'muted',
};

export const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };

/** Whether a change from `a` to `b` is an improvement for this metric (null when neutral or unknown). */
export function improvement(m: Metric, a: number | null, b: number | null): boolean | null {
  if (a == null || b == null || a === b || m.better === 'neutral') return null;
  return m.better === 'lower' ? b < a : b > a;
}

/** Relative change b vs a as a signed percentage string, or an absolute delta for tiny bases. */
export function deltaLabel(m: Metric, a: number | null, b: number | null): string {
  if (a == null || b == null) return '';
  const d = b - a;
  if (d === 0) return 'same';
  if (m.id === 'toolErrorRate' || m.id === 'redundancyShare' || m.id === 'cacheHit') return `${d > 0 ? '+' : ''}${Math.round(d * 100)} pts`;
  if (m.group === 'scores') return `${d > 0 ? '+' : ''}${d}`;
  if (Math.abs(a) < 1e-9) return `${d > 0 ? '+' : ''}${m.format(d)}`;
  const rel = (d / Math.abs(a)) * 100;
  if (Math.abs(rel) >= 1000) return `${rel > 0 ? '+' : ''}${(rel / 100).toFixed(0)}×`;
  return `${rel > 0 ? '+' : ''}${Math.abs(rel) < 10 ? rel.toFixed(1) : Math.round(rel)}%`;
}

/** Median of a numeric list (null-safe). */
export function median(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

export function gradeTone(g: 'strong' | 'good' | 'fair' | 'weak'): 'ok' | 'warn' | 'error' | 'muted' {
  return g === 'strong' || g === 'good' ? 'ok' : g === 'fair' ? 'warn' : 'error';
}
