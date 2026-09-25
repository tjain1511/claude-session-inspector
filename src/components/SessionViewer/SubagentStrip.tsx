// Sub-agents spawned by this session, each linking to the Agent tool call that started it.
import type { SubagentSummary } from '@/types/session';
import { Icon } from '@/components/common/Icon';
import { formatDuration, modelLabel } from '@/utils/format';

export function SubagentStrip({ agents, onJump, primaryModel }: { agents: SubagentSummary[]; onJump: (toolUseId: string | null) => void; primaryModel: string | null }) {
  return (
    <div className="agent-strip" aria-label="Sub-agents">
      <span className="lbl"><Icon name="agent" size={12} /> Sub-agents</span>
      {agents.map((a) => {
        const dur = a.startedAt && a.endedAt ? Date.parse(a.endedAt) - Date.parse(a.startedAt) : null;
        return (
          <button key={a.agentId} type="button" className="agent-chip" onClick={() => onJump(a.toolUseId)} title={`${a.agentId}\n${a.prompt || ''}\nClick to jump to the tool call that spawned it`} disabled={!a.toolUseId}>
            <span className="type">{a.agentType || 'agent'}</span>
            {a.model && a.model !== primaryModel && <span className="chip warn model" title={`Ran on ${a.model}${primaryModel ? ` (session: ${primaryModel})` : ''}`}>{modelLabel(a.model)}</span>}
            <span className="desc">{a.description || a.prompt || a.agentId}</span>
            <span className="stats">{a.counts ? `${a.counts.toolCalls} tools` : ''}{a.counts?.errors ? ` · ${a.counts.errors} err` : ''}{dur != null ? ` · ${formatDuration(dur)}` : ''}</span>
          </button>
        );
      })}
    </div>
  );
}
