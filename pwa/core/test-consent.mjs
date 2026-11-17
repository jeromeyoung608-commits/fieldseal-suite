/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Standalone self-test for P0-1 (consent / lawful-basis record, HASH-BOUND).
// Run: node pwa/core/test-consent.mjs
import {
 createCase, bindConsentRecord, sealCase, validateCaseManifest, computeRootHash, computeSealHash
} from './case-manifest.js';

let failures = 0;
function assert(cond, msg) {
 if (cond) console.log(' ok - ' + msg);
 else { console.log(' FAIL- ' + msg); failures++; }
}

async function main() {
 console.log('[consentRecord]');

 // 1) bind stores the record in caseMeta (draft)
 let c = await createCase({ metaTemplate: 'blank', caseMeta: {} });
 c = await bindConsentRecord(c, { basis: 'consent', consentBy: 'Alice', authorityRef: 'WR-123' });
 assert(c.caseMeta && c.caseMeta.consentRecord, 'consentRecord stored in caseMeta');
 assert(c.caseMeta.consentRecord.basis === 'consent', 'basis persisted');
 assert(c.caseMeta.consentRecord.authorityRef === 'WR-123', 'authorityRef persisted');

 // 2) HASH-BOUND: differs from additive metadata — rootHash & sealHash MUST change
 const rootBefore = c.rootHash, sealBefore = c.sealHash;
 const c2 = await bindConsentRecord(c, { basis: 'legalCompulsion', consentBy: 'Bob' });
 assert(c2.rootHash !== rootBefore, 'rootHash changes after binding consent (hash-bound)');
 assert(c2.sealHash !== sealBefore, 'sealHash changes after binding consent (hash-bound)');

 // 3) tampering after SEAL must NOT mark tampered by hash exclusion -> it IS bound, so verify stays ok
 // but the recomputed hash must still equal the sealed hash (record integral).
 let sealed = await sealCase(c2, { actorName: 'Tester' });
 assert(sealed.state === 'sealed', 'case sealed');
 const v = await (await import('./case-manifest.js')).verifyCase(sealed);
 assert(v.coreResult === 'ok', 'sealed case with consent verifies ok');
 assert(v.rootHash === sealed.rootHash && v.sealHash === sealed.sealHash, 'recomputed hashes equal sealed hashes (consent integral)');

 // 4) sealed case rejects further binding (locked)
 let locked = false;
 try { await bindConsentRecord(sealed, { basis: 'consent' }); } catch (e) { locked = /sealed/.test(e.message); }
 assert(locked, 'binding after seal is rejected (locked)');

 // 5) clearing
 let c3 = await createCase({ metaTemplate: 'blank', caseMeta: {} });
 c3 = await bindConsentRecord(c3, { basis: 'consent', consentBy: 'X' });
 c3 = await bindConsentRecord(c3, null);
 assert(!c3.caseMeta.consentRecord, 'consent cleared to undefined');

 // 6) malformed basis rejected by validation
 const bad = validateCaseManifest({ ...c3, caseMeta: { ...(c3.caseMeta || {}), consentRecord: { basis: 'bogus' } } });
 assert(!bad.ok && bad.errors.some((e) => /consentRecord\.basis/.test(e)), 'invalid basis rejected by validateCaseManifest');

 // 7) invalid basis string rejected by bind
 let threw = false;
 try { await bindConsentRecord(await createCase({ metaTemplate: 'blank' }), { basis: 'nope' }); } catch (e) { threw = /basis/.test(e.message); }
 assert(threw, 'bindConsentRecord rejects unknown basis');

 // 8) case without consent validates ok (optional)
 assert(validateCaseManifest(await createCase({ metaTemplate: 'blank' })).ok, 'case without consent validates ok');

 console.log(failures === 0 ? '\nALL CONSENT-RECORD TESTS PASSED' : '\n' + failures + ' CONSENT-RECORD TEST(S) FAILED');
 process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
