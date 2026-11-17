/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Standalone self-test for P2 BagIt / OAIS long-term archival package (pack + offline verify).
// Run: node pwa/core/test-bagit.mjs
import { createCase } from './case-manifest.js';
import { buildBagitEntries, verifyBagitFiles, buildBagitZip } from '../helpers/case-export.js';

let failures = 0;
function assert(cond, msg) {
 if (cond) console.log(' ok - ' + msg);
 else { console.log(' FAIL- ' + msg); failures++; }
}

async function entriesToMap(entries) {
 const map = {};
 for (const e of entries) {
 const bytes = e.data !== undefined ? e.data : (e.blob instanceof Uint8Array ? e.blob : new Uint8Array(await e.blob.arrayBuffer()));
 map[e.name] = bytes;
 }
 return map;
}

async function main() {
 console.log('[bagit]');

 let c = await createCase({ metaTemplate: 'blank', caseMeta: {} });
 c.children = [{ evidenceId: 'ev-1', rootHash: 'sha256:' + 'a'.repeat(64), packageId: 'p1' }];

 // 1) build entries and required BagIt files present
 const entries = await buildBagitEntries(c, []);
 const map = await entriesToMap(entries);
 assert(map['bagit.txt'] && map['bag-info.txt'] && map['manifest-sha256.txt'] && map['tagmanifest-sha256.txt'], 'BagIt control files present');
 assert(map['data/case-manifest.json'] && map['data/case-report.html'] && map['data/VERIFY.txt'], 'payload (manifest/report/VERIFY) present');
 assert(!map['data/evidence/p1.zip'], 'no evidence binary when packages omitted (metadata-only bag)');

 // 2) fresh bag verifies ok (fixity + completeness)
 let res = await verifyBagitFiles(map);
 assert(res.ok, 'fresh bag verifies ok (' + Object.keys(map).length + ' files)');

 // 3) tampered payload detected
 const t1 = Object.assign({}, map);
 t1['data/case-manifest.json'] = new TextEncoder().encode('TAMPERED');
 let r1 = await verifyBagitFiles(t1);
 assert(!r1.ok && r1.errors.some((e) => /checksum mismatch/.test(e)), 'tampered payload detected');

 // 4) tampered tag detected (bagit.txt altered -> tagmanifest mismatch)
 const t2 = Object.assign({}, map);
 t2['bagit.txt'] = new TextEncoder().encode('BagIt-Version: 0.0\nTag-File-Character-Encoding: UTF-8\n');
 let r2 = await verifyBagitFiles(t2);
 assert(!r2.ok && r2.errors.some((e) => /tag checksum mismatch/.test(e)), 'tampered tag detected');

 // 5) manifest completeness: a missing data file surfaces
 const t3 = Object.assign({}, map);
 delete t3['data/case-report.html'];
 let r3 = await verifyBagitFiles(t3);
 assert(!r3.ok && r3.errors.some((e) => /payload not in manifest|manifest lists missing/.test(e)), 'missing payload surfaced');

 // 6) buildBagitZip returns a zip Blob (browser-downloadable)
 const zip = await buildBagitZip(c, []);
 assert(zip && zip instanceof Blob && zip.type === 'application/zip', 'buildBagitZip returns application/zip Blob');

 // 7) bag-info records authoritative hashes (no re-seal)
 const info = new TextDecoder().decode(map['bag-info.txt']);
 assert(info.includes('FieldSeal-Root-Hash: ' + c.rootHash) && info.includes('FieldSeal-Seal-Hash: ' + c.sealHash), 'bag-info records authoritative root/seal hash');

 console.log(failures === 0 ? '\nALL BAGIT TESTS PASSED' : '\n' + failures + ' BAGIT TEST(S) FAILED');
 process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
