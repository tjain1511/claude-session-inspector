// Analyzer: deterministic metrics, inefficiency detection and derived scores.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzeSession, compactAnalysis, classifyCommand, testOutcome, buildOutcome, ANALYSIS_VERSION } from '../session-source/analyze.js';
import { ClaudeSessionSource } from '../session-source/ClaudeSessionSource.js';
import { SummaryCache } from '../session-source/cache.js';
import { MetadataStore } from '../store.js';

const SID = '11111111-2222-4333-8444-555555555555';

/** Tiny transcript builder: records with increasing timestamps, tool calls paired with results. */
function script() {
  const recs = [];
  let t = Date.parse('2026-01-01T10:00:00.000Z');
  let n = 0;
  const base = () => ({ parentUuid: null, isSidechain: false, cwd: '/p', sessionId: SID, version: '2.1.0', gitBranch: 'main' });
  const push = (o, dt = 1000) => {
    t += dt;
    recs.push({ line: ++n, offset: 0, length: 1, obj: { ...base(), uuid: `u${n}`, timestamp: new Date(t).toISOString(), ...o } });
  };
  const api = {
    prompt: (text) => push({ type: 'user', message: { role: 'user', content: text } }),
    say: (text) => push({ type: 'assistant', message: { id: `m${n}`, model: 'claude-fable-5-1', role: 'assistant', content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 5 } } }),
    call: (name, input, result, { error = false, dt = 1000, toolUseResult } = {}) => {
      const id = `toolu_${n + 1}`;
      push({ type: 'assistant', message: { id: `m${n}`, model: 'claude-fable-5-1', role: 'assistant', content: [{ type: 'tool_use', id, name, input }], usage: { input_tokens: 10, output_tokens: 5 } } });
      push({ type: 'user', message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: result, is_error: error }] }, toolUseResult }, dt);
      return id;
    },
    interrupt: () => push({ type: 'user', message: { role: 'user', content: '[Request interrupted by user]' } }),
    apiError: () => push({ type: 'system', subtype: 'api_error', level: 'error', error: { message: '529' }, retryAttempt: 1, maxRetries: 3, retryInMs: 500 }),
    records: () => recs,
  };
  return api;
}

const summary = (over = {}) => ({ counts: {}, usage: { input: 1000, output: 200, cacheRead: 500, cacheCreate: 100, thinking: 0 }, cost: { totalCostUSD: 0.42, totalDuration: 9000 }, estimate: { byModel: [], totalUSD: 0, complete: true }, live: null, subagents: [], prLinks: [], continuedIn: null, gitBranch: 'main', ...over });

test('classifyCommand: categories, mutation flag, git sub-commands', () => {
  assert.equal(classifyCommand('npm test').category, 'test');
  assert.equal(classifyCommand('cd /x && node --test server/test/*.test.js').category, 'test');
  assert.equal(classifyCommand('pytest -q tests/').category, 'test');
  assert.equal(classifyCommand('npm run build').category, 'build');
  assert.equal(classifyCommand('tsc --noEmit').category, 'lint');
  assert.equal(classifyCommand('npm run typecheck').category, 'lint');
  assert.equal(classifyCommand('npm install').category, 'install');
  assert.equal(classifyCommand('npm install').mutating, true);
  assert.deepEqual(classifyCommand('git commit -m "x"'), { category: 'git', mutating: true, git: 'commit' });
  assert.equal(classifyCommand('git status && git diff').category, 'inspect');
  assert.equal(classifyCommand('ls -la && cat package.json | head -20').category, 'inspect');
  assert.equal(classifyCommand('ls -la && cat package.json | head -20').mutating, false);
  assert.equal(classifyCommand('cat a.txt > b.txt').mutating, true);
  assert.equal(classifyCommand('cat a.txt > b.txt').category, 'other');
  assert.equal(classifyCommand('grep foo x 2>&1 >/dev/null').mutating, false);
  assert.equal(classifyCommand('sed -i "s/a/b/" f.js').mutating, true);
  assert.equal(classifyCommand('node scripts/gen.js').category, 'run');
  assert.equal(classifyCommand('cat > /tmp/x.mjs <<EOF\nconsole.log(1)\nEOF').mutating, true);
});

