// Right-hand pane: header (rename, facts, overview, time bar), toolbar, find bar, timeline.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionEvent, SessionSummary } from '@/types/session';
import type { DetailState } from '@/features/sessions/useSessionDetail';
import { useSettings } from '@/features/settings/settings';
import { Icon } from '@/components/common/Icon';
import { SessionTitle } from './SessionTitle';
import { SessionOverview } from './SessionOverview';
import { TimelineBar } from '@/components/Timeline/TimelineBar';
import { Timeline, buildItems, type TimelineHandle } from '@/components/Timeline/Timeline';
import { FindBar } from '@/components/Search/FindBar';
import { RawInspector } from '@/components/Metadata/RawInspector';
import { eventSearchText } from '@/utils/events';
import { formatDateTime, modelLabel, MOD, plural, relativeTime } from '@/utils/format';
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
}

export function SessionViewer({ session: s, detail, onRename, onClearName, onShowMetadata, onReload, findOpen, setFindOpen, titleEditing, setTitleEditing, rawEvent, setRawEvent }: Props) {
  const [settings, update] = useSettings();
  const [find, setFind] = useState('');
  const [findIdx, setFindIdx] = useState(0);
  const [forceOpen, setForceOpen] = useState<boolean | null>(null);
  const [showBar, setShowBar] = useState(true);
  const timeline = useRef<TimelineHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const debouncedFind = useDebounced(find.trim(), 120);
  const [autoScroll, setAutoScroll] = useState(true);

  const events = detail.events;
  const outputLines = settings.toolOutput === 'full' ? Infinity : 40;

  // In-session search: match ids over all events (not just mounted ones)
  const { matchIds, matchList } = useMemo(() => {
    const q = debouncedFind.toLowerCase();
    if (!q) return { matchIds: undefined, matchList: [] as string[] };
    const { items } = buildItems(events, settings.showMetadata, settings.showThinking);
    const list: string[] = [];
    const ids = new Set<string>();
    const paired = new Map<string, string>(); // result id -> call id
    for (const e of events) if (e.type === 'tool_call' && e.toolUseId) paired.set(e.toolUseId, e.id);
    const visible = new Set<string>();
    for (const it of items) {
      if (it.kind === 'meta') for (const e of it.events) visible.add(e.id);
      else visible.add(it.e.id);
    }
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
  }, [events, debouncedFind, settings.showMetadata, settings.showThinking]);

  useEffect(() => setFindIdx(0), [debouncedFind]);
  const currentMatchId = matchList[findIdx] ?? null;
  useEffect(() => {
    if (currentMatchId) timeline.current?.scrollToEvent(currentMatchId);
  }, [currentMatchId]);

  const jump = useCallback((id: string) => timeline.current?.scrollToEvent(id), []);

  // Auto-follow live sessions when the user is near the bottom
  useEffect(() => {
    if (!detail.appendedAt || !s.live || !autoScroll) return;
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight }));
  }, [detail.appendedAt, s.live, autoScroll]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
  };

  // Reset per-session UI state
  useEffect(() => {
    setFind('');
    setForceOpen(null);
    setAutoScroll(true);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [s.id]);

  const eventCounts = useMemo(() => {
    let tools = 0;
    let errors = 0;
    for (const e of events) {
      if (e.type === 'tool_call') tools++;
      if (e.type === 'error' || (e.type === 'tool_result' && e.isError)) errors++;
    }
    return { tools, errors };
  }, [events]);

  return (
    <div className="viewer">
      <div className="viewer-header">
        <div className="viewer-title-row">
          <SessionTitle session={s} onRename={onRename} onClearName={onClearName} editing={titleEditing} setEditing={setTitleEditing} />
          <div className="viewer-actions">
            {s.live && (
              <span className="chip success" title={`Claude Code process ${s.live.pid} is running this session`}>
                <span className="live-dot" /> Live{s.live.status ? ` · ${s.live.status}` : ''}
              </span>
            )}
            <button type="button" className="btn ghost sm" onClick={() => setFindOpen(!findOpen)} title={`Find in session (${MOD}+F)`}>
              <Icon name="search" size={12} /> Find
            </button>
            <button type="button" className="btn ghost sm" onClick={onShowMetadata} title="Session metadata (I)">
              <Icon name="info" size={12} /> Metadata
            </button>
            <button type="button" className="btn ghost sm" onClick={onReload} title="Reload this session from disk">
              <Icon name="refresh" size={12} />
            </button>
          </div>
        </div>
        <div className="viewer-sub">
          <span className="mono" title={s.project.raw}>{s.project.path}</span>
          {s.gitBranch && (<><span className="sep">·</span><span className="mono" title="git branch">{s.gitBranch}</span></>)}
          {s.model && (<><span className="sep">·</span><span title={s.models.map((m) => `${m.name} ×${m.count}`).join(', ')}>{modelLabel(s.model)}{s.models.length > 1 ? ` +${s.models.length - 1}` : ''}</span></>)}
          <span className="sep">·</span>
          <span>{plural(s.counts.messages, 'message')}</span>
          <span className="sep">·</span>
          <span>{plural(s.counts.toolCalls, 'tool call')}</span>
          <span className="sep">·</span>
          <span title={s.endedAt ? formatDateTime(s.endedAt) : ''}>{relativeTime(s.endedAt)}</span>
          {s.version && (<><span className="sep">·</span><span className="help-text">Claude Code v{s.version}</span></>)}
          {s.continuedIn && (<><span className="sep">·</span><span className="chip">continued in another session</span></>)}
        </div>
        <SessionOverview session={s} />
        {showBar && events.length > 1 && <TimelineBar events={events} onJump={jump} />}
      </div>
      <div className="toolbar">
        <span>
          {detail.loading ? 'Loading events…' : `${events.length.toLocaleString()} events`}
          {!detail.loading && eventCounts.errors > 0 && <span style={{ color: 'var(--error)' }}> · {eventCounts.errors} errors</span>}
          {detail.errors.length > 0 && <span style={{ color: 'var(--warning)' }}> · {detail.errors.length} unreadable lines skipped</span>}
          {detail.partial && <span style={{ color: 'var(--warning)' }}> · file has an incomplete last line (write in progress)</span>}
        </span>
        <span className="grow" />
        <div className="type-toggles">
          <button type="button" className={`chip ${settings.showThinking ? 'active' : ''}`} onClick={() => update({ showThinking: !settings.showThinking })} aria-pressed={settings.showThinking} title="Show thinking blocks">thinking</button>
          <button type="button" className={`chip ${settings.showMetadata ? 'active' : ''}`} onClick={() => update({ showMetadata: !settings.showMetadata })} aria-pressed={settings.showMetadata} title="Show metadata and attachment records">metadata</button>
          <button type="button" className={`chip ${showBar ? 'active' : ''}`} onClick={() => setShowBar((v) => !v)} aria-pressed={showBar} title="Show time distribution bar">time bar</button>
        </div>
        <button type="button" className="btn ghost sm" onClick={() => setForceOpen(forceOpen === false ? true : false)} title="Expand / collapse all cards (E)">
          <Icon name={forceOpen === false ? 'expand' : 'collapse'} size={12} /> {forceOpen === false ? 'Expand all' : 'Collapse all'}
        </button>
        <button type="button" className="btn ghost sm" onClick={() => { timeline.current?.mountAll(); requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })); }} title="Jump to the latest event">
          <Icon name="arrowDown" size={12} /> End
        </button>
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
        />
      )}
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
        ) : (
          <>
            <Timeline ref={timeline} events={events} sessionId={s.id} onRaw={setRawEvent} query={debouncedFind} matchIds={matchIds} currentMatchId={currentMatchId} forceOpen={forceOpen} outputLines={outputLines} subagents={s.subagents} live={!!s.live} scrollParent={scrollRef} />
            {s.live && (
              <div className="live-banner">
                <span className="live-dot" /> Claude is currently working in this session{s.live.status === 'idle' ? ' (waiting for input)' : '…'} — new events appear automatically.
              </div>
            )}
          </>
        )}
      </div>
      {rawEvent && <RawInspector sessionId={s.id} event={rawEvent} onClose={() => setRawEvent(null)} />}
    </div>
  );
}
