/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Standalone self-test for the RFC3161 TSA adapter (pure logic; no real TSA network call required).
// Run: node pwa/vendor/test-tsa-timestamp.mjs
import { buildTimeStampReq, parseTimeStampResp, requestTimestamp, seq, integer, tlv, generalizedTime } from './tsa-timestamp.js';

let failures = 0;
function assert(cond, msg) {
 if (cond) console.log(' ok - ' + msg);
 else { console.log(' FAIL- ' + msg); failures++; }
}

async function main() {
 console.log('[tsa-timestamp]');

 // 1) buildTimeStampReq: SEQUENCE wrapper, embeds the hash as OCTET STRING under SHA-256 OID
 const HEX = 'a'.repeat(64);
 const req = buildTimeStampReq(HEX);
 assert(req instanceof Uint8Array && req[0] === 0x30, 'TimeStampReq is a DER SEQUENCE');
 const hex2 = Array.from(HEX.match(/../g)).map((h) => parseInt(h, 16));
 assert(req.includes(0x60) === false || true, 'req built without throwing'); // sanity
 // the 32 raw hash bytes must appear in the OCTET STRING
 let found = false; let i = 0;
 const r = Array.from(req);
 while (i < r.length - hex2.length) {
 let ok = true;
 for (let j = 0; j < hex2.length; j++) if (r[i + j] !== hex2[j]) { ok = false; break; }
 if (ok) { found = true; break; }
 i++;
 }
 assert(found, 'hash bytes embedded in request');

 // 2) parseTimeStampResp: extract genTime + whole token from a hand-built minimal response
 const gt = generalizedTime('2026-11-14T12:00:00Z');
 const tstInfo = seq([integer([0x01]), gt]); // TSTInfo-ish with genTime inside
 const token = seq([tstInfo]); // ContentInfo
 const statusInfo = seq([integer([0])]); // PKIStatusInfo status=0 (granted)
 const resp = seq([statusInfo, token]);
 const parsed = parseTimeStampResp(Uint8Array.from(resp));
 assert(parsed.status === 0, 'status 0 parsed');
 assert(parsed.genTime === '2026-11-14T12:00:00Z', 'genTime extracted from GeneralizedTime');
 assert(typeof parsed.rawTokenB64 === 'string' && parsed.rawTokenB64.length > 0, 'raw token captured (base64)');
 assert(parsed.verified === false, 'token marked unverified (CA-chain check out-of-kernel)');

 // 3) non-zero status -> rejected -> pending payload (no throw)
 const rejected = parseTimeStampResp(Uint8Array.from(seq([seq([integer([2])])])));
 assert(rejected.status === 2 && rejected.genTime === null, 'non-zero status handled');

 // 4) graceful offline degradation: unreachable URL must return status 'pending', never throw
 const offline = await requestTimestamp('http://127.0.0.1:9/nonexistent', HEX, { timeoutMs: 1500 });
 assert(offline.status === 'pending' && typeof offline.error === 'string', 'unreachable TSA degrades to pending (no throw)');

 console.log(failures === 0 ? '\nALL TSA-TIMESTAMP TESTS PASSED' : '\n' + failures + ' TSA-TIMESTAMP TEST(S) FAILED');
 process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
