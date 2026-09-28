import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeRates, rateFor, estimateCost, checkRates, isValidRate, DEFAULT_RATES } from '../pricing.js';

test('pricing: rates resolve through suffixes, merge overrides, and validate', () => {
  const r = mergeRates({ 'claude-test-9': { input: 1, cacheRead: 0.1, cacheWrite: 2, output: 5 }, 'claude-haiku-4-5-20251001': null });
  assert.equal(rateFor(r, 'claude-haiku-4-5-20251001'), null);
  assert.deepEqual(rateFor(r, 'claude-test-9[1m]'), { input: 1, cacheRead: 0.1, cacheWrite: 2, output: 5 });
  assert.deepEqual(rateFor(r, 'claude-opus-5'), DEFAULT_RATES['claude-opus-5']);
  assert.equal(rateFor(r, 'claude-unknown-1'), null);
  assert.equal(isValidRate({ input: 1, cacheRead: 0, cacheWrite: 0, output: -1 }), false);
  assert.equal(isValidRate({ input: 1, cacheRead: 0, cacheWrite: 0, output: 1 }), true);
});

test('pricing: estimate sums main + sub-agent usage per model and flags unknown models', () => {
  const rates = mergeRates({});
  const e = estimateCost(
    { 'claude-fable-5-1': { input: 1_000_000, output: 100_000, cacheRead: 4_000_000, cacheCreate: 100_000, thinking: 0 } },
    [
      { model: 'claude-fable-5-1', usage: { input: 0, output: 100_000, cacheRead: 0, cacheCreate: 0, thinking: 0 } },
      { model: 'claude-mystery-2', usage: { input: 10, output: 10, cacheRead: 0, cacheCreate: 0, thinking: 0 } },
    ],
    rates,
  );
  const fable = e.byModel.find((m) => m.model === 'claude-fable-5-1');
  // 1M×10 + 4M×0.25 + 0.1M×20 + 0.2M×50 = 10 + 1 + 2 + 10
  assert.equal(Number(fable.cost.toFixed(6)), 23);
  assert.equal(fable.usage.output, 200_000);
  assert.deepEqual(e.unknownModels, ['claude-mystery-2']);
  assert.equal(e.complete, false);
  assert.equal(Number(e.totalUSD.toFixed(6)), 23);
});

test('pricing: sub-agent usage is split per model when its per-model usage is known', () => {
  const rates = mergeRates({});
  const u = (input) => ({ input, output: 0, cacheRead: 0, cacheCreate: 0, thinking: 0 });
  const e = estimateCost({}, [{ model: 'claude-opus-5', usage: u(2_000_000), usageByModel: { 'claude-opus-5': u(1_000_000), 'claude-haiku-4-5-20251001': u(1_000_000) } }], rates);
  assert.equal(e.byModel.find((m) => m.model === 'claude-opus-5').cost, 5);
  assert.equal(e.byModel.find((m) => m.model === 'claude-haiku-4-5-20251001').cost, 1);
  assert.equal(e.totalUSD, 6);
});

test('pricing: checkRates reports how many recorded sessions the table reproduces', () => {
  const rates = mergeRates({});
  const rec = { 'claude-haiku-4-5-20251001': { inputTokens: 1_000_000, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 1 } };
  const bad = { 'claude-haiku-4-5-20251001': { inputTokens: 1_000_000, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 2 } };
  const [a] = checkRates([rec, rec, bad], rates);
  assert.equal(a.sessions, 3);
  assert.equal(a.within1pct, 2);
  assert.ok(a.maxRelErr > 0.4);
});

test('pricing: Opus 5.5 and other price-list models resolve, including dated ids', () => {
  const r = mergeRates({});
  assert.deepEqual(rateFor(r, 'claude-opus-5-5'), { input: 4, cacheRead: 0.2, cacheWrite: 8, output: 20 });
  assert.deepEqual(rateFor(r, 'claude-opus-5-5[1m]'), { input: 4, cacheRead: 0.2, cacheWrite: 8, output: 20 });
  assert.deepEqual(rateFor(r, 'claude-sonnet-4-5-20250929'), { input: 3, cacheRead: 0.3, cacheWrite: 6, output: 15 });
  const e = estimateCost({ 'claude-opus-5-5': { input: 1_000_000, output: 100_000, cacheRead: 2_000_000, cacheCreate: 500_000, thinking: 0 } }, [], r);
  // 4 + 0.4 + 4 + 2
  assert.equal(Number(e.totalUSD.toFixed(6)), 10.4);
  assert.equal(e.complete, true);
});
