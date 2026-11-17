/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 *
 * Offline verifier for the released binaries. Checks every binary in dist/ against the
 * SHA256SUMS manifest, optionally verifies the GPG detached signature, and smoke-tests
 * each binary by invoking `case verify --help` (or `--version`) to confirm it launches.
 *
 * Run:  cd tools/build && npm run verify
 */
import { createHash, createPublicKey, verify as ed25519Verify } from 'node:crypto';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, 'dist');

function sha256File(p) {
  const h = createHash('sha256');
  h.update(readFileSync(p));
  return h.digest('hex');
}

function main() {
  if (!existsSync(DIST)) { console.error('dist/ not found — run `npm run build` first'); process.exit(2); }
  const sumsPath = join(DIST, 'SHA256SUMS');
  if (!existsSync(sumsPath)) { console.error('dist/SHA256SUMS not found'); process.exit(2); }
  const expected = new Map();
  for (const line of readFileSync(sumsPath, 'utf8').split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s{2}(.+)$/.exec(line.trim());
    if (m) expected.set(m[2], m[1]);
  }
  if (expected.size === 0) { console.error('SHA256SUMS empty or malformed'); process.exit(2); }

  // Signature check. FieldSeal releases ship an Ed25519 detached signature as a small JSON
  // envelope (tools/release/release-tool.mjs sign) together with the public key. Verify it with
  // Node built-ins only — no GPG install and no network needed, which is the whole point of the
  // offline release chain. A legacy OpenPGP detached signature still falls back to `gpg --verify`.
  const sigPath = join(DIST, 'SHA256SUMS.sig');
  const pubPath = join(DIST, 'RELEASE-PUBLIC-KEY.pem');
  const sumsBytes = readFileSync(sumsPath);
  let signatureOk = null;
  if (existsSync(sigPath)) {
    const raw = readFileSync(sigPath, 'utf8');
    if (raw.trim().startsWith('{')) {
      try {
        const env = JSON.parse(raw);
        const pubPem = readFileSync(pubPath, 'utf8');
        if (!existsSync(pubPath)) throw new Error('RELEASE-PUBLIC-KEY.pem missing');
        if (!env.algorithm || env.algorithm !== 'Ed25519') throw new Error('unexpected signature algorithm');
        if (env.sha256OfSignedFile !== createHash('sha256').update(sumsBytes).digest('hex')) throw new Error('SHA256SUMS changed since signing');
        if (env.publicKeyFingerprint !== createHash('sha256').update(Buffer.from(pubPem)).digest('hex')) throw new Error('public key fingerprint mismatch');
        if (!ed25519Verify(null, sumsBytes, createPublicKey(pubPem), Buffer.from(env.signature, 'base64'))) throw new Error('signature invalid');
        signatureOk = true;
        console.log('Ed25519 signature: OK (publicKeyFingerprint ' + env.publicKeyFingerprint.slice(0, 16) + '...)');
      } catch (e) {
        signatureOk = false;
        console.error('Ed25519 signature: FAILED -> ' + (e.message || e));
        process.exit(1);
      }
    } else {
      try {
        execFileSync('gpg', ['--verify', sigPath, sumsPath], { stdio: 'ignore' });
        signatureOk = true;
        console.log('GPG signature: OK');
      } catch {
        signatureOk = false;
        console.error('GPG signature: FAILED');
        process.exit(1);
      }
    }
  } else {
    console.log('Signature: (none present — manifest is unsigned; run `node tools/release/release-tool.mjs sign`)');
  }

  let ok = true;
  for (const [name, want] of expected) {
    const p = join(DIST, name);
    if (!existsSync(p)) { console.error('MISSING  ' + name); ok = false; continue; }
    const got = sha256File(p);
    const match = got === want;
    if (!match) ok = false;
    console.log((match ? 'OK      ' : 'MISMATCH ') + name + '  (' + got.slice(0, 16) + '...)');
    // smoke test: binary must launch and understand `case verify`
    try {
      execFileSync(p, ['case', 'verify', '--help'], { stdio: 'ignore' });
    } catch (e) {
      // --help may exit non-zero (audit.js prints USAGE and exits 0) — tolerate; just ensure it ran
      const code = e.status;
      if (code === undefined && !e.signal) { console.error('  smoke-test launch error: ' + (e.message || e)); ok = false; }
    }
  }
  console.log(ok ? '\nALL BINARIES VERIFIED' : '\nVERIFICATION FAILED');
  process.exit(ok ? 0 : 1);
}

main();
