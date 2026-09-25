import type { SessionSummary } from '@/types/session';
import { formatCost, formatDateTime, formatDuration, formatNumber, formatShortDateTime, modelLabel } from '@/utils/format';
import { modelRows } from './CostTable';

function Cell({ k, v, cls, title }: { k: string; v: React.ReactNode; cls?: string; title?: string }) {
  if (v === null || v === undefined || v === '') return null;
  return (
    <div className="cell" title={title}>
      <div className="k">{k}</div>
      <div className={`v ${cls || ''}`}>{v}</div>
    </div>
  );
}

/** Overview grid. Fields with no data in the log are simply omitted. */
export function SessionOverview({ session: s, onShowMetadata }: { session: SessionSummary; onShowMetadata?: () => void }) {
  const c = s.counts;
  // Models seen anywhere: main transcript plus each sub-agent transcript.
  const agentModels = new Map<string, number>();
  for (const a of s.subagents) if (a.model && a.model !== s.model) agentModels.set(a.model, (agentModels.get(a.model) || 0) + 1);
  const extraModels = s.models.length - 1 + agentModels.size;
  const modelTitle = [...s.models.map((m) => `${m.name} ×${m.count} messages`), ...[...agentModels].map(([m, n]) => `${m} in ${n} sub-agent${n === 1 ? '' : 's'}`)].join('\n');
  const rows = modelRows(s);
  const costTitle = rows.length ? rows.map((r) => `${modelLabel(r.model)}: ${r.cost != null ? formatCost(r.cost) : '?'}`).join('\n') + '\nAs recorded by Claude Code · click for the breakdown' : 'As recorded by Claude Code';
  const cacheTitle = `cache read ${formatNumber(s.usage.cacheRead)}\ncache write ${formatNumber(s.usage.cacheCreate)}\nSummed over API messages in the main transcript`;
  return (
    <div className="overview">
      <Cell k="Project" v={s.project.name} title={s.project.raw} />
      <Cell k="Model" v={s.model ? <>{modelLabel(s.model)}{extraModels > 0 ? <small title={modelTitle}> +{extraModels}</small> : null}</> : null} cls={extraModels > 0 ? 'multi' : ''} title={modelTitle} />
      <Cell k="Started" v={formatShortDateTime(s.startedAt)} title={formatDateTime(s.startedAt)} />
      <Cell k="Span" v={formatDuration(s.durationMs)} title="First to last event" />
      {s.cost?.totalDuration ? <Cell k="Active" v={formatDuration(s.cost.totalDuration)} title="Total wall-clock time Claude Code was active (from the log's cost-state)" /> : null}
      <Cell k="Messages" v={<>{c.messages} <small>{c.userMessages}u / {c.assistantMessages}c</small></>} title={`${c.userMessages} user · ${c.assistantMessages} Claude`} />
      <Cell k="Tool calls" v={c.toolCalls} title={s.tools.map((t) => `${t.name} ×${t.count}`).join('\n')} />
      <Cell k="Errors" v={c.errors} cls={c.errors ? 'err' : 'ok'} title={`${c.toolErrors} tool · ${c.apiErrors} API`} />
      {c.interruptions ? <Cell k="Interrupts" v={c.interruptions} /> : null}
      <Cell k="Tokens in" v={s.usage.input + s.usage.cacheRead + s.usage.cacheCreate ? formatNumber(s.usage.input + s.usage.cacheRead + s.usage.cacheCreate) : null} title={`Summed over API messages\nuncached input ${formatNumber(s.usage.input)}\ncache read ${formatNumber(s.usage.cacheRead)}\ncache write ${formatNumber(s.usage.cacheCreate)}`} />
      <Cell k="Tokens out" v={s.usage.output ? formatNumber(s.usage.output) : null} title={`output ${formatNumber(s.usage.output)}${s.usage.thinking ? `\nof which thinking ${formatNumber(s.usage.thinking)}` : ''}`} />
      {s.usage.cacheRead ? <Cell k="Cache read" v={formatNumber(s.usage.cacheRead)} title={cacheTitle} /> : null}
      {s.usage.cacheCreate ? <Cell k="Cache write" v={formatNumber(s.usage.cacheCreate)} title={cacheTitle} /> : null}
      {s.cost?.totalCostUSD != null ? <Cell k="Cost" v={<button type="button" className="cell-btn" onClick={onShowMetadata}>{formatCost(s.cost.totalCostUSD)}{rows.length > 1 ? <small> {rows.length} models</small> : null}</button>} title={costTitle} /> : null}
      {s.subagents.length ? <Cell k="Sub-agents" v={s.subagents.length} /> : null}
    </div>
  );
}
