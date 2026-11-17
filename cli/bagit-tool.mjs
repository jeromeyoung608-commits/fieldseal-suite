/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */
// Zero-dependency BagIt pack / verify CLI (OAIS-style long-term archival).
//   node cli/bagit-tool.mjs pack   <case.json> [outDir]
//   node cli/bagit-tool.mjs verify <bagDir>
// `pack` writes a real BagIt v1.0 *directory*; `verify` re-checks fixity (manifest + tagmanifest) and
// completeness offline. The case rootHash/sealHash are recorded in bag-info.txt and stay authoritative.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBagitEntries, verifyBagitFiles } from '../pwa/helpers/case-export.js';

const here = dirname(fileURLToPath(import.meta.url));

function readCaseJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function toBytes(e) {
  if (e.data !== undefined) return e.data;
  if (e.blob instanceof Uint8Array) return e.blob;
  return new Uint8Array(e.blob.arrayBuffer());
}

async function pack(casePath, outDir) {
  const c = readCaseJson(casePath);
  const entries = await buildBagitEntries(c, [], {});
  for (const e of entries) {
    const target = join(outDir, e.name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, toBytes(e));
  }
  console.log('Wrote BagIt bag -> ' + outDir + ' (' + entries.length + ' files)');
  console.log('Verify with: node cli/bagit-tool.mjs verify ' + outDir);
}

async function verify(bagDir) {
  if (!existsSync(bagDir)) { console.error('bag directory not found: ' + bagDir); process.exit(2); }
  const map = {};
  for (const f of readdirSync(bagDir, { recursive: true })) {
    const full = join(bagDir, f);
    if (statSync(full).isDirectory()) continue;
    map[String(f).split('\\').join('/')] = new Uint8Array(readFileSync(full));
  }
  const res = await verifyBagitFiles(map);
  if (res.ok) {
    console.log('BagIt VERIFY OK (' + Object.keys(map).length + ' files, fixity + completeness)');
  } else {
    console.error('BagIt VERIFY FAILED:');
    for (const err of res.errors) console.error('  - ' + err);
    process.exit(1);
  }
}

const [,, cmd, arg1, arg2] = process.argv;
(async () => {
  try {
    if (cmd === 'pack') {
      if (!arg1) { console.error('usage: bagit-tool.mjs pack <case.json> [outDir]'); process.exit(2); }
      const outDir = arg2 || (arg1.replace(/\.json$/i, '') + '_bag');
      await pack(arg1, outDir);
    } else if (cmd === 'verify') {
      if (!arg1) { console.error('usage: bagit-tool.mjs verify <bagDir>'); process.exit(2); }
      await verify(arg1);
    } else {
      console.error('usage: bagit-tool.mjs pack <case.json> [outDir] | verify <bagDir>');
      process.exit(2);
    }
  } catch (e) {
    console.error('bagit-tool error: ' + e.message);
    process.exit(1);
  }
})();
