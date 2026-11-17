#!/usr/bin/env node
/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 *
 * Failure-injection matrix on the REAL product kernel (F2 partial). Each class asserts the product
 * does NOT silently succeed: a bad input throws with a clear error, or a tampered artifact fails
 * verification with a non-ok coreResult and an explicit error.
 *
 * Scope honesty: this covers the core-path failure classes that are testable headlessly. The remaining
 * browser-environment classes (network down / disk full / refresh / crash recovery / permission denied)
 * require UI automation and are NOT claimed here (F2 stays LOCAL-READY for those).
 */
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import zipStreamPkg from '../../cli/core/zip-stream.js';
const zipStream = zipStreamPkg.default || zipStreamPkg;

const ROOT = resolve(process.cwd());
const load = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

let pass = 0, failCount = 0;
function ok(m) { console.log('  ok  - ' + m); }
function fail(m) { failCount++; console.log('  FAIL- ' + m); }
function assert(c, m) { if (c) { pass++; ok(m); } else { fail(m); } }
function throws(fn) { try { fn(); return null; } catch (e) { return e && e.message ? e.message : String(e); } }
async function throwsAsync(fn) { try { await fn(); return null; } catch (e) { return e && e.message ? e.message : String(e); } }

const tmp = mkdtempSync(join(os.tmpdir(), 'fieldseal-fail-'));

async function buildSealedCase(mediaBytes) {
  const { createCase, addCapture, sealCase } = await load('pwa/core/case-manifest.js');
  const { buildEvidenceManifest, canonicalManifestText } = await load('pwa/core/evidence-manifest.js');
  const hash = 'sha256:' + createHash('sha256').update(mediaBytes).digest('hex');
  const ev = await buildEvidenceManifest({ packageId: randomUUID(), files: [{ name: 'photo-1.jpg', hash, type: 'image' }], gps: { lat: 0, lon: 0 }, note: 'm', tags: [] });
  let c = await createCase({ metaTemplate: 'blank', mode: 'full' });
  c = await addCapture(c, { packageId: ev.packageId, rootHash: ev.rootHash, evidenceId: randomUUID(), capturedUtc: ev.createdAt });
  c = await sealCase(c, {});
  const caseDir = join(tmp, 'case-' + c.packageId + '-sealed');
  mkdirSync(caseDir, { recursive: true });
  writeFileSync(join(caseDir, 'case-manifest.json'), JSON.stringify(c, null, 2));
  const evDir = join(caseDir, 'evidence'); mkdirSync(evDir, { recursive: true });
  const manFile = join(tmp, 'm-' + ev.packageId + '.json'); writeFileSync(manFile, canonicalManifestText(ev));
  const mediaFile = join(tmp, 'p-' + ev.packageId + '.jpg'); writeFileSync(mediaFile, mediaBytes);
  const evZip = join(evDir, ev.packageId + '.zip');
  await zipStream.writeZip(evZip, [{ name: 'manifest.json', sourcePath: manFile }, { name: 'photo-1.jpg', sourcePath: mediaFile }]);
  return { caseDir, evZip, ev };
}

