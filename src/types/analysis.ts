// Shape of the deterministic session analysis produced by server/session-source/analyze.js.
// Everything under `activity` and `behavior` is observed (counted from transcript records);
// `scores` is derived from fixed rules and is labelled as such wherever it is shown.

export type Outcome = 'completed' | 'interrupted' | 'errored' | 'incomplete' | 'unanswered' | 'in-progress' | 'no-task' | 'unknown';
export type Severity = 'high' | 'medium' | 'low' | 'info';
export type CommandCategory = 'test' | 'build' | 'lint' | 'git' | 'install' | 'run' | 'inspect' | 'other';

/** Points at a tool call event (id as the normalizer names it); agent events jump to their Agent call. */
export interface EventRef {
  id: string | null;
  agentId?: string;
}

export interface Problem {
  kind: string;
  severity: Severity;
  title: string;
  detail: string;
  count: number;
  refs: EventRef[];
}

export interface Recommendation {
  kind: string;
  severity: Severity;
  title: string;
  detail: string;
}

export interface ScoreFactor {
  label: string;
  delta: number;
}

export type Grade = 'strong' | 'good' | 'fair' | 'weak';

export interface Score {
  value: number;
  grade: Grade;
  factors: ScoreFactor[];
}

export interface Scores {
  derived: true;
  method: string;
  overall: { value: number; grade: Grade };
  reliability: Score;
  efficiency: Score;
  verification: Score | null;
}

export interface Timing {
  wallMs: number | null;
  modelMs: number;
  toolMs: number;
  backgroundMs: number;
  userMs: number;
  otherMs: number;
  activeMs: number;
  toolCallMs: number;
  slowestCall: { tool: string; target: string; durationMs: number; ref: EventRef } | null;
  recorded: { totalDuration: number | null; totalAPIDuration: number | null; totalToolDuration: number | null } | null;
}

export interface Tokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
  thinking: number;
  totalIn: number;
  totalOut: number;
  cacheHitRate: number | null;
  perToolCall: number | null;
}

export interface Activity {
  toolCalls: number;
  toolCallsMain: number;
  toolErrors: number;
  toolErrorRate: number;
  pending: number;
  denied: number;
  interrupted: number;
  byTool: Record<string, { calls: number; errors: number; ms: number }>;
  commands: {
    total: number;
    failed: number;
    unique: number;
    byCategory: Record<CommandCategory, number>;
    mutating: number;
    timedOut: number;
    git: { commits: number; pushes: number };
  };
  files: {
    read: number;
    changed: number;
    created: number;
    linesAdded: number;
    linesRemoved: number;
    readList?: { path: string; count: number; agent: number }[];
    changedList?: { path: string; edits: number; added: number; removed: number; agent: number; created: boolean }[];
  };
  tests: { runs: number; passed: number; failed: number; unknown: number; last: 'passed' | 'failed' | 'unknown' | null; casesPassed: number; casesFailed: number };
  builds: { runs: number; failed: number; last: 'passed' | 'failed' | null };
  edits: number;
  exploration: number;
  messages: { user: number; assistant: number; thinking: number };
  apiErrors: number;
  apiRetries: number;
  interruptions: number;
  agents: { count: number; calls: number; toolCalls: number; errors: number; withErrors: number; byType: Record<string, number>; tokens: number };
  timing: Timing;
  tokens: Tokens;
  cost: { usd: number; estimated: boolean; complete: boolean; perChangedFile: number | null } | null;
}

export interface RetryChain {
  tool: string;
  target: string;
  attempts: number;
  identical: number;
  resolved: boolean;
  fixLoop: boolean;
  refs: EventRef[];
  agentId: string | null;
}

export interface Behavior {
  redundantReads: number;
  redundantReadFiles?: { path: string; count: number; refs: EventRef[] }[];
  repeatedCommands: number;
  repeatedCommandList?: { command: string; category: string; count: number; refs: EventRef[] }[];
  retryChains: number;
  fixLoops: number;
  identicalRetries: number;
  unresolvedChains: number;
  chains?: RetryChain[];
  redundantCalls: number;
  redundancyShare: number;
  editThrashFiles: number;
  thrash?: { path: string; edits: number; refs: EventRef[] }[];
  editMisses: number;
  explorationRatio: number | null;
  largeReads: number;
  unknownTools: number;
  editsAfterLastCheck: boolean;
  maxEditsOneFile: number;
}

export interface TurnMetrics {
  idx: number;
  id: string;
  prompt: string;
  start: number;
  end: number;
  durationMs: number;
  toolCalls: number;
  errors: number;
  edits: number;
  testRuns: number;
  testFailures: number;
  redundant: number;
  modelMs: number;
  toolMs: number;
  agents: number;
  tokensOut: number;
  apiErrors: number;
}

export interface SessionAnalysis {
  id: string;
  version: number;
  computedAt: string;
  live: boolean;
  task: {
    prompt: string | null;
    title: string | null;
    prompts: number;
    finalResponse: string | null;
    outcome: Outcome;
    prLinks: { url: string; number?: number }[];
    continuedIn: string | null;
    gitBranch: string | null;
  };
  activity: Activity;
  behavior: Behavior;
  turns: TurnMetrics[];
  problems: Problem[];
  recommendations: Recommendation[];
  scores: Scores;
}

/** What /api/analysis returns per session: the same numbers without event refs, lists or turns. */
export interface CompactAnalysis {
  id: string;
  version: number;
  computedAt: string;
  live: boolean;
  task: { title: string | null; prompts: number; outcome: Outcome };
  activity: Activity;
  behavior: Behavior;
  problems: { kind: string; severity: Severity; title: string; count: number }[];
  scores: Scores;
}

export interface AnalysesPayload {
  analyses: CompactAnalysis[];
  failed: { id: string; message: string }[];
  computed: number;
  status: string;
}
