// Deterministic, local analysis of one session for evaluating the coding agent's behaviour.
//
// Input: the raw transcript records of the main file and of every sub-agent file (the same
// objects the summarizer and normalizer see). Output: a JSON report with
//   - observed metrics (tool calls, shell commands by category, files read/changed, test and
//     build runs with their outcome, timing, tokens, cost),
//   - detected inefficiencies (repeated reads, repeated commands, retries without change,
//     edit thrash, excessive exploration, missing verification, ...), each pointing at the
//     events involved so the UI can jump to them,
//   - derived scores with the exact deductions that produced them.
// Nothing here calls out or guesses: every number is counted from records, and every rule is
// a fixed threshold documented next to it. Derived scores are kept apart from observed data.
import { classifyUserRecord, userText, toolResultText, titleFromPrompt } from './content.js';

export const ANALYSIS_VERSION = 4;

const MUTATING_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const SEARCH_TOOLS = new Set(['Grep', 'Glob', 'ToolSearch', 'LS']);
const WEB_TOOLS = new Set(['WebFetch', 'WebSearch']);
const AGENT_TOOLS = new Set(['Agent', 'Task']);
const LARGE_READ_CHARS = 40_000; // a Read result above this inflates the context noticeably
const RETRY_WINDOW = 8; // calls between two attempts on the same target that still count as one retry chain
const MAX_REFS = 24; // event references kept per finding
const MAX_LIST = 200; // file paths kept per list

// ---------- shell command classification ----------

