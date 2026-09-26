// Session list state: initial load, filters, search (local + server), live updates via SSE.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '@/services/api';
import type { SessionSummary, StatusPayload, ServerEvent } from '@/types/session';
import { DEFAULT_FILTERS, matchesFilters, matchesLocalQuery, type Filters } from '@/features/search/filters';
import { useDebounced } from '@/hooks/useDebounce';
import { useSettings } from '@/features/settings/settings';

export interface SessionsState {
  status: StatusPayload | null;
  sessions: SessionSummary[];
  byId: Map<string, SessionSummary>;
  loading: boolean;
  error: string | null;
  connected: boolean;
  lastChange: { ids: string[]; at: number } | null;
  /** Bumped when a memory note changes on disk. */
  memoryAt: number;
}

export function useSessions() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastChange, setLastChange] = useState<SessionsState['lastChange']>(null);
  const [memoryAt, setMemoryAt] = useState(0);
  const [settings] = useSettings();
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const debouncedQuery = useDebounced(query.trim(), 140);
  const [serverHits, setServerHits] = useState<{ q: string; ids: Set<string> | null }>({ q: '', ids: null });

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const st = refresh ? await api.refresh() : await api.status();
      setStatus(st);
      if (st.status === 'ready' || st.status === 'indexing') {
        const r = await api.listSessions();
        setSessions(r.sessions);
      } else {
        setSessions([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Server-side content search
  useEffect(() => {
    let cancelled = false;
    if (!debouncedQuery) {
      setServerHits({ q: '', ids: null });
      return;
    }
    api
      .search(debouncedQuery)
      .then((r) => {
        if (!cancelled) setServerHits({ q: debouncedQuery, ids: r.ids ? new Set(r.ids) : null });
      })
      .catch(() => {
        if (!cancelled) setServerHits({ q: debouncedQuery, ids: null });
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  // Live updates
  const watch = settings.watch;
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!watch) {
      setConnected(false);
      return;
    }
    const unsubscribe = api.subscribe(
      (ev: ServerEvent) => {
        if (ev.type === 'sessions') {
          setSessions((prev) => {
            const map = new Map(prev.map((s) => [s.id, s]));
            for (const s of ev.updated) map.set(s.id, s);
            for (const id of ev.removed) map.delete(id);
            return [...map.values()].sort((a, b) => (b.endedAt || '').localeCompare(a.endedAt || ''));
          });
          setLastChange({ ids: ev.updated.map((s) => s.id), at: Date.now() });
        } else if (ev.type === 'live') {
          const liveMap = new Map(ev.sessions.map((s) => [s.id, s.live]));
          setSessions((prev) => prev.map((s) => ({ ...s, live: liveMap.get(s.id) ?? null })));
        } else if (ev.type === 'memory') {
          setMemoryAt(Date.now());
        } else if (ev.type === 'indexing' && ev.status === 'ready') {
          void loadRef.current();
        }
      },
      setConnected,
    );
    return unsubscribe;
  }, [watch]);

  const byId = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);

  const filtered = useMemo(() => {
    const q = query.trim();
    const now = new Date();
    return sessions.filter((s) => {
      if (!matchesFilters(s, filters, now)) return false;
      if (!q) return true;
      if (matchesLocalQuery(s, q)) return true;
      return serverHits.q === q.toLowerCase() || serverHits.q === q ? !!serverHits.ids?.has(s.id) : false;
    });
  }, [sessions, filters, query, serverHits]);

  const projects = useMemo(() => {
    const m = new Map<string, { raw: string; path: string; name: string; count: number }>();
    for (const s of sessions) {
      const cur = m.get(s.project.raw);
      if (cur) cur.count++;
      else m.set(s.project.raw, { raw: s.project.raw, path: s.project.path, name: s.project.name, count: 1 });
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  }, [sessions]);

  const models = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sessions) for (const x of s.models) m.set(x.name, (m.get(x.name) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  }, [sessions]);

  const applyRename = useCallback((summary: SessionSummary) => {
    setSessions((prev) => prev.map((s) => (s.id === summary.id ? summary : s)));
  }, []);

  const rename = useCallback(
    async (id: string, name: string) => {
      const r = await api.rename(id, name);
      applyRename(r.summary);
      return r.summary;
    },
    [applyRename],
  );
  const clearName = useCallback(
    async (id: string) => {
      const r = await api.clearName(id);
      applyRename(r.summary);
      return r.summary;
    },
    [applyRename],
  );

  const setDataDir = useCallback(
    async (dir: string | null) => {
      try {
        const st = await api.setDataDir(dir);
        setStatus(st);
        await load();
        return null;
      } catch (e) {
        return e instanceof ApiError ? e.message : String(e);
      }
    },
    [load],
  );

  return {
    status,
    sessions,
    filtered,
    byId,
    loading,
    error,
    connected,
    lastChange,
    memoryAt,
    query,
    setQuery,
    searchPending: !!query.trim() && serverHits.q !== query.trim(),
    filters,
    setFilters,
    projects,
    models,
    reload: load,
    rename,
    clearName,
    setDataDir,
  };
}

export type SessionsApi = ReturnType<typeof useSessions>;
