// Loads one session's normalized events and appends new ones incrementally when the
// file grows (live sessions). Keeps a byte offset + line so the server only parses the tail.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/services/api';
import type { SessionEvent, SessionRead, SessionSummary } from '@/types/session';

export interface DetailState {
  id: string | null;
  summary: SessionSummary | null;
  events: SessionEvent[];
  errors: { line: number; message: string }[];
  loading: boolean;
  error: string | null;
  partial: boolean;
  appendedAt: number | null;
  offset: number;
  line: number;
}

const EMPTY: DetailState = { id: null, summary: null, events: [], errors: [], loading: false, error: null, partial: false, appendedAt: null, offset: 0, line: 1 };

export function useSessionDetail(id: string | null, changeSignal: { ids: string[]; at: number } | null) {
  const [state, setState] = useState<DetailState>(EMPTY);
  const cursor = useRef<{ id: string | null; offset: number; line: number }>({ id: null, offset: 0, line: 1 });
  const inflight = useRef<Promise<void> | null>(null);

  const loadFull = useCallback(async (sid: string) => {
    setState((s) => ({ ...EMPTY, id: sid, loading: true, summary: s.id === sid ? s.summary : null }));
    try {
      const r: SessionRead = await api.readSession(sid);
      if (cursor.current.id !== sid) return;
      cursor.current = { id: sid, offset: r.offset, line: r.line };
      setState({ id: sid, summary: r.summary, events: r.events, errors: r.errors, loading: false, error: null, partial: r.partial, appendedAt: null, offset: r.offset, line: r.line });
    } catch (e) {
      if (cursor.current.id !== sid) return;
      setState({ ...EMPTY, id: sid, loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    cursor.current = { id, offset: 0, line: 1 };
    if (!id) {
      setState(EMPTY);
      return;
    }
    void loadFull(id);
  }, [id, loadFull]);

  // Incremental append when the server reports a change to the open session.
  useEffect(() => {
    if (!id || !changeSignal || !changeSignal.ids.includes(id)) return;
    if (cursor.current.id !== id) return;
    const run = async () => {
      const { offset, line } = cursor.current;
      try {
        const r = await api.readSession(id, { offset, line });
        if (cursor.current.id !== id) return;
        if (r.restarted || r.offset < offset) {
          await loadFull(id);
          return;
        }
        cursor.current = { id, offset: r.offset, line: r.line };
        setState((s) => {
          if (s.id !== id) return s;
          const seen = new Set(s.events.map((e) => e.id));
          const fresh = r.events.filter((e) => !seen.has(e.id));
          return {
            ...s,
            summary: r.summary,
            events: fresh.length ? [...s.events, ...fresh] : s.events,
            errors: r.errors.length ? [...s.errors, ...r.errors] : s.errors,
            partial: r.partial,
            appendedAt: fresh.length ? Date.now() : s.appendedAt,
            offset: r.offset,
            line: r.line,
          };
        });
      } catch {
        /* transient; next change will retry */
      }
    };
    inflight.current = (inflight.current || Promise.resolve()).then(run);
  }, [changeSignal, id, loadFull]);

  return { ...state, reload: () => (id ? loadFull(id) : Promise.resolve()) };
}
