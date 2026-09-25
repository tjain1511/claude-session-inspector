// Normalized model shared between the server (plain JS) and the UI. Keep in sync with
// server/session-source/normalize.js and summarize.js.

export type EventType =
  | 'user'
  | 'assistant'
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'error'
  | 'system'
  | 'metadata'
  | 'attachment'
  | 'unknown';

export interface RawRef {
  file: string; // 'main' or agent id
  line: number;
  offset: number;
  length: number;
}

export interface Usage {
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheCreate: number | null;
  thinking: number | null;
  serviceTier?: string | null;
  speed?: string | null;
}

export interface SessionEvent {
  id: string;
  type: EventType;
  ts: string | null;
  parentId?: string | null;
  sidechain?: boolean;
  agentId?: string | null;
  ref: RawRef;
  block?: number; // index into message.content for block-derived events
  // text-ish
  content?: string;
  truncated?: boolean;
  fullLength?: number;
  // user
  kind?: string;
  command?: { name: string; args: string; message: string };
  images?: number;
  imageBlocks?: number[];
  permissionMode?: string;
  entrypoint?: string;
  origin?: string;
  originFrom?: string | null;
  // assistant / thinking / tool_call
  model?: string | null;
  messageId?: string | null;
  requestId?: string | null;
  stopReason?: string | null;
  usage?: Usage | null;
  effort?: unknown;
  synthetic?: boolean;
  redacted?: boolean;
  empty?: boolean;
  // tool_call
  toolUseId?: string;
  tool?: string;
  input?: unknown;
  inputTruncated?: boolean;
  caller?: string | null;
  // tool_result
  status?: 'success' | 'error';
  isError?: boolean;
  interrupted?: boolean;
  denied?: string;
  structured?: unknown;
  sourceAssistantId?: string | null;
  // system / error / metadata
  subtype?: string;
  level?: string;
  durationMs?: number | null;
  messageCount?: number | null;
  retry?: { attempt: number; max: number; inMs: number } | null;
  // attachment
  attachmentType?: string;
  preview?: string;
  rendered?: number;
  // unknown
  label?: string;
}

export interface SubagentSummary {
  agentId: string;
  agentType: string | null;
  description: string | null;
  toolUseId: string | null;
  spawnDepth: number | null;
  counts: SessionCounts | null;
  startedAt: string | null;
  endedAt: string | null;
  model: string | null;
  prompt: string | null;
  usage: { input: number; output: number; cacheRead: number; cacheCreate: number; thinking: number } | null;
  sizeBytes: number;
  error: string | null;
}

export interface SessionCounts {
  userMessages: number;
  assistantMessages: number;
  messages: number;
  toolCalls: number;
  toolErrors: number;
  apiErrors: number;
  errors: number;
  interruptions: number;
  thinkingBlocks: number;
  attachments: number;
  records: number;
}

export interface SessionSummary {
  id: string;
  title: string;
  customName: string | null;
  generatedTitle: string | null;
  titleSource: 'claude-custom' | 'ai' | 'first-prompt' | 'none';
  firstPrompt: string | null;
  lastPrompt: string | null;
  cwd: string | null;
  gitBranch: string | null;
  version: string | null;
  entrypoint: string | null;
  slug: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  model: string | null;
  models: { name: string; count: number }[];
  tools: { name: string; count: number }[];
  counts: SessionCounts;
  usage: { input: number; output: number; cacheRead: number; cacheCreate: number; thinking: number };
  cost: {
    totalCostUSD?: number;
    totalDuration?: number;
    totalAPIDuration?: number;
    totalToolDuration?: number;
    totalLinesAdded?: number;
    totalLinesRemoved?: number;
    startTime?: number;
    modelUsage?: Record<string, Record<string, number>>;
    hasUnknownModelCost?: boolean;
  } | null;
  continuedIn: string | null;
  prLinks: { url: string; number?: number; repository?: string }[];
  permissionModes: string[];
  hasImages: boolean;
  inFileAgentIds: string[];
  project: { name: string; path: string; raw: string; dirName: string };
  file: { path: string; sizeBytes: number; mtime: string | null; partialWrite: boolean };
  parseErrors: number;
  loadError: string | null;
  live: { pid: number; status: string | null; updatedAt: number | null } | null;
  recentlyActive: boolean;
  subagents: SubagentSummary[];
}

