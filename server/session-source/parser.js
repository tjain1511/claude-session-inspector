// Incremental JSONL reader. Works on byte offsets so a session that is still being
// written to can be re-read from where we left off. A trailing line without a newline
// is treated as a partial write and left for the next read.
import fs from 'node:fs';

const NL = 0x0a;

/**
 * Read records from `file` starting at byte `offset` and line number `line`.
 * Returns { records, errors, offset, line, size, partial }.
 *  - records: [{ line, offset, length, obj }]
 *  - errors:  [{ line, offset, message }]  (lines that were not valid JSON)
 *  - offset:  byte offset that the next read should start from
 *  - partial: true when the file ended mid-line (write in progress)
 */
export function readJsonlFrom(file, { offset = 0, line = 1, maxBytes = Infinity } = {}) {
  const fd = fs.openSync(file, 'r');
  try {
    const stat = fs.fstatSync(fd);
    const size = stat.size;
    if (offset > size) {
      // File was truncated/rewritten: caller must restart from 0.
      return { records: [], errors: [], offset: 0, line: 1, size, partial: false, truncated: true };
    }
    const want = Math.min(size - offset, maxBytes);
    const buf = Buffer.allocUnsafe(want);
    let read = 0;
    while (read < want) {
      const n = fs.readSync(fd, buf, read, want - read, offset + read);
      if (n === 0) break;
      read += n;
    }
    const records = [];
    const errors = [];
    let start = 0;
    let curLine = line;
    let consumed = 0;
    let partial = false;
    while (start < read) {
      const nl = buf.indexOf(NL, start);
      if (nl === -1) {
        partial = offset + read >= size; // no newline before EOF -> in-progress write
        break;
      }
      const end = nl;
      const lineBuf = buf.subarray(start, end);
      const trimmed = lineBuf.toString('utf8').trim();
      if (trimmed.length) {
        try {
          records.push({ line: curLine, offset: offset + start, length: end - start, obj: JSON.parse(trimmed) });
        } catch (e) {
          errors.push({ line: curLine, offset: offset + start, message: e.message.slice(0, 200) });
        }
      }
      consumed = nl + 1;
      start = consumed;
      curLine++;
    }
    return { records, errors, offset: offset + consumed, line: curLine, size, partial, truncated: false, mtimeMs: stat.mtimeMs };
  } finally {
    fs.closeSync(fd);
  }
}

/** Read a single record by its byte offset (fast path for "view raw"). */
export function readRecordAt(file, offset, length) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.allocUnsafe(length);
    fs.readSync(fd, buf, 0, length, offset);
    return JSON.parse(buf.toString('utf8'));
  } finally {
    fs.closeSync(fd);
  }
}

/** Read the record on a given line number (scans; used when offsets are unknown). */
export function readRecordAtLine(file, lineNo) {
  const { records } = readJsonlFrom(file);
  const r = records.find((x) => x.line === lineNo);
  return r ? r.obj : null;
}
