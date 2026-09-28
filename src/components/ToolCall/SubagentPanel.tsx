// Lazily loads and renders a sub-agent transcript inside its Agent tool call.
import { useState } from 'react';
import type { SessionEvent, SubagentSummary, SubagentRead } from '@/types/session';
import { api } from '@/services/api';
import { Icon } from '@/components/common/Icon';
import { formatCost, formatDuration, formatNumber, modelLabel, plural } from '@/utils/format';
import { Timeline } from '@/components/Timeline/Timeline';

interface Props {
  sessionId: string;
  agent: SubagentSummary;
  onRaw: (e: SessionEvent) => void;
  query?: string;
  outputLines: number;
}

export function SubagentPanel({ sessionId, agent, onRaw, query, outputLines }: Props) {
  const [data, setData] = useState<SubagentRead | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dur = agent.startedAt && agent.endedAt ? Date.parse(agent.endedAt) - Date.parse(agent.startedAt) : null;
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !data && !loading) {
      setLoading(true);
      try {
        setData(await api.readSubagent(sessionId, agent.agentId));
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    }
  };
  return (
    <div>
      <div className="kv">
        <span className="k">type</span><span className="v">{agent.agentType || '—'}</span>
        <span className="k">description</span><span className="v">{agent.description || '—'}</span>
        <span className="k">agent id</span><span className="v mono">{agent.agentId}</span>
        {agent.model && (<><span className="k">model</span><span className="v">{modelLabel(agent.model)}</span></>)}
        {agent.usage && (<><span className="k">tokens</span><span className="v mono">{formatNumber(agent.usage.input + agent.usage.cacheRead + agent.usage.cacheCreate)} in ({formatNumber(agent.usage.cacheRead)} cache read · {formatNumber(agent.usage.cacheCreate)} cache write · {formatNumber(agent.usage.input)} uncached) · {formatNumber(agent.usage.output)} out{agent.usage.thinking ? ` (${formatNumber(agent.usage.thinking)} thinking)` : ''}</span></>)}
        {agent.estimate && (
          <>
            <span className="k">cost (est.)</span>
            <span className="v">
              ≈ {formatCost(agent.estimate.totalUSD)}
              {!agent.estimate.complete && <span className="chip warn" style={{ marginLeft: 6 }}>partial — missing rates</span>}
              {Object.keys(agent.usageByModel).length > 1 && <span className="help-text"> · {Object.keys(agent.usageByModel).map(modelLabel).join(', ')}</span>}
              <span className="help-text"> · tokens × rates from Settings → Pricing, included in the session cost</span>
            </span>
          </>
        )}
        {agent.counts && (<><span className="k">activity</span><span className="v">{plural(agent.counts.assistantMessages, 'message')} · {plural(agent.counts.toolCalls, 'tool call')}{agent.counts.errors ? ` · ${plural(agent.counts.errors, 'error')}` : ''}{dur != null ? ` · ${formatDuration(dur)}` : ''}</span></>)}
      </div>
      <button type="button" className="btn sm" style={{ marginTop: 8 }} onClick={() => void toggle()} aria-expanded={open}>
        <Icon name={open ? 'chevronDown' : 'chevron'} size={11} /> {open ? 'Hide' : 'Show'} sub-agent timeline
      </button>
      {open && (
        <div className="subagent-panel">
          {loading && <div className="help-text">Loading sub-agent transcript…</div>}
          {err && <div className="error-text">{err}</div>}
          {data && <Timeline events={data.events} sessionId={sessionId} onRaw={onRaw} query={query} outputLines={outputLines} nested subagents={[]} />}
        </div>
      )}
    </div>
  );
}