const CMD_RULES = [
  ['test', /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|tests|e2e|test:[\w:-]+)\b|\bnode\s+--test\b|\b(?:vitest|jest|mocha|pytest|py\.test|phpunit|rspec|ava|karma|cypress\s+run|playwright\s+test)\b|\bgo\s+test\b|\bcargo\s+test\b|\b(?:mvn|gradlew?|dotnet)\s+test\b|\bmake\s+test\b|\bbundle\s+exec\s+rspec\b|\bpython3?\s+-m\s+(?:pytest|unittest)\b/],
  ['build', /\b(?:npm|pnpm|yarn|bun)\s+run\s+(?:build|compile|bundle|dist)\b|\btsc\b(?![^&|;]*--noEmit)|\besbuild\b|\bvite\s+build\b|\bwebpack\b|\brollup\b|\bnext\s+build\b|\bcargo\s+build\b|\bgo\s+build\b|(?:^|\s)make(?:\s|$)(?![^&|;]*\b(?:test|lint))|\bgradlew?\s+(?:build|assemble)\b|\bmvn\s+(?:package|compile|install)\b|\bdocker\s+build\b|\bxcodebuild\b|\bswift\s+build\b|\bdotnet\s+build\b/],
  ['lint', /\btsc\b[^&|;]*--noEmit|\b(?:npm|pnpm|yarn|bun)\s+run\s+(?:lint|typecheck|type-check|check|format)\b|\b(?:eslint|prettier|ruff|flake8|pylint|mypy|black|isort|golangci-lint|rubocop|stylelint|biome|oxlint)\b|\bcargo\s+(?:clippy|fmt)\b|\bgo\s+vet\b/],
  ['install', /\b(?:npm|pnpm|yarn|bun)\s+(?:i|install|ci|add)\b|\bpip3?\s+install\b|\bpoetry\s+(?:install|add)\b|\buv\s+(?:pip|add|sync)\b|\bbrew\s+install\b|\bcargo\s+add\b|\bgo\s+get\b|\bgem\s+install\b|\bbundle\s+install\b|\bapt(?:-get)?\s+install\b/],
  ['git', /(?:^|[\s;&|(])git\s+\w/],
  ['run', /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:start|dev|serve|preview)\b|\bnode\s+(?!--test)(?:[\w./-]+\.(?:m?js|cjs|ts)\b|-e\b|--input-type)|\bpython3?\s+(?:[\w./-]+\.py\b|-c\b|-\s*(?:<<|$))|\b(?:ruby|perl|php|deno|bun|tsx|ts-node)\s+[\w./-]+\b|\bcargo\s+run\b|\bgo\s+run\b|\bdocker\s+(?:run|compose)\b|\bnpx\s+\w|\bcurl\b|\bwget\b/],
];
const INSPECT_RE = /^(?:ls|ll|cat|head|tail|grep|rg|ag|find|fd|wc|pwd|which|where|tree|du|df|stat|file|echo|printf|sed\s+-n|awk|less|more|diff|env|printenv|type|whoami|date|uname|sw_vers|ps|lsof|jq|yq|sort|uniq|cut|tr|xargs|realpath|basename|dirname|md5|shasum|sha256sum|true|cd|test|\[|nl|column|strings|od|hexdump|git\s+(?:status|log|diff|show|branch|blame|ls-files|rev-parse|remote|describe|stash\s+list))\b/;
const MUTATING_SEGMENT_RE = /(?:^|[^2&>])>(?!&|\s*\/dev\/null)|\bsed\s+-i|\bperl\s+-p?i\b|(?:^|\s)(?:rm|mv|cp|mkdir|touch|chmod|chown|ln|tee|rmdir|truncate|install)\s|<<|\bgit\s+(?:commit|add|checkout|switch|reset|rebase|merge|stash(?!\s+list)|push|pull|cherry-pick|revert|rm|mv|clean|tag|apply|am)\b|\b(?:npm|pnpm|yarn|bun)\s+(?:i|install|ci|add|uninstall|rm|remove|version|publish)\b|\bpip3?\s+install\b/;
export const COMMAND_CATEGORIES = ['test', 'build', 'lint', 'git', 'install', 'run', 'inspect', 'other'];

/** Split a shell command into its top-level segments (naive: quotes are not honoured). */
function segments(cmd) {
  return String(cmd)
    .split(/\s*(?:&&|\|\||;|\||\n)\s*/)
    .map((s) => s.trim().replace(/^(?:[A-Z_][A-Z0-9_]*=\S*\s+)+/, '').replace(/^(?:sudo|time|nohup|exec)\s+/, ''))
    .filter(Boolean);
}

export function normalizeCommand(cmd) {
  return String(cmd || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
}

/** Category, mutation flag and git sub-command of a Bash command. */
export function classifyCommand(cmd) {
  const s = String(cmd || '');
  const segs = segments(s);
  const body = segs.filter((x) => !/^cd(\s|$)/.test(x));
  const mutating = segs.some((x) => MUTATING_SEGMENT_RE.test(x));
  // Purely read-only commands (ls, cat, git status, ...) are "inspect" even when a rule below would match.
  let category = body.length && body.every((x) => INSPECT_RE.test(x)) && !mutating ? 'inspect' : null;
  for (const [cat, re] of CMD_RULES) {
    if (category) break;
    if (re.test(s)) category = cat;
  }
  if (!category) category = 'other';
  const git = category === 'git' ? (/\bgit\s+commit\b/.test(s) ? 'commit' : /\bgit\s+push\b/.test(s) ? 'push' : 'other') : null;
  return { category, mutating, git };
}

// ---------- outcome of test and build runs ----------

const maxOf = (text, re) => {
  let m = 0;
  for (const x of text.matchAll(re)) m = Math.max(m, Number(x[1]) || 0);
  return m;
};

/** Parse pass/fail counts out of a test runner's output. Returns {status, passed, failed}. */
export function testOutcome(text, isError) {
  const t = String(text || '');
  const passed = Math.max(maxOf(t, /(\d+)\s+(?:passed|passing)\b/gi), maxOf(t, /^# pass (\d+)/gim));
  const failed = Math.max(maxOf(t, /(\d+)\s+(?:failed|failing|failures?)\b/gi), maxOf(t, /^# fail (\d+)/gim));
  const hardFail = /^FAIL\b|--- FAIL|\bTests failed\b|test result: FAILED/m.test(t);
  const hardOk = /^ok\b|\bPASS\b|test result: ok/m.test(t);
  let status = 'unknown';
  if (isError || failed > 0 || hardFail) status = 'failed';
  else if (passed > 0 || hardOk) status = 'passed';
  return { status, passed, failed };
}

export function buildOutcome(text, isError) {
  const t = String(text || '');
  const bad = isError || /\berror TS\d+\b|\bBuild failed\b|error\[E\d+\]|\bcompilation failed\b|\bBUILD FAILED\b/i.test(t);
  return bad ? 'failed' : 'passed';
}

// ---------- helpers ----------

const ms = (ts) => {
  const t = typeof ts === 'string' ? Date.parse(ts) : NaN;
  return Number.isFinite(t) ? t : null;
};
const str = (v) => (typeof v === 'string' ? v : '');
const lineCount = (s) => (s ? s.split('\n').length : 0);

function patchLines(patch) {
  let added = 0;
  let removed = 0;
  if (!Array.isArray(patch) || patch.length === 0) return null; // Write of a new file records an empty patch
  for (const h of patch) {
    if (!h || !Array.isArray(h.lines)) continue;
    for (const l of h.lines) {
      if (typeof l !== 'string') continue;
      if (l.startsWith('+')) added++;
      else if (l.startsWith('-')) removed++;
    }
  }
  return { added, removed };
}

/** Lines added/removed by a successful edit tool call, from the recorded patch when present. */
function editDelta(tool, input, result) {
  const p = patchLines(result?.structuredPatch);
  if (p) return p;
  if (tool === 'Write') return { added: lineCount(str(input?.content)), removed: 0 };
  if (tool === 'Edit') return { added: lineCount(str(input?.new_string)), removed: lineCount(str(input?.old_string)) };
  if (tool === 'MultiEdit' && Array.isArray(input?.edits)) {
    let added = 0;
    let removed = 0;
    for (const e of input.edits) {
      added += lineCount(str(e?.new_string));
      removed += lineCount(str(e?.old_string));
    }
    return { added, removed };
  }
  return { added: 0, removed: 0 };
}

/** A target shortened for prose: file paths keep their last two segments. */
function shortTarget(tool, target) {
  if (!target) return '';
  if (target.startsWith('/') || target.startsWith('~')) {
    const parts = target.split('/').filter(Boolean);
    return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : target;
  }
  return target.length > 70 ? target.slice(0, 67) + '…' : target;
}

function targetOf(tool, input) {
  const i = input && typeof input === 'object' ? input : {};
  switch (tool) {
    case 'Bash':
      return normalizeCommand(i.command);
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return str(i.file_path);
    case 'NotebookEdit':
      return str(i.notebook_path);
    case 'Grep':
    case 'Glob':
      return `${str(i.pattern)} ${str(i.path)}`.trim();
    case 'Agent':
    case 'Task':
      return str(i.description) || str(i.prompt).slice(0, 120);
    default: {
      try {
        return JSON.stringify(i).slice(0, 200);
      } catch {
        return '';
      }
    }
  }
}

function inputHash(input) {
  try {
    return JSON.stringify(input).slice(0, 4096);
  } catch {
    return '';
  }
}

function bump(map, key, by = 1) {
  if (key == null) return;
  map[key] = (map[key] || 0) + by;
}

function pushRef(list, ref) {
  if (list.length < MAX_REFS) list.push(ref);
}

/** Problems mention events as {id, agentId}; the UI jumps to the event (or the Agent call for sub-agent events). */
function refOf(call) {
  return call.agentId ? { id: call.id, agentId: call.agentId } : { id: call.id };
}

// ---------- per-transcript ledger ----------

/**
 * Walk one transcript's records and return every tool call with its result, plus the turn
 * structure, text extracts and timing split. `fileKey` is 'main' or the agent id so event ids
 * match what the normalizer produces for the UI.
 */
function ledgerFor(records, fileKey, { isAgent = false } = {}) {
  const calls = [];
  const byToolUse = new Map();
  const turns = [];
  let turn = null;
  const agentId = fileKey === 'main' ? null : fileKey;
  let firstTs = null;
  let lastTs = null;
  let prevTs = null;
  const time = { modelMs: 0, toolMs: 0, userMs: 0, otherMs: 0, backgroundMs: 0 };
  let carried = 0;
  let idle = false; // set by a turn_duration record: the model has returned control and is not running
  let firstPrompt = null;
  let firstPromptFull = null;
  let lastAssistantText = null;
  let lastAssistantTextTs = null;
  let lastPromptTs = null;
  let lastKind = null; // 'prompt' | 'assistant' | 'tool_result' | 'interrupted' | 'api_error'
  let interruptions = 0;
  let apiErrors = 0;
  let apiRetries = 0;
  let lastApiErrorTs = null;
  let lastMsgId = null;
  let thinkingBlocks = 0;
  let assistantMessages = 0;

  const see = (rec) => {
    const t = ms(rec.timestamp);
    if (t == null) return null;
    if (firstTs == null || t < firstTs) firstTs = t;
    if (lastTs == null || t > lastTs) lastTs = t;
    return t;
  };

  for (const r of records) {
    const o = r.obj;
    if (!o || typeof o !== 'object') continue;
    const t = see(o);
    // Gaps before housekeeping records (attachments, snapshots, system notes) belong to whatever
    // the next real record was waiting on, so they are carried forward instead of counted apart.
    const gap = (t != null && prevTs != null ? Math.max(0, t - prevTs) : 0) + carried;
    carried = 0;
    if (o.type === 'user') {
      const c = o.message?.content;
      const kind = classifyUserRecord(o);
      const blocks = Array.isArray(c) ? c : [];
      let hadResult = false;
      blocks.forEach((b, i) => {
        if (!b || typeof b !== 'object' || b.type !== 'tool_result') return;
        hadResult = true;
        const call = byToolUse.get(b.tool_use_id);
        const text = toolResultText(b.content);
        const isError = !!b.is_error;
        if (!call) return;
        call.end = t;
        call.durationMs = t != null && call.start != null ? Math.max(0, t - call.start) : null;
        call.ok = !isError;
        call.isError = isError;
        call.interrupted = !!o.toolUseResult?.interrupted;
        call.denied = o.toolDenialKind || (isError && /doesn't want to proceed|tool use was rejected/i.test(text) ? 'user' : null);
        call.resultChars = text.length;
        call.errorText = isError ? text.slice(0, 240) : null;
        call.resultRef = `${fileKey}:${o.uuid || r.line}#${i}`;
        const res = o.toolUseResult;
        if (call.tool === 'Bash') {
          const out = (str(res?.stdout) + '\n' + str(res?.stderr)).trim() || text;
          if (call.cmd.category === 'test') call.test = testOutcome(out, isError);
          else if (call.cmd.category === 'build' || call.cmd.category === 'lint') call.build = buildOutcome(out, isError);
          if (res?.timedOutAfterMs) call.timedOut = true;
        } else if (MUTATING_TOOLS.has(call.tool) && !isError) {
          call.delta = editDelta(call.tool, call.input, res);
        } else if (call.tool === 'Edit' && isError) {
          call.editMiss = /String to replace not found|has not been read|not been read yet|Found \d+ matches|modified since read|File has been (?:modified|unexpectedly)/i.test(text);
        }
        if (isError && /No such tool available/i.test(text)) call.unknownTool = true;
      });
      if (hadResult) {
        time.toolMs += gap;
        lastKind = 'tool_result';
        idle = false;
      } else if (kind === 'human' && (!o.isSidechain || isAgent)) {
        idle = false;
        const text = userText(c);
        time.userMs += gap;
        lastKind = 'prompt';
        lastPromptTs = t;
        if (!firstPrompt) {
          firstPrompt = titleFromPrompt(text);
          firstPromptFull = cleanPrompt(text).slice(0, 2000);
        }
        turn = { idx: turns.length + 1, id: `${fileKey}:${o.uuid || r.line}`, prompt: titleFromPrompt(text), start: t, end: t, toolCalls: 0, errors: 0, edits: 0, testRuns: 0, testFailures: 0, redundant: 0, modelMs: 0, toolMs: 0, agents: 0, tokensOut: 0, apiErrors: 0 };
        turns.push(turn);
      } else if (kind === 'interrupted') {
        interruptions++;
        lastKind = 'interrupted';
        time.otherMs += gap;
      } else if (kind === 'task-notification' || kind === 'agent-report') {
        // Waiting on a background task or sub-agent counts as tool time (the agent was blocked on it).
        time.backgroundMs += gap;
        if (turn) turn.toolMs += gap;
        idle = false;
      } else if (kind === 'command') {
        time.userMs += gap;
        lastKind = 'command';
      } else carried += gap;
    } else if (o.type === 'assistant') {
      const m = o.message || {};
      if (idle) {
        // Woken by a background task (sub-agent, monitor, scheduled wake-up) after the turn had ended.
        time.backgroundMs += gap;
        if (turn) turn.toolMs += gap;
      } else {
        time.modelMs += gap;
        if (turn) turn.modelMs += gap;
      }
      idle = false;
      if (o.isApiErrorMessage || o.error) {
        apiErrors++;
        lastApiErrorTs = t;
        lastKind = 'api_error';
        if (turn) turn.apiErrors++;
      }
      if (m.id && m.id !== lastMsgId) {
        assistantMessages++;
        if (turn && m.usage) turn.tokensOut += m.usage.output_tokens || 0;
        lastMsgId = m.id;
      }
      const blocks = Array.isArray(m.content) ? m.content : typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : [];
      blocks.forEach((b, i) => {
        if (!b || typeof b !== 'object') return;
        if (b.type === 'text' && str(b.text).trim() && !o.isApiErrorMessage) {
          lastAssistantText = b.text;
          lastAssistantTextTs = t;
          lastKind = 'assistant';
        } else if (b.type === 'thinking') thinkingBlocks++;
        else if (b.type === 'tool_use') {
          const id = `${fileKey}:${o.uuid || r.line}#${o.apiBlockIndex ?? i}`;
          const call = {
            id,
            agentId,
            tool: b.name,
            input: b.input,
            target: targetOf(b.name, b.input),
            hash: inputHash(b.input),
            start: t,
            end: null,
            durationMs: null,
            ok: null,
            isError: false,
            messageId: m.id || null,
            turn: turn ? turn.idx : 0,
            idx: calls.length,
            cmd: b.name === 'Bash' ? classifyCommand(str(b.input?.command)) : null,
          };
          calls.push(call);
          if (b.id) byToolUse.set(b.id, call);
          if (turn) turn.toolCalls++;
          lastKind = 'tool_call';
        }
      });
    } else if (o.type === 'system') {
      if (o.subtype === 'api_error' || o.level === 'error') {
        apiErrors++;
        if (o.retryAttempt != null) apiRetries++;
        lastApiErrorTs = t;
        lastKind = 'api_error';
        if (turn) turn.apiErrors++;
        time.otherMs += gap;
      } else {
        if (o.subtype === 'turn_duration') idle = true;
        carried += gap;
      }
    } else carried += gap;
    if (t != null) {
      prevTs = t;
      if (turn && t > turn.end) turn.end = t;
    }
  }
  time.otherMs += carried; // trailing housekeeping after the last real record
  // Tool time inside a turn is the span of its calls (parallel calls overlap, so use results' gaps).
  for (const c of calls) {
    const tr = turns[c.turn - 1];
    if (!tr) continue;
    if (c.isError) tr.errors++;
    if (MUTATING_TOOLS.has(c.tool) && c.ok) tr.edits++;
    if (c.test) {
      tr.testRuns++;
      if (c.test.status === 'failed') tr.testFailures++;
    }
    if (AGENT_TOOLS.has(c.tool)) tr.agents++;
    if (c.durationMs != null) tr.toolMs += c.durationMs;
  }
  return {
    fileKey,
    agentId,
    calls,
    turns,
    firstTs,
    lastTs,
    time,
    firstPrompt,
    firstPromptFull,
    lastAssistantText: lastAssistantText ? lastAssistantText.slice(0, 1500) : null,
    lastAssistantTextTs,
    lastPromptTs,
    lastKind,
    interruptions,
    apiErrors,
    apiRetries,
    lastApiErrorTs,
    thinkingBlocks,
    assistantMessages,
  };
}

function cleanPrompt(text) {
  return String(text || '')
    .replace(/<pasted_content[^>]*>/g, '')
    .replace(/<\/pasted_content>/g, '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/g, '')
    .replace(/<ide_selection>[\s\S]*?<\/ide_selection>/g, '')
    .trim();
}

// ---------- inefficiency detection ----------

/**
 * Redundant reads, repeated commands and retry chains inside one transcript. Each transcript
 * has its own model context, so a sub-agent re-reading a file the main agent read is not
 * redundant; only repeats inside the same context are.
 */
function detectWithin(ledger) {
  const calls = ledger.calls;
  const readSeen = new Map(); // key -> last read call
  const mutatedAt = new Map(); // path -> idx of last change
  const cmdSeen = new Map(); // normalized command -> last successful call
  const redundantReads = new Map(); // path -> {count, refs}
  const repeatedCommands = new Map(); // cmd -> {count, refs, category}
  let lastMutationIdx = -1;
  const mentions = (cmd, path) => {
    const base = path.split('/').pop();
    return base && cmd.includes(base);
  };
  for (const c of calls) {
    c.mutBefore = lastMutationIdx; // index of the last change before this call (for the retry rule below)
    if (c.tool === 'Read' && c.ok) {
      const path = c.target;
      const key = `${path}|${c.input?.offset ?? ''}|${c.input?.limit ?? ''}`;
      const prev = readSeen.get(key);
      const changedSince = (mutatedAt.get(path) ?? -1) > (prev?.idx ?? -1);
      if (prev && !changedSince) {
        const e = redundantReads.get(path) || { path, count: 0, refs: [refOf(prev)] };
        e.count++;
        pushRef(e.refs, refOf(c));
        redundantReads.set(path, e);
        c.redundant = 'read';
      }
      readSeen.set(key, c);
    } else if (MUTATING_TOOLS.has(c.tool) && c.ok) {
      mutatedAt.set(c.target, c.idx);
      lastMutationIdx = c.idx;
    } else if (c.tool === 'Bash') {
      // git commands never change source files, so they do not make a later check or re-read necessary
      if (c.cmd?.mutating && c.ok !== false && !c.cmd.git) {
        lastMutationIdx = c.idx;
        for (const p of readSeen.keys()) {
          const path = p.split('|')[0];
          if (mentions(c.target, path)) mutatedAt.set(path, c.idx);
        }
      }
      const prev = cmdSeen.get(c.target);
      // The same command run again, after it already succeeded, with nothing changed in between.
      if (prev && c.ok !== false && lastMutationIdx < prev.idx && c.cmd?.category !== 'run') {
        const e = repeatedCommands.get(c.target) || { command: c.target, category: c.cmd?.category || 'other', count: 0, refs: [refOf(prev)] };
        e.count++;
        pushRef(e.refs, refOf(c));
        repeatedCommands.set(c.target, e);
        c.redundant = 'command';
      }
      if (c.ok) cmdSeen.set(c.target, c);
    }
  }
  // Retry chains: a failed call followed by more attempts on the same target within a few calls.
  const chains = [];
  const byTarget = new Map();
  for (const c of calls) {
    if (!c.target || c.ok == null) continue;
    const k = `${c.tool}\u0000${c.target}`;
    if (!byTarget.has(k)) byTarget.set(k, []);
    byTarget.get(k).push(c);
  }
  for (const list of byTarget.values()) {
    let chain = null;
    const close = () => {
      if (chain && chain.attempts > 1) chains.push(chain);
      chain = null;
    };
    for (const c of list) {
      if (chain && c.idx - chain.lastIdx > RETRY_WINDOW) close();
      if (chain) {
        chain.attempts++;
        // Same input re-issued after a failure with nothing changed in between (an edit→re-test loop is not a retry).
        if (c.hash === chain.lastHash && !chain.lastOk && c.mutBefore < chain.lastIdx) chain.identical++;
        if (c.mutBefore > chain.lastIdx) chain.fixLoop = true; // something was changed before trying again
        chain.lastIdx = c.idx;
        chain.lastHash = c.hash;
        chain.lastOk = !!c.ok;
        pushRef(chain.refs, refOf(c));
        if (c.ok) {
          chain.resolved = true;
          close();
          continue;
        }
      } else if (c.ok === false) {
        chain = { tool: c.tool, target: c.target.slice(0, 160), attempts: 1, identical: 0, resolved: false, fixLoop: false, lastIdx: c.idx, lastHash: c.hash, lastOk: false, refs: [refOf(c)], agentId: c.agentId };
      }
    }
    close();
  }
  for (const ch of chains) {
    delete ch.lastIdx;
    delete ch.lastHash;
    delete ch.lastOk;
  }
  return { redundantReads: [...redundantReads.values()], repeatedCommands: [...repeatedCommands.values()], chains };
}

// ---------- session-level analysis ----------

/**
 * @param {object} p
 * @param {string} p.id
 * @param {Array} p.main          parsed records of the main transcript ({line, obj})
 * @param {Array} p.subagents     [{agentId, meta, records}]
 * @param {object} p.summary      the session summary (counts, usage, cost, estimate, live, subagents)
 */
export function analyzeSession({ id, main, subagents = [], summary }) {
  const ledgers = [ledgerFor(main, 'main'), ...subagents.map((s) => ledgerFor(s.records || [], s.agentId, { isAgent: true }))];
  const L = ledgers[0];
  const allCalls = ledgers.flatMap((l) => l.calls);
  const detections = ledgers.map((l) => detectWithin(l));

  // --- activity ---
  const byTool = {};
  const commands = { total: 0, failed: 0, unique: 0, byCategory: Object.fromEntries(COMMAND_CATEGORIES.map((c) => [c, 0])), mutating: 0, timedOut: 0, git: { commits: 0, pushes: 0 } };
  const files = { read: new Map(), changed: new Map(), linesAdded: 0, linesRemoved: 0 };
  const tests = { runs: 0, passed: 0, failed: 0, unknown: 0, last: null, lastRef: null, lastIdx: -1, casesPassed: 0, casesFailed: 0 };
  const builds = { runs: 0, failed: 0, last: null, lastIdx: -1 };
  const uniqueCmds = new Set();
  let toolErrors = 0;
  let denied = 0;
  let interrupted = 0;
  let unknownTools = 0;
  let editMisses = 0;
  let largeReads = 0;
  let largeReadChars = 0;
  let exploration = 0;
  let mutations = 0;
  let agentCalls = 0;
  let toolMsTotal = 0;
  let slowest = null;
  let lastMutationIdx = -1;
  const editsPerFile = new Map();
  const largeReadRefs = [];
  const editMissRefs = [];
  const unknownToolRefs = [];
  const deniedRefs = [];
  const toolErrorRefs = [];
  const mainLen = L.calls.length;
  // Global order: main calls first, then agents (within-file order is what matters for "after").
  allCalls.forEach((c, gi) => {
    c.gidx = gi;
    const t = (byTool[c.tool] ??= { calls: 0, errors: 0, ms: 0 });
    t.calls++;
    if (c.isError) {
      t.errors++;
      toolErrors++;
      pushRef(toolErrorRefs, refOf(c));
    }
    if (c.durationMs != null) {
      t.ms += c.durationMs;
      toolMsTotal += c.durationMs;
      if (!AGENT_TOOLS.has(c.tool) && (!slowest || c.durationMs > slowest.durationMs)) slowest = { tool: c.tool, target: c.target.slice(0, 120), durationMs: c.durationMs, ref: refOf(c) };
    }
    if (c.denied) {
      denied++;
      pushRef(deniedRefs, refOf(c));
    }
    if (c.interrupted) interrupted++;
    if (c.unknownTool) {
      unknownTools++;
      pushRef(unknownToolRefs, refOf(c));
    }
    if (c.editMiss) {
      editMisses++;
      pushRef(editMissRefs, refOf(c));
    }
    if (AGENT_TOOLS.has(c.tool)) agentCalls++;
    if (c.tool === 'Read') {
      exploration++;
      if (c.ok) {
        const e = files.read.get(c.target) || { path: c.target, count: 0, agent: 0 };
        e.count++;
        if (c.agentId) e.agent++;
        files.read.set(c.target, e);
        if (c.resultChars > LARGE_READ_CHARS) {
          largeReads++;
          largeReadChars += c.resultChars;
          pushRef(largeReadRefs, refOf(c));
        }
      }
    } else if (SEARCH_TOOLS.has(c.tool) || WEB_TOOLS.has(c.tool)) exploration++;
    else if (MUTATING_TOOLS.has(c.tool)) {
      if (c.ok) {
        mutations++;
        lastMutationIdx = c.gidx;
        const e = files.changed.get(c.target) || { path: c.target, edits: 0, added: 0, removed: 0, agent: 0, created: false };
        e.edits++;
        if (c.tool === 'Write') e.created = e.created || !!(c.delta && c.delta.removed === 0);
        if (c.delta) {
          e.added += c.delta.added;
          e.removed += c.delta.removed;
          files.linesAdded += c.delta.added;
          files.linesRemoved += c.delta.removed;
        }
        if (c.agentId) e.agent++;
        files.changed.set(c.target, e);
        const pf = editsPerFile.get(c.target) || { path: c.target, edits: 0, refs: [], agentId: c.agentId };
        pf.edits++;
        pushRef(pf.refs, refOf(c));
        editsPerFile.set(c.target, pf);
      }
    } else if (c.tool === 'Bash') {
      commands.total++;
      uniqueCmds.add(c.target);
      if (c.isError) commands.failed++;
      if (c.timedOut) commands.timedOut++;
      const cat = c.cmd?.category || 'other';
      bump(commands.byCategory, cat);
      if (cat === 'inspect') exploration++;
      if (c.cmd?.mutating) commands.mutating++;
      if (c.cmd?.mutating && !c.cmd.git && c.ok !== false) {
        mutations++;
        lastMutationIdx = c.gidx;
      }
      if (c.cmd?.git === 'commit' && c.ok) commands.git.commits++;
      if (c.cmd?.git === 'push' && c.ok) commands.git.pushes++;
      if (c.test) {
        tests.runs++;
        tests[c.test.status === 'passed' ? 'passed' : c.test.status === 'failed' ? 'failed' : 'unknown']++;
        tests.casesPassed += c.test.passed;
        tests.casesFailed += c.test.failed;
        if (c.gidx > tests.lastIdx) {
          tests.lastIdx = c.gidx;
          tests.last = c.test.status;
          tests.lastRef = refOf(c);
        }
      }
      if (c.build) {
        builds.runs++;
        if (c.build === 'failed') builds.failed++;
        if (c.gidx > builds.lastIdx) {
          builds.lastIdx = c.gidx;
          builds.last = c.build;
        }
      }
    }
  });
  commands.unique = uniqueCmds.size;
  const toolCalls = allCalls.length;
  const pending = allCalls.filter((c) => c.ok == null).length;
  const redundantReads = detections.flatMap((d) => d.redundantReads);
  const repeatedCommands = detections.flatMap((d) => d.repeatedCommands);
  const chains = detections.flatMap((d) => d.chains);
  const redundantReadCount = redundantReads.reduce((n, r) => n + r.count, 0);
  const repeatedCommandCount = repeatedCommands.reduce((n, r) => n + r.count, 0);
  const identicalRetries = chains.reduce((n, c) => n + c.identical, 0);
  const retryChains = chains.filter((c) => !c.fixLoop); // re-attempts with nothing changed in between
  const fixLoops = chains.filter((c) => c.fixLoop); // fail → change something → try again
  const unresolvedChains = chains.filter((c) => !c.resolved);
  const redundantCalls = redundantReadCount + repeatedCommandCount + identicalRetries;
  const thrash = [...editsPerFile.values()].filter((f) => f.edits >= 5).sort((a, b) => b.edits - a.edits);
  const explorationRatio = mutations > 0 ? exploration / mutations : null;
  const editsAfterLastCheck = lastMutationIdx > Math.max(tests.lastIdx, builds.lastIdx);

  // --- timing (main transcript; sub-agents run inside the main agent's tool time) ---
  const wallMs = L.firstTs != null && L.lastTs != null ? L.lastTs - L.firstTs : null;
  const timing = { wallMs, modelMs: L.time.modelMs, toolMs: L.time.toolMs, backgroundMs: L.time.backgroundMs, userMs: L.time.userMs, otherMs: L.time.otherMs, activeMs: L.time.modelMs + L.time.toolMs + L.time.backgroundMs, toolCallMs: toolMsTotal, slowestCall: slowest, recorded: summary.cost ? { totalDuration: summary.cost.totalDuration ?? null, totalAPIDuration: summary.cost.totalAPIDuration ?? null, totalToolDuration: summary.cost.totalToolDuration ?? null } : null };

  // --- tokens and cost (main + sub-agents, as the viewer shows them) ---
  const usage = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, thinking: 0 };
  const addUsage = (u) => {
    if (!u) return;
    for (const k of Object.keys(usage)) usage[k] += u[k] || 0;
  };
  addUsage(summary.usage);
  for (const a of summary.subagents || []) addUsage(a.usage);
  const tokensIn = usage.input + usage.cacheRead + usage.cacheCreate;
  const tokens = { ...usage, totalIn: tokensIn, totalOut: usage.output, cacheHitRate: tokensIn > 0 ? usage.cacheRead / tokensIn : null, perToolCall: toolCalls > 0 ? Math.round((tokensIn + usage.output) / toolCalls) : null };
  const cost = summary.cost?.totalCostUSD != null ? { usd: summary.cost.totalCostUSD, estimated: false, complete: true } : summary.estimate?.byModel?.length ? { usd: summary.estimate.totalUSD, estimated: true, complete: !!summary.estimate.complete } : null;
  const costPerChangedFile = cost && files.changed.size ? cost.usd / files.changed.size : null;

  // --- sub-agents ---
  const agentLedgers = ledgers.slice(1);
  const agentsWithErrors = agentLedgers.filter((l) => l.calls.some((c) => c.isError) || l.apiErrors > 0);
  const agentTypes = {};
  for (const a of summary.subagents || []) bump(agentTypes, a.agentType || 'agent');
  const agents = { count: agentLedgers.length, calls: agentCalls, toolCalls: agentLedgers.reduce((n, l) => n + l.calls.length, 0), errors: agentLedgers.reduce((n, l) => n + l.calls.filter((c) => c.isError).length + l.apiErrors, 0), withErrors: agentsWithErrors.length, byType: agentTypes, tokens: (summary.subagents || []).reduce((n, a) => n + (a.usage ? a.usage.input + a.usage.cacheRead + a.usage.cacheCreate + a.usage.output : 0), 0) };

  // --- outcome ---
  const live = !!summary.live;
  let outcome = 'unknown';
  if (live) outcome = 'in-progress';
  else if (L.turns.length === 0) outcome = 'no-task';
  else if (L.lastKind === 'interrupted') outcome = 'interrupted';
  else if (L.lastKind === 'api_error') outcome = 'errored';
  else if (L.lastKind === 'assistant' && L.lastAssistantTextTs != null && (L.lastPromptTs == null || L.lastAssistantTextTs >= L.lastPromptTs)) outcome = 'completed';
  else if (L.lastKind === 'tool_result' || L.lastKind === 'tool_call') outcome = 'incomplete';
  else if (L.lastKind === 'prompt' || L.lastKind === 'command') outcome = 'unanswered';
  const endedWithFailingTests = tests.last === 'failed';
  const endedWithFailingBuild = builds.last === 'failed';

  // --- problems ---
  const problems = [];
  const add = (kind, severity, title, detail, refs = [], count = refs.length) => problems.push({ kind, severity, title, detail, count, refs: refs.slice(0, MAX_REFS) });
  const share = (n) => (toolCalls ? n / toolCalls : 0);
  if (redundantReadCount > 0) {
    const worst = [...redundantReads].sort((a, b) => b.count - a.count)[0];
    const sev = redundantReadCount >= 8 && share(redundantReadCount) >= 0.1 ? 'high' : redundantReadCount > 3 || worst.count >= 3 ? 'medium' : 'low';
    add('repeated-reads', sev, `${redundantReadCount} redundant file read${redundantReadCount === 1 ? '' : 's'}`, `${redundantReads.length} file${redundantReads.length === 1 ? ' was' : 's were'} read again with the same range although nothing changed it in between (worst: ${worst.path.split('/').pop()} ×${worst.count + 1}). Each re-read costs tokens and adds nothing new to the context.`, redundantReads.flatMap((r) => r.refs), redundantReadCount);
  }
  if (repeatedCommandCount > 0) {
    const worst = [...repeatedCommands].sort((a, b) => b.count - a.count)[0];
    const sev = repeatedCommandCount >= 8 && share(repeatedCommandCount) >= 0.1 ? 'high' : repeatedCommandCount > 3 ? 'medium' : 'low';
    add('repeated-commands', sev, `${repeatedCommandCount} repeated shell command${repeatedCommandCount === 1 ? '' : 's'}`, `The same command was run again after it had already succeeded, with no file changes in between (worst: \`${worst.command.slice(0, 80)}\` ×${worst.count + 1}).`, repeatedCommands.flatMap((r) => r.refs), repeatedCommandCount);
  }
  if (identicalRetries > 0) {
    const sev = identicalRetries >= 4 ? 'high' : identicalRetries >= 2 ? 'medium' : 'low';
    const withIdentical = chains.filter((c) => c.identical > 0);
    add('retry-no-change', sev, `${identicalRetries} retr${identicalRetries === 1 ? 'y' : 'ies'} without changing the input`, `A failed call was re-issued with exactly the same input${withIdentical.length > 1 ? ` on ${withIdentical.length} targets` : ''} (e.g. ${withIdentical[0].tool}: ${shortTarget(withIdentical[0].tool, withIdentical[0].target)}). Repeating a failed call unchanged rarely succeeds; the input or the plan should change first.`, withIdentical.flatMap((c) => c.refs), identicalRetries);
  }
  if (unresolvedChains.length > 0) {
    const sev = unresolvedChains.length >= 3 || unresolvedChains.some((c) => c.attempts >= 4) ? 'high' : 'medium';
    add('unresolved-failures', sev, `${unresolvedChains.length} failure${unresolvedChains.length === 1 ? '' : 's'} never resolved`, `${unresolvedChains.length === 1 ? 'A target' : 'Targets'} failed repeatedly and no later attempt succeeded: ${unresolvedChains.slice(0, 3).map((c) => `${c.tool} ${shortTarget(c.tool, c.target)} (${c.attempts} attempts)`).join('; ')}.`, unresolvedChains.flatMap((c) => c.refs), unresolvedChains.length);
  }
  if (thrash.length > 0) {
    const sev = thrash.some((f) => f.edits >= 10) ? 'high' : 'medium';
    add('edit-thrash', sev, `${thrash.length} file${thrash.length === 1 ? '' : 's'} edited many times`, `${thrash.slice(0, 3).map((f) => `${f.path.split('/').pop()} ×${f.edits}`).join(', ')}. Many small edits to one file usually mean the change was not planned before writing, or an edit→test loop that kept failing.`, thrash.flatMap((f) => f.refs), thrash.reduce((n, f) => n + f.edits, 0));
  }
  if (editMisses >= 2) add('edit-misses', editMisses >= 5 ? 'medium' : 'low', `${editMisses} edits missed their target`, 'Edit calls failed because the text to replace was not found or the file had changed since it was read. The agent was working from a stale picture of the file.', editMissRefs, editMisses);
  if (exploration >= 25 && explorationRatio != null && explorationRatio >= 6) add('excessive-exploration', explorationRatio >= 12 ? 'high' : 'medium', `${exploration} exploration calls for ${mutations} change${mutations === 1 ? '' : 's'}`, `Reads, searches and inspection commands outnumber changes ${explorationRatio.toFixed(0)}:1. Some exploration is necessary; this much suggests the agent lacked a plan or kept re-orienting.`, [], exploration);
  if (mutations === 0 && toolCalls >= 10 && outcome !== 'in-progress') add('no-changes', 'info', 'No files were changed', 'The session read and ran things but never edited or wrote a file. Fine for research or review sessions; a problem if a change was expected.', [], 0);
  if (files.changed.size > 0 && tests.runs === 0 && builds.runs === 0 && outcome !== 'in-progress') add('no-verification', files.changed.size >= 5 ? 'high' : 'medium', 'Changes were never verified', `${files.changed.size} file${files.changed.size === 1 ? '' : 's'} changed, but no test, build, lint or typecheck command ran. Nothing in the transcript shows the change works.`, [], files.changed.size);
  else if (files.changed.size > 0 && editsAfterLastCheck && outcome !== 'in-progress') add('unverified-final-edits', 'low', 'Files changed after the last check', 'Edits were made after the last test, build or lint run, so the final state was not verified.', [], 0);
  if (endedWithFailingTests && outcome !== 'in-progress') add('tests-failing-at-end', 'high', 'Session ended with failing tests', `The last test run reported failures${tests.casesFailed ? ` (${tests.casesFailed} failing case${tests.casesFailed === 1 ? '' : 's'} in the last output)` : ''} and no later run passed.`, tests.lastRef ? [tests.lastRef] : [], 1);
  if (endedWithFailingBuild && outcome !== 'in-progress') add('build-failing-at-end', 'high', 'Session ended with a failing build or check', 'The last build, lint or typecheck run failed and was not re-run successfully.', [], 1);
  const errRate = share(toolErrors);
  if (toolErrors >= 5 && errRate >= 0.15) add('tool-error-rate', errRate >= 0.3 ? 'high' : 'medium', `${Math.round(errRate * 100)}% of tool calls failed`, `${toolErrors} of ${toolCalls} tool calls returned an error. High failure rates point to wrong assumptions about the environment, missing permissions or a flaky toolchain.`, toolErrorRefs, toolErrors);
  if (L.apiErrors > 0) add('api-errors', L.apiErrors >= 3 ? 'medium' : 'low', `${L.apiErrors} API error${L.apiErrors === 1 ? '' : 's'}${L.apiRetries ? ` (${L.apiRetries} retried)` : ''}`, 'The model API returned errors during the session. These are infrastructure, not agent behaviour, but they cost wall-clock time and may have truncated work.', [], L.apiErrors);
  if (L.interruptions >= 2) add('interruptions', 'low', `User interrupted ${L.interruptions} times`, 'Repeated interruptions usually mean the agent was heading the wrong way or taking too long before checking in.', [], L.interruptions);
  if (unknownTools > 0) add('unknown-tools', 'low', `${unknownTools} call${unknownTools === 1 ? '' : 's'} to tools that do not exist`, 'The agent invoked a tool name that was not available (a deferred tool not loaded, or a hallucinated name).', unknownToolRefs, unknownTools);
  if (denied >= 2) add('denied-calls', 'low', `${denied} tool calls denied`, 'Permission was refused for several calls. Either the permission mode was too tight for the task, or the agent kept asking for things the user did not want.', deniedRefs, denied);
  if (largeReads >= 3) add('large-reads', largeReads >= 8 ? 'medium' : 'low', `${largeReads} very large file reads`, `${largeReads} Read results exceeded ${Math.round(LARGE_READ_CHARS / 1000)}k characters (${Math.round(largeReadChars / 1000)}k in total). Reading whole large files fills the context; offsets, limits or a search would have been cheaper.`, largeReadRefs, largeReads);
  if (agents.withErrors > 0) add('subagent-errors', agents.withErrors >= 3 ? 'medium' : 'low', `${agents.withErrors} sub-agent${agents.withErrors === 1 ? '' : 's'} hit errors`, `${agents.errors} tool or API errors happened inside sub-agent transcripts. Their findings may be incomplete.`, agentsWithErrors.map((l) => ({ id: null, agentId: l.agentId })), agents.withErrors);
  if (outcome === 'incomplete') add('incomplete', 'medium', 'Session stopped mid-work', 'The transcript ends on a tool call or tool result with no final response from the agent. The run was cut off, crashed or is still being written.', [], 1);
  if (outcome === 'errored') add('ended-on-error', 'high', 'Session ended on an API error', 'The last thing in the transcript is an API error; the task was not finished.', [], 1);
  const SEV_ORDER = { high: 0, medium: 1, low: 2, info: 3 };
  problems.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || b.count - a.count);

  // --- recommendations: one per problem kind, phrased as what to do next time ---
  const RECS = {
    'repeated-reads': ['Keep what was read', 'Re-reading the same range adds nothing. Read once, keep notes, and only re-read after editing that file. In CLAUDE.md, ask the agent to avoid re-reading unchanged files.'],
    'repeated-commands': ['Run checks when something changed', 'Running the same command after it already passed wastes time and tokens. Re-run tests or builds only after an edit.'],
    'retry-no-change': ['Change something before retrying', 'When a call fails, read the error and change the input or approach. Identical retries almost never succeed (except for transient network or tool errors).'],
    'unresolved-failures': ['Resolve or report blocked work', 'A target that keeps failing should either be fixed by a different approach or reported to the user as blocked, not left silently failing.'],
    'edit-thrash': ['Plan the edit, then write it once', 'Many edits to one file suggest writing before understanding. Read the file fully, decide the change, then apply it in one or two edits.'],
    'edit-misses': ['Re-read before editing', 'Edit misses come from a stale view of the file. Read the exact region right before editing, especially after shell commands or formatters touched it.'],
    'excessive-exploration': ['Narrow the search', 'Use targeted Grep/Glob and file reads with offsets rather than broad listings. State a plan after a bounded amount of exploration.'],
    'no-verification': ['Always run the project checks', 'After changing code, run the test suite, build or typecheck. Add the commands to CLAUDE.md so the agent knows how to verify.'],
    'unverified-final-edits': ['Verify after the last edit', 'Finish with a test or build run so the final state is known good.'],
    'tests-failing-at-end': ['Do not stop on red', 'Keep iterating until tests pass, or clearly report which tests still fail and why.'],
    'build-failing-at-end': ['Leave the build green', 'A failing build or typecheck at the end means the work is not shippable. Fix it or flag it.'],
    'tool-error-rate': ['Fix the environment first', 'Frequent tool failures point to missing dependencies, wrong paths or permission limits. Check the first few errors; they usually share a cause.'],
    'api-errors': ['Retry budget', 'API errors are outside the agent’s control. If they recur, check connectivity, rate limits or model availability.'],
    interruptions: ['Check in earlier', 'Ask the agent to summarise its plan before long runs, or tighten the task description so it does not drift.'],
    'unknown-tools': ['Load tools before calling them', 'Deferred tools need ToolSearch first. If the name was invented, the tool list in the system prompt is the source of truth.'],
    'denied-calls': ['Align permissions with the task', 'Pre-approve the commands the task needs, or tell the agent which actions are off-limits so it does not keep asking.'],
    'large-reads': ['Read with limits', 'Use offset/limit or a Grep for the relevant part instead of whole-file reads of large files.'],
    'subagent-errors': ['Inspect failing sub-agents', 'Open the sub-agents with errors; their results may have been partial and silently accepted by the main agent.'],
    incomplete: ['Check how the run ended', 'The transcript stops mid-work: look for a crash, a kill or a context limit, and resume the session if needed.'],
    'ended-on-error': ['Resume after the error', 'Resume the session once the API is healthy; the agent will continue from the last tool result.'],
    'no-changes': null,
  };
  const recommendations = [];
  const seen = new Set();
  for (const p of problems) {
    const r = RECS[p.kind];
    if (!r || seen.has(p.kind)) continue;
    seen.add(p.kind);
    recommendations.push({ kind: p.kind, severity: p.severity, title: r[0], detail: r[1] });
  }

  // --- derived scores (0–100, each deduction listed) ---
  const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
  const scoreOf = (factors) => {
    const total = factors.reduce((n, f) => n + f.delta, 100);
    return { value: clamp(total), factors: factors.filter((f) => f.delta !== 0) };
  };
  const reliability = scoreOf([
    { label: `${Math.round(errRate * 100)}% tool calls failed`, delta: -Math.min(40, Math.round(errRate * 120)) },
    { label: `${L.apiErrors} API errors`, delta: -Math.min(10, L.apiErrors * 3) },
    { label: `${unresolvedChains.length} unresolved failures`, delta: -Math.min(20, unresolvedChains.length * 7) },
    { label: 'tests failing at end', delta: endedWithFailingTests ? -15 : 0 },
    { label: 'build failing at end', delta: endedWithFailingBuild ? -10 : 0 },
    { label: `${L.interruptions} interruptions`, delta: -Math.min(10, L.interruptions * 4) },
    { label: outcome === 'errored' ? 'ended on an API error' : outcome === 'incomplete' ? 'stopped mid-work' : '', delta: outcome === 'errored' || outcome === 'incomplete' ? -15 : 0 },
  ]);
  const redundancyShare = share(redundantCalls);
  const efficiency = scoreOf([
    { label: `${Math.round(redundancyShare * 100)}% of calls redundant (${redundantCalls})`, delta: -Math.min(40, Math.round(redundancyShare * 150)) },
    { label: `edit thrash on ${thrash.length} files`, delta: -Math.min(15, thrash.reduce((n, f) => n + (f.edits - 4) * 2, 0)) },
    { label: explorationRatio != null ? `exploration ratio ${explorationRatio.toFixed(1)}:1` : '', delta: exploration >= 25 && explorationRatio != null && explorationRatio > 6 ? -Math.min(15, Math.round((explorationRatio - 6) * 2)) : 0 },
    { label: `${largeReads} large reads`, delta: -Math.min(10, largeReads * 2) },
    { label: `${editMisses} edit misses`, delta: -Math.min(10, editMisses * 2) },
    { label: `${unknownTools} unknown tool calls`, delta: -Math.min(6, unknownTools * 2) },
  ]);
  let verification = null;
  if (files.changed.size > 0 || commands.mutating > 0) {
    let v;
    let why;
    if (tests.runs === 0 && builds.runs === 0) {
      v = 10;
      why = 'changes made, no tests, builds or checks run';
    } else if (endedWithFailingTests) {
      v = 30;
      why = 'last test run failed';
    } else if (endedWithFailingBuild) {
      v = 35;
      why = 'last build or check failed';
    } else if (editsAfterLastCheck) {
      v = tests.runs ? 65 : 55;
      why = 'files changed after the last passing check';
    } else if (tests.runs && tests.last === 'passed') {
      v = 100;
      why = 'tests passed after the last change';
    } else if (tests.runs) {
      v = 80;
      why = 'tests ran after the last change (outcome not parsed)';
    } else {
      v = 75;
      why = 'build or check passed after the last change, no tests run';
    }
    verification = { value: v, factors: [{ label: why, delta: v - 100 }] };
  }
  const parts = [
    [reliability.value, 0.4],
    [efficiency.value, 0.35],
    ...(verification ? [[verification.value, 0.25]] : []),
  ];
  const wsum = parts.reduce((n, [, w]) => n + w, 0);
  const overall = clamp(parts.reduce((n, [v, w]) => n + v * w, 0) / wsum);
  const grade = (v) => (v >= 85 ? 'strong' : v >= 70 ? 'good' : v >= 50 ? 'fair' : 'weak');
  const scores = {
    derived: true,
    method: 'Each score starts at 100 and subtracts fixed penalties listed in its factors. Overall = 0.4·reliability + 0.35·efficiency + 0.25·verification (verification is skipped when nothing was changed). Thresholds are heuristics, not ground truth.',
    overall: { value: overall, grade: grade(overall) },
    reliability: { ...reliability, grade: grade(reliability.value) },
    efficiency: { ...efficiency, grade: grade(efficiency.value) },
    verification: verification ? { ...verification, grade: grade(verification.value) } : null,
  };

  const listOf = (map, sortKey) => [...map.values()].sort((a, b) => b[sortKey] - a[sortKey]).slice(0, MAX_LIST);
  return {
    id,
    version: ANALYSIS_VERSION,
    computedAt: new Date().toISOString(),
    live,
    task: {
      prompt: L.firstPromptFull,
      title: L.firstPrompt,
      prompts: L.turns.length,
      finalResponse: L.lastAssistantText,
      outcome,
      prLinks: summary.prLinks || [],
      continuedIn: summary.continuedIn || null,
      gitBranch: summary.gitBranch || null,
    },
    activity: {
      toolCalls,
      toolCallsMain: mainLen,
      toolErrors,
      toolErrorRate: errRate,
      pending,
      denied,
      interrupted,
      byTool: Object.fromEntries(Object.entries(byTool).sort((a, b) => b[1].calls - a[1].calls)),
      commands,
      files: {
        read: files.read.size,
        changed: files.changed.size,
        created: [...files.changed.values()].filter((f) => f.created).length,
        linesAdded: files.linesAdded,
        linesRemoved: files.linesRemoved,
        readList: listOf(files.read, 'count'),
        changedList: listOf(files.changed, 'edits'),
      },
      tests: { runs: tests.runs, passed: tests.passed, failed: tests.failed, unknown: tests.unknown, last: tests.last, casesPassed: tests.casesPassed, casesFailed: tests.casesFailed },
      builds: { runs: builds.runs, failed: builds.failed, last: builds.last },
      edits: mutations,
      exploration,
      messages: { user: L.turns.length, assistant: L.assistantMessages, thinking: L.thinkingBlocks },
      apiErrors: L.apiErrors,
      apiRetries: L.apiRetries,
      interruptions: L.interruptions,
      agents,
      timing,
      tokens,
      cost: cost ? { ...cost, perChangedFile: costPerChangedFile } : null,
    },
    behavior: {
      redundantReads: redundantReadCount,
      redundantReadFiles: redundantReads.sort((a, b) => b.count - a.count).slice(0, 50),
      repeatedCommands: repeatedCommandCount,
      repeatedCommandList: repeatedCommands.sort((a, b) => b.count - a.count).slice(0, 50),
      retryChains: retryChains.length,
      fixLoops: fixLoops.length,
      identicalRetries,
      unresolvedChains: unresolvedChains.length,
      chains: chains.sort((a, b) => b.attempts - a.attempts).slice(0, 50),
      redundantCalls,
      redundancyShare,
      editThrashFiles: thrash.length,
      thrash: thrash.slice(0, 20),
      editMisses,
      explorationRatio,
      largeReads,
      unknownTools,
      editsAfterLastCheck,
      maxEditsOneFile: Math.max(0, ...[...editsPerFile.values()].map((f) => f.edits)),
    },
    turns: L.turns.slice(0, 400).map((t) => ({ ...t, durationMs: t.end - t.start })),
    problems,
    recommendations,
    scores,
  };
}

/** The subset of an analysis that the cross-session dashboard needs (no event refs or long lists). */
export function compactAnalysis(a) {
  if (!a) return null;
  const { activity, behavior } = a;
  return {
    id: a.id,
    version: a.version,
    computedAt: a.computedAt,
    live: a.live,
    task: { title: a.task.title, prompts: a.task.prompts, outcome: a.task.outcome },
    activity: {
      ...activity,
      byTool: Object.fromEntries(Object.entries(activity.byTool).slice(0, 12)),
      files: { read: activity.files.read, changed: activity.files.changed, created: activity.files.created, linesAdded: activity.files.linesAdded, linesRemoved: activity.files.linesRemoved },
      timing: { ...activity.timing, slowestCall: null },
    },
    behavior: {
      redundantReads: behavior.redundantReads,
      repeatedCommands: behavior.repeatedCommands,
      retryChains: behavior.retryChains,
      fixLoops: behavior.fixLoops,
      identicalRetries: behavior.identicalRetries,
      unresolvedChains: behavior.unresolvedChains,
      redundantCalls: behavior.redundantCalls,
      redundancyShare: behavior.redundancyShare,
      editThrashFiles: behavior.editThrashFiles,
      editMisses: behavior.editMisses,
      explorationRatio: behavior.explorationRatio,
      largeReads: behavior.largeReads,
      unknownTools: behavior.unknownTools,
      editsAfterLastCheck: behavior.editsAfterLastCheck,
      maxEditsOneFile: behavior.maxEditsOneFile,
    },
    problems: a.problems.map((p) => ({ kind: p.kind, severity: p.severity, title: p.title, count: p.count })),
    scores: a.scores,
  };
}
