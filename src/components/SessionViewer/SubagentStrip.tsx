// Sub-agents spawned by this session, one row each, on the session's time axis so parallel
// fan-outs and long-running agents stand out. Each row links to the Agent tool call that
// started it.
import { useMemo, useState } from 'react';
import type { SubagentSummary } from '@/types/session';
import { Icon } from '@/components/common/Icon';
import { formatClock, formatDuration, modelLabel } from '@/utils/format';

type Sort = 'start' | 'duration' | 'errors';

interface Props {
  agents: SubagentSummary[];
  onJump: (toolUseId: string | null) => void;
  primaryModel: string | null;
  sessionStart: string | null;
  sessionEnd: string | null;
}

export function SubagentStrip({ agents, onJump, primaryModel, sessionStart, sessionEnd }: Props) {
  const [sort, setSort] = useState<Sort>('start');
  const t0 = Date.parse(sessionStart || '');
  const t1 = Date.parse(sessionEnd || '');
  const span = Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0 ? t1 - t0 : null;
  const rows = useMemo(() => {
    const withDur = agents.map((a) => {
      const s = Date.parse(a.startedAt || '');
      const e = Date.parse(a.endedAt || '');
      return { a, s: Number.isFinite(s) ? s : null, e: Number.isFinite(e) ? e : null, dur: Number.isFinite(s) && Number.isFinite(e) ? e - s : null };
    });
    return withDur.sort((x, y) =>
      sort === 'duration' ? (y.dur ?? -1) - (x.dur ?? -1) : sort === 'errors' ? (y.a.counts?.errors ?? 0) - (x.a.counts?.errors ?? 0) || (x.s ?? 0) - (y.s ?? 0) : (x.s ?? Infinity) - (y.s ?? Infinity),
    );
  }, [agents, sort]);
  const types = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of agents) m.set(a.agentType || 'agent', (m.get(a.agentType || 'agent') || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [agents]);

  return (
    <div className="agents-panel" aria-label="Sub-agents">
      <div className="agents-head">
        <span className="lbl"><Icon name="agent" size={12} /> {agents.length} sub-agent{agents.length === 1 ? '' : 's'}</span>
        <span className="agents-types">{types.map(([t, n]) => <span key={t} className="chip agent-type">{t} ×{n}</span>)}</span>
        <span className="grow" />
        <span className="help-text">Sort</span>
        <div className="seg-control sm" role="radiogroup" aria-label="Sort sub-agents">
          {(['start', 'duration', 'errors'] as Sort[]).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={sort === k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>{k === 'start' ? 'Start' : k === 'duration' ? 'Duration' : 'Errors'}</button>
          ))}
        </div>
      </div>
      <div className="agents-list">
        {rows.map(({ a, s, e, dur }) => {
          const left = span && s != null ? ((s - t0) / span) * 100 : null;
          const width = span && dur != null ? Math.max(0.6, (dur / span) * 100) : null;
          const errs = a.counts?.errors ?? 0;
          const other = !!(a.model && a.model !== primaryModel);
          return (
            <button key={a.agentId} type="button" className={`agent-row ${errs ? 'has-error' : ''}`} onClick={() => onJump(a.toolUseId)} disabled={!a.toolUseId} title={`${a.agentId}${a.model ? `\n${a.model}` : ''}\n\n${a.prompt || a.description || ''}\n\nClick to jump to the Agent call that spawned it`}>
              <span className="agent-type-cell">{a.agentType || 'agent'}</span>
              <span className="agent-desc">{a.description || a.prompt || a.agentId}</span>
              <span className="agent-model">{a.model ? <span className={other ? 'chip warn' : 'muted'}>{modelLabel(a.model)}</span> : null}</span>
              <span className="agent-num" title="Tool calls">{a.counts ? a.counts.toolCalls : '–'}<small> tools</small></span>
              <span className={`agent-num ${errs ? 'err' : 'muted'}`} title="Errors inside this agent">{errs}<small> err</small></span>
              <span className="agent-num" title={s != null ? `${formatClock(a.startedAt)} → ${formatClock(a.endedAt)}` : ''}>{dur != null ? formatDuration(dur) : '–'}</span>
              <span className="agent-track" aria-hidden="true">
                {left != null && <i style={{ left: `${left}%`, width: `${width ?? 0.6}%` }} className={errs ? 'err' : ''} />}
                {e == null && left != null && <i className="open" style={{ left: `${left}%` }} />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
