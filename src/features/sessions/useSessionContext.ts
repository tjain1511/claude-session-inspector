// Loads the model context (system prompt, tool/agent/skill listings, instructions) for the
// open session. Fetched once per session and again when the transcript grows, since a
// compaction or a newly loaded MCP server appends fresh listing records.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/services/api';
import type { SessionContext } from '@/types/session';

export interface ContextState {
  context: SessionContext | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useSessionContext(id: string | null, changedAt: number | null): ContextState {
  const [context, setContext] = useState<SessionContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<string | null>(null);

  const load = useCallback(async (sid: string) => {
    setLoading(true);
    try {
      const c = await api.readContext(sid);
      if (current.current !== sid) return;
      setContext(c);
      setError(null);
    } catch (e) {
      if (current.current !== sid) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (current.current === sid) setLoading(false);
    }
  }, []);

  useEffect(() => {
    current.current = id;
    setContext(null);
    setError(null);
    if (id) void load(id);
  }, [id, load]);

  // Refresh (server-side cached by size/mtime, so this is cheap) when the file grew.
  useEffect(() => {
    if (id && changedAt) void load(id);
  }, [id, changedAt, load]);

  return { context, loading, error, reload: () => id && void load(id) };
}
