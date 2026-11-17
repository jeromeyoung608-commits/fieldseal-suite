#!/usr/bin/env node
/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */
// One-command acceptance for the audit-trail hardening (9.0 A1-A6 / A4 negative matrix).
// Exercises the PRODUCT code path (device key + SEPARATE TSA key, never a shipped private
// key) and the mode-aware timestamp anchor (off / local / external-RFC3161, no silent
// fallback). Includes the 11-case negative matrix from the 9.0 audit acceptance table.
// Usage: node cli/bin/audit-acceptance.mjs   (exit 0 = all green)
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(process.cwd(), 'pwa');
let failures = 0;
let passed = 0;
function check(name, ok, detail) {
  if (ok) { passed += 1; console.log('  [PASS] ' + name); }
  else { console.error('  [FAIL] ' + name + (detail ? ' :: ' + detail : '')); failures += 1; }
}

(async () => {
  globalThis.__fieldsealMemStore = new Map();
  globalThis.__fieldsealAnchorStore = new Map();
  const log = await import(pathToFileURL(resolve(ROOT, 'helpers/local-audit-log.js')).href);
  const anchorMod = await import(pathToFileURL(resolve(ROOT, 'helpers/audit-anchor.js')).href);
  const deviceMod = await import(pathToFileURL(resolve(ROOT, 'helpers/audit-device-key.js')).href);
  const tsaMod = await import(pathToFileURL(resolve(ROOT, 'helpers/audit-tsa.js')).href);

  const kp = await deviceMod.ensureDeviceKey();
  const tsaKp = await tsaMod._setTsaKeyForTesting(await anchorMod.generateEd25519KeyPair(false));

  log.setLogEnabled(true);
  log.clearLog();
  log.addEvent({ eventType: 'Collected', actor: { name: 'acceptance' }, target: { id: 'case-1' } });
  log.addEvent({ eventType: 'Sealed', actor: { name: 'acceptance' }, target: { id: 'case-1' } });
  log.addEvent({ eventType: 'Exported', actor: { name: 'acceptance' }, target: { id: 'case-1' } });

  // ① Real persisted-log chain verify (also awaits the seal queue so entries are sealed).
  const chain = await log.verifyChain();
  check('① real trail chain verifies (' + chain.count + ' entries)', chain.ok === true, chain.reason);
  const entries = log.getLog();
  const head = anchorMod.chainHead(entries);

  // ② Dual-key anchor committed & verifies (device + separate TSA, two stores).
  await log.commitAnchor();
  const av = await log.verifyAnchorStore(kp.spki, tsaKp.spki);
  check('② dual-key anchor committed & verifies (device + TSA, separate stores)', av.ok === true, av.reason);

  // ③ Signed export via the PRODUCT path: device key + LOCAL TSA attestation.
  const tsaTokenLocal = await tsaMod.createTimestamp(head, { tsaKeyPair: tsaKp });
  const exp = await anchorMod.signedLogExport(entries, kp, { tsaMode: 'local', tsaToken: tsaTokenLocal, tsaRootFingerprint: 'LOCAL' });
  const ve = await anchorMod.verifySignedExport(exp, kp.spki, { trustedTsaSpki: tsaKp.spki });
  check('③ signed export (local TSA) verifies offline', ve.ok === true && ve.count === entries.length && ve.tsaMode === 'local');

  // ④ Tamper the log -> must fail.
  const tampered = JSON.parse(JSON.stringify(exp));
  tampered.log = tampered.log.replace(entries[2].hash, 'e'.repeat(64));
  const veTamper = await anchorMod.verifySignedExport(tampered, kp.spki, { trustedTsaSpki: tsaKp.spki });
  check('④ tampered log is REJECTED', veTamper.ok === false, veTamper.reason);

  // ⑤ Attacker signs with DIFFERENT device + TSA keys -> must fail (forge closed).
  const attacker = await anchorMod.generateEd25519KeyPair(false);
  const attackerTsa = await anchorMod.generateEd25519KeyPair(false);
  const forgedHead = anchorMod.chainHead(JSON.parse(tampered.log));
  const forged = {
    format: 'fieldseal-audit-export-v2', log: tampered.log, head: forgedHead,
    devicePubKey: await anchorMod.exportPublicKey(attacker),
    signature: await anchorMod.signText(forgedHead, attacker.privateKey),
    tsaMode: 'local', tsaToken: await tsaMod.createTimestamp(forgedHead, { tsaKeyPair: attackerTsa }),
    generatedAt: new Date().toISOString()
  };
  const veForge = await anchorMod.verifySignedExport(forged, kp.spki, { trustedTsaSpki: tsaKp.spki });
  check('⑤ forge (attacker different device+TSA keys) is REJECTED', veForge.ok === false, veForge.reason);

  // ⑥ Unsigned file -> doctor must fail (no "signature ok" false positive).
  const rawPath = join(tmpdir(), 'raw-audit.json');
  writeFileSync(rawPath, JSON.stringify(entries, null, 2), 'utf8');
  const drRaw = spawnSync('node', ['cli/bin/doctor.mjs', '--audit-log', rawPath], { cwd: process.cwd(), encoding: 'utf8' });
  const drRawLine = (drRaw.stdout || '').split('\n').find((l) => /log\.chain/.test(l));
  check('⑥ doctor REJECTS an unsigned file (signature missing -> fail)', drRawLine && /signature missing/.test(drRawLine), drRawLine || (drRaw.stdout || drRaw.stderr || '').slice(0, 300));

  // ⑦ External TSA UNREACHABLE -> export must FAIL (no silent fallback to local).
  let exportThrew = false;
  try {
    await tsaMod.externalTimestamp(head, 'http://127.0.0.1:1/tsa', tsaKp.spki); // dead port => fast ECONNREFUSED
  } catch (e) { exportThrew = true; }
  check('⑦ external TSA unreachable -> export refused (no silent fallback)', exportThrew === true);

  // ⑧ External token INVALID/MISMATCHED kind -> verifySignedExport REJECTS.
  const badExt = JSON.parse(JSON.stringify(exp));
  badExt.tsaMode = 'external';
  badExt.tsaToken = tsaTokenLocal; // a local-tsa token mislabelled as external
  const veBadExt = await anchorMod.verifySignedExport(badExt, kp.spki, { trustedTsaSpki: tsaKp.spki });
  check('⑧ external token with wrong kind is REJECTED', veBadExt.ok === false, veBadExt.reason);

  // ⑨ Replay / stale export -> exported head != current live head -> REJECTED.
  const entriesPlus = entries.concat([{ v: 2, id: 'e9', eventType: 'Ev9', prevHash: head, hash: 'f'.repeat(64) }]);
  const currentHead = anchorMod.chainHead(entriesPlus); // advanced live head
  const veReplay = await anchorMod.verifySignedExport(exp, kp.spki, { trustedTsaSpki: tsaKp.spki, currentHead });
  check('⑨ replay/stale export (head != current) is REJECTED', veReplay.ok === false && /stale|replay/.test(veReplay.reason), veReplay.reason);

  // ⑩ Rollback: live log truncated so anchor head no longer matches -> anchor REJECTED.
  const allNow = log.getLog();
  globalThis.__fieldsealMemStore.set('fieldseal-local-audit-log', JSON.stringify(allNow.slice(0, 1))); // rollback
  const vRollback = await log.verifyAnchorStore(kp.spki, tsaKp.spki);
  check('⑩ rollback (log truncated) -> anchor head mismatch REJECTED', vRollback.ok === false && /head mismatch/.test(vRollback.reason), vRollback.reason);
  globalThis.__fieldsealMemStore.set('fieldseal-local-audit-log', JSON.stringify(allNow));

  // ⑪ Anchor DELETED -> startup/doctor warning (no anchor committed).
  globalThis.__fieldsealAnchorStore.delete('fieldseal-audit-anchor');
  const vNoAnchor = await log.verifyAnchorStore(kp.spki, tsaKp.spki);
  check('⑪ anchor deleted -> warned (no anchor committed)', vNoAnchor.ok === false && /no anchor/.test(vNoAnchor.reason), vNoAnchor.reason);
  globalThis.__fieldsealAnchorStore.set('fieldseal-audit-anchor', JSON.stringify(av));

  // ⑫ REAL RFC3161 verify-to-root via the system openssl (NO mock execFileSync). Generate a
  // CA+TSA with openssl, mint a genuine token, and verify BOTH the full TimeStampResponse and
  // the bare token-only (the -token_in fallback). Also confirm a WRONG head is rejected.
  const { verifyRfc3161Token } = await import(pathToFileURL(resolve(process.cwd(), 'cli/core/tsa-verify.js')).href);
  const tsaHelp = await import(pathToFileURL(resolve(process.cwd(), 'cli/test/tsa-test-helpers.mjs')).href);
  let fx = null;
  if (tsaHelp.hasOpenSsl()) {
    fx = tsaHelp.generateTsaFixture();
    const full = tsaHelp.makeFullResponse(fx, head);
    const fullB64 = full.toString('base64');
    const okFull = verifyRfc3161Token({ tokenDerB64: fullB64, rootCertPath: fx.caCrt, headHex: head });
    check('⑫ external RFC3161 full TimeStampResponse verifies to root (openssl)', okFull.ok === true, okFull.reason);
    const tokenOnly = tsaHelp.extractTokenOnly(full);
    const okTok = verifyRfc3161Token({ tokenDerB64: tokenOnly.toString('base64'), rootCertPath: fx.caCrt, headHex: head });
    check('⑫ external RFC3161 token-only (-token_in) verifies to root (openssl)', okTok.ok === true, okTok.reason);
    const bad = verifyRfc3161Token({ tokenDerB64: fullB64, rootCertPath: fx.caCrt, headHex: '00'.repeat(32) });
    check('⑫ external RFC3161 rejects WRONG head (imprint mismatch)', bad.ok === false);
  } else {
    check('⑫ external RFC3161 verify-to-root (openssl present)', false, 'openssl not available in this environment');
  }

  // ⑬ Real doctor on the LOCAL product export (the UI export button calls the same code) —
  // local TSA token path, verified with --device-key + --tsa-key.
  const exportPath = join(tmpdir(), 'recipient-audit-log-signed.json');
  writeFileSync(exportPath, JSON.stringify(exp, null, 2), 'utf8');
  const dr = spawnSync('node', ['cli/bin/doctor.mjs', '--audit-log', exportPath, '--device-key', kp.spki, '--tsa-key', tsaKp.spki], { cwd: process.cwd(), encoding: 'utf8' });
  const drLine = (dr.stdout || '').split('\n').find((l) => /log\.chain/.test(l));
  const drOk = drLine && /chain ok/.test(drLine) && /signature ok/.test(drLine);
  check('⑬ doctor verifies the real exported file via --audit-log + --device-key + --tsa-key', drOk, drLine || (dr.stdout || dr.stderr || '').slice(0, 300));

  // ⑭ REAL external success link: fetch a local TSA service (openssl-signed tokens) →
  // externalTimestamp → signedLogExport(mode=external) → doctor --tsa-root (openssl verify).
  if (tsaHelp.hasOpenSsl() && fx) {
    const srv = await tsaHelp.startTsaServer(fx);
    try {
      const tsaTok = await tsaMod.externalTimestamp(head, srv.url, fx.caSpkiB64);
      const extExp = await anchorMod.signedLogExport(entries, kp, { tsaMode: 'external', tsaToken: tsaTok, tsaDegraded: false });
      const extPath = join(tmpdir(), 'ext-export.json');
      writeFileSync(extPath, JSON.stringify(extExp, null, 2));
      const dr2 = spawnSync('node', ['cli/bin/doctor.mjs', '--audit-log', extPath, '--device-key', kp.spki, '--tsa-root', fx.caCrt], { cwd: process.cwd(), encoding: 'utf8' });
      const dr2Line = (dr2.stdout || dr2.stderr || '').split('\n').find((l) => /log\.chain|signature/.test(l));
      check('⑭ real external RFC3161 round-trip (fetch TSA → signedLogExport external → doctor openssl verify to root)',
        dr2.status === 0, dr2Line || (dr2.stdout || dr2.stderr || '').slice(0, 400));
      rmSync(extPath, { force: true });
    } finally { srv.close(); }
  } else {
    check('⑭ real external RFC3161 round-trip', false, 'openssl not available');
  }

  rmSync(exportPath, { force: true });
  rmSync(rawPath, { force: true });
  log.clearLog();
  delete globalThis.__fieldsealMemStore;
  delete globalThis.__fieldsealAnchorStore;

  console.log('');
  console.log('PRODUCT EXPORT FILE : recipient-audit-log-signed.json (downloaded by sign.html / backup.html)');
  console.log('VERIFY COMMAND     : node cli/bin/doctor.mjs --audit-log recipient-audit-log-signed.json --device-key <device.pub> --tsa-key <tsa.pub> [--tsa-root <tsa-root.pem>]');
  console.log('TRUST MODEL        : device-bound non-extractable key + separate TSA key (two independent keys, two separate stores); product ships NO private key; verify only against trusted spkis; external RFC3161 verified by openssl, never hand-rolled ASN.1');
  if (failures) { console.error('AUDIT ACCEPTANCE: FAIL (' + failures + ' failed, ' + passed + ' passed)'); process.exit(1); }
  console.log('AUDIT ACCEPTANCE: PASS — ' + passed + '/' + (passed + failures) + ' (11-case negative matrix + REAL openssl RFC3161 + real external round-trip + real-file doctor)');
})().catch((e) => { console.error('AUDIT ACCEPTANCE: ERROR ' + e.message); process.exit(1); });
