// Helpers for Claude Code's auto-memory notes (<projects>/<encoded-cwd>/memory/*.md).
import { createContext, useContext } from 'react';
import type { MemoryNote, MemoryOpKind, MemoryOpSummary, SessionSummary } from '@/types/session';

export interface MemoryRef {
  project: string;
  file: string;
}

/** Memory notes each tool call touched (tool_use id -> notes), from the server's verified session summary. */
export const MemoryByToolContext = createContext<Map<string, MemoryRef[]>>(new Map());
export const useMemoryByTool = () => useContext(MemoryByToolContext);

export function memoryByTool(s: SessionSummary): Map<string, MemoryRef[]> {
  const m = new Map<string, MemoryRef[]>();
  for (const o of sessionMemoryOps(s)) {
    if (!o.toolUseId) continue;
    const list = m.get(o.toolUseId) ?? [];
    if (!list.some((r) => r.project === o.project && r.file === o.file)) list.push({ project: o.project, file: o.file });
    m.set(o.toolUseId, list);
  }
  return m;
}

/** Ask the app to show the Memory view, optionally focused on one note. */
export function openMemory(ref?: Partial<MemoryRef>) {
  window.dispatchEvent(new CustomEvent('csv:memory', { detail: ref ?? {} }));
}

export const CHANGE_OPS: ReadonlySet<MemoryOpKind> = new Set(['write', 'append', 'edit', 'delete']);

export const OP_LABEL: Record<MemoryOpKind, string> = {
  write: 'Wrote',
  append: 'Appended',
  edit: 'Edited',
  delete: 'Deleted',
  read: 'Read',
  loaded: 'Loaded',
};

export const NOTE_TYPES = ['user', 'feedback', 'project', 'reference'] as const;

function meta(n: MemoryNote): Record<string, unknown> {
  const fm = n.frontmatter ?? {};
  const m = fm.metadata;
  return m && typeof m === 'object' ? (m as Record<string, unknown>) : {};
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Notes written by different Claude Code versions keep `type` either at the top level or under metadata. */
export function noteType(n: MemoryNote): string | null {
  return str(meta(n).type) ?? str(n.frontmatter?.type);
}
export function noteName(n: MemoryNote): string {
  return str(n.frontmatter?.name) ?? n.file.replace(/\.md$/, '');
}
export function noteDescription(n: MemoryNote): string | null {
  return str(n.frontmatter?.description);
}
export function noteOrigin(n: MemoryNote): string | null {
  return str(meta(n).originSessionId) ?? str(n.frontmatter?.originSessionId);
}
export function noteModified(n: MemoryNote): string | null {
  return str(meta(n).modified) ?? n.mtime;
}

/** Every memory op a session made, main transcript and sub-agents, oldest first. */
export function sessionMemoryOps(s: SessionSummary): (MemoryOpSummary & { agentId: string | null })[] {
  const out = (s.memory ?? []).map((o) => ({ ...o, agentId: null as string | null }));
  for (const a of s.subagents) for (const o of a.memory ?? []) out.push({ ...o, agentId: a.agentId });
  return out.sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
}
