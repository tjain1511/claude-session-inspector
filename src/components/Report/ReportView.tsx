// Engineering report for one session: what was asked and how it ended, what the agent did
// (observed counts), how efficiently it worked (detected patterns with jumps to the events),
// what to do about it, and derived scores with every deduction spelled out. All numbers come
// from the server-side analyzer; nothing here is estimated by a model.
import { useMemo, useState, type ReactNode } from 'react';
import type { SessionSummary } from '@/types/session';
import type { EventRef, Problem, Score, SessionAnalysis, Severity, CommandCategory } from '@/types/analysis';
import { Icon } from '@/components/common/Icon';
import { Clamp } from '@/components/common/Clamp';
import { Markdown } from '@/utils/markdown';
import { formatCost, formatDuration, formatNumber, formatShortDateTime, plural } from '@/utils/format';
import { OUTCOME_LABEL, OUTCOME_TONE, gradeTone } from '@/features/evaluation/metrics';

interface Props {
  session: SessionSummary;
  analysis: SessionAnalysis | null;
  loading: boolean;
  error: string | null;
  onJump: (ref: EventRef) => void;
  onCompare: () => void;
  onReload: () => void;
}

const SEV_LABEL: Record<Severity, string> = { high: 'High', medium: 'Medium', low: 'Low', info: 'Note' };
const CAT_LABEL: Record<CommandCategory, string> = { test: 'test', build: 'build', lint: 'lint / typecheck', git: 'git', install: 'install', run: 'run', inspect: 'inspect', other: 'other' };
const shortPath = (p: string) => {
  const parts = p.split('/').filter(Boolean);
  return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : p;
};

export function OutcomeChip({ outcome, live }: { outcome: SessionAnalysis['task']['outcome']; live?: boolean }) {
  const tone = OUTCOME_TONE[outcome];
  return (
    <span className={`outcome-chip tone-${tone}`}>
      {tone === 'live' || live ? <span className="live-dot" /> : <Icon name={tone === 'ok' ? 'checkCircle' : tone === 'error' ? 'xCircle' : tone === 'warn' ? 'alert' : 'info'} size={11} />}
      {OUTCOME_LABEL[outcome]}
    </span>
  );
}

