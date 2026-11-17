/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Regression: the offline delivery toolchain must actually run (audit F1/F2/F3).
// Spawns the real CLIs in a temporary directory; no network, no browser, no
// third-party dependency, and no writes into the repository itself.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'fieldseal-delivery-'));
let checks = 0;

function run(rel, args = [], shell = false) {
 const cmd = shell ? rel : process.execPath;
 const argv = shell ? args : [path.join(ROOT, rel), ...args];
 return spawnSync(cmd, argv, { cwd: ROOT, encoding: 'utf8', timeout: 180000, env: { ...process.env, NODE_NO_WARNINGS: '1' } });
}
function ok(cond, msg) { assert.ok(cond, msg); checks++; }

try {
 // 1. Backup export -> verify -> restore round trip, checksums intact.
 const backupJson = path.join(tmp, 'backup.json');
 const backupZip = path.join(tmp, 'backup.zip');
 const restored = path.join(tmp, 'restored.json');
 const payload = {
 format: 'fieldseal-backup-v1',
 createdAt: new Date().toISOString(),
 toolVersion: 'v0.5',
 dbName: 'fieldseal-cases',
 dbVersion: 4,
 counts: { cases: 1, 'evidence-packages': 0, 'case-ciphers': 0, 'signature-images': 0 },
 stores: {
 cases: [{ packageId: 'test-case', state: 'draft' }],
 'evidence-packages': [], 'case-ciphers': [], 'signature-images': []
 },
 localStorage: {}, auditTrail: []
 };
 writeFileSync(backupJson, JSON.stringify(payload, null, 2));
 let r = run('cli/bin/backup.mjs', ['export', '--input', backupJson, '--out', backupZip]);
 ok(r.status === 0 && /BACKUP-EXPORT-OK/.test(r.stdout), 'backup export runs: ' + (r.stderr || r.stdout).slice(0, 200));
 r = run('cli/bin/backup.mjs', ['verify', '--input', backupZip, '--json']);
 ok(r.status === 0 && JSON.parse(r.stdout).ok === true, 'backup verify passes');
 r = run('cli/bin/backup.mjs', ['restore', '--input', backupZip, '--out', restored]);
 ok(r.status === 0 && readFileSync(restored, 'utf8') === readFileSync(backupJson, 'utf8'), 'restore reproduces the exact original bytes');
 const corrupt = readFileSync(backupZip);
 corrupt[Math.floor(corrupt.length / 3)] ^= 0xff;
 const corruptPath = path.join(tmp, 'corrupt.zip');
 writeFileSync(corruptPath, corrupt);
 r = run('cli/bin/backup.mjs', ['verify', '--input', corruptPath]);
 ok(r.status !== 0, 'tampered archive is rejected (fail closed)');

 // 2. Doctor: full offline health report, no failures.
 r = run('cli/bin/doctor.mjs', ['--json']);
 let report = null;
 try { report = JSON.parse(r.stdout); } catch { /* handled below */ }
 ok(r.status === 0 && report && report.summary && report.summary.ok === true, 'doctor reports all checks green: ' +
 (report && report.checks ? report.checks.filter((c) => c.status === 'fail').map((c) => c.id).join(', ') : (r.stderr || '').slice(0, 200)));
 const bundle = path.join(tmp, 'diagnostic.zip');
 r = run('cli/bin/doctor.mjs', ['--bundle', bundle]);
 ok(r.status === 0 && existsSync(bundle), 'doctor writes a diagnostic bundle');

 // 3. Installer preflight (no files written). The installer must verify the signed
 // release before touching disk, so in a source checkout with no built dist/ its
 // correct behaviour is to REFUSE — fail closed — not to install anyway.
 r = run('./install.sh', ['--verify-only'], true);
 if (existsSync(path.join(ROOT, 'tools/build/dist'))) {
 ok(r.status === 0 && /INSTALL-VERIFY-OK/.test(r.stdout), 'installer preflight verifies the signed release');
 } else {
 ok(r.status !== 0, 'installer refuses an unsigned source checkout (fail closed)');
 }

 // 4. Local server: serves pages/legal docs offline, refuses traversal.
 const port = 18000 + (process.pid % 1000);
 const child = spawn(process.execPath, [path.join(ROOT, 'cli/bin/serve.mjs'), '--root', ROOT, '--host', '127.0.0.1', '--port', String(port)], { stdio: 'ignore' });
 try {
 let ready = false;
 for (let i = 0; i < 40 && !ready; i++) {
 await new Promise((resolve) => setTimeout(resolve, 100));
 try { const res = await fetch('http://127.0.0.1:' + port + '/pwa/privacy.html'); ready = res.ok; } catch { /* not up yet */ }
 }
 ok(ready, 'local server starts on loopback');
 if (ready) {
 const page = await fetch('http://127.0.0.1:' + port + '/pwa/backup.html');
 ok(page.status === 200, 'backup page is served offline');
 const legal = await fetch('http://127.0.0.1:' + port + '/pwa/legal/DPA-TEMPLATE.md');
 ok(legal.status === 200, 'legal documents are served offline');
 // Percent-encoded so the client does not normalise the path before sending.
 const traversal = await fetch('http://127.0.0.1:' + port + '/..%2fSECURITY.md');
 ok(traversal.status === 403 || traversal.status === 404, 'path traversal is refused (got ' + traversal.status + ')');
 }
 } finally {
 child.kill('SIGTERM');
 }
} finally {
 rmSync(tmp, { recursive: true, force: true });
}

process.stdout.write('FIELDSEAL-TEST-OK delivery-tools (' + checks + ' checks)\n');
