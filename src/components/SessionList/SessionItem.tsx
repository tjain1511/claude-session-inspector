import { memo, useState } from 'react';
import type { SessionSummary } from '@/types/session';
import { formatDuration, modelLabel, relativeTime } from '@/utils/format';
import { sessionCost } from '@/components/SessionViewer/CostTable';
import { formatCost } from '@/utils/format';
import { Icon } from '@/components/common/Icon';
import { InlineRename } from './InlineRename';

interface Props {
  session: SessionSummary;
  selected: boolean;
  focused: boolean;
  editing: boolean;
  menuOpen: boolean;
  onSelect: () => void;
  onMenu: (pos: { x: number; y: number }) => void;
  onRename: (name: string) => Promise<void>;
  onEditCancel: () => void;
  now: number;
}

/** "platform/web-app" from a full path: last two segments, parent dimmed. */
function shortProject(p: string) {
  const parts = p.replace(/\/+$/, '').split('/').filter(Boolean);
  const name = parts[parts.length - 1] || p;
  const parent = parts.length > 1 ? parts[parts.length - 2] : '';
  return { name, parent };
}

export const SessionItem = memo(function SessionItem({ session: s, selected, focused, editing, menuOpen, onSelect, onMenu, onRename, onEditCancel, now }: Props) {
  const [hover, setHover] = useState(false);
  const c = s.counts;
  const proj = shortProject(s.project.raw);
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      data-session-id={s.id}
      className={`session-item ${selected ? 'selected' : ''} ${focused ? 'focused' : ''} ${menuOpen ? 'menu-open' : ''}`}
      onClick={onSelect}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu({ x: e.clientX, y: e.clientY });
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {editing ? (
        <InlineRename initial={s.customName || s.title} onSave={onRename} onCancel={onEditCancel} />
      ) : (
        <div className="title-row">
          {s.live && <span className="live-dot" title={`Running (pid ${s.live.pid}${s.live.status ? ', ' + s.live.status : ''})`} />}
          <span className="title" title={s.customName ? `${s.customName}\nGenerated: ${s.generatedTitle || '—'}` : s.title}>
            {s.customName && <span className="custom-mark" aria-label="Custom name">✎</span>}
            {s.title}
          </span>
          <span className="when" title={s.endedAt || undefined}>{relativeTime(s.endedAt, now)}</span>
        </div>
      )}
      <div className="path" title={s.project.raw}>
        <Icon name="folder" size={11} />
        {proj.parent && <span className="parent">{proj.parent}/</span>}
        <span className="name">{proj.name}</span>
        {s.gitBranch && s.gitBranch !== 'HEAD' && <span className="branch" title="git branch">{s.gitBranch}</span>}
      </div>
      <div className="meta">
        {s.model && <span className="model" title={s.model}>{modelLabel(s.model)}</span>}
        <span>{c.messages} msg</span>
        <span>{c.toolCalls} tools</span>
        {s.durationMs != null && s.durationMs > 0 && <span>{formatDuration(s.durationMs, { compact: true })}</span>}
        {(() => { const k = sessionCost(s); return k && k.usd >= 0.005 ? <span className="cost" title={k.estimated ? 'Estimated cost (no cost record yet)' : 'Cost recorded by Claude Code'}>{k.estimated ? '≈' : ''}{formatCost(k.usd)}</span> : null; })()}
        {c.errors > 0 && <span className="err" title={`${c.toolErrors} tool errors, ${c.apiErrors} API errors`}>{c.errors} err</span>}
        {s.subagents.length > 0 && <span className="agents" title={`${s.subagents.length} sub-agents`}><Icon name="agent" size={11} />{s.subagents.length}</span>}
      </div>
      {!editing && (hover || menuOpen || focused) && (
        <button
          type="button"
          className="btn icon sm ghost menu-btn"
          aria-label="Session actions"
          aria-haspopup="menu"
          onClick={(e) => {
            e.stopPropagation();
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            onMenu({ x: r.left, y: r.bottom + 2 });
          }}
        >
          <Icon name="more" size={13} />
        </button>
      )}
    </div>
  );
});
