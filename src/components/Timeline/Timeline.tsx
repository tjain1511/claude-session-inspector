// Chronological execution flow. Renders events in a window that grows as the user
// scrolls (plus content-visibility for off-screen cards) so huge sessions stay smooth.
import { memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from 'react';
import type { SessionEvent, SubagentSummary } from '@/types/session';
import { useSettings } from '@/features/settings/settings';
import { formatClock, formatDuration, formatOffset } from '@/utils/format';
import { eventTs } from '@/utils/events';
import { Icon } from '@/components/common/Icon';
import { UserMessage, AssistantMessage, ThinkingBlock, ErrorCard, SystemCard, UnknownCard, AgentReportCard } from '@/components/Message/Messages';
import { ToolCallCard } from '@/components/ToolCall/ToolCallCard';
import { OrphanToolResult } from '@/components/ToolCall/ToolResult';
import type { ForceOpen } from './Card';

export type Item =
  | { kind: 'event'; e: SessionEvent; idx: number }
  | { kind: 'meta'; events: SessionEvent[]; idx: number }
  | { kind: 'turn'; e: SessionEvent; idx: number };

export interface TimelineHandle {
  scrollToEvent: (id: string) => void;
  mountAll: () => void;
}

interface Props {
  events: SessionEvent[];
  sessionId: string;
  onRaw: (e: SessionEvent) => void;
  query?: string;
  matchIds?: Set<string>;
  currentMatchId?: string | null;
  forceOpen?: ForceOpen;
  outputLines: number;
  subagents: SubagentSummary[];
  nested?: boolean;
  live?: boolean;
  scrollParent?: React.RefObject<HTMLElement | null>;
}

const PAGE = 120;

/** Build render items: pair tool results with their calls, group metadata, mark turn boundaries. */
export function buildItems(events: SessionEvent[], showMeta: boolean, showThinking: boolean) {
  const results = new Map<string, SessionEvent>();
  for (const e of events) if (e.type === 'tool_result' && e.toolUseId) results.set(e.toolUseId, e);
  const callIds = new Set<string>();
  for (const e of events) if (e.type === 'tool_call' && e.toolUseId) callIds.add(e.toolUseId);
  const items: Item[] = [];
  let metaBuf: SessionEvent[] = [];
  const flush = () => {
    if (metaBuf.length) {
      if (showMeta) items.push({ kind: 'meta', events: metaBuf, idx: items.length });
      metaBuf = [];
    }
  };
  for (const e of events) {
    if (e.type === 'tool_result' && e.toolUseId && callIds.has(e.toolUseId)) continue; // rendered inside its call
    if (e.type === 'metadata' && e.kind === 'turn_duration') {
      flush();
      items.push({ kind: 'turn', e, idx: items.length });
      continue;
    }
    if (e.type === 'metadata' && (e.kind === 'agent-report' || e.kind === 'task-notification')) {
      flush();
      items.push({ kind: 'event', e, idx: items.length });
      continue;
    }
    if (e.type === 'metadata' || e.type === 'attachment') {
      metaBuf.push(e);
      continue;
    }
    if (e.type === 'thinking' && !showThinking) continue;
    flush();
    items.push({ kind: 'event', e, idx: items.length });
  }
  flush();
  return { items, results };
}

export const Timeline = forwardRef<TimelineHandle, Props>(function Timeline({ events, sessionId, onRaw, query, matchIds, currentMatchId, forceOpen, outputLines, subagents, nested, live, scrollParent }, ref) {
  const [settings] = useSettings();
  const { items, results } = useMemo(() => buildItems(events, settings.showMetadata, settings.showThinking), [events, settings.showMetadata, settings.showThinking]);
  const [mounted, setMounted] = useState(nested ? Infinity : PAGE);
  const sentinel = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const startTs = useMemo(() => {
    let min: number | null = null;
    for (const e of events) {
      const t = eventTs(e);
      if (t != null && (min == null || t < min)) min = t;
    }
    return min;
  }, [events]);
  const subByToolUse = useMemo(() => new Map(subagents.filter((s) => s.toolUseId).map((s) => [s.toolUseId as string, s])), [subagents]);
  // agent short id (as it appears in origin.from) -> spawning tool_call event id
  const callByAgent = useMemo(() => {
    const byToolUse = new Map<string, string>();
    for (const e of events) if (e.type === 'tool_call' && e.toolUseId) byToolUse.set(e.toolUseId, e.id);
    const m = new Map<string, string>();
    for (const s of subagents) {
      const call = s.toolUseId ? byToolUse.get(s.toolUseId) : undefined;
      if (call) {
        m.set(s.agentId, call);
        m.set(s.agentId.replace(/^agent-/, ''), call);
      }
    }
    return m;
  }, [events, subagents]);
  const jumpAgent = useCallback((from: string) => callByAgent.get(from) ?? callByAgent.get(`agent-${from}`) ?? null, [callByAgent]);
  useEffect(() => {
    const h = (ev: Event) => {
      const id = (ev as CustomEvent<string>).detail;
      const idx = items.findIndex((it) => it.kind !== 'meta' && it.e.id === id);
      if (idx < 0) return;
      if (idx >= mounted) setMounted(Math.min(items.length, idx + PAGE));
      requestAnimationFrame(() => requestAnimationFrame(() => (root.current?.querySelector(`[data-event-id="${CSS.escape(id)}"]`) as HTMLElement | null)?.scrollIntoView({ block: 'center' })));
    };
    document.addEventListener('csv:jump', h);
    return () => document.removeEventListener('csv:jump', h);
  }, [items, mounted]);

  // Reset window when switching sessions
  useEffect(() => {
    setMounted(nested ? Infinity : PAGE);
  }, [sessionId, nested]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || mounted >= items.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((x) => x.isIntersecting)) setMounted((m) => Math.min(items.length, m + PAGE));
      },
      { root: scrollParent?.current ?? null, rootMargin: '600px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [mounted, items.length, scrollParent]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToEvent: (id) => {
        const idx = items.findIndex((it) => (it.kind === 'meta' ? it.events.some((e) => e.id === id) : it.e.id === id));
        if (idx < 0) return;
        if (idx >= mounted) setMounted(Math.min(items.length, idx + PAGE));
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const el = root.current?.querySelector(`[data-event-id="${CSS.escape(id)}"]`) as HTMLElement | null;
            el?.scrollIntoView({ block: 'center' });
          });
        });
      },
      mountAll: () => setMounted(Infinity),
    }),
    [items, mounted],
  );

  const visible = mounted >= items.length ? items : items.slice(0, mounted);
  let prevTs: number | null = null;

  return (
    <div className="timeline" ref={root}>
      {visible.map((it) => {
        if (it.kind === 'meta') {
          const ts = eventTs(it.events[0]!);
          const row = <MetaGroup key={'m' + it.idx} events={it.events} onRaw={onRaw} ts={ts} startTs={startTs} mode={settings.timestamps} matchIds={matchIds} />;
          if (ts != null) prevTs = ts;
          return row;
        }
        if (it.kind === 'turn') {
          return (
            <div className="turn-sep" key={it.e.id} data-event-id={it.e.id}>
              <div />
              <div className="body">
                <Icon name="clock" size={11} /> turn took {formatDuration(it.e.durationMs)}{it.e.messageCount != null ? ` · ${it.e.messageCount} messages in context` : ''}
              </div>
            </div>
          );
        }
        const e = it.e;
        const ts = eventTs(e);
        const gap = ts != null && prevTs != null ? ts - prevTs : null;
        const rel = ts != null && startTs != null ? ts - startTs : null;
        if (ts != null) prevTs = ts;
        const result = e.type === 'tool_call' && e.toolUseId ? results.get(e.toolUseId) : undefined;
        const isMatch = matchIds?.has(e.id);
        return (
          <div key={e.id} data-event-id={e.id} className={`event type-${e.type} ${result?.isError ? 'has-error' : ''} ${isMatch ? 'match' : ''} ${currentMatchId === e.id ? 'current-match' : ''}`}>
            <div className="gutter">
              <span className="marker" aria-hidden="true" />
              {ts != null ? (
                settings.timestamps === 'local' ? (
                  <>
                    <span className="abs" title={e.ts || ''}>{formatClock(e.ts)}</span>
                    <span className="rel">{formatOffset(rel)}</span>
                  </>
                ) : (
                  <>
                    <span className="abs">{formatOffset(rel)}</span>
                    <span className="rel" title={e.ts || ''}>{formatClock(e.ts)}</span>
                  </>
                )
              ) : (
                <span className="abs">—</span>
              )}
              {gap != null && gap > 0 && <span className="gap" title="Time since previous event">Δ {formatDuration(gap)}</span>}
            </div>
            <div className="body">
              <EventBody e={e} result={result} sessionId={sessionId} onRaw={onRaw} query={isMatch ? query : undefined} forceOpen={forceOpen} outputLines={outputLines} subagent={e.toolUseId ? subByToolUse.get(e.toolUseId) : undefined} live={live} jumpAgent={jumpAgent} />
            </div>
          </div>
        );
      })}
      {mounted < items.length && (
        <div className="load-more" ref={sentinel}>
          <button type="button" className="btn" onClick={() => setMounted((m) => Math.min(items.length, m + PAGE))}>
            Show more ({(items.length - mounted).toLocaleString()} remaining)
          </button>
          <button type="button" className="btn ghost" style={{ marginLeft: 8 }} onClick={() => setMounted(Infinity)}>
            Show all
          </button>
        </div>
      )}
      {items.length === 0 && <div className="help-text" style={{ padding: 20 }}>No events to show{!settings.showMetadata ? ' (metadata events are hidden in settings)' : ''}.</div>}
    </div>
  );
});

