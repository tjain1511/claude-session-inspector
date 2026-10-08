// Loads the deterministic analysis of the open session. Server-side it is cached by the
// transcript files' size/mtime, so re-fetching after the file grew is cheap.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/services/api';
import type { SessionAnalysis } from '@/types/analysis';

export interface AnalysisState {
  analysis: SessionAnalysis | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useSessionAnalysis(id: string | null, changedAt: number | null, enabled = true): AnalysisState {
  const [analysis, setAnalysis] = useState<SessionAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<string | null>(null);

  const load = useCallback(async (sid: string) => {
    setLoading(true);
    try {
      const a = await api.readAnalysis(sid);
      if (current.current !== sid) return;
      setAnalysis(a);
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
    setAnalysis(null);
    setError(null);
    if (id && enabled) void load(id);
  }, [id, enabled, load]);

  useEffect(() => {
    if (id && enabled && changedAt) void load(id);
  }, [id, enabled, changedAt, load]);

  return { analysis, loading, error, reload: () => id && void load(id) };
}
