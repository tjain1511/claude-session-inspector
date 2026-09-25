import { DEFAULT_FILTERS, isDefaultFilters, type Activity, type Filters as F, type TimeRange } from '@/features/search/filters';
import { Icon } from '@/components/common/Icon';
import { modelLabel } from '@/utils/format';

const TIME: { v: TimeRange; label: string }[] = [
  { v: 'all', label: 'Any time' },
  { v: 'today', label: 'Today' },
  { v: 'yesterday', label: 'Yesterday' },
  { v: '7d', label: 'Last 7 days' },
  { v: '30d', label: 'Last 30 days' },
  { v: 'custom', label: 'Custom range…' },
];
const ACTIVITY: { v: Activity; label: string; title: string }[] = [
  { v: 'tools', label: 'Tools', title: 'Has tool calls' },
  { v: 'errors', label: 'Errors', title: 'Has tool or API errors' },
  { v: 'long', label: 'Long', title: 'Over 30 minutes or 60+ messages' },
  { v: 'active', label: 'Active', title: 'Running now or updated in the last 2 minutes' },
  { v: 'subagents', label: 'Agents', title: 'Spawned sub-agents' },
  { v: 'renamed', label: 'Renamed', title: 'Has a custom name' },
];

interface Props {
  filters: F;
  onChange: (f: F) => void;
  projects: { raw: string; path: string; name: string; count: number }[];
  models: { name: string; count: number }[];
}

export function Filters({ filters, onChange, projects, models }: Props) {
  const toggle = (a: Activity) =>
    onChange({ ...filters, activity: filters.activity.includes(a) ? filters.activity.filter((x) => x !== a) : [...filters.activity, a] });
  return (
    <div className="filters" role="group" aria-label="Filters">
      <div className="filter-row" style={{ width: '100%' }}>
        <select className="select" value={filters.time} onChange={(e) => onChange({ ...filters, time: e.target.value as TimeRange })} aria-label="Time range">
          {TIME.map((t) => (
            <option key={t.v} value={t.v}>{t.label}</option>
          ))}
        </select>
        <select className="select" value={filters.project} onChange={(e) => onChange({ ...filters, project: e.target.value })} aria-label="Project">
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.raw} value={p.raw}>{p.name} ({p.count})</option>
          ))}
        </select>
        {models.length > 1 && (
          <select className="select" value={filters.model} onChange={(e) => onChange({ ...filters, model: e.target.value })} aria-label="Model" style={{ maxWidth: 110 }}>
            <option value="">All models</option>
            {models.map((m) => (
              <option key={m.name} value={m.name}>{modelLabel(m.name)} ({m.count})</option>
            ))}
          </select>
        )}
      </div>
      {filters.time === 'custom' && (
        <div className="filter-row" style={{ width: '100%' }}>
          <input className="input" type="date" value={filters.customFrom || ''} onChange={(e) => onChange({ ...filters, customFrom: e.target.value })} aria-label="From date" style={{ height: 24, fontSize: 12 }} />
          <input className="input" type="date" value={filters.customTo || ''} onChange={(e) => onChange({ ...filters, customTo: e.target.value })} aria-label="To date" style={{ height: 24, fontSize: 12 }} />
        </div>
      )}
      <div className="filter-row" style={{ width: '100%', flexWrap: 'wrap', gap: 4 }}>
        {ACTIVITY.map((a) => (
          <button key={a.v} type="button" className={`chip ${filters.activity.includes(a.v) ? 'active' : ''}`} onClick={() => toggle(a.v)} title={a.title} aria-pressed={filters.activity.includes(a.v)}>
            {a.label}
          </button>
        ))}
        {!isDefaultFilters(filters) && (
          <button type="button" className="chip" onClick={() => onChange(DEFAULT_FILTERS)} title="Clear filters" style={{ marginLeft: 'auto' }}>
            <Icon name="x" size={10} /> Clear
          </button>
        )}
      </div>
    </div>
  );
}
