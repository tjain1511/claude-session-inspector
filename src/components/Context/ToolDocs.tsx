// Tool descriptions (from the session's recorded tool definitions) made available to
// tool-call cards so a call can show what the model was told about that tool.
import { createContext, useContext } from 'react';
import type { CtxTool } from '@/types/session';

export const ToolDocsContext = createContext<Map<string, CtxTool>>(new Map());

export function useToolDoc(name: string | undefined): CtxTool | undefined {
  const docs = useContext(ToolDocsContext);
  return name ? docs.get(name) : undefined;
}

export type ContextTab = 'prompt' | 'tools' | 'agents' | 'skills' | 'mcp' | 'instructions' | 'environment';

/** Ask the session viewer to open the Context view on a tab (optionally focused on one entry). */
export function openContext(tab: ContextTab, focus?: string) {
  window.dispatchEvent(new CustomEvent('csv:context', { detail: { tab, focus } }));
}
