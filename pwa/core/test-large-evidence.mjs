/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Regression: verifying a large evidence asset (>64 MiB) must NOT be reported as `tampered`. The old path
// used readBytes (hard 64 MiB cap) and a read failure was mislabelled "cannot read declared file". The fix
// uses streaming hashEntry (no cap). This test proves hashEntry streams a 65 MiB entry while readBytes still
// throws ENTRY_TOO_LARGE (so verifyEvidence MUST use hashEntry) — delivery-audit B-04.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import zipStreamPkg from '../../cli/core/zip-stream.js';
const zipStream = zipStreamPkg.default || zipStreamPkg;

let pass = 0, fail = 0;
function assert(c, m) { if (c) { pass++; console.log(' ok - ' + m); } else { fail++; console.log(' FAIL- ' + m); } }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldseal-large-'));
const big = path.join(tmp, 'big.bin');
// 65 MiB of RANDOM data so the zip compressor cannot shrink it (a sparse zero file would compress to
// nothing and never trip the 64 MiB readBytes cap — defeating the point of this regression test).
const fd = fs.openSync(big, 'w');
for (let i = 0; i < 65; i++) fs.writeSync(fd, randomBytes(1024 * 1024));
fs.closeSync(fd);
const zipPath = path.join(tmp, 'ev.zip');
await zipStream.writeZip(zipPath, [{ name: 'big.bin', sourcePath: big }]);

const handle = await zipStream.readZip(zipPath);
const entry = handle.getEntry('big.bin');
const h = await handle.hashEntry(entry);
assert(typeof h === 'string' && h.startsWith('sha256:'), 'hashEntry streams a 65 MiB entry without the 64 MiB cap');

let threw = false;
try { await handle.readBytes(entry); } catch (e) { threw = e.code === 'ENTRY_TOO_LARGE' || /ENTRY_TOO_LARGE/.test(e.message || e.code || ''); }
assert(threw, 'readBytes still caps at 64 MiB (proves the OLD verify path would have failed) — verifyEvidence must use hashEntry');

// Cross-check: streaming hash matches a direct sha256 of the file (node:crypto, independent of our code).
const direct = 'sha256:' + createHash('sha256').update(fs.readFileSync(big)).digest('hex');
assert(direct === h, 'streaming hashEntry equals direct file sha256');

fs.rmSync(tmp, { recursive: true, force: true });
console.log((fail ? 'FIELDSEAL-TEST-FAIL' : 'FIELDSEAL-TEST-OK') + ' large-evidence (' + pass + ' pass, ' + fail + ' fail)');
process.exit(fail ? 1 : 0);
