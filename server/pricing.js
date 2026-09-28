// Cost estimation for sessions that have no cost-state record yet (live sessions, or ones
// Claude Code never priced). Rates are US$ per million tokens. The defaults were derived by
// fitting the cost-state records in this machine's own transcripts (the recorded costUSD
// equals usage × these rates to the cent), and every rate can be overridden in Settings.
// Estimates are always labelled as such in the UI; recorded costs are never replaced.

export const DEFAULT_RATES = {
  // Fitted to this machine's cost-state records (recorded costUSD == usage × rate to the cent).
  'claude-fable-5-1': { input: 10, cacheRead: 0.25, cacheWrite: 20, output: 50 },
  'claude-fable-5': { input: 10, cacheRead: 1, cacheWrite: 20, output: 50 },
  'claude-opus-5[1m]': { input: 5, cacheRead: 0.5, cacheWrite: 10, output: 25 },
  'claude-opus-5': { input: 5, cacheRead: 0.5, cacheWrite: 10, output: 25 },
  'claude-haiku-4-5-20251001': { input: 1, cacheRead: 0.1, cacheWrite: 1.25, output: 5 },
  // From the published Claude API price list (platform.claude.com/docs/en/about-claude/pricing),
  // using the 1-hour cache-write column, which is what the recorded rates above correspond to
  // for the main models. Not yet verified against local cost records.
  'claude-opus-5-5': { input: 4, cacheRead: 0.2, cacheWrite: 8, output: 20 },
  'claude-mythos-5-1': { input: 10, cacheRead: 0.25, cacheWrite: 20, output: 50 },
  'claude-mythos-5': { input: 10, cacheRead: 1, cacheWrite: 20, output: 50 },
  'claude-opus-4-8': { input: 5, cacheRead: 0.5, cacheWrite: 10, output: 25 },
  'claude-opus-4-7': { input: 5, cacheRead: 0.5, cacheWrite: 10, output: 25 },
  'claude-opus-4-6': { input: 5, cacheRead: 0.5, cacheWrite: 10, output: 25 },
  'claude-opus-4-5': { input: 5, cacheRead: 0.5, cacheWrite: 10, output: 25 },
  'claude-sonnet-5': { input: 2, cacheRead: 0.2, cacheWrite: 4, output: 10 },
  'claude-sonnet-4-6': { input: 3, cacheRead: 0.3, cacheWrite: 6, output: 15 },
  'claude-sonnet-4-5': { input: 3, cacheRead: 0.3, cacheWrite: 6, output: 15 },
};

/** Models whose default rate was confirmed against recorded Claude Code costs on this machine. */
export const FITTED_MODELS = new Set(['claude-fable-5-1', 'claude-fable-5', 'claude-opus-5[1m]', 'claude-opus-5', 'claude-haiku-4-5-20251001']);

const FIELDS = ['input', 'cacheRead', 'cacheWrite', 'output'];

export function isValidRate(r) {
  return r && typeof r === 'object' && FIELDS.every((f) => typeof r[f] === 'number' && Number.isFinite(r[f]) && r[f] >= 0 && r[f] < 1e6);
}

/** Merge user overrides over the defaults. Overrides with all-null fields remove a model. */
export function mergeRates(overrides) {
  const out = { ...DEFAULT_RATES };
  for (const [m, r] of Object.entries(overrides || {})) {
    if (r === null) delete out[m];
    else if (isValidRate(r)) out[m] = { input: r.input, cacheRead: r.cacheRead, cacheWrite: r.cacheWrite, output: r.output };
  }
  return out;
}

/** Find a rate for a model id, tolerating date suffixes and context-window tags. */
export function rateFor(rates, model) {
  if (!model) return null;
  if (rates[model]) return rates[model];
  const stripped = model.replace(/\[\w+\]$/, '');
  if (rates[stripped]) return rates[stripped];
  const noDate = stripped.replace(/-\d{8}$/, '');
  if (rates[noDate]) return rates[noDate];
  const hit = Object.keys(rates).find((k) => k.replace(/\[\w+\]$/, '').replace(/-\d{8}$/, '') === noDate);
  return hit ? rates[hit] : null;
}

export function costOf(usage, rate) {
  if (!rate || !usage) return null;
  return ((usage.input || 0) * rate.input + (usage.cacheRead || 0) * rate.cacheRead + (usage.cacheCreate || 0) * rate.cacheWrite + (usage.output || 0) * rate.output) / 1e6;
}

/**
 * Estimate a session's cost from per-model usage (main transcript + sub-agents).
 * @param usageByModel {[model]: {input, output, cacheRead, cacheCreate, thinking}}
 * @param subagents    [{model, usage, usageByModel?}]: per-model usage when known, else all of
 *                     `usage` is charged to the agent's primary `model`
 */
export function estimateCost(usageByModel, subagents, rates) {
  const merged = {};
  const add = (model, u) => {
    if (!u) return;
    const key = model || 'unknown';
    const t = (merged[key] ??= { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, thinking: 0 });
    t.input += u.input || 0;
    t.output += u.output || 0;
    t.cacheRead += u.cacheRead || 0;
    t.cacheCreate += u.cacheCreate || 0;
    t.thinking += u.thinking || 0;
  };
  for (const [m, u] of Object.entries(usageByModel || {})) add(m, u);
  for (const s of subagents || []) {
    if (s.usageByModel && Object.keys(s.usageByModel).length) for (const [m, u] of Object.entries(s.usageByModel)) add(m, u);
    else add(s.model, s.usage);
  }
  const byModel = [];
  let total = 0;
  const unknown = [];
  for (const [model, usage] of Object.entries(merged)) {
    const rate = rateFor(rates, model);
    const cost = costOf(usage, rate);
    if (cost == null) unknown.push(model);
    else total += cost;
    byModel.push({ model, usage, rate, cost });
  }
  byModel.sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0));
  return { totalUSD: total, byModel, unknownModels: unknown, complete: unknown.length === 0 && byModel.length > 0 };
}

/**
 * How well the rate table reproduces the costs Claude Code recorded: per model, how many
 * sessions' recorded costUSD the estimate matches within 1%.
 * @param records iterable of cost-state modelUsage objects
 */
export function checkRates(records, rates) {
  const per = {};
  for (const mu of records) {
    for (const [model, u] of Object.entries(mu || {})) {
      if (typeof u?.costUSD !== 'number' || u.costUSD <= 0) continue;
      const p = (per[model] ??= { model, sessions: 0, within1pct: 0, maxRelErr: 0, rate: rateFor(rates, model) });
      p.sessions++;
      const est = costOf({ input: u.inputTokens, cacheRead: u.cacheReadInputTokens, cacheCreate: u.cacheCreationInputTokens, output: u.outputTokens }, p.rate);
      if (est == null) continue;
      const rel = Math.abs(est - u.costUSD) / u.costUSD;
      if (rel <= 0.01) p.within1pct++;
      if (rel > p.maxRelErr) p.maxRelErr = rel;
    }
  }
  return Object.values(per).sort((a, b) => b.sessions - a.sessions);
}
