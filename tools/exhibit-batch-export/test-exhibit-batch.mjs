/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * Self-test for the batch Exhibit index exporter (P1 #3). Run:  node test-exhibit-batch.mjs
 *
 * Fixtures are generated on the fly (no network) using the kernel's read-only ZIP writer, so the
 * suite is fully offline and deterministic. Asserts: sealed indexing, draft skip, empty sealed,
 * corrupt package error, Exhibit-number uniqueness, sealHash copied (never recomputed), and that the
 * original packages are left byte-for-byte unchanged (read-only).
 */
import { createRequire } from 'node:module';
import { promises as fs, writeFileSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const { writeZip } = require('../../cli/core/zip-stream.js');

import {
  formatExhibit, buildIndex, toCsv, toJson, run, collectZipPaths
} from './exhibit-batch.mjs';

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log('  ok  - ' + msg);
  else { console.error('  FAIL- ' + msg); failures++; }
}

const SEAL_HASH = 'sha256:a4a70419323a16de17c8012b58a9e7963339da9bdd3cfbfa6441f91683c6e177';

async function makeZipBytes(name, data) {
  const tmp = join(tmpdir(), 'exh-fix-' + Math.random().toString(36).slice(2) + '.zip');
  await writeZip(tmp, [{ name, data }]);
  const buf = readFileSync(tmp);
  require('node:fs').unlinkSync(tmp);
  return buf;
}

function buildManifests() {
  const sealed = {
    spec: 'fieldseal-case-v0.5', specVersion: 'fieldseal-case-v0.5',
    packageId: 'CASE-SEALED-1', rootHash: 'sha256:root1', hashAlgorithm: 'sha256',
    caseMeta: { title: 'Sealed Demo', operatorProfile: { operatorName: 'Jane' } },
    state: 'sealed', sealedAt: '2026-11-13T04:36:42Z', sealHash: SEAL_HASH,
    children: [
      { evidenceId: 'e1', packageId: 'EV-1', rootHash: 'sha256:111', spec: 'fieldseal-evidence-v0.2', capturedUtc: '2026-11-13T03:00:00Z' },
      { evidenceId: 'e2', packageId: 'EV-2', rootHash: 'sha256:222', spec: 'fieldseal-evidence-v0.2', capturedUtc: '2026-11-13T03:05:00Z' }
    ]
  };
  const draft = { ...sealed, packageId: 'CASE-DRAFT-1', state: 'draft', children: [{ evidenceId: 'e3', packageId: 'EV-3', rootHash: 'sha256:333', capturedUtc: '2026-11-13T02:00:00Z' }] };
  const empty = { ...sealed, packageId: 'CASE-EMPTY-1', state: 'sealed', children: [] };
  return { sealed, draft, empty };
}

async function makeFixtures(dir) {
  const { sealed, draft, empty } = buildManifests();
  const ev1 = await makeZipBytes('inner.txt', Buffer.from('evidence one'));
  const ev2 = await makeZipBytes('inner.txt', Buffer.from('evidence two'));
  const ev3 = await makeZipBytes('inner.txt', Buffer.from('evidence three'));
  await writeZip(join(dir, 'sealed.zip'), [
    { name: 'case-manifest.json', data: JSON.stringify(sealed) },
    { name: 'evidence/EV-1.zip', data: ev1 },
    { name: 'evidence/EV-2.zip', data: ev2 }
  ]);
  await writeZip(join(dir, 'draft.zip'), [
    { name: 'case-manifest.json', data: JSON.stringify(draft) },
    { name: 'evidence/EV-3.zip', data: ev3 }
  ]);
  await writeZip(join(dir, 'empty.zip'), [
    { name: 'case-manifest.json', data: JSON.stringify(empty) }
  ]);
  writeFileSync(join(dir, 'corrupt.zip'), Buffer.from('this is not a zip file at all, no PK signature here'));
  return { sealed: join(dir, 'sealed.zip'), draft: join(dir, 'draft.zip'), empty: join(dir, 'empty.zip'), corrupt: join(dir, 'corrupt.zip'), ev1Len: ev1.length };
}

async function testIndexing() {
  console.log('[indexing]');
  const dir = mkdtempSync(join(tmpdir(), 'exh-test-'));
  const fx = await makeFixtures(dir);
  const sealedSizeBefore = statSync(fx.sealed).size;

  const { rows } = await buildIndex([fx.sealed, fx.draft, fx.empty, fx.corrupt], { prefix: 'EXH' });
  assert(rows.length === 5, '5 rows total (2 sealed + 1 draft skipped + 1 empty + 1 corrupt error)');

  const sealedRows = rows.filter((r) => r.evidencePackageId === 'EV-1' || r.evidencePackageId === 'EV-2');
  assert(sealedRows.length === 2, 'sealed case yields 2 evidence rows');
  assert(sealedRows[0].exhibitNo === 'EXH-00001' && sealedRows[1].exhibitNo === 'EXH-00002', 'Exhibit numbers sequential from 1');
  assert(sealedRows.every((r) => r.status === 'ok'), 'sealed evidence rows status ok');
  assert(sealedRows.every((r) => r.sealHash === SEAL_HASH), 'sealHash copied verbatim (never recomputed)');
  assert(sealedRows[0].hashDigest === 'sha256:111' && sealedRows[1].hashDigest === 'sha256:222', 'child rootHash copied as hashDigest');
  assert(String(sealedRows[0].fileSize) === String(fx.ev1Len), 'evidence file size read from case zip entry');

  const skipped = rows.find((r) => r.status === 'skipped');
  assert(skipped && skipped.note.includes('draft'), 'draft case marked skipped with reason');

  const emptyRow = rows.find((r) => r.evidencePackageId === 'CASE-EMPTY-1');
  assert(emptyRow && emptyRow.status === 'ok' && emptyRow.exhibitNo === 'EXH-00003', 'empty sealed case indexed as one ok row');

  const errRow = rows.find((r) => r.status === 'error');
  assert(errRow && errRow.note.length > 0, 'corrupt package yields error row (no throw)');

  const nums = rows.map((r) => r.exhibitNo).filter(Boolean);
  assert(new Set(nums).size === nums.length, 'all Exhibit numbers unique within batch');

  assert(statSync(fx.sealed).size === sealedSizeBefore, 'original package NOT modified (read-only)');
}

async function testDuplicateInput() {
  console.log('[duplicate input]');
  const dir = mkdtempSync(join(tmpdir(), 'exh-test-'));
  const fx = await makeFixtures(dir);
  const paths = collectZipPaths([fx.sealed, fx.sealed]);
  assert(paths.length === 1, 'collectZipPaths de-duplicates the same package path');
  const { rows } = await buildIndex(paths, { prefix: 'EXH' });
  assert(rows.length === 2, 'de-duplicated sealed case yields 2 evidence rows (not 4)');
  assert(new Set(rows.map((r) => r.exhibitNo)).size === 2, 'no duplicate Exhibit numbers after dedup');
}

async function testPrefix() {
  console.log('[custom prefix]');
  const dir = mkdtempSync(join(tmpdir(), 'exh-test-'));
  const fx = await makeFixtures(dir);
  const { rows } = await buildIndex([fx.empty], { prefix: 'EVID' });
  assert(rows[0].exhibitNo === 'EVID-00001', 'custom prefix applied (EVID-00001)');
  assert(formatExhibit(42, 'EXH') === 'EXH-00042', 'formatExhibit pads to 5 digits');
}

function testOutputs() {
  console.log('[CSV / JSON output]');
  const csv = toCsv([
    { caseId: 'C1', caseTitle: 't', sealHash: SEAL_HASH, sealedAt: '2026-01-01T00:00:00Z', exhibitNo: 'EXH-00001', evidencePackageId: 'EV-1', evidenceType: 'fieldseal-evidence-v0.2', collectedAt: '2026-01-01T00:00:00Z', ntpReferenceTime: '', hashDigest: 'sha256:111', fileSize: '10', status: 'ok', note: '' },
    { caseId: 'C2', caseTitle: 'comma, value', sealHash: '', sealedAt: '', exhibitNo: '', evidencePackageId: '', evidenceType: '', collectedAt: '', ntpReferenceTime: '', hashDigest: '', fileSize: '', status: 'skipped', note: 'state=draft (not sealed)' }
  ]);
  assert(csv.split('\r\n')[0].split(',').length === 13, 'CSV header has 13 columns');
  assert(csv.includes('"comma, value"'), 'CSV escapes fields containing commas');
  const json = toJson([{ exhibitNo: 'EXH-00001' }], { prefix: 'EXH' });
  assert(json.tool === 'fieldseal-exhibit-batch' && json.count === 1 && Array.isArray(json.columns), 'JSON envelope well-formed');
}

async function testCliRun() {
  console.log('[CLI run()]');
  const dir = mkdtempSync(join(tmpdir(), 'exh-test-'));
  const fx = await makeFixtures(dir);
  const out = mkdtempSync(join(tmpdir(), 'exh-out-'));
  const res = await run(['--cases', dir, '--out', out, '--no-copy']);
  const csv = await fs.readFile(join(out, 'exhibit-index.csv'), 'utf8');
  const json = JSON.parse(await fs.readFile(join(out, 'exhibit-index.json'), 'utf8'));
  assert(res.rows.length >= 5, 'CLI wrote index rows');
  assert(csv.split('\r\n').length >= 6, 'CSV file written with header + rows');
  assert(json.count === res.rows.length, 'JSON count matches rows');
  assert(!require('node:fs').existsSync(join(out, 'sealed.zip')), '--no-copy does not copy packages');
}

(async () => {
  await testIndexing();
  await testDuplicateInput();
  await testPrefix();
  testOutputs();
  await testCliRun();
  console.log(failures === 0 ? '\nALL EXHIBIT-BATCH TESTS PASSED' : '\n' + failures + ' EXHIBIT-BATCH TEST(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})();
