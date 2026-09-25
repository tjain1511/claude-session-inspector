import { useState } from 'react';
import type { StatusPayload } from '@/types/session';
import { Icon } from '@/components/common/Icon';

interface Props {
  status: StatusPayload | null;
  connectionError: string | null;
  onRetry: () => void;
  onChooseDir: (dir: string | null) => Promise<string | null>;
}

/** Shown in the main area when nothing can be displayed: no bridge, no data dir, permission error, no sessions. */
export function EmptyState({ status, connectionError, onRetry, onChooseDir }: Props) {
  const [dir, setDir] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setErr(null);
    const e = await onChooseDir(dir.trim() || null);
    setBusy(false);
    if (e) setErr(e);
    else setDir('');
  };
  const dirForm = (
    <>
      <div className="dir-form">
        <input className="input" placeholder="Path to Claude data directory, e.g. ~/.claude" value={dir} onChange={(e) => setDir(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} aria-label="Claude data directory" />
        <button type="button" className="btn primary" onClick={() => void submit()} disabled={busy}>Use directory</button>
      </div>
      {err && <div className="error-text" style={{ marginBottom: 10 }}>{err}</div>}
      <p className="help-text">The directory must contain a <code>projects</code> folder (Claude Code writes transcripts to <code>&lt;dir&gt;/projects/&lt;project&gt;/&lt;session&gt;.jsonl</code>). The default is <code>~/.claude</code> or <code>$CLAUDE_CONFIG_DIR</code>.</p>
    </>
  );
  const detected = status?.candidates?.length ? (
    <div className="detected">
      <h4>Detected locations</h4>
      <ul>
        {status.candidates.map((c) => (
          <li key={c.path}>
            <Icon name={c.usable ? 'check' : 'x'} size={12} className={c.usable ? 'status-success' : ''} />
            <code>{c.path}</code>
            <span style={{ color: 'var(--text-3)' }}>{c.source}{!c.exists ? ' · not found' : c.reason ? ` · ${c.reason}` : ''}</span>
          </li>
        ))}
      </ul>
    </div>
  ) : null;

  if (connectionError) {
    return (
      <div className="state-panel">
        <div className="state-card">
          <h2>Cannot reach the local bridge</h2>
          <p>The UI could not talk to the local server that reads your session files. It only listens on 127.0.0.1 and never leaves your machine.</p>
          <p className="error-text">{connectionError}</p>
          <div className="actions">
            <button type="button" className="btn primary" onClick={onRetry}><Icon name="refresh" /> Retry</button>
          </div>
        </div>
      </div>
    );
  }
  if (!status) return null;
  if (status.status === 'error') {
    const perm = status.errorCode === 'EACCES' || status.errorCode === 'EPERM';
    return (
      <div className="state-panel">
        <div className="state-card">
          <h2>{perm ? 'Unable to read Claude sessions' : 'No Claude data directory found'}</h2>
          <p>
            {perm ? (
              <>The application doesn't currently have permission to access <code>{status.projectsDir || status.dataDir}</code>.</>
            ) : (
              status.error
            )}
          </p>
          {status.explicit && !status.explicit.ok && (
            <p className="error-text">Configured directory <code>{status.explicit.path}</code>: {status.explicit.reason}</p>
          )}
          <div className="actions">
            <button type="button" className="btn" onClick={onRetry}><Icon name="refresh" /> Retry</button>
            {status.settings.dataDir && (
              <button type="button" className="btn" onClick={() => void onChooseDir(null)}>Use automatic discovery</button>
            )}
          </div>
          {dirForm}
          {detected}
        </div>
      </div>
    );
  }
  return (
    <div className="state-panel">
      <div className="state-card">
        <h2>No Claude sessions found</h2>
        <p>
          We couldn't find any Claude Code sessions in <code>{status.projectsDir}</code>. Once a session is available it will appear here automatically.
        </p>
        <div className="actions">
          <button type="button" className="btn" onClick={onRetry}><Icon name="refresh" /> Refresh</button>
          {status.settings.dataDir && (
            <button type="button" className="btn" onClick={() => void onChooseDir(null)}>Use automatic discovery</button>
          )}
        </div>
        {dirForm}
        {detected}
      </div>
    </div>
  );
}
