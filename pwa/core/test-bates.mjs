/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Standalone self-test for P1-1 (Bates numbering, §10.2 additive config + child batesId).
// Run: node pwa/core/test-bates.mjs
import { createCase, configureBates, assignBates, sealCase, validateCaseManifest } from './case-manifest.js';

let failures = 0;
function assert(cond, msg) {
 if (cond) console.log(' ok - ' + msg);
 else { console.log(' FAIL- ' + msg); failures++; }
}

async function main() {
 console.log('[bates]');

 // 1) configureBates stores additive config; ADDITIVE => rootHash unchanged
 let c = await createCase({ metaTemplate: 'blank', caseMeta: {} });
 const r0 = c.rootHash;
 c = await configureBates(c, { enabled: true, prefix: 'FS-' });
 assert(c.caseMeta.bates && c.caseMeta.bates.enabled === true && c.caseMeta.bates.prefix === 'FS-', 'bates config stored');
 assert(c.rootHash === r0, 'configureBates is additive: rootHash unchanged');

 // 2) assignBates writes child.batesId (enters rootHash only) and increments counter
 c.children = [{ evidenceId: 'ev-1', rootHash: 'sha256:' + 'a'.repeat(64) }, { evidenceId: 'ev-2', rootHash: 'sha256:' + 'b'.repeat(64) }];
 const r1 = c.rootHash;
 c = await assignBates(c, 'ev-1');
 assert(c.children[0].batesId === 'FS-00001', 'first batesId assigned FS-00001');
 assert(c.rootHash !== r1, 'assignBates changes rootHash (child batesId bound)');
 c = await assignBates(c, 'ev-2');
 assert(c.children[1].batesId === 'FS-00002', 'second batesId assigned FS-00002');

 // 3) assignBates requires enabled config
 let c2 = await createCase({ metaTemplate: 'blank' });
 c2.children = [{ evidenceId: 'ev-x' }];
 let threw = false;
 try { await assignBates(c2, 'ev-x'); } catch (e) { threw = /enabled/.test(e.message); }
 assert(threw, 'assignBates rejects when bates not enabled');

 // 4) sealed rejects writes
 let sealed = await sealCase(c, { actorName: 'Tester' });
 let locked = false;
 try { await assignBates(sealed, 'ev-1'); } catch (e) { locked = /sealed/.test(e.message); }
 assert(locked, 'bates write rejected after seal');

 // 5) validation: bad next rejected
 assert(!validateCaseManifest({ ...(await createCase({ metaTemplate: 'blank' })), caseMeta: { bates: { enabled: true, next: 0 } } }).ok, 'bates.next < 1 rejected');
 // 6) case without bates validates ok (optional)
 assert(validateCaseManifest(await createCase({ metaTemplate: 'blank' })).ok, 'case without bates validates ok');

 console.log(failures === 0 ? '\nALL BATES TESTS PASSED' : '\n' + failures + ' BATES TEST(S) FAILED');
 process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
