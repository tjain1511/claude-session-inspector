// Helpers for pulling readable text out of Claude Code transcript records.
// The transcript is Anthropic Messages API shaped: message.content is either a string
// or an array of blocks ({type: 'text'|'thinking'|'tool_use'|'tool_result'|'image'}).

export const MAX_INLINE_TEXT = 64 * 1024; // per event text sent to the UI before truncation

/** Text of a tool_result block's content (string or array of text/image blocks). */
export function toolResultText(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (!b || typeof b !== 'object') return String(b);
        if (b.type === 'text') return b.text ?? '';
        if (b.type === 'image') return `[image ${b.source?.media_type || ''}]`.trim();
        return JSON.stringify(b);
      })
      .join('\n');
  }
  if (typeof content === 'object') return JSON.stringify(content, null, 2);
  return String(content);
}

/** Classify a user-role record into what it actually is. */
export function classifyUserRecord(rec) {
  const msg = rec.message || {};
  const c = msg.content;
  if (rec.isMeta) return 'meta';
  const originKind = rec.origin?.kind;
  if (originKind === 'task-notification') return 'task-notification';
  if (originKind === 'peer' || originKind === 'coordinator') return 'agent-report';
  if (Array.isArray(c) && c.length && c.every((b) => b && b.type === 'tool_result')) return 'tool_result';
  const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b?.type === 'text').map((b) => b.text || '').join('\n') : '';
  const t = text.trimStart();
  if (t.startsWith('[Request interrupted by user')) return 'interrupted';
  if (t.startsWith('<command-name>')) return 'command';
  if (t.startsWith('<local-command-stdout>') || t.startsWith('<local-command-caveat>')) return 'command-output';
  if (t.startsWith('<system-reminder>')) return 'system-reminder';
  if (t.startsWith('<task-notification>')) return 'task-notification';
  return 'human';
}

/** Parse a `<command-name>/foo</command-name><command-args>..</command-args>` message. */
export function parseCommandMessage(text) {
  const get = (tag) => {
    const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    return m ? m[1].trim() : '';
  };
  return { name: get('command-name'), args: get('command-args'), message: get('command-message') };
}

/** Plain text of a user message (text blocks only; images noted). */
export function userText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const b of content) {
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'text') parts.push(b.text || '');
    else if (b.type === 'image') parts.push(`[image ${b.source?.media_type || ''}]`.trim());
  }
  return parts.join('\n');
}

/** Turn a human prompt into a short, readable session title. */
export function titleFromPrompt(text) {
  if (!text) return '';
  let t = text
    .replace(/<pasted_content[^>]*>/g, '')
    .replace(/<\/pasted_content>/g, '')
    .replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/g, '')
    .replace(/<ide_selection>[\s\S]*?<\/ide_selection>/g, '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/\[Image #\d+\]/g, '')
    .replace(/\[image[^\]]*\]/g, '');
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  let first = lines.find((l) => !/^<[a-z_-]+>/.test(l)) || '';
  first = first.replace(/^#+\s*/, '').replace(/^[>*-]\s+/, '').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
  if (first.length > 80) first = first.slice(0, 77).trimEnd() + '…';
  return first;
}

export function truncateText(text, max = MAX_INLINE_TEXT) {
  if (typeof text !== 'string') return { text: '', truncated: false, fullLength: 0 };
  if (text.length <= max) return { text, truncated: false, fullLength: text.length };
  return { text: text.slice(0, max), truncated: true, fullLength: text.length };
}

/** Short one-line preview of an attachment record (injected context, not user content). */
export function attachmentPreview(att) {
  if (!att || typeof att !== 'object') return '';
  const t = att.type;
  switch (t) {
    case 'environment':
      return att.snapshot?.workingDirectory ? `cwd ${att.snapshot.workingDirectory}` : '';
    case 'model':
      return att.model ? String(att.model) : '';
    case 'date':
      return att.date ? String(att.date) : '';
    case 'total_tokens_reminder':
      return att.totalTokens != null ? `${att.totalTokens} tokens left` : '';
    case 'deferred_tools_delta':
      return `${att.addedNames?.length || 0} added, ${att.removedNames?.length || 0} removed`;
    case 'skill_listing':
      return `${(att.skills || att.commands || []).length || ''} skills`.trim();
    case 'opened_file_in_ide':
    case 'edited_text_file':
      return att.filename || att.path || '';
    case 'queued_command':
      return typeof att.prompt === 'string' ? att.prompt.slice(0, 120) : '';
    default: {
      const keys = Object.keys(att).filter((k) => k !== 'type');
      return keys.slice(0, 4).join(', ');
    }
  }
}

export function stringifyShort(v, max = 2000) {
  try {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s.length > max ? s.slice(0, max) : s;
  } catch {
    return '';
  }
}
