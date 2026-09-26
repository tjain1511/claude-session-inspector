import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { memoryOpsFromToolUse, memoryOpsFromAttachment } from '../session-source/memory-ops.js';
import { createSummaryState, reduceRecord } from '../session-source/summarize.js';
import { parseNote, parseIndex, noteLinks, readMemoryDirs } from '../memory.js';

const DIR = '/Users/u/.claude/projects/-Users-u-app/memory';
const bash = (command) => memoryOpsFromToolUse({ name: 'Bash', input: { command } }).map((o) => [o.op, o.file, o.content]);

test('memory ops: file tools map to write/edit/read with their content', () => {
  const [w] = memoryOpsFromToolUse({ name: 'Write', input: { file_path: `${DIR}/a.md`, content: 'hello' } });
  assert.deepEqual([w.project, w.file, w.op, w.content], ['-Users-u-app', 'a.md', 'write', 'hello']);
  const [e] = memoryOpsFromToolUse({ name: 'Edit', input: { file_path: `${DIR}/a.md`, old_string: 'x', new_string: 'y' } });
  assert.deepEqual([e.op, e.edits], ['edit', [{ old: 'x', new: 'y' }]]);
  assert.equal(memoryOpsFromToolUse({ name: 'Read', input: { file_path: `${DIR}/a.md` } })[0].op, 'read');
  assert.deepEqual(memoryOpsFromToolUse({ name: 'Write', input: { file_path: '/repo/src/memory/a.md', content: '' } }), []);
});

test('memory ops: shell commands are classified and heredoc content captured', () => {
  assert.deepEqual(bash(`cat > ${DIR}/a.md <<'EOF'\n---\nname: a\n---\nbody\nEOF`), [['write', 'a.md', '---\nname: a\n---\nbody']]);
  assert.deepEqual(bash(`cat >> ${DIR}/MEMORY.md <<EOF\n- [A](a.md) — x\nEOF`), [['append', 'MEMORY.md', '- [A](a.md) — x']]);
  assert.deepEqual(bash(`cat ${DIR}/a.md`), [['read', 'a.md', undefined]]);
  assert.deepEqual(bash(`rm -f ${DIR}/a.md`), [['delete', 'a.md', undefined]]);
  assert.deepEqual(bash(`sed -i '' 's/a/b/' ${DIR}/a.md`), [['edit', 'a.md', undefined]]);
  assert.deepEqual(bash(`ls ${DIR}/*.md; cat /x/projects/<cwd>/memory/foo.md`), []);
});

test('memory ops: bare names inside a memory folder are inferred, other .md files are not', () => {
  const ops = (command) => memoryOpsFromToolUse({ name: 'Bash', input: { command } }).map((o) => [o.op, o.file, !!o.inferred]);
  assert.deepEqual(ops(`cd ${DIR} && python3 - <<EOF\np="a.md"\nopen(p, "w").write(open(p).read())\nEOF`), [['edit', 'a.md', true]]);
  assert.deepEqual(ops(`M=${DIR}\ncat $M/a.md`), [['read', 'a.md', true]]);
  assert.deepEqual(ops(`cd ${DIR} && cat /repo/.claude/skills/x/SKILL.md`), []);
  assert.deepEqual(ops(`cat /repo/README.md ${DIR}/b.md`), [['read', 'b.md', false]]);
  assert.deepEqual(ops(`cd ${DIR} && cat >> MEMORY.md <<'EOF'\n- [A](a.md) — hook\nEOF`), [['append', 'MEMORY.md', true]]);
  assert.deepEqual(ops(`cd ${DIR} && echo "- [A](a.md) — hook" >> MEMORY.md; cat MEMORY.md`), [['append', 'MEMORY.md', true]]);
});

