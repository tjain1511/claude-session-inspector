// Converts raw transcript records into the normalized event model consumed by the UI.
// Every event keeps a pointer (file, line, offset, length) back to the raw record so
// the UI can fetch the original JSON on demand without us shipping it twice.
import {
  classifyUserRecord,
  parseCommandMessage,
  userText,
  toolResultText,
  truncateText,
  attachmentPreview,
  MAX_INLINE_TEXT,
} from './content.js';

const NON_MESSAGE_LABELS = {
  mode: (r) => `mode: ${r.mode}`,
  'permission-mode': (r) => `permission mode: ${r.permissionMode}`,
  'atis-latch': () => 'atis latch',
  'file-history-snapshot': (r) => `file history snapshot (${Object.keys(r.snapshot?.trackedFileBackups || {}).length} tracked)`,
  'file-history-delta': (r) => `file history delta: ${r.trackingPath || ''}`,
  'last-prompt': (r) => `last prompt: ${(r.lastPrompt || '').slice(0, 120)}`,
  'ai-title': (r) => `AI title: ${r.aiTitle}`,
  'custom-title': (r) => `custom title: ${r.customTitle}`,
  'agent-name': (r) => `agent name: ${r.agentName}`,
  'queue-operation': (r) => `queue ${r.operation}${r.content ? ': ' + String(r.content).slice(0, 120) : ''}`,
  'cost-state': (r) => `cost state: $${Number(r.totalCostUSD || 0).toFixed(4)}`,
  'continued-in': (r) => `continued in session ${r.continuedInSessionId}`,
  'pr-link': (r) => `PR #${r.prNumber} ${r.prUrl || ''}`,
  'frame-link': (r) => `artifact link: ${r.title || r.frameUrl || ''}`,
  'artifact-comment-monitor': () => 'artifact comment monitor',
  'artifact-autoreact-ledger': () => 'artifact autoreact ledger',
};

function ref(fileKey, rec) {
  return { file: fileKey, line: rec.line, offset: rec.offset, length: rec.length };
}

function text(t, max = MAX_INLINE_TEXT) {
  const r = truncateText(typeof t === 'string' ? t : t == null ? '' : String(t), max);
  return r;
}

/** Trim the structured toolUseResult so it does not duplicate huge outputs already sent. */
function trimToolUseResult(v) {
  if (v == null) return undefined;
  if (typeof v === 'string') return text(v, 8192).text;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => trimToolUseResult(x));
  if (typeof v !== 'object') return v;
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === 'string') out[k] = val.length > 4096 ? val.slice(0, 4096) + `… [${val.length} chars]` : val;
    else if (k === 'file' && val && typeof val === 'object') {
      out[k] = { ...val, content: typeof val.content === 'string' ? `[${val.content.length} chars]` : val.content };
    } else if (k === 'structuredPatch' || k === 'originalFile') out[k] = typeof val === 'string' ? `[${val.length} chars]` : val;
    else out[k] = trimToolUseResult(val);
  }
  return out;
}

/**
 * Normalize one record into zero or more events.
 * @param rec  {line, offset, length, obj}
 * @param fileKey 'main' or a subagent id
 */
