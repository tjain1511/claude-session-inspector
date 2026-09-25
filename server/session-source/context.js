// Extracts the "model context" a session ran with, from the attachment records Claude Code
// writes into the transcript (observed in 2.1.263+ for prompt snapshots; listings exist in
// earlier 2.1.x too). Nothing here is synthesised: every field maps to a record on disk and
// carries the line it came from so the raw inspector can show the original.
//
//   prompt_snapshot        { systemPrompt: string[], cliPrefix?, tools?: [{name, description, schema}], ...flags }
//   deferred_tools_record  { entries: [{name, description, input_schema, defer_loading}] }
//   deferred_tools_delta   { addedNames, removedNames, surfacedNames, failedMcpServers, pendingMcpServers }
//   agent_listing_delta    { addedTypes, addedLines, removedTypes, isInitial }
//   skill_listing          { content, names, skillCount }
//   mcp_instructions_delta { addedNames, addedBlocks, removedNames }
//   instructions           { files: [{path, type, content}] }        (CLAUDE.md, memory, rules)
//   nested_memory          { path, displayPath, content: {path, type, content} }
//   environment            { snapshot }   model { identity, text }   output_style { style }
//   auto_mode              { ...flags }   command_permissions { allowedTools }   session_context { context }

const MAX_TEXT = 256 * 1024;

function clip(s) {
  if (typeof s !== 'string') return s == null ? '' : String(s);
  return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + `\n… [truncated, ${s.length} chars]` : s;
}

function parseListing(lines) {
  // "- name: description" lines as emitted by the agent/skill listings
  const out = [];
  for (const raw of lines || []) {
    const line = String(raw);
    const m = line.match(/^\s*-\s*([^:]+?):\s*([\s\S]*)$/);
    if (m) out.push({ name: m[1].trim(), description: m[2].trim() });
    else if (line.trim()) out.push({ name: line.trim(), description: '' });
  }
  return out;
}

export function createContextState() {
  return {
    snapshots: [], // {line, ts, chars, parts, hasTools, toolCount, sidechain}
    systemPrompt: null, // {parts:[], cliPrefix, line, ts, flags}
    promptChanged: false,
    tools: new Map(), // name -> {name, description, schema, deferred, line, ts}
    deferredNames: new Set(),
    toolDeltas: [], // {line, ts, added, removed, surfaced, failedMcp, pendingMcp}
    agents: new Map(), // type -> {name, description, line, removed}
    agentEvents: 0,
    skills: null, // {names, items, count, line, ts}
    mcp: new Map(), // server -> {name, block, line}
    instructions: new Map(), // path -> {path, type, content, line}
    environment: null,
    model: null,
    outputStyle: null,
    autoMode: null,
    allowedTools: null,
    sessionContext: null,
    dates: new Set(),
    attachmentTypes: new Map(),
  };
}

