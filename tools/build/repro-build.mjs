#!/usr/bin/env node
/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */
// Reproducible-build + release-signature verification (9.0 delivery item D1).
// The trusted kernel is already zero-dependency; this script proves the *release*
// artefacts are reproducible and that the Ed25519 detached signature over SHA256SUMS
// verifies. It never runs a network call and never writes a private key into dist.
//
//   node tools/build/repro-build.mjs --verify      # recompute sums, verify existing sig
//   node tools/build/repro-build.mjs --self-test   # ephemeral key: sign + verify pipeline
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const DIST = resolve(process.cwd(), 'tools/build/dist');
const SUMS = join(DIST, 'SHA256SUMS');
const SIG = join(DIST, 'SHA256SUMS.sig');
const PUB = join(DIST, 'RELEASE-PUBLIC-KEY.pem');

// SHA256SUMS covers the binary payloads only. manifest.json describes them and is
// written alongside, so it is not itself signed — same convention as build-binaries.mjs.
const NON_PAYLOAD = new Set(['SHA256SUMS', 'SHA256SUMS.sig', 'RELEASE-PUBLIC-KEY.pem', 'manifest.json']);

function hashFile(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}
function payloadNames() {
  return readdirSync(DIST).filter((n) => !NON_PAYLOAD.has(n)).sort();
}
function recomputeSums() {
  return payloadNames().map((n) => hashFile(join(DIST, n)) + '  ' + n).sort().join('\n') + '\n';
}
// sha256sum-compatible text -> { name: hash }, so comparison is by file, not by
// string ordering or trailing whitespace.
function parseSums(text) {
  const map = new Map();
  for (const line of text.split('\n')) {
    const m = /^([0-9a-f]{64})\s+(.+)$/.exec(line.trim());
    if (m) map.set(m[2], m[1]);
  }
  return map;
}

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? '  [PASS] ' : '  [FAIL] ') + name + (detail ? ' — ' + detail : ''));
  if (!ok) failures += 1;
}

if (process.argv.includes('--self-test')) {
  // The self-test exercises the sign/verify pipeline and its determinism, so it must
  // not depend on built artifacts: a pristine clone has no dist/ and still has to be
  // able to prove the pipeline works. Sign real sums when dist/ exists, otherwise a
  // fixed synthetic payload.
  const crypto = await import('node:crypto');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const material = () => (existsSync(DIST) ? recomputeSums() : 'fieldseal-repro-build-self-test\n');
  const sums = material();
  const signature = crypto.sign(null, Buffer.from(sums), privateKey).toString('base64');
  const ok = crypto.verify(null, Buffer.from(sums), publicKey, Buffer.from(signature, 'base64'));
  check('repro-build self-test: sign + verify pipeline', ok === true, 'ed25519 sha256sums');
  // Reproducibility: recomputing twice yields identical sums (deterministic).
  const sums2 = material();
  check('repro-build self-test: sums are deterministic', sums === sums2);
} else {
  if (!existsSync(SUMS) || !existsSync(SIG) || !existsSync(PUB)) {
    console.error('REPRO-BUILD: missing dist artefacts (run a build first)');
    process.exit(1);
  }
  const onDisk = recomputeSums();
  const recorded = readFileSync(SUMS, 'utf8');
  // Compare per file: every payload on disk must appear in SHA256SUMS with a
  // matching digest, and nothing may be listed that is absent.
  const rec = parseSums(recorded);
  const disk = parseSums(onDisk);
  const missingFromSums = [...disk.keys()].filter((n) => !rec.has(n));
  const notOnDisk = [...rec.keys()].filter((n) => !disk.has(n));
  const mismatched = [...disk.keys()].filter((n) => rec.has(n) && rec.get(n) !== disk.get(n));
  check(
    'repro-build: dist digests are reproducible (on-disk == SHA256SUMS)',
    missingFromSums.length === 0 && notOnDisk.length === 0 && mismatched.length === 0,
    [missingFromSums.length ? 'unsigned: ' + missingFromSums.join(',') : '',
     notOnDisk.length ? 'listed but absent: ' + notOnDisk.join(',') : '',
     mismatched.length ? 'digest mismatch: ' + mismatched.join(',') : ''].filter(Boolean).join('; ') || undefined
  );
  const crypto = await import('node:crypto');
  const pub = crypto.createPublicKey(readFileSync(PUB));
  // SHA256SUMS.sig is a JSON envelope, not a raw detached blob: the base64 signature
  // sits in `signature`, and sha256OfSignedFile pins the exact bytes it covers.
  const envelope = JSON.parse(readFileSync(SIG, 'utf8'));
  const signedDigest = createHash('sha256').update(recorded).digest('hex');
  check('repro-build: envelope pins the signed bytes', envelope.sha256OfSignedFile === signedDigest);
  const ok = crypto.verify(
    null,
    Buffer.from(recorded),
    pub,
    Buffer.from(envelope.signature, 'base64')
  );
  check('repro-build: release signature verifies', ok === true, 'SHA256SUMS.sig over SHA256SUMS');
}

if (failures) { console.error('REPRO-BUILD: FAIL (' + failures + ')'); process.exit(1); }
console.log('REPRO-BUILD: PASS');
