// "Context" view: what the model was given besides the conversation — the system prompt,
// tool definitions, agent types, skills, MCP instructions, CLAUDE.md files and the
// environment. Everything comes from attachment records in the transcript; nothing is
// reconstructed. Tool/agent/skill rows show how often this session actually used them.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CtxTool, SessionContext, SessionEvent, SessionSummary } from '@/types/session';
import { Card } from '@/components/Timeline/Card';
import { CodeBlock } from '@/components/CodeBlock/CodeBlock';
import { CopyButton } from '@/components/common/CopyButton';
import { Icon } from '@/components/common/Icon';
import { formatClock, formatDateTime, formatNumber } from '@/utils/format';
import { prettyJson } from '@/utils/highlight';
import { firstLine } from '@/utils/events';
import type { ContextTab } from './ToolDocs';

export interface Usage {
  tools: Map<string, number>;
  agents: Map<string, number>;
  skills: Map<string, number>;
}

/** Count tool / agent-type / skill usage from the session's events. */
export function computeUsage(events: SessionEvent[]): Usage {
  const tools = new Map<string, number>();
  const agents = new Map<string, number>();
  const skills = new Map<string, number>();
  const bump = (m: Map<string, number>, k: unknown) => {
    if (typeof k !== 'string' || !k) return;
    m.set(k, (m.get(k) || 0) + 1);
  };
  for (const e of events) {
    if (e.type !== 'tool_call') continue;
    bump(tools, e.tool);
    const input = e.input && typeof e.input === 'object' ? (e.input as Record<string, unknown>) : null;
    if (e.tool === 'Agent') bump(agents, input?.subagent_type ?? 'general-purpose');
    if (e.tool === 'Skill') bump(skills, input?.skill);
  }
  return { tools, agents, skills };
}

function sectionTitle(part: string, i: number): string {
  const t = part.trim();
  if (!t) return `Section ${i + 1} (empty)`;
  if (/^__[A-Z_]+__$/.test(t)) return t;
  const first = firstLine(t).replace(/^#+\s*/, '');
  return first.length > 90 ? first.slice(0, 90) + '…' : first;
}

/** The system prompt as one collapsible section per recorded part. */
export function PromptSections({ parts, initiallyOpen = false }: { parts: string[]; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState<Set<number>>(() => new Set(initiallyOpen ? parts.map((_, i) => i) : []));
  const toggle = (i: number) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(i)) n.delete(i);
    else n.add(i);
    return n;
  });
  const all = open.size === parts.length;
  return (
    <div className="ctx-sections">
      <div className="ctx-sections-bar">
        <span className="help-text">{parts.length} parts · {formatNumber(parts.reduce((n, p) => n + p.length, 0))} chars</span>
        <span className="grow" />
        <button type="button" className="btn ghost sm" onClick={() => setOpen(all ? new Set() : new Set(parts.map((_, i) => i)))}>{all ? 'Collapse all' : 'Expand all'}</button>
        <CopyButton text={parts.join('\n\n')} label="Copy system prompt" />
      </div>
      {parts.map((p, i) => {
        const marker = /^__[A-Z_]+__$/.test(p.trim());
        if (marker) return <div key={i} className="ctx-marker" title="Marker string recorded verbatim in the prompt snapshot">{p.trim()}</div>;
        const isOpen = open.has(i);
        return (
          <div key={i} className={`ctx-section ${isOpen ? 'open' : ''}`}>
            <button type="button" className="ctx-section-head" onClick={() => toggle(i)} aria-expanded={isOpen}>
              <Icon name="chevron" size={11} className="chev" />
              <span className="idx">{i + 1}</span>
              <span className="ttl">{sectionTitle(p, i)}</span>
              <span className="len">{formatNumber(p.length)} chars</span>
            </button>
            {isOpen && <pre className="ctx-pre">{p}</pre>}
          </div>
        );
      })}
    </div>
  );
}

function mcpServer(name: string): string | null {
  const m = name.match(/^mcp__([^_].*?)__/);
  return m ? m[1]! : null;
}

