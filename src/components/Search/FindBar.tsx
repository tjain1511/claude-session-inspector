import { useEffect, useRef } from 'react';
import { Icon } from '@/components/common/Icon';

interface Props {
  query: string;
  onChange: (q: string) => void;
  count: number;
  index: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  scoped?: boolean; // the flow is filtered: matches only cover what is shown
}

export function FindBar({ query, onChange, count, index, onNext, onPrev, onClose, scoped }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <div className="find-bar" role="search">
      <Icon name="search" size={12} className="find-icon" />
      <input
        ref={ref}
        className="input"
        placeholder="Find in session…"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Find in session"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.shiftKey ? onPrev() : onNext();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <span className="count" aria-live="polite">{query ? (count ? `${index + 1} / ${count}` : 'no matches') : ''}</span>
      <button type="button" className="btn icon sm" onClick={onPrev} disabled={!count} title="Previous (Shift+Enter)" aria-label="Previous match"><Icon name="arrowUp" size={12} /></button>
      <button type="button" className="btn icon sm" onClick={onNext} disabled={!count} title="Next (Enter)" aria-label="Next match"><Icon name="arrowDown" size={12} /></button>
      {scoped && <span className="help-text">searching the filtered flow</span>}
      <span className="grow" />
      <span className="help-text find-hint"><kbd>Enter</kbd> next · <kbd>Shift</kbd><kbd>Enter</kbd> previous</span>
      <button type="button" className="btn icon sm ghost" onClick={onClose} title="Close (Esc)" aria-label="Close find"><Icon name="x" size={12} /></button>
    </div>
  );
}
