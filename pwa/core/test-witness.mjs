/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Standalone self-test for P1-2 (witness endorsement, HASH-BOUND).
// Run: node pwa/core/test-witness.mjs
import { createCase, addWitnessStatement, sealCase, validateCaseManifest } from './case-manifest.js';

let failures = 0;
function assert(cond, msg) {
 if (cond) console.log(' ok - ' + msg);
 else { console.log(' FAIL- ' + msg); failures++; }
}

async function main() {
 console.log('[witness]');

 // 1) add stores a witness statement in caseMeta (draft)
 let c = await createCase({ metaTemplate: 'blank', caseMeta: {} });
 c = await addWitnessStatement(c, { witnessName: 'Carol', witnessTitle: 'Bystander', statement: 'I observed the seizure.', witnessedAt: '2026-01-01T00:00:00Z' });
 assert(c.caseMeta && Array.isArray(c.caseMeta.witnessStatements) && c.caseMeta.witnessStatements.length === 1, 'witness statement stored');
 assert(c.caseMeta.witnessStatements[0].witnessName === 'Carol', 'witnessName persisted');

 // 2) HASH-BOUND: rootHash & sealHash change
 const rootBefore = c.rootHash, sealBefore = c.sealHash;
 const c2 = await addWitnessStatement(c, { witnessName: 'Dan', statement: 'Confirmed chain of custody.' });
 assert(c2.rootHash !== rootBefore, 'rootHash changes after witness (hash-bound)');
 assert(c2.sealHash !== sealBefore, 'sealHash changes after witness (hash-bound)');

 // 3) sealed verifies ok
 let sealed = await sealCase(c2, { actorName: 'Tester' });
 const v = await (await import('./case-manifest.js')).verifyCase(sealed);
 assert(v.coreResult === 'ok', 'sealed case with witness verifies ok');

 // 4) sealed rejects further writes
 let locked = false;
 try { await addWitnessStatement(sealed, { witnessName: 'X', statement: 'y' }); } catch (e) { locked = /sealed/.test(e.message); }
 assert(locked, 'witness write rejected after seal');

 // 5) validation: missing witnessName / statement rejected
 assert(!validateCaseManifest({ ...(await createCase({ metaTemplate: 'blank' })), caseMeta: { witnessStatements: [{ statement: 'x' }] } }).ok, 'witness without name rejected');
 assert(!validateCaseManifest({ ...(await createCase({ metaTemplate: 'blank' })), caseMeta: { witnessStatements: [{ witnessName: 'x' }] } }).ok, 'witness without statement rejected');
 let t2 = false;
 try { await addWitnessStatement(await createCase({ metaTemplate: 'blank' }), { witnessName: 'X' }); } catch (e) { t2 = /statement/.test(e.message); }
 assert(t2, 'addWitnessStatement requires statement');

 // 6) case without witness validates ok (optional)
 assert(validateCaseManifest(await createCase({ metaTemplate: 'blank' })).ok, 'case without witness validates ok');

 console.log(failures === 0 ? '\nALL WITNESS TESTS PASSED' : '\n' + failures + ' WITNESS TEST(S) FAILED');
 process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
