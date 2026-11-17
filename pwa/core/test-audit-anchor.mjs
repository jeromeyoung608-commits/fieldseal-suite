/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// P0/P1 self-test for audit-trail anchoring + device-key signed export + TSA timestamp
// anchor (dual independent keys). Run by cli/test/test-runner.js S-20 via spawnSync.
// Model under test: device-bound signing key AND a separate TSA key; verification against
// TRUSTED spkis (never keys inside the file). No private key ships in the product.
import { sha256Hex } from '../core/hash.js';
import {
 generateEd25519KeyPair, exportPublicKey, createAnchor, verifyAnchor,
 signedLogExport, verifySignedExport, chainHead
} from '../helpers/audit-anchor.js';
import { createTimestamp, verifyTimestamp } from '../helpers/audit-tsa.js';

let failures = 0;
function check(name, cond) {
 if (cond) console.log(' ok - ' + name);
 else { console.error(' FAIL - ' + name); failures += 1; }
}

async function buildChain(n) {
 let prev = '0'.repeat(64);
 const out = [];
 for (let i = 0; i < n; i++) {
 const body = { v: 2, id: 'e' + i, eventType: 'Ev' + i };
 const hash = await sha256Hex(JSON.stringify(body));
 out.push(Object.assign({}, body, { prevHash: prev, hash }));
 prev = hash;
 }
 return out;
}

(async () => {
 const entries = await buildChain(3);
 const head = chainHead(entries);
 check('chainHead returns last 64-hex hash', head === entries[2].hash && head.length === 64);

 // Two INDEPENDENT non-extractable keys (device signer + TSA authority), as in product.
 const kp = await generateEd25519KeyPair(false);
 const spki = await exportPublicKey(kp);
 const tsa = await generateEd25519KeyPair(false);
 const tsaSpki = await exportPublicKey(tsa);

 // ① Anchor unit (device key).
 const anchor = await createAnchor(entries, kp.privateKey);
 const v1 = await verifyAnchor(anchor, kp.publicKey, head);
 check('verifyAnchor ok on intact head', v1.ok === true);
 const v2 = await verifyAnchor(anchor, kp.publicKey, 'f'.repeat(64));
 check('verifyAnchor fails on head mismatch (tamper)', v2.ok === false && v2.reason === 'head mismatch');

 // ①b TSA timestamp token unit (separate authority key).
 const tok = await createTimestamp(head, { tsaKeyPair: tsa });
 const tv1 = await verifyTimestamp(tok, tsaSpki);
 check('TSA timestamp verifies against trusted TSA spki', tv1.ok === true);
 const tv2 = await verifyTimestamp(tok, spki); // wrong (device) key
 check('TSA timestamp REJECTED against wrong spki', tv2.ok === false);

 // ② Signed export — device signature + TSA timestamp, both verified against trusted spkis.
 const tsaToken = await createTimestamp(head, { tsaKeyPair: tsa });
 const exp = await signedLogExport(entries, kp, { tsaToken });
 check('signedLogExport uses the device public key', exp.devicePubKey === spki);
 check('signedLogExport carries a TSA timestamp token', !!exp.tsaToken);
 const ve1 = await verifySignedExport(exp, spki, { trustedTsaSpki: tsaSpki });
 check('verifySignedExport ok against trusted device + TSA keys', ve1.ok === true && ve1.count === 3);
 const tampered = JSON.parse(JSON.stringify(exp));
 tampered.log = tampered.log.replace(entries[2].hash, 'd'.repeat(64));
 const ve2 = await verifySignedExport(tampered, spki, { trustedTsaSpki: tsaSpki });
 check('verifySignedExport fails on tampered log', ve2.ok === false);

 // ③ FORGE: attacker mints a DIFFERENT device key AND a different TSA key and re-signs.
 // Verification uses trusted spkis, so both foreign signatures are rejected.
 const attacker = await generateEd25519KeyPair(false);
 const attackerTsa = await generateEd25519KeyPair(false);
 const forgedHead = chainHead(JSON.parse(tampered.log));
 const forged = {
 format: 'fieldseal-audit-export-v2',
 log: tampered.log,
 head: forgedHead,
 devicePubKey: await exportPublicKey(attacker),
 signature: await (await import('../helpers/audit-anchor.js')).signText(forgedHead, attacker.privateKey),
 tsaToken: await createTimestamp(forgedHead, { tsaKeyPair: attackerTsa }),
 generatedAt: new Date().toISOString()
 };
 const ve3 = await verifySignedExport(forged, spki, { trustedTsaSpki: tsaSpki });
 check('verifySignedExport REJECTS attacker re-signed export (device+TSA forge closed)', ve3.ok === false);

 // ④ Unsigned export (no signature, no timestamp) is rejected, not "ok".
 const unsign = { format: 'fieldseal-audit-export-v2', log: JSON.stringify(entries, null, 2) };
 const ve4 = await verifySignedExport(unsign, spki, { trustedTsaSpki: tsaSpki });
 check('verifySignedExport rejects unsigned/no-timestamp export', ve4.ok === false);

 // ⑤ mode-aware: 'off' export verifies but is NOT reported as "TSA ok".
 const offExp = await signedLogExport(entries, kp, { tsaMode: 'off' });
 const ve5 = await verifySignedExport(offExp, spki, { trustedTsaSpki: tsaSpki });
 check('verifySignedExport: off mode verifies but tsaStatus is "off" (never "TSA ok")',
 ve5.ok === true && ve5.tsaMode === 'off' && ve5.tsaStatus === 'off (no timestamp anchoring)');

 // ⑥ External RFC3161 token with WRONG kind is rejected (we never hand-roll ASN.1).
 const extMislabel = JSON.parse(JSON.stringify(exp));
 extMislabel.tsaMode = 'external';
 extMislabel.tsaToken = tok; // a local-tsa token mislabelled as external
 const ve6 = await verifySignedExport(extMislabel, spki, { trustedTsaSpki: tsaSpki });
 check('verifySignedExport: external token with wrong kind is REJECTED', ve6.ok === false);

 // ⑦ DER RFC3161 tokens are verified by doctor/openssl, NOT in-process.
 const ve7 = await verifySignedExport({ ...exp, tsaMode: 'external', tsaToken: { kind: 'rfc3161', token: 'BASE64', tsaRootSpki: tsaSpki } }, spki, { trustedTsaSpki: tsaSpki });
 check('verifySignedExport: genuine RFC3161 token flagged external-pending-doctor (not in-process)', ve7.ok === true && ve7.tsaExternalPendingDoctor === true);

 if (failures) { console.error('AUDIT-ANCHOR TEST: FAIL (' + failures + ')'); process.exit(1); }
 console.log('AUDIT-ANCHOR TEST: PASS');
})().catch((e) => { console.error('AUDIT-ANCHOR TEST: ERROR ' + e.message); process.exit(1); });
