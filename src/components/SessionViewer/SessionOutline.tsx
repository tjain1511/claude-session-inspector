// Turn-by-turn outline of a session: a navigable map for long-running runs. Each user
// turn shows how long it took, how much model/tool time it burned, what went wrong and
// which sub-agents (and models) it spawned, so a generator→critic loop or a stuck
// retry cycle stands out at a glance. Click a turn or an agent to jump to it.
import { useEffect, useMemo, useRef } from 'react';
import type { SessionEvent, SessionSummary, SubagentSummary } from '@/types/session';
import { buildTurns } from '@/components/Timeline/ToolGantt';
import { Icon } from '@/components/common/Icon';
import { formatDuration, formatNumber, modelLabel } from '@/utils/format';

interface Props {
  session: SessionSummary;
  events: SessionEvent[];
  onJump: (eventId: string) => void;
  onJumpAgent: (toolUseId: string | null) => void;
  onClose: () => void;
  activeId?: string | null; // prompt id of the turn at the top of the flow
}

export function SessionOutline({ session: s, events, onJump, onJumpAgent, onClose, activeId }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!activeId) return;
    const el = listRef.current?.querySelector(`[data-turn="${CSS.escape(activeId)}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);
  const turns = useMemo(() => buildTurns(events, s.subagents), [events, s.subagents]);
  const agentTypes = useMemo(() => {
    const m = new Map<string, { count: number; models: Set<string> }>();
    for (const a of s.subagents) {
      const k = a.agentType || 'agent';
      const e = m.get(k) || { count: 0, models: new Set<string>() };
      e.count++;
      if (a.model) e.models.add(a.model);
      m.set(k, e);
    }
    return [...m.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [s.subagents]);
  const maxSpan = turns.reduce((m, t) => Math.max(m, t.end - t.start), 1);
  const totalErrors = turns.reduce((n, t) => n + t.errors, 0);

  return (
    <aside className="outline" aria-label="Session outline">
      <div className="outline-head">
        <span><Icon name="list" size={12} /> Outline</span>
        <span className="help-text">{turns.length} turn{turns.length === 1 ? '' : 's'}{totalErrors ? ` · ${totalErrors} err` : ''}</span>
        <button type="button" className="btn icon ghost sm" onClick={onClose} aria-label="Hide outline"><Icon name="x" size={12} /></button>
      </div>
      {agentTypes.length > 0 && (
        <div className="outline-agents">
          {agentTypes.map(([type, e]) => (
            <span key={type} className="chip" title={[...e.models].join(', ') || 'model not recorded'}>
              <Icon name="agent" size={10} /> {type} ×{e.count}
              {[...e.models].some((m) => m !== s.model) && <span className="model">{[...e.models].filter((m) => m !== s.model).map(modelLabel).join('/')}</span>}
            </span>
          ))}
        </div>
      )}
      <div className="outline-list" ref={listRef}>
        {turns.map((t) => {
          const span = t.end - t.start;
          const w = Math.max(2, (span / maxSpan) * 100);
          const modelPct = span > 0 ? (t.modelMs / span) * 100 : 0;
          const toolPct = span > 0 ? (t.toolMs / span) * 100 : 0;
          return (
            <div key={t.promptId} data-turn={t.promptId} className={`outline-turn ${t.errors ? 'has-error' : ''} ${activeId === t.promptId ? 'active' : ''}`} aria-current={activeId === t.promptId ? 'step' : undefined}>
              <button type="button" className="outline-turn-head" onClick={() => onJump(t.promptId)} title={t.prompt}>
                <span className="no">{t.idx}</span>
                <span className="prompt">{t.prompt || '(prompt)'}</span>
              </button>
              <div className="outline-bar" title={`model ${formatDuration(t.modelMs)} · tools ${formatDuration(t.toolMs)} · waiting ${formatDuration(Math.max(0, span - t.modelMs - t.toolMs))}`}>
                <div className="track" style={{ width: `${w}%` }}>
                  <i className="model" style={{ width: `${modelPct}%` }} />
                  <i className="tool" style={{ width: `${toolPct}%` }} />
                </div>
                <span className="dur">{formatDuration(span)}</span>
              </div>
              <div className="outline-stats">
                <span title="Model calls">{t.modelCalls} calls</span>
                <span title="Tool calls">{t.toolCalls} tools</span>
                {t.tokensOut > 0 && <span title="Output tokens in this turn">{formatNumber(t.tokensOut)} out</span>}
                {t.errors > 0 && <span className="err" title="Errors in this turn">{t.errors} err</span>}
                {t.maxParallel > 1 && <span title="Max concurrent tool calls">∥{t.maxParallel}</span>}
              </div>
              {t.agents.length > 0 && (
                <div className="outline-agent-list">
                  {t.agents.map((a: SubagentSummary) => (
                    <button key={a.agentId} type="button" className="outline-agent" onClick={() => onJumpAgent(a.toolUseId)} title={`${a.agentId}\n${a.prompt || ''}`}>
                      <Icon name="agent" size={10} />
                      <span className="type">{a.agentType || 'agent'}</span>
                      {a.model && a.model !== s.model && <span className="chip warn model">{modelLabel(a.model)}</span>}
                      <span className="desc">{a.description || a.prompt || ''}</span>
                      {a.counts?.errors ? <span className="err">{a.counts.errors} err</span> : null}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {!turns.length && <div className="help-text" style={{ padding: 12 }}>No user turns yet.</div>}
      </div>
    </aside>
  );
}
