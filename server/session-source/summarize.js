// Reducer that folds transcript records into a compact session summary plus a
// lowercase search digest. The reducer state is plain JSON so it can be cached and
// resumed when a live session file grows.
import { classifyUserRecord, userText, titleFromPrompt, toolResultText, stringifyShort } from './content.js';

const DIGEST_CAP = 512 * 1024; // chars of searchable text kept per session

export function createSummaryState(id, { isAgent = false } = {}) {
  return {
    id,
    isAgent,
    firstTs: null,
    lastTs: null,
    cwd: null,
    gitBranch: null,
    version: null,
    entrypoint: null,
    aiTitle: null,
    claudeCustomTitle: null,
    agentName: null,
    slug: null,
    firstPrompt: null,
    firstPromptTs: null,
    lastPrompt: null,
    userMessages: 0,
    assistantMessages: 0,
    lastAssistantMsgId: null,
    thinkingBlocks: 0,
    toolCalls: 0,
    toolErrors: 0,
    apiErrors: 0,
    interruptions: 0,
    attachments: 0,
    records: 0,
    models: {},
    toolNames: {},
    usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, thinking: 0 },
    lastUsageMsgId: null,
    cost: null,
    continuedIn: null,
    prLinks: [],
    permissionModes: {},
    agentIds: {},
    hasImages: false,
    digest: '',
    digestFull: false,
  };
}

function addDigest(state, text) {
  if (state.digestFull || !text) return;
  const t = String(text).toLowerCase();
  if (state.digest.length + t.length + 1 > DIGEST_CAP) {
    state.digest += t.slice(0, DIGEST_CAP - state.digest.length);
    state.digestFull = true;
    return;
  }
  state.digest += t + '\n';
}

function bump(map, key) {
  if (!key) return;
  map[key] = (map[key] || 0) + 1;
}

function seeTs(state, ts) {
  if (!ts || typeof ts !== 'string') return;
  if (!state.firstTs || ts < state.firstTs) state.firstTs = ts;
  if (!state.lastTs || ts > state.lastTs) state.lastTs = ts;
}

function seeCommon(state, rec) {
  seeTs(state, rec.timestamp);
  if (rec.cwd && !state.cwd) state.cwd = rec.cwd;
  if (rec.gitBranch) state.gitBranch = rec.gitBranch;
  if (rec.version) state.version = rec.version;
  if (rec.entrypoint && !state.entrypoint) state.entrypoint = rec.entrypoint;
  if (rec.slug && !state.slug) state.slug = rec.slug;
  if (rec.agentId) bump(state.agentIds, rec.agentId);
}

