// Session-level metadata: ids, paths, versions, usage, cost, sub-agents, file details.
import type { SessionSummary } from '@/types/session';
import { Modal } from '@/components/common/Modal';
import { CopyButton } from '@/components/common/CopyButton';
import { formatBytes, formatCost, formatDateTime, formatDuration, formatNumber, modelLabel } from '@/utils/format';
import { prettyJson } from '@/utils/highlight';
import { CodeBlock } from '@/components/CodeBlock/CodeBlock';
import { CostTable, sessionCost } from '@/components/SessionViewer/CostTable';

function Row({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  if (v === null || v === undefined || v === '') return null;
  return (
    <>
      <span className="k">{k}</span>
      <span className={`v ${mono ? 'mono' : ''}`}>{v}</span>
    </>
  );
}

export function MetadataDrawer({ session: s, onClose, onOpenSession }: { session: SessionSummary; onClose: () => void; onOpenSession: (id: string) => void }) {
  const c = s.counts;
  return (
    <Modal variant="drawer" title="Session details" subtitle={s.id} onClose={onClose} actions={<CopyButton text={prettyJson(s)} label="Copy JSON" small={false} />}>
      <h4>Identity</h4>
      <div className="kv">
        <Row k="session id" v={s.id} mono />
        <Row k="name" v={<>{s.title} <span className="help-text">({s.customName ? 'custom name' : s.titleSource === 'claude-custom' ? 'named in Claude Code' : s.titleSource === 'ai' ? 'AI-generated title' : s.titleSource === 'first-prompt' ? 'from first prompt' : 'no title'})</span></>} />
        {s.customName && <Row k="generated title" v={s.generatedTitle || '—'} />}
        <Row k="slug" v={s.slug} mono />
        <Row k="first prompt" v={s.firstPrompt} />
        <Row k="last prompt" v={s.lastPrompt} />
      </div>
      <h4>Environment</h4>
      <div className="kv">
        <Row k="working directory" v={s.project.raw} mono />
        <Row k="project folder" v={s.project.dirName} mono />
        <Row k="git branch" v={s.gitBranch} mono />
        <Row k="claude code" v={s.version ? `v${s.version}` : null} mono />
        <Row k="entrypoint" v={s.entrypoint} mono />
        <Row k="permission modes" v={s.permissionModes.join(', ')} mono />
        <Row k="models" v={s.models.map((m) => `${modelLabel(m.name)} (${m.count})`).join(', ')} />
      </div>
      <h4>Timing</h4>
      <div className="kv">
        <Row k="started" v={s.startedAt ? `${formatDateTime(s.startedAt)}` : null} />
        <Row k="last event" v={s.endedAt ? `${formatDateTime(s.endedAt)}` : null} />
        <Row k="span" v={formatDuration(s.durationMs)} />
        {s.cost && <Row k="active time" v={formatDuration(s.cost.totalDuration)} />}
        {s.cost && <Row k="API time" v={formatDuration(s.cost.totalAPIDuration)} />}
        {s.cost && <Row k="tool time" v={formatDuration(s.cost.totalToolDuration)} />}
        <Row k="status" v={s.live ? `running (pid ${s.live.pid}${s.live.status ? ', ' + s.live.status : ''})` : s.recentlyActive ? 'recently active' : 'idle'} />
      </div>
      <h4>Activity</h4>
      <div className="kv">
        <Row k="user messages" v={c.userMessages} />
        <Row k="claude messages" v={c.assistantMessages} />
        <Row k="tool calls" v={c.toolCalls} />
        <Row k="tool errors" v={c.toolErrors} />
        <Row k="api errors" v={c.apiErrors} />
        <Row k="interruptions" v={c.interruptions} />
        <Row k="thinking blocks" v={c.thinkingBlocks} />
        <Row k="attachments" v={c.attachments} />
        <Row k="records" v={c.records} />
        <Row k="tools used" v={s.tools.map((t) => `${t.name} ×${t.count}`).join(', ')} />
      </div>
      <h4>Tokens (sum over API messages)</h4>
      <div className="kv">
        <Row k="input" v={formatNumber(s.usage.input)} />
        <Row k="output" v={formatNumber(s.usage.output)} />
        <Row k="thinking" v={s.usage.thinking ? formatNumber(s.usage.thinking) : null} />
        <Row k="cache read" v={formatNumber(s.usage.cacheRead)} />
        <Row k="cache write" v={formatNumber(s.usage.cacheCreate)} />
        {s.cost && <Row k="cost (from log)" v={formatCost(s.cost.totalCostUSD)} />}
        {s.estimate?.byModel.length ? <Row k="cost (estimated)" v={<>≈ {formatCost(s.estimate.totalUSD)}{!s.estimate.complete ? <span className="chip warn" style={{ marginLeft: 6 }}>partial</span> : null}{s.cost?.totalCostUSD ? <span className="help-text"> vs recorded {formatCost(s.cost.totalCostUSD)}</span> : null}</>} /> : null}
        {s.cost && (s.cost.totalLinesAdded || s.cost.totalLinesRemoved) ? <Row k="lines changed" v={`+${s.cost.totalLinesAdded} / -${s.cost.totalLinesRemoved}`} /> : null}
      </div>
      <h4>{sessionCost(s)?.estimated ? 'Per-model usage and estimated cost (usage × rates from Settings → Pricing)' : "Per-model usage and cost (from Claude Code's cost-state)"}</h4>
      <CostTable session={s} />
      {s.cost?.modelUsage && s.estimate?.byModel.length ? (
        <details className="ctx-details" style={{ marginTop: 6 }}>
          <summary>Estimate from this app's rate table, for comparison</summary>
          <div style={{ padding: '0 0 8px' }}><CostTable session={s} mode="estimated" /></div>
        </details>
      ) : null}
      {s.cost?.modelUsage && (
        <details className="ctx-details" style={{ marginTop: 6 }}>
          <summary>Raw modelUsage</summary>
          <CodeBlock code={prettyJson(s.cost.modelUsage)} lang="json" compact initialLines={60} />
        </details>
      )}
      {(s.subagents.length > 0 || s.inFileAgentIds.length > 0) && (
        <>
          <h4>Sub-agents</h4>
          <div className="kv">
            {s.subagents.map((a) => (
              <Row key={a.agentId} k={a.agentType || 'agent'} v={<>{a.description || a.agentId} {a.model && a.model !== s.model && <span className="chip warn">{modelLabel(a.model)}</span>} <span className="help-text mono">{a.agentId}{a.model ? ` · ${a.model}` : ''}{a.counts ? ` · ${a.counts.toolCalls} tools` : ''} · {formatBytes(a.sizeBytes)}</span></>} />
            ))}
            {s.inFileAgentIds.length > 0 && <Row k="in-transcript agents" v={s.inFileAgentIds.join(', ')} mono />}
          </div>
        </>
      )}
      {(s.continuedIn || s.prLinks.length > 0) && (
        <>
          <h4>Links</h4>
          <div className="kv">
            {s.continuedIn && <Row k="continued in" v={<button type="button" className="btn sm" onClick={() => onOpenSession(s.continuedIn!)}>{s.continuedIn}</button>} />}
            {s.prLinks.map((p) => (
              <Row key={p.url} k={`PR #${p.number}`} v={<>{p.repository} <span className="help-text">{p.url}</span></>} />
            ))}
          </div>
        </>
      )}
      <h4>File</h4>
      <div className="kv">
        <Row k="path" v={s.file.path} mono />
        <Row k="size" v={formatBytes(s.file.sizeBytes)} />
        <Row k="modified" v={formatDateTime(s.file.mtime)} />
        <Row k="partial write" v={s.file.partialWrite ? 'yes — last line incomplete' : 'no'} />
        <Row k="parse errors" v={s.parseErrors ? `${s.parseErrors} line(s) skipped` : 'none'} />
        <Row k="load error" v={s.loadError} />
        <Row k="images" v={s.hasImages ? 'yes' : null} />
      </div>
    </Modal>
  );
}
