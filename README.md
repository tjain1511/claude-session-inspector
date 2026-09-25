# Claude Session Viewer

A local, offline "DevTools" for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions.
It reads the transcripts Claude Code already keeps on your machine and shows every session as an
execution timeline: user prompts, Claude's responses, tool calls with their inputs and outputs,
timing, errors, sub-agents, token usage and raw events.

Nothing leaves your machine. There is no cloud, no telemetry, no accounts and no runtime
dependencies beyond Node.js.

## Run it

```sh
npm install     # dev-only: esbuild, TypeScript, React (bundled into dist/ at build time)
npm run build
npm start       # opens http://127.0.0.1:4477 in your browser
```

Options: `npm start -- --port 5000`, `--dir /path/to/.claude`, `--no-open`.
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
```

`<configDir>` is `$CLAUDE_CONFIG_DIR` or `~/.claude`. The viewer checks those plus a few OS-specific
locations, and you can point it anywhere from Settings or with `--dir`.

Each transcript line is a JSON record. The viewer understands `user`, `assistant` (text, thinking,
tool_use blocks), `attachment`, `system` (turn durations, API errors, recaps), `ai-title`,
`custom-title`, `cost-state`, `pr-link`, `continued-in` and the housekeeping records. Anything it does
not recognise is kept as an "unknown" event with the raw JSON one click away, so a newer Claude Code
format degrades gracefully rather than breaking the viewer.

### What it never does

- Modify Claude's files. Custom names live in `~/.claude-session-viewer/metadata.json`.
- Expose the filesystem to the UI. The API takes session/agent ids only; every path is resolved from
  the index. Ids are validated; `..` never reaches the disk.
- Accept requests from other origins. The server binds to 127.0.0.1, checks `Host`/`Origin`, and
  requires a random token that only exists in the HTML it serves (so a web page you visit cannot
  read your sessions through localhost).
- Render session content as HTML. Everything is rendered as text through React; the Markdown
  renderer emits elements, never `innerHTML`; a strict Content-Security-Policy blocks inline scripts
  and any remote resource.

## Features

- Session browser grouped by day with project, model, message/tool/error counts, duration, live status
- Full-text search across prompts, responses, tool names, inputs and outputs (server-side digest,
  ~10 ms for 200 sessions), plus instant local matching on titles and paths
- Filters: time range (incl. custom dates), project, model, and activity chips (tools, errors, long,
  active, sub-agents, renamed)
- Timeline with absolute time, offset from session start and gap since the previous event
- Tool cards pairing each call with its result: duration, status, interrupted/denied flags, structured
  `toolUseResult`, syntax-highlighted input (shell, JSON, Edit diffs, Write file contents)
- Time-distribution bar: where the session's wall-clock went (model, tools, waiting for user)
- Sub-agent transcripts nested inside their `Agent` tool call
- Metadata drawer: ids, cwd, branch, version, permission modes, token totals, cost, sub-agents, file info
- Raw event inspector for every event (original JSONL record + normalized event)
- Live sessions: filesystem watching, incremental tail reads, auto-follow, "Live" indicator using
  Claude Code's process registry
- Large sessions: windowed rendering, `content-visibility`, truncated outputs with "show more",
  server-side truncation with on-demand full load
- Rename sessions inline (header or list), reset to the generated title, duplicates allowed
- Keyboard: ⌘K search, ⌘R refresh, ⌘F find in session, ↑/↓/Enter/F2 in the list, J/K/E/I in the
  timeline, Esc closes things, `?` shows the full list

## Layout

```
server/                     Node bridge (ESM, no build step)
  index.js                  HTTP server, security checks, API routes, SSE
  discovery.js              locate the Claude data directory
  store.js                  custom names + server settings (~/.claude-session-viewer)
  session-source/
    SessionSource.js        interface
    ClaudeSessionSource.js  adapter for Claude Code's on-disk layout
    parser.js               incremental JSONL reader (byte offsets, partial lines)
    summarize.js            reducer → session summary + search digest (cached, resumable)
    normalize.js            raw records → normalized events
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
