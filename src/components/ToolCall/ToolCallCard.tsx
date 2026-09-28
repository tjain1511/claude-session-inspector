// A tool call with its paired result (if any), timing, status, structured details
// and — for Agent calls — the sub-agent's own timeline.
import { useState } from 'react';
import type { SessionEvent, SubagentSummary } from '@/types/session';
import { Card, type ForceOpen } from '@/components/Timeline/Card';
import { CodeBlock } from '@/components/CodeBlock/CodeBlock';
import { CopyButton } from '@/components/common/CopyButton';
import { Icon } from '@/components/common/Icon';
import { ToolInput } from './ToolInput';
import { ToolResultBody } from './ToolResult';
import { SubagentPanel } from './SubagentPanel';
import { formatCost, formatDuration, formatNumber, modelLabel } from '@/utils/format';
import { useSettings } from '@/features/settings/settings';
import { usePrimaryModel } from '@/features/sessions/primaryModel';
import { toolSummary } from '@/utils/events';
import { prettyJson } from '@/utils/highlight';
import { useToolDoc, openContext } from '@/components/Context/ToolDocs';
import { firstLine } from '@/utils/events';
import { openMemory, useMemoryByTool } from '@/utils/memory';

interface Props {
  event: SessionEvent;
  result: SessionEvent | undefined;
  sessionId: string;
  onRaw: (e: SessionEvent) => void;
  query?: string;
  forceOpen?: ForceOpen;
  outputLines: number;
  subagent?: SubagentSummary;
  live?: boolean;
}

