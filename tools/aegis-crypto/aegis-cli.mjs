/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */
/**
 * Aegis crypto CLI (P2-b). Thin wrapper over aegis-core.mjs. Reads case packages READ-ONLY via the
 * kernel's zip reader; never modifies a case. Passphrases / private keys are taken from argv or env
 * and never persisted by this tool.
 *
 * Commands:
 *   gen-keys  [--member-id ID] [--out-dir DIR]
 *   decrypt-storage  --zip CASE.zip --passphrase PASS [--out FILE]
 *   wrap      --manifest FILE --recipient ID=pub.pem [--recipient ...] [--out FILE]
 *   open      --envelope FILE --member ID --key priv.pem [--out FILE]
 *   verify-storage  --zip CASE.zip
 */
import { createRequire } from 'node:module';
import { promises as fs, readFileSync } from 'node:fs';
import { writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { readZip } = require('../../cli/core/zip-stream.js');

import {
  decryptStorageCipher, readStorageMeta, verifyStorageIntegrity,
  wrapAegis, openAegis, generateMemberKey
} from './aegis-core.mjs';

function parseRecipients(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--recipient') {
      const spec = args[++i];
      const eq = spec.indexOf('=');
      if (eq < 0) throw new Error('bad --recipient, expected ID=pub.pem');
      const memberId = spec.slice(0, eq);
      const pubPath = spec.slice(eq + 1);
      out.push({ memberId, publicKeyPem: readFileSync(pubPath, 'utf8') });
    }
  }
  if (!out.length) throw new Error('at least one --recipient is required');
  return out;
}

async function getZipEntries(zipPath) {
  const handle = await readZip(zipPath);
  try {
    const manifestEntry = handle.getEntry('case-manifest.json');
    const encEntry = handle.getEntry('case-manifest.json.enc');
    if (!manifestEntry) throw new Error('case-manifest.json not found in ' + zipPath);
    const manifestText = await handle.readText(manifestEntry, 16 * 1024 * 1024);
    const encBytes = encEntry ? await handle.readBytes(encEntry, 64 * 1024 * 1024) : null;
    return { manifestText, encBytes };
  } finally {
    await handle.close();
  }
}

export async function cmdGenKeys(args) {
  let memberId, outDir;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--member-id') memberId = args[++i];
    else if (args[i] === '--out-dir') outDir = args[++i];
  }
  const k = generateMemberKey(memberId);
  if (outDir) {
    await fs.mkdir(outDir, { recursive: true });
    writeFileSync(outDir + '/aegis-' + k.memberId + '.pub.pem', k.publicKeyPem);
    writeFileSync(outDir + '/aegis-' + k.memberId + '.priv.pem', k.privateKeyPem);
    process.stdout.write('wrote ' + outDir + '/aegis-' + k.memberId + '.{pub,priv}.pem\n');
  } else {
    process.stdout.write('--- memberId ---\n' + k.memberId + '\n--- publicKeyPem ---\n' + k.publicKeyPem +
      '--- privateKeyPem ---\n' + k.privateKeyPem);
  }
  return k;
}

export async function cmdDecryptStorage(args) {
  let zipPath, passphrase, out;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--zip') zipPath = args[++i];
    else if (args[i] === '--passphrase') passphrase = args[++i];
    else if (args[i] === '--out') out = args[++i];
  }
  if (!zipPath || !passphrase) throw new Error('--zip and --passphrase are required');
  const { manifestText, encBytes } = await getZipEntries(zipPath);
  if (!encBytes) throw new Error('case-manifest.json.enc not present (plaintext-only export)');
  const meta = readStorageMeta(manifestText);
  const res = decryptStorageCipher(encBytes, meta, passphrase);
  if (res.status !== 'ok') {
    process.stderr.write('decrypt failed: ' + res.status + '\n');
    return res;
  }
  if (out) writeFileSync(out, res.plain);
  else process.stdout.write(res.plain);
  return res;
}

export async function cmdVerifyStorage(args) {
  let zipPath;
  for (let i = 0; i < args.length; i++) if (args[i] === '--zip') zipPath = args[++i];
  if (!zipPath) throw new Error('--zip required');
  const { manifestText, encBytes } = await getZipEntries(zipPath);
  const meta = readStorageMeta(manifestText);
  if (!meta) { process.stdout.write('no caseEncryptionMeta (plaintext-only export)\n'); return null; }
  const integrity = encBytes ? verifyStorageIntegrity(encBytes, meta) : false;
  process.stdout.write(JSON.stringify({ spec: meta.spec, algorithm: meta.algorithm, iterations: meta.iterations, ciphertextSha256: meta.ciphertextSha256, integrityOk: integrity }, null, 2) + '\n');
  return meta;
}

export async function cmdWrap(args) {
  let manifestPath, out;
  const recipients = parseRecipients(args);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--manifest') manifestPath = args[++i];
    else if (args[i] === '--out') out = args[++i];
  }
  if (!manifestPath) throw new Error('--manifest required');
  const manifestText = readFileSync(manifestPath, 'utf8');
  const envelope = wrapAegis(manifestText, recipients);
  const serialized = JSON.stringify(envelope, null, 2);
  if (out) writeFileSync(out, serialized);
  else process.stdout.write(serialized);
  return envelope;
}

export async function cmdOpen(args) {
  let envelopePath, memberId, keyPath, out;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--envelope') envelopePath = args[++i];
    else if (args[i] === '--member') memberId = args[++i];
    else if (args[i] === '--key') keyPath = args[++i];
    else if (args[i] === '--out') out = args[++i];
  }
  if (!envelopePath || !memberId || !keyPath) throw new Error('--envelope, --member and --key are required');
  const envelope = JSON.parse(readFileSync(envelopePath, 'utf8'));
  const privateKeyPem = readFileSync(keyPath, 'utf8');
  const plain = openAegis(envelope, memberId, privateKeyPem);
  if (out) writeFileSync(out, plain);
  else process.stdout.write(plain);
  return plain;
}

const COMMANDS = {
  'gen-keys': cmdGenKeys,
  'decrypt-storage': cmdDecryptStorage,
  'verify-storage': cmdVerifyStorage,
  'wrap': cmdWrap,
  'open': cmdOpen
};

export async function main(argv = process.argv.slice(2)) {
  const cmd = argv[0];
  const fn = COMMANDS[cmd];
  if (!fn) {
    process.stderr.write('usage: aegis-cli <gen-keys|decrypt-storage|verify-storage|wrap|open> [...]\n');
    process.exitCode = 2;
    return;
  }
  try {
    await fn(argv.slice(1));
  } catch (e) {
    process.stderr.write('error: ' + String((e && e.message) || e) + '\n');
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
