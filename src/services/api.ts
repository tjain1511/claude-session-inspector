// The only place the UI talks to the local bridge. Every request goes to the same
// origin (127.0.0.1) and carries the per-launch token from the served HTML.
import type { SessionRead, SessionSummary, StatusPayload, SubagentRead, ServerEvent } from '@/types/session';

const token = document.querySelector('meta[name="csv-token"]')?.getAttribute('content') || '';

export class ApiError extends Error {
  status: number;
  code: string | null;
  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'x-csv-token': token, ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers || {}) },
  });
  if (!res.ok) {
    let msg = res.statusText;
    let code: string | null = null;
    try {
      const j = await res.json();
      msg = j.error || msg;
      code = j.code || null;
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, msg, code);
  }
  return (await res.json()) as T;
}

export const api = {
  status: () => request<StatusPayload>('/api/status'),
  refresh: () => request<StatusPayload>('/api/refresh', { method: 'POST' }),
  setDataDir: (dataDir: string | null) => request<StatusPayload>('/api/settings', { method: 'PUT', body: JSON.stringify({ dataDir }) }),
  listSessions: () => request<{ sessions: SessionSummary[]; status: string }>('/api/sessions'),
  readSession: (id: string, from?: { offset: number; line: number }) =>
    request<SessionRead>(`/api/sessions/${id}${from ? `?from=${from.offset}&line=${from.line}` : ''}`),
  readSubagent: (id: string, agentId: string) => request<SubagentRead>(`/api/sessions/${id}/subagents/${agentId}`),
  readRaw: (id: string, ref: { file: string; line: number; offset: number; length: number }) =>
    request<{ raw: unknown }>(`/api/sessions/${id}/raw?file=${encodeURIComponent(ref.file)}&line=${ref.line}&offset=${ref.offset}&length=${ref.length}`),
  imageUrl: (id: string, ref: { file: string; line: number; offset: number; length: number }, block: number) =>
    `/api/sessions/${id}/image?file=${encodeURIComponent(ref.file)}&line=${ref.line}&offset=${ref.offset}&length=${ref.length}&block=${block}`,
  search: (q: string) => request<{ query: string; ids: string[] | null }>(`/api/search?q=${encodeURIComponent(q)}`),
  rename: (id: string, name: string) => request<{ ok: true; customName: string; summary: SessionSummary }>(`/api/sessions/${id}/name`, { method: 'PUT', body: JSON.stringify({ name }) }),
  clearName: (id: string) => request<{ ok: true; summary: SessionSummary }>(`/api/sessions/${id}/name`, { method: 'DELETE' }),
  reveal: (id: string) => request<{ ok: true }>(`/api/sessions/${id}/reveal`, { method: 'POST' }),
  /** Fetch an image as a blob (fetch carries the token; <img src> cannot). */
  fetchImage: async (url: string) => {
    const res = await fetch(url, { headers: { 'x-csv-token': token } });
    if (!res.ok) throw new ApiError(res.status, 'image unavailable');
    return URL.createObjectURL(await res.blob());
  },
  /** Server-sent events. EventSource cannot set headers, so the token travels as a query param over loopback only. */
  subscribe: (onEvent: (e: ServerEvent) => void, onState?: (connected: boolean) => void) => {
    const es = new EventSource(`/api/events?token=${token}`);
    es.onmessage = (m) => {
      try {
        onEvent(JSON.parse(m.data));
      } catch {
        /* ignore */
      }
    };
    es.onopen = () => onState?.(true);
    es.onerror = () => onState?.(false);
    return () => es.close();
  },
};