const EventBody = memo(function EventBody({ e, result, sessionId, onRaw, query, forceOpen, outputLines, subagent, live, jumpAgent }: { e: SessionEvent; result?: SessionEvent; sessionId: string; onRaw: (e: SessionEvent) => void; query?: string; forceOpen?: ForceOpen; outputLines: number; subagent?: SubagentSummary; live?: boolean; jumpAgent?: (from: string) => string | null }) {
  const p = { event: e, sessionId, onRaw, query, forceOpen };
  if (e.type === 'metadata') return <AgentReportCard {...p} onJumpAgent={jumpAgent} />;
  switch (e.type) {
    case 'user':
      return <UserMessage {...p} />;
    case 'assistant':
      return <AssistantMessage {...p} />;
    case 'thinking':
      return <ThinkingBlock {...p} />;
    case 'tool_call':
      return <ToolCallCard event={e} result={result} sessionId={sessionId} onRaw={onRaw} query={query} forceOpen={forceOpen} outputLines={outputLines} subagent={subagent} live={live} />;
    case 'tool_result':
      return <OrphanToolResult result={e} sessionId={sessionId} onRaw={onRaw} initialLines={outputLines} />;
    case 'error':
      return <ErrorCard {...p} />;
    case 'system':
      return <SystemCard {...p} />;
    default:
      return <UnknownCard {...p} />;
  }
});

