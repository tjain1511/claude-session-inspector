import { useCallback, useEffect, useRef, useState } from 'react';
import { useSessions } from '@/features/sessions/useSessions';
import { useSessionDetail } from '@/features/sessions/useSessionDetail';
import { useSettings } from '@/features/settings/settings';
import { Header } from '@/components/Header/Header';
import { SearchInput } from '@/components/Search/SearchInput';
import { Filters } from '@/components/Filters/Filters';
import { SessionList } from '@/components/SessionList/SessionList';
import { SessionViewer } from '@/components/SessionViewer/SessionViewer';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { SettingsPanel } from '@/components/Settings/SettingsPanel';
import { MetadataDrawer } from '@/components/Metadata/MetadataDrawer';
import { ShortcutsHelp } from '@/components/common/ShortcutsHelp';
import { IssuesModal } from '@/components/common/IssuesModal';
import { ToastProvider, useToast } from '@/hooks/useToast';
import { isDefaultFilters } from '@/features/search/filters';
import type { SessionEvent } from '@/types/session';

function readHash(): string | null {
  const m = location.hash.match(/session=([0-9a-f-]{36})/i);
  return m ? m[1]! : null;
}

function Shell() {
  const sessions = useSessions();
  const [settings, update] = useSettings();
  const [selectedId, setSelectedId] = useState<string | null>(readHash);
  const detail = useSessionDetail(selectedId, sessions.lastChange);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [metadataId, setMetadataId] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [titleEditing, setTitleEditing] = useState(false);
  const [editingListId, setEditingListId] = useState<string | null>(null);
  const [rawEvent, setRawEvent] = useState<SessionEvent | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const autoOpened = useRef(false);

  // Theme: data-theme on <html>; 'system' follows prefers-color-scheme.
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      const t = settings.theme === 'system' ? (mq.matches ? 'light' : 'dark') : settings.theme;
      root.setAttribute('data-theme', t);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings.theme]);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    setShowSidebar(false);
    history.replaceState(null, '', id ? `#session=${id}` : location.pathname);
  }, []);

  useEffect(() => {
    const onHash = () => setSelectedId(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Auto-open most recent session once the list is loaded (setting)
  useEffect(() => {
    if (autoOpened.current || sessions.loading || !settings.autoOpenRecent || selectedId) return;
    const first = sessions.sessions[0];
    if (first) {
      autoOpened.current = true;
      select(first.id);
    }
  }, [sessions.loading, sessions.sessions, settings.autoOpenRecent, selectedId, select]);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowSidebar(true);
        if (settings.sidebarCollapsed) update({ sidebarCollapsed: false });
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        update({ sidebarCollapsed: !settings.sidebarCollapsed });
      } else if (mod && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        void sessions.reload(true);
        if (selectedId) void detail.reload();
      } else if (mod && e.key.toLowerCase() === 'f' && selectedId) {
        e.preventDefault();
        setFindOpen(true);
      } else if (e.key === 'Escape') {
        if (rawEvent) setRawEvent(null);
        else if (metadataId) setMetadataId(null);
        else if (findOpen) setFindOpen(false);
        else if (showSettings || showHelp || showIssues) {
          setShowSettings(false);
          setShowHelp(false);
          setShowIssues(false);
        } else if (typing) (target as HTMLElement).blur();
      } else if (!typing && !mod) {
        if (e.key === '?') setShowHelp((v) => !v);
        else if (e.key.toLowerCase() === 'i' && selectedId) setMetadataId(selectedId);
        else if (e.key === 'j' || e.key === 'k') {
          const scroller = document.querySelector('.timeline-scroll') as HTMLElement | null;
          if (!scroller) return;
          const cards = [...scroller.querySelectorAll<HTMLElement>('.event[data-event-id]')];
          const top = scroller.getBoundingClientRect().top + 40;
          let idx = cards.findIndex((c) => c.getBoundingClientRect().top >= top - 1);
          if (idx < 0) idx = cards.length - 1;
          const next = e.key === 'j' ? Math.min(cards.length - 1, idx + (cards[idx] && Math.abs(cards[idx]!.getBoundingClientRect().top - top) < 2 ? 1 : 0)) : Math.max(0, idx - 1);
          cards[next]?.scrollIntoView({ block: 'start' });
          e.preventDefault();
        } else if (e.key.toLowerCase() === 'o' && selectedId) {
          update({ showOutline: !settings.showOutline });
        } else if (e.key.toLowerCase() === 'e' && selectedId) {
          (document.querySelector('.toolbar .btn[title^="Expand"]') as HTMLButtonElement | null)?.click();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sessions, detail, selectedId, rawEvent, metadataId, findOpen, showSettings, showHelp, showIssues, settings.sidebarCollapsed, settings.showOutline, update]);

  // Sidebar resize
  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = settings.sidebarWidth;
    const onMove = (ev: MouseEvent) => update({ sidebarWidth: Math.min(560, Math.max(240, startW + ev.clientX - startX)) });
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const selected = selectedId ? sessions.byId.get(selectedId) ?? detail.summary : null;
  const st = sessions.status;
  const report = st?.report;
  const issues = report?.issues.length ?? 0;
  const nothingToShow = !!sessions.error || !st || st.status === 'error' || (st.status === 'ready' && sessions.sessions.length === 0);

  const rename = async (id: string, name: string) => {
    try {
      await sessions.rename(id, name);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Rename failed', 'error');
      throw e;
    }
  };
  const clearName = async (id: string) => {
    try {
      await sessions.clearName(id);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Reset failed', 'error');
      throw e;
    }
  };

  const metadataSession = metadataId ? sessions.byId.get(metadataId) : null;

  return (
    <div className={`app ${showSidebar ? 'show-sidebar' : ''} ${settings.sidebarCollapsed ? 'sidebar-collapsed' : ''}`} style={{ ['--sidebar-w' as string]: `${settings.sidebarWidth}px` }}>
      <Header
        version={st?.version ?? null}
        connected={sessions.connected}
        watching={settings.watch}
        indexing={st?.status === 'indexing'}
        loaded={report?.loaded ?? 0}
        total={report?.sessions ?? 0}
        issues={issues}
        onRefresh={() => {
          void sessions.reload(true);
          if (selectedId) void detail.reload();
        }}
        onSettings={() => setShowSettings(true)}
        onIssues={() => setShowIssues(true)}
        onToggleSidebar={() => setShowSidebar((v) => !v)}
        sidebarCollapsed={settings.sidebarCollapsed}
        onCollapseSidebar={() => update({ sidebarCollapsed: !settings.sidebarCollapsed })}
        onHelp={() => setShowHelp(true)}
        theme={settings.theme}
        onToggleTheme={() => update({ theme: document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light' })}
      />
      <aside className="sidebar" aria-hidden={settings.sidebarCollapsed}>
        <div className="sidebar-top">
          <SearchInput
            ref={searchRef}
            value={sessions.query}
            onChange={sessions.setQuery}
            placeholder="Search sessions…"
            shortcut="MOD K"
            ariaLabel="Search sessions"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'Enter') {
                e.preventDefault();
                listRef.current?.focus();
                if (e.key === 'Enter' && sessions.filtered[0] && !selectedId) select(sessions.filtered[0].id);
              }
            }}
          />
          <Filters filters={sessions.filters} onChange={sessions.setFilters} projects={sessions.projects} models={sessions.models} />
        </div>
        <div className="list-meta">
          <span>
            {sessions.filtered.length === sessions.sessions.length ? `${sessions.sessions.length} sessions` : `${sessions.filtered.length} of ${sessions.sessions.length} sessions`}
            {sessions.searchPending ? ' · searching…' : ''}
          </span>
          {(sessions.query || !isDefaultFilters(sessions.filters)) && (
            <button type="button" onClick={() => { sessions.setQuery(''); sessions.setFilters({ time: 'all', project: '', model: '', activity: [] }); }}>clear</button>
          )}
        </div>
        <SessionList
          sessions={sessions.filtered}
          selectedId={selectedId}
          onSelect={select}
          onRename={rename}
          onClearName={clearName}
          onShowMetadata={setMetadataId}
          canReveal={!!st?.canReveal}
          loading={sessions.loading}
          listRef={listRef}
          editingId={editingListId}
          setEditingId={setEditingListId}
        />
        <div className="resizer" onMouseDown={onResizeStart} role="separator" aria-orientation="vertical" aria-label="Resize sidebar" />
      </aside>
      <main className="main">
        {nothingToShow ? (
          <EmptyState status={st} connectionError={sessions.error} onRetry={() => void sessions.reload(true)} onChooseDir={sessions.setDataDir} />
        ) : selected ? (
          <SessionViewer
            session={selected}
            detail={detail}
            onRename={(name) => rename(selected.id, name)}
            onClearName={() => clearName(selected.id)}
            onShowMetadata={() => setMetadataId(selected.id)}
            onReload={() => void detail.reload()}
            findOpen={findOpen}
            setFindOpen={setFindOpen}
            titleEditing={titleEditing}
            setTitleEditing={setTitleEditing}
            rawEvent={rawEvent}
            setRawEvent={setRawEvent}
          />
        ) : selectedId && !sessions.loading ? (
          <div className="state-panel">
            <div className="state-card">
              <h2>Session not found</h2>
              <p>No session with id <code>{selectedId}</code> is in the index. It may have been deleted or live in a different data directory.</p>
              <div className="actions"><button type="button" className="btn" onClick={() => select(null)}>Back to sessions</button></div>
            </div>
          </div>
        ) : (
          <div className="state-panel">
            <div className="state-card" style={{ textAlign: 'center', color: 'var(--text-2)' }}>
              <h2 style={{ color: 'var(--text)' }}>Select a session</h2>
              <p>Pick a session on the left to inspect its execution flow. Press <kbd>⌘</kbd> <kbd>K</kbd> to search, <kbd>?</kbd> for shortcuts.</p>
            </div>
          </div>
        )}
      </main>
      {showSettings && <SettingsPanel status={st} onClose={() => setShowSettings(false)} onChooseDir={sessions.setDataDir} />}
      {showHelp && <ShortcutsHelp onClose={() => setShowHelp(false)} />}
      {showIssues && <IssuesModal status={st} onClose={() => setShowIssues(false)} onOpenSession={select} />}
      {metadataSession && <MetadataDrawer session={metadataSession} onClose={() => setMetadataId(null)} onOpenSession={(id) => { setMetadataId(null); select(id); }} />}
    </div>
  );
}

export function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}