export interface SessionRead {
  id: string;
  events: SessionEvent[];
  errors: { line: number; message: string }[];
  offset: number;
  line: number;
  size: number;
  partial: boolean;
  restarted?: boolean;
  summary: SessionSummary;
}

export interface SubagentRead {
  id: string;
  agentId: string;
  meta: { agentType?: string; description?: string; toolUseId?: string } | null;
  events: SessionEvent[];
  errors: { line: number; message: string }[];
  offset: number;
  line: number;
  size: number;
  partial: boolean;
}

export interface DiscoveryCandidate {
  path: string;
  source: string;
  exists: boolean;
  usable: boolean;
  reason?: string;
}

export interface Issue {
  path: string;
  sessionId?: string;
  message: string;
}

export interface StatusPayload {
  version: string;
  status: 'idle' | 'indexing' | 'ready' | 'error';
  error: string | null;
  errorCode: string | null;
  report: {
    at: string;
    tookMs: number;
    projects: number;
    sessions: number;
    loaded: number;
    failed: number;
    withParseErrors: number;
    issues: Issue[];
  } | null;
  dataDir: string | null;
  projectsDir: string | null;
  candidates: DiscoveryCandidate[];
  explicit: { path: string; ok: boolean; reason?: string } | null;
  settings: { dataDir: string | null };
  platform: string;
  canReveal: boolean;
}

export type ServerEvent =
  | { type: 'hello'; status: string }
  | { type: 'indexing'; status: string }
  | { type: 'sessions'; updated: SessionSummary[]; removed: string[] }
  | { type: 'live'; sessions: { id: string; live: SessionSummary['live'] }[] };

// ---------- model context (from attachment records) ----------

export interface CtxRef {
  line: number;
  offset: number;
  length: number;
  ts: string | null;
}

export interface CtxTool extends CtxRef {
  name: string;
  description: string; // '' when only the name was recorded (deferred tool never loaded)
  schema: unknown | null;
  deferred: boolean;
}

export interface CtxListed extends CtxRef {
  name: string;
  description: string;
  removed?: boolean;
}

export interface CtxFile extends CtxRef {
  path: string;
  kind: string; // Project | User | AutoMem | nested | ...
  content: string;
  display?: string | null;
}

export interface SessionContext {
  id: string;
  recorded: boolean; // false when this Claude Code version did not write prompt snapshots
  systemPrompt: (CtxRef & { parts: string[]; cliPrefix: string | null; chars: number; flags: Record<string, unknown> }) | null;
  promptChanged: boolean;
  snapshots: (CtxRef & { chars: number; parts: number; hasTools: boolean; toolCount: number; sidechain: boolean })[];
  tools: CtxTool[];
  toolDeltas: (CtxRef & { added: number; removed: number; surfaced: number; removedNames: string[]; failedMcp: unknown[]; pendingMcp: unknown[] })[];
  agents: CtxListed[];
  skills: (CtxRef & { names: string[]; items: { name: string; description: string }[]; count: number }) | null;
  mcp: (CtxRef & { name: string; block: string })[];
  instructions: CtxFile[];
  environment: (CtxRef & Record<string, unknown>) | null;
  model: (CtxRef & { modelId?: string; marketingName?: string; knowledgeCutoff?: string; text: string | null }) | null;
  outputStyle: (CtxRef & { style: string | null }) | null;
  autoMode: (CtxRef & Record<string, unknown>) | null;
  allowedTools: (CtxRef & { allowedTools: string[] }) | null;
  sessionContext: (CtxRef & { context: Record<string, string> }) | null;
  dates: string[];
  attachmentTypes: { type: string; count: number }[];
}
