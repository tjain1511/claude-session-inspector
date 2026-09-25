import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/common/Icon';

export const MAX_NAME = 120;

interface Props {
  initial: string;
  onSave: (name: string) => Promise<void> | void;
  onCancel: () => void;
  large?: boolean;
  placeholder?: string;
}

/** Shared inline edit field for session names: Enter saves, Escape cancels, trims, rejects empty/too long. */
export function InlineRename({ initial, onSave, onCancel, large, placeholder }: Props) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const trimmed = value.trim();
  const over = trimmed.length > MAX_NAME;
  const valid = trimmed.length > 0 && !over;
  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onSave(trimmed);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <div className={large ? 'title-edit' : 'inline-edit'} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <input
        ref={ref}
        className="input"
        value={value}
        placeholder={placeholder || 'Session name'}
        maxLength={MAX_NAME + 20}
        aria-label="Session name"
        aria-invalid={over || undefined}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void save();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        disabled={busy}
      />
      {large && <span className={`counter ${over ? 'over' : ''}`}>{trimmed.length}/{MAX_NAME}</span>}
      <button type="button" className="btn icon sm" title="Save (Enter)" aria-label="Save name" onClick={() => void save()} disabled={!valid || busy}>
        <Icon name="check" size={12} />
      </button>
      <button type="button" className="btn icon sm ghost" title="Cancel (Esc)" aria-label="Cancel rename" onClick={onCancel} disabled={busy}>
        <Icon name="x" size={12} />
      </button>
      {err && <span className="error-text">{err}</span>}
    </div>
  );
}
