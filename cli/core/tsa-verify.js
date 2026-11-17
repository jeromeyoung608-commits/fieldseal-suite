/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */
// 9.0 A3 — verify a REAL third-party RFC3161 TimeStampToken (DER) to its TSA root CERT.
// Uses the system `openssl ts -verify` — we deliberately do NOT hand-roll ASN.1/DER
// parsing (S-07 red line). The `execFileSync` is injectable so the verification LOGIC is
// unit-testable without a live TSA or a real openssl binary (see cli/bin/audit-acceptance.mjs).
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export function verifyRfc3161Token({ tokenDerB64, rootCertPath, headHex, execFileSync: exec = execFileSync }) {
  const dir = mkdtempSync(join(tmpdir(), 'fieldseal-tsa-'));
  try {
    const headPath = join(dir, 'head.bin');
    writeFileSync(headPath, Buffer.from(headHex, 'hex')); // openssl hashes this with the token's alg
    const tsrPath = join(dir, 'token.tsr');
    writeFileSync(tsrPath, Buffer.from(tokenDerB64, 'base64'));
    const base = ['ts', '-verify', '-data', headPath, '-CAfile', rootCertPath];
    // A service may return either a full TimeStampResponse (DER) or the bare TimeStampToken
    // (CMS). Try both so a token-only response still verifies instead of always failing.
    const attempts = [['-in', tsrPath], ['-token_in', '-in', tsrPath]];
    for (const extra of attempts) {
      try {
        const out = exec('openssl', [...base, ...extra], { encoding: 'utf8' });
        if (/Verification: OK/.test(out)) return { ok: true, reason: '' };
      } catch (e) {
        const msg = (e.stdout || '') + (e.stderr || '') || e.message || '';
        if (/Verification: OK/.test(msg)) return { ok: true, reason: '' };
      }
    }
    // Both failed — surface the full-response reason for diagnostics.
    let reason = '';
    try {
      exec('openssl', [...base, '-in', tsrPath], { encoding: 'utf8' });
    } catch (e) {
      reason = (e.stdout || '') + (e.stderr || '') || e.message || '';
    }
    return { ok: false, reason: 'openssl ts -verify failed: ' + (reason.slice(0, 200) || 'no output') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