test('testOutcome / buildOutcome parse runner output', () => {
  assert.deepEqual(testOutcome('# tests 5\n# pass 5\n# fail 0', false), { status: 'passed', passed: 5, failed: 0 });
  assert.equal(testOutcome('Tests: 2 failed, 8 passed, 10 total', false).status, 'failed');
  assert.equal(testOutcome('Tests: 2 failed, 8 passed, 10 total', false).failed, 2);
  assert.equal(testOutcome('12 passed in 0.3s', false).status, 'passed');
  assert.equal(testOutcome('ok  \tgithub.com/x/y\t0.1s', false).status, 'passed');
  assert.equal(testOutcome('--- FAIL: TestX', false).status, 'failed');
  assert.equal(testOutcome('something', true).status, 'failed');
  assert.equal(testOutcome('no summary here', false).status, 'unknown');
  assert.equal(buildOutcome('src/a.ts(3,1): error TS2304: Cannot find name', false), 'failed');
  assert.equal(buildOutcome('done in 0.3s', false), 'passed');
  assert.equal(buildOutcome('', true), 'failed');
});

test('analyzeSession: metrics, redundancy, retries, files, tests, outcome and scores', () => {
  const s = script();
  s.prompt('Fix the failing auth test');
  s.call('Read', { file_path: '/p/src/auth.ts' }, 'export const a = 1;', { toolUseResult: { type: 'text', file: { filePath: '/p/src/auth.ts', content: 'x' } } });
  s.call('Read', { file_path: '/p/src/auth.ts' }, 'export const a = 1;'); // redundant: nothing changed in between
  s.call('Bash', { command: 'ls -la' }, 'total 0');
  s.call('Bash', { command: 'ls -la' }, 'total 0'); // repeated after success, nothing changed
  s.call('Edit', { file_path: '/p/src/auth.ts', old_string: 'nope', new_string: 'x' }, '<tool_use_error>String to replace not found in file.</tool_use_error>', { error: true });
  s.call('Edit', { file_path: '/p/src/auth.ts', old_string: 'nope', new_string: 'x' }, '<tool_use_error>String to replace not found in file.</tool_use_error>', { error: true }); // identical retry
  s.call('Edit', { file_path: '/p/src/auth.ts', old_string: 'a = 1', new_string: 'a = 2;\nconst b = 3' }, 'ok', { toolUseResult: { filePath: '/p/src/auth.ts', structuredPatch: [{ lines: ['-export const a = 1;', '+export const a = 2;', '+const b = 3'] }] } }); // resolved
  s.call('Read', { file_path: '/p/src/auth.ts' }, 'export const a = 2;'); // not redundant: file changed
  s.call('Write', { file_path: '/p/src/new.ts', content: 'line1\nline2' }, 'ok', { toolUseResult: { type: 'create', filePath: '/p/src/new.ts', content: 'line1\nline2' } });
  s.call('Bash', { command: 'npm test' }, 'Tests: 1 failed, 3 passed, 4 total', { error: true, toolUseResult: { stdout: 'Tests: 1 failed, 3 passed, 4 total', stderr: '' } });
  s.call('Edit', { file_path: '/p/src/auth.ts', old_string: 'b = 3', new_string: 'b = 4' }, 'ok', { toolUseResult: { structuredPatch: [{ lines: ['-const b = 3', '+const b = 4'] }] } });
  s.call('Bash', { command: 'npm test' }, '# pass 4\n# fail 0', { toolUseResult: { stdout: '# pass 4\n# fail 0', stderr: '' }, dt: 5000 }); // legit re-run after an edit
  s.call('Bash', { command: 'git commit -am "fix"' }, '[main abc] fix');
  s.apiError();
  s.say('Done: fixed the auth test.');

  const a = analyzeSession({ id: SID, main: s.records(), subagents: [], summary: summary() });
  assert.equal(a.version, ANALYSIS_VERSION);
  assert.equal(a.task.title, 'Fix the failing auth test');
  assert.equal(a.task.outcome, 'completed');
  assert.equal(a.task.finalResponse, 'Done: fixed the auth test.');
  assert.equal(a.activity.toolCalls, 13);
  assert.equal(a.activity.toolErrors, 3);
  assert.equal(a.activity.commands.total, 5);
  assert.equal(a.activity.commands.byCategory.test, 2);
  assert.equal(a.activity.commands.byCategory.inspect, 2);
  assert.equal(a.activity.commands.byCategory.git, 1);
  assert.equal(a.activity.commands.git.commits, 1);
  assert.equal(a.activity.commands.unique, 3);
  assert.equal(a.activity.files.read, 1);
  assert.equal(a.activity.files.changed, 2);
  assert.equal(a.activity.files.created, 1);
  assert.equal(a.activity.files.linesAdded, 5); // 2 + 2 (write) + 1
  assert.equal(a.activity.files.linesRemoved, 2);
  assert.equal(a.activity.tests.runs, 2);
  assert.equal(a.activity.tests.failed, 1);
  assert.equal(a.activity.tests.passed, 1);
  assert.equal(a.activity.tests.last, 'passed');
  assert.equal(a.activity.apiErrors, 1);
  assert.equal(a.activity.apiRetries, 1);
  assert.equal(a.activity.cost.usd, 0.42);
  assert.equal(a.activity.cost.estimated, false);
  assert.equal(a.activity.tokens.totalIn, 1600);
  assert.ok(a.activity.timing.wallMs > 0);
  assert.ok(a.activity.timing.toolMs >= 5000);
  assert.equal(a.behavior.redundantReads, 1);
  assert.equal(a.behavior.redundantReadFiles[0].path, '/p/src/auth.ts');
  assert.equal(a.behavior.repeatedCommands, 1);
  assert.equal(a.behavior.repeatedCommandList[0].command, 'ls -la');
  assert.equal(a.behavior.retryChains, 1); // the two identical Edit misses
  assert.equal(a.behavior.fixLoops, 1); // failing test → edit → passing test
  assert.equal(a.behavior.identicalRetries, 1);
  assert.equal(a.behavior.unresolvedChains, 0);
  assert.equal(a.behavior.chains[0].resolved, true);
  assert.equal(a.behavior.chains[0].attempts, 3);
  assert.equal(a.behavior.editMisses, 2);
  assert.equal(a.behavior.redundantCalls, 3);
  assert.equal(a.behavior.editsAfterLastCheck, false); // git commit is not an edit tool; last edit came before the passing test
  const kinds = a.problems.map((p) => p.kind);
  assert.ok(kinds.includes('repeated-reads'));
  assert.ok(kinds.includes('repeated-commands'));
  assert.ok(kinds.includes('retry-no-change'));
  assert.ok(kinds.includes('edit-misses'));
  assert.ok(kinds.includes('api-errors'));
  assert.ok(!kinds.includes('no-verification'));
  assert.ok(!kinds.includes('tests-failing-at-end'));
  // refs point at tool_call event ids the normalizer would produce
  assert.match(a.problems.find((p) => p.kind === 'repeated-reads').refs[0].id, /^main:u\d+#0$/);
  assert.equal(a.recommendations.length, new Set(kinds.filter((k) => k !== 'no-changes')).size);
  assert.equal(a.scores.derived, true);
  for (const k of ['overall', 'reliability', 'efficiency', 'verification']) {
    assert.ok(a.scores[k].value >= 0 && a.scores[k].value <= 100, k);
  }
  assert.equal(a.scores.verification.value, 100);
  assert.ok(a.scores.efficiency.factors.some((f) => /redundant/.test(f.label)));
  assert.equal(a.turns.length, 1);
  assert.equal(a.turns[0].toolCalls, 13);
  assert.equal(a.turns[0].testRuns, 2);

  const c = compactAnalysis(a);
  assert.equal(c.problems[0].refs, undefined);
  assert.equal(c.activity.files.changedList, undefined);
  assert.equal(c.scores.overall.value, a.scores.overall.value);
});

test('analyzeSession: outcomes, no-verification, unresolved failures, sub-agents', () => {
  const s = script();
  s.prompt('Add a feature');
  s.call('Write', { file_path: '/p/a.ts', content: 'x' }, 'ok');
  s.call('Bash', { command: 'npm run build' }, 'error TS2304: boom', { error: true });
  s.call('Bash', { command: 'npm run build' }, 'error TS2304: boom', { error: true });
  s.call('Bash', { command: 'npm run build' }, 'error TS2304: boom', { error: true });
  s.interrupt();
  const sub = script();
  sub.prompt('look around');
  sub.call('Read', { file_path: '/p/a.ts' }, 'x');
  sub.call('Bash', { command: 'rg foo' }, 'boom', { error: true });
  const subSummary = { agentId: 'agent-abc', agentType: 'Explore', usage: { input: 10, output: 5, cacheRead: 0, cacheCreate: 0, thinking: 0 } };
  const a = analyzeSession({ id: SID, main: s.records(), subagents: [{ agentId: 'agent-abc', meta: {}, records: sub.records() }], summary: summary({ cost: null, estimate: { byModel: [{ model: 'claude-fable-5-1' }], totalUSD: 0.1, complete: true }, subagents: [subSummary] }) });
  assert.equal(a.task.outcome, 'interrupted');
  assert.equal(a.activity.cost.estimated, true);
  assert.equal(a.activity.agents.count, 1);
  assert.equal(a.activity.agents.toolCalls, 2);
  assert.equal(a.activity.agents.withErrors, 1);
  assert.equal(a.activity.toolCalls, 6); // 4 main + 2 agent
  assert.equal(a.activity.builds.runs, 3);
  assert.equal(a.activity.builds.last, 'failed');
  assert.equal(a.behavior.unresolvedChains, 1);
  assert.equal(a.behavior.identicalRetries, 2);
  const kinds = a.problems.map((p) => p.kind);
  assert.ok(kinds.includes('build-failing-at-end'));
  assert.ok(kinds.includes('unresolved-failures'));
  assert.ok(kinds.includes('subagent-errors'));
  assert.ok(!kinds.includes('no-verification')); // a build did run
  assert.equal(a.problems.find((p) => p.kind === 'subagent-errors').refs[0].agentId, 'agent-abc');
  assert.equal(a.scores.verification.value, 35);
  assert.ok(a.scores.reliability.value < 70);

  // live session → in-progress, no end-state problems
  const live = analyzeSession({ id: SID, main: s.records(), subagents: [], summary: summary({ live: { pid: 1 } }) });
  assert.equal(live.task.outcome, 'in-progress');
  assert.ok(!live.problems.some((p) => p.kind === 'build-failing-at-end'));

  // research session: no edits → verification not scored, informational note only
  const r = script();
  r.prompt('Explain the auth flow');
  for (let i = 0; i < 10; i++) r.call('Grep', { pattern: `p${i}`, path: '/p' }, 'x');
  r.say('Here is how it works.');
  const ra = analyzeSession({ id: SID, main: r.records(), subagents: [], summary: summary() });
  assert.equal(ra.scores.verification, null);
  assert.ok(ra.problems.some((p) => p.kind === 'no-changes'));
  assert.equal(ra.task.outcome, 'completed');
  // stopped mid-work
  const m = script();
  m.prompt('do it');
  m.call('Read', { file_path: '/p/a' }, 'x');
  const ma = analyzeSession({ id: SID, main: m.records(), subagents: [], summary: summary() });
  assert.equal(ma.task.outcome, 'incomplete');
  // never throws on garbage
  const g = analyzeSession({ id: SID, main: [{ line: 1, obj: null }, { line: 2, obj: { type: 'assistant' } }, { line: 3, obj: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'nope' }] } } }], subagents: [], summary: summary({ usage: null }) });
  assert.equal(g.activity.toolCalls, 0);
  assert.equal(typeof g.task.outcome, 'string');
});

