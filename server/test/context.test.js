import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractContext } from '../session-source/context.js';

const rec = (obj, line) => ({ line, offset: line * 100, length: 90, obj });
const att = (attachment, line, extra = {}) => rec({ type: 'attachment', timestamp: '2026-09-25T17:53:19.080Z', attachment, ...extra }, line);

test('context: system prompt, tools, agents, skills, mcp, instructions are extracted from attachments', () => {
  const ctx = extractContext([
    att({ type: 'environment', snapshot: { workingDirectory: '/w', platform: 'darwin' } }, 1),
    att({ type: 'model', identity: { modelId: 'claude-x', marketingName: 'X' }, text: 'You are X' }, 2),
    att({ type: 'deferred_tools_delta', addedNames: ['WebFetch', 'mcp__srv__do'], removedNames: [], surfacedNames: [] }, 3),
    att({ type: 'agent_listing_delta', addedTypes: ['Explore', 'Plan'], addedLines: ['- Explore: read-only search (Tools: Read)', '- Plan: designs plans'], removedTypes: [], isInitial: true }, 4),
    att({ type: 'mcp_instructions_delta', addedNames: ['srv'], addedBlocks: ['## srv\nUse it wisely'], removedNames: [] }, 5),
    att({ type: 'skill_listing', content: '- deploy: ship it\n- review: check it', skillCount: 2, names: ['deploy', 'review'] }, 6),
    att({ type: 'prompt_snapshot', systemPrompt: ['You are an agent.', '__BOUNDARY__', '# Memory\nremember'], reminderFold: false }, 7),
    att({ type: 'prompt_snapshot', systemPrompt: ['You are an agent.', '__BOUNDARY__', '# Memory\nremember'], cliPrefix: 'You are Claude Code', tools: [{ name: 'Bash', description: 'Run a command', schema: { type: 'object' } }, { name: 'Read', description: 'Read a file', schema: {} }] }, 8),
    att({ type: 'deferred_tools_record', entries: [{ name: 'WebFetch', description: 'Fetch a URL', input_schema: { type: 'object' }, defer_loading: true }] }, 9),
    att({ type: 'instructions', files: [{ path: '/w/CLAUDE.md', type: 'Project', content: '# rules' }] }, 10),
    att({ type: 'nested_memory', path: '/w/tests/CLAUDE.md', displayPath: 'tests/CLAUDE.md', content: { path: '/w/tests/CLAUDE.md', type: 'Project', content: 'test rules' } }, 11),
    att({ type: 'command_permissions', allowedTools: ['Read', 'Bash(git:*)'] }, 12),
    att({ type: 'total_tokens_reminder', totalTokens: 5 }, 13),
    rec({ type: 'user', message: { role: 'user', content: 'hi' } }, 14),
    att({ type: 'prompt_snapshot', systemPrompt: ['You are an agent, updated.'] }, 15),
    att(null, 16), // malformed attachment must not throw
    rec({ type: 'attachment', attachment: 'nope' }, 17),
  ]);
  assert.equal(ctx.recorded, true);
  assert.equal(ctx.systemPrompt.parts.length, 3);
  assert.equal(ctx.systemPrompt.line, 7);
  assert.equal(ctx.systemPrompt.cliPrefix, null); // first snapshot had none
  assert.equal(ctx.systemPrompt.flags.reminderFold, false);
  assert.equal(ctx.promptChanged, true);
  assert.equal(ctx.snapshots.length, 3);
  assert.equal(ctx.snapshots[1].toolCount, 2);

  const names = ctx.tools.map((t) => t.name);
  assert.deepEqual([...names].sort(), ['Bash', 'Read', 'WebFetch', 'mcp__srv__do']);
  const wf = ctx.tools.find((t) => t.name === 'WebFetch');
  assert.equal(wf.deferred, true);
  assert.equal(wf.description, 'Fetch a URL');
  assert.deepEqual(wf.schema, { type: 'object' });
  assert.equal(ctx.tools.find((t) => t.name === 'mcp__srv__do').description, '');
  assert.equal(ctx.tools.find((t) => t.name === 'Bash').deferred, false);

  assert.deepEqual(ctx.agents.map((a) => [a.name, a.description]), [['Explore', 'read-only search (Tools: Read)'], ['Plan', 'designs plans']]);
  assert.equal(ctx.skills.count, 2);
  assert.deepEqual(ctx.skills.items.map((s) => s.name), ['deploy', 'review']);
  assert.equal(ctx.mcp[0].name, 'srv');
  assert.match(ctx.mcp[0].block, /wisely/);
  assert.equal(ctx.instructions.length, 2);
  assert.equal(ctx.instructions[1].display, 'tests/CLAUDE.md');
  assert.equal(ctx.environment.platform, 'darwin');
  assert.equal(ctx.model.modelId, 'claude-x');
  assert.deepEqual(ctx.allowedTools.allowedTools, ['Read', 'Bash(git:*)']);
  assert.equal(ctx.attachmentTypes.find((a) => a.type === 'prompt_snapshot').count, 3);
});

test('context: sessions without snapshots report recorded=false but keep listings', () => {
  const ctx = extractContext([
    att({ type: 'skill_listing', content: '- a: b', skillCount: 1, names: ['a'] }, 1),
    rec({ type: 'user', message: { role: 'user', content: 'hi' } }, 2),
  ]);
  assert.equal(ctx.recorded, false);
  assert.equal(ctx.systemPrompt, null);
  assert.equal(ctx.tools.length, 0);
  assert.equal(ctx.skills.items.length, 1);
});
