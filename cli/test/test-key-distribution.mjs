#!/usr/bin/env node
/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// A2: device/TSA public-key distribution is real. Generates device + separate TSA keys
// in-process (no shipped private key), writes `device-key-<fp>.pub` / `tsa-key-<fp>.pub`,
// signs a real audit export, then drives `doctor` with those FILE paths. A one-byte
// tampered public key must be rejected. No key is read from inside the export.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..');
let fail = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ok  - ' : '  FAIL - ') + name + (detail ? ' :: ' + detail : ''));
  if (!ok) fail++;
}

(async () => {
  globalThis.__fieldsealMemStore = new Map();
  globalThis.__fieldsealAnchorStore = new Map();
  const log = await import(pathToFileURL(resolve(ROOT, 'pwa/helpers/local-audit-log.js')).href);
  const anchor = await import(pathToFileURL(resolve(ROOT, 'pwa/helpers/audit-anchor.js')).href);
  const device = await import(pathToFileURL(resolve(ROOT, 'pwa/helpers/audit-device-key.js')).href);
  const tsa = await import(pathToFileURL(resolve(ROOT, 'pwa/helpers/audit-tsa.js')).href);
  const keyexp = await import(pathToFileURL(resolve(ROOT, 'pwa/helpers/audit-key-export.js')).href);

  const deviceKp = await device._setDeviceKeyForTesting(await anchor.generateEd25519KeyPair(false));
  const tsaKp = await tsa._setTsaKeyForTesting(await anchor.generateEd25519KeyPair(false));

  log.setLogEnabled(true);
  log.clearLog();
  log.addEvent({ eventType: 'Collected', actor: { name: 'key-distribution' }, target: { id: 'case-key-1' } });
  log.addEvent({ eventType: 'Sealed', actor: { name: 'key-distribution' }, target: { id: 'case-key-1' } });
  log.addEvent({ eventType: 'Exported', actor: { name: 'key-distribution' }, target: { id: 'case-key-1' } });
  await log.verifyChain();
  const entries = log.getLog();
  const head = anchor.chainHead(entries);
  await log.commitAnchor();
  const token = await tsa.createTimestamp(head, { tsaKeyPair: tsaKp });
  const exp = await anchor.signedLogExport(entries, deviceKp, { tsaMode: 'local', tsaToken: token, tsaRootFingerprint: 'LOCAL' });

  const dir = mkdtempSync(join(tmpdir(), 'fieldseal-keydist-'));
  const deviceFp = await keyexp.fingerprintSpki(deviceKp.spki);
  const tsaFp = await keyexp.fingerprintSpki(tsaKp.spki);
  const devicePub = join(dir, 'device-key-' + deviceFp + '.pub');
  const tsaPub = join(dir, 'tsa-key-' + tsaFp + '.pub');
  const exportFile = join(dir, 'audit-log-signed.json');
  writeFileSync(devicePub, deviceKp.spki + '\n');
  writeFileSync(tsaPub, tsaKp.spki + '\n');
  writeFileSync(exportFile, JSON.stringify(exp, null, 2));

  check('device .pub file is named with its fingerprint', /^device-key-[A-Za-z0-9_-]{16}\.pub$/.test(devicePub.split('/').pop()));
  check('tsa .pub file is named with its fingerprint', /^tsa-key-[A-Za-z0-9_-]{16}\.pub$/.test(tsaPub.split('/').pop()));
  const fromFile = await keyexp.fingerprintSpki(readFileSync(devicePub, 'utf8').trim());
  check('fingerprint recomputed from the distributed file matches', fromFile === deviceFp, fromFile + ' vs ' + deviceFp);

  const dr = spawnSync(process.execPath, ['cli/bin/doctor.mjs', '--audit-log', exportFile, '--device-key', devicePub, '--tsa-key', tsaPub], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  const line = (dr.stdout || '').split('\n').find((l) => /log\.chain/.test(l)) || '';
  check('doctor verifies a real export using the distributed .pub FILE paths', dr.status === 0 && /chain ok/.test(line) && /signature ok/.test(line), line);

  const bad = readFileSync(devicePub, 'utf8').replace(/[A-Za-z0-9]/, (c) => (c === 'A' ? 'B' : 'A'));
  const badFile = join(dir, 'device-key-tampered.pub');
  writeFileSync(badFile, bad);
  const badRun = spawnSync(process.execPath, ['cli/bin/doctor.mjs', '--audit-log', exportFile, '--device-key', badFile, '--tsa-key', tsaPub], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  check('tampered distributed .pub is rejected', badRun.status !== 0 || /signature FAIL|signature mismatch|invalid/i.test(badRun.stdout || ''), (badRun.stdout || '').split('\n').find((l) => /signature/.test(l)) || '');

  rmSync(dir, { recursive: true, force: true });
  console.log(fail ? 'KEY-DISTRIBUTION: FAIL (' + fail + ')' : 'KEY-DISTRIBUTION: PASS — device.pub + tsa.pub + fingerprint + doctor + tamper-reject');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('KEY-DISTRIBUTION: ERROR', e && e.stack || e); process.exit(1); });
