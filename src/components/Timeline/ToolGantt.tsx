// Gantt view: one row per model call and per tool call, grouped by user turn, on a
// per-turn time axis. A model row spans from the moment Claude had everything it needed
// (the prompt, or the last tool result) to its last streamed block. Tool bars overlap
// when they ran concurrently; calls issued in the same assistant message are marked as
// a batch. Agent calls extend to the end of their sub-agent transcript.
import { useMemo } from 'react';
import type { SessionEvent, SubagentSummary } from '@/types/session';
import { eventTs, toolSummary, firstLine } from '@/utils/events';
import { formatDuration, formatNumber, modelLabel } from '@/utils/format';
import { Icon } from '@/components/common/Icon';

interface Row {
  kind: 'tool' | 'model';
  e: SessionEvent;
  start: number;
  end: number | null; // null = no result recorded
  firstBlock?: number; // model rows: when the first block was written
  status: 'success' | 'error' | 'pending';
  batch: number; // index of the assistant message batch within the turn (tool rows)
  batchSize: number;
  agent?: SubagentSummary;
  overlaps: number; // how many other tool rows in the turn overlap this one in time
  label: string;
  desc: string;
  tokensOut?: number | null;
  blocks?: number;
  tools?: number;
}

interface Turn {
  idx: number;
  prompt: string;
  promptId: string;
  start: number;
  end: number;
  rows: Row[];
  modelMs: number;
  toolMs: number;
  batches: number;
  maxParallel: number;
  modelCalls: number;
  toolCalls: number;
}

