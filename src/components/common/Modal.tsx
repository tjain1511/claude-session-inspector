import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

interface Props {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  variant?: 'modal' | 'drawer';
  wide?: boolean;
  actions?: ReactNode;
}

/** Accessible dialog: traps focus, closes on Esc/backdrop, restores focus on close. */
export function Modal({ title, subtitle, onClose, children, variant = 'modal', wide, actions }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    (el?.querySelector('input, button, [tabindex="0"]') as HTMLElement | null)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'Tab' && el) {
        const f = [...el.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input, select, textarea, [tabindex="0"]')];
        if (!f.length) return;
        const first = f[0]!;
        const last = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);
  const body = (
    <div ref={ref} className={variant === 'drawer' ? `drawer ${wide ? 'wide' : ''}` : 'modal'} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div className="drawer-head">
        <span>{title}</span>
        {subtitle && <span className="sub">{subtitle}</span>}
        <span className="close" style={{ display: 'flex', gap: 4 }}>
          {actions}
          <button type="button" className="btn icon ghost" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <Icon name="x" />
          </button>
        </span>
      </div>
      <div className="drawer-body">{children}</div>
    </div>
  );
  return (
    <div className={variant === 'drawer' ? 'drawer-backdrop' : 'modal-backdrop'} onMouseDown={onClose}>
      {body}
    </div>
  );
}
