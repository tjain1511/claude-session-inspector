// Run with: npm test  (node --test, no test framework dependency)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJsonlFrom } from '../session-source/parser.js';
import { createSummaryState, reduceRecord, summaryFromState } from '../session-source/summarize.js';
import { normalizeRecords } from '../session-source/normalize.js';
import { ClaudeSessionSource } from '../session-source/ClaudeSessionSource.js';
import { SummaryCache } from '../session-source/cache.js';
import { MetadataStore } from '../store.js';
import { resolveProjectsDir } from '../discovery.js';

const SID = '11111111-2222-4333-8444-555555555555';
const line = (o) => JSON.stringify(o) + '\n';
const base = (over) => ({ parentUuid: null, isSidechain: false, userType: 'external', cwd: '/Users/me/proj', sessionId: SID, version: '2.1.0', gitBranch: 'main', ...over });

function sampleTranscript() {
  return (
    line({ type: 'ai-title', aiTitle: 'Fix auth bug', sessionId: SID }) +
    line(base({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T10:00:00.000Z', message: { role: 'user', content: 'Fix the failing auth test' } })) +
    line(base({ type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: '2026-01-01T10:00:02.000Z', requestId: 'r1', message: { id: 'm1', model: 'claude-fable-5-1', role: 'assistant', content: [{ type: 'text', text: 'Looking.' }], usage: { input_tokens: 10, output_tokens: 5 } } })) +
    line(base({ type: 'assistant', uuid: 'a2', parentUuid: 'a1', timestamp: '2026-01-01T10:00:03.000Z', requestId: 'r1', apiBlockIndex: 1, message: { id: 'm1', model: 'claude-fable-5-1', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/x.ts' } }], usage: { input_tokens: 10, output_tokens: 5 } } })) +
    line(base({ type: 'user', uuid: 'u2', parentUuid: 'a2', timestamp: '2026-01-01T10:00:04.500Z', message: { role: 'user', content: [{ tool_use_id: 'toolu_1', type: 'tool_result', content: 'export const x = 1;', is_error: false }] }, toolUseResult: { type: 'text', file: { filePath: '/x.ts', content: 'export const x = 1;' } } })) +
    line(base({ type: 'user', uuid: 'u3', parentUuid: 'u2', timestamp: '2026-01-01T10:00:05.000Z', message: { role: 'user', content: [{ tool_use_id: 'toolu_2', type: 'tool_result', content: 'Exit code 1', is_error: true }] } })) +
    line(base({ type: 'system', uuid: 's1', subtype: 'api_error', level: 'error', timestamp: '2026-01-01T10:00:06.000Z', error: { message: '500' }, retryAttempt: 1, maxRetries: 3, retryInMs: 500 })) +
    line({ type: 'cost-state', sessionId: SID, totalCostUSD: 0.5, totalDuration: 6000, totalAPIDuration: 3000, totalToolDuration: 1500, modelUsage: {} }) +
    line({ type: 'some-future-record', sessionId: SID, payload: { a: 1 } })
  );
}

test('parser: reads records, reports bad lines, treats missing trailing newline as partial', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-'));
  const f = path.join(dir, 'a.jsonl');
  fs.writeFileSync(f, line({ a: 1 }) + 'not json\n' + line({ b: 2 }) + '{"partial":');
  const r = readJsonlFrom(f);
  assert.equal(r.records.length, 2);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].line, 2);
  assert.equal(r.partial, true);
  // resume from the returned offset once the line is completed
  fs.appendFileSync(f, 'true}\n');
  const r2 = readJsonlFrom(f, { offset: r.offset, line: r.line });
  assert.equal(r2.records.length, 1);
  assert.deepEqual(r2.records[0].obj, { partial: true });
  assert.equal(r2.partial, false);
  // truncation is detected
  fs.writeFileSync(f, line({ c: 3 }));
  const r3 = readJsonlFrom(f, { offset: r2.offset, line: r2.line });
  assert.equal(r3.truncated, true);
});

test('summarizer: counts, title precedence, usage, cost, unknown records never throw', () => {
  const st = createSummaryState(SID);
  for (const l of sampleTranscript().split('\n').filter(Boolean)) reduceRecord(st, JSON.parse(l));
  const s = summaryFromState(st);
  assert.equal(s.generatedTitle, 'Fix auth bug');
  assert.equal(s.titleSource, 'ai');
  assert.equal(s.firstPrompt, 'Fix the failing auth test');
  assert.equal(s.counts.userMessages, 1);
  assert.equal(s.counts.assistantMessages, 1); // two lines, one message id
  assert.equal(s.counts.toolCalls, 1);
  assert.equal(s.counts.toolErrors, 1);
  assert.equal(s.counts.apiErrors, 1);
  assert.equal(s.usage.output, 5); // usage deduped per message id
  assert.equal(s.model, 'claude-fable-5-1');
  assert.equal(s.cost.totalCostUSD, 0.5);
  assert.equal(s.durationMs, 6000);
  assert.ok(st.digest.includes('failing auth test'));
  reduceRecord(st, null);
  reduceRecord(st, 'garbage');
  reduceRecord(st, { type: 'user' }); // missing message
});

test('normalizer: event types, tool pairing data, truncation, raw refs', () => {
  const recs = sampleTranscript().split('\n').filter(Boolean).map((l, i) => ({ line: i + 1, offset: i * 10, length: l.length, obj: JSON.parse(l) }));
  const ev = normalizeRecords(recs, 'main');
  const types = ev.map((e) => e.type);
  assert.deepEqual(types, ['metadata', 'user', 'assistant', 'tool_call', 'tool_result', 'tool_result', 'error', 'metadata', 'unknown']);
  const call = ev.find((e) => e.type === 'tool_call');
  assert.equal(call.tool, 'Read');
  assert.equal(call.toolUseId, 'toolu_1');
  assert.equal(call.block, 0);
  const res = ev.filter((e) => e.type === 'tool_result');
  assert.equal(res[0].toolUseId, 'toolu_1');
  assert.equal(res[0].status, 'success');
  assert.equal(res[1].status, 'error');
  assert.equal(res[0].structured.file.content, '[19 chars]');
  const err = ev.find((e) => e.type === 'error');
  assert.equal(err.retry.attempt, 1);
  assert.ok(ev.every((e) => e.ref && typeof e.ref.line === 'number'));
  // large text is truncated but length is reported
  const big = normalizeRecords([{ line: 1, offset: 0, length: 1, obj: base({ type: 'user', uuid: 'b', timestamp: '2026-01-01T00:00:00Z', message: { role: 'user', content: 'x'.repeat(100_000) } }) }]);
  assert.equal(big[0].truncated, true);
  assert.equal(big[0].fullLength, 100_000);
  assert.equal(big[0].content.length, 64 * 1024);
});

test('source: discovers sessions, isolates corrupt files, reindexes incrementally, searches, rejects bad ids', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-home-'));
  const claudeDir = path.join(root, '.claude');
  const proj = path.join(claudeDir, 'projects', '-Users-me-proj');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, `${SID}.jsonl`), sampleTranscript());
  const SID2 = '22222222-2222-4333-8444-555555555555';
  fs.writeFileSync(path.join(proj, `${SID2}.jsonl`), '{"type":"user","uuid":"x","timestamp":"2026-01-02T00:00:00Z","message":{"role":"user","content":"hello podman"}}\n{broken\n');
  fs.writeFileSync(path.join(proj, 'notes.jsonl'), 'ignored\n');
  fs.mkdirSync(path.join(proj, SID, 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(proj, SID, 'subagents', 'agent-abc.jsonl'), line(base({ type: 'assistant', uuid: 'sa', isSidechain: true, agentId: 'abc', timestamp: '2026-01-01T10:00:03.500Z', message: { id: 'sm', model: 'claude-haiku-4-5-20251001', role: 'assistant', content: [{ type: 'text', text: 'agent says hi' }] } })));
  fs.writeFileSync(path.join(proj, SID, 'subagents', 'agent-abc.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'look around', toolUseId: 'toolu_1' }));

  assert.equal(resolveProjectsDir(claudeDir).ok, true);
  assert.equal(resolveProjectsDir(path.join(root, 'nope')).ok, false);

  const cache = new SummaryCache(path.join(root, 'cache'));
  const store = new MetadataStore(path.join(root, 'app'));
  const src = new ClaudeSessionSource({ projectsDir: path.join(claudeDir, 'projects'), claudeDir, cache, store });
  const report = await src.discover();
  assert.equal(report.sessions, 2);
  assert.equal(report.loaded, 2);
  assert.ok(report.issues.some((i) => i.sessionId === SID2 && /line 2/.test(i.message)));
  assert.ok(report.issues.some((i) => /notes\.jsonl/.test(i.path)));

  const list = src.listSessions();
  assert.equal(list[0].id, SID2); // newest first
  const s1 = list.find((s) => s.id === SID);
  assert.equal(s1.title, 'Fix auth bug');
  assert.equal(s1.project.raw, '/Users/me/proj');
  assert.equal(s1.subagents.length, 1);
  assert.equal(s1.subagents[0].agentType, 'Explore');
  assert.equal(s1.subagents[0].toolUseId, 'toolu_1');

  // custom names
  store.setCustomName(SID, '  Debug webhook  ');
  assert.equal(src.getSummary(SID).title, 'Debug webhook');
  assert.equal(src.getSummary(SID).generatedTitle, 'Fix auth bug');
  assert.throws(() => store.setCustomName(SID, '   '));
  assert.throws(() => store.setCustomName(SID, 'x'.repeat(200)));
  store.clearCustomName(SID);
  assert.equal(src.getSummary(SID).title, 'Fix auth bug');

  // search hits content in main + subagent transcripts
  assert.deepEqual(src.search('podman'), [SID2]);
  assert.deepEqual(src.search('agent says'), [SID]);
  assert.deepEqual(src.search('nothing-here-xyz'), []);

  // incremental read
  const r1 = src.readSession(SID);
  assert.equal(r1.events.length, 9);
  fs.appendFileSync(path.join(proj, `${SID}.jsonl`), line(base({ type: 'user', uuid: 'u9', timestamp: '2026-01-01T10:01:00.000Z', message: { role: 'user', content: 'thanks' } })));
  const r2 = src.readSession(SID, { from: r1.offset, line: r1.line });
  assert.equal(r2.events.length, 1);
  assert.equal(r2.events[0].content, 'thanks');
  const upd = src.reindexPath(path.join('-Users-me-proj', `${SID}.jsonl`));
  assert.equal(upd.id, SID);
  assert.equal(src.getSummary(SID).counts.userMessages, 2);

  // cache resume: a second source instance reuses the cache without reparsing
  const src2 = new ClaudeSessionSource({ projectsDir: path.join(claudeDir, 'projects'), claudeDir, cache, store });
  await src2.discover();
  assert.equal(src2.getSummary(SID).counts.userMessages, 2);

  // raw + subagent + validation
  const raw = src.readRaw(SID, 'main', r1.events[1].ref);
  assert.equal(raw.uuid, 'u1');
  assert.equal(src.readSubagent(SID, 'agent-abc').events[0].content, 'agent says hi');
  assert.throws(() => src.readSession('../etc/passwd'), /invalid session id/);
  assert.throws(() => src.readSubagent(SID, '../../x'), /invalid file key/);
  assert.throws(() => src.readSession('99999999-2222-4333-8444-555555555555'), /not found/);
  fs.rmSync(root, { recursive: true, force: true });
});