export function buildTurns(events: SessionEvent[], subagents: SubagentSummary[]): Turn[] {
  const results = new Map<string, SessionEvent>();
  for (const e of events) if (e.type === 'tool_result' && e.toolUseId) results.set(e.toolUseId, e);
  const subByTool = new Map(subagents.filter((s) => s.toolUseId).map((s) => [s.toolUseId as string, s]));
  const turns: Turn[] = [];
  let cur: Turn | null = null;
  let lastTs: number | null = null;
  let trigger: number | null = null; // when the model could start its next call
  let modelRow: Row | null = null; // model row for the message currently streaming
  const finish = () => {
    if (!cur) return;
    const tools = cur.rows.filter((r) => r.kind === 'tool');
    for (const r of tools) {
      r.overlaps = tools.filter((o) => o !== r && o.start < (r.end ?? r.start + 1) && (o.end ?? o.start + 1) > r.start).length;
    }
    cur.maxParallel = tools.reduce((m, r) => Math.max(m, r.overlaps + 1), tools.length ? 1 : 0);
    const sizes = new Map<number, number>();
    for (const r of tools) sizes.set(r.batch, (sizes.get(r.batch) || 0) + 1);
    for (const r of tools) r.batchSize = sizes.get(r.batch) || 1;
    cur.batches = sizes.size;
    cur.toolCalls = tools.length;
    cur.modelCalls = cur.rows.length - tools.length;
    turns.push(cur);
    cur = null;
    modelRow = null;
  };
  for (const e of events) {
    const t = eventTs(e);
    if (e.type === 'user' && e.kind === 'human') {
      finish();
      cur = { idx: turns.length + 1, prompt: firstLine(e.content || ''), promptId: e.id, start: t ?? 0, end: t ?? 0, rows: [], modelMs: 0, toolMs: 0, batches: 0, maxParallel: 0, modelCalls: 0, toolCalls: 0 };
      lastTs = t;
      trigger = t;
      continue;
    }
    if (!cur || t == null) continue;
    if (t > cur.end) cur.end = t;
    if (lastTs != null && t > lastTs) {
      if (e.type === 'assistant' || e.type === 'thinking' || e.type === 'tool_call' || e.type === 'error') cur.modelMs += t - lastTs;
      else if (e.type === 'tool_result') cur.toolMs += t - lastTs;
    }
    lastTs = t;

    if (e.type === 'assistant' || e.type === 'thinking' || e.type === 'tool_call' || (e.type === 'error' && e.subtype === 'api')) {
      const mid = e.messageId || e.id;
      if (!modelRow || modelRow.e.messageId !== mid || (!e.messageId && modelRow.e.id !== e.id)) {
        modelRow = {
          kind: 'model',
          e,
          start: trigger ?? t,
          end: t,
          firstBlock: t,
          status: e.type === 'error' ? 'error' : 'success',
          batch: -1,
          batchSize: 1,
          overlaps: 0,
          label: e.model ? modelLabel(e.model) : 'Claude',
          desc: '',
          tokensOut: e.usage?.output ?? null,
          blocks: 0,
          tools: 0,
        };
        cur.rows.push(modelRow);
      }
      modelRow.end = Math.max(modelRow.end ?? t, t);
      modelRow.blocks = (modelRow.blocks ?? 0) + 1;
      if (e.type === 'tool_call') modelRow.tools = (modelRow.tools ?? 0) + 1;
      if (!modelRow.desc && e.type === 'assistant' && e.content) modelRow.desc = firstLine(e.content);
      if (e.type === 'error') modelRow.desc = modelRow.desc || firstLine(e.content || 'API error');
    }
    if (e.type === 'tool_call' && e.toolUseId) {
      const lastTool = [...cur.rows].reverse().find((r) => r.kind === 'tool');
      const batch = lastTool && lastTool.e.messageId === e.messageId ? lastTool.batch : (lastTool?.batch ?? -1) + 1;
      const res = results.get(e.toolUseId);
      const agent = subByTool.get(e.toolUseId);
      let end = res ? eventTs(res) : null;
      if (agent?.endedAt) {
        const ae = Date.parse(agent.endedAt);
        if (Number.isFinite(ae) && (end == null || ae > end)) end = ae;
      }
      if (end != null && end > cur.end) cur.end = end;
      cur.rows.push({
        kind: 'tool',
        e,
        start: t,
        end,
        status: res ? (res.isError ? 'error' : 'success') : 'pending',
        batch,
        batchSize: 1,
        agent,
        overlaps: 0,
        label: e.tool || 'tool',
        desc: agent ? `${agent.agentType || 'agent'}: ${agent.description || ''}` : toolSummary(e.tool, e.input),
      });
    }
    if (e.type === 'tool_result') trigger = t; // the model's next call can start once the (last) result is in
  }
  finish();
  for (const turn of turns) {
    for (const r of turn.rows) {
      if (r.kind === 'model' && !r.desc) r.desc = r.tools ? `${r.tools} tool call${r.tools === 1 ? '' : 's'}` : r.blocks ? 'thinking' : '';
    }
  }
  return turns;
}

const BATCH_COLORS = ['var(--tool)', 'var(--thinking)', '#2ec4b6', '#e5b567', '#f78c6c', '#7dcfff'];

