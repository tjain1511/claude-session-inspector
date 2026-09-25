// Generic collapsible card used by every timeline event type.
import { useRef, useState, type ReactNode } from 'react';

/** Broadcast from the toolbar: every card adopts `open` once per new `v`, then toggles freely again. */
export type ForceOpen = { open: boolean; v: number } | null;
import { Icon } from '@/components/common/Icon';
import { CopyButton } from '@/components/common/CopyButton';

export interface CardProps {
  type: string;
  role: string;
  title?: ReactNode;
  desc?: string;
  right?: ReactNode;
  open?: boolean; // controlled
  force?: ForceOpen;
  defaultOpen?: boolean;
  onToggle?: (open: boolean) => void;
  copyText?: string;
  onRaw?: () => void;
  extraClass?: string;
  children?: ReactNode;
  summary?: ReactNode; // shown when collapsed
}

export function Card({ type, role, title, desc, right, open, force, defaultOpen = true, onToggle, copyText, onRaw, extraClass = '', children, summary }: CardProps) {
  const [local, setLocal] = useState(defaultOpen);
  const seen = useRef<number | null>(null);
  if (force && force.v !== seen.current) {
    seen.current = force.v;
    if (local !== force.open) setLocal(force.open);
  }
  const isOpen = open ?? local;
  const toggle = () => {
    const next = !isOpen;
    if (open === undefined) setLocal(next);
    onToggle?.(next);
  };
  return (
    <div className={`card type-${type} ${isOpen ? 'open' : ''} ${extraClass}`}>
      <div
        className="card-head"
        onClick={toggle}
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        }}
      >
        <Icon name="chevron" size={11} className="chev" />
        {role && <span className="role">{role}</span>}
        {title && <span className="name">{title}</span>}
        {desc && <span className="desc" title={desc}>{desc}</span>}
        <span className="right">
          <span className="actions">
            {copyText !== undefined && <CopyButton text={copyText} label="Copy content" />}
            {onRaw && (
              <button
                type="button"
                className="btn ghost sm"
                title="View raw event"
                aria-label="View raw event"
                onClick={(e) => {
                  e.stopPropagation();
                  onRaw();
                }}
              >
                <Icon name="code" size={12} />
              </button>
            )}
          </span>
          {right}
        </span>
      </div>
      {isOpen ? <div className="card-body">{children}</div> : summary ? <div className="summary-line">{summary}</div> : null}
    </div>
  );
}
