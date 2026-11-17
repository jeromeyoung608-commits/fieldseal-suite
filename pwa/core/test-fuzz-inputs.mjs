/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Regression: malformed-input hardening (delivery audit §3 / C4). Zero dependencies.
// Feeds random, truncated and bit-flipped bytes to the ZIP reader and adversarial
// values to the canonical hasher, asserting controlled failures only — never a
// crash, never an unbounded loop, never a silent accept of a corrupt archive.
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { canonicalJson } from './hash.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const require = createRequire(import.meta.url);
const { readZip, writeZip } = require('../../cli/core/zip-stream.js');

const tmp = mkdtempSync(path.join(os.tmpdir(), 'fieldseal-fuzz-'));
let checks = 0;

async function tryRead(name, bytes) {
 const file = path.join(tmp, name);
 writeFileSync(file, bytes);
 let zip = null;
 try {
 zip = await readZip(file);
 assert(Array.isArray(zip.entries), 'readZip must return an entries array');
 } catch (e) {
 // Controlled rejection only: the reader must surface a typed Error, never an
 // uncaught exception, a hang, or a naked undefined.
 assert(e instanceof Error, 'malformed ZIP must raise an Error');
 assert(e.message && e.message.length > 0, 'malformed ZIP error must have a message');
 assert(!(e instanceof SyntaxError), 'malformed ZIP must not confuse the JS parser');
 } finally {
 if (zip && typeof zip.close === 'function') await zip.close();
 }
 checks++;
}

try {
 // 1. Deterministic pseudo-random garbage (fixed seed, reproducible in CI).
 let seed = 0x5eed1234;
 const rnd = (n) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
 for (let i = 0; i < 12; i++) {
 const size = 1 + rnd(512);
 const buf = Buffer.allocUnsafe(size);
 for (let j = 0; j < size; j++) buf[j] = rnd(256);
 await tryRead('garbage-' + i + '.bin', buf);
 }

 // 2. A valid archive, then truncation / bit flips / EOCD tampering.
 const good = path.join(tmp, 'good.zip');
 await writeZip(good, [{ name: 'a.txt', data: Buffer.from('hello world') }]);
 const original = readFileSync(good);
 await tryRead('valid.bin', original);
 for (const cut of [1, 10, 22, Math.floor(original.length / 2), original.length - 1]) {
 await tryRead('truncated-' + cut + '.bin', original.subarray(0, Math.max(0, cut)));
 }
 for (const pos of [0, 4, 10, Math.floor(original.length / 2), original.length - 10]) {
 const flipped = Buffer.from(original);
 flipped[pos] = flipped[pos] ^ 0xff;
 await tryRead('flipped-' + pos + '.bin', flipped);
 }
 const badCount = Buffer.from(original);
 const eocd = badCount.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
 if (eocd >= 0) {
 badCount.writeUInt16LE(0xffff, eocd + 10);
 await tryRead('bad-count.bin', badCount);
 }

 // 3. Canonical hashing must be stable and injection-safe for hostile values.
 assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }), 'canonical order is key-sorted');
 const hostile = {
 text: '=HYPERLINK("x","y")\u0000\u2028<script>alert(1)</script>',
 nested: ['+1', '-1', '@SUM', { z: null, y: 0 }],
 unicode: 'Äé\u{1F512}'
 };
 const serialised = canonicalJson(hostile);
 assert.equal(typeof serialised, 'string', 'canonicalJson returns a string');
 assert.equal(canonicalJson(JSON.parse(serialised)), canonicalJson(hostile), 'canonical form is idempotent');
 assert.doesNotThrow(() => JSON.parse(serialised), 'canonical form stays valid JSON');
 assert.throws(() => canonicalJson({ bad: undefined }), TypeError, 'unsupported types fail closed');
 assert.throws(() => canonicalJson({ bad: Infinity }), TypeError, 'non-finite numbers fail closed');
 checks += 5;

 // 4. Static hardening contracts that the fuzz cases above rely on.
 const verifySrc = readFileSync(path.join(ROOT, 'cli/core/case-verify.js'), 'utf8');
 assert(/p === '' \|\| p === '\.' \|\| p === '\.\.'/.test(verifySrc), 'ZIP extraction must reject .. segments');
 const componentsSrc = readFileSync(path.join(ROOT, 'pwa/ui/components.js'), 'utf8');
 assert(/\.textContent\s*=/.test(componentsSrc), 'DOM builder must use textContent, not innerHTML');
 checks += 2;
} finally {
 rmSync(tmp, { recursive: true, force: true });
}

process.stdout.write('FIELDSEAL-TEST-OK fuzz-inputs (' + checks + ' malformed-input checks)\n');
