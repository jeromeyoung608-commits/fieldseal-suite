/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * Self-test for the Aegis crypto component (P2-b). Run:  node test-aegis.mjs
 *
 * Fixtures are generated on the fly (offline). The storage-decrypt path is validated against the
 * REAL kernel encryptor (pwa/helpers/case-crypto.js) to prove the contract is byte-compatible.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const { writeZip } = require('../../cli/core/zip-stream.js');

import {
  decryptStorageCipher, wrapAegis, openAegis, generateMemberKey
} from './aegis-core.mjs';
import {
  cmdGenKeys, cmdWrap, cmdOpen, cmdDecryptStorage, cmdVerifyStorage
} from './aegis-cli.mjs';
import { createServer } from './aegis-agent.mjs';

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log('  ok  - ' + msg);
  else { console.error('  FAIL- ' + msg); failures++; }
}

const SAMPLE = {
  spec: 'fieldseal-case-v0.5', packageId: 'CASE-AEGIS-1', specVersion: 'fieldseal-case-v0.5',
  state: 'sealed', sealedAt: '2026-11-13T04:36:42Z',
  rootHash: 'sha256:618961cb328b326719dfc8b2a8d3b4532f3987f43075a774349badfc7c556106',
  sealHash: 'sha256:a4a70419323a16de17c8012b58a9e7963339da9bdd3cfbfa6441f91683c6e177',
  caseMeta: { title: 'Aegis Sample' }, children: []
};

async function loadKernelEncryptor() {
  const src = join(__dirname0(), '..', '..', 'pwa', 'helpers', 'case-crypto.js');
  return import(pathToFileURL(src).href);
}
function __dirname0() { return require('node:path').dirname(require('node:url').fileURLToPath(import.meta.url)); }

async function testStorageDecryptContract() {
  console.log('[storage decrypt — kernel contract]');
  const mod = await loadKernelEncryptor();
  const passphrase = 'correct horse battery staple';
  const c = JSON.parse(JSON.stringify(SAMPLE));
  const { ciphertext, meta } = await mod.encryptCaseArchive(c, passphrase);
  c.caseEncryptionMeta = meta; // as the UI would store it in the plaintext manifest

  const res = decryptStorageCipher(ciphertext, c.caseEncryptionMeta, passphrase);
  assert(res.status === 'ok', 'decrypt with correct passphrase -> ok');
  const decoded = JSON.parse(res.plain);
  assert(decoded.sealHash === SAMPLE.sealHash && decoded.packageId === SAMPLE.packageId,
    'decrypted plaintext matches original manifest (byte contract)');

  const tampered = Buffer.from(ciphertext); tampered[0] ^= 0xff;
  const r2 = decryptStorageCipher(tampered, c.caseEncryptionMeta, passphrase);
  assert(r2.status === 'tampered', 'tampered ciphertext -> tampered (not invalid_passphrase)');

  const r3 = decryptStorageCipher(ciphertext, c.caseEncryptionMeta, 'wrong-pass');
  assert(r3.status === 'invalid_passphrase', 'wrong passphrase -> invalid_passphrase');

  // meta missing salt -> treated as invalid_passphrase, no throw
  const r4 = decryptStorageCipher(ciphertext, null, passphrase);
  assert(r4.status === 'invalid_passphrase', 'missing meta -> invalid_passphrase, no throw');
}

async function testAegisEnvelope() {
  console.log('[aegis group envelope]');
  const k0 = generateMemberKey('lead');
  const k1 = generateMemberKey('counsel');
  const manifestStr = JSON.stringify(SAMPLE, null, 2);
  const env = wrapAegis(manifestStr, [{ memberId: k0.memberId, publicKeyPem: k0.publicKeyPem }, { memberId: k1.memberId, publicKeyPem: k1.publicKeyPem }]);
  assert(env.envelopeSpec === 'fieldseal-aegis-envelope-v0.1', 'envelope spec set');
  assert(env.recipients.length === 2, 'two recipients wrapped');
  assert(env.sourceSealHash === SAMPLE.sealHash, 'source sealHash copied (not recomputed)');

  const open0 = JSON.parse(openAegis(env, k0.memberId, k0.privateKeyPem));
  const open1 = JSON.parse(openAegis(env, k1.memberId, k1.privateKeyPem));
  assert(open0.packageId === SAMPLE.packageId && open0.sealHash === SAMPLE.sealHash, 'member0 opens envelope');
  assert(open1.packageId === SAMPLE.packageId, 'member1 opens same envelope');

  let threw = false;
  try { openAegis(env, 'ghost', k0.privateKeyPem); } catch (e) { threw = /recipient not found/.test(String(e.message || e)); }
  assert(threw, 'unknown member -> recipient not found');

  // A third key not in recipients cannot open it (cross-member isolation)
  const k2 = generateMemberKey('intruder');
  let denied = false;
  try { openAegis(env, k0.memberId, k2.privateKeyPem); } catch (e) { denied = true; }
  assert(denied, 'non-recipient private key cannot open (RSA-OAEP isolation)');
}

