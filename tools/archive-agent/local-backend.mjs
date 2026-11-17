/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * Local filesystem backend for the append-only archive (zero dependencies). One JSON-record per
 * line. Appends only — never rewrites. Suitable for on-prem / GDPR-local deployment.
 */
import { promises as fs } from 'node:fs';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export class LocalBackend {
  constructor(dir) {
    this.dir = dir;
    this.logPath = join(dir, 'audit-log.jsonl');
    this.indexPath = join(dir, 'audit-index.json');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  async appendLine(line) {
    await fs.appendFile(this.logPath, line + '\n', 'utf8');
  }

  async readLines() {
    let raw = '';
    try {
      raw = await fs.readFile(this.logPath, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
    return raw.split('\n').map((s) => s.trim()).filter(Boolean);
  }

  /** Lightweight index of seq/time/recordId/rootHash for fast queries (derived, not trusted). */
  async updateIndex(records) {
    const index = records.map((r) => ({
      seq: r.seq,
      receivedUtc: r.receivedUtc,
      recordId: r.recordId,
      rootHash: r.entry && r.entry.rootHash ? r.entry.rootHash : null
    }));
    await fs.writeFile(this.indexPath, JSON.stringify(index, null, 2), 'utf8');
    return index;
  }
}
