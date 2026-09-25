import { memo, useState } from 'react';
import type { SessionSummary } from '@/types/session';
import { formatDuration, modelLabel, relativeTime } from '@/utils/format';
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

export const SessionItem = memo(function SessionItem({ session: s, selected, focused, editing, menuOpen, onSelect, onMenu, onRename, onEditCancel, now }: Props) {
  const [hover, setHover] = useState(false);
  const c = s.counts;
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
        </div>
      )}
      <div className="path" title={s.project.raw}>{s.project.path}</div>
      <div className="meta">
        {s.model && <span title={s.model}>{modelLabel(s.model)}</span>}
        {s.model && <span className="sep">·</span>}
        <span>{c.messages} msg</span>
        <span className="sep">·</span>
        <span>{c.toolCalls} tools</span>
        {c.errors > 0 && (
          <>
            <span className="sep">·</span>
            <span className="err" title={`${c.toolErrors} tool errors, ${c.apiErrors} API errors`}>{c.errors} err</span>
          </>
        )}
        {s.durationMs != null && s.durationMs > 0 && (
          <>
            <span className="sep">·</span>
            <span>{formatDuration(s.durationMs, { compact: true })}</span>
          </>
        )}
        <span className="sep">·</span>
        <span title={s.endedAt || undefined}>{relativeTime(s.endedAt, now)}</span>
        {s.subagents.length > 0 && (
          <>
            <span className="sep">·</span>
            <span title={`${s.subagents.length} sub-agents`}><Icon name="agent" size={11} /></span>
          </>
        )}
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
