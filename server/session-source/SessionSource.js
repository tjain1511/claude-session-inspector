/**
 * SessionSource is the only abstraction the HTTP layer talks to. Swap the
 * implementation if Claude Code changes how it stores transcripts on disk.
 *
 * interface SessionSource {
 *   discover(): Promise<DiscoveryReport>      // find and index every session file
 *   listSessions(): SessionSummary[]          // cheap, from the in-memory index
 *   readSession(id, { from }): SessionRead    // normalized events (incremental from a byte offset)
 *   readSubagent(id, agentId): SessionRead
 *   readRaw(id, fileKey, line): unknown       // the original JSON record
 *   search(query): string[]                   // session ids whose content matches
 *   watch(onChange): () => void               // filesystem watching, returns unsubscribe
 * }
 */
export class SessionSource {
  async discover() {
    throw new Error('not implemented');
  }
  listSessions() {
    throw new Error('not implemented');
  }
  readSession() {
    throw new Error('not implemented');
  }
  readSubagent() {
    throw new Error('not implemented');
  }
  readRaw() {
    throw new Error('not implemented');
  }
  search() {
    throw new Error('not implemented');
  }
  watch() {
    return () => {};
  }
}
