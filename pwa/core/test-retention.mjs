/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Standalone self-test for P1-3 (retention / legal hold, HASH-BOUND).
// Run: node pwa/core/test-retention.mjs
import { createCase, setRetention, sealCase, validateCaseManifest } from './case-manifest.js';

let failures = 0;
function assert(cond, msg) {
 if (cond) console.log(' ok - ' + msg);
 else { console.log(' FAIL- ' + msg); failures++; }
}

async function main() {
 console.log('[retention]');

 // 1) set stores retention / legal hold in caseMeta (draft)
 let c = await createCase({ metaTemplate: 'blank', caseMeta: {} });
 c = await setRetention(c, { legalHold: true, policy: '7y', holdUntil: '2033-01-01', holdReason: 'Litigation hold' });
 assert(c.caseMeta && c.caseMeta.retention && c.caseMeta.retention.legalHold === true, 'legal hold set');
 assert(c.caseMeta.retention.policy === '7y', 'retention policy persisted');

 // 2) HASH-BOUND: rootHash & sealHash change
 const rootBefore = c.rootHash, sealBefore = c.sealHash;
 const c2 = await setRetention(c, { legalHold: false });
 assert(c2.rootHash !== rootBefore, 'rootHash changes after retention (hash-bound)');
 assert(c2.sealHash !== sealBefore, 'sealHash changes after retention (hash-bound)');

 // 3) sealed verifies ok
 let sealed = await sealCase(c2, { actorName: 'Tester' });
 const v = await (await import('./case-manifest.js')).verifyCase(sealed);
 assert(v.coreResult === 'ok', 'sealed case with retention verifies ok');

 // 4) sealed rejects further writes
 let locked = false;
 try { await setRetention(sealed, { legalHold: true }); } catch (e) { locked = /sealed/.test(e.message); }
 assert(locked, 'retention write rejected after seal');

 // 5) validation: legalHold must be boolean
 assert(!validateCaseManifest({ ...(await createCase({ metaTemplate: 'blank' })), caseMeta: { retention: { legalHold: 'yes' } } }).ok, 'retention.legalHold non-boolean rejected');
 // 6) case without retention validates ok (optional)
 assert(validateCaseManifest(await createCase({ metaTemplate: 'blank' })).ok, 'case without retention validates ok');

 console.log(failures === 0 ? '\nALL RETENTION TESTS PASSED' : '\n' + failures + ' RETENTION TEST(S) FAILED');
 process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
