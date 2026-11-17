/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */
// Release-closure reproduction (audit condition 1, crypto-critical portion).
// Builds a real evidence package, opens a case, fills required capture metadata,
// seals it, exports a case ZIP, and verifies the export with the shipping CLI
// (`cli/bin/audit.js case verify`). Run: `node reports/v05/closure-case.mjs`.
// No network, no browser, no third-party dependency.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const require = createRequire(import.meta.url);
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const base = path.join(ROOT, 'pwa', 'core');
const load = (n) => import(pathToFileURL(path.join(base, n)).href);
const hash = await load('hash.js');
const zip = await load('zip-builder.js');
const manifestMod = await load('evidence-manifest.js');
const caseCore = await load('case-manifest.js');
const exportCore = await import(pathToFileURL(path.join(ROOT, 'pwa', 'helpers', 'case-export.js')).href);
const verifyCore = require(path.join(ROOT, 'cli', 'core', 'verify.js'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldseal-closure-'));

async function buildEvidence(dir, salt) {
  const photoBytes = Buffer.concat([randomBytes(2048), Buffer.from([salt & 0xff])]);
  const photo = new Blob([photoBytes], { type: 'image/jpeg' });
  const p = await zip.inspectBlob(photo);
  const manifest = await manifestMod.buildEvidenceManifest({
    version: manifestMod.EVIDENCE_V02,
    files: [{ name: 'photo-1.jpg', hash: p.sha256, type: 'image' }],
    gps: { lat: '52.5200', lon: '13.4050' },
    note: 'Closure evidence capture',
    tags: ['closure']
  });
  const text = manifestMod.canonicalManifestText
    ? manifestMod.canonicalManifestText(manifest)
    : JSON.stringify(manifest, null, 2);
  const blob = await zip.buildZip([
    { name: 'manifest.json', data: new TextEncoder().encode(text) },
    { name: 'photo-1.jpg', blob: photo, size: p.size, crc32: p.crc32, sha256: p.sha256 }
  ]);
  const out = path.join(dir, 'evidence.zip');
  await fs.promises.writeFile(out, Buffer.from(await blob.arrayBuffer()));
  return out;
}

// 1) 建卷 / capture (real evidence package)
const evPath = await buildEvidence(tmp, 7);
const ev = await verifyCore.verifyPackage(evPath, { noLink: true, autoDiscover: false });
if (ev.coreResult !== 'ok') { console.error('evidence verify failed:', ev.coreResult, ev.pluginExtras); process.exit(1); }
console.log('[1] capture verified   :', ev.coreResult, ev.packageId);

// 2) 补必填 / open case + add capture metadata (scene zone)
const c = await caseCore.createCase({ origin: 'standard', metaTemplate: 'forensic-investigator' });
c.caseMeta.caseReference = 'CASE-CLOSURE-2026-11-14';
await caseCore.addCapture(c, {
  evidenceId: 'ev-1', packageId: ev.packageId, rootHash: ev.rootHash,
  itemValues: { sceneZone: 'Room A' }
});
console.log('[2] case draft opened  :', c.packageId, 'children=', c.children.length);

// 3) 封存 / seal
const sealed = await caseCore.sealCase(c, { actorName: 'Custodian', ianaTz: 'UTC' });
console.log('[3] sealed             :', sealed.state, 'rootHash=', sealed.rootHash.slice(0, 16) + '…', 'sealHash=', sealed.sealHash.slice(0, 16) + '…');

// 4) 导出 / export case ZIP (self-contained, VERIFY.txt carries CLI command + hashes)
const packages = [{ packageId: ev.packageId, blob: new Blob([await fs.promises.readFile(evPath)]) }];
const outZip = path.join(tmp, 'case-closure.zip');
const exportBlob = await exportCore.buildCaseExportZip(sealed, packages);
await fs.promises.writeFile(outZip, Buffer.from(await exportBlob.arrayBuffer()));
console.log('[4] exported           :', outZip);

// 5) CLI 回验 / verify with the shipping CLI
const res = JSON.parse(spawnSync(process.execPath, [path.join(ROOT, 'cli', 'bin', 'audit.js'), 'case', 'verify', outZip, '--json'], { encoding: 'utf8' }).stdout);
console.log('[5] CLI case verify    :', res.coreResult, 'children=', (res.children || []).map((ch) => ch.coreResult).join(','));
console.log('    sealHash preserved :', res.sealHash === sealed.sealHash);

fs.rmSync(tmp, { recursive: true, force: true });
if (res.coreResult === 'ok' && res.sealHash === sealed.sealHash) {
  console.log('\nCLOSURE-OK: 建卷→补必填→封存→导出→CLI回验 全链路一致');
  process.exit(0);
} else {
  console.error('\nCLOSURE-FAILED');
  process.exit(1);
}