function ScoreCard({ label, score, hint, big }: { label: string; score: Score | { value: number; grade: Score['grade']; factors?: undefined } | null; hint: string; big?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!score) {
    return (
      <div className={`score-card na ${big ? 'big' : ''}`} title={hint}>
        <span className="score-k">{label}</span>
        <span className="score-v">n/a</span>
        <span className="score-s">nothing was changed</span>
      </div>
    );
  }
  const tone = gradeTone(score.grade);
  const factors = score.factors ?? [];
  return (
    <div className={`score-card tone-${tone} ${big ? 'big' : ''} ${open ? 'open' : ''}`}>
      <button type="button" className="score-main" onClick={() => factors.length && setOpen((o) => !o)} title={hint} aria-expanded={factors.length ? open : undefined}>
        <span className="score-k">{label}</span>
        <span className="score-v">{score.value}<small>/100</small></span>
        <span className="score-bar"><i style={{ width: `${score.value}%` }} /></span>
        <span className="score-s">{score.grade[0]!.toUpperCase() + score.grade.slice(1)}{factors.length ? ` · ${factors.length} deduction${factors.length === 1 ? '' : 's'}` : ' · no deductions'}</span>
      </button>
      {open && factors.length > 0 && (
        <ul className="score-factors">
          {factors.map((f, i) => (
            <li key={i}><span className="delta">{f.delta > 0 ? '+' : ''}{f.delta}</span><span>{f.label}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Tile({ label, value, sub, tone, title }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'error' | 'warn' | 'ok'; title?: string }) {
  return (
    <div className={`rp-tile ${tone ? `tone-${tone}` : ''}`} title={title}>
      <span className="k">{label}</span>
      <span className="v">{value}</span>
      {sub != null && sub !== '' && <span className="s">{sub}</span>}
    </div>
  );
}

function JumpRefs({ refs, onJump }: { refs: EventRef[]; onJump: (r: EventRef) => void }) {
  const usable = refs.filter((r) => r.id || r.agentId);
  if (!usable.length) return null;
  return (
    <span className="rp-jumps">
      {usable.slice(0, 6).map((r, i) => (
        <button key={i} type="button" className="rp-jump" onClick={() => onJump(r)} title={r.agentId ? `Open the Agent call that spawned ${r.agentId}` : 'Jump to this event in the flow'}>
          {r.agentId ? <Icon name="agent" size={10} /> : <Icon name="bolt" size={10} />}{i + 1}
        </button>
      ))}
      {usable.length > 6 && <span className="help-text">+{usable.length - 6}</span>}
    </span>
  );
}

function ProblemRow({ p, onJump }: { p: Problem; onJump: (r: EventRef) => void }) {
  return (
    <li className={`rp-problem sev-${p.severity}`}>
      <span className={`sev-chip sev-${p.severity}`}>{SEV_LABEL[p.severity]}</span>
      <div className="rp-problem-body">
        <div className="rp-problem-title">{p.title}</div>
        <div className="rp-problem-detail">{p.detail}</div>
        <JumpRefs refs={p.refs} onJump={onJump} />
      </div>
    </li>
  );
}

function Distribution({ parts, total }: { parts: { label: string; ms: number; cls: string }[]; total: number }) {
  if (total <= 0) return null;
  return (
    <div className="rp-dist">
      <div className="rp-dist-bar" role="img" aria-label={parts.map((p) => `${p.label} ${formatDuration(p.ms)}`).join(', ')}>
        {parts.map((p) => (p.ms > 0 ? <i key={p.label} className={p.cls} style={{ width: `${(p.ms / total) * 100}%` }} title={`${p.label}: ${formatDuration(p.ms)} (${Math.round((p.ms / total) * 100)}%)`} /> : null))}
      </div>
      <div className="rp-dist-legend">
        {parts.map((p) => (
          <span key={p.label}><i className={p.cls} />{p.label} <b>{formatDuration(p.ms) || '0s'}</b> <small>{Math.round((p.ms / total) * 100)}%</small></span>
        ))}
      </div>
    </div>
  );
}

export function ReportView({ session: s, analysis: a, loading, error, onJump, onCompare, onReload }: Props) {
  const [showAllTurns, setShowAllTurns] = useState(false);
  const cats = useMemo(() => {
    if (!a) return [];
    return (Object.entries(a.activity.commands.byCategory) as [CommandCategory, number][]).filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1]);
  }, [a]);
  if (error) {
    return (
      <div className="state-panel">
        <div className="state-card">
          <h2>Could not analyse this session</h2>
          <p className="error-text">{error}</p>
          <div className="actions"><button type="button" className="btn" onClick={onReload}><Icon name="refresh" /> Retry</button></div>
        </div>
      </div>
    );
  }
  if (!a) {
    return (
      <div className="report">
        <div className="rp-loading"><span className="spinner" aria-hidden="true" /> {loading ? 'Analysing transcript…' : 'No analysis yet.'}</div>
      </div>
    );
  }
  const act = a.activity;
  const beh = a.behavior;
  const t = act.timing;
  const distTotal = t.modelMs + t.toolMs + t.backgroundMs + t.userMs + t.otherMs;
  const tools = Object.entries(act.byTool).slice(0, 8);
  const maxCat = Math.max(1, ...cats.map(([, n]) => n));
  const changed = act.files.changedList ?? [];
  const read = act.files.readList ?? [];
  const turns = showAllTurns ? a.turns : a.turns.slice(0, 12);
  const highs = a.problems.filter((p) => p.severity === 'high').length;
  const meds = a.problems.filter((p) => p.severity === 'medium').length;

  return (
    <div className="report">
      <header className="rp-head">
        <div className="rp-head-main">
          <div className="rp-head-row">
            <OutcomeChip outcome={a.task.outcome} live={a.live} />
            <span className="help-text">
              {plural(a.task.prompts, 'prompt')} · {plural(act.toolCalls, 'tool call')}{act.agents.count ? ` · ${plural(act.agents.count, 'sub-agent')}` : ''} · {formatDuration(t.activeMs) || '0s'} active
              {a.live ? ' · still running, numbers will change' : ''}
            </span>
          </div>
          <p className="help-text rp-head-note">
            Observed metrics are counted from the transcript. <span className="derived-mark">Derived</span> scores apply fixed rules to them and are a heuristic, not a verdict.
            Analysed {formatShortDateTime(a.computedAt)}.
          </p>
        </div>
        <div className="rp-head-actions">
          <button type="button" className="btn ghost sm" onClick={onCompare} title="Compare this session with another one"><Icon name="compare" size={12} /> Compare</button>
          <button type="button" className="btn ghost icon sm" onClick={onReload} title="Re-analyse" aria-label="Re-analyse"><Icon name="refresh" size={12} /></button>
        </div>
      </header>

      <section className="rp-section rp-scores">
        <div className="rp-section-head">
          <h3><span className="derived-mark">Derived</span> Scores</h3>
          <span className="help-text" title={a.scores.method}>click a score for its deductions · {a.scores.method.split('. ')[1] || ''}</span>
        </div>
        <div className="score-grid">
          <ScoreCard big label="Overall" score={a.scores.overall} hint={a.scores.method} />
          <ScoreCard label="Reliability" score={a.scores.reliability} hint="Tool and API errors, unresolved failures, failing checks at the end, interruptions." />
          <ScoreCard label="Efficiency" score={a.scores.efficiency} hint="Redundant reads and commands, retries without change, edit thrash, over-exploration, large reads." />
          <ScoreCard label="Verification" score={a.scores.verification} hint="Were changes checked by tests, builds or typechecks, and did the last check pass?" />
        </div>
      </section>

      <div className="rp-columns">
        <section className="rp-section">
          <div className="rp-section-head"><h3><Icon name="info" size={13} /> Task</h3>{a.task.gitBranch && a.task.gitBranch !== 'HEAD' && <span className="chip mono">{a.task.gitBranch}</span>}</div>
          {a.task.prompt ? (
            <Clamp maxHeight={140} label="prompt">
              <div className="rp-prompt"><Markdown text={a.task.prompt} /></div>
            </Clamp>
          ) : (
            <div className="help-text">No user prompt in this transcript.</div>
          )}
          {a.task.prompts > 1 && <div className="help-text rp-note">First of {a.task.prompts} prompts; the turn table below lists the rest.</div>}
        </section>
        <section className="rp-section">
          <div className="rp-section-head"><h3><Icon name="checkCircle" size={13} /> Result</h3>
            <span className="rp-chips">
              {a.task.prLinks.map((p) => <span key={p.url} className="chip tool" title={p.url}>PR #{p.number}</span>)}
              {a.task.continuedIn && <span className="chip">continued elsewhere</span>}
            </span>
          </div>
          {a.task.finalResponse ? (
            <Clamp maxHeight={140} label="response">
              <div className="rp-prompt"><Markdown text={a.task.finalResponse} /></div>
            </Clamp>
          ) : (
            <div className="help-text">{OUTCOME_LABEL[a.task.outcome]}: no final response from the agent.</div>
          )}
          <div className="rp-result-facts">
            <span><b>{act.files.changed}</b> files changed</span>
            <span><b>+{formatNumber(act.files.linesAdded)}</b> / <b>−{formatNumber(act.files.linesRemoved)}</b> lines</span>
            <span className={act.tests.last === 'failed' ? 'bad' : act.tests.last === 'passed' ? 'good' : ''}>tests: <b>{act.tests.runs ? `${act.tests.runs} run${act.tests.runs === 1 ? '' : 's'}, last ${act.tests.last}` : 'none'}</b></span>
            <span className={act.builds.last === 'failed' ? 'bad' : act.builds.last === 'passed' ? 'good' : ''}>checks: <b>{act.builds.runs ? `${act.builds.runs} run${act.builds.runs === 1 ? '' : 's'}, last ${act.builds.last}` : 'none'}</b></span>
            {act.commands.git.commits > 0 && <span><b>{act.commands.git.commits}</b> commit{act.commands.git.commits === 1 ? '' : 's'}</span>}
          </div>
        </section>
      </div>

      <section className="rp-section">
        <div className="rp-section-head">
          <h3><Icon name="alert" size={13} /> Detected problems</h3>
          <span className="help-text">{a.problems.length ? `${a.problems.length} finding${a.problems.length === 1 ? '' : 's'}${highs ? ` · ${highs} high` : ''}${meds ? ` · ${meds} medium` : ''}` : 'none'}</span>
        </div>
        {a.problems.length ? (
          <ul className="rp-problems">{a.problems.map((p) => <ProblemRow key={p.kind} p={p} onJump={onJump} />)}</ul>
        ) : (
          <div className="rp-empty good"><Icon name="checkCircle" size={14} /> No inefficiencies or failure patterns detected by the rules.</div>
        )}
      </section>

      {a.recommendations.length > 0 && (
        <section className="rp-section">
          <div className="rp-section-head"><h3><Icon name="bolt" size={13} /> Recommendations</h3><span className="help-text">one per detected problem</span></div>
          <ul className="rp-recs">
            {a.recommendations.map((r) => (
              <li key={r.kind} className={`sev-${r.severity}`}>
                <div className="rp-rec-title">{r.title}</div>
                <div className="rp-rec-detail">{r.detail}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rp-section">
        <div className="rp-section-head"><h3><Icon name="terminal" size={13} /> Engineering activity</h3><span className="help-text">observed · main transcript{act.agents.count ? ' + sub-agents' : ''}</span></div>
        <div className="rp-tiles">
          <Tile label="Tool calls" value={act.toolCalls.toLocaleString()} sub={`${act.toolErrors} errors · ${Math.round(act.toolErrorRate * 100)}%`} tone={act.toolErrorRate >= 0.15 && act.toolErrors >= 5 ? 'error' : undefined} title={`${act.toolCallsMain} in the main transcript${act.agents.count ? `, ${act.agents.toolCalls} inside sub-agents` : ''}${act.pending ? `\n${act.pending} without a result yet` : ''}`} />
          <Tile label="Shell commands" value={act.commands.total.toLocaleString()} sub={`${act.commands.unique} unique · ${act.commands.failed} failed`} />
          <Tile label="Files read" value={act.files.read.toLocaleString()} sub={`${act.exploration} exploration calls`} />
          <Tile label="Files changed" value={act.files.changed.toLocaleString()} sub={`${act.files.created} created · +${formatNumber(act.files.linesAdded)} −${formatNumber(act.files.linesRemoved)}`} />
          <Tile label="Test runs" value={act.tests.runs.toLocaleString()} sub={act.tests.runs ? `${act.tests.passed} passed · ${act.tests.failed} failed${act.tests.unknown ? ` · ${act.tests.unknown} unparsed` : ''}` : 'none detected'} tone={act.tests.last === 'failed' ? 'error' : act.tests.last === 'passed' ? 'ok' : undefined} title={act.tests.casesPassed || act.tests.casesFailed ? `Last outputs reported ${act.tests.casesPassed} passing and ${act.tests.casesFailed} failing cases in total` : undefined} />
          <Tile label="Builds / checks" value={act.builds.runs.toLocaleString()} sub={act.builds.runs ? `${act.builds.failed} failed · last ${act.builds.last}` : 'none detected'} tone={act.builds.last === 'failed' ? 'error' : undefined} />
          <Tile label="Sub-agents" value={act.agents.count.toLocaleString()} sub={act.agents.count ? `${act.agents.toolCalls} tool calls · ${act.agents.withErrors} with errors` : 'none'} tone={act.agents.withErrors ? 'warn' : undefined} title={Object.entries(act.agents.byType).map(([k, v]) => `${k} ×${v}`).join('\n') || undefined} />
          <Tile label="Interruptions" value={act.interruptions.toLocaleString()} sub={`${act.apiErrors} API errors${act.denied ? ` · ${act.denied} denied` : ''}`} tone={act.interruptions >= 2 || act.apiErrors >= 3 ? 'warn' : undefined} />
        </div>
        <div className="rp-columns">
          <div>
            <h4>Tools</h4>
            <table className="rp-table">
              <thead><tr><th>Tool</th><th>Calls</th><th>Errors</th><th>Time</th></tr></thead>
              <tbody>
                {tools.map(([name, v]) => (
                  <tr key={name}><td className="mono ell" title={name}>{name}</td><td>{v.calls}</td><td className={v.errors ? 'bad' : ''}>{v.errors || '–'}</td><td>{formatDuration(v.ms) || '–'}</td></tr>
                ))}
              </tbody>
            </table>
            {Object.keys(act.byTool).length > tools.length && <div className="help-text rp-note">+{Object.keys(act.byTool).length - tools.length} more tools</div>}
          </div>
          <div>
            <h4>Commands by category</h4>
            {cats.length ? (
              <div className="dash-bars rp-cats">
                {cats.map(([c, n]) => (
                  <div key={c} className="dash-bar">
                    <span className="name">{CAT_LABEL[c]}</span>
                    <span className="track"><i style={{ width: `${(n / maxCat) * 100}%` }} /></span>
                    <span className="val mono">{n}</span>
                    <span />
                  </div>
                ))}
              </div>
            ) : <div className="help-text">No shell commands.</div>}
            {act.commands.mutating > 0 && <div className="help-text rp-note">{act.commands.mutating} command{act.commands.mutating === 1 ? '' : 's'} change files (redirects, sed -i, rm, git …)</div>}
          </div>
        </div>
        {(changed.length > 0 || read.length > 0) && (
          <div className="rp-columns">
            <div>
              <h4>Files changed</h4>
              {changed.length ? (
                <ul className="rp-files">
                  {changed.slice(0, 10).map((f) => (
                    <li key={f.path} title={f.path}>
                      <span className="mono ell">{shortPath(f.path)}</span>
                      <span className="rp-file-meta">{f.created ? <span className="chip success">new</span> : null}{f.agent ? <Icon name="agent" size={10} /> : null}<span className="good">+{f.added}</span> <span className="bad">−{f.removed}</span> <small>×{f.edits}</small></span>
                    </li>
                  ))}
                  {changed.length > 10 && <li className="help-text">+{changed.length - 10} more</li>}
                </ul>
              ) : <div className="help-text">No files changed.</div>}
            </div>
            <div>
              <h4>Most read</h4>
              {read.length ? (
                <ul className="rp-files">
                  {read.slice(0, 10).map((f) => (
                    <li key={f.path} title={f.path}>
                      <span className="mono ell">{shortPath(f.path)}</span>
                      <span className="rp-file-meta">{f.agent ? <Icon name="agent" size={10} /> : null}<small>×{f.count}</small></span>
                    </li>
                  ))}
                </ul>
              ) : <div className="help-text">No files read.</div>}
            </div>
          </div>
        )}
      </section>

      <section className="rp-section">
        <div className="rp-section-head"><h3><Icon name="pulse" size={13} /> Agent behaviour</h3><span className="help-text">observed · redundancy, retries, exploration</span></div>
        <div className="rp-tiles">
          <Tile label="Redundant calls" value={beh.redundantCalls.toLocaleString()} sub={`${Math.round(beh.redundancyShare * 100)}% of tool calls`} tone={beh.redundancyShare >= 0.1 && beh.redundantCalls >= 5 ? 'warn' : undefined} title="Redundant reads + repeated commands + retries without change" />
          <Tile label="Redundant reads" value={beh.redundantReads.toLocaleString()} sub={beh.redundantReadFiles?.length ? `${beh.redundantReadFiles.length} files` : 'none'} />
          <Tile label="Repeated commands" value={beh.repeatedCommands.toLocaleString()} sub={beh.repeatedCommandList?.length ? `${beh.repeatedCommandList.length} commands` : 'none'} />
          <Tile label="Retries" value={beh.identicalRetries.toLocaleString()} sub={`${beh.retryChains} chains · ${beh.fixLoops} fix loops · ${beh.unresolvedChains} unresolved`} tone={beh.unresolvedChains ? 'error' : undefined} title="Retries: a failed call re-issued unchanged. Fix loops: fail → change → retry. Unresolved: never succeeded." />
          <Tile label="Exploration ratio" value={beh.explorationRatio == null ? 'n/a' : `${beh.explorationRatio.toFixed(1)}:1`} sub={`${act.exploration} reads/searches · ${act.edits} changes`} tone={beh.explorationRatio != null && beh.explorationRatio >= 6 && act.exploration >= 25 ? 'warn' : undefined} />
          <Tile label="Edit thrash" value={beh.editThrashFiles.toLocaleString()} sub={`max ${beh.maxEditsOneFile} edits on one file · ${beh.editMisses} misses`} tone={beh.editThrashFiles ? 'warn' : undefined} />
          <Tile label="Large reads" value={beh.largeReads.toLocaleString()} sub="results over 40k chars" />
          <Tile label="Verified at end" value={act.files.changed === 0 ? 'n/a' : beh.editsAfterLastCheck ? 'no' : act.tests.runs || act.builds.runs ? 'yes' : 'never'} sub={act.files.changed === 0 ? 'nothing changed' : beh.editsAfterLastCheck ? 'edits after the last check' : act.tests.runs || act.builds.runs ? 'last check after last edit' : 'no checks ran'} tone={act.files.changed === 0 ? undefined : beh.editsAfterLastCheck || !(act.tests.runs || act.builds.runs) ? 'warn' : 'ok'} />
        </div>
        {(beh.chains?.length || beh.thrash?.length || beh.repeatedCommandList?.length || beh.redundantReadFiles?.length) ? (
          <div className="rp-columns">
            {!!beh.chains?.length && (
              <div>
                <h4>Retry chains</h4>
                <ul className="rp-files">
                  {beh.chains.slice(0, 8).map((c, i) => (
                    <li key={i} title={c.target}>
                      <span className="ell"><span className="chip tool">{c.tool}</span> <span className="mono">{c.target.startsWith('/') ? shortPath(c.target) : c.target}</span></span>
                      <span className="rp-file-meta">
                        <small>{c.attempts} attempts{c.identical ? ` · ${c.identical} unchanged` : ''}</small>
                        <span className={`chip ${c.resolved ? 'success' : 'error'}`}>{c.resolved ? (c.fixLoop ? 'fixed' : 'resolved') : 'unresolved'}</span>
                        <JumpRefs refs={c.refs} onJump={onJump} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!!(beh.redundantReadFiles?.length || beh.repeatedCommandList?.length || beh.thrash?.length) && (
              <div>
                <h4>Repeats</h4>
                <ul className="rp-files">
                  {beh.thrash?.slice(0, 4).map((f) => (
                    <li key={`t${f.path}`} title={f.path}><span className="mono ell">{shortPath(f.path)}</span><span className="rp-file-meta"><small>edited ×{f.edits}</small><JumpRefs refs={f.refs} onJump={onJump} /></span></li>
                  ))}
                  {beh.redundantReadFiles?.slice(0, 4).map((f) => (
                    <li key={`r${f.path}`} title={f.path}><span className="mono ell">{shortPath(f.path)}</span><span className="rp-file-meta"><small>re-read ×{f.count}</small><JumpRefs refs={f.refs} onJump={onJump} /></span></li>
                  ))}
                  {beh.repeatedCommandList?.slice(0, 4).map((c) => (
                    <li key={`c${c.command}`} title={c.command}><span className="mono ell">{c.command}</span><span className="rp-file-meta"><small>re-run ×{c.count}</small><JumpRefs refs={c.refs} onJump={onJump} /></span></li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : null}
      </section>

      <section className="rp-section">
        <div className="rp-section-head"><h3><Icon name="clock" size={13} /> Time, tokens & cost</h3><span className="help-text">observed</span></div>
        <Distribution
          total={distTotal}
          parts={[
            { label: 'Model', ms: t.modelMs, cls: 'model' },
            { label: 'Tools', ms: t.toolMs, cls: 'tool' },
            { label: 'Background tasks', ms: t.backgroundMs, cls: 'bg' },
            { label: 'Waiting for user', ms: t.userMs, cls: 'user' },
            { label: 'Other / resume gaps', ms: t.otherMs, cls: 'other' },
          ]}
        />
        <div className="rp-tiles">
          <Tile label="Wall clock" value={formatDuration(t.wallMs) || '—'} sub={t.recorded?.totalDuration ? `${formatDuration(t.recorded.totalDuration)} recorded by Claude Code` : 'first to last record'} />
          <Tile label="Active" value={formatDuration(t.activeMs) || '0s'} sub={`model ${formatDuration(t.modelMs) || '0s'} · tools ${formatDuration(t.toolMs + t.backgroundMs) || '0s'}`} />
          <Tile label="Slowest call" value={t.slowestCall ? formatDuration(t.slowestCall.durationMs) : '—'} sub={t.slowestCall ? <button type="button" className="link mono ell" onClick={() => onJump(t.slowestCall!.ref)} title={t.slowestCall.target}>{t.slowestCall.tool}: {t.slowestCall.target}</button> : undefined} />
          <Tile label="Tokens" value={<>{formatNumber(act.tokens.totalIn)} <small>in</small> · {formatNumber(act.tokens.totalOut)} <small>out</small></>} sub={act.tokens.cacheHitRate != null ? `${Math.round(act.tokens.cacheHitRate * 100)}% cache hit · ${formatNumber(act.tokens.perToolCall)} per call` : undefined} />
          <Tile label={act.cost?.estimated ? 'Cost (est.)' : 'Cost'} value={act.cost ? `${act.cost.estimated ? '≈ ' : ''}${formatCost(act.cost.usd)}` : '—'} sub={act.cost ? [act.cost.perChangedFile != null ? `${act.cost.estimated ? '≈' : ''}${formatCost(act.cost.perChangedFile)} per changed file` : '', !act.cost.complete ? 'partial — missing rates' : ''].filter(Boolean).join(' · ') || undefined : 'no usage'} tone={act.cost && !act.cost.complete ? 'warn' : undefined} />
          <Tile label="Thinking" value={act.messages.thinking.toLocaleString()} sub={`blocks · ${formatNumber(act.tokens.thinking)} tokens`} />
        </div>
      </section>

      {a.turns.length > 0 && (
        <section className="rp-section">
          <div className="rp-section-head"><h3><Icon name="list" size={13} /> Per turn</h3><span className="help-text">{a.turns.length} turn{a.turns.length === 1 ? '' : 's'} · click a row to jump</span></div>
          <table className="rp-table rp-turns">
            <thead><tr><th>#</th><th>Prompt</th><th>Duration</th><th>Calls</th><th>Errors</th><th>Edits</th><th>Tests</th><th>Agents</th><th>Out tokens</th></tr></thead>
            <tbody>
              {turns.map((tn) => (
                <tr key={tn.id} className={tn.errors || tn.testFailures ? 'has-err' : ''} onClick={() => onJump({ id: tn.id })} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onJump({ id: tn.id })}>
                  <td>{tn.idx}</td>
                  <td className="ell" title={tn.prompt}>{tn.prompt || '(prompt)'}</td>
                  <td>{formatDuration(tn.durationMs) || '–'}</td>
                  <td>{tn.toolCalls}</td>
                  <td className={tn.errors + tn.apiErrors ? 'bad' : ''}>{tn.errors + tn.apiErrors || '–'}</td>
                  <td>{tn.edits || '–'}</td>
                  <td className={tn.testFailures ? 'bad' : tn.testRuns ? 'good' : ''}>{tn.testRuns ? `${tn.testRuns - tn.testFailures}/${tn.testRuns}` : '–'}</td>
                  <td>{tn.agents || '–'}</td>
                  <td>{tn.tokensOut ? formatNumber(tn.tokensOut) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {a.turns.length > 12 && <button type="button" className="link rp-note" onClick={() => setShowAllTurns((v) => !v)}>{showAllTurns ? 'Show first 12' : `Show all ${a.turns.length} turns`}</button>}
        </section>
      )}
    </div>
  );
}
