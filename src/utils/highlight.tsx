// Tiny dependency-free syntax highlighter. Produces React nodes, never HTML strings,
// so session content is always rendered as text.
import type { ReactNode } from 'react';

export type Lang = 'json' | 'code' | 'shell' | 'diff' | 'text' | 'markdown';

type Tok = { t: string; c?: string };

const KEYWORDS = new Set(
  (
    'const let var function return if else for while do switch case break continue new delete typeof instanceof in of class extends super this import export from default async await try catch finally throw yield static get got set null undefined true false ' +
    'def lambda pass raise with as is not and or elif except None True False print self ' +
    'fn pub mut impl struct enum match use mod trait where let ' +
    'func package type interface go chan select defer range map nil ' +
    'public private protected void int string boolean number any unknown never readonly abstract implements namespace declare module require'
  ).split(' '),
);

const SHELL_BUILTINS = new Set('cd ls cat echo grep find sed awk git npm node npx pnpm yarn curl mkdir rm cp mv chmod head tail sort uniq wc xargs export source sudo docker python python3 pip make cargo go tsc jq'.split(' '));

function tokenizeJson(src: string): Tok[] {
  const out: Tok[] = [];
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)|([{}[\],:])|(\s+)|(.)/gs;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[1] !== undefined) {
      if (m[2] !== undefined) out.push({ t: m[1], c: 'hl-key' }, { t: m[2], c: 'hl-punc' });
      else out.push({ t: m[1], c: 'hl-str' });
    } else if (m[3] !== undefined) out.push({ t: m[3], c: 'hl-num' });
    else if (m[4] !== undefined) out.push({ t: m[4], c: 'hl-kw' });
    else if (m[5] !== undefined) out.push({ t: m[5], c: 'hl-punc' });
    else out.push({ t: m[0] });
  }
  return out;
}

function tokenizeCode(src: string): Tok[] {
  const out: Tok[] = [];
  const re =
    /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|([{}()[\];,.<>=+\-*/%!&|^~?:]+)|(\s+)|(.)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[1] !== undefined) out.push({ t: m[1], c: 'hl-cmt' });
    else if (m[2] !== undefined) out.push({ t: m[2], c: 'hl-str' });
    else if (m[3] !== undefined) out.push({ t: m[3], c: 'hl-num' });
    else if (m[4] !== undefined) out.push({ t: m[4], c: KEYWORDS.has(m[4]) ? 'hl-kw' : undefined });
    else if (m[5] !== undefined) out.push({ t: m[5], c: 'hl-punc' });
    else out.push({ t: m[0] });
  }
  return out;
}

function tokenizeShell(src: string): Tok[] {
  const out: Tok[] = [];
  const re = /(#[^\n]*)|("(?:\\.|[^"\\])*"|'[^']*')|(\$\{?[\w@#?*-]+\}?)|(\s(?:--?[\w-]+))|(\b[\w./-]+\b)|([|&;<>()]+)|(\s+)|(.)/g;
  let atStart = true;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[1] !== undefined) out.push({ t: m[1], c: 'hl-cmt' });
    else if (m[2] !== undefined) out.push({ t: m[2], c: 'hl-str' });
    else if (m[3] !== undefined) out.push({ t: m[3], c: 'hl-var' });
    else if (m[4] !== undefined) out.push({ t: m[4], c: 'hl-flag' });
    else if (m[5] !== undefined) {
      out.push({ t: m[5], c: atStart || SHELL_BUILTINS.has(m[5]) ? 'hl-cmd' : undefined });
      atStart = false;
      continue;
    } else if (m[6] !== undefined) {
      out.push({ t: m[6], c: 'hl-punc' });
      atStart = true;
      continue;
    } else out.push({ t: m[0] });
    if (m[7] !== undefined && m[7].includes('\n')) atStart = true;
  }
  return out;
}

function tokenizeDiff(src: string): Tok[] {
  return src.split('\n').flatMap((line, i, arr) => {
    const c = line.startsWith('+') ? 'hl-add' : line.startsWith('-') ? 'hl-del' : line.startsWith('@@') ? 'hl-hunk' : undefined;
    const toks: Tok[] = [{ t: line, c }];
    if (i < arr.length - 1) toks.push({ t: '\n' });
    return toks;
  });
}

export function tokenize(src: string, lang: Lang): Tok[] {
  switch (lang) {
    case 'json':
      return tokenizeJson(src);
    case 'code':
      return tokenizeCode(src);
    case 'shell':
      return tokenizeShell(src);
    case 'diff':
      return tokenizeDiff(src);
    default:
      return [{ t: src }];
  }
}

/** Render tokens as spans. Cheap enough for the truncated sizes we show inline. */
export function highlight(src: string, lang: Lang): ReactNode[] {
  if (lang === 'text' || lang === 'markdown') return [src];
  const toks = tokenize(src, lang);
  return toks.map((tk, i) => (tk.c ? <span key={i} className={tk.c}>{tk.t}</span> : tk.t));
}

/** Guess a language from a file path or fenced-code info string. */
export function langFor(hint: string | undefined | null): Lang {
  if (!hint) return 'text';
  const h = hint.toLowerCase().trim();
  if (h === 'json' || h.endsWith('.json') || h === 'jsonc') return 'json';
  if (['sh', 'bash', 'zsh', 'shell', 'console'].includes(h) || /\.(sh|zsh|bash)$/.test(h)) return 'shell';
  if (h === 'diff' || h === 'patch') return 'diff';
  if (h === 'md' || h === 'markdown' || h.endsWith('.md')) return 'markdown';
  if (h === 'text' || h === 'txt' || h === 'plain' || h.endsWith('.txt') || h.endsWith('.log')) return 'text';
  if (/^(js|jsx|ts|tsx|javascript|typescript|py|python|rb|ruby|go|rs|rust|java|kt|kotlin|swift|c|cpp|h|hpp|cs|php|scala|sql|css|scss|html|xml|yaml|yml|toml|graphql|gql)$/.test(h)) return 'code';
  if (/\.(js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|cpp|h|hpp|cs|php|scala|sql|css|scss|html|xml|yaml|yml|toml|graphql|gql|vue|svelte)$/.test(h)) return 'code';
  return 'text';
}

export function looksLikeJson(s: string): boolean {
  const t = s.trim();
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));
}

export function prettyJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
