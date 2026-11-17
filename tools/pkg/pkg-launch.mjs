/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */
/**
 * pkg launcher (P2 — tools/pkg). A thin, read-only dispatcher that delegates to the backend scripts
 * already delivered under tools/. It does NOT re-implement any logic and does NOT touch the trusted
 * kernel hashes — it only forwards argv to the existing, independently-tested modules:
 *   media-verify   -> tools/media-verify.mjs          (media file hash + chain-of-custody manifest)
 *   batch-verify   -> tools/batch-verify.mjs          (parallel kernel verify, summary report)
 *   archive-agent  -> tools/archive-agent/archive-agent.mjs (read-only archive proxy; local + S3/R2)
 *   receipt-service-> tools/receipt-service/receipt-agent.mjs (receipt carrying sealHash digest)
 *   ntp-agent      -> tools/ntp-agent/ntp-proxy.mjs   (reference NTP time; see ntp-agent/README.md)
 * Run: node tools/pkg/pkg-launch.mjs <tool> [args...]
 */
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOLS = {
  'media-verify': resolve(__dirname, '..', 'media-verify.mjs'),
  'batch-verify': resolve(__dirname, '..', 'batch-verify.mjs'),
  'archive-agent': resolve(__dirname, '..', 'archive-agent', 'archive-agent.mjs'),
  'receipt-service': resolve(__dirname, '..', 'receipt-service', 'receipt-agent.mjs'),
  'ntp-agent': resolve(__dirname, '..', 'ntp-agent', 'ntp-proxy.mjs')
};

const [, , tool, ...rest] = process.argv;
if (!tool || !TOOLS[tool]) {
  process.stderr.write('usage: node tools/pkg/pkg-launch.mjs <' + Object.keys(TOOLS).join('|') + '> [args...]\n');
  process.exit(2);
}
const r = spawnSync(process.execPath, [TOOLS[tool], ...rest], { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
