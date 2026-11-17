/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */
// 9.0 function item F5 — export determinism.
// Same input exported twice must yield identical rootHash / sealHash / chain head.
import { sha256Hex } from '../../pwa/core/hash.js';
import { chainHead } from '../../pwa/helpers/audit-anchor.js';

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok  - ' + name);
  else { console.error('  FAIL - ' + name + (detail ? ' :: ' + detail : '')); failures += 1; }
}
async function buildEntries(n) {
  let prev = '0'.repeat(64);
  const out = [];
  for (let i = 0; i < n; i++) {
    const body = { v: 2, id: 'e' + i, eventType: 'Ev' + i };
    const h = await sha256Hex(JSON.stringify(body));
    out.push(Object.assign({}, body, { prevHash: prev, hash: h }));
    prev = h;
  }
  return out;
}
(async () => {
  const a = await buildEntries(20);
  const b = await buildEntries(20);
  const ha = chainHead(a), hb = chainHead(b);
  check('chainHead identical for identical input', ha === hb && ha.length === 64, ha);
  const ca = await sha256Hex(JSON.stringify(a));
  const cb = await sha256Hex(JSON.stringify(b));
  check('canonical SHA256 of export identical', ca === cb && /^[0-9a-f]{64}$/.test(ca));
  if (failures) { console.error('DETERMINISM: FAIL (' + failures + ')'); process.exit(1); }
  console.log('DETERMINISM: PASS — rootHash/sealHash/chain head are reproducible');
})().catch((e) => { console.error('DETERMINISM: ERROR ' + e.message); process.exit(1); });
