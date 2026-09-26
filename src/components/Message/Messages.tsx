import { useEffect, useState } from 'react';
import type { SessionEvent } from '@/types/session';
import { Card, type ForceOpen } from '@/components/Timeline/Card';
import { Markdown } from '@/utils/markdown';
import { markMatches } from '@/components/CodeBlock/CodeBlock';
import { CodeBlock } from '@/components/CodeBlock/CodeBlock';
import { api } from '@/services/api';
import { LazyImage } from '@/components/common/LazyImage';
import { Icon } from '@/components/common/Icon';
import { formatNumber, modelLabel } from '@/utils/format';
import { firstLine, fullTextFromRaw } from '@/utils/events';
import { usePrimaryModel } from '@/features/sessions/primaryModel';
import { Clamp } from '@/components/common/Clamp';

type Part = { kind: 'text'; text: string } | { kind: 'pasted'; text: string; id: string | null };

/** Split a prompt into plain text and <pasted_content> blocks (Claude Code wraps large pastes in that tag). */
function splitPasted(text: string): Part[] {
  const out: Part[] = [];
  // The closing tag can be missing when the server truncated a very long prompt.
  const re = /<pasted_content(?:\s+id="([^"]*)")?[^>]*>\n?([\s\S]*?)(?:\n?<\/pasted_content>|$)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!m[0]) break;
    if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
    out.push({ kind: 'pasted', id: m[1] ?? null, text: m[2] ?? '' });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out.map((p) => (p.kind === 'text' ? { ...p, text: p.text.trim() } : p)).filter((p) => p.kind === 'pasted' || p.text);
}

function PastedBlock({ text, query }: { text: string; query?: string }) {
  const lines = text.split('\n').length;
  const [open, setOpen] = useState(lines <= 12);
  return (
    <div className={`pasted ${open ? 'open' : ''}`}>
      <button type="button" className="pasted-head" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} aria-expanded={open}>
        <Icon name={open ? 'chevronDown' : 'chevron'} size={10} />
        <span className="lbl">Pasted content</span>
        <span className="help-text">{lines.toLocaleString()} lines · {formatNumber(text.length)} chars</span>
        {!open && <span className="peek">{firstLine(text)}</span>}
      </button>
      {open && <div className="pasted-body">{query ? <div style={{ whiteSpace: 'pre-wrap' }}>{markMatches(text, query.toLowerCase())}</div> : <Markdown text={text} />}</div>}
    </div>
  );
}

export interface EventCardProps {
  event: SessionEvent;
  sessionId: string;
  onRaw: (e: SessionEvent) => void;
  query?: string;
  forceOpen?: ForceOpen;
}

function useFullText(e: SessionEvent, sessionId: string) {
  const [full, setFull] = useState<string | null>(null);
  const load = async () => {
    const r = await api.readRaw(sessionId, e.ref);
    setFull(fullTextFromRaw(e, r.raw));
  };
  return { text: full ?? e.content ?? '', truncated: !!e.truncated && full == null, load };
}

const KIND_LABEL: Record<string, string> = {
  human: 'User',
  command: 'Command',
  'command-output': 'Command output',
  'system-reminder': 'System reminder',
  'task-notification': 'Task notification',
  'agent-report': 'Agent report',
  meta: 'Meta',
};

