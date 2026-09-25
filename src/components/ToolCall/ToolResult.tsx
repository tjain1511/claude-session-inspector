import { useState } from 'react';
import type { SessionEvent } from '@/types/session';
import { CodeBlock } from '@/components/CodeBlock/CodeBlock';
import { api } from '@/services/api';
import { LazyImage } from '@/components/common/LazyImage';
import { fullTextFromRaw } from '@/utils/events';
import { langFor, looksLikeJson, type Lang } from '@/utils/highlight';

function langForResult(tool: string | undefined, text: string, input?: unknown): Lang {
  if (tool === 'Read' && input && typeof input === 'object') return langFor((input as { file_path?: string }).file_path);
  if (looksLikeJson(text) && text.length < 200_000) {
    try {
      JSON.parse(text);
      return 'json';
    } catch {
      /* not json */
    }
  }
  return 'text';
}

export function ToolResultBody({ result, tool, sessionId, initialLines, query }: { result: SessionEvent; tool?: string; sessionId: string; initialLines: number; query?: string }) {
  const [full, setFull] = useState<string | null>(null);
  const text = full ?? result.content ?? '';
  const truncated = !!result.truncated && full == null;
  const load = async () => {
    const r = await api.readRaw(sessionId, result.ref);
    setFull(fullTextFromRaw(result, r.raw) ?? '');
  };
  const imgs = result.imageBlocks ?? [];
  const images = imgs.length > 0 && result.block != null && (
    <div className="images tool-images">
      {imgs.map((sub, i) => (
        <LazyImage key={sub} url={api.imageUrl(sessionId, result.ref, result.block!, sub)} alt={`Image ${i + 1} returned by ${tool || 'the tool'}`} caption={`${tool || 'tool'} image ${i + 1} of ${imgs.length}`} />
      ))}
    </div>
  );
  if (!text.trim()) return images || <div className="help-text">(empty output)</div>;
  return (
    <>
      <CodeBlock code={text} lang={langForResult(tool, text)} compact initialLines={initialLines} truncated={truncated} fullLength={result.fullLength} onLoadFull={() => void load()} highlightQuery={query} wrapDefault />
      {images}
    </>
  );
}

/** Standalone tool result whose call was not found in the loaded events. */
export function OrphanToolResult({ result, sessionId, onRaw, initialLines }: { result: SessionEvent; sessionId: string; onRaw: (e: SessionEvent) => void; initialLines: number }) {
  return (
    <div className={`card type-tool_call status-${result.isError ? 'error' : 'success'}`}>
      <div className="card-head" onClick={() => onRaw(result)}>
        <span className="role">Tool result</span>
        <span className="desc">for {result.toolUseId}</span>
        <span className="right">{result.isError && <span className="chip error">error</span>}</span>
      </div>
      <div className="card-body">
        <div className="tool-section">
          <ToolResultBody result={result} sessionId={sessionId} initialLines={initialLines} />
        </div>
      </div>
    </div>
  );
}
