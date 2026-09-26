// Small anchored panel (view options, menus). Closes on outside click and Escape.
import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  button: (p: { open: boolean; toggle: () => void }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: 'left' | 'right';
  className?: string;
}

export function Popover({ button, children, align = 'right', className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div className={`popover-wrap ${className}`} ref={ref}>
      {button({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div className={`popover ${align}`} role="dialog">
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
}

/** A labelled switch row for option popovers. */
export function OptionRow({ label, hint, checked, onChange, kbd }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; kbd?: string }) {
  return (
    <label className="opt-row">
      <span className="opt-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      {kbd && <kbd>{kbd}</kbd>}
      <span className="toggle"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /></span>
    </label>
  );
}
