// Evaluation dashboard: coding-agent behaviour across sessions. Filters narrow the set; the
// top row shows observed aggregates, a separate (dashed) row shows derived scores; charts
// show where problems cluster and how runs trend; the table sorts on any metric and selects
// two sessions for comparison. Everything comes from /api/analysis (compact analyses).
import { useEffect, useMemo, useState } from 'react';
import type { SessionSummary } from '@/types/session';
import type { CompactAnalysis, Outcome, Severity } from '@/types/analysis';
import type { useAnalyses } from '@/features/evaluation/useAnalyses';
import { METRIC_BY_ID, OUTCOME_LABEL, gradeTone, median, type Metric } from '@/features/evaluation/metrics';
import { Icon } from '@/components/common/Icon';
import { OutcomeChip } from '@/components/Report/ReportView';
import { formatCost, formatDuration, formatNumber, formatShortDateTime, modelLabel, plural } from '@/utils/format';
import { matchesLocalQuery } from '@/features/search/filters';

interface Props {
  sessions: SessionSummary[];
  byId: Map<string, SessionSummary>;
  analyses: ReturnType<typeof useAnalyses>;
  onSelect: (id: string) => void;
  onCompare: (a: string | null, b: string | null) => void;
}

type Range = 7 | 30 | 90 | 0;
const DAY = 86_400_000;
const SEV_DOT: Record<Severity, string> = { high: 'var(--error)', medium: 'var(--warning)', low: 'var(--tool)', info: 'var(--text-3)' };

interface Row {
  s: SessionSummary;
  a: CompactAnalysis;
  t: number;
}

const COLUMNS: { id: string; label: string; metric?: string; derived?: boolean; title?: string }[] = [
  { id: 'title', label: 'Session' },
  { id: 'date', label: 'Date' },
  { id: 'outcome', label: 'Outcome' },
  { id: 'toolCalls', label: 'Calls', metric: 'toolCalls' },
  { id: 'toolErrorRate', label: 'Err %', metric: 'toolErrorRate' },
  { id: 'filesChanged', label: 'Files Δ', metric: 'filesChanged' },
  { id: 'tests', label: 'Tests', title: 'Test runs and the outcome of the last one' },
  { id: 'redundancyShare', label: 'Redund.', metric: 'redundancyShare' },
  { id: 'active', label: 'Active', metric: 'active' },
  { id: 'cost', label: 'Cost', metric: 'cost' },
  { id: 'problems', label: 'Problems', title: 'Detected problems by severity' },
  { id: 'overall', label: 'Score', metric: 'overall', derived: true },
];

const PROBLEM_LABEL: Record<string, string> = {
  'repeated-reads': 'Repeated reads',
  'repeated-commands': 'Repeated commands',
  'retry-no-change': 'Retries without change',
  'unresolved-failures': 'Unresolved failures',
  'edit-thrash': 'Edit thrash',
  'edit-misses': 'Edit misses',
  'excessive-exploration': 'Excessive exploration',
  'no-changes': 'No changes made',
  'no-verification': 'No verification',
  'unverified-final-edits': 'Unverified final edits',
  'tests-failing-at-end': 'Tests failing at end',
  'build-failing-at-end': 'Build failing at end',
  'tool-error-rate': 'High tool error rate',
  'api-errors': 'API errors',
  interruptions: 'Interruptions',
  'unknown-tools': 'Unknown tools',
  'denied-calls': 'Denied calls',
  'large-reads': 'Large reads',
  'subagent-errors': 'Sub-agent errors',
  incomplete: 'Stopped mid-work',
  'ended-on-error': 'Ended on error',
};

function startOfDay(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function Kpi({ label, value, sub, tone, title }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'bad' | 'good' | 'warn'; title?: string }) {
  return (
    <div className={`kpi ${tone ?? ''}`} title={title}>
      <span className="k">{label}</span>
      <span className="v">{value}</span>
      <span className="s">{sub}</span>
    </div>
  );
}

