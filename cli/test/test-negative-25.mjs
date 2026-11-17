#!/usr/bin/env node
/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// A3.1: 25 malformed / state / crypto / concurrency negatives at the real kernel boundary.
// Each case must be explicitly rejected — never a silent success.
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as C from '../../pwa/core/case-manifest.js';
import * as E from '../../pwa/core/evidence-manifest.js';
import zipStreamPkg from '../../cli/core/zip-stream.js';
const zipStream = zipStreamPkg.default || zipStreamPkg;

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log('  ok  - ' + n); };
const bad = (n, d) => { fail++; console.log('  FAIL - ' + n + (d ? ' :: ' + d : '')); };
const throws = async (fn) => { try { await fn(); return null; } catch (e) { return e && e.message || String(e); } };
const T = async (n, fn, re) => { const e = await throws(fn); e && (!re || re.test(e)) ? ok(n + ' rejected: ' + e.slice(0, 60)) : bad(n, e || 'silently accepted'); };
const Tcheck = async (n, fn) => { let rej = false, e = null; try { rej = !!(await fn()); } catch (x) { rej = true; e = x && x.message; } rej ? ok(n + ' rejected' + (e ? ': ' + e.slice(0, 50) : '')) : bad(n, 'silently accepted'); };
const base = async () => C.createCase({ metaTemplate: 'blank', mode: 'full' });
const validHash = 'sha256:' + 'a'.repeat(64);

(async () => {
  const c0 = await base();
  await T('01 missing rootHash', () => C.addCapture(c0, { packageId: randomUUID(), evidenceId: randomUUID() }), /hash/i);
  await T('02 malformed rootHash', () => C.addCapture(c0, { packageId: randomUUID(), rootHash: 'not-a-hash', evidenceId: randomUUID() }), /hash/i);
  await T('03 uppercase/invalid prefix hash', () => C.addCapture(c0, { packageId: randomUUID(), rootHash: 'sha256:' + 'A'.repeat(64), evidenceId: randomUUID() }), /hash/i);
  await T('04 invalid submitted UTC', () => C.addCapture(c0, { packageId: randomUUID(), rootHash: validHash, evidenceId: randomUUID(), capturedUtc: 'not-a-date' }), null);
  await T('05 invalid custody event type', () => C.addCustodyEntry(c0, { eventType: 'Bogus' }), /eventType/i);
  await T('06 invalid countersign before pending', () => C.addCountersign(c0, { actorName: 'A', decision: 'Approve' }), /pending/i);
  const pending = await C.sendForCountersign(c0, {});
  await T('07 empty countersign name', () => C.addCountersign(pending, { actorName: '', decision: 'Approve' }), /actorName/i);
  await T('08 invalid countersign decision', () => C.addCountersign(pending, { actorName: 'A', decision: 'Maybe' }), /decision/i);
  await T('09 embedded signature data URL forbidden', () => C.addCountersign(pending, { actorName: 'A', decision: 'Approve', signatureDataUrl: 'data:image/png;base64,AA==' }), /signatureDataUrl/i);
  await C.addCountersign(pending, { actorName: 'Anna', decision: 'Approve' });
  await T('10 duplicate countersign signer', () => C.addCountersign(pending, { actorName: 'anna', decision: 'Approve' }), /duplicate/i);

  const sealed = await C.sealCase(pending, {});
  await T('11 add capture after sealed', () => C.addCapture(sealed, { packageId: randomUUID(), rootHash: validHash, evidenceId: randomUUID() }), /seal|mutable|state/i);
  await T('12 countersign after sealed', () => C.addCountersign(sealed, { actorName: 'B', decision: 'Approve' }), /seal|mutable|state/i);
  await T('13 send for countersign after sealed', () => C.sendForCountersign(sealed, {}), /seal|mutable|state|draft/i);
  await T('14 seal twice', () => C.sealCase(sealed, {}), /already sealed/i);
  await T('15 schema lock after sealed', () => C.setSchemaLocked(sealed, true), /seal|mutable|state/i);
  await T('16 human note after sealed', () => C.addHumanNote(sealed, { note: 'x' }), /seal|mutable|state/i);
  await T('17 watermark after sealed', () => C.recordWatermark(sealed, [{ id: 'x' }]), /seal|mutable|state/i);
  await Tcheck('18 export/verify missing case directory', async () => { const { spawnSync } = await import('node:child_process'); const r = spawnSync(process.execPath, ['cli/bin/audit.js', 'case', 'verify', '/tmp/fieldseal-does-not-exist-' + Date.now(), '--json'], { encoding: 'utf8' }); return r.status !== 0; });
  await Tcheck('19 manifest null', () => !C.validateCaseManifest(null).ok);
  await Tcheck('20 manifest wrong spec', () => { const x = JSON.parse(JSON.stringify(c0)); x.spec = 'evil'; return !C.validateCaseManifest(x).ok; });
  await Tcheck('21 manifest missing arrays', () => { const x = JSON.parse(JSON.stringify(c0)); delete x.children; return !C.validateCaseManifest(x).ok; });
  await Tcheck('22 sealed manifest without sealHash', () => { const x = JSON.parse(JSON.stringify(sealed)); x.sealHash = ''; return !C.validateCaseManifest(x).ok; });
  await T('23 evidence path traversal name', () => E.buildEvidenceManifest({ packageId: randomUUID(), files: [{ name: '../evil.jpg', hash: validHash, type: 'image' }], gps: { lat: 0, lon: 0 }, note: '', tags: [] }), null);
  await T('24 evidence non-hex hash', () => E.buildEvidenceManifest({ packageId: randomUUID(), files: [{ name: 'photo.jpg', hash: 'sha256:nothex', type: 'image' }], gps: { lat: 0, lon: 0 }, note: '', tags: [] }), null);
  await T('25 zip path traversal entry', async () => {
    const d = mkdtempSync(join(tmpdir(), 'fs-neg-'));
    const f = join(d, 'a.txt'); writeFileSync(f, 'x');
    await zipStream.writeZip(join(d, 'evil.zip'), [{ name: '../evil.txt', sourcePath: f }]);
    rmSync(d, { recursive: true, force: true });
  }, null);

  console.log((fail ? 'NEGATIVE-25: FAIL (' + fail + ')' : 'NEGATIVE-25: PASS — ' + pass + ' negative cases'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('NEGATIVE-25: ERROR', e && e.stack || e); process.exit(1); });
