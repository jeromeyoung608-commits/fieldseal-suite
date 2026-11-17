/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * Read-only audit-log archive core (zero runtime dependencies; Node built-ins only).
 *
 * SCOPE (per the backend backlog, P0 #3):
 *   - Archives ONLY read-only audit-log entries + the case rootHash.
 *   - NEVER receives or stores the original evidence package.
 *   - Append-only store with a hash-chain for tamper-evidence.
 *   - Pluggable backend: local filesystem (default) or S3/R2 (see s3r2.mjs).
 *   - GDPR: source-host / operator identifiers are redacted by default; local deployment keeps
 *     data on the operator's own infrastructure.
 *   - The backend ONLY receives, stores and indexes. It does NOT recompute trust hashes — the
 *     trust root stays the locally produced case package, exactly as in the PWA / CLI.
 *
 * This module is a distribution/ops adapter. It does not alter any pwa/core or cli/core logic.
 */
import { createHash, randomUUID } from 'node:crypto';

export const HEADER_MARK = 'FieldSeal Suite — Copyright (c) 2026';

// Fields that, by default, must not leave the local deployment (GDPR data minimization).
// They are hashed (blinded) before archival so the record remains useful for integrity/ordering
// without retaining identifying PII.
const DEFAULT_REDACT_FIELDS = ['sourceHost', 'operatorId', 'caseId'];

function sha256Hex(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/**
 * Redact PII fields at ANY depth: replace with a salted blind (sha256) so the value is neither
 * stored nor recoverable, but collisions/grouping remain possible for integrity purposes. `salt`
 * is per-run and never stored alongside (operator keeps it separately, or leaves it empty).
 */
export function redactEntry(entry, { redactFields = DEFAULT_REDACT_FIELDS, salt = '' } = {}) {
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out = {};
      for (const [k, val] of Object.entries(v)) {
        out[k] = redactFields.includes(k) && val != null
          ? 'blind:' + sha256Hex(salt + '|' + String(val))
          : walk(val);
      }
      return out;
    }
    return v;
  };
  return walk(entry);
}

/**
 * Append-only hash-chained log over a backend implementing:
 *   - appendLine(line: string): Promise<void>
 *   - readLines(): Promise<string[]>
 * Each line is a JSON object carrying its own entry hash and the previous line's hash, forming a
 * tamper-evident chain. Verification recomputes the chain and fails on any break.
 */
export class AppendLog {
  constructor(backend, { salt = '' } = {}) {
    this.backend = backend;
    this.salt = salt;
  }

  async append(entry) {
    const redacted = redactEntry(entry, { salt: this.salt });
    const lines = await this.backend.readLines();
    const prevHash = lines.length
      ? JSON.parse(lines[lines.length - 1]).entryHash
      : 'GENESIS';
    const record = {
      seq: lines.length + 1,
      receivedUtc: new Date().toISOString(),
      recordId: randomUUID(),
      prevHash,
      entry: redacted
    };
    const canonical = JSON.stringify(record);
    record.entryHash = sha256Hex(canonical + this.salt);
    const line = JSON.stringify(record);
    // Re-bind entryHash computed over the final line to keep the wire form consistent.
    await this.backend.appendLine(line);
    return record.recordId;
  }

  /** Returns verified records. Throws on chain break or hash mismatch. */
  async readVerified() {
    const lines = await this.backend.readLines();
    const records = [];
    let prevHash = 'GENESIS';
    for (const line of lines) {
      const rec = JSON.parse(line);
      const recomputed = sha256Hex(JSON.stringify({ ...rec, entryHash: undefined }) + this.salt);
      if (recomputed !== rec.entryHash) throw new Error('entry hash mismatch at seq ' + rec.seq);
      if (rec.prevHash !== prevHash) throw new Error('chain break at seq ' + rec.seq);
      prevHash = rec.entryHash;
      records.push(rec);
    }
    return records;
  }
}