export function ToolCallCard({ event: e, result, sessionId, onRaw, query, forceOpen, outputLines, subagent, live }: Props) {
  const [showDetails, setShowDetails] = useState(false);
  const durationMs = e.ts && result?.ts ? Date.parse(result.ts) - Date.parse(e.ts) : null;
  const status: 'success' | 'error' | 'pending' = result ? (result.isError ? 'error' : 'success') : 'pending';
  const desc = toolSummary(e.tool, e.input);
  const doc = useToolDoc(e.tool);
  const inputText = typeof e.input === 'string' ? e.input : prettyJson(e.input);
  const [settings] = useSettings();
  const agentMs = subagent?.startedAt && subagent.endedAt ? Date.parse(subagent.endedAt) - Date.parse(subagent.startedAt) : null;
  const primary = usePrimaryModel();
  const memory = useMemoryByTool().get(e.toolUseId ?? '') ?? [];
  // Compact density: successful calls start as a single row; failures and running calls stay open.
  const compact = settings.density === 'compact';
  const lead = (
    <span className={`status-glyph ${status}${status === 'pending' && live ? ' running' : ''}`} aria-label={status === 'error' ? 'failed' : status === 'success' ? 'succeeded' : live ? 'running' : 'no result'}>
      <Icon name={status === 'error' ? 'xCircle' : status === 'success' ? 'checkCircle' : 'clock'} size={12} />
    </span>
  );
  return (
    <Card
      type="tool_call"
      role=""
      lead={lead}
      eventId={e.id}
      defaultOpen={!compact || status === 'error' || (status === 'pending' && !!live)}
      title={
        doc ? (
          <span className="tool-title" title={doc.description ? firstLine(doc.description) : 'Deferred tool: definition not recorded'}>
            {e.tool}
            <button type="button" className="tool-doc" aria-label="What the model was told about this tool" onClick={(ev) => { ev.stopPropagation(); openContext('tools', e.tool); }}>
              <Icon name="info" size={11} />
            </button>
          </span>
        ) : e.tool
      }
      desc={desc}
      force={forceOpen}
      extraClass={`status-${status}`}
      right={
        <>
          {memory.map((m) => (
            <button key={m.file} type="button" className="chip memory" onClick={(ev) => { ev.stopPropagation(); openMemory(m); }} title={`Open the memory note ${m.file}`}>
              <Icon name="memory" size={10} />{m.file.replace(/\.md$/, '')}
            </button>
          ))}
          {subagent && <span className="chip agent-type" title={`Sub-agent ${subagent.agentId}`}><Icon name="agent" size={10} />{subagent.agentType || 'agent'}</span>}
          {subagent?.model && subagent.model !== primary && <span className="chip warn" title={`Ran on ${subagent.model}${primary ? ` (session: ${primary})` : ''}`}>{modelLabel(subagent.model)}</span>}
          {subagent?.counts && <span title="Sub-agent activity">{subagent.counts.toolCalls} tools{subagent.counts.errors ? <span className="status-error"> · {subagent.counts.errors} err</span> : null}</span>}
          {subagent?.estimate && subagent.usage && (
            <span className={`agent-cost-chip mono ${subagent.estimate.complete ? '' : 'status-warn'}`} title={`Estimated sub-agent cost (its tokens × the rate table in Settings → Pricing), already included in the session cost\n${formatNumber(subagent.usage.input + subagent.usage.cacheRead + subagent.usage.cacheCreate)} in · ${formatNumber(subagent.usage.output)} out${subagent.estimate.complete ? '' : '\nPartial: a model has no rate'}`}>
              ≈{formatCost(subagent.estimate.totalUSD)}
            </span>
          )}
          {agentMs != null && <span className="agent-ran" title={`The sub-agent ran from ${subagent?.startedAt} to ${subagent?.endedAt}; the call itself returned after ${formatDuration(durationMs)}`}>ran {formatDuration(agentMs)}</span>}
          {result?.interrupted && <span className="chip warn">interrupted</span>}
          {result?.denied && <span className="chip warn" title={result.denied}>denied</span>}
          {status === 'pending' && (live ? <span className="chip warn">running…</span> : <span className="chip">no result</span>)}
          {status === 'error' && <span className="chip error">error</span>}
          {durationMs != null && <span className={`dur ${durationMs >= 60_000 ? 'slow' : ''}`} title="Time from tool call to result">{formatDuration(durationMs)}</span>}
          {e.caller && e.caller !== 'direct' && <span title="Caller">{e.caller}</span>}
        </>
      }
      copyText={inputText}
      onRaw={() => onRaw(e)}
      summary={compact ? undefined : desc || '(no input)'}
    >
      <div className="tool-section">
        <div className="label">
          Input
          <span className="right">
            <CopyButton text={inputText} label="Copy input" />
          </span>
        </div>
        <ToolInput tool={e.tool || ''} input={e.input} initialLines={outputLines} query={query} />
      </div>
      {subagent && (
        <div className="tool-section">
          <div className="label">
            <Icon name="agent" size={12} /> Sub-agent
          </div>
          <SubagentPanel sessionId={sessionId} agent={subagent} onRaw={onRaw} query={query} outputLines={outputLines} />
        </div>
      )}
      {result ? (
        <div className="tool-section">
          <div className="label">
            Output
            <span className={`status status-${status}`}>{status === 'error' ? 'error' : 'ok'}</span>
            {result.images ? <span>{result.images} image(s)</span> : null}
            <span className="right">
              {result.structured !== undefined && result.structured !== null && (
                <button type="button" className="btn ghost sm" onClick={() => setShowDetails((s) => !s)} aria-pressed={showDetails} title="Structured tool result recorded by Claude Code (toolUseResult)">
                  <Icon name="info" size={12} /> details
                </button>
              )}
              <button type="button" className="btn ghost sm" onClick={() => onRaw(result)} title="View raw result record">
                <Icon name="code" size={12} />
              </button>
              <CopyButton text={result.content || ''} label="Copy output" />
            </span>
          </div>
          <ToolResultBody result={result} tool={e.tool} sessionId={sessionId} initialLines={outputLines} query={query} />
          {showDetails && (
            <div style={{ marginTop: 8 }}>
              <CodeBlock code={prettyJson(result.structured)} lang="json" title="toolUseResult" initialLines={40} />
            </div>
          )}
        </div>
      ) : (
        <div className="tool-section help-text">{live ? 'Waiting for the tool result…' : 'No result was recorded for this call (the session may have been interrupted).'}</div>
      )}
    </Card>
  );
}
