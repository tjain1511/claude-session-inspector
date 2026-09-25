import { useState } from 'react';
import type { SessionSummary } from '@/types/session';
import { Icon } from '@/components/common/Icon';
import { InlineRename } from '@/components/SessionList/InlineRename';

interface Props {
  session: SessionSummary;
  onRename: (name: string) => Promise<unknown>;
  onClearName: () => Promise<unknown>;
  editing: boolean;
  setEditing: (v: boolean) => void;
}

export function SessionTitle({ session: s, onRename, onClearName, editing, setEditing }: Props) {
  const [busy, setBusy] = useState(false);
  if (editing) {
    return (
      <InlineRename
        large
        initial={s.customName || s.title}
        onSave={async (name) => {
          await onRename(name);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }
  return (
    <>
      <h1
        className="viewer-title"
        title={s.customName ? `Custom name (generated: ${s.generatedTitle || '—'}). Click to rename.` : 'Click to rename'}
        onClick={() => setEditing(true)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'F2') setEditing(true);
        }}
        style={{ margin: 0 }}
      >
        {s.customName && <span className="custom-mark" aria-label="Custom name">✎</span>}
        {s.title}
      </h1>
      <button type="button" className="btn icon sm ghost edit-btn" title="Rename session" aria-label="Rename session" onClick={() => setEditing(true)}>
        <Icon name="edit" size={12} />
      </button>
      {s.customName && (
        <button
          type="button"
          className="btn sm ghost edit-btn"
          title={`Reset to generated title: ${s.generatedTitle || '—'}`}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onClearName();
            } finally {
              setBusy(false);
            }
          }}
        >
          <Icon name="reset" size={12} /> Reset name
        </button>
      )}
    </>
  );
}