const META_LABEL: Record<string, string> = {
  attachment: 'attachment',
  'system-reminder': 'system reminder',
  'task-notification': 'task notification',
  'command-output': 'command output',
  'agent-report': 'agent report',
  meta: 'meta',
};

function MetaGroup({ events, onRaw, ts, startTs, mode, matchIds }: { events: SessionEvent[]; onRaw: (e: SessionEvent) => void; ts: number | null; startTs: number | null; mode: 'local' | 'relative'; matchIds?: Set<string> }) {
  const hasMatch = matchIds && events.some((e) => matchIds.has(e.id));
  const [open, setOpen] = useState(false);
  const isOpen = open || !!hasMatch;
  const kinds = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of events) {
      const k = e.type === 'attachment' ? e.attachmentType || 'attachment' : e.kind || 'metadata';
      m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [events]);
  const rel = ts != null && startTs != null ? ts - startTs : null;
  return (
    <div className="meta-group" data-event-id={events[0]!.id}>
      <div className="gutter" style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-3)', paddingTop: 3, paddingRight: 20, position: 'relative' }}>
        <span className="marker" style={{ position: 'absolute', right: 5, top: 8, width: 7, height: 7, borderRadius: '50%', background: 'var(--surface)', border: '1px solid var(--text-3)' }} />
        {ts != null ? (mode === 'local' ? formatClock(events[0]!.ts) : formatOffset(rel)) : ''}
      </div>
      <div className="body">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={isOpen}>
          <Icon name={isOpen ? 'chevronDown' : 'chevron'} size={10} />
          {events.length} metadata {events.length === 1 ? 'event' : 'events'}
          <span style={{ opacity: 0.7 }}>{kinds.slice(0, 4).map(([k, n]) => `${k}${n > 1 ? ' ×' + n : ''}`).join(', ')}{kinds.length > 4 ? ', …' : ''}</span>
        </button>
        {isOpen && (
          <div style={{ marginTop: 2 }}>
            {events.map((e) => (
              <div key={e.id} className={`meta-row ${matchIds?.has(e.id) ? 'match' : ''}`} data-event-id={e.id}>
                <span className="kind">{e.type === 'attachment' ? e.attachmentType : META_LABEL[e.kind || ''] || e.kind}</span>
                <span className="text" title={e.content || e.preview || ''}>{e.type === 'attachment' ? e.preview : (e.content || '').replace(/\s+/g, ' ').slice(0, 300)}</span>
                <button type="button" className="raw-btn" title="View raw event" aria-label="View raw event" onClick={() => onRaw(e)}>
                  <Icon name="code" size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