export function UserMessage({ event: e, sessionId, onRaw, query, forceOpen }: EventCardProps) {
  const { text, truncated, load } = useFullText(e, sessionId);
  const isCmd = e.kind === 'command';
  return (
    <Card
      type="user"
      role={KIND_LABEL[e.kind || 'human'] || 'User'}
      title={isCmd ? e.command?.name : undefined}
      desc={isCmd ? e.command?.args : undefined}
      force={forceOpen}
      right={
        <>
          {e.permissionMode && <span title="Permission mode">{e.permissionMode}</span>}
          {e.images ? <span title={`${e.images} image(s)`}>{e.images} img</span> : null}
        </>
      }
      copyText={text}
      onRaw={() => onRaw(e)}
      eventId={e.id}
      summary={firstLine(text)}
    >
      {!isCmd && (
        <div className="msg-text md">
          <Clamp maxHeight={300} label="prompt" force={!!query}>
            {splitPasted(text).map((p, i) =>
              p.kind === 'pasted' ? (
                <PastedBlock key={i} text={p.text} query={query} />
              ) : query ? (
                <div key={i} style={{ whiteSpace: 'pre-wrap' }}>{markMatches(p.text, query.toLowerCase())}</div>
              ) : e.kind === 'human' ? (
                <Markdown key={i} text={p.text} />
              ) : (
                <div key={i} style={{ whiteSpace: 'pre-wrap' }}>{p.text}</div>
              ),
            )}
          </Clamp>
          {truncated && (
            <div className="cb-more" style={{ marginTop: 6 }}>
              Truncated · <button type="button" onClick={() => void load()}>Load full message ({formatNumber(e.fullLength)} chars)</button>
            </div>
          )}
        </div>
      )}
      {isCmd && e.command?.message && <div className="msg-text" style={{ color: 'var(--text-2)' }}>{e.command.message}</div>}
      {e.imageBlocks && e.imageBlocks.length > 0 && (
        <div className="images">
          {e.imageBlocks.map((b) => (
            <LazyImage key={b} url={api.imageUrl(sessionId, e.ref, b)} alt="Image attached by the user" caption={`image ${e.imageBlocks!.indexOf(b) + 1} of ${e.imageBlocks!.length}`} />
          ))}
        </div>
      )}
    </Card>
  );
}

export function AssistantMessage({ event: e, sessionId, onRaw, query, forceOpen }: EventCardProps) {
  const { text, truncated, load } = useFullText(e, sessionId);
  const u = e.usage;
  const primary = usePrimaryModel();
  const otherModel = !!(e.model && primary && e.model !== primary);
  const cached = u ? (u.cacheRead ?? 0) + (u.cacheCreate ?? 0) : 0;
  return (
    <Card
      type="assistant"
      role="Claude"
      force={forceOpen}
      right={
        <>
          {e.model && (otherModel ? <span className="chip warn" title={`${e.model}\nDifferent from the session's main model (${primary})`}>{modelLabel(e.model)}</span> : <span title={e.model}>{modelLabel(e.model)}</span>)}
          {u && u.output != null && (
            <span title={`Tokens for this API message\nuncached input ${formatNumber(u.input)}\ncache read ${formatNumber(u.cacheRead)}\ncache write ${formatNumber(u.cacheCreate)}\noutput ${formatNumber(u.output)}${u.thinking ? `\nof which thinking ${formatNumber(u.thinking)}` : ''}`}>
              {formatNumber((u.input ?? 0) + cached)} in{cached > 0 && <span className="help-text"> ({formatNumber(cached)} cached)</span>} · {formatNumber(u.output)} out
            </span>
          )}
          {e.stopReason && e.stopReason !== 'tool_use' && e.stopReason !== 'end_turn' && <span className="chip warn">{e.stopReason}</span>}
        </>
      }
      copyText={text}
      onRaw={() => onRaw(e)}
      summary={firstLine(text) || (e.empty ? '(empty response)' : '')}
      eventId={e.id}
    >
      <div className="msg-text md">
        <Clamp maxHeight={640} label="response" force={!!query}>
          {query ? <div style={{ whiteSpace: 'pre-wrap' }}>{markMatches(text, query.toLowerCase())}</div> : <Markdown text={text} />}
        </Clamp>
        {truncated && (
          <div className="cb-more" style={{ marginTop: 6 }}>
            Truncated · <button type="button" onClick={() => void load()}>Load full response ({formatNumber(e.fullLength)} chars)</button>
          </div>
        )}
      </div>
    </Card>
  );
}

