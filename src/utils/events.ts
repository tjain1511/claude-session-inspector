// Client-side helpers over normalized events.
import type { SessionEvent } from '@/types/session';

export function eventTs(e: SessionEvent): number | null {
  if (!e.ts) return null;
  const t = Date.parse(e.ts);
  return Number.isFinite(t) ? t : null;
}

/** One-line description of a tool call derived from its input, for card headers. */
export function toolSummary(tool: string | undefined, input: unknown): string {
  if (!input || typeof input !== 'object') return typeof input === 'string' ? input.slice(0, 200) : '';
  const i = input as Record<string, unknown>;
  const str = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : '');
  switch (tool) {
    case 'Bash':
      return str('description') || firstLine(str('command'));
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return str('file_path') || str('notebook_path');
    case 'Grep':
      return `${str('pattern')}${str('path') ? '  in ' + str('path') : ''}${str('glob') ? '  ' + str('glob') : ''}`;
    case 'Glob':
      return `${str('pattern')}${str('path') ? '  in ' + str('path') : ''}`;
    case 'Agent':
    case 'Task':
      return str('description') || firstLine(str('prompt'));
    case 'WebFetch':
    case 'WebSearch':
      return str('url') || str('query');
    case 'Skill':
      return `${str('skill')} ${str('args')}`.trim();
    case 'TodoWrite':
      return Array.isArray(i.todos) ? `${(i.todos as unknown[]).length} todos` : '';
    case 'AskUserQuestion':
      return Array.isArray(i.questions) ? firstLine(String((i.questions as { question?: string }[])[0]?.question || '')) : '';
    default: {
      for (const k of ['description', 'query', 'command', 'path', 'file_path', 'url', 'prompt', 'message', 'name', 'title']) {
        if (str(k)) return firstLine(str(k));
      }
      const keys = Object.keys(i);
      return keys.length ? keys.slice(0, 4).join(', ') : '';
    }
  }
}

export function firstLine(s: string): string {
  const l = s.split('\n').find((x) => x.trim()) || '';
  return l.length > 160 ? l.slice(0, 157) + '…' : l;
}

/** Text an event contributes to in-session search. */
export function eventSearchText(e: SessionEvent): string {
  const parts: string[] = [];
  if (e.content) parts.push(e.content);
  if (e.tool) parts.push(e.tool);
  if (e.input !== undefined) {
    try {
      parts.push(typeof e.input === 'string' ? e.input : JSON.stringify(e.input));
    } catch {
      /* ignore */
    }
  }
  if (e.preview) parts.push(e.preview);
  if (e.attachmentType) parts.push(e.attachmentType);
  if (e.label) parts.push(e.label);
  if (e.model) parts.push(e.model);
  return parts.join('\n').toLowerCase();
}

/** Extract the full text for an event from its raw record (used after server-side truncation). */
export function fullTextFromRaw(e: SessionEvent, raw: unknown): string | null {
  const r = raw as { message?: { content?: unknown }; content?: unknown } | null;
  if (!r || typeof r !== 'object') return null;
  const content = r.message?.content;
  if (e.type === 'user' && typeof content === 'string') return content;
  if (!Array.isArray(content)) return typeof r.content === 'string' ? r.content : null;
  if (e.type === 'user') {
    return content.map((b) => (b?.type === 'text' ? b.text : b?.type === 'image' ? `[image ${b.source?.media_type || ''}]` : '')).join('\n');
  }
  const b = e.block != null ? content[e.block] : content[0];
  if (!b) return null;
  if (b.type === 'tool_result') {
    const c = b.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map((x) => (x?.type === 'text' ? x.text : x?.type === 'image' ? '[image]' : JSON.stringify(x))).join('\n');
    return JSON.stringify(c, null, 2);
  }
  if (b.type === 'text') return b.text ?? '';
  if (b.type === 'thinking') return b.thinking ?? '';
  return null;
}
