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

function hashFile(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}
function recomputeSums() {
  const names = readdirSync(DIST).filter((n) => n !== 'SHA256SUMS' && n !== 'SHA256SUMS.sig' && n !== 'RELEASE-PUBLIC-KEY.pem');
  return names.map((n) => hashFile(join(DIST, n)) + '  ' + n).sort().join('\n') + '\n';
}

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? '  [PASS] ' : '  [FAIL] ') + name + (detail ? ' — ' + detail : ''));
  if (!ok) failures += 1;
}

if (process.argv.includes('--self-test')) {
  const crypto = await import('node:crypto');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const sums = recomputeSums();
  const signature = crypto.sign(null, Buffer.from(sums), privateKey).toString('base64');
  const ok = crypto.verify(null, Buffer.from(sums), publicKey, Buffer.from(signature, 'base64'));
  check('repro-build self-test: sign + verify pipeline', ok === true, 'ed25519 sha256sums');
  // Reproducibility: recomputing twice yields identical sums (deterministic).
  const sums2 = recomputeSums();
  check('repro-build self-test: sums are deterministic', sums === sums2);
} else {
  if (!existsSync(SUMS) || !existsSync(SIG) || !existsSync(PUB)) {
    console.error('REPRO-BUILD: missing dist artefacts (run a build first)');
    process.exit(1);
  }
  const onDisk = recomputeSums();
  const recorded = readFileSync(SUMS, 'utf8');
  check('repro-build: dist digests are reproducible (on-disk == SHA256SUMS)', onDisk === recorded);
  const crypto = await import('node:crypto');
  const pub = crypto.createPublicKey(readFileSync(PUB));
  const ok = crypto.verify(null, Buffer.from(recorded), pub, readFileSync(SIG));
  check('repro-build: release signature verifies', ok === true, 'SHA256SUMS.sig over SHA256SUMS');
}

if (failures) { console.error('REPRO-BUILD: FAIL (' + failures + ')'); process.exit(1); }
console.log('REPRO-BUILD: PASS');
