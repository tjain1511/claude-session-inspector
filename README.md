# Claude Session Inspector

A local, offline "DevTools" for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions.
It reads the transcripts Claude Code already keeps on your machine and shows every session as an
execution timeline: user prompts, Claude's responses, tool calls with their inputs and outputs,
timing, errors, sub-agents, token usage and raw events.

Nothing leaves your machine. There is no cloud, no telemetry, no accounts and no runtime
dependencies beyond Node.js.

## Run it

```sh
npx claude-session-inspector    # opens http://127.0.0.1:4477 in your browser
```

Requires Node.js 20+. Options: `--port 5000`, `--dir /path/to/.claude`, `--no-open`.
If port 4477 is busy and no port was given, the next free port is used.

From a checkout:

```sh
npm install     # dev-only: esbuild, TypeScript, React (bundled into dist/ at build time)
npm run build
npm start
```

For development, `npm run dev` rebuilds on change and serves the same bundle.

## How it works

```
React UI (dist/, bundled, no network)
   ↓ fetch to 127.0.0.1 with a per-launch token
server/index.js            loopback HTTP bridge (Node built-ins only)
   ↓
server/session-source/     SessionSource: discover · listSessions · readSession · watch
   ↓
~/.claude/projects/<cwd>/<session>.jsonl      Claude Code's own transcripts (read-only)
```

### Where sessions live

Claude Code (2.1.x) writes one JSONL file per session:

```
<configDir>/projects/<encoded-cwd>/<session-uuid>.jsonl        the transcript
<configDir>/projects/<encoded-cwd>/<session-uuid>/subagents/    agent-<id>.jsonl + .meta.json
<configDir>/projects/<encoded-cwd>/<session-uuid>/tool-results/ large tool outputs persisted to disk
<configDir>/sessions/<pid>.json                                 registry of running Claude processes
<configDir>/projects/<encoded-cwd>/memory/*.md                  auto-memory notes; MEMORY.md is the index
```

`<configDir>` is `$CLAUDE_CONFIG_DIR` or `~/.claude`. The viewer checks those plus a few OS-specific
locations, and you can point it anywhere from Settings or with `--dir`.

Each transcript line is a JSON record. The viewer understands `user`, `assistant` (text, thinking,
tool_use blocks), `attachment`, `system` (turn durations, API errors, recaps), `ai-title`,
`custom-title`, `cost-state`, `pr-link`, `continued-in` and the housekeeping records. Anything it does
not recognise is kept as an "unknown" event with the raw JSON one click away, so a newer Claude Code
format degrades gracefully rather than breaking the viewer.

The model's context is also in the transcript, as `attachment` records: `prompt_snapshot` (the
system prompt and, in one of the snapshots, the initial tool definitions; written since roughly
Claude Code 2.1.263), `deferred_tools_record` / `deferred_tools_delta` (tools loadable through
ToolSearch), `agent_listing_delta`, `skill_listing`, `mcp_instructions_delta`, `instructions`
(CLAUDE.md and memory files), `environment`, `model`, `output_style`, `auto_mode` and
`command_permissions`. The Context view reads exactly these; sessions from older versions show what
was recorded and say what was not.

### Memory

The Memory view (header button or `M`) shows each project's auto-memory: every note with its front
matter (name, description, type, origin session), the rendered body with `[[links]]` and backlinks,
whether MEMORY.md lists it, and its history — every transcript record that wrote, edited, appended,
deleted, read or loaded it, with what was written and a jump to that tool call. Changes come from
`Write`/`Edit`/`MultiEdit`/`Read` calls on a memory path and from shell commands that touch one
(redirections, heredocs, `sed -i`, scripts); a note named only by its bare file name inside a
command that `cd`s into a memory folder is counted when that note exists. Notes deleted since keep
their history. Memory tool calls carry a chip in the session flow, and sessions that changed memory
show a Memory stat.

### What it never does

- Modify Claude's files. Custom names live in `~/.claude-session-inspector/metadata.json`.
- Expose the filesystem to the UI. The API takes session/agent ids only; every path is resolved from
  the index. Ids are validated; `..` never reaches the disk.
- Accept requests from other origins. The server binds to 127.0.0.1, checks `Host`/`Origin`, and
  requires a random token that only exists in the HTML it serves (so a web page you visit cannot
  read your sessions through localhost).
- Render session content as HTML. Everything is rendered as text through React; the Markdown
  renderer emits elements, never `innerHTML`; a strict Content-Security-Policy blocks inline scripts
  and any remote resource.

## Features

- Overview landing page: sessions running now, sessions with errors, most expensive sessions, cost per
  project and a 14-day activity chart (today / 7 / 30 days)
- Session header: one strip of key numbers (model, duration, turns, tool calls, errors, tokens with cache-hit
  rate, cost, sub-agents); clicking Errors filters the flow, Cost opens the breakdown, Sub-agents opens a
  sortable list of every sub-agent with its model, tools, errors, run time and position on the session's time axis
