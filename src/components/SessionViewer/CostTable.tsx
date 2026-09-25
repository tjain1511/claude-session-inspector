// Per-model token and cost breakdown, straight from Claude Code's cost-state record
// (which also covers background models such as the one used for titles). Nothing is
// priced by this app; when no cost-state exists the cost columns are simply absent.
import type { SessionSummary } from '@/types/session';
import { formatCost, formatNumber, modelLabel } from '@/utils/format';

export interface ModelRow {
  model: string;
  input: number;
  output: number;
  thinking: number;
  cacheRead: number;
  cacheCreate: number;
  cost: number | null;
}

export function modelRows(s: SessionSummary): ModelRow[] {
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

export function CostTable({ session: s }: { session: SessionSummary }) {
  const rows = modelRows(s);
  if (!rows.length) return <div className="help-text">No cost-state record in this transcript yet. Claude Code writes it as the session runs; per-model cost is unavailable until then.</div>;
  const total = rows.reduce((n, r) => n + (r.cost ?? 0), 0);
  return (
    <table className="cost-table">
      <thead>
        <tr>
          <th>Model</th>
          <th>Input</th>
          <th>Cache read</th>
          <th>Cache write</th>
          <th>Output</th>
          <th>Thinking</th>
          <th>Cost</th>
          <th>Share</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.model} className={r.model === s.model ? 'primary' : ''}>
            <td className="mono" title={r.model}>{modelLabel(r.model)}{r.model === s.model ? <span className="help-text"> main</span> : null}</td>
            <td>{formatNumber(r.input)}</td>
            <td>{formatNumber(r.cacheRead)}</td>
            <td>{formatNumber(r.cacheCreate)}</td>
            <td>{formatNumber(r.output)}</td>
            <td>{r.thinking ? formatNumber(r.thinking) : '–'}</td>
            <td>{r.cost != null ? formatCost(r.cost) : '?'}</td>
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
          <td>{formatCost(s.cost?.totalCostUSD ?? total)}</td>
          <td>{s.cost?.hasUnknownModelCost ? <span className="chip warn" title="Claude Code could not price at least one model">partial</span> : ''}</td>
        </tr>
      </tfoot>
    </table>
  );
}
