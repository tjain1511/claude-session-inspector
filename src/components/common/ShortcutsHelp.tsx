import { Modal } from './Modal';
import { MOD } from '@/utils/format';

const ROWS: [string, string][] = [
  [`${MOD} K`, 'Search sessions'],
  [`${MOD} B`, 'Show / hide the session list'],
  [`${MOD} R`, 'Refresh sessions'],
  [`${MOD} F`, 'Search within the open session'],
  ['↑ / ↓', 'Navigate sessions (when the list is focused)'],
  ['Enter', 'Open focused session'],
  ['F2', 'Rename focused session'],
  ['J / K', 'Next / previous event in the timeline'],
  ['E', 'Expand / collapse all tool cards'],
  ['I', 'Open metadata drawer'],
  ['O', 'Toggle the turn outline'],
  ['Esc', 'Close inspector, drawer or search'],
  ['?', 'This help'],
];

export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <div className="shortcuts">
        {ROWS.map(([k, d]) => (
          <div key={k} style={{ display: 'contents' }}>
            <span>{k.split(' ').map((x, i) => <kbd key={i} style={{ marginRight: 3 }}>{x}</kbd>)}</span>
            <span>{d}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
