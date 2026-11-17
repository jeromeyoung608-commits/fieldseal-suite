#!/usr/bin/env node
/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 *
 * Genuine end-to-end of the trust-critical path (F1 partial): build a real evidence package with the
 * SHIPPED product modules, bind it into a real case, seal it (real sealHash), export the case directory,
 * then verify it with the SHIPPED CLI `audit.js case verify` and assert `coreResult: "ok"`.
 *
 * Scope honesty: this drives the real product kernel, NOT 9 DOM button clicks. The 9-button / full
 * export-ZIP-via-UI coverage remains a browser-automation task (F1 stays LOCAL-READY for that part).
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

const tmp = mkdtempSync(join(os.tmpdir(), 'fieldseal-e2e-'));

try {
  const { createCase, addCapture, sealCase } = await load('pwa/core/case-manifest.js');
  const { buildEvidenceManifest, canonicalManifestText } = await load('pwa/core/evidence-manifest.js');

  // 1) Build a REAL child evidence package with the shipped builder.
  const mediaBytes = Buffer.from('A'.repeat(2048)); // a real 2 KiB image surrogate
  const mediaHash = 'sha256:' + createHash('sha256').update(mediaBytes).digest('hex');
  const ev = await buildEvidenceManifest({
    packageId: randomUUID(),
    files: [{ name: 'photo-1.jpg', hash: mediaHash, type: 'image' }],
    gps: { lat: 0, lon: 0 }, note: 'e2e', tags: []
  });
  assert(ev && typeof ev.rootHash === 'string' && ev.rootHash.startsWith('sha256:'), 'built evidence manifest with product rootHash');

  // 2) Build the child evidence ZIP (manifest.json + media) via the proven Node zip writer.
  const manFile = join(tmp, 'ev-manifest.json');
  writeFileSync(manFile, canonicalManifestText(ev));
  const mediaFile = join(tmp, 'photo-1.jpg'); writeFileSync(mediaFile, mediaBytes);

  // 3) Build a REAL case, bind the capture, and SEAL it (real sealHash aggregation).
  let c = await createCase({ metaTemplate: 'blank', mode: 'full' });
  c = await addCapture(c, { packageId: ev.packageId, rootHash: ev.rootHash, evidenceId: randomUUID(), capturedUtc: ev.createdAt });
  const beforeSeal = c.state;
  c = await sealCase(c, {});
  assert(beforeSeal === 'draft', 'case started in draft');
  assert(c.state === 'sealed', 'sealCase transitions draft -> sealed (irreversible)');
  assert(typeof c.sealHash === 'string' && c.sealHash.startsWith('sha256:'), 'sealHash computed by product kernel');

  // 4) Export the case directory (case-manifest.json + evidence/<pkgId>.zip).
  const caseDir = join(tmp, 'case-' + c.packageId + '-sealed');
  mkdirSync(caseDir, { recursive: true });
  writeFileSync(join(caseDir, 'case-manifest.json'), JSON.stringify(c, null, 2));
  // The child evidence ZIP MUST live inside the case directory at evidence/<packageId>.zip.
  const evDir = join(caseDir, 'evidence'); mkdirSync(evDir, { recursive: true });
  const evZip = join(evDir, ev.packageId + '.zip');
  await zipStream.writeZip(evZip, [
    { name: 'manifest.json', sourcePath: manFile },
    { name: 'photo-1.jpg', sourcePath: mediaFile }
  ]);
  assert(zipStream.readZip && (await zipStream.readZip(evZip)).getEntry('manifest.json'), 'child evidence zip written + readable inside case dir');

  // 5) Verify with the SHIPPED CLI — the real acceptance gate.
  const r = spawnSync(process.execPath, [join(ROOT, 'cli/bin/audit.js'), 'case', 'verify', caseDir, '--json'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
  let j = null; try { j = JSON.parse((r.stdout || '').trim()); } catch {}
  assert(r.status === 0, 'CLI `case verify` exits 0 (stdout exit=' + r.status + ')');
  assert(j && j.coreResult === 'ok', 'CLI coreResult === "ok" (got ' + (j && j.coreResult) + ')');
  assert(j && Array.isArray(j.errors) && j.errors.length === 0, 'CLI verification errors empty');
} catch (e) {
  fail('e2e threw: ' + (e && e.stack || e));
}

rmSync(tmp, { recursive: true, force: true });
console.log((failCount ? 'FIELDSEAL-E2E-FAIL' : 'FIELDSEAL-E2E: PASS') + ' (' + pass + ' pass, ' + failCount + ' fail)');
process.exit(failCount ? 1 : 0);