/** Score-over-time dots: x = session date, y = derived overall score; one hue family, outcome in the tooltip. */
function ScoreTrend({ rows, onSelect }: { rows: Row[]; onSelect: (id: string) => void }) {
  const pts = rows.filter((r) => Number.isFinite(r.t));
  if (pts.length < 2) return <div className="dash-empty">Not enough sessions to draw a trend.</div>;
  const t0 = Math.min(...pts.map((r) => r.t));
  const t1 = Math.max(...pts.map((r) => r.t));
  const span = Math.max(1, t1 - t0);
  return (
    <div className="ev-trend" role="img" aria-label="Overall score per session over time">
      <div className="ev-trend-plot">
        {[100, 50, 0].map((v) => (
          <div key={v} className="gridline" style={{ top: `${100 - v}%` }}><span>{v}</span></div>
        ))}
        {pts.map((r) => (
          <button
            key={r.s.id}
            type="button"
            className={`dot tone-${gradeTone(r.a.scores.overall.grade)}`}
            style={{ left: `${((r.t - t0) / span) * 100}%`, top: `${100 - r.a.scores.overall.value}%` }}
            onClick={() => onSelect(r.s.id)}
            title={`${r.s.title}\n${formatShortDateTime(r.s.startedAt)} · ${OUTCOME_LABEL[r.a.task.outcome]}\nscore ${r.a.scores.overall.value} (${r.a.scores.overall.grade})`}
            aria-label={`${r.s.title}: score ${r.a.scores.overall.value}`}
          />
        ))}
      </div>
      <div className="ev-trend-axis"><span>{formatShortDateTime(new Date(t0).toISOString())}</span><span>{formatShortDateTime(new Date(t1).toISOString())}</span></div>
    </div>
  );
}

