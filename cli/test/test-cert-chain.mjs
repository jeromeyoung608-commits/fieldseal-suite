#!/usr/bin/env node
/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// A1.2: real X.509 chain checks with openssl. Valid leaf passes against its root; wrong root,
// expired validity, wrong purpose and a tampered certificate all fail. No fake "ok".
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let fail = 0;
const ok = (n) => console.log('  ok  - ' + n);
const bad = (n, d) => { console.log('  FAIL - ' + n + (d ? ' :: ' + d : '')); fail++; };
const dir = mkdtempSync(join(tmpdir(), 'fieldseal-cert-'));
const sh = (cmd, args) => spawnSync(cmd, args, { cwd: dir, encoding: 'utf8' });
const openssl = sh('openssl', ['version']);
if (openssl.status !== 0) { console.log('CERT-CHAIN: SKIP — openssl unavailable'); process.exit(0); }

const ca = (name) => {
  sh('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', name + '.key', '-out', name + '.pem', '-days', '3650', '-subj', '/CN=' + name]);
};
const leaf = (name, caName, days) => {
  sh('openssl', ['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', name + '.key', '-out', name + '.csr', '-subj', '/CN=' + name]);
  writeFileSync(join(dir, name + '.ext'), 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:' + name + '\n');
  sh('openssl', ['x509', '-req', '-in', name + '.csr', '-CA', caName + '.pem', '-CAkey', caName + '.key', '-CAcreateserial', '-out', name + '.pem', '-days', String(days), '-extfile', name + '.ext']);
};
ca('rootA'); ca('rootB'); leaf('leafA', 'rootA', 30);
const verify = (args) => sh('openssl', ['verify', '-CAfile', args.ca, ...(args.extra || []), args.leaf]);
const out = (r) => (r.stdout || r.stderr || '').trim().split('\n')[0];

verify({ ca: 'rootA.pem', leaf: 'leafA.pem' }).status === 0 ? ok('valid leaf verifies against its root') : bad('valid leaf failed', out(verify({ ca: 'rootA.pem', leaf: 'leafA.pem' })));

const wrong = verify({ ca: 'rootB.pem', leaf: 'leafA.pem' });
wrong.status !== 0 ? ok('wrong root is rejected') : bad('wrong root accepted');

const future = String(Date.now() / 1000 + 40 * 86400).split('.')[0];
const expired = verify({ ca: 'rootA.pem', leaf: 'leafA.pem', extra: ['-attime', future] });
expired.status !== 0 ? ok('expired validity is rejected') : bad('expired leaf accepted');

const purpose = verify({ ca: 'rootA.pem', leaf: 'leafA.pem', extra: ['-purpose', 'smimesign'] });
purpose.status !== 0 ? ok('wrong key purpose is rejected') : bad('wrong purpose accepted');

const lines = readFileSync(join(dir, 'leafA.pem'), 'utf8').split('\n');
const i = Math.min(4, lines.length - 2);
lines[i] = (lines[i][0] === 'A' ? 'B' : 'A') + lines[i].slice(1);
writeFileSync(join(dir, 'leaf-tampered.pem'), lines.join('\n'));
const t = verify({ ca: 'rootA.pem', leaf: 'leaf-tampered.pem' });
t.status !== 0 ? ok('tampered certificate is rejected') : bad('tampered leaf accepted');

rmSync(dir, { recursive: true, force: true });
console.log(fail ? 'CERT-CHAIN: FAIL (' + fail + ')' : 'CERT-CHAIN: PASS — root / wrong-root / expired / purpose / tamper');
process.exit(fail ? 1 : 0);