/** Fold one parsed record into the state. Unknown record types are counted but never throw. */
export function reduceRecord(state, rec) {
  state.records++;
  if (!rec || typeof rec !== 'object') return state;
  const type = rec.type;
  switch (type) {
    case 'user': {
      seeCommon(state, rec);
      const c = rec.message?.content;
      const kind = classifyUserRecord(rec);
      if (Array.isArray(c)) {
        for (const b of c) {
          if (!b || typeof b !== 'object') continue;
          if (b.type === 'tool_result') {
            if (b.is_error) state.toolErrors++;
            addDigest(state, stringifyShort(toolResultText(b.content), 2048));
          } else if (b.type === 'image') state.hasImages = true;
        }
      }
      if (kind === 'human' && (!rec.isSidechain || state.isAgent)) {
        const text = userText(c);
        state.userMessages++;
        state.lastPrompt = titleFromPrompt(text) || state.lastPrompt;
        if (!state.firstPrompt) {
          state.firstPrompt = titleFromPrompt(text);
          state.firstPromptTs = rec.timestamp || null;
        }
        addDigest(state, stringifyShort(text, 8192));
      } else if (kind === 'interrupted') state.interruptions++;
      else if (kind === 'command') addDigest(state, stringifyShort(userText(c), 512));
      if (rec.permissionMode) bump(state.permissionModes, rec.permissionMode);
      break;
    }
    case 'assistant': {
      seeCommon(state, rec);
      const m = rec.message || {};
      if (m.model && m.model !== '<synthetic>') bump(state.models, m.model);
      if (rec.isApiErrorMessage || rec.error) state.apiErrors++;
      if (m.id && m.id !== state.lastAssistantMsgId) {
        state.assistantMessages++;
        state.lastAssistantMsgId = m.id;
      }
      if (m.usage && m.id && m.id !== state.lastUsageMsgId) {
        const u = m.usage;
        state.usage.input += u.input_tokens || 0;
        state.usage.output += u.output_tokens || 0;
        state.usage.cacheRead += u.cache_read_input_tokens || 0;
        state.usage.cacheCreate += u.cache_creation_input_tokens || 0;
        state.usage.thinking += u.output_tokens_details?.thinking_tokens || 0;
        state.lastUsageMsgId = m.id;
      }
      const blocks = Array.isArray(m.content) ? m.content : typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : [];
      for (const b of blocks) {
        if (!b || typeof b !== 'object') continue;
        if (b.type === 'tool_use') {
          state.toolCalls++;
          bump(state.toolNames, b.name);
          addDigest(state, b.name);
          addDigest(state, stringifyShort(b.input, 2048));
        } else if (b.type === 'text') addDigest(state, stringifyShort(b.text, 8192));
        else if (b.type === 'thinking') state.thinkingBlocks++;
      }
      break;
    }
    case 'attachment':
      seeCommon(state, rec);
      state.attachments++;
      break;
    case 'system':
      seeCommon(state, rec);
      if (rec.subtype === 'api_error' || rec.level === 'error') state.apiErrors++;
      break;
    case 'ai-title':
      if (typeof rec.aiTitle === 'string' && rec.aiTitle.trim()) state.aiTitle = rec.aiTitle.trim();
      break;
    case 'custom-title':
      if (typeof rec.customTitle === 'string' && rec.customTitle.trim()) state.claudeCustomTitle = rec.customTitle.trim();
      break;
    case 'agent-name':
      if (typeof rec.agentName === 'string') state.agentName = rec.agentName;
      break;
    case 'cost-state':
      state.cost = {
        totalCostUSD: rec.totalCostUSD,
        totalDuration: rec.totalDuration,
        totalAPIDuration: rec.totalAPIDuration,
        totalToolDuration: rec.totalToolDuration,
        totalLinesAdded: rec.totalLinesAdded,
        totalLinesRemoved: rec.totalLinesRemoved,
        startTime: rec.startTime,
        modelUsage: rec.modelUsage,
        hasUnknownModelCost: rec.hasUnknownModelCost === true,
      };
      break;
    case 'continued-in':
      state.continuedIn = rec.continuedInSessionId || null;
      seeTs(state, rec.timestamp);
      break;
    case 'pr-link':
      if (rec.prUrl && !state.prLinks.some((p) => p.url === rec.prUrl)) {
        state.prLinks.push({ url: rec.prUrl, number: rec.prNumber, repository: rec.prRepository });
      }
      seeTs(state, rec.timestamp);
      break;
    case 'permission-mode':
      if (rec.permissionMode) bump(state.permissionModes, rec.permissionMode);
      break;
    case 'queue-operation':
    case 'file-history-delta':
      seeTs(state, rec.timestamp);
      break;
    default:
      break;
  }
  return state;
}

/** Public, UI-facing summary derived from the reducer state (never includes the digest). */
export function summaryFromState(state, extra = {}) {
  const models = Object.entries(state.models).sort((a, b) => b[1] - a[1]);
  const tools = Object.entries(state.toolNames).sort((a, b) => b[1] - a[1]);
  const startedAt = state.firstTs;
  const endedAt = state.lastTs;
  const durationMs = startedAt && endedAt ? Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)) : null;
  return {
    id: state.id,
    generatedTitle: state.claudeCustomTitle || state.aiTitle || state.firstPrompt || null,
    titleSource: state.claudeCustomTitle ? 'claude-custom' : state.aiTitle ? 'ai' : state.firstPrompt ? 'first-prompt' : 'none',
    firstPrompt: state.firstPrompt,
    lastPrompt: state.lastPrompt,
    cwd: state.cwd,
    gitBranch: state.gitBranch,
    version: state.version,
    entrypoint: state.entrypoint,
    slug: state.slug,
    startedAt,
    endedAt,
    durationMs,
    model: models[0]?.[0] || null,
    models: models.map(([name, count]) => ({ name, count })),
    tools: tools.map(([name, count]) => ({ name, count })),
    counts: {
      userMessages: state.userMessages,
      assistantMessages: state.assistantMessages,
      messages: state.userMessages + state.assistantMessages,
      toolCalls: state.toolCalls,
      toolErrors: state.toolErrors,
      apiErrors: state.apiErrors,
      errors: state.toolErrors + state.apiErrors,
      interruptions: state.interruptions,
      thinkingBlocks: state.thinkingBlocks,
      attachments: state.attachments,
      records: state.records,
    },
    usage: state.usage,
    cost: state.cost,
    continuedIn: state.continuedIn,
    prLinks: state.prLinks,
    permissionModes: Object.keys(state.permissionModes),
    hasImages: state.hasImages,
    inFileAgentIds: Object.keys(state.agentIds),
    ...extra,
  };
}
