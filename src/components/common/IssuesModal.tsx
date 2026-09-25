import { Modal } from './Modal';
import type { StatusPayload } from '@/types/session';

export function IssuesModal({ status, onClose, onOpenSession }: { status: StatusPayload | null; onClose: () => void; onOpenSession: (id: string) => void }) {
  const r = status?.report;
  return (
    <Modal title="Parsing issues" subtitle={r ? `${r.loaded} of ${r.sessions} loaded` : undefined} onClose={onClose}>
      {!r || r.issues.length === 0 ? (
        <p className="help-text">No issues. Every transcript parsed cleanly.</p>
      ) : (
        <div className="issues">
          <p className="help-text" style={{ marginTop: 0 }}>
            Files that could not be read or lines that were not valid JSON. Affected sessions still load with the readable parts; a malformed line is skipped, never blocks the rest.
          </p>
          <ul>
            {r.issues.map((it, i) => (
              <li key={i}>
                <div className="p">{it.path}</div>
                <div>{it.message}</div>
                {it.sessionId && (
                  <button type="button" className="btn ghost sm" onClick={() => { onOpenSession(it.sessionId!); onClose(); }}>Open session</button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