export function ToolGantt({ events, subagents, onJump }: { events: SessionEvent[]; subagents: SubagentSummary[]; onJump: (id: string) => void }) {
  const turns = useMemo(() => buildTurns(events, subagents), [events, subagents]);
  if (!turns.length) return <div className="help-text" style={{ padding: 20 }}>No user turns with timestamps in this session.</div>;
  return (
    <div className="gantt">
      <div className="gantt-legend">
        <span><i style={{ background: 'var(--accent)' }} /> model call (inputs ready → last block streamed)</span>
        <span><i style={{ background: 'var(--tool)' }} /> tool call (call → result)</span>
        <span><i style={{ background: 'var(--thinking)' }} /> sub-agent (call → agent finished)</span>
        <span><i style={{ background: 'var(--error)' }} /> error</span>
        <span><i style={{ background: 'transparent', border: '1px dashed var(--text-3)' }} /> no result</span>
        <span className="help-text">Rows sharing a ∥ marker were requested in the same model call (parallel batch). Overlapping bars ran concurrently. The tick inside a model bar marks its first streamed block.</span>
      </div>
      {turns.map((turn) => {
        const span = Math.max(1, turn.end - turn.start);
        return (
          <section className="gantt-turn" key={turn.promptId}>
            <header className="gantt-turn-head" onClick={() => onJump(turn.promptId)} title="Jump to this prompt in the flow view">
              <span className="turn-no">Turn {turn.idx}</span>
              <span className="turn-prompt">{turn.prompt || '(prompt)'}</span>
              <span className="turn-stats">
                {turn.modelCalls} model · {turn.toolCalls} tools{turn.toolCalls ? ` · ${turn.batches} batch${turn.batches === 1 ? '' : 'es'} · max ${turn.maxParallel} concurrent` : ''}
                <span className="sep">·</span>model {formatDuration(turn.modelMs)}
                <span className="sep">·</span>tools {formatDuration(turn.toolMs)}
                <span className="sep">·</span>{formatDuration(span)}
              </span>
            </header>
            {turn.rows.length > 0 && (
              <div className="gantt-grid">
                <div className="gantt-axis">
                  <span />
                  <div className="ticks">
                    {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                      <span key={f} style={{ left: `${f * 100}%` }}>{formatDuration(span * f)}</span>
                    ))}
                  </div>
                </div>
                {turn.rows.map((r) => {
                  const left = ((r.start - turn.start) / span) * 100;
                  const width = r.end != null ? Math.max(0.3, ((r.end - r.start) / span) * 100) : 0.6;
                  const dur = r.end != null ? r.end - r.start : null;
                  const color = r.status === 'error' ? 'var(--error)' : r.kind === 'model' ? 'var(--accent)' : r.agent ? 'var(--thinking)' : 'var(--tool)';
                  const ttfb = r.kind === 'model' && r.firstBlock != null ? r.firstBlock - r.start : null;
                  const tip =
                    r.kind === 'model'
                      ? `${r.label} · ${r.desc}\n${dur != null ? formatDuration(dur) : ''}${ttfb != null ? ` · first block after ${formatDuration(ttfb)}` : ''}${r.tokensOut != null ? ` · ${formatNumber(r.tokensOut)} tokens out` : ''}\n${r.blocks} block(s), ${r.tools} tool call(s)`
                      : `${r.e.tool} · ${toolSummary(r.e.tool, r.e.input)}\n${dur != null ? formatDuration(dur) : 'no result'}${r.batchSize > 1 ? `\nrequested together with ${r.batchSize - 1} other call(s)` : ''}${r.overlaps ? `\noverlaps ${r.overlaps} other call(s)` : ''}`;
                  return (
                    <div className={`gantt-row kind-${r.kind} ${r.batchSize > 1 ? 'in-batch' : ''}`} key={r.e.id} onClick={() => onJump(r.e.id)} title={tip}>
                      <div className="gantt-label">
                        {r.batchSize > 1 && <span className="batch" style={{ color: BATCH_COLORS[r.batch % BATCH_COLORS.length] }}>∥</span>}
                        {r.kind === 'model' && <span className="model-dot" aria-hidden="true" />}
                        {r.agent && <Icon name="agent" size={11} />}
                        <span className="name">{r.label}</span>
                        <span className="desc">{r.desc}</span>
                      </div>
                      <div className="gantt-track">
                        <div className={`gantt-bar ${r.status}`} style={{ left: `${left}%`, width: `${width}%`, background: r.status === 'pending' ? 'transparent' : color, borderColor: color }}>
                          {ttfb != null && dur ? <span className="ttfb" style={{ left: `${Math.min(100, (ttfb / dur) * 100)}%` }} /> : null}
                          <span className="dur">{dur != null ? formatDuration(dur) : 'no result'}{r.kind === 'model' && r.tokensOut ? ` · ${formatNumber(r.tokensOut)} out` : ''}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
