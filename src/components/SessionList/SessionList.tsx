// Sidebar list with grouping by date, keyboard navigation (↑/↓/Enter), inline rename,
// and a per-session context menu.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionSummary } from '@/types/session';
import { dateGroup } from '@/features/search/filters';
import { SessionItem } from './SessionItem';
import { ContextMenu, type MenuItem } from './SessionMenu';
import { api } from '@/services/api';
import { useToast } from '@/hooks/useToast';

interface Props {
  sessions: SessionSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => Promise<unknown>;
  onClearName: (id: string) => Promise<unknown>;
  onShowMetadata: (id: string) => void;
  canReveal: boolean;
  loading: boolean;
  listRef: React.RefObject<HTMLDivElement | null>;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
}

export function SessionList({ sessions, selectedId, onSelect, onRename, onClearName, onShowMetadata, canReveal, loading, listRef, editingId, setEditingId }: Props) {
  const [focusIdx, setFocusIdx] = useState<number>(-1);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const toast = useToast();
  const idsRef = useRef<string[]>([]);
  idsRef.current = sessions.map((s) => s.id);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  // Keep the focus index attached to the selected session when the list changes.
  useEffect(() => {
    if (selectedId) {
      const i = idsRef.current.indexOf(selectedId);
      if (i >= 0) setFocusIdx(i);
    }
  }, [selectedId, sessions]);

  const scrollTo = useCallback(
    (id: string) => {
      const el = listRef.current?.querySelector(`[data-session-id="${id}"]`) as HTMLElement | null;
      el?.scrollIntoView({ block: 'nearest' });
    },
    [listRef],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editingId) return;
    const n = sessions.length;
    if (!n) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? Math.min(n - 1, focusIdx + 1) : Math.max(0, focusIdx - 1);
      setFocusIdx(next);
      const id = sessions[next]?.id;
      if (id) {
        scrollTo(id);
        onSelect(id);
      }
    } else if (e.key === 'Enter') {
      const id = sessions[focusIdx]?.id;
      if (id) onSelect(id);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const next = e.key === 'Home' ? 0 : n - 1;
      setFocusIdx(next);
      const id = sessions[next]?.id;
      if (id) {
        scrollTo(id);
        onSelect(id);
      }
    } else if (e.key === 'F2') {
      const id = sessions[focusIdx]?.id;
      if (id) setEditingId(id);
    }
  };

  const groups = useMemo(() => {
    const out: { label: string; items: { s: SessionSummary; idx: number }[] }[] = [];
    sessions.forEach((s, idx) => {
      const label = dateGroup(s.endedAt || s.startedAt, new Date(now));
      const g = out[out.length - 1];
      if (g && g.label === label) g.items.push({ s, idx });
      else out.push({ label, items: [{ s, idx }] });
    });
    return out;
  }, [sessions, now]);

  const menuItems = (s: SessionSummary): (MenuItem | 'sep')[] => [
    { label: 'Rename', icon: 'edit', hint: 'F2', onSelect: () => setEditingId(s.id) },
    { label: 'Reset to generated title', icon: 'reset', disabled: !s.customName, onSelect: () => void onClearName(s.id).then(() => toast('Custom name removed')) },
    'sep',
    { label: 'Copy session ID', icon: 'copy', onSelect: () => void navigator.clipboard.writeText(s.id).then(() => toast('Session ID copied')) },
    { label: 'Copy project path', icon: 'copy', onSelect: () => void navigator.clipboard.writeText(s.project.raw).then(() => toast('Path copied')) },
    { label: 'View metadata', icon: 'info', onSelect: () => onShowMetadata(s.id) },
    { label: canReveal ? 'Reveal session file' : 'Reveal not supported', icon: 'folder', disabled: !canReveal, onSelect: () => void api.reveal(s.id).catch(() => toast('Could not reveal file', 'error')) },
  ];

  if (loading && sessions.length === 0) {
    return (
      <div className="session-list" aria-busy="true">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="session-item" style={{ pointerEvents: 'none' }}>
            <div className="skeleton" style={{ width: `${55 + ((i * 17) % 35)}%`, marginBottom: 6 }} />
            <div className="skeleton" style={{ width: '70%', height: 10, marginBottom: 6 }} />
            <div className="skeleton" style={{ width: '45%', height: 10 }} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <div ref={listRef} className="session-list" role="listbox" aria-label="Sessions" tabIndex={0} onKeyDown={onKeyDown}>
        {sessions.length === 0 && <div style={{ padding: 20, color: 'var(--text-3)', fontSize: 12, textAlign: 'center' }}>No sessions match.</div>}
        {groups.map((g) => (
          <div key={g.label}>
            <div className="session-group"><span>{g.label}</span><span className="n">{g.items.length}</span></div>
            {g.items.map(({ s, idx }) => (
              <SessionItem
                key={s.id}
                session={s}
                selected={s.id === selectedId}
                focused={idx === focusIdx && idx !== -1 && s.id !== selectedId}
                editing={editingId === s.id}
                menuOpen={menu?.id === s.id}
                onSelect={() => {
                  setFocusIdx(idx);
                  onSelect(s.id);
                }}
                onMenu={(pos) => setMenu({ id: s.id, ...pos })}
                onRename={async (name) => {
                  await onRename(s.id, name);
                  setEditingId(null);
                  toast('Session renamed');
                }}
                onEditCancel={() => setEditingId(null)}
                now={now}
              />
            ))}
          </div>
        ))}
      </div>
      {menu && (() => {
        const s = sessions.find((x) => x.id === menu.id);
        return s ? <ContextMenu anchor={menu} items={menuItems(s)} onClose={() => setMenu(null)} /> : null;
      })()}
    </>
  );
}
