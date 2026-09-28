// Key numbers for the open session as one compact strip. Every value comes from the
// summary the server built from the transcript; fields with no data are left out.
import type { ReactNode } from 'react';
import type { SessionSummary } from '@/types/session';
import { formatCost, formatDateTime, formatDuration, formatNumber, formatShortDateTime, modelLabel } from '@/utils/format';
import { Icon } from '@/components/common/Icon';
import { recordedRows, estimatedRows, sessionCost, subagentTotals } from './CostTable';
import { CHANGE_OPS, OP_LABEL, openMemory, sessionMemoryOps } from '@/utils/memory';

interface StatProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  title?: string;
  tone?: 'error' | 'warn' | 'ok' | 'agent';
  onClick?: () => void;
  active?: boolean;
}

function Stat({ label, value, sub, title, tone, onClick, active }: StatProps) {
  const body = (
    <>
      <span className="stat-k">{label}</span>
      <span className="stat-v">{value}</span>
      {sub != null && sub !== '' && <span className="stat-sub">{sub}</span>}
    </>
  );
  const cls = `stat ${tone ? `tone-${tone}` : ''} ${onClick ? 'clickable' : ''} ${active ? 'active' : ''}`;
  return onClick ? (
    <button type="button" className={cls} title={title} onClick={onClick} aria-pressed={active}>
      {body}
    </button>
  ) : (
    <div className={cls} title={title}>
      {body}
    </div>
  );
}

interface Props {
  session: SessionSummary;
  onShowMetadata?: () => void;
  onShowErrors?: () => void;
  errorsActive?: boolean;
  onToggleAgents?: () => void;
  agentsOpen?: boolean;
}