- Flow filters (All / Messages / Tools / Errors, plus one tool) that keep user prompts as anchors, and an
  error navigator (`[` / `]`) that walks every failed tool call and API error
- Compact density: successful tool calls start as one row with a status glyph and duration; failures and
  running calls stay open. Async Agent calls show how long the sub-agent actually ran
- Long prompts and responses are clipped with "show full", and `<pasted_content>` blocks collapse into
  their own section
- Idle-compressed time bar: long waits for the user are drawn narrow (hatched) so the working time is readable
- Outline rail follows the scroll position; links to individual events (`#session=…&event=…`) from any card;
  session menu with copy ID / link / `claude --resume` command
- Session browser grouped by day with project, model, message/tool/error counts, duration, live status
- Full-text search across prompts, responses, tool names, inputs and outputs (server-side digest,
  ~10 ms for 200 sessions), plus instant local matching on titles and paths
- Filters: time range (incl. custom dates), project, model, and activity chips (tools, errors, long,
  active, sub-agents, renamed)
- Timeline with absolute time, offset from session start and gap since the previous event
- Tool cards pairing each call with its result: duration, status, interrupted/denied flags, structured
  `toolUseResult`, syntax-highlighted input (shell, JSON, Edit diffs, Write file contents)
- Time-distribution bar: where the session's wall-clock went (model, tools, waiting for user)
- Timeline (Gantt) view per user turn: one row per model call and per tool call on a time axis, so
  parallel batches (∥) and overlapping calls are obvious; model bars run from "inputs ready" to the
  last streamed block and mark the first block
- Context view: the system prompt (per part, collapsible), every tool the model was offered with its
  description and input schema and how often the session used it, agent types, skills, MCP server
  instructions, injected CLAUDE.md files and the environment snapshot. Each tool card links to its
  definition; a collapsed "System prompt" card sits at the top of the flow view
- Sub-agent transcripts nested inside their `Agent` tool call
- Metadata drawer: ids, cwd, branch, version, permission modes, token totals, cost, sub-agents, file info
- Raw event inspector for every event (original JSONL record + normalized event)
- Live sessions: filesystem watching, incremental tail reads, auto-follow, "Live" indicator using
  Claude Code's process registry
- Large sessions: windowed rendering, `content-visibility`, truncated outputs with "show more",
  server-side truncation with on-demand full load
- Rename sessions inline (header or list), reset to the generated title, duplicates allowed
- Images: screenshots returned by tools (e.g. browser automation) and images pasted by the user render
  inline, lazily, with a full-size lightbox
- Model attribution: "model changed" markers in the flow, a highlighted chip on any message or sub-agent
  that ran on a different model than the session's main one, and a per-model token/cost table (from
  Claude Code's `cost-state`, including cache read/write tokens) in the overview and metadata drawer
- Cost: recorded from Claude Code's `cost-state` when present; otherwise estimated from token usage
  × an editable $/MTok rate table (Settings → Pricing), clearly marked "≈" / "est.". The default rates
  were derived from the cost records on this machine where available, and taken from the published Claude
  API price list (1-hour cache-write rate) otherwise; Settings shows, per model, how many recorded
  sessions the table reproduces within 1%
- Outline rail (O): one row per user turn with duration split (model/tool), calls, tokens, errors and
  the sub-agents it spawned, so long multi-agent runs and generator/critic loops are navigable
- Collapsible session list (⌘B or the header button)
- Keyboard: ⌘K search, ⌘B toggle list, ⌘R refresh, ⌘F find in session, ↑/↓/Enter/F2 in the list, 1/2/3 switch
  views, J/K events, [/] errors, E expand/collapse, O outline, I details, Esc closes things, `?` shows the full list

## Layout

```
server/                     Node bridge (ESM, no build step)
  index.js                  HTTP server, security checks, API routes, SSE
  discovery.js              locate the Claude data directory
  store.js                  custom names + server settings (~/.claude-session-inspector)
  pricing.js                $/MTok rate table, cost estimates, rate verification against cost-state
  session-source/
    SessionSource.js        interface
    ClaudeSessionSource.js  adapter for Claude Code's on-disk layout
    parser.js               incremental JSONL reader (byte offsets, partial lines)
    summarize.js            reducer → session summary + search digest (cached, resumable)
    normalize.js            raw records → normalized events
    context.js              attachment records → system prompt / tools / agents / skills / instructions
    content.js              text extraction helpers
    cache.js                on-disk summary cache
  test/                     node --test
src/                        React 19 UI (TypeScript, bundled by esbuild)
  app/ components/ features/ services/ hooks/ utils/ types/ styles/
```

## Tests

```sh
npm test        # server: parser, summarizer, normalizer, session source
npm run typecheck
```
