/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 *
 * Regression for the offline signed release manifest + backup / restore / rollback tool.
 * All state is built in a temp dir; the real dist/ and the real release store are never touched.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  RELEASE_SPEC, REPO_ROOT, SUMS_FILE, SIG_FILE, PUBKEY_FILE, BACKUP_MANIFEST,
  sha256, generateKeypair, assertKeyOutsideRepo, signSums, verifySignature,
  createSnapshot, listSnapshots, verifySnapshot, restoreSnapshot, rollback,
  status, safeFileName
} from './release-tool.mjs';

let pass = 0, fail = 0;
function assert(c, m) { if (c) { pass++; console.log('  ok  - ' + m); } else { fail++; console.log('  FAIL- ' + m); } }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldseal-release-'));
const dist = path.join(tmp, 'dist');
const store = path.join(tmp, 'store');
const keys = path.join(tmp, 'keys');
fs.mkdirSync(dist, { recursive: true });

// Minimal stand-in for a release set (real binaries are ~50 MB; hashes are what matter here).
const binary = crypto.randomBytes(4096);
const binary2 = crypto.randomBytes(2048);
fs.writeFileSync(path.join(dist, 'fieldseal-case-verify-linux-x64'), binary);
fs.writeFileSync(path.join(dist, 'fieldseal-case-verify-macos-arm64'), binary2);
const sums = [sha256(binary) + '  fieldseal-case-verify-linux-x64', sha256(binary2) + '  fieldseal-case-verify-macos-arm64'].join('\n') + '\n';
fs.writeFileSync(path.join(dist, SUMS_FILE), sums);
fs.writeFileSync(path.join(dist, 'manifest.json'), JSON.stringify({ tool: 'fieldseal-case-verify', signature: { scheme: 'gpg-detached', status: 'unsigned' } }, null, 2) + '\n');
const sumsOriginal = fs.readFileSync(path.join(dist, SUMS_FILE));

