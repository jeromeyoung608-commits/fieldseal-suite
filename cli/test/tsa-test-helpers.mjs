/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */
// Test-only RFC3161 fixtures driven by the REAL system `openssl` (never hand-rolled ASN.1).
// Generates a CA + TSA cert (TSA signed by CA) and runs a tiny local TSA HTTP server that
// produces genuine RFC3161 tokens via `openssl ts -reply`, so externalTimestamp + doctor can
// be exercised end-to-end against a real openssl-verifiable token.
import { spawnSync, execFileSync } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function hasOpenSsl() {
  try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

// Generate CA + TSA certs in a temp dir. Returns paths + the CA's SPKI base64 (DER).
export function generateTsaFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'fieldseal-tsa-fix-'));
  const caKey = join(dir, 'ca.key');
  const caCrt = join(dir, 'ca.crt');
  const tsaKey = join(dir, 'tsa.key');
  const tsaCrt = join(dir, 'tsa.crt');
  const ext = join(dir, 'tsa.ext');
  const tsaCnf = join(dir, 'tsa.cnf');
  const run = (args) => execFileSync('openssl', args, { stdio: 'ignore' });
  run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', caKey, '-out', caCrt, '-days', '3650', '-subj', '/CN=FieldSeal Test TSA Root/O=FieldSeal Test']);
  run(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', tsaKey, '-out', join(dir, 'tsa.csr'), '-subj', '/CN=FieldSeal Test TSA/O=FieldSeal Test']);
  writeFileSync(ext, 'basicConstraints=CA:FALSE\nextendedKeyUsage=critical,timeStamping\n');
  run(['x509', '-req', '-in', join(dir, 'tsa.csr'), '-CA', caCrt, '-CAkey', caKey, '-CAcreateserial', '-out', tsaCrt, '-days', '3650', '-extfile', ext]);
  // Portable TSA config for `openssl ts -reply`. REQUIRED on strict OpenSSL/LibreSSL (e.g. macOS
  // LibreSSL 3.3.6) — without `-config` those builds print usage and exit 1. Always pass it so the
  // fixture works on the recipient's box, not only on a lenient local openssl.
  writeFileSync(tsaCnf,
    '[tsa]\n' +
    'default_tsa = tsa_config1\n\n' +
    '[tsa_config1]\n' +
    'dir = ' + dir + '\n' +
    'serial = ' + join(dir, 'tsa.srl') + '\n' +
    'crypto_device = builtin\n' +
    'signer_cert = ' + tsaCrt + '\n' +
    'certs = ' + caCrt + '\n' +
    'signer_key = ' + tsaKey + '\n' +
    'signer_digest = sha256\n' +
    'ess_cert_id_alg = sha256\n' +
    'digests = sha256\n' +
    'default_policy = 1.2.3.4.1\n' +
    'policies = 1.2.3.4.1\n' +
    'other_policies = 1.2.3.4.1\n' +
    'accuracy = secs:1\n' +
    'ordering = no\n');
  writeFileSync(join(dir, 'tsa.srl'), '01');
  const spkiDer = execFileSync('openssl', ['x509', '-in', caCrt, '-noout', '-pubkey'], { encoding: 'utf8' });
  const caSpkiB64 = execFileSync('openssl', ['pkey', '-pubin', '-outform', 'DER'], { input: spkiDer }).toString('base64');
  return { dir, caKey, caCrt, tsaKey, tsaCrt, tsaCnf, caSpkiB64 };
}

// Sign a hash (hex) into a real RFC3161 TimeStampResponse (full DER) using openssl.
export function makeFullResponse(fixture, headHex) {
  const dir = mkdtempSync(join(tmpdir(), 'fieldseal-tsa-req-'));
  const headPath = join(dir, 'head.bin');
  const qPath = join(dir, 'q.tsq');
  const rPath = join(dir, 'r.tsr');
  writeFileSync(headPath, Buffer.from(headHex, 'hex'));
  execFileSync('openssl', ['ts', '-query', '-data', headPath, '-sha256', '-cert', '-out', qPath], { stdio: 'ignore' });
  execFileSync('openssl', ['ts', '-reply', '-config', fixture.tsaCnf, '-queryfile', qPath, '-signer', fixture.tsaCrt, '-inkey', fixture.tsaKey, '-chain', fixture.caCrt, '-out', rPath], { stdio: 'ignore' });
  const der = readFileSync(rPath);
  rmSync(dir, { recursive: true, force: true });
  return der;
}

// Extract the bare TimeStampToken (CMS) from a full response for the -token_in fallback path.
export function extractTokenOnly(fullDer) {
  const dir = mkdtempSync(join(tmpdir(), 'fieldseal-tsa-tok-'));
  const rPath = join(dir, 'r.tsr');
  const tokPath = join(dir, 'tok.der');
  writeFileSync(rPath, fullDer);
  const out = execFileSync('openssl', ['asn1parse', '-in', rPath, '-inform', 'DER'], { encoding: 'utf8' });
  // The TimeStampToken is a PKCS#7 ContentInfo wrapping OID pkcs7-signedData. Locate that OID,
  // then take the enclosing SEQUENCE at depth d=1 (the ContentInfo) immediately above it.
  let p7off = null;
  for (const line of out.split('\n')) {
    if (/pkcs7-signedData/.test(line)) { const m = line.match(/^\s*(\d+):/); if (m) { p7off = Number(m[1]); break; } }
  }
  let off = null;
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*(\d+):d=1 .* cons: SEQUENCE/);
    if (m) { const o = Number(m[1]); if (p7off != null && o < p7off) off = o; }
  }
  if (off == null) throw new Error('could not locate token ContentInfo offset in TimeStampResponse');
  execFileSync('openssl', ['asn1parse', '-in', rPath, '-inform', 'DER', '-strparse', off, '-out', tokPath], { stdio: 'ignore' });
  const der = readFileSync(tokPath);
  rmSync(dir, { recursive: true, force: true });
  return der;
}

// Start a local TSA HTTP server that signs posted hashes with openssl. Returns { url, close }.
export function startTsaServer(fixture) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const { hashedMessage } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const der = makeFullResponse(fixture, hashedMessage);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ token: der.toString('base64'), alg: 'RFC3161' }));
      } catch (e) {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end(String(e && e.message || e));
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: 'http://127.0.0.1:' + port + '/rfc3161', close: () => server.close() });
    });
  });
}
