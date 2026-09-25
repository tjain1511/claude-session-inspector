// Gantt view: one row per tool call, grouped by user turn, on a per-turn time axis.
// Bars that overlap ran concurrently; calls issued in the same assistant message are
// marked as a batch (Claude requested them in parallel). Agent calls extend to the
// end of their sub-agent transcript.
import { useMemo } from 'react';
import type { SessionEvent, SubagentSummary } from '@/types/session';
import { eventTs, toolSummary, firstLine } from '@/utils/events';
import { formatDuration } from '@/utils/format';
import { Icon } from '@/components/common/Icon';

interface Row {
  e: SessionEvent;
  start: number;
  end: number | null; // null = no result recorded
  status: 'success' | 'error' | 'pending';
  batch: number; // index of the assistant message batch within the turn
  batchSize: number;
  agent?: SubagentSummary;
  overlaps: number; // how many other rows in the turn overlap this one in time
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
}

export function buildTurns(events: SessionEvent[], subagents: SubagentSummary[]): Turn[] {
  const results = new Map<string, SessionEvent>();
  for (const e of events) if (e.type === 'tool_result' && e.toolUseId) results.set(e.toolUseId, e);
  const subByTool = new Map(subagents.filter((s) => s.toolUseId).map((s) => [s.toolUseId as string, s]));
  const turns: Turn[] = [];
  let cur: Turn | null = null;
  let lastTs: number | null = null;
  let lastMsgId: string | null = null;
  const finish = () => {
    if (!cur) return;
    // overlaps + max parallel
    for (const r of cur.rows) {
      r.overlaps = cur.rows.filter((o) => o !== r && o.start < (r.end ?? r.start + 1) && (o.end ?? o.start + 1) > r.start).length;
    }
    cur.maxParallel = cur.rows.reduce((m, r) => Math.max(m, r.overlaps + 1), cur.rows.length ? 1 : 0);
    const sizes = new Map<number, number>();
    for (const r of cur.rows) sizes.set(r.batch, (sizes.get(r.batch) || 0) + 1);
    for (const r of cur.rows) r.batchSize = sizes.get(r.batch) || 1;
    cur.batches = sizes.size;
    turns.push(cur);
    cur = null;
  };
  for (const e of events) {
    const t = eventTs(e);
    if (e.type === 'user' && e.kind === 'human') {
      finish();
      cur = { idx: turns.length + 1, prompt: firstLine(e.content || ''), promptId: e.id, start: t ?? 0, end: t ?? 0, rows: [], modelMs: 0, toolMs: 0, batches: 0, maxParallel: 0 };
      lastTs = t;
      lastMsgId = null;
      continue;
    }
    if (!cur || t == null) continue;
    if (t > cur.end) cur.end = t;
    if (lastTs != null && t > lastTs) {
      if (e.type === 'assistant' || e.type === 'thinking' || e.type === 'tool_call') cur.modelMs += t - lastTs;
      else if (e.type === 'tool_result') cur.toolMs += t - lastTs;
    }
    lastTs = t;
    if (e.type === 'tool_call' && e.toolUseId) {
      if (e.messageId !== lastMsgId) lastMsgId = e.messageId ?? null;
      const batch = cur.rows.length && cur.rows[cur.rows.length - 1]!.e.messageId === e.messageId ? cur.rows[cur.rows.length - 1]!.batch : (cur.rows[cur.rows.length - 1]?.batch ?? -1) + 1;
      const res = results.get(e.toolUseId);
      const agent = subByTool.get(e.toolUseId);
      let end = res ? eventTs(res) : null;
      if (agent?.endedAt) {
        const ae = Date.parse(agent.endedAt);
        if (Number.isFinite(ae) && (end == null || ae > end)) end = ae;
      }
      if (end != null && end > cur.end) cur.end = end;
      cur.rows.push({ e, start: t, end, status: res ? (res.isError ? 'error' : 'success') : 'pending', batch, batchSize: 1, agent, overlaps: 0 });
    }
  }
  finish();
  return turns;
}

const BATCH_COLORS = ['var(--tool)', 'var(--thinking)', '#2ec4b6', '#e5b567', '#f78c6c', '#7dcfff'];

export function ToolGantt({ events, subagents, onJump }: { events: SessionEvent[]; subagents: SubagentSummary[]; onJump: (id: string) => void }) {
  const turns = useMemo(() => buildTurns(events, subagents), [events, subagents]);
  if (!turns.length) return <div className="help-text" style={{ padding: 20 }}>No user turns with timestamps in this session.</div>;
  return (
    <div className="gantt">
      <div className="gantt-legend">
        <span><i style={{ background: 'var(--tool)' }} /> tool call (call → result)</span>
        <span><i style={{ background: 'var(--thinking)' }} /> sub-agent (call → agent finished)</span>
        <span><i style={{ background: 'var(--error)' }} /> error</span>
        <span><i style={{ background: 'transparent', border: '1px dashed var(--text-3)' }} /> no result</span>
        <span className="help-text">Rows sharing a ∥ marker were requested in the same Claude message (parallel batch). Overlapping bars ran concurrently.</span>
      </div>
      {turns.map((turn) => {
        const span = Math.max(1, turn.end - turn.start);
        return (
          <section className="gantt-turn" key={turn.promptId}>
            <header className="gantt-turn-head" onClick={() => onJump(turn.promptId)} title="Jump to this prompt in the flow view">
              <span className="turn-no">Turn {turn.idx}</span>
              <span className="turn-prompt">{turn.prompt || '(prompt)'}</span>
              <span className="turn-stats">
                {turn.rows.length ? `${turn.rows.length} tools · ${turn.batches} batch${turn.batches === 1 ? '' : 'es'} · max ${turn.maxParallel} concurrent` : 'no tools'}
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
                  const color = r.status === 'error' ? 'var(--error)' : r.agent ? 'var(--thinking)' : 'var(--tool)';
                  return (
                    <div className={`gantt-row ${r.batchSize > 1 ? 'in-batch' : ''}`} key={r.e.id} onClick={() => onJump(r.e.id)} title={`${r.e.tool} · ${toolSummary(r.e.tool, r.e.input)}\n${dur != null ? formatDuration(dur) : 'no result'}${r.batchSize > 1 ? `\nrequested together with ${r.batchSize - 1} other call(s)` : ''}${r.overlaps ? `\noverlaps ${r.overlaps} other call(s)` : ''}`}>
                      <div className="gantt-label">
                        {r.batchSize > 1 && <span className="batch" style={{ color: BATCH_COLORS[r.batch % BATCH_COLORS.length] }}>∥</span>}
                        {r.agent && <Icon name="agent" size={11} />}
                        <span className="name">{r.e.tool}</span>
                        <span className="desc">{r.agent ? `${r.agent.agentType || 'agent'}: ${r.agent.description || ''}` : toolSummary(r.e.tool, r.e.input)}</span>
                      </div>
                      <div className="gantt-track">
                        <div className={`gantt-bar ${r.status}`} style={{ left: `${left}%`, width: `${width}%`, background: r.status === 'pending' ? 'transparent' : color, borderColor: color }}>
                          <span className="dur">{dur != null ? formatDuration(dur) : 'no result'}</span>
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
