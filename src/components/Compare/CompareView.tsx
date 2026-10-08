// Side-by-side comparison of two sessions: pick A and B, then every metric from the shared
// catalogue with its delta, coloured by whether the change is an improvement (per metric
// direction). Outcomes, detected problems and derived scores are shown apart from the raw
// counts so a reader can tell observation from judgement.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionSummary } from '@/types/session';
import type { CompactAnalysis, SessionAnalysis, Severity } from '@/types/analysis';
import { useSessionAnalysis } from '@/features/sessions/useSessionAnalysis';
import { GROUP_LABEL, METRICS, OUTCOME_LABEL, deltaLabel, improvement, type Metric, type MetricGroup } from '@/features/evaluation/metrics';
import { Icon } from '@/components/common/Icon';
import { OutcomeChip } from '@/components/Report/ReportView';
import { SearchInput } from '@/components/Search/SearchInput';
import { matchesLocalQuery } from '@/features/search/filters';
import { formatShortDateTime, modelLabel, relativeTime } from '@/utils/format';

interface Props {
  sessions: SessionSummary[];
  byId: Map<string, SessionSummary>;
  a: string | null;
  b: string | null;
  onPick: (side: 'a' | 'b', id: string | null) => void;
  onSwap: () => void;
  onOpen: (id: string) => void;
  changedAt: number | null;
}

const GROUPS: MetricGroup[] = ['activity', 'engineering', 'efficiency', 'resources', 'scores'];
const SEV: Record<Severity, string> = { high: 'High', medium: 'Med', low: 'Low', info: 'Note' };

