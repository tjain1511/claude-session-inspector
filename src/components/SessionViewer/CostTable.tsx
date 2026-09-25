// Per-model token and cost breakdown. Recorded costs come from Claude Code's cost-state
// record (which also covers background models such as the one used for titles). When a
// session has no such record yet, the estimate (usage × the rate table from Settings) is
// shown instead and labelled as an estimate.
import type { CostEstimate, SessionSummary } from '@/types/session';
import { formatCost, formatNumber, modelLabel } from '@/utils/format';

export interface ModelRow {
  model: string;
  input: number;
  output: number;
  thinking: number;
  cacheRead: number;
  cacheCreate: number;
  cost: number | null;
  rateNote?: string;
}

export function recordedRows(s: SessionSummary): ModelRow[] {
  const mu = s.cost?.modelUsage;
  if (!mu) return [];
  return Object.entries(mu)
    .map(([model, u]) => ({
      model,
      input: u.inputTokens ?? 0,
      output: u.outputTokens ?? 0,
      thinking: u.thinkingTokens ?? 0,
      cacheRead: u.cacheReadInputTokens ?? 0,
      cacheCreate: u.cacheCreationInputTokens ?? 0,
      cost: typeof u.costUSD === 'number' ? u.costUSD : null,
    }))
    .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0) || b.output - a.output);
}

export function estimatedRows(e: CostEstimate | undefined): ModelRow[] {
  if (!e) return [];
  return e.byModel.map((m) => ({
    model: m.model,
    input: m.usage.input,
    output: m.usage.output,
    thinking: m.usage.thinking,
    cacheRead: m.usage.cacheRead,
    cacheCreate: m.usage.cacheCreate,
    cost: m.cost,
    rateNote: m.rate ? `$/MTok: input ${m.rate.input} · cache read ${m.rate.cacheRead} · cache write ${m.rate.cacheWrite} · output ${m.rate.output}` : 'no rate for this model — add one in Settings → Pricing',
  }));
}

/** Recorded cost if Claude Code wrote one, otherwise the estimate. */
export function sessionCost(s: SessionSummary): { usd: number; estimated: boolean; complete: boolean } | null {
  if (s.cost?.totalCostUSD != null) return { usd: s.cost.totalCostUSD, estimated: false, complete: true };
  if (s.estimate && s.estimate.byModel.length) return { usd: s.estimate.totalUSD, estimated: true, complete: s.estimate.complete };
  return null;
}

export function CostTable({ session: s, mode }: { session: SessionSummary; mode?: 'recorded' | 'estimated' }) {
  const recorded = recordedRows(s);
  const useRecorded = mode === 'recorded' || (mode !== 'estimated' && recorded.length > 0);
  const rows = useRecorded ? recorded : estimatedRows(s.estimate);
  if (!rows.length) return <div className="help-text">{useRecorded ? 'No cost-state record in this transcript.' : 'No token usage recorded yet.'}</div>;
  const total = rows.reduce((n, r) => n + (r.cost ?? 0), 0);
  const unknown = !useRecorded && s.estimate?.unknownModels.length ? s.estimate.unknownModels : [];
  return (
    <table className={`cost-table ${useRecorded ? '' : 'estimated'}`}>
      <thead>
        <tr>
          <th>Model</th>
          <th>Input</th>
          <th>Cache read</th>
          <th>Cache write</th>
          <th>Output</th>
          <th>Thinking</th>
          <th>{useRecorded ? 'Cost' : 'Est. cost'}</th>
          <th>Share</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.model} className={r.model === s.model ? 'primary' : ''}>
            <td className="mono" title={r.rateNote || r.model}>{modelLabel(r.model)}{r.model === s.model ? <span className="help-text"> main</span> : null}</td>
            <td>{formatNumber(r.input)}</td>
            <td>{formatNumber(r.cacheRead)}</td>
            <td>{formatNumber(r.cacheCreate)}</td>
            <td>{formatNumber(r.output)}</td>
            <td>{r.thinking ? formatNumber(r.thinking) : '–'}</td>
            <td title={r.rateNote}>{r.cost != null ? formatCost(r.cost) : <span className="chip warn" title={r.rateNote}>no rate</span>}</td>
            <td>{total > 0 && r.cost != null ? `${Math.round((r.cost / total) * 100)}%` : '–'}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td>Total</td>
          <td>{formatNumber(rows.reduce((n, r) => n + r.input, 0))}</td>
          <td>{formatNumber(rows.reduce((n, r) => n + r.cacheRead, 0))}</td>
          <td>{formatNumber(rows.reduce((n, r) => n + r.cacheCreate, 0))}</td>
          <td>{formatNumber(rows.reduce((n, r) => n + r.output, 0))}</td>
          <td>{formatNumber(rows.reduce((n, r) => n + r.thinking, 0))}</td>
          <td>{useRecorded ? formatCost(s.cost?.totalCostUSD ?? total) : `≈ ${formatCost(total)}`}</td>
          <td>
            {useRecorded && s.cost?.hasUnknownModelCost ? <span className="chip warn" title="Claude Code could not price at least one model">partial</span> : null}
            {unknown.length ? <span className="chip warn" title={`No rate for ${unknown.join(', ')}`}>partial</span> : null}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}
