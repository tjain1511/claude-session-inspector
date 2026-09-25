// "View raw event": normalized event side by side with the original JSON line from disk.
import { useEffect, useState } from 'react';
import type { SessionEvent } from '@/types/session';
import { Modal } from '@/components/common/Modal';
import { CodeBlock } from '@/components/CodeBlock/CodeBlock';
import { CopyButton } from '@/components/common/CopyButton';
import { api } from '@/services/api';
import { prettyJson } from '@/utils/highlight';

export function RawInspector({ sessionId, event, onClose }: { sessionId: string; event: SessionEvent; onClose: () => void }) {
  const [raw, setRaw] = useState<unknown>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'raw' | 'normalized'>('raw');
  useEffect(() => {
    let cancelled = false;
    setRaw(undefined);
    setErr(null);
    api
      .readRaw(sessionId, event.ref)
      .then((r) => !cancelled && setRaw(r.raw))
      .catch((e) => !cancelled && setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [sessionId, event]);
  const rawText = raw === undefined ? '' : prettyJson(raw);
  const normText = prettyJson(event);
  return (
    <Modal
      variant="drawer"
      wide
      title="Event inspector"
      subtitle={`${event.ref.file === 'main' ? 'transcript' : event.ref.file} · line ${event.ref.line}`}
      onClose={onClose}
      actions={<CopyButton text={tab === 'raw' ? rawText : normText} label={tab === 'raw' ? 'Copy raw JSON' : 'Copy normalized JSON'} small={false} />}
    >
      <div className="radio-row" role="tablist" style={{ display: 'inline-flex', marginBottom: 12 }}>
        <button type="button" role="tab" aria-selected={tab === 'raw'} className={tab === 'raw' ? 'on' : ''} onClick={() => setTab('raw')}>Raw record</button>
        <button type="button" role="tab" aria-selected={tab === 'normalized'} className={tab === 'normalized' ? 'on' : ''} onClick={() => setTab('normalized')}>Normalized event</button>
      </div>
      <div className="kv" style={{ marginBottom: 12 }}>
        <span className="k">type</span><span className="v">{event.type}{event.subtype ? ` / ${event.subtype}` : ''}{event.kind ? ` / ${event.kind}` : ''}</span>
        {event.tool && (<><span className="k">tool</span><span className="v">{event.tool}</span></>)}
        {event.toolUseId && (<><span className="k">tool_use_id</span><span className="v mono">{event.toolUseId}</span></>)}
        {event.ts && (<><span className="k">timestamp</span><span className="v mono">{event.ts}</span></>)}
        {event.messageId && (<><span className="k">message id</span><span className="v mono">{event.messageId}</span></>)}
        {event.requestId && (<><span className="k">request id</span><span className="v mono">{event.requestId}</span></>)}
        <span className="k">record</span><span className="v mono">{event.ref.file} · line {event.ref.line} · byte {event.ref.offset} · {event.ref.length} bytes</span>
      </div>
      {tab === 'raw' ? (
        err ? <div className="error-text">{err}</div> : raw === undefined ? <div className="help-text">Loading raw record…</div> : <CodeBlock code={rawText} lang="json" title="raw JSONL record" initialLines={400} />
      ) : (
        <CodeBlock code={normText} lang="json" title="normalized event" initialLines={400} />
      )}
    </Modal>
  );
}
