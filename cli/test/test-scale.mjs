/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */
// 9.0 function item F3 — scale budget.
// 10,000 audit entries build + verify within a time/memory budget and do not crash;
// a 100MB evidence buffer hashes within a time budget.
import { sha256Hex, canonicalJson } from '../../pwa/core/hash.js';
import { chainHead } from '../../pwa/helpers/audit-anchor.js';
import { verifyChainEntries } from '../../pwa/helpers/local-audit-log.js';

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok  - ' + name + (detail ? ' (' + detail + ')' : ''));
  else { console.error('  FAIL - ' + name + (detail ? ' :: ' + detail : '')); failures += 1; }
}
(async () => {
  const N = 10000;
  let prev = '0'.repeat(64);
  const out = [];
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const entry = { v: 2, id: 'e' + i, eventType: 'Ev' + i, prevHash: prev };
    const h = await sha256Hex(canonicalJson(entry));
    entry.hash = h;
    out.push(entry);
    prev = h;
  }
  const buildMs = Date.now() - t0;
  check('built ' + N + ' entries', out.length === N, buildMs + 'ms');
  const mem0 = process.memoryUsage().heapUsed;

  const t1 = Date.now();
  const head = chainHead(out);
  const v = await verifyChainEntries(out);
  const verifyMs = Date.now() - t1;
  check('verifyChainEntries ok on 10k entries', v.ok === true, verifyMs + 'ms');
  const mem1 = process.memoryUsage().heapUsed;
  const usedMb = Math.max(0, (mem1 - mem0) / 1024 / 1024);
  check('heap growth within budget (<256MB)', usedMb < 256, usedMb.toFixed(1) + 'MB');

  // 100MB evidence buffer hash budget.
  const big = Buffer.alloc(100 * 1024 * 1024, 7);
  const t2 = Date.now();
  const bigHash = await sha256Hex(big);
  const bigMs = Date.now() - t2;
  check('hashed 100MB buffer', /^[0-9a-f]{64}$/.test(bigHash), bigMs + 'ms');

  // Budgets (advisory, not hard gates to keep CI light).
  check('build 10k < 5s', buildMs < 5000, buildMs + 'ms');
  check('verify 10k < 5s', verifyMs < 5000, verifyMs + 'ms');
  check('hash 100MB < 5s', bigMs < 5000, bigMs + 'ms');

  if (failures) { console.error('SCALE: FAIL (' + failures + ')'); process.exit(1); }
  console.log('SCALE: PASS — 10k entries + 100MB evidence within budget');
})().catch((e) => { console.error('SCALE: ERROR ' + e.message); process.exit(1); });
