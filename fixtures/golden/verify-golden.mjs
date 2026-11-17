/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */
/**
 * Read-only golden-package verification anchor (P2 deliverable).
 *
 * This script NEVER writes to or modifies the golden package. It only:
 *   1) asserts the package layout (expected top-level entries),
 *   2) runs the trusted kernel CLI `case verify` and asserts coreResult === 'ok',
 *   3) pins the authoritative packageId / rootHash / sealHash so any future drift in the baseline
 *      package is caught.
 * Run: node fixtures/golden/verify-golden.mjs   (from anywhere; resolves paths relative to itself)
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const ZIP = resolve(__dirname, 'golden-v0.5-sealed.zip');
const CLI = resolve(ROOT, 'cli', 'bin', 'audit.js');

// Pinned anchor values — if these change, the baseline package changed and this script must be updated
// deliberately (not silently). These are READ from the package, never recomputed here.
const PINNED = {
  packageId: '7c8db6b5-7100-43f3-865e-dd65015a74ac',
  state: 'sealed',
  rootHash: 'sha256:618961cb328b326719dfc8b2a8d3b4532f3987f43075a774349badfc7c556106',
  sealHash: 'sha256:a4a70419323a16de17c8012b58a9e7963339da9bdd3cfbfa6441f91683c6e177'
};
const EXPECTED_ENTRIES = [
  'case-manifest.json', 'case-report.html', 'case-ledger.csv',
  'case-ledger-extended.csv', 'VERIFY.txt', 'case-files.sha256'
];

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log('  ok  - ' + msg);
  else { console.error('  FAIL- ' + msg); failures++; }
}

console.log('[golden anchor] ' + ZIP);

if (!existsSync(ZIP)) { console.error('golden package missing: ' + ZIP); process.exit(2); }

// 1) layout + manifest
const zip = require(resolve(ROOT, 'cli', 'core', 'zip-stream.js'));
(async () => {
  const handle = await zip.readZip(ZIP);
  const names = handle.entries.map((e) => e.name);
  for (const e of EXPECTED_ENTRIES) assert(names.includes(e), 'layout has ' + e);
  const manifestEntry = handle.getEntry('case-manifest.json');
  const manifest = JSON.parse(await handle.readText(manifestEntry, 16 * 1024 * 1024));
  await handle.close();

  // 2) kernel verify (read-only)
  const res = spawnSync(process.execPath, [CLI, 'case', 'verify', ZIP, '--json'], { encoding: 'utf8' });
  assert(res.status === 0, 'kernel `case verify` exits 0 (stderr: ' + (res.stderr || '').slice(0, 120) + ')');
  let out;
  try { out = JSON.parse(res.stdout); } catch (_) { out = {}; }
  assert(out.coreResult === 'ok', 'coreResult === ok (got ' + out.coreResult + ')');

  // 3) pinned anchor (packageId / state from the read-only manifest; rootHash / sealHash cross-checked
  //    against the kernel verify output so the trusted CLI and the manifest agree).
  assert(manifest.state === PINNED.state, 'state === sealed');
  assert(manifest.packageId === PINNED.packageId, 'packageId matches anchor');
  assert(manifest.rootHash === PINNED.rootHash, 'rootHash matches anchor (manifest)');
  assert(out.rootHash === PINNED.rootHash, 'rootHash matches anchor (kernel verify)');
  assert(out.sealHash === PINNED.sealHash, 'sealHash matches anchor');
  assert(manifest.sealHash === out.sealHash, 'manifest sealHash === kernel verify sealHash');

  console.log(failures === 0 ? '\nGOLDEN VERIFY OK' : '\n' + failures + ' GOLDEN CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})();