async function testAgent() {
  console.log('[http agent — RB-01 auth + localhost binding]');
  const SECRET = 'aegis-test-secret';
  const auth = { 'content-type': 'application/json', authorization: 'Bearer ' + SECRET };
  const k = generateMemberKey('agent-user');
  const env = wrapAegis(JSON.stringify(SAMPLE), [{ memberId: k.memberId, publicKeyPem: k.publicKeyPem }]);
  const payload = JSON.stringify({ envelope: env, memberId: k.memberId, privateKeyPem: k.privateKeyPem });

  // 1) Fail-closed: a server with NO secret denies every non-health request.
  const openServer = createServer();
  await new Promise((r) => openServer.listen(0, '127.0.0.1', r));
  try {
    const p = openServer.address().port;
    const anon = await fetch('http://127.0.0.1:' + p + '/aegis/open', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: payload
    });
    assert(anon.status === 401, 'unconfigured agent returns 401 (fail-closed), not 400/200');
    const health = await fetch('http://127.0.0.1:' + p + '/health');
    assert(health.ok, '/health stays open for liveness');
  } finally { openServer.close(); }

  // 2) Configured server: anonymous + wrong token -> 401; correct bearer -> 200.
  const server = createServer({ secret: SECRET });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const base = 'http://127.0.0.1:' + port;
  try {
    const anon = await fetch(base + '/aegis/open', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: payload
    });
    assert(anon.status === 401, 'anonymous POST /aegis/open -> 401 (RB-01)');

    const wrong = await fetch(base + '/aegis/open', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer wrong' }, body: payload
    });
    assert(wrong.status === 401, 'wrong bearer token -> 401');

    const res = await fetch(base + '/aegis/open', { method: 'POST', headers: auth, body: payload });
    const j = await res.json();
    assert(res.ok && JSON.parse(j.plain).packageId === SAMPLE.packageId, 'authenticated /aegis/open round-trip');

    const h = await fetch(base + '/health'); assert(h.ok, '/health ok without auth');
  } finally { server.close(); }
}

async function testCli() {
  console.log('[cli]');
  const dir = mkdtempSync(join(tmpdir(), 'aegis-cli-')); // not used for keys; reuse below
  const keyDir = mkdtempSync(join(tmpdir(), 'aegis-keys-'));

  // gen-keys -> files
  await cmdGenKeys(['--member-id', 'cli-user', '--out-dir', keyDir]);
  const pub = readFileSync(join(keyDir, 'aegis-cli-user.pub.pem'), 'utf8');
  const priv = readFileSync(join(keyDir, 'aegis-cli-user.priv.pem'), 'utf8');

  // wrap via CLI
  const manifestPath = join(dir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(SAMPLE, null, 2));
  const envPath = join(dir, 'env.json');
  await cmdWrap(['--manifest', manifestPath, '--recipient', 'cli-user=' + join(keyDir, 'aegis-cli-user.pub.pem'), '--out', envPath]);
  const env = JSON.parse(readFileSync(envPath, 'utf8'));
  assert(env.recipients[0].memberId === 'cli-user', 'CLI wrap produced envelope');

  // open via CLI
  const outPath = join(dir, 'opened.json');
  await cmdOpen(['--envelope', envPath, '--member', 'cli-user', '--key', join(keyDir, 'aegis-cli-user.priv.pem'), '--out', outPath]);
  const opened = JSON.parse(readFileSync(outPath, 'utf8'));
  assert(opened.packageId === SAMPLE.packageId, 'CLI open recovered manifest');

  // decrypt-storage via CLI against a real encrypted case zip
  const mod = await loadKernelEncryptor();
  const passphrase = 'cli-pass';
  const c = JSON.parse(JSON.stringify(SAMPLE));
  const { ciphertext, meta } = await mod.encryptCaseArchive(c, passphrase);
  c.caseEncryptionMeta = meta;
  const zipPath = join(dir, 'enc-case.zip');
  await writeZip(zipPath, [
    { name: 'case-manifest.json', data: JSON.stringify(c) },
    { name: 'case-manifest.json.enc', data: Buffer.from(ciphertext) }
  ]);
  const res = await cmdDecryptStorage(['--zip', zipPath, '--passphrase', passphrase]);
  assert(res.status === 'ok' && JSON.parse(res.plain).packageId === SAMPLE.packageId, 'CLI decrypt-storage (kernel-built zip) ok');

  const meta2 = await cmdVerifyStorage(['--zip', zipPath]);
  assert(meta2 && meta2.ciphertextSha256 === meta.ciphertextSha256, 'CLI verify-storage reads meta');

  // cleanup temp dirs
  try { require('node:fs').rmSync(dir, { recursive: true, force: true }); require('node:fs').rmSync(keyDir, { recursive: true, force: true }); } catch (e) {}
}

(async () => {
  await testStorageDecryptContract();
  await testAegisEnvelope();
  await testAgent();
  await testCli();
  console.log(failures === 0 ? '\nALL AEGIS TESTS PASSED' : '\n' + failures + ' AEGIS TEST(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})();
