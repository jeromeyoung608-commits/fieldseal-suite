/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Standalone self-test for Task 3 (envSnapshot, additive non-trust metadata).
// Run: node pwa/core/test-env-snapshot.mjs
import { createCase, attachEnvSnapshot, sealCase, validateCaseManifest } from './case-manifest.js';
import { captureEnvSnapshot } from '../helpers/env-snapshot.js';

let failures = 0;
function assert(cond, msg) {
 if (cond) console.log(' ok - ' + msg);
 else { console.log(' FAIL- ' + msg); failures++; }
}

async function main() {
 console.log('[envSnapshot]');

 // 1) capture gathers coarse context only; never camera hardware id / MAC / geolocation
 const fakeWin = {
 navigator: { userAgent: 'TestUA', language: 'en-US', languages: ['en-US', 'de'], onLine: false },
 screen: { width: 1920, height: 1080 },
 location: { href: 'https://example/capture' },
 document: { title: 'Capture' }
 };
 const snap = captureEnvSnapshot(fakeWin);
 assert(snap.userAgent === 'TestUA' && snap.language === 'en-US' && snap.online === 'no', 'captures coarse context');
 assert(snap.screenWidth === '1920' && snap.screenHeight === '1080', 'captures screen resolution');
 assert(snap.capturePageUrl === 'https://example/capture', 'captures capture page URL');
 const forbidden = ['macAddress', 'mac', 'cameraId', 'camera', 'serial', 'hardwareId', 'geolocation', 'gps'];
 assert(!Object.keys(snap).some((k) => forbidden.includes(k.toLowerCase())), 'no sensitive identifiers (no MAC/camera/serial/geo)');

 // 2) attach once in draft; excluded from hashes (rootHash unchanged)
 let c = await createCase({ metaTemplate: 'blank' });
 const root0 = c.rootHash;
 c = await attachEnvSnapshot(c, snap);
 assert(c.caseMeta && c.caseMeta.envSnapshot, 'envSnapshot attached in draft');
 assert(c.rootHash === root0, 'rootHash unchanged after attaching non-hash envSnapshot');

 // 3) immutable — second attach rejected
 let dup = false;
 try { await attachEnvSnapshot(c, snap); } catch (e) { dup = /already captured/.test(e.message); }
 assert(dup, 'second attach rejected (immutable)');

 // 4) locked after sealing
 c = await sealCase(c, { actorName: 'Tester' });
 assert(c.state === 'sealed', 'sealed');
 let locked = false;
 try { await attachEnvSnapshot(c, snap); } catch (e) { locked = /sealed|action/.test(e.message) || /require/.test(e.message); }
 assert(locked, 'attach rejected after sealing');

 // 5) validation well-formedness
 const badCase = { ...c, caseMeta: { ...(c.caseMeta || {}), envSnapshot: { userAgent: 123 } } };
 assert(!validateCaseManifest(badCase).ok, 'non-string envSnapshot field rejected by validateCaseManifest');

 // 6) old package without envSnapshot validates ok
 assert(validateCaseManifest(c).ok, 'case without envSnapshot validates ok');

 console.log(failures === 0 ? '\nALL ENV-SNAPSHOT TESTS PASSED' : '\n' + failures + ' ENV-SNAPSHOT TEST(S) FAILED');
 process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
