/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Operator identity (operatorIdentity) + humanNotes are HASH-BOUND since the delivery audit (B-06):
// they enter both rootHash and sealHash, so tampering with a sealed case makes verifyCase return
// `tampered`. This test locks that behaviour (previously they were excluded and tampering was invisible).
// NOTE: operatorIdentity is stored under caseMeta.operatorIdentity (not top-level).
import { createCase, sealCase, bindOperatorIdentity, verifyCase } from './case-manifest.js';

let pass = 0, fail = 0;
function assert(c, m) { if (c) { pass++; console.log(' ok - ' + m); } else { fail++; console.log(' FAIL- ' + m); } }

const id = {
 operatorId: 'OP-DEMO-001',
 fullName: 'Demo Operator',
 badgeId: 'B-7',
 org: 'FieldSeal Demo',
 role: 'Forensic Investigator',
 contactRef: 'mailto:demo@fieldseal.example',
 signatureFingerprint: 'SHA256:demo-fp'
};

const c = await createCase({ caseMeta: { caseReference: 'OPID-TEST', jurisdiction: 'DE-ZPO' } });
const rootBefore = c.rootHash;
const c2 = await bindOperatorIdentity(c, id);
assert(c2.caseMeta.operatorIdentity && c2.caseMeta.operatorIdentity.fullName === 'Demo Operator', 'operatorIdentity stored under caseMeta');
// hash-bound: editing identity must change rootHash now (it is part of the hashes)
assert(c2.rootHash !== rootBefore, 'rootHash changes after binding operatorIdentity (hash-bound)');

const sealed = await sealCase(c2, {});
const v1 = await verifyCase(sealed);
assert(v1.coreResult === 'ok', 'sealed case with operatorIdentity verifies ok');
assert(v1.rootHash === sealed.rootHash && v1.sealHash === sealed.sealHash, 'recomputed hashes match stored');

// --- tamper detection (the core B-06 guarantee) ---
// Simulate an attacker editing the file: change fullName in the loaded object, then re-verify.
const tampered = JSON.parse(JSON.stringify(sealed));
tampered.caseMeta.operatorIdentity.fullName = 'EVIL IMPOSTOR';
const v2 = await verifyCase(tampered);
assert(v2.coreResult === 'tampered', 'edited operatorIdentity → verifyCase returns tampered (B-06 fixed)');

// locked after seal: API refuses to change identity on a sealed case
let locked = false;
try { await bindOperatorIdentity(sealed, { ...id, fullName: 'Other' }); } catch (e) { locked = /sealed|state/i.test(e.message); }
assert(locked, 'bindOperatorIdentity refused on sealed case');

// clear must erase the field (on a draft — sealed cases forbid all mutations)
const c3 = await createCase({ caseMeta: { caseReference: 'OPID-CLR', jurisdiction: 'DE-ZPO' } });
const bound = await bindOperatorIdentity(c3, id);
assert(bound.caseMeta.operatorIdentity && bound.caseMeta.operatorIdentity.operatorId === 'OP-DEMO-001', 'draft bind ok');
const cleared = await bindOperatorIdentity(c3, null);
assert(!cleared.caseMeta.operatorIdentity, 'clear erases operatorIdentity on draft');

// validation: non-string fields rejected (fresh draft — c is already sealed above)
let rejected = false;
const cN = await createCase({ caseMeta: { caseReference: 'OPID-NS', jurisdiction: 'DE-ZPO' } });
try { await bindOperatorIdentity(cN, { operatorId: 123, fullName: 123, badgeId: 123, org: 123, signatureFingerprint: 123 }); }
catch (e) { rejected = /string/.test(e.message); }
assert(rejected, 'non-string identity fields rejected');

// bare identity (operatorId only) validates (fresh draft)
const cB = await createCase({ caseMeta: { caseReference: 'OPID-BARE', jurisdiction: 'DE-ZPO' } });
const bare = await bindOperatorIdentity(cB, { operatorId: 'OP-1' });
assert(bare.caseMeta.operatorIdentity && bare.caseMeta.operatorIdentity.operatorId === 'OP-1', 'bare operatorId validates');

console.log((fail ? 'FIELDSEAL-TEST-FAIL' : 'FIELDSEAL-TEST-OK') + ' operator-identity (' + pass + ' pass, ' + fail + ' fail)');
process.exit(fail ? 1 : 0);
