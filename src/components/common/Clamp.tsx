// Caps tall content at a fixed height with a fade and a "show more" toggle, so one
// enormous prompt or report does not push the rest of the flow off-screen.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

export function Clamp({ children, maxHeight = 320, label = 'message', force }: { children: ReactNode; maxHeight?: number; label?: string; force?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOverflows(el.scrollHeight > maxHeight + 48);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxHeight]);
  const clamped = overflows && !open && !force;
  return (
    <div className={`clamp ${clamped ? 'clamped' : ''}`}>
      <div ref={ref} className="clamp-inner" style={clamped ? { maxHeight } : undefined}>
        {children}
      </div>
      {overflows && !force && (
        <button type="button" className="clamp-toggle" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} aria-expanded={open}>
          <Icon name={open ? 'chevronUp' : 'chevronDown'} size={11} /> {open ? `Collapse ${label}` : `Show full ${label}`}
        </button>
      )}
    </div>
  );
}
