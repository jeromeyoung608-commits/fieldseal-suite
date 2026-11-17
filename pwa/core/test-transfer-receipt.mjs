/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Standalone self-test for P0-3 (transfer receipt / handover acknowledgment, HASH-BOUND custody event).
// Run: node pwa/core/test-transfer-receipt.mjs
import { createCase, recordTransferReceipt, sealCase, validateCaseManifest } from './case-manifest.js';

let failures = 0;
function assert(cond, msg) {
 if (cond) console.log(' ok - ' + msg);
 else { console.log(' FAIL- ' + msg); failures++; }
}

async function main() {
 console.log('[transferReceipt]');

 // 1) record appends a Transferred custody event carrying recipient block
 let c = await createCase({ metaTemplate: 'blank', caseMeta: {} });
 c = await recordTransferReceipt(c, { recipient: { name: 'Bob', title: 'Lab Tech', org: 'State Lab', acknowledged: true } });
 const ev = c.custodyLog.find((e) => e.eventType === 'Transferred' && e.recipient);
 assert(ev, 'transferred custody event with recipient appended');
 assert(ev.recipient.name === 'Bob' && ev.recipient.acknowledged === true, 'recipient fields persisted');

 // 2) HASH-BOUND: rootHash & sealHash change (custodyLog is in the aggregate)
 const rootBefore = c.rootHash, sealBefore = c.sealHash;
 const c2 = await recordTransferReceipt(c, { recipient: { name: 'Carol', acknowledged: false } });
 assert(c2.rootHash !== rootBefore, 'rootHash changes after recording receipt (hash-bound)');
 assert(c2.sealHash !== sealBefore, 'sealHash changes after recording receipt (hash-bound)');

 // 3) sealed case rejects further receipt
 let sealed = await sealCase(c2, { actorName: 'Tester' });
 let locked = false;
 try { await recordTransferReceipt(sealed, { recipient: { name: 'Dan' } }); } catch (e) { locked = /sealed/.test(e.message); }
 assert(locked, 'recording after seal is rejected (locked)');

 // 4) validation: missing recipient name rejected
 assert(!validateCaseManifest({ ...(await createCase({ metaTemplate: 'blank' })), custodyLog: [{ eventType: 'Transferred', recipient: { acknowledged: true } }] }).ok, 'recipient without name rejected by validateCaseManifest');
 let t2 = false;
 try { await recordTransferReceipt(await createCase({ metaTemplate: 'blank' }), { recipient: { name: '' } }); } catch (e) { t2 = /name/.test(e.message); }
 assert(t2, 'recordTransferReceipt requires recipient name');

 // 5) case without receipts validates ok (optional)
 assert(validateCaseManifest(await createCase({ metaTemplate: 'blank' })).ok, 'case without receipts validates ok');

 console.log(failures === 0 ? '\nALL TRANSFER-RECEIPT TESTS PASSED' : '\n' + failures + ' TRANSFER-RECEIPT TEST(S) FAILED');
 process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
