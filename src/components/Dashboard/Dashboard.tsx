// Landing view when no session is open: what is running, what failed, where the money and
// time went over a recent window. Built only from the session summaries already loaded.
import { useMemo, useState } from 'react';
import type { SessionSummary } from '@/types/session';
import { sessionCost } from '@/components/SessionViewer/CostTable';
import { Icon } from '@/components/common/Icon';
import { formatCost, formatNumber, modelLabel, MOD, relativeTime } from '@/utils/format';
import { CHANGE_OPS, OP_LABEL, openMemory, sessionMemoryOps } from '@/utils/memory';

type Range = 1 | 7 | 30;
const DAY = 86_400_000;

function startOfDay(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function Row({ s, onSelect, right }: { s: SessionSummary; onSelect: (id: string) => void; right?: React.ReactNode }) {
  return (
    <button type="button" className="dash-row" onClick={() => onSelect(s.id)} title={`${s.title}\n${s.project.raw}`}>
      {s.live ? <span className="live-dot" /> : <span className="dot-spacer" />}
      <span className="dash-row-main">
        <span className="t">{s.title}</span>
        <span className="p">{s.project.name}{s.model ? ` · ${modelLabel(s.model)}` : ''} · {relativeTime(s.endedAt)}</span>
      </span>
      <span className="dash-row-right">{right}</span>
    </button>
  );
}

export function Dashboard({ sessions, onSelect }: { sessions: SessionSummary[]; onSelect: (id: string) => void }) {
  const [range, setRange] = useState<Range>(7);
  const data = useMemo(() => {
    const now = Date.now();
    const from = range === 1 ? startOfDay(now) : startOfDay(now) - (range - 1) * DAY;
    const inRange = sessions.filter((s) => {
      const t = Date.parse(s.endedAt || s.startedAt || '');
      return Number.isFinite(t) && t >= from;
    });
    let cost = 0;
    let estimated = false;
    let tools = 0;
    let errors = 0;
    let agents = 0;
    let tokensOut = 0;
    const byProject = new Map<string, { name: string; raw: string; sessions: number; cost: number; errors: number }>();
    const byModel = new Map<string, number>();
    for (const s of inRange) {
      const c = sessionCost(s);
      if (c) {
        cost += c.usd;
        if (c.estimated) estimated = true;
      }
      tools += s.counts.toolCalls;
      errors += s.counts.errors;
      agents += s.subagents.length;
      tokensOut += s.usage.output;
      const p = byProject.get(s.project.raw) || { name: s.project.name, raw: s.project.raw, sessions: 0, cost: 0, errors: 0 };
      p.sessions++;
      p.cost += c?.usd ?? 0;
      p.errors += s.counts.errors;
      byProject.set(s.project.raw, p);
      if (s.model) byModel.set(s.model, (byModel.get(s.model) || 0) + 1);
    }
    // Per-day buckets for the activity chart (always the last 14 days, independent of range).
    const days: { t: number; sessions: number; cost: number; errors: number }[] = [];
    const d0 = startOfDay(now) - 13 * DAY;
    for (let i = 0; i < 14; i++) days.push({ t: d0 + i * DAY, sessions: 0, cost: 0, errors: 0 });
    for (const s of sessions) {
      const t = Date.parse(s.endedAt || s.startedAt || '');
      if (!Number.isFinite(t) || t < d0) continue;
      const b = days[Math.min(13, Math.floor((startOfDay(t) - d0) / DAY))];
      if (!b) continue;
      b.sessions++;
      b.cost += sessionCost(s)?.usd ?? 0;
      b.errors += s.counts.errors;
    }
    return {
      inRange,
      cost,
      estimated,
      tools,
      errors,
      agents,
      tokensOut,
      projects: [...byProject.values()].sort((a, b) => b.cost - a.cost || b.sessions - a.sessions).slice(0, 6),
      models: [...byModel.entries()].sort((a, b) => b[1] - a[1]),
      failing: inRange.filter((s) => s.counts.errors > 0).sort((a, b) => b.counts.errors - a.counts.errors).slice(0, 6),
      expensive: [...inRange].sort((a, b) => (sessionCost(b)?.usd ?? 0) - (sessionCost(a)?.usd ?? 0)).slice(0, 6),
      memory: inRange
        .flatMap((s) => sessionMemoryOps(s).filter((o) => CHANGE_OPS.has(o.op)).map((o) => ({ s, o })))
        .sort((a, b) => (b.o.ts || '').localeCompare(a.o.ts || ''))
        .slice(0, 6),
      days,
    };
  }, [sessions, range]);
  const live = sessions.filter((s) => s.live);
  const recent = sessions.slice(0, 6);
  const maxDay = Math.max(1, ...data.days.map((d) => d.cost));
  const maxProj = Math.max(0.0001, ...data.projects.map((p) => p.cost));
  const rangeLabel = range === 1 ? 'today' : `last ${range} days`;

  return (
    <div className="dash">
      <div className="dash-head">
        <div>
          <h1>Overview</h1>
          <p className="help-text">Every Claude Code session on this machine. Pick one on the left, or press <kbd>{MOD}</kbd> <kbd>K</kbd> to search prompts, tools and output.</p>
        </div>
        <div className="seg-control" role="radiogroup" aria-label="Range">
          {([1, 7, 30] as Range[]).map((r) => (
            <button key={r} type="button" role="radio" aria-checked={range === r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>{r === 1 ? 'Today' : `${r} days`}</button>
          ))}
        </div>
      </div>

      <div className="dash-kpis">
        <div className="kpi"><span className="k">Sessions</span><span className="v">{data.inRange.length.toLocaleString()}</span><span className="s">{rangeLabel}</span></div>
        <div className="kpi"><span className="k">Cost</span><span className="v">{data.estimated ? '≈ ' : ''}{formatCost(data.cost) || '$0.00'}</span><span className="s">{data.estimated ? 'includes estimates' : 'recorded by Claude Code'}</span></div>
        <div className="kpi"><span className="k">Tool calls</span><span className="v">{formatNumber(data.tools)}</span><span className="s">{formatNumber(data.tokensOut)} output tokens</span></div>
        <div className={`kpi ${data.errors ? 'bad' : ''}`}><span className="k">Errors</span><span className="v">{data.errors.toLocaleString()}</span><span className="s">in {data.failing.length ? `${data.inRange.filter((s) => s.counts.errors).length} sessions` : 'no sessions'}</span></div>
        <div className="kpi"><span className="k">Sub-agents</span><span className="v">{data.agents.toLocaleString()}</span><span className="s">spawned in {data.inRange.filter((s) => s.subagents.length).length} sessions</span></div>
        <div className="kpi"><span className="k">Models</span><span className="v">{data.models.length}</span><span className="s">{data.models.slice(0, 2).map(([m, n]) => `${modelLabel(m)} ×${n}`).join(' · ') || '—'}</span></div>
      </div>

      <div className="dash-grid">
        <section className="dash-card wide">
          <header><h3>Activity</h3><span className="help-text">last 14 days · bar height is cost, label is sessions</span></header>
          <div className="dash-chart" role="img" aria-label="Sessions and cost per day, last 14 days">
            {data.days.map((d) => {
              const date = new Date(d.t);
              return (
                <div key={d.t} className="col" title={`${date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}\n${d.sessions} sessions · ${formatCost(d.cost) || '$0'}${d.errors ? ` · ${d.errors} errors` : ''}`}>
                  <span className="n">{d.sessions || ''}</span>
                  <span className="bar-wrap"><span className={`bar ${d.errors ? 'has-err' : ''}`} style={{ height: `${d.cost > 0 ? Math.max(3, (d.cost / maxDay) * 100) : 0}%` }} /></span>
                  <span className="d">{date.toLocaleDateString(undefined, { day: 'numeric' })}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="dash-card">
          <header><h3><span className="live-dot" style={{ animation: live.length ? undefined : 'none', opacity: live.length ? 1 : 0.35 }} /> Running now</h3><span className="help-text">{live.length}</span></header>
          {live.length ? live.map((s) => <Row key={s.id} s={s} onSelect={onSelect} right={<span className="chip success">{s.live?.status || 'live'}</span>} />) : <div className="dash-empty">No Claude Code process is running a session right now.</div>}
        </section>

        <section className="dash-card">
          <header><h3><Icon name="alert" size={13} /> Needs attention</h3><span className="help-text">errors, {rangeLabel}</span></header>
          {data.failing.length ? data.failing.map((s) => <Row key={s.id} s={s} onSelect={onSelect} right={<span className="err-badge"><Icon name="alert" size={10} />{s.counts.errors}</span>} />) : <div className="dash-empty">No errors {rangeLabel}.</div>}
        </section>

        <section className="dash-card">
          <header><h3><Icon name="dollar" size={13} /> Most expensive</h3><span className="help-text">{rangeLabel}</span></header>
          {data.expensive.length ? data.expensive.map((s) => { const c = sessionCost(s); return <Row key={s.id} s={s} onSelect={onSelect} right={<span className="mono">{c ? `${c.estimated ? '≈' : ''}${formatCost(c.usd)}` : '—'}</span>} />; }) : <div className="dash-empty">No sessions {rangeLabel}.</div>}
        </section>

        <section className="dash-card">
          <header><h3><Icon name="folder" size={13} /> Projects</h3><span className="help-text">by cost, {rangeLabel}</span></header>
          {data.projects.length ? (
            <div className="dash-bars">
              {data.projects.map((p) => (
                <div key={p.raw} className="dash-bar" title={`${p.raw}\n${p.sessions} sessions · ${formatCost(p.cost)}${p.errors ? ` · ${p.errors} errors` : ''}`}>
                  <span className="name">{p.name}</span>
                  <span className="track"><i style={{ width: `${(p.cost / maxProj) * 100}%` }} /></span>
                  <span className="val mono">{formatCost(p.cost) || '$0'}</span>
                  <span className="help-text">{p.sessions}</span>
                </div>
              ))}
            </div>
          ) : <div className="dash-empty">No sessions {rangeLabel}.</div>}
        </section>

        <section className="dash-card">
          <header>
            <h3><Icon name="memory" size={13} /> Memory changes</h3>
            <button type="button" className="btn ghost sm" onClick={() => openMemory()}>All memory</button>
          </header>
          {data.memory.length ? (
            data.memory.map(({ s, o }, i) => (
              <button key={i} type="button" className="dash-row" onClick={() => openMemory({ project: o.project, file: o.file })} title={`${OP_LABEL[o.op]} ${o.file} in “${s.title}”`}>
                <span className="dot-spacer" />
                <span className="dash-row-main">
                  <span className="t">{o.file.replace(/\.md$/, '')}</span>
                  <span className="p">{OP_LABEL[o.op]} in {s.title} · {relativeTime(o.ts)}</span>
                </span>
                <span className="dash-row-right">{o.failed ? <span className="chip error">failed</span> : <span className="help-text">{s.project.name}</span>}</span>
              </button>
            ))
          ) : (
            <div className="dash-empty">No memory notes were written {rangeLabel}.</div>
          )}
        </section>

        <section className="dash-card">
          <header><h3><Icon name="clock" size={13} /> Recent</h3></header>
          {recent.map((s) => <Row key={s.id} s={s} onSelect={onSelect} right={<span className="help-text">{s.counts.toolCalls} tools</span>} />)}
        </section>
      </div>
    </div>
  );
}
