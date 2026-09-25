import { Icon } from '@/components/common/Icon';
import { MOD } from '@/utils/format';

interface Props {
  version: string | null;
  connected: boolean;
  watching: boolean;
  indexing: boolean;
  loaded: number;
  total: number;
  issues: number;
  onRefresh: () => void;
  onSettings: () => void;
  onIssues: () => void;
  onToggleSidebar: () => void;
  onHelp: () => void;
  theme: 'system' | 'dark' | 'light';
  onToggleTheme: () => void;
}

export function Header({ version, connected, watching, indexing, loaded, total, issues, onRefresh, onSettings, onIssues, onToggleSidebar, onHelp, theme, onToggleTheme }: Props) {
  return (
    <header className="header">
      <div className="brand">
        <button type="button" className="btn icon ghost narrow-only" onClick={onToggleSidebar} aria-label="Toggle session list">
          <Icon name="sidebar" />
        </button>
        <span className="dot" aria-hidden="true" />
        <span>Claude Session Viewer</span>
        {version && <span className="ver">v{version}</span>}
      </div>
      <div className="status-line">
        {indexing ? (
          <span>Indexing…</span>
        ) : total > 0 ? (
          <span>
            {loaded} of {total} sessions loaded
          </span>
        ) : null}
        {issues > 0 && (
          <button type="button" className="chip warn" onClick={onIssues} title="View parsing issues">
            <Icon name="warn" size={11} /> {issues} issue{issues === 1 ? '' : 's'}
          </button>
        )}
        {watching && (
          <span className={`chip ${connected ? 'success' : ''}`} title={connected ? 'Watching the session directory for changes' : 'Reconnecting to the local bridge…'}>
            {connected ? <span className="live-dot" style={{ animation: 'none' }} /> : null}
            {connected ? 'Watching' : 'Reconnecting'}
          </span>
        )}
      </div>
      <div className="spacer" />
      <button type="button" className="btn ghost" onClick={onHelp} title="Keyboard shortcuts (?)">
        <kbd>?</kbd>
      </button>
      <button type="button" className="btn ghost" onClick={onRefresh} title={`Refresh sessions (${MOD}+R)`}>
        <Icon name="refresh" /> Refresh
      </button>
      <button type="button" className="btn icon ghost" onClick={onToggleTheme} title={`Switch theme (currently ${theme})`} aria-label="Toggle light/dark theme">
        <Icon name="theme" />
      </button>
      <button type="button" className="btn icon ghost" onClick={onSettings} title="Settings" aria-label="Settings">
        <Icon name="settings" />
      </button>
    </header>
  );
}
