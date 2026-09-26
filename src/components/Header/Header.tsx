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
  sidebarCollapsed: boolean;
  onCollapseSidebar: () => void;
  onHelp: () => void;
  theme: 'system' | 'dark' | 'light';
  onToggleTheme: () => void;
  onHome: () => void;
  onMemory: () => void;
  memoryActive: boolean;
}

export function Header({ version, connected, watching, indexing, loaded, total, issues, onRefresh, onSettings, onIssues, onToggleSidebar, sidebarCollapsed, onCollapseSidebar, onHelp, theme, onToggleTheme, onHome, onMemory, memoryActive }: Props) {
  return (
    <header className="header">
      <div className="brand">
        <button type="button" className="btn icon ghost narrow-only" onClick={onToggleSidebar} aria-label="Toggle session list">
          <Icon name="sidebar" />
        </button>
        <button type="button" className={`btn icon ghost wide-only ${sidebarCollapsed ? 'active' : ''}`} onClick={onCollapseSidebar} aria-label={sidebarCollapsed ? 'Show session list' : 'Hide session list'} aria-pressed={sidebarCollapsed} title={`${sidebarCollapsed ? 'Show' : 'Hide'} session list (${MOD}+B)`}>
          <Icon name="sidebar" />
        </button>
        <button type="button" className="brand-home" onClick={onHome} title="Overview of all sessions">
          <span className="logo" aria-hidden="true"><Icon name="pulse" size={12} /></span>
          <span>Session Inspector</span>
        </button>
        {version && <span className="ver">v{version}</span>}
      </div>
      <div className="status-line">
        {indexing || (total > 0 && loaded < total) ? (
          <span className="indexing" title="Reading transcripts">
            <span className="spinner" aria-hidden="true" /> Indexing{total ? ` ${loaded} / ${total}` : '…'}
          </span>
        ) : total > 0 ? (
          <span title={`${loaded} of ${total} sessions loaded`}>{total.toLocaleString()} sessions</span>
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
      <button type="button" className={`btn ghost header-nav ${memoryActive ? 'active' : ''}`} onClick={onMemory} aria-pressed={memoryActive} title="What Claude remembers across sessions (M)">
        <Icon name="memory" /> <span>Memory</span>
      </button>
      <button type="button" className="btn ghost icon" onClick={onHelp} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">
        <Icon name="keyboard" />
      </button>
      <button type="button" className="btn ghost icon" onClick={onRefresh} title={`Rescan sessions (${MOD}+R)`} aria-label="Rescan sessions">
        <Icon name="refresh" />
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
