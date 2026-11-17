/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Standalone self-test for Task 2 (humanNotes, additive non-trust metadata).
// Run: node pwa/core/test-human-notes.mjs
import { createCase, addHumanNoteMeta, sealCase, validateCaseManifest } from './case-manifest.js';

let failures = 0;
function assert(cond, msg) {
 if (cond) console.log(' ok - ' + msg);
 else { console.log(' FAIL- ' + msg); failures++; }
}

async function main() {
 console.log('[humanNotes]');

 // 1) field note in draft; excluded from hashes (rootHash unchanged)
 let c = await createCase({ metaTemplate: 'blank' });
 const root0 = c.rootHash;
 c = await addHumanNoteMeta(c, { noteType: 'field', content: 'scene: consent obtained', authorOperatorId: 'OP-1' });
 assert((c.caseMeta.humanNotes || []).length === 1, 'field note appended in draft');
 assert(c.rootHash === root0, 'rootHash unchanged after adding non-hash note');
 assert(c.caseMeta.humanNotes[0].noteType === 'field' && c.caseMeta.humanNotes[0].createdAt, 'field note has type + createdAt');

 // 2) audit note forbidden before sealing
 let blocked = false;
 try { await addHumanNoteMeta(c, { noteType: 'audit', content: 'review' }); } catch (e) { blocked = /after sealing/.test(e.message); }
 assert(blocked, 'audit note rejected before sealing');

 // 3) seal, then field note frozen; audit note allowed only after seal
 c = await sealCase(c, { actorName: 'Tester' });
 assert(c.state === 'sealed', 'sealed');
 let frozen = false;
 try { await addHumanNoteMeta(c, { noteType: 'field', content: 'late field' }); } catch (e) { frozen = /frozen/.test(e.message); }
 assert(frozen, 'field note frozen after sealing');

 const rootSealed = c.rootHash;
 c = await addHumanNoteMeta(c, { noteType: 'audit', content: 'review: verified chain', authorOperatorId: 'OP-2' });
 assert((c.caseMeta.humanNotes || []).length === 2, 'audit note appended after sealing');
 assert(c.rootHash === rootSealed, 'rootHash unchanged after audit note (non-hash)');

 // 4) empty / invalid
 let empty = false, bad = false;
 try { await addHumanNoteMeta(c, { noteType: 'field', content: ' ' }); } catch (e) { empty = /required/.test(e.message); }
 try { await addHumanNoteMeta(c, { noteType: 'bogus', content: 'x' }); } catch (e) { bad = /noteType/.test(e.message); }
 assert(empty && bad, 'empty content and invalid noteType rejected');

 // 5) validation well-formedness
 const badCase = { ...c, caseMeta: { ...(c.caseMeta || {}), humanNotes: [{ noteType: 'field', content: 123 }] } };
 assert(!validateCaseManifest(badCase).ok, 'non-string humanNotes.content rejected by validateCaseManifest');

 // 6) old package without humanNotes validates ok
 assert(validateCaseManifest(c).ok, 'case without/with humanNotes validates ok');

 console.log(failures === 0 ? '\nALL HUMAN-NOTES TESTS PASSED' : '\n' + failures + ' HUMAN-NOTES TEST(S) FAILED');
 process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
