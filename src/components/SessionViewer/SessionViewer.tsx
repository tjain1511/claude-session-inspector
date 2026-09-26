// Right-hand pane: header (title, facts, key numbers, sub-agents, time bar), toolbar (views,
// flow filters, error navigator, view options), find bar and the active view.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionEvent, SessionSummary } from '@/types/session';
import type { DetailState } from '@/features/sessions/useSessionDetail';
import { useSettings } from '@/features/settings/settings';
import { Icon } from '@/components/common/Icon';
import { SessionTitle } from './SessionTitle';
import { SessionOverview } from './SessionOverview';
import { TimelineBar } from '@/components/Timeline/TimelineBar';
import { Timeline, buildItems, errorTargets, ALL_FLOW, type FlowFilter, type FlowMode, type TimelineHandle } from '@/components/Timeline/Timeline';
import { ToolGantt } from '@/components/Timeline/ToolGantt';
import type { ForceOpen } from '@/components/Timeline/Card';
import { SubagentStrip } from './SubagentStrip';
import { SessionOutline } from './SessionOutline';
import { ContextView, ContextCard } from '@/components/Context/ContextView';
import { ToolDocsContext, type ContextTab } from '@/components/Context/ToolDocs';
import { useSessionContext } from '@/features/sessions/useSessionContext';
import { PrimaryModelContext } from '@/features/sessions/primaryModel';
import { MemoryByToolContext, memoryByTool } from '@/utils/memory';
import { FindBar } from '@/components/Search/FindBar';
import { RawInspector } from '@/components/Metadata/RawInspector';
import { eventSearchText } from '@/utils/events';
import { formatDateTime, modelLabel, MOD, relativeTime } from '@/utils/format';
import { Popover, OptionRow } from '@/components/common/Popover';
import { ContextMenu, type MenuItem } from '@/components/SessionList/SessionMenu';
import { useToast } from '@/hooks/useToast';
import { api } from '@/services/api';
import { useDebounced } from '@/hooks/useDebounce';

interface Props {
  session: SessionSummary;
  detail: DetailState;
  onRename: (name: string) => Promise<unknown>;
  onClearName: () => Promise<unknown>;
  onShowMetadata: () => void;
  onReload: () => void;
  findOpen: boolean;
  setFindOpen: (v: boolean) => void;
  titleEditing: boolean;
  setTitleEditing: (v: boolean) => void;
  rawEvent: SessionEvent | null;
  setRawEvent: (e: SessionEvent | null) => void;
  canReveal?: boolean;
  /** Scroll to the first of these tool calls present in the main flow once events load (from the Memory view). */
  jumpRequest?: { sessionId: string; toolUseIds: string[]; n: number } | null;
}

