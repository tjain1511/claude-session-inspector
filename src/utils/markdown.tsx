// Minimal, safe Markdown renderer for assistant text. Renders to React elements only;
// raw HTML in the source is shown as literal text. Links become plain text with the URL
// visible (the viewer is offline; nothing should be clickable to the outside).
import type { ReactNode } from 'react';
import { CodeBlock } from '@/components/CodeBlock/CodeBlock';
import { langFor } from './highlight';

type Block =
  | { k: 'code'; lang: string; body: string }
  | { k: 'h'; level: number; text: string }
  | { k: 'p'; text: string }
  | { k: 'ul'; items: string[]; ordered: boolean }
  | { k: 'quote'; text: string }
  | { k: 'hr' }
  | { k: 'table'; rows: string[][] };

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const fence = line.match(/^\s*(```+|~~~+)\s*([\w.+-]*)/);
    if (fence) {
      const close = fence[1]!;
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith(close.slice(0, 3))) body.push(lines[i]!), i++;
      i++;
      blocks.push({ k: 'code', lang: fence[2] || '', body: body.join('\n') });
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      blocks.push({ k: 'h', level: h[1]!.length, text: h[2]! });
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ k: 'hr' });
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i] ?? '')) {
        const cells = (lines[i] ?? '').trim().slice(1, -1).split('|').map((c) => c.trim());
        if (!cells.every((c) => /^:?-+:?$/.test(c))) rows.push(cells);
        i++;
      }
      blocks.push({ k: 'table', rows });
      continue;
    }
    const li = line.match(/^\s*(?:[-*+]|\d+[.)])\s+/);
    if (li) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length) {
        const l = lines[i] ?? '';
        const m = l.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
        if (m) items.push(m[1]!);
        else if (l.trim() && /^\s{2,}/.test(l) && items.length) items[items.length - 1] += '\n' + l.trim();
        else break;
        i++;
      }
      blocks.push({ k: 'ul', items, ordered });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i] ?? '')) q.push((lines[i] ?? '').replace(/^\s*>\s?/, '')), i++;
      blocks.push({ k: 'quote', text: q.join('\n') });
      continue;
    }
    const p: string[] = [line];
    i++;
    while (i < lines.length && (lines[i] ?? '').trim() && !/^\s*(```|~~~|#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\|)/.test(lines[i] ?? '')) p.push(lines[i]!), i++;
    blocks.push({ k: 'p', text: p.join('\n') });
  }
  return blocks;
}

/** Inline: `code`, **bold**, *em*, [text](url), autolinks. Everything else literal. */
export function inline(text: string, keyBase = 0): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`+)([\s\S]*?)\1|\*\*([^*]+)\*\*|__([^_]+)__|(?<![\w*])\*([^*\n]+)\*(?![\w*])|(?<![\w_])_([^_\n]+)_(?![\w_])|\[([^\]]+)\]\(([^)\s]+)\)|~~([^~]+)~~/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = keyBase;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[2] !== undefined) out.push(<code key={k++} className="md-code">{m[2]}</code>);
    else if (m[3] !== undefined) out.push(<strong key={k++}>{inline(m[3], k * 100)}</strong>);
    else if (m[4] !== undefined) out.push(<strong key={k++}>{inline(m[4], k * 100)}</strong>);
    else if (m[5] !== undefined) out.push(<em key={k++}>{inline(m[5], k * 100)}</em>);
    else if (m[6] !== undefined) out.push(<em key={k++}>{inline(m[6], k * 100)}</em>);
    else if (m[7] !== undefined) out.push(<span key={k++} className="md-link" title={m[8]}>{m[7]}<span className="md-link-url"> ({m[8]})</span></span>);
    else if (m[9] !== undefined) out.push(<s key={k++}>{m[9]}</s>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="md">
      {blocks.map((b, i) => {
        switch (b.k) {
          case 'code':
            return <CodeBlock key={i} code={b.body} lang={langFor(b.lang)} title={b.lang || undefined} compact />;
          case 'h': {
            const Tag = (`h${Math.min(6, b.level + 2)}` as unknown) as 'h3';
            return <Tag key={i} className={`md-h md-h${b.level}`}>{inline(b.text)}</Tag>;
          }
          case 'ul':
            return b.ordered ? (
              <ol key={i}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ol>
            ) : (
              <ul key={i}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>
            );
          case 'quote':
            return <blockquote key={i}>{inline(b.text)}</blockquote>;
          case 'hr':
            return <hr key={i} />;
          case 'table':
            return (
              <div key={i} className="md-table-wrap">
                <table className="md-table">
                  <thead>{b.rows[0] && <tr>{b.rows[0].map((c, j) => <th key={j}>{inline(c)}</th>)}</tr>}</thead>
                  <tbody>{b.rows.slice(1).map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody>
                </table>
              </div>
            );
          default:
            return <p key={i}>{inline(b.text)}</p>;
        }
      })}
    </div>
  );
}