test('source: analysis endpoint data is cached by file signature and invalidated on change', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-an-'));
  const claudeDir = path.join(root, '.claude');
  const proj = path.join(claudeDir, 'projects', '-p');
  fs.mkdirSync(proj, { recursive: true });
  const s = script();
  s.prompt('hi');
  s.call('Read', { file_path: '/p/a' }, 'x');
  s.call('Read', { file_path: '/p/a' }, 'x');
  s.say('done');
  const file = path.join(proj, `${SID}.jsonl`);
  fs.writeFileSync(file, s.records().map((r) => JSON.stringify(r.obj)).join('\n') + '\n');
  const cache = new SummaryCache(path.join(root, 'cache'));
  const store = new MetadataStore(path.join(root, 'app'));
  const src = new ClaudeSessionSource({ projectsDir: path.join(claudeDir, 'projects'), claudeDir, cache, store });
  await src.discover();
  const a1 = src.readAnalysis(SID);
  assert.equal(a1.behavior.redundantReads, 1);
  assert.equal(src.readAnalysis(SID), a1); // memory cache hit
  const all = await src.analyzeAll();
  assert.equal(all.analyses.length, 1);
  assert.equal(all.analyses[0].id, SID);
  assert.equal(all.analyses[0].problems[0].refs, undefined);
  // a second source instance reads the disk cache
  const src2 = new ClaudeSessionSource({ projectsDir: path.join(claudeDir, 'projects'), claudeDir, cache, store });
  await src2.discover();
  assert.equal(src2.readAnalysis(SID).computedAt, a1.computedAt);
  // file grows → recomputed
  await new Promise((r) => setTimeout(r, 20));
  fs.appendFileSync(file, JSON.stringify({ type: 'user', uuid: 'zz', timestamp: '2026-01-01T11:00:00.000Z', message: { role: 'user', content: '[Request interrupted by user]' } }) + '\n');
  src.reindexPath(path.join('-p', `${SID}.jsonl`));
  const a2 = src.readAnalysis(SID);
  assert.notEqual(a2, a1);
  assert.equal(a2.task.outcome, 'interrupted');
  assert.throws(() => src.readAnalysis('../x'), /invalid session id/);
  fs.rmSync(root, { recursive: true, force: true });
});
