import { useState } from 'react';
import { Modal } from '@/components/common/Modal';
import { useSettings } from '@/features/settings/settings';
import type { StatusPayload } from '@/types/session';
import { PricingSettings } from './PricingSettings';

interface Props {
  status: StatusPayload | null;
  onClose: () => void;
  onChooseDir: (dir: string | null) => Promise<string | null>;
}

export function SettingsPanel({ status, onClose, onChooseDir }: Props) {
  const [s, update] = useSettings();
  const [dir, setDir] = useState(status?.settings.dataDir || '');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const apply = async (value: string | null) => {
    setBusy(true);
    setErr(null);
    const e = await onChooseDir(value);
    setBusy(false);
    if (e) setErr(e);
  };
  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="settings-grid">
        <div className="lbl full">
          Session directory
          <small>Currently reading {status?.projectsDir || '—'}. Leave empty for automatic discovery.</small>
        </div>
        <div className="full dir-row">
          <input className="input" value={dir} placeholder={status?.candidates.find((c) => c.usable)?.path || '~/.claude'} onChange={(e) => setDir(e.target.value)} aria-label="Session directory" />
          <button type="button" className="btn" disabled={busy} onClick={() => void apply(dir.trim() || null)}>Apply</button>
        </div>
        {err && <div className="error-text full">{err}</div>}

        <div className="lbl">Watch for new sessions<small>Keeps the list and open session updated as Claude writes to disk.</small></div>
        <label className="toggle"><input type="checkbox" checked={s.watch} onChange={(e) => update({ watch: e.target.checked })} /></label>

        <div className="lbl">Show thinking blocks<small>Include Claude's reasoning blocks in the timeline when present in the log.</small></div>
        <label className="toggle"><input type="checkbox" checked={s.showThinking} onChange={(e) => update({ showThinking: e.target.checked })} /></label>

        <div className="lbl">Show metadata events<small>Context attachments, mode changes and other housekeeping records, collapsed.</small></div>
        <label className="toggle"><input type="checkbox" checked={s.showMetadata} onChange={(e) => update({ showMetadata: e.target.checked })} /></label>

        <div className="lbl">Compact tool calls<small>Successful tool calls start collapsed to one row; failures stay open.</small></div>
        <label className="toggle"><input type="checkbox" checked={s.density === 'compact'} onChange={(e) => update({ density: e.target.checked ? 'compact' : 'comfortable' })} /></label>

        <div className="lbl">Tool output<small>Truncated shows the first 40 lines with "show more".</small></div>
        <div className="radio-row" role="radiogroup" aria-label="Tool output">
          <button type="button" role="radio" aria-checked={s.toolOutput === 'full'} className={s.toolOutput === 'full' ? 'on' : ''} onClick={() => update({ toolOutput: 'full' })}>Full</button>
          <button type="button" role="radio" aria-checked={s.toolOutput === 'truncated'} className={s.toolOutput === 'truncated' ? 'on' : ''} onClick={() => update({ toolOutput: 'truncated' })}>Truncated</button>
        </div>

        <div className="lbl">Theme<small>System follows your OS preference.</small></div>
        <div className="radio-row" role="radiogroup" aria-label="Theme">
          {(['system', 'dark', 'light'] as const).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={s.theme === t} className={s.theme === t ? 'on' : ''} onClick={() => update({ theme: t })}>{t[0]!.toUpperCase() + t.slice(1)}</button>
          ))}
        </div>

        <div className="lbl">Timestamp<small>Gutter shows wall-clock time or time since session start.</small></div>
        <div className="radio-row" role="radiogroup" aria-label="Timestamp format">
          <button type="button" role="radio" aria-checked={s.timestamps === 'local'} className={s.timestamps === 'local' ? 'on' : ''} onClick={() => update({ timestamps: 'local' })}>Local time</button>
          <button type="button" role="radio" aria-checked={s.timestamps === 'relative'} className={s.timestamps === 'relative' ? 'on' : ''} onClick={() => update({ timestamps: 'relative' })}>Relative</button>
        </div>
      </div>
      <h4 className="settings-h4">Pricing</h4>
      <PricingSettings />
      <p className="help-text settings-foot">
        Everything stays on this machine. Rate overrides are saved in <code>~/.claude-session-inspector/settings.json</code>. Preferences live in this browser's local storage; custom session names live in <code>~/.claude-session-inspector/metadata.json</code>. Claude's own files are never modified.
      </p>
    </Modal>
  );
}