export function normalizeRecord(rec, fileKey = 'main', opts = {}) {
  const o = rec.obj;
  const events = [];
  if (!o || typeof o !== 'object') {
    events.push({ id: `${fileKey}:${rec.line}`, type: 'unknown', label: 'non-object record', ref: ref(fileKey, rec) });
    return events;
  }
  const base = () => ({
    id: o.uuid ? `${fileKey}:${o.uuid}` : `${fileKey}:${rec.line}`,
    ts: typeof o.timestamp === 'string' ? o.timestamp : null,
    parentId: o.parentUuid ? `${fileKey}:${o.parentUuid}` : null,
    sidechain: !!o.isSidechain,
    agentId: o.agentId || null,
    ref: ref(fileKey, rec),
  });

  switch (o.type) {
    case 'user': {
      const msg = o.message || {};
      const c = msg.content;
      const kind = classifyUserRecord(o);
      const blocks = Array.isArray(c) ? c : null;
      // tool results are delivered as user-role messages
      if (blocks) {
        blocks.forEach((b, i) => {
          if (!b || typeof b !== 'object' || b.type !== 'tool_result') return;
          const t = text(toolResultText(b.content));
          const imageBlocks = Array.isArray(b.content) ? b.content.map((x, j) => (x?.type === 'image' ? j : -1)).filter((j) => j >= 0) : [];
          const images = imageBlocks.length;
          events.push({
            ...base(),
            id: `${base().id}#${i}`,
            type: 'tool_result',
            block: i,
            toolUseId: b.tool_use_id,
            content: t.text,
            truncated: t.truncated,
            fullLength: t.fullLength,
            status: b.is_error ? 'error' : 'success',
            isError: !!b.is_error,
            images,
            imageBlocks,
            interrupted: !!o.toolUseResult?.interrupted,
            denied: o.toolDenialKind || undefined,
            structured: opts.includeStructured === false ? undefined : trimToolUseResult(o.toolUseResult),
            sourceAssistantId: o.sourceToolAssistantUUID ? `${fileKey}:${o.sourceToolAssistantUUID}` : null,
          });
        });
      }
      const hasNonToolContent = typeof c === 'string' || (blocks && blocks.some((b) => b && b.type !== 'tool_result'));
      if (!hasNonToolContent) break;
      const raw = userText(c);
      const images = blocks ? blocks.filter((b) => b?.type === 'image').length : 0;
      if (kind === 'interrupted') {
        events.push({ ...base(), type: 'system', subtype: 'interrupted', content: raw.trim(), level: 'warn' });
      } else if (kind === 'command') {
        const cmd = parseCommandMessage(raw);
        events.push({ ...base(), type: 'user', kind, content: [cmd.name, cmd.args].filter(Boolean).join(' '), command: cmd, images: 0 });
      } else if (kind === 'human') {
        const t = text(raw);
        events.push({
          ...base(),
          type: 'user',
          kind,
          content: t.text,
          truncated: t.truncated,
          fullLength: t.fullLength,
          images,
          imageBlocks: blocks ? blocks.map((b, i) => (b?.type === 'image' ? i : -1)).filter((i) => i >= 0) : [],
          permissionMode: o.permissionMode,
          entrypoint: o.entrypoint,
        });
      } else {
        // meta / system-reminder / task-notification / command-output / agent-report
        const t = text(raw, 16 * 1024);
        events.push({ ...base(), type: 'metadata', kind, content: t.text, truncated: t.truncated, fullLength: t.fullLength, origin: o.origin?.kind, originFrom: o.origin?.from || o.origin?.senderTaskId || null });
      }
      break;
    }
    case 'assistant': {
      const m = o.message || {};
      const blocks = Array.isArray(m.content) ? m.content : typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : [];
      const common = {
        model: m.model && m.model !== '<synthetic>' ? m.model : null,
        messageId: m.id || null,
        requestId: o.requestId || null,
        stopReason: m.stop_reason || null,
        usage: m.usage
          ? {
              input: m.usage.input_tokens ?? null,
              output: m.usage.output_tokens ?? null,
              cacheRead: m.usage.cache_read_input_tokens ?? null,
              cacheCreate: m.usage.cache_creation_input_tokens ?? null,
              thinking: m.usage.output_tokens_details?.thinking_tokens ?? null,
              serviceTier: m.usage.service_tier ?? null,
              speed: m.usage.speed ?? null,
            }
          : null,
        effort: o.effort ?? null,
        synthetic: m.model === '<synthetic>',
      };
      if (o.isApiErrorMessage || o.error) {
        const t = text(blocks.map((b) => b?.text || '').join('\n'));
        events.push({ ...base(), type: 'error', subtype: 'api', content: t.text || String(o.error || 'API error'), ...common });
        break;
      }
      if (blocks.length === 0) {
        events.push({ ...base(), type: 'assistant', content: '', empty: true, ...common });
        break;
      }
      blocks.forEach((b, i) => {
        const id = `${base().id}#${o.apiBlockIndex ?? i}`;
        if (!b || typeof b !== 'object') return;
        if (b.type === 'text') {
          const t = text(b.text || '');
          events.push({ ...base(), id, block: i, type: 'assistant', content: t.text, truncated: t.truncated, fullLength: t.fullLength, ...common });
        } else if (b.type === 'thinking') {
          const t = text(b.thinking || '');
          events.push({ ...base(), id, block: i, type: 'thinking', content: t.text, truncated: t.truncated, fullLength: t.fullLength, redacted: !b.thinking && !!b.signature, ...common });
        } else if (b.type === 'redacted_thinking') {
          events.push({ ...base(), id, type: 'thinking', content: '', redacted: true, ...common });
        } else if (b.type === 'tool_use') {
          let input = b.input;
          let inputTruncated = false;
          try {
            const s = JSON.stringify(input);
            if (s && s.length > MAX_INLINE_TEXT * 2) {
              input = { _truncated: true, _length: s.length, preview: s.slice(0, MAX_INLINE_TEXT) };
              inputTruncated = true;
            }
          } catch {
            input = String(input);
          }
          events.push({
            ...base(),
            id,
            block: i,
            type: 'tool_call',
            toolUseId: b.id,
            tool: b.name,
            input,
            inputTruncated,
            caller: b.caller?.type || null,
            ...common,
          });
        } else {
          events.push({ ...base(), id, type: 'unknown', label: `assistant block: ${b.type}`, ...common });
        }
      });
      break;
    }
    case 'attachment': {
      const att = o.attachment || {};
      events.push({
        ...base(),
        type: 'attachment',
        attachmentType: att.type || 'unknown',
        preview: attachmentPreview(att),
        rendered: Array.isArray(o.rendered) ? o.rendered.length : 0,
      });
      break;
    }
    case 'system': {
      const st = o.subtype || 'system';
      if (st === 'api_error' || o.level === 'error') {
        events.push({
          ...base(),
          type: 'error',
          subtype: st,
          content: o.error?.formatted || o.error?.message || o.content || 'error',
          retry: o.retryAttempt != null ? { attempt: o.retryAttempt, max: o.maxRetries, inMs: o.retryInMs } : null,
          status: o.error?.status ?? null,
        });
      } else if (st === 'turn_duration') {
        events.push({ ...base(), type: 'metadata', kind: 'turn_duration', durationMs: o.durationMs ?? null, messageCount: o.messageCount ?? null, content: '' });
      } else {
        const t = text(typeof o.content === 'string' ? o.content : '', 16 * 1024);
        events.push({ ...base(), type: 'system', subtype: st, level: o.level || 'info', content: t.text, truncated: t.truncated, durationMs: o.durationMs ?? null });
      }
      break;
    }
    default: {
      const labelFn = NON_MESSAGE_LABELS[o.type];
      let label;
      try {
        label = labelFn ? labelFn(o) : `${o.type || 'unknown record'}`;
      } catch {
        label = String(o.type);
      }
      events.push({
        ...base(),
        id: `${fileKey}:${rec.line}`,
        type: labelFn ? 'metadata' : 'unknown',
        kind: o.type || 'unknown',
        content: label,
        ts: typeof o.timestamp === 'string' ? o.timestamp : null,
      });
    }
  }
  return events;
}

export function normalizeRecords(records, fileKey = 'main', opts) {
  const out = [];
  for (const r of records) {
    try {
      for (const e of normalizeRecord(r, fileKey, opts)) out.push(e);
    } catch (err) {
      out.push({ id: `${fileKey}:${r.line}`, type: 'unknown', label: `normalize failed: ${err.message}`, ref: ref(fileKey, r) });
    }
  }
  return out;
}