export function EvaluationDashboard({ sessions, byId, analyses, onSelect, onCompare }: Props) {
  const [range, setRange] = useState<Range>(30);
  const [project, setProject] = useState('');
  const [model, setModel] = useState('');
  const [outcome, setOutcome] = useState<Outcome | ''>('');
  const [problem, setProblem] = useState('');
  const [q, setQ] = useState('');
  const [substantial, setSubstantial] = useState(true);
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 }>({ col: 'date', dir: -1 });
  const [picked, setPicked] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => setShowAll(false), [range, project, model, outcome, problem, q, substantial]);

  const all = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const a of analyses.analyses ?? []) {
      const s = byId.get(a.id);
      if (!s) continue;
      out.push({ s, a, t: Date.parse(s.startedAt || s.endedAt || '') });
    }
    return out;
  }, [analyses.analyses, byId]);

  const projects = useMemo(() => {
    const m = new Map<string, { name: string; n: number }>();
    for (const r of all) m.set(r.s.project.raw, { name: r.s.project.name, n: (m.get(r.s.project.raw)?.n ?? 0) + 1 });
    return [...m.entries()].sort((x, y) => y[1].n - x[1].n);
  }, [all]);
  const models = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of all) if (r.s.model) m.set(r.s.model, (m.get(r.s.model) ?? 0) + 1);
    return [...m.entries()].sort((x, y) => y[1] - x[1]);
  }, [all]);

  const rows = useMemo(() => {
    const now = Date.now();
    const from = range ? startOfDay(now) - (range - 1) * DAY : -Infinity;
    const qq = q.trim();
    return all.filter((r) => {
      if (Number.isFinite(r.t) ? r.t < from : range !== 0) return false;
      if (project && r.s.project.raw !== project) return false;
      if (model && r.s.model !== model) return false;
      if (outcome && r.a.task.outcome !== outcome) return false;
      if (problem && !r.a.problems.some((p) => p.kind === problem)) return false;
      if (substantial && r.a.activity.toolCalls < 5) return false;
      if (qq && !matchesLocalQuery(r.s, qq)) return false;
      return true;
    });
  }, [all, range, project, model, outcome, problem, substantial, q]);

  const agg = useMemo(() => {
    const n = rows.length;
    const sum = (f: (r: Row) => number) => rows.reduce((t, r) => t + f(r), 0);
    const calls = sum((r) => r.a.activity.toolCalls);
    const errors = sum((r) => r.a.activity.toolErrors);
    const redundant = sum((r) => r.a.behavior.redundantCalls);
    const withChanges = rows.filter((r) => r.a.activity.files.changed > 0);
    const verified = withChanges.filter((r) => r.a.activity.tests.runs > 0 || r.a.activity.builds.runs > 0);
    const completed = rows.filter((r) => r.a.task.outcome === 'completed').length;
    const finished = rows.filter((r) => r.a.task.outcome !== 'in-progress' && r.a.task.outcome !== 'no-task').length;
    let cost = 0;
    let est = false;
    for (const r of rows) if (r.a.activity.cost) { cost += r.a.activity.cost.usd; if (r.a.activity.cost.estimated) est = true; }
    const problemCounts = new Map<string, { n: number; sev: Severity }>();
    for (const r of rows) for (const p of r.a.problems) {
      if (p.severity === 'info') continue;
      const e = problemCounts.get(p.kind) ?? { n: 0, sev: p.severity };
      e.n++;
      if (p.severity === 'high') e.sev = 'high';
      problemCounts.set(p.kind, e);
    }
    const scores = rows.map((r) => r.a.scores.overall.value);
    const buckets = [
      { label: 'weak', lo: 0, hi: 49, n: 0 },
      { label: 'fair', lo: 50, hi: 69, n: 0 },
      { label: 'good', lo: 70, hi: 84, n: 0 },
      { label: 'strong', lo: 85, hi: 100, n: 0 },
    ];
    for (const v of scores) for (const b of buckets) if (v >= b.lo && v <= b.hi) b.n++;
    const byModel = new Map<string, Row[]>();
    for (const r of rows) if (r.s.model) (byModel.get(r.s.model) ?? byModel.set(r.s.model, []).get(r.s.model)!).push(r);
    return {
      n,
      calls,
      errorRate: calls ? errors / calls : null,
      redundancy: calls ? redundant / calls : null,
      completion: finished ? completed / finished : null,
      verification: withChanges.length ? verified.length / withChanges.length : null,
      withChanges: withChanges.length,
      cost,
      est,
      medianActive: median(rows.map((r) => r.a.activity.timing.activeMs)),
      medianCost: median(rows.map((r) => r.a.activity.cost?.usd ?? null)),
      medianScore: median(scores),
      medianReliability: median(rows.map((r) => r.a.scores.reliability.value)),
      medianEfficiency: median(rows.map((r) => r.a.scores.efficiency.value)),
      medianVerification: median(rows.map((r) => r.a.scores.verification?.value ?? null)),
      problems: [...problemCounts.entries()].sort((x, y) => y[1].n - x[1].n).slice(0, 10),
      buckets,
      byModel: [...byModel.entries()]
        .map(([m, rs]) => ({ model: m, n: rs.length, errorRate: median(rs.map((r) => r.a.activity.toolErrorRate)), score: median(rs.map((r) => r.a.scores.overall.value)), cost: median(rs.map((r) => r.a.activity.cost?.usd ?? null)) }))
        .sort((x, y) => y.n - x.n)
        .slice(0, 6),
    };
  }, [rows]);

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.id === sort.col);
    const m: Metric | undefined = col?.metric ? METRIC_BY_ID.get(col.metric) : undefined;
    const key = (r: Row): number | string => {
      if (m) return m.get(r.a) ?? -Infinity;
      switch (sort.col) {
        case 'title':
          return r.s.title.toLowerCase();
        case 'outcome':
          return r.a.task.outcome;
        case 'tests':
          return r.a.activity.tests.runs;
        case 'problems':
          return r.a.problems.filter((p) => p.severity !== 'info').length;
        default:
          return Number.isFinite(r.t) ? r.t : 0;
      }
    };
    return [...rows].sort((x, y) => {
      const a = key(x);
      const b = key(y);
      return (a < b ? -1 : a > b ? 1 : 0) * sort.dir;
    });
  }, [rows, sort]);
  const shown = showAll ? sorted : sorted.slice(0, 40);

  const toggleSort = (col: string) => setSort((s) => (s.col === col ? { col, dir: s.dir === 1 ? -1 : 1 } : { col, dir: col === 'title' ? 1 : -1 }));
  const togglePick = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p.slice(-1), id]));
  const maxProblem = Math.max(1, ...agg.problems.map(([, v]) => v.n));
  const maxBucket = Math.max(1, ...agg.buckets.map((b) => b.n));
  const rangeLabel = range ? `last ${range} days` : 'all time';
  const filtered = !!(project || model || outcome || problem || q.trim()) || !substantial || range !== 30;

  return (
    <div className="dash ev">
      <div className="dash-head">
        <div>
          <h1><Icon name="chart" size={16} /> Evaluation</h1>
          <p className="help-text">How the coding agent behaved across sessions. <b>Observed</b> numbers are counted from transcripts; <span className="derived-mark">Derived</span> scores apply fixed rules to them.</p>
        </div>
        <div className="seg-control" role="radiogroup" aria-label="Range">
          {([7, 30, 90, 0] as Range[]).map((r) => (
            <button key={r} type="button" role="radio" aria-checked={range === r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>{r ? `${r} days` : 'All'}</button>
          ))}
        </div>
      </div>

      <div className="ev-filters">
        <div className="search-box ev-search">
          <Icon name="search" />
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by title, project, branch…" aria-label="Filter sessions" />
        </div>
        <select className={`select ${project ? 'on' : ''}`} value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project">
          <option value="">All projects</option>
          {projects.map(([raw, p]) => <option key={raw} value={raw}>{p.name} ({p.n})</option>)}
        </select>
        <select className={`select ${model ? 'on' : ''}`} value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model">
          <option value="">All models</option>
          {models.map(([m, n]) => <option key={m} value={m}>{modelLabel(m)} ({n})</option>)}
        </select>
        <select className={`select ${outcome ? 'on' : ''}`} value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome | '')} aria-label="Outcome">
          <option value="">Any outcome</option>
          {(Object.keys(OUTCOME_LABEL) as Outcome[]).map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
        </select>
        <select className={`select ${problem ? 'on' : ''}`} value={problem} onChange={(e) => setProblem(e.target.value)} aria-label="Detected problem">
          <option value="">Any problem</option>
          {Object.entries(PROBLEM_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <label className="ev-check" title="Hide sessions with fewer than 5 tool calls">
          <input type="checkbox" checked={substantial} onChange={(e) => setSubstantial(e.target.checked)} /> substantial only
        </label>
        {filtered && <button type="button" className="btn ghost sm" onClick={() => { setRange(30); setProject(''); setModel(''); setOutcome(''); setProblem(''); setQ(''); setSubstantial(true); }}><Icon name="x" size={10} /> Reset</button>}
        <span className="grow" />
        <span className="help-text">{analyses.loading && !analyses.analyses ? 'Analysing sessions…' : `${rows.length} of ${all.length} sessions`}{analyses.loading && analyses.analyses ? ' · refreshing' : ''}</span>
        <button type="button" className="btn ghost icon sm" onClick={() => void analyses.reload()} title="Re-analyse" aria-label="Re-analyse"><Icon name="refresh" size={12} /></button>
      </div>

      {analyses.error ? (
        <div className="dash-card"><div className="dash-empty error-text">{analyses.error}</div></div>
      ) : !analyses.analyses ? (
        <div className="dash-card"><div className="dash-empty"><span className="spinner" aria-hidden="true" /> Analysing {sessions.length} sessions… (first run reads every transcript; later runs are cached)</div></div>
      ) : (
        <>
          <h2 className="ev-row-title">Observed <span className="help-text">{rangeLabel}</span></h2>
          <div className="dash-kpis">
            <Kpi label="Sessions" value={agg.n.toLocaleString()} sub={`${formatNumber(agg.calls)} tool calls`} />
            <Kpi label="Completed" value={agg.completion == null ? '—' : `${Math.round(agg.completion * 100)}%`} sub="ended with a final response" tone={agg.completion != null && agg.completion < 0.7 ? 'warn' : undefined} />
            <Kpi label="Tool error rate" value={agg.errorRate == null ? '—' : `${(agg.errorRate * 100).toFixed(1)}%`} sub="errors ÷ calls, all sessions" tone={agg.errorRate != null && agg.errorRate >= 0.1 ? 'bad' : undefined} />
            <Kpi label="Redundant calls" value={agg.redundancy == null ? '—' : `${(agg.redundancy * 100).toFixed(1)}%`} sub="repeated reads, commands, retries" tone={agg.redundancy != null && agg.redundancy >= 0.08 ? 'warn' : undefined} />
            <Kpi label="Verified changes" value={agg.verification == null ? '—' : `${Math.round(agg.verification * 100)}%`} sub={`of ${agg.withChanges} sessions that changed files ran a check`} tone={agg.verification != null && agg.verification < 0.6 ? 'warn' : undefined} />
            <Kpi label="Median active" value={formatDuration(agg.medianActive) || '—'} sub="model + tool time per session" />
            <Kpi label="Cost" value={`${agg.est ? '≈ ' : ''}${formatCost(agg.cost) || '$0'}`} sub={`median ${agg.est ? '≈' : ''}${formatCost(agg.medianCost) || '—'} per session`} />
          </div>
          <h2 className="ev-row-title"><span className="derived-mark">Derived</span> Scores <span className="help-text">medians · 0–100 · click a session for its deductions</span></h2>
          <div className="dash-kpis ev-derived">
            <Kpi label="Overall" value={agg.medianScore ?? '—'} sub="0.4 reliability · 0.35 efficiency · 0.25 verification" />
            <Kpi label="Reliability" value={agg.medianReliability ?? '—'} sub="errors, unresolved failures, failing checks" />
            <Kpi label="Efficiency" value={agg.medianEfficiency ?? '—'} sub="redundancy, thrash, over-exploration" />
            <Kpi label="Verification" value={agg.medianVerification ?? '—'} sub="sessions that changed files" />
            <div className="kpi ev-hist" title="Sessions per overall-score band">
              <span className="k">Distribution</span>
              <div className="ev-hist-bars">
                {agg.buckets.map((b) => (
                  <div key={b.label} className="col" title={`${b.label} (${b.lo}–${b.hi}): ${plural(b.n, 'session')}`}>
                    <span className="n">{b.n || ''}</span>
                    <span className="bar-wrap"><span className={`bar tone-${gradeTone(b.label as 'weak' | 'fair' | 'good' | 'strong')}`} style={{ height: `${b.n ? Math.max(4, (b.n / maxBucket) * 100) : 0}%` }} /></span>
                    <span className="d">{b.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="dash-grid ev-grid">
            <section className="dash-card">
              <header><h3><Icon name="alert" size={13} /> Problems detected</h3><span className="help-text">sessions affected · click to filter</span></header>
              {agg.problems.length ? (
                <div className="dash-bars">
                  {agg.problems.map(([kind, v]) => (
                    <button key={kind} type="button" className={`dash-bar ev-bar ${problem === kind ? 'on' : ''}`} onClick={() => setProblem(problem === kind ? '' : kind)} title={`${PROBLEM_LABEL[kind] ?? kind}: ${plural(v.n, 'session')}`}>
                      <span className="name"><i className="sev-dot" style={{ background: SEV_DOT[v.sev] }} />{PROBLEM_LABEL[kind] ?? kind}</span>
                      <span className="track"><i style={{ width: `${(v.n / maxProblem) * 100}%` }} /></span>
                      <span className="val mono">{v.n}</span>
                      <span className="help-text">{agg.n ? `${Math.round((v.n / agg.n) * 100)}%` : ''}</span>
                    </button>
                  ))}
                </div>
              ) : <div className="dash-empty">No problems detected in these sessions.</div>}
            </section>
            <section className="dash-card">
              <header><h3><span className="derived-mark">Derived</span> Score over time</h3><span className="help-text">one dot per session · colour is the score band</span></header>
              <ScoreTrend rows={rows} onSelect={onSelect} />
            </section>
            <section className="dash-card">
              <header><h3><Icon name="layers" size={13} /> By model</h3><span className="help-text">medians per main model</span></header>
              {agg.byModel.length ? (
                <table className="rp-table ev-models">
                  <thead><tr><th>Model</th><th>Sessions</th><th>Err rate</th><th>Cost</th><th className="derived" title="Derived">Score</th></tr></thead>
                  <tbody>
                    {agg.byModel.map((m) => (
                      <tr key={m.model}><td className="mono">{modelLabel(m.model)}</td><td>{m.n}</td><td>{m.errorRate == null ? '—' : `${(m.errorRate * 100).toFixed(1)}%`}</td><td>{m.cost == null ? '—' : formatCost(m.cost)}</td><td className="derived">{m.score ?? '—'}</td></tr>
                    ))}
                  </tbody>
                </table>
              ) : <div className="dash-empty">No model information.</div>}
            </section>
          </div>

          <section className="dash-card wide ev-table-card">
            <header>
              <h3><Icon name="list" size={13} /> Sessions</h3>
              <span className="ev-table-actions">
                {picked.length > 0 && <span className="help-text">{picked.length === 2 ? 'two selected' : 'select one more'}</span>}
                <button type="button" className="btn sm" disabled={picked.length !== 2} onClick={() => onCompare(picked[0] ?? null, picked[1] ?? null)} title="Compare the two selected sessions side by side"><Icon name="compare" size={12} /> Compare selected</button>
              </span>
            </header>
            <div className="ev-table-wrap">
              <table className="ev-table">
                <thead>
                  <tr>
                    <th className="pick" />
                    {COLUMNS.map((c) => {
                      const m = c.metric ? METRIC_BY_ID.get(c.metric) : undefined;
                      return (
                        <th key={c.id} className={`${c.derived ? 'derived' : ''} ${sort.col === c.id ? 'sorted' : ''}`} title={c.title ?? m?.hint}>
                          <button type="button" onClick={() => toggleSort(c.id)}>{c.derived && <span className="derived-mark">D</span>}{c.label}{sort.col === c.id && <Icon name={sort.dir === 1 ? 'chevronUp' : 'chevronDown'} size={10} />}</button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const probs = r.a.problems.filter((p) => p.severity !== 'info');
                    const tone = gradeTone(r.a.scores.overall.grade);
                    return (
                      <tr key={r.s.id} className={picked.includes(r.s.id) ? 'picked' : ''} onClick={() => onSelect(r.s.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onSelect(r.s.id)}>
                        <td className="pick" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={picked.includes(r.s.id)} onChange={() => togglePick(r.s.id)} aria-label="Select for comparison" /></td>
                        <td className="title"><span className="t">{r.s.live && <span className="live-dot" />}{r.s.title}</span><span className="p">{r.s.project.name}{r.s.model ? ` · ${modelLabel(r.s.model)}` : ''}</span></td>
                        <td className="nowrap">{formatShortDateTime(r.s.startedAt)}</td>
                        <td><OutcomeChip outcome={r.a.task.outcome} live={r.a.live} /></td>
                        <td className="num">{r.a.activity.toolCalls}</td>
                        <td className={`num ${r.a.activity.toolErrorRate >= 0.15 && r.a.activity.toolErrors >= 5 ? 'bad' : ''}`}>{Math.round(r.a.activity.toolErrorRate * 100)}%</td>
                        <td className="num">{r.a.activity.files.changed || '–'}</td>
                        <td className={`num ${r.a.activity.tests.last === 'failed' ? 'bad' : r.a.activity.tests.last === 'passed' ? 'good' : ''}`} title={r.a.activity.tests.runs ? `${r.a.activity.tests.runs} runs, last ${r.a.activity.tests.last}` : 'no test runs'}>{r.a.activity.tests.runs ? `${r.a.activity.tests.runs} ${r.a.activity.tests.last === 'failed' ? '✗' : r.a.activity.tests.last === 'passed' ? '✓' : '?'}` : '–'}</td>
                        <td className={`num ${r.a.behavior.redundancyShare >= 0.1 && r.a.behavior.redundantCalls >= 5 ? 'warn' : ''}`}>{r.a.behavior.redundantCalls ? `${Math.round(r.a.behavior.redundancyShare * 100)}%` : '–'}</td>
                        <td className="num nowrap">{formatDuration(r.a.activity.timing.activeMs, { compact: true }) || '–'}</td>
                        <td className="num nowrap">{r.a.activity.cost ? `${r.a.activity.cost.estimated ? '≈' : ''}${formatCost(r.a.activity.cost.usd)}` : '–'}</td>
                        <td className="probs" title={probs.map((p) => `${p.severity}: ${p.title}`).join('\n') || 'none'}><span className="probs-dots">{probs.length ? probs.slice(0, 6).map((p, i) => <i key={i} className="sev-dot" style={{ background: SEV_DOT[p.severity] }} />) : <span className="help-text">–</span>}{probs.length > 6 && <small>+{probs.length - 6}</small>}</span></td>
                        <td className={`num derived tone-${tone}`} title={`${r.a.scores.overall.grade} · reliability ${r.a.scores.reliability.value} · efficiency ${r.a.scores.efficiency.value} · verification ${r.a.scores.verification?.value ?? 'n/a'}`}>{r.a.scores.overall.value}</td>
                      </tr>
                    );
                  })}
                  {!shown.length && <tr><td colSpan={COLUMNS.length + 1} className="dash-empty">No sessions match these filters.</td></tr>}
                </tbody>
              </table>
            </div>
            {sorted.length > 40 && <button type="button" className="link ev-more" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show first 40' : `Show all ${sorted.length}`}</button>}
            {analyses.failed.length > 0 && <div className="help-text ev-more">{analyses.failed.length} session{analyses.failed.length === 1 ? '' : 's'} could not be analysed.</div>}
          </section>
        </>
      )}
    </div>
  );
}
