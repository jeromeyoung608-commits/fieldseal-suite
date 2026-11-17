/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Standalone self-test for P1-4 (media redaction, rootHash-only derivative record, OUTSIDE sealHash).
// Run: node pwa/core/test-media-redaction.mjs
import { createCase, addMediaRedaction, sealCase, validateCaseManifest } from './case-manifest.js';

let failures = 0;
function assert(cond, msg) {
 if (cond) console.log(' ok - ' + msg);
 else { console.log(' FAIL- ' + msg); failures++; }
}

const H = (h) => 'sha256:' + h.padEnd(64, '0').slice(0, 64);

async function main() {
 console.log('[mediaRedaction]');

 // 1) add stores a dual-digest redaction record at top level (draft)
 let c = await createCase({ metaTemplate: 'blank', caseMeta: {} });
 c = await addMediaRedaction(c, {
 evidenceId: 'ev-1', method: 'blur', region: { x: 10, y: 20, w: 100, h: 50 },
 originalSha256: H('a'.repeat(64)), redactedSha256: H('b'.repeat(64))
 });
 assert(c.mediaRedactions && c.mediaRedactions.length === 1, 'media redaction stored at top level');
 assert(c.mediaRedactions[0].method === 'blur' && c.mediaRedactions[0].evidenceId === 'ev-1', 'method + evidenceId persisted');

 // 2) rootHash-only: rootHash changes, sealHash UNCHANGED (derivative, outside sealHash)
 const rootBefore = c.rootHash, sealBefore = c.sealHash;
 const c2 = await addMediaRedaction(c, { evidenceId: 'ev-2', originalSha256: H('c'.repeat(64)), redactedSha256: H('d'.repeat(64)) });
 assert(c2.rootHash !== rootBefore, 'rootHash changes after redaction (rootHash-only)');
 assert(c2.sealHash === sealBefore, 'sealHash unchanged (redaction is outside sealHash)');

 // 3) sealed rejects further writes
 let sealed = await sealCase(c2, { actorName: 'Tester' });
 let locked = false;
 try { await addMediaRedaction(sealed, { evidenceId: 'ev-3', originalSha256: H('e'.repeat(64)), redactedSha256: H('f'.repeat(64)) }); } catch (e) { locked = /sealed/.test(e.message); }
 assert(locked, 'media redaction rejected after seal');

 // 4) validation: malformed sha256 rejected
 assert(!validateCaseManifest({ ...(await createCase({ metaTemplate: 'blank' })), mediaRedactions: [{ evidenceId: 'ev', originalSha256: 'bad', redactedSha256: H('b'.repeat(64)) }] }).ok, 'bad originalSha256 rejected');
 let t2 = false;
 try { await addMediaRedaction(await createCase({ metaTemplate: 'blank' }), { evidenceId: 'ev', originalSha256: H('a'.repeat(64)), redactedSha256: 'bad' }); } catch (e) { t2 = /redactedSha256/.test(e.message); }
 assert(t2, 'addMediaRedaction requires valid redactedSha256');

 // 5) case without redactions validates ok (optional)
 assert(validateCaseManifest(await createCase({ metaTemplate: 'blank' })).ok, 'case without redactions validates ok');

 console.log(failures === 0 ? '\nALL MEDIA-REDACTION TESTS PASSED' : '\n' + failures + ' MEDIA-REDACTION TEST(S) FAILED');
 process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
