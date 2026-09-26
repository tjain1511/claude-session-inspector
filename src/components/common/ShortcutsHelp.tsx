import { Modal } from './Modal';
import { MOD } from '@/utils/format';

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Navigation',
    rows: [
      [`${MOD} K`, 'Search sessions (prompts, tools, output)'],
      [`${MOD} B`, 'Show / hide the session list'],
      ['↑ ↓', 'Move through sessions (list focused)'],
      ['Enter', 'Open focused session'],
      ['F2', 'Rename focused session'],
      [`${MOD} R`, 'Rescan sessions'],
      ['M', 'Memory: what Claude remembers across sessions'],
    ],
  },
  {
    title: 'Session',
    rows: [
      ['1 2 3', 'Flow · Timeline · Context view'],
      [`${MOD} F`, 'Find within the session'],
      ['J K', 'Next / previous event'],
      ['] [', 'Next / previous error'],
      ['E', 'Expand / collapse all cards'],
      ['O', 'Toggle the turn outline'],
      ['I', 'Session details'],
    ],
  },
  {
    title: 'General',
    rows: [
      ['Esc', 'Close inspector, drawer or search'],
      ['?', 'This help'],
    ],
  },
];

export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      {GROUPS.map((g) => (
        <div key={g.title} className="shortcut-group">
          <h4>{g.title}</h4>
          <div className="shortcuts">
            {g.rows.map(([k, d]) => (
              <div key={k} style={{ display: 'contents' }}>
                <span>{k.split(' ').map((x, i) => <kbd key={i} style={{ marginRight: 3 }}>{x}</kbd>)}</span>
                <span>{d}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </Modal>
  );
}
