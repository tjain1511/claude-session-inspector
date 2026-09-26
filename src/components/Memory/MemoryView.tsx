// Claude Code's auto-memory, per project: every note with its front matter, rendered body,
// [[links]], place in the MEMORY.md index, and the history of sessions that read or changed it.
// Everything shown comes from the memory folders on disk and the transcript records that
// touched them; the history keeps notes that have since been deleted.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { MemoryHistoryEntry, MemoryIndex, MemoryNote, MemoryProject, MemoryReport, SessionSummary } from '@/types/session';
import { api } from '@/services/api';
import { Icon } from '@/components/common/Icon';
import { CopyButton } from '@/components/common/CopyButton';
import { CodeBlock } from '@/components/CodeBlock/CodeBlock';
import { DiffView } from '@/components/ToolCall/ToolInput';
import { SearchInput } from '@/components/Search/SearchInput';
import { Markdown, type WikiLink } from '@/utils/markdown';
import { formatBytes, formatDateTime, plural, relativeTime } from '@/utils/format';
import { CHANGE_OPS, NOTE_TYPES, OP_LABEL, noteDescription, noteModified, noteName, noteOrigin, noteType } from '@/utils/memory';

export interface MemoryFocus {
  project?: string;
  file?: string;
}

interface Props {
  byId: Map<string, SessionSummary>;
  /** Changes whenever notes or transcripts change; triggers a reload. */
  changeKey: string;
  focus: MemoryFocus;
  onFocus: (f: MemoryFocus) => void;
  /** Open a session, scrolled to the first of these tool calls that is in its main flow. */
  onOpenSession: (id: string, toolUseIds: string[]) => void;
}

type Ctx = Pick<Props, 'byId' | 'onFocus' | 'onOpenSession'>;

function TypeChip({ type }: { type: string | null }) {
  if (!type) return null;
  const known = (NOTE_TYPES as readonly string[]).includes(type);
  return <span className={`mem-type ${known ? `t-${type}` : ''}`}>{type}</span>;
}

function sessionLabel(byId: Map<string, SessionSummary>, id: string) {
  return byId.get(id)?.title ?? `session ${id.slice(0, 8)}`;
}

function agentLabel(byId: Map<string, SessionSummary>, h: MemoryHistoryEntry) {
  if (!h.agentId) return null;
  const a = byId.get(h.sessionId)?.subagents.find((x) => x.agentId === h.agentId);
  return a?.agentType || 'sub-agent';
}

function openAt(ctx: Ctx, h: MemoryHistoryEntry) {
  const spawn = h.agentId ? ctx.byId.get(h.sessionId)?.subagents.find((x) => x.agentId === h.agentId)?.toolUseId : null;
  ctx.onOpenSession(h.sessionId, [h.toolUseId, spawn].filter((x): x is string => !!x));
}

function HistoryRow({ h, ctx, note }: { h: MemoryHistoryEntry; ctx: Ctx; note?: { project: string; file: string; name: string } }) {
  const [open, setOpen] = useState(false);
  const agent = agentLabel(ctx.byId, h);
  const hasBody = h.content != null || !!h.edits?.length || !!h.command;
  const known = ctx.byId.has(h.sessionId);
  return (
    <li className={`mem-hist op-${h.op} ${h.failed ? 'failed' : ''}`}>
      <div className="mem-hist-row">
        <span className={`mem-op op-${h.op}`}>{OP_LABEL[h.op]}</span>
        {note && (
          <button type="button" className="mem-hist-note" onClick={() => ctx.onFocus({ project: note.project, file: note.file })} title={note.file}>
            {note.name}
          </button>
        )}
        <button type="button" className="mem-hist-session" onClick={() => openAt(ctx, h)} disabled={!known} title={known ? `Open this session${h.toolUseId ? ' at the tool call' : ''}` : 'Session is not in the index'}>
          {sessionLabel(ctx.byId, h.sessionId)}
        </button>
        {agent && <span className="chip agent-type" title={`Sub-agent ${h.agentId}`}><Icon name="agent" size={10} />{agent}</span>}
        {h.tool && h.tool !== 'Write' && h.tool !== 'Edit' && h.tool !== 'Read' && <span className="mem-via">via {h.tool}</span>}
        {h.failed && <span className="chip error" title="The tool call returned an error, so the change may not have landed">failed</span>}
        <span className="mem-hist-ts" title={formatDateTime(h.ts)}>{relativeTime(h.ts)}</span>
        {hasBody && (
          <button type="button" className="btn ghost sm" onClick={() => setOpen((v) => !v)} aria-expanded={open} title={h.command && h.content == null && !h.edits ? 'Show the command' : 'Show what was written'}>
            <Icon name="chevron" size={11} className={open ? 'rot90' : ''} />
          </button>
        )}
      </div>
      {open && (
        <div className="mem-hist-body">
          {h.content != null && <CodeBlock code={h.content} lang="markdown" title={h.op === 'append' ? 'appended text' : 'content written'} initialLines={30} compact />}
          {h.edits?.map((e, i) => <DiffView key={i} oldText={e.old} newText={e.new} file={h.edits!.length > 1 ? `edit ${i + 1} of ${h.edits!.length}` : undefined} />)}
          {h.command && h.content == null && <CodeBlock code={h.command} lang="shell" compact initialLines={12} wrapDefault />}
        </div>
      )}
    </li>
  );
}

