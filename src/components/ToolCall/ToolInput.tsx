// Tool-specific input renderers. Falls back to highlighted JSON.
import { CodeBlock } from '@/components/CodeBlock/CodeBlock';
import { langFor, prettyJson } from '@/utils/highlight';

export function DiffView({ oldText, newText, file }: { oldText: string; newText: string; file?: string }) {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  return (
    <div className="diff-view">
      {file && <div className="file">{file}</div>}
      {oldLines.map((l, i) => (
        <div className="row del" key={'d' + i}>
          <span className="sign">-</span>
          <span>{l || ' '}</span>
        </div>
      ))}
      {newLines.map((l, i) => (
        <div className="row add" key={'a' + i}>
          <span className="sign">+</span>
          <span>{l || ' '}</span>
        </div>
      ))}
    </div>
  );
}

function KV({ obj, skip = [] }: { obj: Record<string, unknown>; skip?: string[] }) {
  const entries = Object.entries(obj).filter(([k]) => !skip.includes(k));
  if (!entries.length) return null;
  return (
    <div className="kv" style={{ marginBottom: 6 }}>
      {entries.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <span className="k">{k}</span>
          <span className={`v ${typeof v === 'string' ? '' : 'mono'}`}>{typeof v === 'string' ? v : prettyJson(v)}</span>
        </div>
      ))}
    </div>
  );
}

export function ToolInput({ tool, input, initialLines, query }: { tool: string; input: unknown; initialLines: number; query?: string }) {
  if (input == null) return <div className="help-text">(no input)</div>;
  if (typeof input !== 'object') return <CodeBlock code={String(input)} lang="text" compact initialLines={initialLines} highlightQuery={query} />;
  const i = input as Record<string, unknown>;
  if (i._truncated) return <CodeBlock code={String(i.preview || '')} lang="json" compact initialLines={initialLines} truncated fullLength={Number(i._length) || undefined} />;
  const s = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : undefined);

  switch (tool) {
    case 'Bash': {
      const cmd = s('command');
      return (
        <>
          <KV obj={i} skip={['command']} />
          {cmd !== undefined && <CodeBlock code={cmd} lang="shell" compact initialLines={initialLines} highlightQuery={query} wrapDefault />}
        </>
      );
    }
    case 'Edit': {
      const o = s('old_string');
      const n = s('new_string');
      if (o !== undefined && n !== undefined) {
        return (
          <>
            <KV obj={i} skip={['old_string', 'new_string', 'file_path']} />
            <DiffView oldText={o} newText={n} file={s('file_path')} />
          </>
        );
      }
      break;
    }
    case 'MultiEdit': {
      const edits = Array.isArray(i.edits) ? (i.edits as { old_string?: string; new_string?: string }[]) : null;
      if (edits) {
        return (
          <>
            <KV obj={i} skip={['edits']} />
            {edits.map((e, idx) => (
              <div key={idx} style={{ marginBottom: 6 }}>
                <DiffView oldText={e.old_string ?? ''} newText={e.new_string ?? ''} file={`edit ${idx + 1} of ${edits.length}`} />
              </div>
            ))}
          </>
        );
      }
      break;
    }
    case 'Write': {
      const c = s('content');
      if (c !== undefined) {
        return (
          <>
            <KV obj={i} skip={['content']} />
            <CodeBlock code={c} lang={langFor(s('file_path'))} title={s('file_path')} initialLines={initialLines} highlightQuery={query} />
          </>
        );
      }
      break;
    }
    case 'Agent':
    case 'Task': {
      const p = s('prompt');
      if (p !== undefined) {
        return (
          <>
            <KV obj={i} skip={['prompt']} />
            <CodeBlock code={p} lang="text" title="prompt" compact initialLines={initialLines} highlightQuery={query} />
          </>
        );
      }
      break;
    }
    default:
      break;
  }
  // Generic: short string fields as key/value, long ones as blocks, rest JSON
  const shortKeys = Object.keys(i).filter((k) => typeof i[k] !== 'string' || (i[k] as string).length <= 200);
  const longKeys = Object.keys(i).filter((k) => !shortKeys.includes(k));
  const shortObj: Record<string, unknown> = {};
  for (const k of shortKeys) shortObj[k] = i[k];
  const allSimple = shortKeys.every((k) => typeof i[k] === 'string' || typeof i[k] === 'number' || typeof i[k] === 'boolean');
  return (
    <>
      {allSimple && shortKeys.length > 0 ? <KV obj={shortObj} /> : shortKeys.length > 0 ? <CodeBlock code={prettyJson(shortObj)} lang="json" compact initialLines={initialLines} highlightQuery={query} /> : null}
      {longKeys.map((k) => (
        <CodeBlock key={k} code={String(i[k])} lang={k === 'command' ? 'shell' : 'text'} title={k} compact initialLines={initialLines} highlightQuery={query} wrapDefault />
      ))}
    </>
  );
}
