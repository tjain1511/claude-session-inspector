import { forwardRef, useImperativeHandle, useRef } from 'react';
import { Icon } from '@/components/common/Icon';
import { Kbd } from '@/components/common/Kbd';
import { MOD } from '@/utils/format';

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  shortcut?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  autoFocus?: boolean;
  ariaLabel?: string;
}

export const SearchInput = forwardRef<HTMLInputElement, Props>(function SearchInput({ value, onChange, placeholder, shortcut, onKeyDown, autoFocus, ariaLabel }, ref) {
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);
  const clear = () => {
    onChange('');
    inputRef.current?.focus();
  };
  return (
    <div className={`search-box${value ? ' has-value' : shortcut ? ' has-trail' : ''}`}>
      <Icon name="search" />
      <input
        ref={inputRef}
        className="input"
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Escape clears the query first; on an empty field it falls through to the global handler (blur)
          if (e.key === 'Escape' && value) {
            e.preventDefault();
            e.stopPropagation();
            onChange('');
            return;
          }
          onKeyDown?.(e);
        }}
        autoFocus={autoFocus}
        aria-label={ariaLabel || placeholder}
        spellCheck={false}
        autoComplete="off"
      />
      {value ? (
        <button type="button" className="clear" onClick={clear} title="Clear (Esc)" aria-label="Clear search">
          <Icon name="x" size={12} />
        </button>
      ) : shortcut ? (
        <Kbd keys={shortcut.replace('MOD', MOD)} />
      ) : null}
    </div>
  );
});