function ToolRow({ t, used, focused }: { t: CtxTool; used: number; focused: boolean }) {
  const [open, setOpen] = useState(focused);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) {
      setOpen(true);
      ref.current?.scrollIntoView({ block: 'center' });
    }
  }, [focused]);
  const server = mcpServer(t.name);
  const summary = t.description ? firstLine(t.description) : '';
  return (
    <div ref={ref} className={`ctx-row ${open ? 'open' : ''} ${focused ? 'focused' : ''} ${used ? 'used' : ''}`}>
      <button type="button" className="ctx-row-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Icon name="chevron" size={11} className="chev" />
        <span className="name mono">{t.name}</span>
        {used > 0 && <span className="chip tool" title="Calls in this session">used ×{used}</span>}
        {t.deferred && <span className="chip" title="Loaded on demand through ToolSearch; not in the initial tool list">deferred</span>}
        {server && <span className="chip" title="MCP server">{server}</span>}
        <span className="desc">{summary || <em>definition not recorded — deferred tool that was never loaded in this session</em>}</span>
        <span className="at help-text" title={t.ts ? formatDateTime(t.ts) : ''}>line {t.line}</span>
      </button>
      {open && (
        <div className="ctx-row-body">
          {t.description ? <pre className="ctx-pre">{t.description}</pre> : <div className="help-text">Only the tool name reached the model until it was loaded; its description and schema were never written to this transcript.</div>}
          {t.schema != null && (
            <details className="ctx-details">
              <summary>Input schema</summary>
              <CodeBlock code={prettyJson(t.schema)} lang="json" initialLines={80} compact />
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function ListedRows({ items, used, focus, usedLabel }: { items: { name: string; description: string; removed?: boolean; line?: number }[]; used: Map<string, number>; focus?: string; usedLabel: string }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(focus ? [focus] : []));
  const toggle = (n: string) => setOpen((s) => {
    const x = new Set(s);
    if (x.has(n)) x.delete(n);
    else x.add(n);
    return x;
  });
  return (
    <div className="ctx-list">
      {items.map((it) => {
        const isOpen = open.has(it.name);
        const n = used.get(it.name) || 0;
        return (
          <div key={it.name} className={`ctx-row ${isOpen ? 'open' : ''} ${n ? 'used' : ''} ${focus === it.name ? 'focused' : ''}`}>
            <button type="button" className="ctx-row-head" onClick={() => toggle(it.name)} aria-expanded={isOpen}>
              <Icon name="chevron" size={11} className="chev" />
              <span className="name mono">{it.name}</span>
              {n > 0 && <span className="chip tool">{usedLabel} ×{n}</span>}
              {it.removed && <span className="chip warn">removed later</span>}
              <span className="desc">{firstLine(it.description) || <em>no description recorded</em>}</span>
            </button>
            {isOpen && <div className="ctx-row-body"><pre className="ctx-pre">{it.description || '(no description recorded)'}</pre></div>}
          </div>
        );
      })}
      {!items.length && <div className="help-text" style={{ padding: 12 }}>Nothing recorded in this transcript.</div>}
    </div>
  );
}

function KV({ rows }: { rows: [string, unknown][] }) {
  return (
    <div className="ctx-kv">
      {rows.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => (
        <div key={k} className="ctx-kv-row">
          <span className="k">{k}</span>
          <span className="v mono">{typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
        </div>
      ))}
    </div>
  );
}

interface Props {
  session: SessionSummary;
  ctx: SessionContext | null;
  loading: boolean;
  error: string | null;
  events: SessionEvent[];
  tab: ContextTab;
  setTab: (t: ContextTab) => void;
  focus?: string;
}

export function ContextView({ session: s, ctx, loading, error, events, tab, setTab, focus }: Props) {
  const usage = useMemo(() => computeUsage(events), [events]);
  const [toolFilter, setToolFilter] = useState('');
  const [toolScope, setToolScope] = useState<'all' | 'used' | 'loaded'>('all');

  if (error) return <div className="state-panel"><div className="state-card"><h2>Could not load context</h2><p className="error-text">{error}</p></div></div>;
  if (!ctx) return <div className="help-text" style={{ padding: 20 }}>{loading ? 'Loading context…' : 'No context loaded.'}</div>;

  const undocumented = [...usage.tools.keys()].filter((n) => !ctx.tools.some((t) => t.name === n)).sort();
  const usedCount = ctx.tools.filter((t) => usage.tools.has(t.name)).length;
  // Used tools first (most-called on top), then the rest alphabetically.
  const tools = [...ctx.tools].sort((a, b) => (usage.tools.get(b.name) || 0) - (usage.tools.get(a.name) || 0) || a.name.localeCompare(b.name)).filter((t) => {
    if (toolScope === 'used' && !usage.tools.has(t.name)) return false;
    if (toolScope === 'loaded' && !t.description) return false;
    if (toolFilter && !`${t.name} ${t.description}`.toLowerCase().includes(toolFilter.toLowerCase())) return false;
    return true;
  });
  const tabs: { id: ContextTab; label: string; count: string | number | null }[] = [
    { id: 'prompt', label: 'System prompt', count: ctx.systemPrompt ? ctx.systemPrompt.parts.length : '—' },
    { id: 'tools', label: 'Tools', count: ctx.tools.length },
    { id: 'agents', label: 'Agent types', count: ctx.agents.length },
    { id: 'skills', label: 'Skills', count: ctx.skills ? ctx.skills.items.length : 0 },
    { id: 'mcp', label: 'MCP servers', count: ctx.mcp.length },
    { id: 'instructions', label: 'Instructions', count: ctx.instructions.length },
    { id: 'environment', label: 'Environment', count: null },
  ];

  return (
    <div className="ctx">
      <nav className="ctx-nav" aria-label="Context sections">
        {tabs.map((t) => (
          <button key={t.id} type="button" className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            <span>{t.label}</span>
            {t.count !== null && <span className="cnt">{t.count}</span>}
          </button>
        ))}
        <div className="ctx-nav-note help-text">
          Read from attachment records in the transcript.
          {!ctx.recorded && <> This session (Claude Code v{s.version || '?'}) did not record a prompt snapshot; listings are still shown when present.</>}
        </div>
      </nav>
      <div className="ctx-body">
        {tab === 'prompt' && (
          <>
            <div className="ctx-head">
              <h3>System prompt</h3>
              {ctx.systemPrompt ? (
                <div className="ctx-facts">
                  <span title={formatDateTime(ctx.systemPrompt.ts)}>recorded {ctx.systemPrompt.ts ? formatClock(ctx.systemPrompt.ts) : ''} · line {ctx.systemPrompt.line}</span>
                  {ctx.systemPrompt.cliPrefix && <span title="Prefix Claude Code prepends to the prompt">{ctx.systemPrompt.cliPrefix}</span>}
                  <span>{ctx.snapshots.length} snapshot{ctx.snapshots.length === 1 ? '' : 's'} in the transcript{ctx.promptChanged ? ' · prompt changed during the session' : ' · identical'}</span>
                  {Object.entries(ctx.systemPrompt.flags).map(([k, v]) => <span key={k} className="mono">{k}: {String(v)}</span>)}
                </div>
              ) : (
                <p className="help-text">No <code>prompt_snapshot</code> attachment in this transcript, so the exact system prompt text is not available for this session. Claude Code started writing it around v2.1.263; this session ran v{s.version || '?'}.</p>
              )}
            </div>
            {ctx.systemPrompt && <PromptSections parts={ctx.systemPrompt.parts} />}
          </>
        )}
        {tab === 'tools' && (
          <>
            <div className="ctx-head">
              <h3>Tools offered to the model</h3>
              <p className="help-text">The model picks a tool from these names and descriptions. Deferred tools are announced by name only and loaded through ToolSearch when needed.</p>
              <div className="ctx-toolbar">
                <input className="input" placeholder="Filter tools…" value={toolFilter} onChange={(e) => setToolFilter(e.target.value)} aria-label="Filter tools" />
                <div className="radio-row">
                  <button type="button" className={toolScope === 'all' ? 'on' : ''} onClick={() => setToolScope('all')}>All {ctx.tools.length}</button>
                  <button type="button" className={toolScope === 'used' ? 'on' : ''} onClick={() => setToolScope('used')}>Used {usedCount}</button>
                  <button type="button" className={toolScope === 'loaded' ? 'on' : ''} onClick={() => setToolScope('loaded')}>With definition {ctx.tools.filter((t) => t.description).length}</button>
                </div>
              </div>
            </div>
            <div className="ctx-list">
              {tools.map((t) => <ToolRow key={t.name} t={t} used={usage.tools.get(t.name) || 0} focused={focus === t.name} />)}
              {!tools.length && <div className="help-text" style={{ padding: 12 }}>No tools match.</div>}
            </div>
            {undocumented.length > 0 && (
              <div className="ctx-note">
                <strong>Called without a recorded definition:</strong> {undocumented.map((n) => <span key={n} className="chip" style={{ marginRight: 4 }}>{n} ×{usage.tools.get(n)}</span>)}
                <div className="help-text">These tools were used, but this transcript has no record of their descriptions (older Claude Code versions did not write them).</div>
              </div>
            )}
          </>
        )}
        {tab === 'agents' && (
          <>
            <div className="ctx-head">
              <h3>Agent types for the Agent tool</h3>
              <p className="help-text">Sub-agent types announced to the model, with the description it chose from. Counts are Agent calls with that <code>subagent_type</code>.</p>
            </div>
            <ListedRows items={ctx.agents} used={usage.agents} focus={focus} usedLabel="spawned" />
          </>
        )}
        {tab === 'skills' && (
          <>
            <div className="ctx-head">
              <h3>Skills for the Skill tool</h3>
              <p className="help-text">{ctx.skills ? `${ctx.skills.count} skills listed` : 'No skill listing recorded.'}{ctx.skills?.ts ? ` · recorded ${formatClock(ctx.skills.ts)} · line ${ctx.skills.line}` : ''}</p>
            </div>
            <ListedRows items={ctx.skills?.items ?? []} used={usage.skills} focus={focus} usedLabel="invoked" />
          </>
        )}
        {tab === 'mcp' && (
          <>
            <div className="ctx-head">
              <h3>MCP server instructions</h3>
              <p className="help-text">Instructions each connected MCP server added to the model's context.</p>
            </div>
            <div className="ctx-list">
              {ctx.mcp.map((m) => (
                <div key={m.name} className="ctx-row open">
                  <div className="ctx-row-head static"><span className="name mono">{m.name}</span><span className="chip">{ctx.tools.filter((t) => mcpServer(t.name) === m.name).length} tools</span><span className="at help-text">line {m.line}</span></div>
                  <div className="ctx-row-body"><pre className="ctx-pre">{m.block || '(no instructions text)'}</pre></div>
                </div>
              ))}
              {!ctx.mcp.length && <div className="help-text" style={{ padding: 12 }}>No MCP instructions recorded.</div>}
            </div>
          </>
        )}
        {tab === 'instructions' && (
          <>
            <div className="ctx-head">
              <h3>Project and user instructions</h3>
              <p className="help-text">CLAUDE.md, memory and rule files that were injected into the context.</p>
            </div>
            <div className="ctx-list">
              {ctx.instructions.map((f) => (
                <div key={f.path} className="ctx-row open">
                  <div className="ctx-row-head static"><span className="name mono" title={f.path}>{f.display || f.path}</span><span className="chip">{f.kind}</span><span className="at help-text">line {f.line}</span></div>
                  <div className="ctx-row-body"><CodeBlock code={f.content} lang="markdown" initialLines={60} compact /></div>
                </div>
              ))}
              {!ctx.instructions.length && <div className="help-text" style={{ padding: 12 }}>No instruction files were recorded for this session.</div>}
            </div>
          </>
        )}
        {tab === 'environment' && (
          <>
            <div className="ctx-head"><h3>Environment</h3></div>
            {ctx.environment && <><h4 className="ctx-h4">Environment snapshot</h4><KV rows={Object.entries(ctx.environment).filter(([k]) => !['line', 'offset', 'length', 'ts'].includes(k))} /></>}
            {ctx.model && <><h4 className="ctx-h4">Model identity</h4><KV rows={[['modelId', ctx.model.modelId], ['marketingName', ctx.model.marketingName], ['knowledgeCutoff', ctx.model.knowledgeCutoff], ['text', ctx.model.text]]} /></>}
            {ctx.outputStyle && <><h4 className="ctx-h4">Output style</h4><KV rows={[['style', ctx.outputStyle.style]]} /></>}
            {ctx.autoMode && <><h4 className="ctx-h4">Auto mode</h4><KV rows={Object.entries(ctx.autoMode).filter(([k]) => !['line', 'offset', 'length', 'ts'].includes(k))} /></>}
            {ctx.allowedTools && <><h4 className="ctx-h4">Allowed tools (command permissions)</h4><div className="ctx-chips">{ctx.allowedTools.allowedTools.map((t) => <span key={t} className="chip mono">{t}</span>)}</div></>}
            {ctx.sessionContext && <><h4 className="ctx-h4">Session context</h4><KV rows={Object.entries(ctx.sessionContext.context)} /></>}
            {ctx.dates.length > 0 && <><h4 className="ctx-h4">Dates announced</h4><div className="ctx-chips">{ctx.dates.map((d) => <span key={d} className="chip mono">{d}</span>)}</div></>}
            <h4 className="ctx-h4">Attachment records in this transcript</h4>
            <div className="ctx-chips">{ctx.attachmentTypes.map((a) => <span key={a.type} className="chip mono">{a.type} ×{a.count}</span>)}</div>
          </>
        )}
      </div>
    </div>
  );
}

/** Compact card shown at the top of the flow view. */
export function ContextCard({ session: s, ctx, loading, onOpen }: { session: SessionSummary; ctx: SessionContext | null; loading: boolean; onOpen: (tab: ContextTab) => void }) {
  if (!ctx) {
    return (
      <div className="event type-context">
        <div className="gutter" />
        <div className="body"><div className="card type-context"><div className="card-head static"><span className="role">System prompt</span><span className="desc help-text">{loading ? 'loading…' : 'unavailable'}</span></div></div></div>
      </div>
    );
  }
  const sp = ctx.systemPrompt;
  const chips = (
    <>
      <button type="button" className="chip tool" onClick={(e) => { e.stopPropagation(); onOpen('tools'); }} title="Open the tool list">{ctx.tools.length} tools</button>
      {ctx.agents.length > 0 && <button type="button" className="chip" onClick={(e) => { e.stopPropagation(); onOpen('agents'); }}>{ctx.agents.length} agent types</button>}
      {ctx.skills && <button type="button" className="chip" onClick={(e) => { e.stopPropagation(); onOpen('skills'); }}>{ctx.skills.items.length} skills</button>}
      {ctx.instructions.length > 0 && <button type="button" className="chip" onClick={(e) => { e.stopPropagation(); onOpen('instructions'); }}>{ctx.instructions.length} instruction files</button>}
    </>
  );
  return (
    <div className="event type-context" data-event-id="context">
      <div className="gutter">
        {sp?.ts && <div className="abs">{formatClock(sp.ts)}</div>}
        <div className="marker" />
      </div>
      <div className="body">
        <Card
          type="context"
          role="System prompt"
          title={sp ? `${sp.parts.length} parts · ${formatNumber(sp.chars)} chars` : 'not recorded'}
          desc={sp ? firstLine(sp.parts.find((p) => p.trim() && !/^__[A-Z_]+__$/.test(p.trim())) || '') : `Claude Code v${s.version || '?'} did not write prompt snapshots`}
          defaultOpen={false}
          right={chips}
          copyText={sp ? sp.parts.join('\n\n') : undefined}
          summary={sp ? <span className="help-text">{sp.cliPrefix ? `${sp.cliPrefix} · ` : ''}click to read the prompt the model ran with, or open the full <button type="button" className="link" onClick={() => onOpen('prompt')}>Context view</button></span> : <span className="help-text">Tool, agent and skill listings are still available in the <button type="button" className="link" onClick={() => onOpen('tools')}>Context view</button>.</span>}
        >
          {sp ? (
            <>
              <div className="ctx-facts" style={{ marginBottom: 8 }}>
                {sp.cliPrefix && <span>{sp.cliPrefix}</span>}
                <span>line {sp.line}</span>
                {ctx.promptChanged && <span className="chip warn">changed later in the session</span>}
                <button type="button" className="btn ghost sm" onClick={() => onOpen('prompt')}>Open in Context view</button>
              </div>
              <PromptSections parts={sp.parts} />
            </>
          ) : (
            <div className="help-text">No prompt snapshot in this transcript. <button type="button" className="link" onClick={() => onOpen('tools')}>See what was recorded</button>.</div>
          )}
        </Card>
      </div>
    </div>
  );
}