export function SessionViewer({ session: s, detail, onRename, onClearName, onShowMetadata, onReload, findOpen, setFindOpen, titleEditing, setTitleEditing, rawEvent, setRawEvent, canReveal, jumpRequest }: Props) {
  const [settings, update] = useSettings();
  const toast = useToast();
  const [find, setFind] = useState('');
  const [findIdx, setFindIdx] = useState(0);
  const [forceOpen, setForceOpen] = useState<ForceOpen>(null);
  const [view, setView] = useState<'flow' | 'gantt' | 'context'>('flow');
  const [filter, setFilter] = useState<FlowFilter>(ALL_FLOW);
  const [errIdx, setErrIdx] = useState(-1);
  const [activeTurn, setActiveTurn] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [ctxTab, setCtxTab] = useState<ContextTab>('prompt');
  const [ctxFocus, setCtxFocus] = useState<string | undefined>(undefined);
  const ctx = useSessionContext(s.id, detail.appendedAt);
  const toolDocs = useMemo(() => new Map((ctx.context?.tools ?? []).map((t) => [t.name, t])), [ctx.context]);
  const openContextTab = useCallback((tab: ContextTab, focus?: string) => {
    setCtxTab(tab);
    setCtxFocus(focus);
    setView('context');
  }, []);
  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<{ tab: ContextTab; focus?: string }>).detail;
      if (d?.tab) openContextTab(d.tab, d.focus);
    };
    window.addEventListener('csv:context', onOpen);
    return () => window.removeEventListener('csv:context', onOpen);
  }, [openContextTab]);
  const pendingJump = useRef<string | null>(null);
  const timeline = useRef<TimelineHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const debouncedFind = useDebounced(find.trim(), 120);
  const [autoScroll, setAutoScroll] = useState(true);

  const events = detail.events;
  const outputLines = settings.toolOutput === 'full' ? Infinity : 40;

  // Ids rendered under the current filter (a meta group counts for each event inside it).
  const visible = useMemo(() => {
    const { items } = buildItems(events, settings.showMetadata, settings.showThinking, filter);
    const ids = new Set<string>();
    for (const it of items) {
      if (it.kind === 'meta') for (const e of it.events) ids.add(e.id);
      else ids.add(it.e.id);
    }
    return ids;
  }, [events, settings.showMetadata, settings.showThinking, filter]);

  // In-session search: match ids over all events (not just mounted ones)
  const { matchIds, matchList } = useMemo(() => {
    const q = debouncedFind.toLowerCase();
    if (!q) return { matchIds: undefined, matchList: [] as string[] };
    const list: string[] = [];
    const ids = new Set<string>();
    const paired = new Map<string, string>(); // result id -> call id
    for (const e of events) if (e.type === 'tool_call' && e.toolUseId) paired.set(e.toolUseId, e.id);
    for (const e of events) {
      if (!eventSearchText(e).includes(q)) continue;
      let id = e.id;
      if (e.type === 'tool_result' && e.toolUseId && paired.has(e.toolUseId)) id = paired.get(e.toolUseId)!;
      if (!visible.has(id)) continue;
      if (!ids.has(id)) {
        ids.add(id);
        list.push(id);
      }
    }
    return { matchIds: ids, matchList: list };
  }, [events, debouncedFind, visible]);

  useEffect(() => setFindIdx(0), [debouncedFind]);
  const currentMatchId = matchList[findIdx] ?? null;
  useEffect(() => {
    if (currentMatchId) timeline.current?.scrollToEvent(currentMatchId);
  }, [currentMatchId]);

  // Jump to an event in the flow view from anywhere (outline, Gantt, sub-agent list, time bar,
  // error navigator, deep link). Switches to the flow view and drops a filter that would hide
  // the target, then scrolls once the flow has re-rendered.
  const viewRef = useRef(view);
  viewRef.current = view;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const jumpTo = useCallback((id: string) => {
    const hidden = !visibleRef.current.has(id);
    if (viewRef.current === 'flow' && !hidden) {
      timeline.current?.scrollToEvent(id);
      return;
    }
    pendingJump.current = id;
    if (hidden) setFilter(ALL_FLOW);
    setView('flow');
  }, []);
  useEffect(() => {
    if (view === 'flow' && pendingJump.current) {
      const id = pendingJump.current;
      pendingJump.current = null;
      setTimeout(() => timeline.current?.scrollToEvent(id), 0);
    }
  }, [view, filter]);
  const callByToolUse = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of events) if (e.type === 'tool_call' && e.toolUseId) m.set(e.toolUseId, e.id);
    return m;
  }, [events]);
  const jumpAgent = useCallback((toolUseId: string | null) => {
    const id = toolUseId ? callByToolUse.get(toolUseId) : undefined;
    if (id) jumpTo(id);
  }, [callByToolUse, jumpTo]);

  const memoryTools = useMemo(() => memoryByTool(s), [s]);
  const handledJump = useRef<number | null>(null);
  useEffect(() => {
    if (!jumpRequest || jumpRequest.sessionId !== s.id || handledJump.current === jumpRequest.n || detail.loading || !events.length) return;
    handledJump.current = jumpRequest.n;
    const id = jumpRequest.toolUseIds.map((t) => callByToolUse.get(t)).find(Boolean);
    if (id) setTimeout(() => jumpTo(id), 50);
  }, [jumpRequest, s.id, detail.loading, events.length, callByToolUse, jumpTo]);

  // Error navigator
  const errors = useMemo(() => errorTargets(events), [events]);
  const errIdxRef = useRef(-1);
  errIdxRef.current = errIdx;
  const gotoError = useCallback((dir: 1 | -1) => {
    if (!errors.length) return;
    const i = errIdxRef.current;
    const next = i < 0 || i >= errors.length ? (dir === 1 ? 0 : errors.length - 1) : (i + dir + errors.length) % errors.length;
    errIdxRef.current = next;
    setErrIdx(next);
    jumpTo(errors[next]!);
  }, [errors, jumpTo]);

  // Deep link: #session=…&event=… jumps once the session's events are in.
  const linkedFor = useRef<string | null>(null);
  useEffect(() => {
    if (detail.loading || !events.length || linkedFor.current === s.id) return;
    linkedFor.current = s.id;
    const m = location.hash.match(/[&#]event=([^&]+)/);
    if (m) {
      const id = decodeURIComponent(m[1]!);
      if (events.some((e) => e.id === id)) setTimeout(() => jumpTo(id), 50);
    }
  }, [detail.loading, events, s.id, jumpTo]);

  // Auto-follow live sessions when the user is near the bottom
  useEffect(() => {
    if (!detail.appendedAt || !s.live || !autoScroll) return;
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight }));
  }, [detail.appendedAt, s.live, autoScroll]);

  // Which user turn is at the top of the flow, for the outline's "you are here".
  const turnOf = useMemo(() => {
    const m = new Map<string, string>();
    let cur: string | null = null;
    for (const e of events) {
      if (e.type === 'user' && e.kind === 'human') cur = e.id;
      if (cur) m.set(e.id, cur);
    }
    return m;
  }, [events]);
  const spyFrame = useRef<number | null>(null);
  const spy = useCallback(() => {
    spyFrame.current = null;
    const el = scrollRef.current;
    if (!el || !settings.showOutline) return;
    const top = el.getBoundingClientRect().top + 48;
    const nodes = el.querySelectorAll<HTMLElement>(':scope > .timeline > [data-event-id]');
    let lo = 0;
    let hi = nodes.length - 1;
    let hit = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (nodes[mid]!.getBoundingClientRect().bottom > top) {
        hit = mid;
        hi = mid - 1;
      } else lo = mid + 1;
    }
    const id = hit >= 0 ? nodes[hit]!.dataset.eventId : undefined;
    const t = id ? turnOf.get(id) ?? null : null;
    setActiveTurn((prev) => (prev === t ? prev : t));
  }, [turnOf, settings.showOutline]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
    if (spyFrame.current == null) spyFrame.current = requestAnimationFrame(spy);
  };
  useEffect(() => {
    if (!detail.loading) spy();
  }, [detail.loading, spy, filter]);

  // Reset per-session UI state
  useEffect(() => {
    setFind('');
    setForceOpen(null);
    setView('flow');
    setFilter(ALL_FLOW);
    setErrIdx(-1);
    setCtxFocus(undefined);
    setAutoScroll(true);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [s.id]);

  const setMode = (mode: FlowMode) => setFilter((f) => ({ mode, tool: mode === 'chat' ? '' : f.tool }));
  const allCollapsed = !!forceOpen && !forceOpen.open;
  const toggleAll = useCallback(() => setForceOpen((f) => ({ open: !(f?.open ?? true), v: (f?.v ?? 0) + 1 })), []);

  // View-level shortcuts (list-level ones live in App).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (document.querySelector('.modal-backdrop, .drawer-backdrop')) return;
      if (e.key === ']') gotoError(1);
      else if (e.key === '[') gotoError(-1);
      else if (e.key === '1') setView('flow');
      else if (e.key === '2') setView('gantt');
      else if (e.key === '3') setView('context');
      else if (e.key.toLowerCase() === 'e' && view === 'flow') toggleAll();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gotoError, toggleAll, view]);

  const copy = (text: string, what: string) => void navigator.clipboard.writeText(text).then(() => toast(`${what} copied`), () => toast('Copy failed', 'error'));
  const menuItems: (MenuItem | 'sep')[] = [
    { label: 'Rename', icon: 'edit', hint: 'F2', onSelect: () => setTitleEditing(true) },
    { label: 'Reset to generated title', icon: 'reset', disabled: !s.customName, onSelect: () => void onClearName() },
    'sep',
    { label: 'Copy session ID', icon: 'copy', onSelect: () => copy(s.id, 'Session ID') },
    { label: 'Copy link to session', icon: 'link', onSelect: () => copy(`${location.origin}${location.pathname}#session=${s.id}`, 'Link') },
    { label: 'Copy resume command', icon: 'terminal', onSelect: () => copy(`cd ${JSON.stringify(s.project.raw)} && claude --resume ${s.id}`, 'Resume command') },
    { label: 'Copy project path', icon: 'folder', onSelect: () => copy(s.project.raw, 'Path') },
    'sep',
    { label: 'Reload from disk', icon: 'refresh', onSelect: onReload },
    { label: canReveal ? 'Reveal transcript file' : 'Reveal not supported here', icon: 'external', disabled: !canReveal, onSelect: () => void api.reveal(s.id).catch(() => toast('Could not reveal file', 'error')) },
  ];

  const errCount = errors.length;
  const filtered = filter.mode !== 'all' || !!filter.tool;
  const shownCount = visible.size;

  return (
    <ToolDocsContext.Provider value={toolDocs}>
    <PrimaryModelContext.Provider value={s.model}>
    <MemoryByToolContext.Provider value={memoryTools}>
    <div className="viewer">
      <div className="viewer-header">
        <div className="viewer-title-row">
          <SessionTitle session={s} onRename={onRename} onClearName={onClearName} editing={titleEditing} setEditing={setTitleEditing} />
          <div className="viewer-actions">
            {s.live && (
              <span className="chip success live-chip" title={`Claude Code process ${s.live.pid} is running this session`}>
                <span className="live-dot" /> Live{s.live.status ? ` · ${s.live.status}` : ''}
              </span>
            )}
            <button type="button" className={`btn ghost sm ${findOpen ? 'active' : ''}`} onClick={() => setFindOpen(!findOpen)} title={`Find in session (${MOD}+F)`}>
              <Icon name="search" size={12} /> Find
            </button>
            <button type="button" className="btn ghost sm" onClick={onShowMetadata} title="Session metadata (I)">
              <Icon name="info" size={12} /> Details
            </button>
            <button
              type="button"
              className={`btn ghost icon sm ${menu ? 'active' : ''}`}
              aria-label="Session actions"
              aria-haspopup="menu"
              title="More actions"
              onClick={(e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setMenu(menu ? null : { x: r.right - 220, y: r.bottom + 4 });
              }}
            >
              <Icon name="more" size={14} />
            </button>
          </div>
        </div>
        <div className="viewer-sub">
          <span className="fact mono" title={s.project.raw}><Icon name="folder" size={11} />{s.project.path}</span>
          {s.gitBranch && s.gitBranch !== 'HEAD' && <span className="fact mono branch" title={`git branch ${s.gitBranch}`}><Icon name="layers" size={11} /><span className="ell">{s.gitBranch}</span></span>}
          <span className="fact" title={s.endedAt ? `Last event ${formatDateTime(s.endedAt)}` : ''}><Icon name="clock" size={11} />updated {relativeTime(s.endedAt)}</span>
          {s.version && <span className="fact help-text">Claude Code v{s.version}</span>}
          {s.permissionModes.length > 0 && <span className="fact help-text" title="Permission modes used">{s.permissionModes.join(' → ')}</span>}
          {s.continuedIn && <span className="chip">continued in another session</span>}
          {s.prLinks.map((p) => <span key={p.url} className="chip tool" title={p.url}>PR #{p.number}</span>)}
        </div>
        <SessionOverview
          session={s}
          onShowMetadata={onShowMetadata}
          onShowErrors={() => { setView('flow'); setFilter((f) => (f.mode === 'errors' ? ALL_FLOW : { mode: 'errors', tool: '' })); }}
          errorsActive={filter.mode === 'errors'}
          onToggleAgents={() => update({ showAgents: !settings.showAgents })}
          agentsOpen={settings.showAgents}
        />
        {settings.showAgents && s.subagents.length > 0 && <SubagentStrip agents={s.subagents} primaryModel={s.model} onJump={jumpAgent} sessionStart={s.startedAt} sessionEnd={s.endedAt} />}
        {settings.showTimeBar && events.length > 1 && <TimelineBar events={events} onJump={jumpTo} compressIdle={settings.compressIdle} onToggleCompress={() => update({ compressIdle: !settings.compressIdle })} />}
      </div>
      <div className="toolbar">
        <div className="view-tabs" role="tablist" aria-label="View">
          <button type="button" role="tab" aria-selected={view === 'flow'} className={view === 'flow' ? 'on' : ''} onClick={() => setView('flow')} title="Chronological execution flow (1)">
            <Icon name="list" size={12} /><span className="lbl">Flow</span>
          </button>
          <button type="button" role="tab" aria-selected={view === 'gantt'} className={view === 'gantt' ? 'on' : ''} onClick={() => setView('gantt')} title="Model and tool calls on a time axis per turn: see what ran in parallel (2)">
            <Icon name="pulse" size={12} /><span className="lbl">Timeline</span>
          </button>
          <button type="button" role="tab" aria-selected={view === 'context'} className={view === 'context' ? 'on' : ''} onClick={() => setView('context')} title="System prompt, tools, agents, skills and instructions the model was given (3)">
            <Icon name="layers" size={12} /><span className="lbl">Context</span>
          </button>
        </div>
        {view === 'flow' && (
          <>
            <span className="tb-sep" />
            <div className="seg-control" role="radiogroup" aria-label="Show">
              {([['all', 'All'], ['chat', 'Messages'], ['tools', 'Tools'], ['errors', 'Errors']] as [FlowMode, string][]).map(([m, label]) => (
                <button key={m} type="button" role="radio" aria-checked={filter.mode === m} className={`${filter.mode === m ? 'on' : ''} ${m === 'errors' && errCount ? 'has-err' : ''}`} onClick={() => setMode(m)}>
                  {label}
                  {m === 'errors' && errCount > 0 && <span className="count">{errCount}</span>}
                </button>
              ))}
            </div>
            {s.tools.length > 0 && (
              <select className={`select tb-select ${filter.tool ? 'on' : ''}`} value={filter.tool} onChange={(e) => setFilter((f) => ({ mode: e.target.value && f.mode === 'chat' ? 'tools' : f.mode, tool: e.target.value }))} aria-label="Filter by tool" title="Only show calls to one tool">
                <option value="">Any tool</option>
                {s.tools.map((t) => <option key={t.name} value={t.name}>{t.name} ({t.count})</option>)}
              </select>
            )}
            {filtered && (
              <button type="button" className="btn ghost sm" onClick={() => setFilter(ALL_FLOW)} title="Show every event">
                <Icon name="x" size={10} /><span className="lbl">Clear</span>
              </button>
            )}
          </>
        )}
        {errCount > 0 && (
          <div className="err-nav" role="group" aria-label="Error navigator">
            <button type="button" className="btn ghost icon sm" onClick={() => gotoError(-1)} title="Previous error ([)" aria-label="Previous error"><Icon name="chevronLeft" size={12} /></button>
            <button type="button" className="err-nav-label" onClick={() => gotoError(1)} title="Jump to the next error (])">
              <Icon name="alert" size={12} />
              {errIdx >= 0 ? `${errIdx + 1} / ${errCount}` : `${errCount} error${errCount === 1 ? '' : 's'}`}
            </button>
            <button type="button" className="btn ghost icon sm" onClick={() => gotoError(1)} title="Next error (])" aria-label="Next error"><Icon name="chevron" size={12} /></button>
          </div>
        )}
        <span className="grow" />
        <span className="tb-count" aria-live="polite">
          {detail.loading ? 'Loading…' : filtered && view === 'flow' ? `${shownCount.toLocaleString()} of ${events.length.toLocaleString()} events` : `${events.length.toLocaleString()} events`}
        </span>
        {(detail.errors.length > 0 || detail.partial) && (
          <span className="chip warn" title={[detail.errors.length ? `${detail.errors.length} lines in the transcript were not valid JSON and were skipped` : '', detail.partial ? 'The last line is incomplete (Claude is still writing it)' : ''].filter(Boolean).join('\n')}>
            <Icon name="warn" size={10} /> {detail.errors.length ? `${detail.errors.length} skipped` : 'writing…'}
          </span>
        )}
        {view === 'flow' && (
          <>
            <Popover
              button={({ open, toggle }) => (
                <button type="button" className={`btn ghost sm ${open ? 'active' : ''}`} onClick={toggle} aria-expanded={open} title="Display options">
                  <Icon name="sliders" size={12} /><span className="lbl">View</span>
                </button>
              )}
            >
              <div className="opt-title">Flow</div>
              <OptionRow label="Compact tool calls" hint="Successful calls start as one row" checked={settings.density === 'compact'} onChange={(v) => update({ density: v ? 'compact' : 'comfortable' })} />
              <OptionRow label="Thinking blocks" checked={settings.showThinking} onChange={(v) => update({ showThinking: v })} />
              <OptionRow label="Metadata records" hint="Attachments, mode changes, housekeeping" checked={settings.showMetadata} onChange={(v) => update({ showMetadata: v })} />
              <OptionRow label="Full tool output" hint="Otherwise the first 40 lines" checked={settings.toolOutput === 'full'} onChange={(v) => update({ toolOutput: v ? 'full' : 'truncated' })} />
              <OptionRow label="Relative timestamps" hint="Time since session start" checked={settings.timestamps === 'relative'} onChange={(v) => update({ timestamps: v ? 'relative' : 'local' })} />
              <div className="opt-title">Header</div>
              <OptionRow label="Time distribution bar" checked={settings.showTimeBar} onChange={(v) => update({ showTimeBar: v })} />
              <OptionRow label="Compress idle time" hint="Long waits drawn narrow" checked={settings.compressIdle} onChange={(v) => update({ compressIdle: v })} />
              {s.subagents.length > 0 && <OptionRow label="Sub-agent list" checked={settings.showAgents} onChange={(v) => update({ showAgents: v })} />}
            </Popover>
            <button type="button" className="btn ghost sm" onClick={toggleAll} title="Expand / collapse all cards (E)">
              <Icon name={allCollapsed ? 'expand' : 'collapse'} size={12} /><span className="lbl">{allCollapsed ? 'Expand' : 'Collapse'}</span>
            </button>
          </>
        )}
        <button type="button" className={`btn ghost sm ${settings.showOutline ? 'active' : ''}`} onClick={() => update({ showOutline: !settings.showOutline })} aria-pressed={settings.showOutline} title="Turn-by-turn outline with sub-agents (O)">
          <Icon name="sidebar" size={12} /><span className="lbl">Outline</span>
        </button>
        {view === 'flow' && (
          <button type="button" className="btn ghost icon sm" onClick={() => { timeline.current?.mountAll(); requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })); }} title="Jump to the latest event" aria-label="Jump to the latest event">
            <Icon name="arrowDown" size={12} />
          </button>
        )}
      </div>
      {findOpen && (
        <FindBar
          query={find}
          onChange={setFind}
          count={matchList.length}
          index={findIdx}
          onNext={() => setFindIdx((i) => (matchList.length ? (i + 1) % matchList.length : 0))}
          onPrev={() => setFindIdx((i) => (matchList.length ? (i - 1 + matchList.length) % matchList.length : 0))}
          onClose={() => { setFindOpen(false); setFind(''); }}
          scoped={filtered}
        />
      )}
      <div className="viewer-body">
      <div className="timeline-scroll" ref={scrollRef} onScroll={onScroll} tabIndex={-1}>
        {detail.error ? (
          <div className="state-panel">
            <div className="state-card">
              <h2>Could not load this session</h2>
              <p className="error-text">{detail.error}</p>
              <div className="actions"><button type="button" className="btn" onClick={onReload}><Icon name="refresh" /> Retry</button></div>
            </div>
          </div>
        ) : detail.loading && events.length === 0 ? (
          <div className="timeline">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="event">
                <div className="gutter"><div className="skeleton" style={{ width: 60, marginLeft: 'auto' }} /></div>
                <div className="body"><div className="skeleton" style={{ height: 48 + (i % 3) * 20 }} /></div>
              </div>
            ))}
          </div>
        ) : view === 'gantt' ? (
          <ToolGantt events={events} subagents={s.subagents} onJump={jumpTo} />
        ) : view === 'context' ? (
          <ContextView session={s} ctx={ctx.context} loading={ctx.loading} error={ctx.error} events={events} tab={ctxTab} setTab={(t) => { setCtxTab(t); setCtxFocus(undefined); }} focus={ctxFocus} />
        ) : (
          <>
            {!filtered && (
              <div className="timeline timeline-context">
                <ContextCard session={s} ctx={ctx.context} loading={ctx.loading} onOpen={openContextTab} />
              </div>
            )}
            {filtered && (
              <div className="filter-banner">
                <Icon name="filter" size={11} />
                Showing {filter.mode === 'all' ? 'all events' : filter.mode === 'chat' ? 'messages' : filter.mode === 'tools' ? 'tool calls' : 'errors and interruptions'}
                {filter.tool ? <> for <code>{filter.tool}</code></> : null}
                <span className="help-text">· user prompts stay visible as anchors</span>
                <button type="button" className="link" onClick={() => setFilter(ALL_FLOW)}>Show everything</button>
              </div>
            )}
            <Timeline ref={timeline} events={events} sessionId={s.id} onRaw={setRawEvent} query={debouncedFind} matchIds={matchIds} currentMatchId={currentMatchId} forceOpen={forceOpen} outputLines={outputLines} subagents={s.subagents} live={!!s.live} scrollParent={scrollRef} filter={filter} />
            {s.live && (
              <div className="live-banner">
                <span className="live-dot" /> Claude is currently working in this session{s.live.status === 'idle' ? ' (waiting for input)' : '…'} — new events appear automatically.
              </div>
            )}
          </>
        )}
      </div>
      {settings.showOutline && !detail.loading && (
        <SessionOutline session={s} events={events} activeId={view === 'flow' ? activeTurn : null} onJump={jumpTo} onJumpAgent={jumpAgent} onClose={() => update({ showOutline: false })} />
      )}
      </div>
      {rawEvent && <RawInspector sessionId={s.id} event={rawEvent} onClose={() => setRawEvent(null)} />}
      {menu && <ContextMenu anchor={menu} items={menuItems} onClose={() => setMenu(null)} />}
    </div>
    </MemoryByToolContext.Provider>
    </PrimaryModelContext.Provider>
    </ToolDocsContext.Provider>
  );
}