function verifyCli(dir) {
  const r = spawnSync(process.execPath, [join(ROOT, 'cli/bin/audit.js'), 'case', 'verify', dir, '--json'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
  let j = null; try { j = JSON.parse((r.stdout || '').trim()); } catch {}
  return { status: r.status, j };
}

try {
  const { createCase, addCapture, sealCase } = await load('pwa/core/case-manifest.js');
  const { buildEvidenceManifest, canonicalManifestText } = await load('pwa/core/evidence-manifest.js');

  // A) illegal rootHash is rejected (not silently accepted).
  let c = await createCase({ metaTemplate: 'blank', mode: 'full' });
  const eA = await throwsAsync(() => addCapture(c, { packageId: randomUUID(), rootHash: 'not-a-hash', evidenceId: randomUUID(), capturedUtc: new Date().toISOString() }));
  assert(eA && /hash/i.test(eA), 'A illegal rootHash rejected with error (msg: ' + (eA || 'none') + ')');

  // B) write after sealed is rejected (immutable once sealed).
  const base = await buildSealedCase(Buffer.from('A'.repeat(2048)));
  const cB = JSON.parse(readFileSync(join(base.caseDir, 'case-manifest.json'), 'utf8'));
  const eB = await throwsAsync(() => addCapture(cB, { packageId: randomUUID(), rootHash: 'sha256:' + 'a'.repeat(64), evidenceId: randomUUID(), capturedUtc: new Date().toISOString() }));
  assert(eB && /seal|mutable|state/i.test(eB), 'B capture-after-seal rejected (msg: ' + (eB || 'none') + ')');

  // C) illegal file name rejected by evidence manifest builder.
  const eC = await throwsAsync(() => buildEvidenceManifest({ packageId: randomUUID(), files: [{ name: 'evil.exe', hash: 'sha256:' + 'a'.repeat(64), type: 'other' }], gps: { lat: 0, lon: 0 }, note: '', tags: [] }));
  assert(eC != null, 'C illegal file name rejected by builder (msg: ' + (eC || 'none') + ')');

  // C2) illegal FILE hash rejected by evidence manifest builder (C1 guard at field level).
  const eC2 = await throwsAsync(() => buildEvidenceManifest({ packageId: randomUUID(), files: [{ name: 'photo-1.jpg', hash: 'sha256:nothex', type: 'image' }], gps: { lat: 0, lon: 0 }, note: '', tags: [] }));
  assert(eC2 != null, 'C2 illegal file hash rejected by builder (msg: ' + (eC2 || 'none') + ')');

  // D) happy-path sanity: a pristine sealed case verifies ok (proves the matrix is not trivially failing).
  const d = await buildSealedCase(Buffer.from('A'.repeat(2048)));
  const vD = verifyCli(d.caseDir);
  assert(vD.j && vD.j.coreResult === 'ok' && vD.j.errors.length === 0, 'D pristine sealed case verifies ok (coreResult=' + (vD.j && vD.j.coreResult) + ')');

  // G) tampered media (bytes != manifest hash) fails verification (not silent ok).
  const g = await buildSealedCase(Buffer.from('A'.repeat(2048)));
  // rebuild the child zip with media bytes that DON'T match the manifest hash
  const { buildEvidenceManifest: bem2, canonicalManifestText: cmt2 } = await load('pwa/core/evidence-manifest.js');
  const badHash = 'sha256:' + 'b'.repeat(64);
  const ev2 = await bem2({ packageId: randomUUID(), files: [{ name: 'photo-1.jpg', hash: badHash, type: 'image' }], gps: { lat: 0, lon: 0 }, note: 'm', tags: [] });
  const man2 = join(tmp, 'm2.json'); writeFileSync(man2, cmt2(ev2));
  const media2 = join(tmp, 'p2.jpg'); writeFileSync(media2, Buffer.from('X'.repeat(2048))); // mismatch vs badHash
  const evDir2 = join(g.caseDir, 'evidence'); mkdirSync(evDir2, { recursive: true });
  await zipStream.writeZip(join(evDir2, ev2.packageId + '.zip'), [{ name: 'manifest.json', sourcePath: man2 }, { name: 'photo-1.jpg', sourcePath: media2 }]);
  // also repoint the case child rootHash to the tampered package so the case refers to it
  const caseJson = JSON.parse(readFileSync(join(g.caseDir, 'case-manifest.json'), 'utf8'));
  caseJson.children[0].packageId = ev2.packageId; caseJson.children[0].rootHash = ev2.rootHash;
  writeFileSync(join(g.caseDir, 'case-manifest.json'), JSON.stringify(caseJson, null, 2));
  const vG = verifyCli(g.caseDir);
  assert(vG.j && vG.j.coreResult !== 'ok', 'G tampered media detected (coreResult=' + (vG.j && vG.j.coreResult) + ', errors=' + (vG.j && (vG.j.errors || []).length) + ')');

  // H) missing child evidence zip fails verification.
  const h = await buildSealedCase(Buffer.from('A'.repeat(2048)));
  rmSync(join(h.caseDir, 'evidence'), { recursive: true, force: true });
  const vH = verifyCli(h.caseDir);
  assert(vH.j && vH.j.coreResult !== 'ok', 'H missing evidence detected (coreResult=' + (vH.j && vH.j.coreResult) + ')');

  // I) truncated manifest inside the child zip fails verification.
  const i = await buildSealedCase(Buffer.from('A'.repeat(2048)));
  const evDirI = join(i.caseDir, 'evidence'); mkdirSync(evDirI, { recursive: true });
  const ev3 = await buildEvidenceManifest({ packageId: randomUUID(), files: [{ name: 'photo-1.jpg', hash: 'sha256:' + 'a'.repeat(64), type: 'image' }], gps: { lat: 0, lon: 0 }, note: 'm', tags: [] });
  const man3 = join(tmp, 'm3.json'); writeFileSync(man3, canonicalManifestText(ev3).slice(0, 20)); // truncated
  const media3 = join(tmp, 'p3.jpg'); writeFileSync(media3, Buffer.from('A'.repeat(2048)));
  await zipStream.writeZip(join(evDirI, ev3.packageId + '.zip'), [{ name: 'manifest.json', sourcePath: man3 }, { name: 'photo-1.jpg', sourcePath: media3 }]);
  const caseJsonI = JSON.parse(readFileSync(join(i.caseDir, 'case-manifest.json'), 'utf8'));
  caseJsonI.children[0].packageId = ev3.packageId; caseJsonI.children[0].rootHash = ev3.rootHash;
  writeFileSync(join(i.caseDir, 'case-manifest.json'), JSON.stringify(caseJsonI, null, 2));
  const vI = verifyCli(i.caseDir);
  assert(vI.j && vI.j.coreResult !== 'ok', 'I truncated manifest detected (coreResult=' + (vI.j && vI.j.coreResult) + ')');

  // Note: classes network-down / disk-full / refresh / crash-recovery / permission-denied require
  // browser-environment automation and are out of scope for this headless kernel test.
} catch (e) {
  fail('matrix threw: ' + (e && e.stack || e));
}

rmSync(tmp, { recursive: true, force: true });
console.log((failCount ? 'FIELDSEAL-FAIL-MATRIX-FAIL' : 'FIELDSEAL-FAIL-MATRIX: PASS') + ' (' + pass + ' pass, ' + failCount + ' fail)');
process.exit(failCount ? 1 : 0);