export function ThinkingBlock({ event: e, sessionId, onRaw, query, forceOpen }: EventCardProps) {
  const { text, truncated, load } = useFullText(e, sessionId);
  const chars = e.fullLength ?? text.length;
  return (
    <Card
      type="thinking"
      role="Thinking"
      defaultOpen={false}
      force={forceOpen}
      right={<span title={e.redacted ? 'Reasoning is present in the log but its text was not recorded (signature only)' : undefined}>{e.redacted ? 'redacted · signature only' : `${formatNumber(chars)} chars`}</span>}
      copyText={text}
      onRaw={() => onRaw(e)}
      summary={e.redacted && !text ? undefined : firstLine(text)}
    >
      <div className="msg-text thinking-text">
        {e.redacted && !text ? 'Reasoning is present in the log but its text was not recorded (signature only).' : query ? markMatches(text, query.toLowerCase()) : text}
        {truncated && (
          <div className="cb-more" style={{ marginTop: 6 }}>
            Truncated · <button type="button" onClick={() => void load()}>Load full</button>
          </div>
        )}
      </div>
    </Card>
  );
}

/** Report handed back by a sub-agent, or a background task notification. Links to the spawning tool call. */
export function AgentReportCard({ event: e, sessionId, onRaw, query, forceOpen, onJumpAgent }: EventCardProps & { onJumpAgent?: (from: string) => string | null }) {
  const { text, truncated, load } = useFullText(e, sessionId);
  const isReport = e.kind === 'agent-report';
  const target = e.originFrom && onJumpAgent ? onJumpAgent(e.originFrom) : null;
  return (
    <Card
      type="system"
      role={isReport ? 'Agent report' : 'Task notification'}
      desc={e.originFrom ? `from ${e.originFrom}` : undefined}
      defaultOpen={isReport}
      force={forceOpen}
      right={target ? <button type="button" className="btn ghost sm" onClick={(ev) => { ev.stopPropagation(); (onJumpAgent as (f: string) => string | null)(e.originFrom!); document.dispatchEvent(new CustomEvent('csv:jump', { detail: target })); }} title="Jump to the tool call that spawned this agent"><Icon name="agent" size={12} /> spawning call</button> : undefined}
      copyText={text}
      onRaw={() => onRaw(e)}
      summary={firstLine(text)}
    >
      <div className="msg-text">
        {query ? markMatches(text, query.toLowerCase()) : text}
        {truncated && (
          <div className="cb-more" style={{ marginTop: 6 }}>
            Truncated · <button type="button" onClick={() => void load()}>Load full</button>
          </div>
        )}
      </div>
    </Card>
  );
}

export function ErrorCard({ event: e, onRaw, forceOpen }: EventCardProps) {
  return (
    <Card
      type="error"
      role="Error"
      title={e.subtype}
      force={forceOpen}
      right={e.retry ? <span>retry {e.retry.attempt}/{e.retry.max} in {e.retry.inMs}ms</span> : e.status ? <span>HTTP {e.status}</span> : undefined}
      copyText={e.content}
      onRaw={() => onRaw(e)}
      summary={firstLine(e.content || '')}
    >
      <div className="msg-text">{e.content}</div>
    </Card>
  );
}

export function SystemCard({ event: e, onRaw, forceOpen }: EventCardProps) {
  const label = e.subtype === 'interrupted' ? 'Interrupted' : e.subtype === 'away_summary' ? 'Recap' : e.subtype === 'local_command' ? 'Local command' : 'System';
  const isXml = (e.content || '').trimStart().startsWith('<');
  return (
    <Card type="system" role={label} defaultOpen={e.subtype !== 'local_command'} force={forceOpen} copyText={e.content} onRaw={() => onRaw(e)} summary={firstLine(e.content || '')} right={e.durationMs != null ? <span>{e.durationMs}ms</span> : undefined}>
      {isXml ? <CodeBlock code={e.content || ''} lang="text" compact initialLines={20} /> : <div className="msg-text">{e.content}</div>}
    </Card>
  );
}

export function UnknownCard({ event: e, onRaw, forceOpen }: EventCardProps) {
  return (
    <Card type="unknown" role="Unknown" desc={e.label || e.kind} defaultOpen={false} force={forceOpen} onRaw={() => onRaw(e)} summary="Unrecognized record type — open the raw event to inspect it.">
      <div className="msg-text help-text">This record type is not understood by this version of the viewer. Use "view raw" to inspect the original JSON.</div>
    </Card>
  );
}
