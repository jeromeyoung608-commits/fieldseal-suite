/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Standalone self-test for P0-2 (affidavit / sworn declaration, HASH-BOUND).
// Run: node pwa/core/test-affidavit.mjs
import { createCase, bindAffidavit, sealCase, validateCaseManifest } from './case-manifest.js';

let failures = 0;
function assert(cond, msg) {
 if (cond) console.log(' ok - ' + msg);
 else { console.log(' FAIL- ' + msg); failures++; }
}

async function main() {
 console.log('[affidavit]');

 // 1) bind stores the affidavit in caseMeta (draft)
 let c = await createCase({ metaTemplate: 'blank', caseMeta: {} });
 c = await bindAffidavit(c, { declarant: 'Alice', declarantTitle: 'Forensic Examiner', jurisdiction: 'US-NY', statements: ['I collected the evidence.', 'It was stored verbatim.'] });
 assert(c.caseMeta && c.caseMeta.affidavit, 'affidavit stored in caseMeta');
 assert(c.caseMeta.affidavit.declarant === 'Alice', 'declarant persisted');
 assert(Array.isArray(c.caseMeta.affidavit.statements) && c.caseMeta.affidavit.statements.length === 2, 'statements persisted');

 // 2) HASH-BOUND: rootHash & sealHash change
 const rootBefore = c.rootHash, sealBefore = c.sealHash;
 const c2 = await bindAffidavit(c, { declarant: 'Alice', statements: ['Different statement.'] });
 assert(c2.rootHash !== rootBefore, 'rootHash changes after binding affidavit (hash-bound)');
 assert(c2.sealHash !== sealBefore, 'sealHash changes after binding affidavit (hash-bound)');

 // 3) sealed verifies ok and hashes stay integral
 let sealed = await sealCase(c2, { actorName: 'Tester' });
 const v = await (await import('./case-manifest.js')).verifyCase(sealed);
 assert(v.coreResult === 'ok', 'sealed case with affidavit verifies ok');

 // 4) sealed rejects further binding
 let locked = false;
 try { await bindAffidavit(sealed, { declarant: 'X', statements: ['y'] }); } catch (e) { locked = /sealed/.test(e.message); }
 assert(locked, 'binding after seal is rejected (locked)');

 // 5) validation: missing declarant / empty statements rejected
 assert(!validateCaseManifest({ ...(await createCase({ metaTemplate: 'blank' })), caseMeta: { affidavit: { declarant: '', statements: [] } } }).ok, 'empty affidavit rejected by validateCaseManifest');
 let t2 = false;
 try { await bindAffidavit(await createCase({ metaTemplate: 'blank' }), { declarant: 'X', statements: [] }); } catch (e) { t2 = /non-empty/.test(e.message); }
 assert(t2, 'bindAffidavit rejects empty statements');
 let t3 = false;
 try { await bindAffidavit(await createCase({ metaTemplate: 'blank' }), { statements: ['x'] }); } catch (e) { t3 = /declarant/.test(e.message); }
 assert(t3, 'bindAffidavit requires declarant');

 // 6) clearing
 let c3 = await createCase({ metaTemplate: 'blank', caseMeta: {} });
 c3 = await bindAffidavit(c3, { declarant: 'Alice', statements: ['x'] });
 c3 = await bindAffidavit(c3, null);
 assert(!c3.caseMeta.affidavit, 'affidavit cleared to undefined');

 // 7) case without affidavit validates ok (optional)
 assert(validateCaseManifest(await createCase({ metaTemplate: 'blank' })).ok, 'case without affidavit validates ok');

 console.log(failures === 0 ? '\nALL AFFIDAVIT TESTS PASSED' : '\n' + failures + ' AFFIDAVIT TEST(S) FAILED');
 process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
