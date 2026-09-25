// Compact "where did the time go" strip for the whole session. Each gap between
// consecutive timestamped events is attributed to what ended it: model output,
// a tool result, or the user (waiting for input).
import { useMemo } from 'react';
import type { SessionEvent } from '@/types/session';
import { eventTs } from '@/utils/events';
import { formatDuration } from '@/utils/format';

type Seg = { start: number; end: number; kind: 'assistant' | 'tool' | 'user' | 'error'; id: string; label: string };

export function TimelineBar({ events, onJump }: { events: SessionEvent[]; onJump: (id: string) => void }) {
  const { segs, start, end, totals } = useMemo(() => {
    const segs: Seg[] = [];
    const totals = { assistant: 0, tool: 0, user: 0, error: 0 };
    let prev: number | null = null;
    let start: number | null = null;
    let end: number | null = null;
    for (const e of events) {
      const t = eventTs(e);
      if (t == null) continue;
      if (start == null) start = t;
      end = t;
      if (prev != null && t > prev) {
        let kind: Seg['kind'] | null = null;
        let label = '';
        if (e.type === 'assistant' || e.type === 'thinking' || e.type === 'tool_call') {
          kind = 'assistant';
          label = e.type === 'tool_call' ? `model → ${e.tool}` : 'model';
        } else if (e.type === 'tool_result') {
          kind = e.isError ? 'error' : 'tool';
          label = `tool result${e.isError ? ' (error)' : ''}`;
        } else if (e.type === 'user' && e.kind === 'human') {
          kind = 'user';
          label = 'waiting for user';
        } else if (e.type === 'error') {
          kind = 'error';
          label = 'error';
        }
        if (kind) {
          segs.push({ start: prev, end: t, kind, id: e.id, label });
          totals[kind] += t - prev;
        }
      }
      prev = t;
    }
    return { segs, start, end, totals };
  }, [events]);
  if (start == null || end == null || end <= start) return null;
  const span = end - start;
  return (
    <div className="tbar" title="Each gap between events is attributed to what ended it. Click a segment to jump to that event.">
      <div className="track" role="img" aria-label="Session time distribution">
        {segs.map((s, i) => (
          <div
            key={i}
            className={`seg ${s.kind}`}
            style={{ left: `${((s.start - start) / span) * 100}%`, width: `${Math.max(0.05, ((s.end - s.start) / span) * 100)}%` }}
            title={`${s.label} · ${formatDuration(s.end - s.start)}`}
            onClick={() => onJump(s.id)}
          />
        ))}
      </div>
      <div className="legend">
        <span><i style={{ background: 'var(--accent)' }} />Model {formatDuration(totals.assistant)}</span>
        <span><i style={{ background: 'var(--tool)' }} />Tools {formatDuration(totals.tool)}</span>
        <span><i style={{ background: 'var(--user)' }} />Waiting for user {formatDuration(totals.user)}</span>
        {totals.error > 0 && <span><i style={{ background: 'var(--error)' }} />Errors {formatDuration(totals.error)}</span>}
        <span style={{ marginLeft: 'auto' }}>Span {formatDuration(span)}</span>
      </div>
    </div>
  );
}
