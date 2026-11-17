/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */
// Verifier self-check (read-only, offline). Confirms the trusted verifier returns `ok` on the committed
// golden package and `tampered` on a deliberately altered copy. Uses the SAME code path as
// `node cli/bin/audit.js case verify` (cli/core/case-verify + cli/core/zip-stream), so a green run here
// is exactly the guarantee an external auditor gets. Exit 0 = pass.
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const { verifyCaseExport } = require(path.join(ROOT, 'cli', 'core', 'case-verify'));
const zipStream = require(path.join(ROOT, 'cli', 'core', 'zip-stream'));

const GOLDEN = path.join(__dirname, 'fieldseal-golden-v0.5-sealed.zip');
let failures = 0;
function assert(cond, msg) {
  if (cond) console.log('  ok  - ' + msg);
  else { console.log('  FAIL- ' + msg); failures++; }
}

async function main() {
  console.log('[golden]');
  if (!fs.existsSync(GOLDEN)) { console.log('  FAIL- golden package missing: ' + GOLDEN); process.exit(1); }

  // 1) genuine golden must verify ok
  const res = await verifyCaseExport(GOLDEN);
  assert(res.coreResult === 'ok', 'genuine golden verifies ok (got ' + (res.coreResult || '') + ')');

  // 2) a sealed package with an altered manifest field must surface as tampered.
  // Extract via extractToFile (the same proven path case-verify uses), edit case-manifest.json, re-zip.
  const handle = await zipStream.readZip(GOLDEN);
  const tmpIn = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldseal-golden-in-'));
  try {
    for (const e of handle.entries) {
      const target = path.join(tmpIn, e.name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      await handle.extractToFile(e, target);
    }
  } finally {
    if (handle.close) { try { await handle.close(); } catch (e) { /* ignore */ } }
  }
  const mPath = path.join(tmpIn, 'case-manifest.json');
  const obj = JSON.parse(fs.readFileSync(mPath, 'utf8'));
  obj.caseMeta = obj.caseMeta || {};
  obj.caseMeta.title = 'TAMPERED-' + Date.now();
  fs.writeFileSync(mPath, JSON.stringify(obj));
  const tmp = path.join(os.tmpdir(), 'fieldseal-golden-tampered-' + process.pid + '.zip');
  const sources = handle.entries.map((e) => ({ name: e.name, data: fs.readFileSync(path.join(tmpIn, e.name)) }));
  await zipStream.writeZip(tmp, sources);
  try {
    const tres = await verifyCaseExport(tmp);
    assert(tres.coreResult === 'tampered', 'altered package surfaces as tampered (got ' + (tres.coreResult || '') + ')');
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch (e) { /* ignore */ }
    try { fs.rmSync(tmpIn, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }

  if (failures === 0) console.log('GOLDEN-OK');
  else console.log(failures + ' GOLDEN CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
