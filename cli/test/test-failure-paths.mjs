/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */
// 9.0 function item F2 — failure paths. Every negative scenario must return a structured
// { ok:false } result (or a clean rejection), never an unhandled exception or a silent ok.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { generateEd25519KeyPair, exportPublicKey, chainHead, verifySignedExport } from '../../pwa/helpers/audit-anchor.js';
import { verifyChainEntries } from '../../pwa/helpers/local-audit-log.js';

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok  - ' + name);
  else { console.error('  FAIL - ' + name + (detail ? ' :: ' + detail : '')); failures += 1; }
}
(async () => {
  const ROOT = resolve(process.cwd(), 'pwa');
  const anchorMod = await import(pathToFileURL(resolve(ROOT, 'helpers/audit-anchor.js')).href);

  const kp = await generateEd25519KeyPair(false);
  const spki = await exportPublicKey(kp);
  const tsa = await generateEd25519KeyPair(false);
  const tsaSpki = await exportPublicKey(tsa);
  const entries = [{ v: 2, id: 'e0', eventType: 'Ev0', prevHash: '0'.repeat(64), hash: await (await import('../../pwa/core/hash.js')).sha256Hex(JSON.stringify({ v: 2, id: 'e0', eventType: 'Ev0' })) }];
  const head = chainHead(entries);
  const { createTimestamp } = await import(pathToFileURL(resolve(ROOT, 'helpers/audit-tsa.js')).href);
  const tsaToken = await createTimestamp(head, { tsaKeyPair: tsa });
  const exp = await anchorMod.signedLogExport(entries, kp, { tsaToken });

  // 1. Wrong device key -> reject (no silent ok).
  const other = await generateEd25519KeyPair(false);
  const otherSpki = await exportPublicKey(other);
  const r1 = await verifySignedExport(exp, otherSpki, { trustedTsaSpki: tsaSpki });
  check('wrong device key is rejected (no silent ok)', r1.ok === false, r1.reason);

  // 2. Wrong TSA key -> reject.
  const otherTsa = await generateEd25519KeyPair(false);
  const r2 = await verifySignedExport(exp, spki, { trustedTsaSpki: await exportPublicKey(otherTsa) });
  check('wrong TSA key is rejected', r2.ok === false, r2.reason);

  // 3. Corrupted log payload -> structured fail, not throw.
  let threw = false; let r3;
  try { r3 = await verifySignedExport({ format: 'fieldseal-audit-export-v2', log: 'not-valid-json', head: 'x' }, spki, { trustedTsaSpki: tsaSpki }); }
  catch (e) { threw = true; }
  check('corrupted log payload -> structured fail, no throw', threw === false && r3 && r3.ok === false, threw ? 'threw' : (r3 && r3.reason));

  // 4. Unsigned / no-timestamp export -> fail.
  const r4 = await verifySignedExport({ format: 'fieldseal-audit-export-v2', log: JSON.stringify(entries, null, 2) }, spki, { trustedTsaSpki: tsaSpki });
  check('unsigned / no-timestamp export -> fail', r4.ok === false);

  // 5. Tampered entry -> chain fails.
  const tampered = JSON.parse(JSON.stringify(entries));
  tampered[0].hash = 'f'.repeat(64);
  const r5 = await verifyChainEntries(tampered);
  check('tampered entry -> chain fail', r5.ok === false, r5.reason);

  if (failures) { console.error('FAILURE-PATHS: FAIL (' + failures + ')'); process.exit(1); }
  console.log('FAILURE-PATHS: PASS — all negative scenarios return structured failures');
})().catch((e) => { console.error('FAILURE-PATHS: ERROR ' + e.message); process.exit(1); });
