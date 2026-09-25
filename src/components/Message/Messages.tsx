import { useEffect, useRef, useState } from 'react';
import type { SessionEvent } from '@/types/session';
import { Card } from '@/components/Timeline/Card';
import { Markdown } from '@/utils/markdown';
import { markMatches } from '@/components/CodeBlock/CodeBlock';
import { CodeBlock } from '@/components/CodeBlock/CodeBlock';
import { api } from '@/services/api';
import { formatNumber, modelLabel } from '@/utils/format';
import { firstLine, fullTextFromRaw } from '@/utils/events';

export interface EventCardProps {
  event: SessionEvent;
  sessionId: string;
  onRaw: (e: SessionEvent) => void;
  query?: string;
  forceOpen?: boolean | null;
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
      open={forceOpen ?? undefined}
      right={
        <>
          {e.permissionMode && <span title="Permission mode">{e.permissionMode}</span>}
          {e.images ? <span title={`${e.images} image(s)`}>{e.images} img</span> : null}
        </>
      }
      copyText={text}
      onRaw={() => onRaw(e)}
      summary={firstLine(text)}
    >
      {!isCmd && (
        <div className="msg-text">
          {query ? markMatches(text, query.toLowerCase()) : text}
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
            <LazyImage key={b} url={api.imageUrl(sessionId, e.ref, b)} />
          ))}
        </div>
      )}
    </Card>
  );
}

function LazyImage({ url }: { url: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((x) => x.isIntersecting)) {
        io.disconnect();
        api.fetchImage(url).then((u) => !cancelled && setSrc(u)).catch(() => !cancelled && setErr(true));
      }
    });
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
      if (src) URL.revokeObjectURL(src);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  return (
    <div ref={ref}>
      {src ? <img src={src} alt="Image attached to the message" /> : <div className="img-ph">{err ? 'image unavailable' : 'loading image…'}</div>}
    </div>
  );
}

export function AssistantMessage({ event: e, sessionId, onRaw, query, forceOpen }: EventCardProps) {
  const { text, truncated, load } = useFullText(e, sessionId);
  const u = e.usage;
  return (
    <Card
      type="assistant"
      role="Claude"
      open={forceOpen ?? undefined}
      right={
        <>
          {e.model && <span title={e.model}>{modelLabel(e.model)}</span>}
          {u && u.output != null && <span title={`Tokens for this API message — in ${formatNumber(u.input)} · cache read ${formatNumber(u.cacheRead)} · cache write ${formatNumber(u.cacheCreate)} · out ${formatNumber(u.output)}${u.thinking ? ` (thinking ${formatNumber(u.thinking)})` : ''}`}>{formatNumber(u.output)} out</span>}
          {e.stopReason && e.stopReason !== 'tool_use' && e.stopReason !== 'end_turn' && <span className="chip warn">{e.stopReason}</span>}
        </>
      }
      copyText={text}
      onRaw={() => onRaw(e)}
      summary={firstLine(text) || (e.empty ? '(empty response)' : '')}
    >
      <div className="msg-text md">
        {query ? <div style={{ whiteSpace: 'pre-wrap' }}>{markMatches(text, query.toLowerCase())}</div> : <Markdown text={text} />}
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
      open={forceOpen ?? undefined}
      right={<span>{e.redacted ? 'redacted' : `${formatNumber(chars)} chars`}</span>}
      copyText={text}
      onRaw={() => onRaw(e)}
      summary={e.redacted ? 'Reasoning is present in the log but its text was not recorded (signature only).' : firstLine(text)}
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

export function ErrorCard({ event: e, onRaw, forceOpen }: EventCardProps) {
  return (
    <Card
      type="error"
      role="Error"
      title={e.subtype}
      open={forceOpen ?? undefined}
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
    <Card type="system" role={label} defaultOpen={e.subtype !== 'local_command'} open={forceOpen ?? undefined} copyText={e.content} onRaw={() => onRaw(e)} summary={firstLine(e.content || '')} right={e.durationMs != null ? <span>{e.durationMs}ms</span> : undefined}>
      {isXml ? <CodeBlock code={e.content || ''} lang="text" compact initialLines={20} /> : <div className="msg-text">{e.content}</div>}
    </Card>
  );
}

export function UnknownCard({ event: e, onRaw, forceOpen }: EventCardProps) {
  return (
    <Card type="unknown" role="Unknown" desc={e.label || e.kind} defaultOpen={false} open={forceOpen ?? undefined} onRaw={() => onRaw(e)} summary="Unrecognized record type — open the raw event to inspect it.">
      <div className="msg-text help-text">This record type is not understood by this version of the viewer. Use "view raw" to inspect the original JSON.</div>
    </Card>
  );
}