try {
  // --- private key handling ---
  let refused = false;
  try { assertKeyOutsideRepo(path.join(REPO_ROOT, 'release-private-key.pem')); } catch { refused = true; }
  assert(refused, 'refuses to write a private key inside the repository');
  const kp = generateKeypair(keys);
  assert(fs.existsSync(kp.privatePath) && !kp.privatePath.startsWith(REPO_ROOT), 'keygen writes the private key outside the repo');
  assert(kp.publicPem.includes('BEGIN PUBLIC KEY'), 'public key is a PEM SPKI key');

  // --- signed manifest ---
  const envelope = signSums(dist, fs.readFileSync(kp.privatePath, 'utf8'));
  assert(envelope.spec === RELEASE_SPEC && envelope.algorithm === 'Ed25519', 'signature envelope declares spec + algorithm');
  assert(fs.existsSync(path.join(dist, SIG_FILE)) && fs.existsSync(path.join(dist, PUBKEY_FILE)), 'signature + public key written into dist');
  assert(verifySignature(dist).ok, 'signed manifest verifies offline (no GPG, no network)');
  assert(JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8')).signature.status === 'signed', 'dist manifest.json records signed state');

  // tamper: SHA256SUMS changed after signing
  fs.writeFileSync(path.join(dist, SUMS_FILE), sums + 'deadbeef  evil.bin\n');
  assert(!verifySignature(dist).ok, 'tampered SHA256SUMS fails signature verification');
  fs.writeFileSync(path.join(dist, SUMS_FILE), sumsOriginal);

  // tamper: signature bytes changed
  const sigObj = JSON.parse(fs.readFileSync(path.join(dist, SIG_FILE), 'utf8'));
  const sigBackup = sigObj.signature;
  sigObj.signature = Buffer.from(crypto.randomBytes(64)).toString('base64');
  fs.writeFileSync(path.join(dist, SIG_FILE), JSON.stringify(sigObj, null, 2) + '\n');
  assert(!verifySignature(dist).ok, 'tampered signature fails verification');
  sigObj.signature = sigBackup;
  fs.writeFileSync(path.join(dist, SIG_FILE), JSON.stringify(sigObj, null, 2) + '\n');

  // tamper: swapped public key
  const other = generateKeypair(path.join(tmp, 'other-keys'));
  const pubBackup = fs.readFileSync(path.join(dist, PUBKEY_FILE), 'utf8');
  fs.writeFileSync(path.join(dist, PUBKEY_FILE), other.publicPem);
  assert(!verifySignature(dist).ok, 'swapped public key fails verification (fingerprint + signature)');
  fs.writeFileSync(path.join(dist, PUBKEY_FILE), pubBackup);
  assert(verifySignature(dist).ok, 'restored public key verifies again');

  // --- backup ---
  const snap = createSnapshot({ distDir: dist, storeDir: store, label: 'baseline' });
  assert(fs.existsSync(path.join(snap.dir, BACKUP_MANIFEST)), 'snapshot writes a BACKUP-MANIFEST.json');
  assert(snap.manifest.files.length === 6, 'snapshot lists all 6 release files (2 binaries + SUMS + manifest + sig + pubkey)');
  assert(verifySnapshot({ storeDir: store, id: snap.id }).ok, 'snapshot passes its own hash + self-hash verification');
  assert(listSnapshots(store).includes(snap.id), 'snapshot is discoverable via list');

  // tamper: payload byte changed
  const payload = path.join(snap.dir, 'files', 'fieldseal-case-verify-linux-x64');
  const goodBinary = fs.readFileSync(payload);
  fs.writeFileSync(payload, Buffer.concat([goodBinary, Buffer.from('x')]));
  assert(!verifySnapshot({ storeDir: store, id: snap.id }).ok, 'tampered snapshot payload fails verification');
  fs.writeFileSync(payload, goodBinary);

  // tamper: backup manifest self-hash
  const bmPath = path.join(snap.dir, BACKUP_MANIFEST);
  const bmGood = fs.readFileSync(bmPath, 'utf8');
  const bmObj = JSON.parse(bmGood);
  bmObj.label = 'FORGED';
  fs.writeFileSync(bmPath, JSON.stringify(bmObj, null, 2) + '\n');
  assert(!verifySnapshot({ storeDir: store, id: snap.id }).ok, 'tampered backup manifest fails self-hash check');
  fs.writeFileSync(bmPath, bmGood);

  // --- restore (dry-run must not mutate) ---
  fs.writeFileSync(path.join(dist, 'fieldseal-case-verify-linux-x64'), Buffer.from('CORRUPTED'));
  const dry = restoreSnapshot({ distDir: dist, storeDir: store, id: snap.id, apply: false });
  assert(dry.applied === false && dry.plan.length === 6, 'restore is dry-run by default (full 6-file plan)');
  assert(fs.readFileSync(path.join(dist, 'fieldseal-case-verify-linux-x64')).toString() === 'CORRUPTED', 'dry-run does not modify dist');

  const applied = restoreSnapshot({ distDir: dist, storeDir: store, id: snap.id, apply: true });
  assert(applied.applied === true, 'restore --apply executes');
  assert(Buffer.compare(fs.readFileSync(path.join(dist, 'fieldseal-case-verify-linux-x64')), binary) === 0, 'restore recovers corrupted binary byte-for-byte');
  assert(verifySignature(dist).ok, 'restored release set is still signed + valid');
  assert(applied.safetySnapshot && applied.safetySnapshot.includes('pre-rollback'), 'restore auto-creates a pre-rollback snapshot (rollback is reversible)');
  assert(verifySnapshot({ storeDir: store, id: applied.safetySnapshot }).ok, 'pre-rollback snapshot is itself verified');

  // --- rollback ---
  const rb = rollback({ distDir: dist, storeDir: store, apply: false });
  assert(rb.applied === false && rb.plan.length > 0, 'rollback targets the newest VERIFIED non-pre-rollback snapshot');
  assert(status({ distDir: dist, storeDir: store }).signedRelease === true, 'status reports signed release');
  assert(status({ distDir: dist, storeDir: store }).rollbackTargets.includes(snap.id), 'status reports a usable rollback target');

  // --- metadata-only + path safety ---
  const meta = createSnapshot({ distDir: dist, storeDir: store, label: 'meta', metadataOnly: true });
  assert(meta.manifest.files.filter((f) => !f.stored).length === 2, 'metadata-only snapshot does not copy binaries');
  assert(verifySnapshot({ storeDir: store, id: meta.id }).ok, 'metadata-only snapshot verifies');
  assert(safeFileName('../../etc/passwd') === null && safeFileName('/abs') === null && safeFileName('') === null, 'path-traversal / absolute names rejected');
  assert(safeFileName('SHA256SUMS') === 'SHA256SUMS', 'plain filename accepted');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log((fail ? 'FIELDSEAL-TEST-FAIL' : 'FIELDSEAL-TEST-OK') + ' release-tool (' + pass + ' pass, ' + fail + ' fail)');
process.exit(fail ? 1 : 0);
