// Compact analyses of every session, for the evaluation dashboard and the comparison picker.
// Fetched once, then refreshed (debounced) when the server reports changed sessions; the
// server serves unchanged sessions from its cache, so a refresh costs about as much as a list.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/services/api';
import type { CompactAnalysis } from '@/types/analysis';

export function useAnalyses(enabled: boolean, changeKey: number | null) {
  const [analyses, setAnalyses] = useState<CompactAnalysis[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ id: string; message: string }[]>([]);
  const inflight = useRef(false);
  const again = useRef(false);

  const load = useCallback(async () => {
    if (inflight.current) {
      again.current = true;
      return;
    }
    inflight.current = true;
    setLoading(true);
    try {
      const r = await api.analyses();
      setAnalyses(r.analyses);
      setFailed(r.failed);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      inflight.current = false;
      if (again.current) {
        again.current = false;
        void load();
      }
    }
  }, []);

  useEffect(() => {
    if (enabled && !analyses) void load();
  }, [enabled, analyses, load]);

  useEffect(() => {
    if (!enabled || !changeKey) return;
    const t = setTimeout(() => void load(), 1500);
    return () => clearTimeout(t);
  }, [enabled, changeKey, load]);

  const byId = useMemo(() => new Map((analyses || []).map((a) => [a.id, a])), [analyses]);
  return { analyses, byId, loading, error, failed, reload: load };
}