export function SessionOverview({ session: s, onShowMetadata, onShowErrors, errorsActive, onToggleAgents, agentsOpen }: Props) {
  const c = s.counts;
  // Models seen anywhere: main transcript plus each sub-agent transcript.
  const agentModels = new Map<string, number>();
  for (const a of s.subagents) if (a.model && a.model !== s.model) agentModels.set(a.model, (agentModels.get(a.model) || 0) + 1);
  const extraModels = Math.max(0, s.models.length - 1) + agentModels.size;
  const modelTitle = [...s.models.map((m) => `${m.name} ×${m.count} messages`), ...[...agentModels].map(([m, n]) => `${m} in ${n} sub-agent${n === 1 ? '' : 's'}`)].join('\n');
  const cost = sessionCost(s);
  const rows = cost?.estimated ? estimatedRows(s.estimate) : recordedRows(s);
  const costTitle = cost
    ? rows.map((r) => `${modelLabel(r.model)}: ${r.cost != null ? formatCost(r.cost) : 'no rate'}`).join('\n') +
      (cost.estimated ? '\nEstimated from token usage × the rate table (Settings → Pricing); Claude Code has not written a cost record for this session yet' : '\nAs recorded by Claude Code') +
      '\nClick for the per-model breakdown'
    : '';
  // Tokens: main transcript plus every sub-agent transcript, so the count matches the cost.
  const agents = subagentTotals(s);
  const au = agents.usage;
  const mainIn = s.usage.input + s.usage.cacheRead + s.usage.cacheCreate;
  const agentIn = au.input + au.cacheRead + au.cacheCreate;
  const tokensIn = mainIn + agentIn;
  const tokensOut = s.usage.output + au.output;
  const cacheHit = tokensIn > 0 ? (s.usage.cacheRead + au.cacheRead) / tokensIn : null;
  const agentShare = tokensIn + tokensOut > 0 ? (agentIn + au.output) / (tokensIn + tokensOut) : 0;
  const usageLines = (u: typeof au) => `  uncached input ${formatNumber(u.input)}\n  cache read ${formatNumber(u.cacheRead)}\n  cache write ${formatNumber(u.cacheCreate)}\n  output ${formatNumber(u.output)}${u.thinking ? `\n  of which thinking ${formatNumber(u.thinking)}` : ''}`;
  const tokensTitle = s.subagents.length
    ? `Summed over API messages in the main transcript and ${s.subagents.length} sub-agent transcript${s.subagents.length === 1 ? '' : 's'}\n\nMain: ${formatNumber(mainIn)} in · ${formatNumber(s.usage.output)} out\n${usageLines(s.usage)}\n\nSub-agents: ${formatNumber(agentIn)} in · ${formatNumber(au.output)} out (${Math.round(agentShare * 100)}%)\n${usageLines(au)}`
    : `Summed over API messages in the main transcript\n${usageLines(s.usage)}`;
  const agentErrors = s.subagents.reduce((n, a) => n + (a.counts?.errors ?? 0), 0);
  const topTool = s.tools[0];
  const memOps = sessionMemoryOps(s);
  const memChanges = memOps.filter((o) => CHANGE_OPS.has(o.op));
  const memNotes = [...new Set(memChanges.map((o) => o.file))];
  const memReads = memOps.filter((o) => o.op === 'read').length;

  return (
    <div className="stats" role="group" aria-label="Session summary">
      <Stat
        label="Model"
        value={s.model ? modelLabel(s.model) : '—'}
        sub={extraModels > 0 ? `+${extraModels} other${extraModels === 1 ? '' : 's'}` : undefined}
        tone={extraModels > 0 ? 'warn' : undefined}
        title={modelTitle || undefined}
      />
      <Stat label="Started" value={formatShortDateTime(s.startedAt) || '—'} title={formatDateTime(s.startedAt)} />
      <Stat
        label="Duration"
        value={formatDuration(s.durationMs) || '—'}
        sub={s.cost?.totalDuration ? `${formatDuration(s.cost.totalDuration)} in Claude Code` : undefined}
        title={`First to last event in the transcript${s.cost?.totalDuration ? `\n${formatDuration(s.cost.totalDuration)}: wall-clock time recorded by Claude Code's cost-state (includes resumed runs)` : ''}${s.cost?.totalAPIDuration ? `\nAPI: ${formatDuration(s.cost.totalAPIDuration)}` : ''}${s.cost?.totalToolDuration ? `\nTools: ${formatDuration(s.cost.totalToolDuration)}` : ''}`}
      />
      <Stat label="Turns" value={c.userMessages.toLocaleString()} sub={`${c.assistantMessages.toLocaleString()} replies`} title={`${c.userMessages} user messages · ${c.assistantMessages} Claude messages`} />
      <Stat
        label="Tool calls"
        value={c.toolCalls.toLocaleString()}
        sub={topTool ? `${topTool.name} ×${topTool.count}` : undefined}
        title={s.tools.map((t) => `${t.name} ×${t.count}`).join('\n') || undefined}
      />
      <Stat
        label="Errors"
        value={c.errors.toLocaleString()}
        sub={c.errors || c.interruptions ? [c.toolErrors ? `${c.toolErrors} tool` : '', c.apiErrors ? `${c.apiErrors} API` : '', c.interruptions ? `${c.interruptions} interrupt${c.interruptions === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ') : 'none'}
        tone={c.errors ? 'error' : 'ok'}
        onClick={c.errors && onShowErrors ? onShowErrors : undefined}
        active={errorsActive}
        title={c.errors ? 'Show only errors in the flow' : 'No tool or API errors in the main transcript'}
      />
      {tokensIn || tokensOut ? (
        <Stat
          label="Tokens"
          value={<>{formatNumber(tokensIn)} <small>in</small> · {formatNumber(tokensOut)} <small>out</small></>}
          sub={[cacheHit != null ? `${Math.round(cacheHit * 100)}% cache hit` : '', agentShare > 0 ? `${Math.round(agentShare * 100)}% sub-agents` : ''].filter(Boolean).join(' · ') || undefined}
          title={tokensTitle}
        />
      ) : null}
      {cost ? (
        <Stat
          label={cost.estimated ? 'Cost (est.)' : 'Cost'}
          value={<>{cost.estimated ? '≈ ' : ''}{formatCost(cost.usd)}</>}
          sub={!cost.complete ? 'partial — missing rates' : rows.length > 1 ? `${rows.length} models` : rows[0] ? modelLabel(rows[0].model) : undefined}
          tone={!cost.complete ? 'warn' : undefined}
          onClick={onShowMetadata}
          title={costTitle}
        />
      ) : null}
      {memChanges.length > 0 && (
        <Stat
          label="Memory"
          value={<><Icon name="memory" size={12} /> {memNotes.length}</>}
          sub={`${memChanges.length} change${memChanges.length === 1 ? '' : 's'}${memReads ? ` · ${memReads} read${memReads === 1 ? '' : 's'}` : ''}`}
          tone="agent"
          onClick={() => openMemory({ project: memChanges[memChanges.length - 1]!.project, file: memNotes.length === 1 ? memNotes[0] : undefined })}
          title={`Memory notes this session changed:\n${memChanges.map((o) => `${OP_LABEL[o.op]} ${o.file}${o.agentId ? ' (sub-agent)' : ''}${o.failed ? ' — failed' : ''}`).join('\n')}\nClick to open in the Memory view`}
        />
      )}
      {s.subagents.length > 0 && (
        <Stat
          label="Sub-agents"
          value={<><Icon name="agent" size={12} /> {s.subagents.length}</>}
          sub={agentErrors ? `${agentErrors} errors inside` : [agents.usd != null ? `≈ ${formatCost(agents.usd)}` : '', agentModels.size ? [...agentModels.keys()].map(modelLabel).join(', ') : ''].filter(Boolean).join(' · ') || 'show list'}
          tone={agentErrors ? 'error' : 'agent'}
          onClick={onToggleAgents}
          active={agentsOpen}
          title={`Show every sub-agent with its model, cost, activity and when it ran${agents.usd != null ? `\n\nSub-agents ≈ ${formatCost(agents.usd)}${cost && cost.usd > 0 ? ` (${Math.min(100, Math.round((agents.usd / cost.usd) * 100))}% of the session's ${formatCost(cost.usd)})` : ''}${!agents.complete ? ', partial — missing rates' : ''}\nEstimated from each agent's tokens × the rate table; already included in the session cost` : ''}`}
        />
      )}
    </div>
  );
}
