// Monospace block with line numbers, syntax highlighting, copy, wrap and progressive
// "show more" so enormous tool outputs never land in the DOM all at once.
import { useMemo, useState } from 'react';
import { highlight, type Lang } from '@/utils/highlight';
import { CopyButton } from '@/components/common/CopyButton';
import { Icon } from '@/components/common/Icon';

const STEP = 200;

export interface CodeBlockProps {
  code: string;
  lang?: Lang;
  title?: string;
  /** Lines shown before "show more" kicks in. Infinity for everything. */
  initialLines?: number;
  compact?: boolean;
  truncated?: boolean; // server truncated the source
  fullLength?: number;
  onLoadFull?: () => void;
  highlightQuery?: string;
  wrapDefault?: boolean;
}

function splitLines(s: string) {
  const lines = s.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function CodeBlock({ code, lang = 'text', title, initialLines = 40, compact = false, truncated, fullLength, onLoadFull, highlightQuery, wrapDefault }: CodeBlockProps) {
  const lines = useMemo(() => splitLines(code), [code]);
  const [shown, setShown] = useState(initialLines);
  const [wrap, setWrap] = useState(wrapDefault ?? (lang === 'text' || lang === 'markdown'));
  const visible = lines.length > shown ? lines.slice(0, shown) : lines;
  const showLn = lines.length > 3;
  const hidden = lines.length - visible.length;

  const rendered = useMemo(() => {
    const src = visible.join('\n');
    // Highlight the visible portion only and re-split into lines so numbering stays correct.
    const nodes = highlight(src, lang);
    const rows: React.ReactNode[][] = [[]];
    for (const n of nodes) {
      if (typeof n === 'string') {
        const parts = n.split('\n');
        parts.forEach((p, i) => {
          if (i > 0) rows.push([]);
          if (p) rows[rows.length - 1]!.push(p);
        });
      } else rows[rows.length - 1]!.push(n);
    }
    return rows;
  }, [visible, lang]);

  const q = highlightQuery?.trim().toLowerCase();
  const rowNodes = rendered.map((row, i) => {
    let content: React.ReactNode = row.length ? row : ' ';
    if (q && row.every((x) => typeof x === 'string') && (row.join('') as string).toLowerCase().includes(q)) {
      content = markMatches(row.join(''), q);
    }
    return (
      <div className="line" key={i}>
        {showLn && <span className="ln">{i + 1}</span>}
        <span className="lc">{content}</span>
      </div>
    );
  });

  return (
    <div className={`code-block ${compact ? 'compact' : ''}`}>
      {(title || !compact) && (
        <div className="cb-head">
          <span className="cb-title">{title || lang}</span>
          <span style={{ color: 'var(--text-3)' }}>{lines.length.toLocaleString()} lines{fullLength ? ` · ${(fullLength / 1024).toFixed(1)} KB` : ''}</span>
          <button type="button" className={`btn ghost sm ${wrap ? 'on' : ''}`} title={wrap ? 'Disable wrapping' : 'Wrap lines'} onClick={() => setWrap((w) => !w)} aria-pressed={wrap}>
            <Icon name="wrap" size={12} />
          </button>
          <CopyButton text={code} />
        </div>
      )}
      <pre className={`${wrap ? 'wrap' : ''} ${showLn ? '' : 'no-ln'}`}>{rowNodes}</pre>
      {(hidden > 0 || truncated) && (
        <div className="cb-more">
          {hidden > 0 && (
            <>
              <span>{hidden.toLocaleString()} more lines</span>
              <button type="button" onClick={() => setShown((s) => s + STEP)}>Show {Math.min(STEP, hidden)} more</button>
              <button type="button" onClick={() => setShown(Infinity)}>Show all</button>
            </>
          )}
          {hidden <= 0 && shown !== initialLines && lines.length > initialLines && (
            <button type="button" onClick={() => setShown(initialLines)}>Collapse</button>
          )}
          {truncated && (
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
              <Icon name="warn" size={12} /> Truncated at {(code.length / 1024).toFixed(0)} KB of {fullLength ? (fullLength / 1024).toFixed(0) : '?'} KB
              {onLoadFull && <button type="button" onClick={onLoadFull}>Load full</button>}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function markMatches(text: string, q: string): React.ReactNode {
  if (!q) return text;
  const lower = text.toLowerCase();
  const out: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  for (;;) {
    const j = lower.indexOf(q, i);
    if (j < 0) break;
    if (j > i) out.push(text.slice(i, j));
    out.push(<mark key={k++}>{text.slice(j, j + q.length)}</mark>);
    i = j + q.length;
  }
  if (i < text.length) out.push(text.slice(i));
  return out;
}
