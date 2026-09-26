import { useCopy } from '@/hooks/useCopy';
import { Icon } from './Icon';

export function CopyButton({ text, label = 'Copy', small = true, getText, icon = 'copy' }: { text?: string; label?: string; small?: boolean; getText?: () => string; icon?: string }) {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      className={`btn ghost ${small ? 'sm' : ''}`}
      title={copied ? 'Copied' : label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        void copy(getText ? getText() : text || '');
      }}
    >
      <Icon name={copied ? 'check' : icon} size={12} />
      {!small && (copied ? 'Copied' : label)}
    </button>
  );
}
