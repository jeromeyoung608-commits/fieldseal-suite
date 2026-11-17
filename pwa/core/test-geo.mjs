/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Standalone self-test for P2 geographic attestation.
// Run: node pwa/core/test-geo.mjs
import { createCase, recordGeoAttestation, validateCaseManifest, computeRootHash, computeSealHash } from './case-manifest.js';

let failures = 0;
function assert(cond, msg) {
 if (cond) console.log(' ok - ' + msg);
 else { console.log(' FAIL- ' + msg); failures++; }
}

async function main() {
 console.log('[geo-attestation]');

 // 1) valid geo attestation
 let c = await createCase({ metaTemplate: 'blank', caseMeta: {} });
 c = await recordGeoAttestation(c, { latitude: 48.8566, longitude: 2.3522, accuracyMeters: 5, source: 'gps', method: 'gps', linkedAction: 'seal' });
 assert(c.geoAttestations && c.geoAttestations.length === 1, 'geo attestation recorded');
 assert(c.geoAttestations[0].latitude === 48.8566 && c.geoAttestations[0].longitude === 2.3522, 'coords stored');

 // 2) validation guards
 let badLat = false;
 try { await recordGeoAttestation(c, { latitude: 91, longitude: 0 }); } catch (e) { badLat = true; }
 assert(badLat, 'latitude > 90 rejected');
 let badLon = false;
 try { await recordGeoAttestation(c, { latitude: 0, longitude: 200 }); } catch (e) { badLon = true; }
 assert(badLon, 'longitude > 180 rejected');
 let badAcc = false;
 try { await recordGeoAttestation(c, { latitude: 0, longitude: 0, accuracyMeters: -1 }); } catch (e) { badAcc = true; }
 assert(badAcc, 'negative accuracy rejected');

 // 3) structural validation (validateCaseManifest) flags malformed geo
 const bad = JSON.parse(JSON.stringify(c));
 bad.geoAttestations[0].latitude = 'not-a-number';
 const v = validateCaseManifest(bad);
 assert(!v.ok && v.errors.some((e) => /geoAttestations\.latitude/.test(e)), 'malformed geo fails validateCaseManifest');

 // 4) tamper-evident in rootHash, NOT sealHash (v0.4 compat)
 let c2 = await createCase({ metaTemplate: 'blank', caseMeta: {} });
 const sealBefore = await computeSealHash(c2);
 const rootBefore = await computeRootHash(c2);
 c2 = await recordGeoAttestation(c2, { latitude: 40.7128, longitude: -74.006, accuracyMeters: 10 });
 assert((await computeSealHash(c2)) === sealBefore, 'geo does NOT alter sealHash');
 assert((await computeRootHash(c2)) !== rootBefore, 'geo IS tamper-evident in rootHash');

 // 5) valid geo passes validateCaseManifest
 assert(validateCaseManifest(c).ok, 'case with valid geo validates ok');

 console.log(failures === 0 ? '\nALL GEO TESTS PASSED' : '\n' + failures + ' GEO TEST(S) FAILED');
 process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