test('memory ops: reducer records ops, marks failures, and dedupes MEMORY.md loads', () => {
  const s = createSummaryState('s1');
  const att = { type: 'attachment', timestamp: '2026-01-01T00:00:00Z', attachment: { type: 'instructions', files: [{ path: `${DIR}/MEMORY.md`, type: 'AutoMem', content: '' }] } };
  reduceRecord(s, att);
  reduceRecord(s, att);
  reduceRecord(s, { type: 'assistant', timestamp: '2026-01-01T00:00:01Z', message: { id: 'm1', content: [{ type: 'tool_use', id: 'tu1', name: 'Write', input: { file_path: `${DIR}/a.md`, content: 'x' } }] } });
  reduceRecord(s, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', is_error: true, content: 'denied' }] } });
  assert.deepEqual(s.memoryOps.map((o) => [o.op, o.file, o.toolUseId, !!o.failed]), [['loaded', 'MEMORY.md', null, false], ['write', 'a.md', 'tu1', true]]);
  assert.deepEqual(memoryOpsFromAttachment({ type: 'nested_memory', path: '/repo/CLAUDE.md' }), []);
});

test('memory notes: front matter, links and index entries parse', () => {
  const n = parseNote('---\nname: a\ndescription: "quoted: text"\nmetadata:\n  type: feedback\n  originSessionId: s1\n---\n\nBody with [[b]] and [[c]].\n');
  assert.deepEqual(n.frontmatter, { name: 'a', description: 'quoted: text', metadata: { type: 'feedback', originSessionId: 's1' } });
  assert.deepEqual(noteLinks(n.body), ['b', 'c']);
  assert.deepEqual(parseNote('no front matter').frontmatter, null);
  assert.deepEqual(parseIndex('- [A](a.md) — hook one\n* [B](b.md)\ntext'), [{ title: 'A', file: 'a.md', hook: 'hook one' }, { title: 'B', file: 'b.md', hook: '' }]);
});

test('memory notes: memory folders are read with the index kept separate', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-'));
  const dir = path.join(root, '-Users-u-app', 'memory');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(root, '-Users-u-empty'));
  fs.writeFileSync(path.join(dir, 'MEMORY.md'), '- [A](a.md) — hook\n');
  fs.writeFileSync(path.join(dir, 'a.md'), '---\nname: a\n---\nbody');
  const [p, ...rest] = readMemoryDirs(root);
  assert.equal(rest.length, 0);
  assert.deepEqual([p.dirName, p.notes.map((n) => n.file), p.index.entries.length], ['-Users-u-app', ['a.md'], 1]);
  fs.rmSync(root, { recursive: true });
});

test('memory ops: global CLAUDE.md and rules files are recognised, a repo .claude folder is not', async () => {
  const { GLOBAL_MEMORY, setGlobalMemoryDir, memoryPaths } = await import('../session-source/memory-ops.js');
  const G = path.join(os.homedir(), '.claude');
  setGlobalMemoryDir(G);
  const [w] = memoryOpsFromToolUse({ name: 'Write', input: { file_path: `${G}/CLAUDE.md`, content: 'be terse' } });
  assert.deepEqual([w.project, w.file, w.op, w.content], [GLOBAL_MEMORY, 'CLAUDE.md', 'write', 'be terse']);
  assert.deepEqual(memoryPaths(`cat ~/.claude/rules/style/ts.md`), [{ project: GLOBAL_MEMORY, file: 'rules/style/ts.md' }]);
  assert.deepEqual(memoryPaths('/repo/.claude/CLAUDE.md /repo/.claude/rules/a.md'), []);
  // Copying the global file into a repo reads it; it does not write it.
  assert.deepEqual(bash(`cat ${G}/CLAUDE.md > /repo/CLAUDE.md`).map((o) => o.slice(0, 2)), [['read', 'CLAUDE.md']]);
  assert.deepEqual(memoryOpsFromAttachment({ type: 'instructions', files: [{ path: `${G}/CLAUDE.md`, type: 'User' }] }).map((o) => [o.project, o.op]), [[GLOBAL_MEMORY, 'loaded']]);
});

test('memory notes: global memory reads CLAUDE.md and nested rules', async () => {
  const { readGlobalMemory } = await import('../memory.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gmem-'));
  assert.deepEqual(readGlobalMemory(root).notes.filter((n) => n.kind !== 'managed'), []);
  fs.mkdirSync(path.join(root, 'rules', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# Me\n');
  fs.writeFileSync(path.join(root, 'rules', 'sub', 'ts.md'), '---\npaths: src/**\n---\nUse strict mode');
  const notes = readGlobalMemory(root).notes.filter((n) => n.kind !== 'managed');
  assert.deepEqual(notes.map((n) => [n.file, n.kind]), [['CLAUDE.md', 'user'], ['rules/sub/ts.md', 'rule']]);
  fs.rmSync(root, { recursive: true });
});

test('memory ops: a script or heredoc that only mentions the global CLAUDE.md does not touch it', async () => {
  const G = path.join(os.homedir(), '.claude');
  assert.deepEqual(bash(`python3 - <<'EOF'\nopen('x.js','w').write("${G}/CLAUDE.md")\nEOF`), []);
  assert.deepEqual(bash(`cat >> notes.md <<'EOF'\nsee ~/.claude/CLAUDE.md\nEOF`), []);
  assert.deepEqual(bash(`cat > ~/.claude/CLAUDE.md <<'EOF'\nbe terse\nEOF`), [['write', 'CLAUDE.md', 'be terse']]);
});
