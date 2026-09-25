// Editable $/MTok rate table used to estimate the cost of sessions Claude Code has not
// priced yet. Shows, per model, how well the current rates reproduce the costs Claude Code
// itself recorded in this machine's transcripts, so a wrong rate is easy to spot.
import { useEffect, useState } from 'react';
import { api } from '@/services/api';
import type { PricingReport, Rate } from '@/types/session';
import { modelLabel } from '@/utils/format';

const FIELDS: { key: keyof Rate; label: string }[] = [
  { key: 'input', label: 'Input' },
  { key: 'cacheRead', label: 'Cache read' },
  { key: 'cacheWrite', label: 'Cache write' },
  { key: 'output', label: 'Output' },
];

export function PricingSettings() {
  const [report, setReport] = useState<PricingReport | null>(null);
  const [draft, setDraft] = useState<Record<string, Record<keyof Rate, string>>>({});
  const [newModel, setNewModel] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const r = await api.pricing();
      setReport(r);
      const d: typeof draft = {};
      for (const [m, rate] of Object.entries(r.rates)) d[m] = { input: String(rate.input), cacheRead: String(rate.cacheRead), cacheWrite: String(rate.cacheWrite), output: String(rate.output) };
      setDraft(d);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const save = async (rates: Record<string, Rate | null>) => {
    setBusy(true);
    setErr(null);
    try {
      setReport(await api.setRates(rates));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const apply = () => {
    const out: Record<string, Rate | null> = { ...(report?.overrides ?? {}) };
    for (const [m, d] of Object.entries(draft)) {
      const r = { input: Number(d.input), cacheRead: Number(d.cacheRead), cacheWrite: Number(d.cacheWrite), output: Number(d.output) };
      if (Object.values(r).some((v) => !Number.isFinite(v) || v < 0)) {
        setErr(`Rates for ${m} must be non-negative numbers`);
        return;
      }
      out[m] = r;
    }
    void save(out);
  };
  const remove = (m: string) => {
    const out: Record<string, Rate | null> = { ...(report?.overrides ?? {}), [m]: null };
    setDraft((d) => {
      const n = { ...d };
      delete n[m];
      return n;
    });
    void save(out);
  };
  const add = () => {
    const m = newModel.trim();
    if (!m) return;
    setDraft((d) => ({ ...d, [m]: { input: '0', cacheRead: '0', cacheWrite: '0', output: '0' } }));
    setNewModel('');
  };

  if (!report) return <div className="help-text">{err || 'Loading rates…'}</div>;
  const acc = new Map(report.accuracy.map((a) => [a.model, a]));
  const unpriced = report.accuracy.filter((a) => !a.rate);
  return (
    <div className="pricing">
      <table className="rate-table">
        <thead>
          <tr>
            <th>Model</th>
            {FIELDS.map((f) => <th key={f.key}>{f.label}</th>)}
            <th>Verified</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {Object.keys(draft).sort().map((m) => {
            const a = acc.get(m) ?? [...acc.values()].find((x) => x.model.replace(/\[\w+\]$/, '') === m || x.model === m.replace(/\[\w+\]$/, ''));
            return (
              <tr key={m}>
                <td className="mono" title={m}>{modelLabel(m)}{report.overrides[m] ? <span className="help-text"> edited</span> : null}</td>
                {FIELDS.map((f) => (
                  <td key={f.key}>
                    <input className="input rate" inputMode="decimal" value={draft[m]![f.key]} onChange={(e) => setDraft((d) => ({ ...d, [m]: { ...d[m]!, [f.key]: e.target.value } }))} aria-label={`${m} ${f.label} rate`} />
                  </td>
                ))}
                <td className="verify" title={a ? `Estimate matches Claude Code's recorded cost within 1% in ${a.within1pct} of ${a.sessions} sessions (worst ${(a.maxRelErr * 100).toFixed(1)}% off)` : report.overrides[m] ? 'Your own rate; no recorded costs for this model on this machine' : 'From the published Claude API price list (1-hour cache write); no recorded costs for this model on this machine yet'}>
                  {a ? <span className={a.within1pct === a.sessions ? 'ok' : a.within1pct / a.sessions > 0.8 ? '' : 'warn'}>{a.within1pct}/{a.sessions}</span> : <span className="help-text">{report.overrides[m] ? 'custom' : 'price list'}</span>}
                </td>
                <td><button type="button" className="btn ghost sm" onClick={() => remove(m)} title="Remove this model's rate">×</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {unpriced.length > 0 && (
        <div className="help-text" style={{ marginTop: 6 }}>
          Seen in your cost records but without a rate: {unpriced.map((u) => <code key={u.model} style={{ marginRight: 6 }}>{u.model}</code>)}
        </div>
      )}
      <div className="pricing-actions">
        <input className="input" placeholder="add model id, e.g. claude-opus-5-5" value={newModel} onChange={(e) => setNewModel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} aria-label="New model id" />
        <button type="button" className="btn ghost sm" onClick={add}>Add</button>
        <span className="grow" />
        <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void save({}).then(load)} title="Drop every override and go back to the built-in table">Reset to defaults</button>
        <button type="button" className="btn sm" disabled={busy} onClick={apply}>Save rates</button>
      </div>
      {err && <div className="error-text">{err}</div>}
      <p className="help-text">
        US$ per million tokens. Used only for sessions without a Claude Code cost record (live or unpriced ones); recorded costs are always shown as-is. "Verified" counts how many of your {report.recordedSessions} priced sessions the table reproduces to within 1%. Defaults marked with a count were fitted to those records; "price list" rows come from the published Claude API prices with the 1-hour cache-write rate, which is what Claude Code's recorded costs correspond to.
      </p>
    </div>
  );
}
