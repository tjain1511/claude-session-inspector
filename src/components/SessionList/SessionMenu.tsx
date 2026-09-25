import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '@/components/common/Icon';

export interface MenuItem {
  label: string;
  icon?: string;
  onSelect: () => void;
  danger?: boolean;
  hint?: string;
  disabled?: boolean;
}

export function ContextMenu({ anchor, items, onClose }: { anchor: { x: number; y: number }; items: (MenuItem | 'sep')[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(anchor);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(anchor.x, window.innerWidth - r.width - 8);
    const y = Math.min(anchor.y, window.innerHeight - r.height - 8);
    setPos({ x: Math.max(8, x), y: Math.max(8, y) });
    (el.querySelector('button:not(:disabled)') as HTMLButtonElement | null)?.focus();
  }, [anchor]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const btns = [...(ref.current?.querySelectorAll('button:not(:disabled)') || [])] as HTMLButtonElement[];
        const i = btns.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === 'ArrowDown' ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length;
        btns[next]?.focus();
        e.preventDefault();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="menu" role="menu" style={{ left: pos.x, top: pos.y }}>
      {items.map((it, i) =>
        it === 'sep' ? (
          <div key={i} className="sep" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={it.danger ? 'danger' : ''}
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.onSelect();
            }}
          >
            {it.icon && <Icon name={it.icon} size={13} />}
            {it.label}
            {it.hint && <span className="hint">{it.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}