function Picker({ label, sessions, selected, other, onPick, onOpen }: { label: string; sessions: SessionSummary[]; selected: SessionSummary | null; other: string | null; onPick: (id: string | null) => void; onOpen: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(!selected);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  const list = useMemo(() => {
    const t = q.trim();
    return sessions.filter((s) => s.id !== other && (!t || matchesLocalQuery(s, t))).slice(0, 40);
  }, [sessions, q, other]);
  return (
    <div className={`cmp-picker ${open ? 'open' : ''}`} ref={ref}>
      <div className="cmp-picker-label">{label}</div>
      {selected && !open ? (
        <div className="cmp-picked">
          <button type="button" className="cmp-picked-main" onClick={() => setOpen(true)} title="Pick a different session">
            <span className="t">{selected.title}</span>
            <span className="p">{selected.project.name}{selected.model ? ` · ${modelLabel(selected.model)}` : ''} · {formatShortDateTime(selected.startedAt)}{selected.gitBranch && selected.gitBranch !== 'HEAD' ? ` · ${selected.gitBranch}` : ''}</span>
          </button>
          <button type="button" className="btn ghost icon sm" onClick={() => onOpen(selected.id)} title="Open this session" aria-label="Open session"><Icon name="external" size={12} /></button>
          <button type="button" className="btn ghost icon sm" onClick={() => { onPick(null); setOpen(true); }} title="Clear" aria-label="Clear selection"><Icon name="x" size={12} /></button>
        </div>
      ) : (
        <div className="cmp-search">
          <SearchInput value={q} onChange={setQ} placeholder="Search sessions by title, project, branch…" ariaLabel={`Pick session ${label}`} autoFocus={!selected} onKeyDown={(e) => { if (e.key === 'Enter' && list[0]) { onPick(list[0].id); setOpen(false); } if (e.key === 'Escape' && selected) setOpen(false); }} />
          <div className="cmp-list" role="listbox">
            {list.map((s) => (
              <button key={s.id} type="button" role="option" aria-selected={s.id === selected?.id} className={`cmp-row ${s.id === selected?.id ? 'on' : ''}`} onClick={() => { onPick(s.id); setOpen(false); }}>
                <span className="t">{s.title}</span>
                <span className="p">{s.project.name}{s.model ? ` · ${modelLabel(s.model)}` : ''} · {s.counts.toolCalls} tools · {relativeTime(s.endedAt)}</span>
              </button>
            ))}
            {!list.length && <div className="dash-empty">No sessions match.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function Delta({ m, a, b }: { m: Metric; a: number | null; b: number | null }) {
  const better = improvement(m, a, b);
  const label = deltaLabel(m, a, b);
  if (!label) return <span className="cmp-delta muted">—</span>;
  if (label === 'same') return <span className="cmp-delta muted">same</span>;
  const dir = a != null && b != null && b > a ? 'up' : 'down';
  return (
    <span className={`cmp-delta ${better == null ? 'neutral' : better ? 'better' : 'worse'}`} title={better == null ? 'No direction is better for this metric' : better ? 'Improvement in B' : 'Regression in B'}>
      <Icon name={dir === 'up' ? 'arrowUp' : 'arrowDown'} size={10} />{label}
    </span>
  );
}

function ProblemList({ a }: { a: SessionAnalysis }) {
  if (!a.problems.length) return <div className="help-text cmp-none"><Icon name="checkCircle" size={12} /> none detected</div>;
  return (
    <ul className="cmp-problems">
      {a.problems.map((p) => (
        <li key={p.kind} title={p.detail}><span className={`sev-chip sev-${p.severity}`}>{SEV[p.severity]}</span><span className="ell">{p.title}</span></li>
      ))}
    </ul>
  );
}

export function CompareView({ sessions, byId, a: aId, b: bId, onPick, onSwap, onOpen, changedAt }: Props) {
  const A = useSessionAnalysis(aId, changedAt);
  const B = useSessionAnalysis(bId, changedAt);
  const sa = aId ? byId.get(aId) ?? null : null;
  const sb = bId ? byId.get(bId) ?? null : null;
  const ready = !!(A.analysis && B.analysis);
  const verdict = useMemo(() => {
    if (!A.analysis || !B.analysis) return null;
    let better = 0;
    let worse = 0;
    let same = 0;
    for (const m of METRICS) {
      if (m.better === 'neutral') continue;
      const r = improvement(m, m.get(A.analysis as unknown as CompactAnalysis), m.get(B.analysis as unknown as CompactAnalysis));
      if (r == null) same++;
      else if (r) better++;
      else worse++;
    }
    return { better, worse, same };
  }, [A.analysis, B.analysis]);

  return (
    <div className="dash cmp">
      <div className="dash-head">
        <div>
          <h1><Icon name="compare" size={16} /> Compare sessions</h1>
          <p className="help-text">Pick two runs of the same task, or the same project on two models. Deltas are B relative to A; green means B did better for that metric.</p>
        </div>
        <div className="cmp-actions">
          <button type="button" className="btn ghost sm" onClick={onSwap} disabled={!aId && !bId} title="Swap A and B"><Icon name="refresh" size={12} /> Swap</button>
        </div>
      </div>

      <div className="cmp-pickers">
        <Picker label="A · baseline" sessions={sessions} selected={sa} other={bId} onPick={(id) => onPick('a', id)} onOpen={onOpen} />
        <Picker label="B · candidate" sessions={sessions} selected={sb} other={aId} onPick={(id) => onPick('b', id)} onOpen={onOpen} />
      </div>

      {!aId || !bId ? (
        <div className="dash-card"><div className="dash-empty">Pick a session for {!aId && !bId ? 'A and B' : !aId ? 'A' : 'B'} to see the comparison.</div></div>
      ) : A.error || B.error ? (
        <div className="dash-card"><div className="dash-empty error-text">{A.error || B.error}</div></div>
      ) : !ready ? (
        <div className="dash-card"><div className="dash-empty"><span className="spinner" aria-hidden="true" /> Analysing both sessions…</div></div>
      ) : (
        <>
          {verdict && (
            <div className="cmp-verdict">
              <span className="better"><Icon name="arrowUp" size={11} /> {verdict.better} improved</span>
              <span className="worse"><Icon name="arrowDown" size={11} /> {verdict.worse} regressed</span>
              <span className="muted">{verdict.same} unchanged or n/a</span>
              <span className="help-text">over the {METRICS.filter((m) => m.better !== 'neutral').length} directional metrics (derived scores included)</span>
            </div>
          )}
          <div className="dash-card cmp-card">
            <table className="cmp-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>A</th>
                  <th>B</th>
                  <th>Δ B vs A</th>
                </tr>
              </thead>
              <tbody>
                <tr className="cmp-group"><td colSpan={4}>{GROUP_LABEL.outcome}</td></tr>
                <tr>
                  <td>Outcome</td>
                  <td><OutcomeChip outcome={A.analysis!.task.outcome} live={A.analysis!.live} /></td>
                  <td><OutcomeChip outcome={B.analysis!.task.outcome} live={B.analysis!.live} /></td>
                  <td><span className={`cmp-delta ${A.analysis!.task.outcome === B.analysis!.task.outcome ? 'muted' : B.analysis!.task.outcome === 'completed' ? 'better' : A.analysis!.task.outcome === 'completed' ? 'worse' : 'neutral'}`}>{A.analysis!.task.outcome === B.analysis!.task.outcome ? 'same' : `${OUTCOME_LABEL[A.analysis!.task.outcome]} → ${OUTCOME_LABEL[B.analysis!.task.outcome]}`}</span></td>
                </tr>
                <tr>
                  <td>Model</td>
                  <td className="mono">{sa?.model ? modelLabel(sa.model) : '—'}</td>
                  <td className="mono">{sb?.model ? modelLabel(sb.model) : '—'}</td>
                  <td><span className="cmp-delta muted">{sa?.model === sb?.model ? 'same' : 'different'}</span></td>
                </tr>
                <tr className="cmp-problem-row">
                  <td>Detected problems</td>
                  <td><ProblemList a={A.analysis!} /></td>
                  <td><ProblemList a={B.analysis!} /></td>
                  <td><Delta m={{ id: 'problems', label: 'Problems', group: 'outcome', better: 'lower', hint: '', get: () => null, format: (v) => String(v) }} a={A.analysis!.problems.filter((p) => p.severity !== 'info').length} b={B.analysis!.problems.filter((p) => p.severity !== 'info').length} /></td>
                </tr>
                {GROUPS.map((g) => (
                  <GroupRows key={g} group={g} a={A.analysis as unknown as CompactAnalysis} b={B.analysis as unknown as CompactAnalysis} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function GroupRows({ group, a, b }: { group: MetricGroup; a: CompactAnalysis; b: CompactAnalysis }) {
  const rows = METRICS.filter((m) => m.group === group);
  return (
    <>
      <tr className={`cmp-group ${group === 'scores' ? 'derived' : ''}`}>
        <td colSpan={4}>{group === 'scores' ? <><span className="derived-mark">Derived</span> {GROUP_LABEL[group]}</> : GROUP_LABEL[group]}</td>
      </tr>
      {rows.map((m) => {
        const va = m.get(a);
        const vb = m.get(b);
        return (
          <tr key={m.id} className={m.derived ? 'derived' : ''}>
            <td title={m.hint}>{m.label}{m.better !== 'neutral' && <span className="cmp-dir" title={`${m.better} is better`}>{m.better === 'lower' ? '↓' : '↑'}</span>}</td>
            <td className="num">{m.format(va, a)}</td>
            <td className="num">{m.format(vb, b)}</td>
            <td><Delta m={m} a={va} b={vb} /></td>
          </tr>
        );
      })}
    </>
  );
}
