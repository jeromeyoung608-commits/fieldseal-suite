/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Standalone self-test for P2 multi-person multi-control / dual-control approval gate.
// Run: node pwa/core/test-dual-control.mjs
import { createCase, setApprovalPolicy, recordApproval, requireApproval, sealCase, recordTransferReceipt, computeSealHash, computeRootHash } from './case-manifest.js';

let failures = 0;
function assert(cond, msg) {
 if (cond) console.log(' ok - ' + msg);
 else { console.log(' FAIL- ' + msg); failures++; }
}

async function main() {
 console.log('[dual-control]');

 // 1) policy default 2-of-2 over all three actions
 let c = await createCase({ metaTemplate: 'blank', caseMeta: {} });
 c = await setApprovalPolicy(c, { requiredK: 2, totalN: 2, actions: ['seal', 'export', 'transfer'] });
 assert(c.approvalPolicy && c.approvalPolicy.requiredK === 2 && c.approvalPolicy.totalN === 2, 'policy set 2-of-2, all actions');

 // 2) one approval -> pending; gate still blocks seal
 c = await recordApproval(c, { action: 'seal', approverId: 'op-A', approverName: 'Alice' });
 assert(c.approvalStatus.seal === 'pending', 'one approval -> pending');
 let blocked = false;
 try { requireApproval(c, 'seal'); } catch (e) { blocked = true; }
 assert(blocked, 'seal blocked until authorized');

 // 3) second distinct approver -> authorized; seal succeeds
 c = await recordApproval(c, { action: 'seal', approverId: 'op-B', approverName: 'Bob' });
 assert(c.approvalStatus.seal === 'authorized', 'two approvals -> authorized');
 let sealed = false;
 try { c = await sealCase(c, {}); sealed = true; } catch (e) { console.log(' seal err: ' + e.message); }
 assert(sealed, 'seal succeeds once authorized');

 // 4) no double-count by same approver
 let dup = false;
 try { await recordApproval(c, { action: 'seal', approverId: 'op-A' }); } catch (e) { dup = true; }
 assert(dup, 'duplicate approver rejected');

 // 5) transfer gating
 let c2 = await createCase({ metaTemplate: 'blank', caseMeta: {} });
 c2 = await setApprovalPolicy(c2, { requiredK: 2, totalN: 2, actions: ['transfer'] });
 let tBlocked = false;
 try { await recordTransferReceipt(c2, { recipient: { name: 'R' } }); } catch (e) { tBlocked = true; }
 assert(tBlocked, 'transfer blocked without approval');
 c2 = await recordApproval(c2, { action: 'transfer', approverId: 'op-A' });
 c2 = await recordApproval(c2, { action: 'transfer', approverId: 'op-B' });
 let tOk = false;
 try { await recordTransferReceipt(c2, { recipient: { name: 'R' } }); tOk = true; } catch (e) { console.log(' transfer err: ' + e.message); }
 assert(tOk, 'transfer succeeds once authorized');

 // 6) policy validation guards
 let c3 = await createCase({ metaTemplate: 'blank', caseMeta: {} });
 let badK = false;
 try { await setApprovalPolicy(c3, { requiredK: 1, totalN: 2 }); } catch (e) { badK = true; }
 assert(badK, 'requiredK < 2 rejected (multi-control minimum)');
 let badAction = false;
 try { await recordApproval(c3, { action: 'seal', approverId: 'x' }); } catch (e) { badAction = true; }
 assert(badAction, 'approval without policy rejected');

 // 7) no policy -> gate is a no-op (backward compatible)
 let c4 = await createCase({ metaTemplate: 'blank', caseMeta: {} });
 let noGate = false;
 try { requireApproval(c4, 'seal'); noGate = true; } catch (e) { /* should not happen */ }
 assert(noGate, 'no policy -> gate no-op');

 // 8) tamper-evident but sealHash-compatible: approvals change rootHash, NOT sealHash
 let c5 = await createCase({ metaTemplate: 'blank', caseMeta: {} });
 const sealBefore = await computeSealHash(c5);
 const rootBefore = await computeRootHash(c5);
 c5 = await setApprovalPolicy(c5, { requiredK: 2, totalN: 2, actions: ['seal'] });
 c5 = await recordApproval(c5, { action: 'seal', approverId: 'op-A' });
 c5 = await recordApproval(c5, { action: 'seal', approverId: 'op-B' });
 const sealAfter = await computeSealHash(c5);
 const rootAfter = await computeRootHash(c5);
 assert(sealBefore === sealAfter, 'approvals do NOT alter sealHash (v0.4 byte-compat)');
 assert(rootBefore !== rootAfter, 'approvals ARE tamper-evident in rootHash');

 console.log(failures === 0 ? '\nALL DUAL-CONTROL TESTS PASSED' : '\n' + failures + ' DUAL-CONTROL TEST(S) FAILED');
 process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
