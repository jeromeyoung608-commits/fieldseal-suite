/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Standalone self-test for GDPR PII redaction in export (pure, never mutates the source manifest).
// Run: node pwa/helpers/test-redact-pii.mjs
import { redactPii } from './case-export.js';

let failures = 0;
function assert(cond, msg) { if (cond) console.log(' ok - ' + msg); else { console.log(' FAIL- ' + msg); failures++; } }

function main() {
 console.log('[redact-pii]');
 const c = {
 rootHash: 'sha256:abc', sealHash: 'sha256:def',
 caseMeta: {
 operatorProfile: { operatorName: 'Jane Doe', operatorId: 'OP-1' },
 operatorIdentity: { operatorId: 'OP-1', fullName: 'Jane Doe', contactRef: 'jane@x.com' },
 deviceUserAgent: 'Mozilla/5.0'
 }
 };
 const r = redactPii(c, true);
 assert(r.caseMeta.operatorProfile.operatorName === 'REDACTED', 'operatorName masked');
 assert(r.caseMeta.operatorIdentity.fullName === 'REDACTED', 'identity fullName masked');
 assert(r.caseMeta.operatorIdentity.contactRef === 'REDACTED', 'identity contactRef masked');
 assert(r.caseMeta.deviceUserAgent === 'REDACTED', 'deviceUserAgent masked');
 // trust root untouched in the clone AND original never mutated
 assert(r.rootHash === 'sha256:abc' && r.sealHash === 'sha256:def', 'rootHash/sealHash preserved in clone');
 assert(c.caseMeta.operatorProfile.operatorName === 'Jane Doe', 'original manifest NOT mutated');
 // non-redacted build leaves fields intact
 const n = redactPii(c, false);
 assert(n.caseMeta.operatorProfile.operatorName === 'Jane Doe', 'no-redact leaves fields intact');

 console.log(failures === 0 ? '\nALL REDACT-PII TESTS PASSED' : '\n' + failures + ' REDACT-PII TEST(S) FAILED');
 process.exit(failures === 0 ? 0 : 1);
}
main();