export function reduceContext(state, rec) {
  const o = rec.obj;
  if (!o || o.type !== 'attachment' || !o.attachment || typeof o.attachment !== 'object') return;
  const a = o.attachment;
  const t = a.type;
  state.attachmentTypes.set(t, (state.attachmentTypes.get(t) || 0) + 1);
  const at = { line: rec.line, offset: rec.offset, length: rec.length, ts: typeof o.timestamp === 'string' ? o.timestamp : null };
  switch (t) {
    case 'prompt_snapshot': {
      const parts = Array.isArray(a.systemPrompt) ? a.systemPrompt.filter((p) => typeof p === 'string') : typeof a.systemPrompt === 'string' ? [a.systemPrompt] : [];
      const chars = parts.reduce((n, p) => n + p.length, 0);
      const tools = Array.isArray(a.tools) ? a.tools : null;
      state.snapshots.push({ ...at, chars, parts: parts.length, hasTools: !!tools, toolCount: tools ? tools.length : 0, sidechain: !!o.isSidechain });
      if (!state.systemPrompt) {
        const flags = {};
        for (const [k, v] of Object.entries(a)) if (!['type', 'systemPrompt', 'tools', 'cliPrefix'].includes(k) && (typeof v !== 'object' || v == null)) flags[k] = v;
        state.systemPrompt = { parts: parts.map(clip), cliPrefix: typeof a.cliPrefix === 'string' ? a.cliPrefix : null, ...at, chars, flags };
      } else if (chars !== state.systemPrompt.chars || parts.length !== state.systemPrompt.parts.length) {
        state.promptChanged = true;
      }
      if (tools) {
        for (const tl of tools) {
          if (!tl || typeof tl !== 'object' || typeof tl.name !== 'string') continue;
          const prev = state.tools.get(tl.name);
          if (prev && prev.description) continue;
          state.tools.set(tl.name, { name: tl.name, description: clip(tl.description || ''), schema: tl.schema ?? tl.input_schema ?? null, deferred: false, ...at });
        }
      }
      break;
    }
    case 'deferred_tools_record': {
      for (const e of Array.isArray(a.entries) ? a.entries : []) {
        if (!e || typeof e.name !== 'string') continue;
        state.deferredNames.add(e.name);
        const prev = state.tools.get(e.name);
        if (prev && prev.description) {
          prev.deferred = prev.deferred || e.defer_loading !== false;
          continue;
        }
        state.tools.set(e.name, { name: e.name, description: clip(e.description || ''), schema: e.input_schema ?? null, deferred: e.defer_loading !== false, ...at });
      }
      break;
    }
    case 'deferred_tools_delta': {
      const added = Array.isArray(a.addedNames) ? a.addedNames.filter((x) => typeof x === 'string') : [];
      const removed = Array.isArray(a.removedNames) ? a.removedNames.filter((x) => typeof x === 'string') : [];
      const surfaced = Array.isArray(a.surfacedNames) ? a.surfacedNames.filter((x) => typeof x === 'string') : [];
      for (const n of added) {
        state.deferredNames.add(n);
        if (!state.tools.has(n)) state.tools.set(n, { name: n, description: '', schema: null, deferred: true, ...at });
      }
      state.toolDeltas.push({ ...at, added: added.length, removed: removed.length, surfaced: surfaced.length, removedNames: removed.slice(0, 200), failedMcp: a.failedMcpServers || [], pendingMcp: a.pendingMcpServers || [] });
      break;
    }
    case 'agent_listing_delta': {
      state.agentEvents++;
      const items = parseListing(a.addedLines);
      const types = Array.isArray(a.addedTypes) ? a.addedTypes : [];
      for (let i = 0; i < Math.max(items.length, types.length); i++) {
        const name = types[i] || items[i]?.name;
        if (!name) continue;
        state.agents.set(name, { name, description: items[i]?.description || '', ...at, removed: false });
      }
      for (const r of Array.isArray(a.removedTypes) ? a.removedTypes : []) {
        const e = state.agents.get(r);
        if (e) e.removed = true;
      }
      break;
    }
    case 'skill_listing': {
      const content = typeof a.content === 'string' ? a.content : '';
      const items = parseListing(content.split('\n'));
      state.skills = { names: Array.isArray(a.names) ? a.names : items.map((i) => i.name), items, count: a.skillCount ?? items.length, ...at };
      break;
    }
    case 'mcp_instructions_delta': {
      const names = Array.isArray(a.addedNames) ? a.addedNames : [];
      const blocks = Array.isArray(a.addedBlocks) ? a.addedBlocks : [];
      names.forEach((n, i) => state.mcp.set(String(n), { name: String(n), block: clip(blocks[i] || ''), ...at }));
      for (const r of Array.isArray(a.removedNames) ? a.removedNames : []) state.mcp.delete(String(r));
      break;
    }
    case 'instructions': {
      for (const f of Array.isArray(a.files) ? a.files : []) {
        if (!f || typeof f.path !== 'string') continue;
        state.instructions.set(f.path, { path: f.path, kind: f.type || 'instructions', content: clip(f.content || ''), ...at });
      }
      break;
    }
    case 'nested_memory': {
      const c = a.content && typeof a.content === 'object' ? a.content : { content: a.content };
      const p = a.path || c.path;
      if (typeof p === 'string') state.instructions.set(p, { path: p, kind: c.type || 'nested', content: clip(c.content || ''), display: a.displayPath || null, ...at });
      break;
    }
    case 'environment':
      if (!state.environment && a.snapshot && typeof a.snapshot === 'object') state.environment = { ...a.snapshot, ...at };
      break;
    case 'model':
      if (!state.model) state.model = { ...(a.identity && typeof a.identity === 'object' ? a.identity : {}), text: typeof a.text === 'string' ? a.text : typeof a.model === 'string' ? a.model : null, ...at };
      break;
    case 'output_style':
      state.outputStyle = { style: a.style ?? null, ...at };
      break;
    case 'auto_mode': {
      const flags = {};
      for (const [k, v] of Object.entries(a)) if (k !== 'type' && (typeof v !== 'object' || v == null)) flags[k] = v;
      state.autoMode = { ...flags, ...at };
      break;
    }
    case 'command_permissions':
      state.allowedTools = { allowedTools: Array.isArray(a.allowedTools) ? a.allowedTools.map(String) : [], ...at };
      break;
    case 'session_context':
      state.sessionContext = { context: a.context && typeof a.context === 'object' ? a.context : {}, ...at };
      break;
    case 'date':
      if (a.date) state.dates.add(String(a.date));
      break;
    default:
      break;
  }
}

export function contextFromState(state) {
  const tools = [...state.tools.values()].sort((x, y) => x.name.localeCompare(y.name));
  return {
    recorded: !!state.systemPrompt,
    systemPrompt: state.systemPrompt,
    promptChanged: state.promptChanged,
    snapshots: state.snapshots,
    tools,
    toolDeltas: state.toolDeltas,
    agents: [...state.agents.values()],
    skills: state.skills,
    mcp: [...state.mcp.values()],
    instructions: [...state.instructions.values()],
    environment: state.environment,
    model: state.model,
    outputStyle: state.outputStyle,
    autoMode: state.autoMode,
    allowedTools: state.allowedTools,
    sessionContext: state.sessionContext,
    dates: [...state.dates],
    attachmentTypes: [...state.attachmentTypes.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
  };
}

/** Convenience: build a context from an array of parsed records. */
export function extractContext(records) {
  const st = createContextState();
  for (const r of records) {
    try {
      reduceContext(st, r);
    } catch {
      /* a malformed attachment must not break the whole context */
    }
  }
  return contextFromState(st);
}