function History({ entries, ctx, emptyText }: { entries: MemoryHistoryEntry[]; ctx: Ctx; emptyText: string }) {
  const [showReads, setShowReads] = useState(false);
  const changes = entries.filter((h) => CHANGE_OPS.has(h.op));
  const reads = entries.length - changes.length;
  const shown = (showReads ? entries : changes).slice().reverse();
  return (
    <div className="mem-history">
      <div className="mem-history-head">
        <span>{plural(changes.length, 'change')}{reads ? ` · ${reads} read${reads === 1 ? '' : 's'} / loads` : ''}</span>
        {reads > 0 && (
          <label className="toggle">
            <input type="checkbox" checked={showReads} onChange={(e) => setShowReads(e.target.checked)} /> Show reads
          </label>
        )}
      </div>
      {shown.length ? <ol className="mem-hist-list">{shown.map((h, i) => <HistoryRow key={i} h={h} ctx={ctx} />)}</ol> : <p className="help-text">{emptyText}</p>}
    </div>
  );
}

function slugOf(n: MemoryNote) {
  return noteName(n);
}

function findNote(p: MemoryProject, slug: string) {
  return p.notes.find((n) => slugOf(n) === slug || n.file === slug || n.file === `${slug}.md`);
}

function NoteDetail({ p, note, ctx }: { p: MemoryProject; note: MemoryNote; ctx: Ctx }) {
  const [tab, setTab] = useState<'note' | 'history' | 'source'>('note');
  useEffect(() => setTab(note.missing ? 'history' : 'note'), [note.file, note.missing]);
  const name = noteName(note);
  const desc = noteDescription(note);
  const origin = noteOrigin(note);
  const modified = noteModified(note);
  const indexed = p.index?.entries.find((e) => e.file === note.file);
  const backlinks = p.notes.filter((n) => n !== note && n.links.some((l) => l === name || `${l}.md` === note.file));
  const wiki: WikiLink = (slug, key) => {
    const target = findNote(p, slug);
    return target ? (
      <button key={key} type="button" className="mem-wiki" onClick={() => ctx.onFocus({ project: p.dirName, file: target.file })} title={noteDescription(target) ?? target.file}>
        {slug}
      </button>
    ) : (
      <span key={key} className="mem-wiki missing" title={`No note named “${slug}” exists in ${p.project.name}. The memory format lets Claude link a note it has not written yet, so this is a placeholder, not a broken file.`}>
        {slug}
        <span className="mem-wiki-tag">not written</span>
      </span>
    );
  };
  const changes = note.history.filter((h) => CHANGE_OPS.has(h.op)).length;
  const source = note.frontmatterRaw != null ? `---\n${note.frontmatterRaw}\n---\n${note.body}` : note.body;
  return (
    <article className="mem-note">
      <div className="mem-crumbs">
        <button type="button" onClick={() => ctx.onFocus({ project: p.dirName })}>{p.project.name}</button>
        <Icon name="chevron" size={10} />
        <span className="mono">{note.file}</span>
      </div>
      <header className="mem-note-head">
        <h2>{name}</h2>
        <TypeChip type={noteType(note)} />
        {note.missing && <span className="chip warn" title="This file is no longer on disk; the history below shows what sessions did to it">deleted</span>}
      </header>
      {desc && <p className="mem-desc">{desc}</p>}
      <dl className="mem-meta">
        {modified && <><dt>Modified</dt><dd title={formatDateTime(modified)}>{formatDateTime(modified)} · {relativeTime(modified)}</dd></>}
        {origin && (
          <>
            <dt>Origin</dt>
            <dd>
              {ctx.byId.has(origin) ? <button type="button" className="linkish" onClick={() => ctx.onOpenSession(origin, [])}>{sessionLabel(ctx.byId, origin)}</button> : <span className="mono">{origin}</span>}
            </dd>
          </>
        )}
        <dt>Index</dt>
        <dd>
          {indexed ? (
            <>
              <span className="status-success"><Icon name="check" size={11} /> listed in MEMORY.md</span>
              {indexed.hook && <span className="mem-hook">{indexed.hook}</span>}
            </>
          ) : note.missing ? (
            <span className="help-text">—</span>
          ) : (
            <span className="status-warn" title="Claude only sees notes through the MEMORY.md index, so an unlisted note is unlikely to be recalled"><Icon name="warn" size={11} /> not listed in MEMORY.md</span>
          )}
        </dd>
        <dt>File</dt>
        <dd className="mono mem-path">
          {note.path}
          {!note.missing && <>{' · '}{formatBytes(note.sizeBytes)}</>}
          <CopyButton text={note.path} label="Copy path" />
        </dd>
      </dl>
      <div className="seg-control sm mem-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'note'} className={tab === 'note' ? 'on' : ''} onClick={() => setTab('note')} disabled={note.missing}>Note</button>
        <button type="button" role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>
          History <span className="count">{changes}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === 'source'} className={tab === 'source' ? 'on' : ''} onClick={() => setTab('source')} disabled={note.missing}>Source</button>
      </div>
      {tab === 'note' && (
        <>
          <div className="mem-body">{note.body.trim() ? <Markdown text={note.body} wiki={wiki} /> : <p className="help-text">This note has no body.</p>}</div>
          {(note.links.length > 0 || backlinks.length > 0) && (
            <div className="mem-links">
              {note.links.length > 0 && (
                <div>
                  <h4>Links to</h4>
                  <div className="mem-chips">{note.links.map((l, i) => wiki(l, i))}</div>
                </div>
              )}
              {backlinks.length > 0 && (
                <div>
                  <h4>Linked from</h4>
                  <div className="mem-chips">
                    {backlinks.map((b) => (
                      <button key={b.file} type="button" className="mem-wiki" onClick={() => ctx.onFocus({ project: p.dirName, file: b.file })}>{noteName(b)}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
      {tab === 'history' && <History entries={note.history} ctx={ctx} emptyText="No transcript on this machine records a change to this note. It may predate the kept transcripts or have been edited by hand." />}
      {tab === 'source' && <CodeBlock code={source} lang="markdown" title={note.file} initialLines={200} />}
    </article>
  );
}

function IndexDetail({ p, ctx }: { p: MemoryProject; ctx: Ctx }) {
  const idx = p.index;
  const [tab, setTab] = useState<'notes' | 'history' | 'source'>('notes');
  useEffect(() => setTab('notes'), [p.dirName]);
  const listed = new Set(idx?.entries.map((e) => e.file));
  const unlisted = p.notes.filter((n) => !n.missing && !listed.has(n.file));
  const loads = idx?.history.filter((h) => h.op === 'loaded') ?? [];
  const loadSessions = new Set(loads.map((h) => h.sessionId)).size;
  return (
    <article className="mem-note">
      <div className="mem-crumbs">
        <span>{p.project.name}</span>
        {idx && <><Icon name="chevron" size={10} /><span className="mono">MEMORY.md</span></>}
      </div>
      <header className="mem-note-head">
        <h2>{p.project.name}</h2>
        <span className="help-text mono">{p.project.path}</span>
      </header>
      <p className="mem-desc">
        {plural(p.notes.filter((n) => !n.missing).length, 'note')}
        {idx ? <> · MEMORY.md lists {plural(idx.entries.length, 'entry', 'entries')}{loadSessions ? <> and was loaded into {plural(loadSessions, 'session')}</> : null}</> : <> · no MEMORY.md index</>}
      </p>
      <dl className="mem-meta">
        <dt>Folder</dt>
        <dd className="mono mem-path">{p.dir}<CopyButton text={p.dir} label="Copy path" /></dd>
        {idx?.mtime && <><dt>Index updated</dt><dd title={formatDateTime(idx.mtime)}>{formatDateTime(idx.mtime)} · {relativeTime(idx.mtime)}</dd></>}
      </dl>
      {idx && (
        <div className="seg-control sm mem-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'notes'} className={tab === 'notes' ? 'on' : ''} onClick={() => setTab('notes')}>Index</button>
          <button type="button" role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>
            History <span className="count">{idx.history.filter((h) => CHANGE_OPS.has(h.op)).length}</span>
          </button>
          <button type="button" role="tab" aria-selected={tab === 'source'} className={tab === 'source' ? 'on' : ''} onClick={() => setTab('source')}>Source</button>
        </div>
      )}
      {(tab === 'notes' || !idx) && (
        <>
          {idx && (
            <table className="mem-index">
              <tbody>
                {idx.entries.map((e, i) => {
                  const n = p.notes.find((x) => x.file === e.file && !x.missing);
                  return (
                    <tr key={i} className={n ? '' : 'broken'}>
                      <td>
                        {n ? <button type="button" className="linkish" onClick={() => ctx.onFocus({ project: p.dirName, file: n.file })}>{e.title}</button> : <span>{e.title}</span>}
                        {n && <TypeChip type={noteType(n)} />}
                      </td>
                      <td className="hook">{e.hook}</td>
                      <td className="state">{n ? null : <span className="status-error" title={`${e.file} is not in the memory folder`}><Icon name="warn" size={11} /> missing file</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {unlisted.length > 0 && (
            <div className="mem-unlisted">
              <h4><Icon name="warn" size={11} /> Not in the index ({unlisted.length})</h4>
              <p className="help-text">Claude sees notes through MEMORY.md, so these are unlikely to be recalled.</p>
              <div className="mem-chips">
                {unlisted.map((n) => <button key={n.file} type="button" className="mem-wiki" onClick={() => ctx.onFocus({ project: p.dirName, file: n.file })}>{noteName(n)}</button>)}
              </div>
            </div>
          )}
        </>
      )}
      {idx && tab === 'history' && <History entries={idx.history} ctx={ctx} emptyText="No transcript on this machine records a change to MEMORY.md." />}
      {idx && tab === 'source' && <CodeBlock code={idx.body} lang="markdown" title="MEMORY.md" initialLines={200} />}
    </article>
  );
}

function Overview({ report, ctx }: { report: MemoryReport; ctx: Ctx }) {
  const notes = report.projects.flatMap((p) => p.notes.filter((n) => !n.missing).map((n) => ({ p, n })));
  const byType = new Map<string, number>();
  for (const { n } of notes) byType.set(noteType(n) ?? 'untyped', (byType.get(noteType(n) ?? 'untyped') || 0) + 1);
  const changes = report.projects
    .flatMap((p) => [...p.notes, ...(p.index ? [p.index as MemoryIndex] : [])].flatMap((n) => n.history.filter((h) => CHANGE_OPS.has(h.op)).map((h) => ({ p, n, h }))))
    .sort((a, b) => (b.h.ts || '').localeCompare(a.h.ts || ''));
  const writers = new Set(changes.map((c) => c.h.sessionId)).size;
  return (
    <article className="mem-note">
      <header className="mem-note-head"><h2>Memory</h2></header>
      <p className="mem-desc">What Claude has chosen to remember across sessions, per project, and which sessions wrote it.</p>
      <div className="stats mem-stats">
        <div className="stat"><span className="stat-k">Projects</span><span className="stat-v">{report.projects.length}</span></div>
        <div className="stat"><span className="stat-k">Notes</span><span className="stat-v">{notes.length}</span><span className="stat-sub">{[...byType].sort((a, b) => b[1] - a[1]).map(([t, c]) => `${c} ${t}`).join(' · ')}</span></div>
        <div className="stat"><span className="stat-k">Changes recorded</span><span className="stat-v">{changes.length}</span><span className="stat-sub">by {plural(writers, 'session')}</span></div>
      </div>
      <h4 className="mem-section">Recent changes</h4>
      {changes.length ? (
        <ol className="mem-hist-list">
          {changes.slice(0, 40).map(({ p, n, h }, i) => (
            <HistoryRow key={i} h={h} ctx={ctx} note={{ project: p.dirName, file: n.file, name: n.file === 'MEMORY.md' ? `${p.project.name} / MEMORY.md` : `${p.project.name} / ${noteName(n)}` }} />
          ))}
        </ol>
      ) : (
        <p className="help-text">No transcript on this machine records a memory change yet.</p>
      )}
    </article>
  );
}

function matches(n: MemoryNote, q: string) {
  return `${n.file}\n${noteName(n)}\n${noteDescription(n) ?? ''}\n${noteType(n) ?? ''}\n${n.body}`.toLowerCase().includes(q);
}

export function MemoryView({ byId, changeKey, focus, onFocus, onOpenSession }: Props) {
  const [report, setReport] = useState<MemoryReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      api.memory().then(
        (r) => !cancelled && (setReport(r), setError(null)),
        (e) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
      );
    }, report ? 400 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changeKey]);

  const ctx: Ctx = { byId, onFocus, onOpenSession };
  const q = query.trim().toLowerCase();
  const project = report?.projects.find((p) => p.dirName === focus.project) ?? null;
  const note = project && focus.file && focus.file !== 'MEMORY.md' ? project.notes.find((n) => n.file === focus.file) ?? null : null;

  let detail: ReactNode;
  if (!report) detail = <div className="state-panel"><div className="state-card">{error ? <><h2>Could not read memory</h2><p>{error}</p></> : <p className="help-text">Reading memory…</p>}</div></div>;
  else if (!report.projects.length)
    detail = (
      <div className="state-panel">
        <div className="state-card">
          <h2>No memory yet</h2>
          <p>Claude Code keeps notes it wants to remember in <code>~/.claude/projects/&lt;project&gt;/memory/</code>. None were found in this data directory.</p>
        </div>
      </div>
    );
  else if (note && project) detail = <NoteDetail p={project} note={note} ctx={ctx} />;
  else if (project) detail = <IndexDetail p={project} ctx={ctx} />;
  else detail = <Overview report={report} ctx={ctx} />;

  return (
    <div className="memory-view">
      <nav className="mem-nav" aria-label="Memory notes">
        <div className="mem-nav-top">
          <SearchInput value={query} onChange={setQuery} placeholder="Search memory…" ariaLabel="Search memory notes" />
        </div>
        <div className="mem-nav-list">
          <button type="button" className={`mem-nav-item mem-nav-all ${!focus.project ? 'on' : ''}`} onClick={() => onFocus({})}>
            <Icon name="memory" size={12} /> All memory
          </button>
          {report?.projects.map((p) => {
            const list = q ? p.notes.filter((n) => matches(n, q)) : p.notes;
            if (q && !list.length && !p.project.name.toLowerCase().includes(q)) return null;
            const isCollapsed = collapsed.has(p.dirName) && !q;
            return (
              <div key={p.dirName} className="mem-nav-group">
                <div className={`mem-nav-project ${focus.project === p.dirName && !note ? 'on' : ''}`}>
                  <button
                    type="button"
                    className="mem-nav-caret"
                    aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                    aria-expanded={!isCollapsed}
                    onClick={() => setCollapsed((s) => {
                      const n = new Set(s);
                      if (n.has(p.dirName)) n.delete(p.dirName);
                      else n.add(p.dirName);
                      return n;
                    })}
                  >
                    <Icon name="chevron" size={10} className={isCollapsed ? '' : 'rot90'} />
                  </button>
                  <button type="button" className="mem-nav-pname" onClick={() => onFocus({ project: p.dirName })} title={p.project.path}>
                    <span className="t">{p.project.name}</span>
                    <span className="n">{p.notes.filter((n) => !n.missing).length}</span>
                  </button>
                </div>
                {!isCollapsed &&
                  list.map((n) => (
                    <button key={n.file} type="button" className={`mem-nav-item ${note === n ? 'on' : ''} ${n.missing ? 'missing' : ''}`} onClick={() => onFocus({ project: p.dirName, file: n.file })} title={noteDescription(n) ?? n.file}>
                      <span className={`mem-dot t-${noteType(n) ?? 'none'}`} aria-hidden="true" />
                      <span className="mem-nav-text">
                        <span className="t">{noteName(n)}</span>
                        {noteDescription(n) && <span className="d">{noteDescription(n)}</span>}
                      </span>
                      {n.missing && <span className="chip warn">deleted</span>}
                    </button>
                  ))}
              </div>
            );
          })}
        </div>
      </nav>
      <div className="mem-detail">{detail}</div>
    </div>
  );
}
