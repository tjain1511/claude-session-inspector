import { forwardRef } from 'react';
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
  return (
    <div className="search-box">
      <Icon name="search" />
      <input
        ref={ref}
        className="input"
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
        aria-label={ariaLabel || placeholder}
        spellCheck={false}
        autoComplete="off"
      />
      {value ? (
        <button type="button" className="clear" onClick={() => onChange('')} aria-label="Clear search">
          <Icon name="x" size={12} />
        </button>
      ) : shortcut ? (
        <Kbd keys={shortcut.replace('MOD', MOD)} />
      ) : null}
    </div>
  );
});
