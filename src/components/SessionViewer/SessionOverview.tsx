import type { SessionSummary } from '@/types/session';
import { formatCost, formatDateTime, formatDuration, formatNumber, formatShortDateTime, modelLabel } from '@/utils/format';

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
export function SessionOverview({ session: s }: { session: SessionSummary }) {
  const c = s.counts;
  return (
    <div className="overview">
      <Cell k="Project" v={s.project.name} title={s.project.raw} />
      <Cell k="Model" v={s.model ? modelLabel(s.model) : null} title={s.models.map((m) => `${m.name} ×${m.count}`).join('\n')} />
      <Cell k="Started" v={formatShortDateTime(s.startedAt)} title={formatDateTime(s.startedAt)} />
      <Cell k="Span" v={formatDuration(s.durationMs)} title="First to last event" />
      {s.cost?.totalDuration ? <Cell k="Active" v={formatDuration(s.cost.totalDuration)} title="Total wall-clock time Claude Code was active (from the log's cost-state)" /> : null}
      <Cell k="Messages" v={<>{c.messages} <small>{c.userMessages}u / {c.assistantMessages}c</small></>} title={`${c.userMessages} user · ${c.assistantMessages} Claude`} />
      <Cell k="Tool calls" v={c.toolCalls} title={s.tools.map((t) => `${t.name} ×${t.count}`).join('\n')} />
      <Cell k="Errors" v={c.errors} cls={c.errors ? 'err' : 'ok'} title={`${c.toolErrors} tool · ${c.apiErrors} API`} />
      {c.interruptions ? <Cell k="Interrupts" v={c.interruptions} /> : null}
      <Cell k="Tokens out" v={s.usage.output ? formatNumber(s.usage.output) : null} title={`in ${formatNumber(s.usage.input)} · cache read ${formatNumber(s.usage.cacheRead)} · cache write ${formatNumber(s.usage.cacheCreate)}`} />
      {s.cost?.totalCostUSD != null ? <Cell k="Cost" v={formatCost(s.cost.totalCostUSD)} title="As recorded by Claude Code" /> : null}
      {s.subagents.length ? <Cell k="Sub-agents" v={s.subagents.length} /> : null}
    </div>
  );
}
