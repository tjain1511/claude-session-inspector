// Compact "where did the time go" strip for the whole session. Each gap between
// consecutive timestamped events is attributed to what ended it: model output,
// a tool result, or the user (waiting for input).
import { useMemo } from 'react';
import type { SessionEvent } from '@/types/session';
import { eventTs } from '@/utils/events';
import { formatDuration } from '@/utils/format';

type Seg = { start: number; end: number; kind: 'assistant' | 'tool' | 'user' | 'error' | null; id: string; label: string };

/** With `compressIdle`, waits for the user (and unattributed gaps) longer than a small share of the
 *  working time are drawn at that share and hatched, so hours of idle do not squash the actual work. */
export function TimelineBar({ events, onJump, compressIdle = true, onToggleCompress }: { events: SessionEvent[]; onJump: (id: string) => void; compressIdle?: boolean; onToggleCompress?: () => void }) {
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
        segs.push({ start: prev, end: t, kind, id: e.id, label: label || 'other' });
        if (kind) totals[kind] += t - prev;
      }
      prev = t;
    }
    return { segs, start, end, totals };
  }, [events]);
  if (start == null || end == null || end <= start) return null;
  const span = end - start;
  const work = totals.assistant + totals.tool + totals.error;
  const cap = compressIdle && work > 0 ? Math.max(work * 0.015, 1000) : Infinity;
  let squeezed = 0;
  const layout: { left: number; width: number; s: Seg; squeezed: boolean }[] = [];
  let acc = 0;
  for (const sg of segs) {
    const d = sg.end - sg.start;
    const idle = sg.kind === 'user' || sg.kind === null;
    const w = idle && d > cap ? cap : d;
    if (w < d) squeezed += d - w;
    layout.push({ left: acc, width: w, s: sg, squeezed: w < d });
    acc += w;
  }
  const total = acc || span;
  return (
    <div className="tbar" title="Each gap between events is attributed to what ended it. Click a segment to jump to that event.">
      <div className="track" role="img" aria-label="Session time distribution">
        {layout.map(({ left, width, s, squeezed: sq }, i) =>
          s.kind || sq ? (
            <div
              key={i}
              className={`seg ${s.kind ?? 'idle'} ${sq ? 'squeezed' : ''}`}
              style={{ left: `${(left / total) * 100}%`, width: `${Math.max(0.05, (width / total) * 100)}%` }}
              title={`${s.label} · ${formatDuration(s.end - s.start)}${sq ? ' (drawn compressed)' : ''}`}
              onClick={() => onJump(s.id)}
            />
          ) : null,
        )}
      </div>
      <div className="legend">
        <span><i style={{ background: 'var(--accent)' }} />Model {formatDuration(totals.assistant)}</span>
        <span><i style={{ background: 'var(--tool)' }} />Tools {formatDuration(totals.tool)}</span>
        <span><i style={{ background: 'var(--user)' }} />Waiting for user {formatDuration(totals.user)}</span>
        {totals.error > 0 && <span><i style={{ background: 'var(--error)' }} />Errors {formatDuration(totals.error)}</span>}
        <span className="grow" />
        {onToggleCompress && (squeezed > 0 || !compressIdle) && (
          <button type="button" className={`legend-btn ${compressIdle ? 'on' : ''}`} onClick={onToggleCompress} aria-pressed={compressIdle} title="Draw long waits narrow so the working time is readable">
            <i className="hatch" />{compressIdle ? `Idle compressed (${formatDuration(squeezed)} hidden)` : 'Compress idle time'}
          </button>
        )}
        <span>Span {formatDuration(span)}</span>
      </div>
    </div>
  );
}
