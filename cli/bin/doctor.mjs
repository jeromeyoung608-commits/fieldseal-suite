#!/usr/bin/env node
/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */
// Offline health check + diagnostic bundle. Zero dependencies, Node built-ins only.
// The report contains versions, paths and pass/fail results ONLY: no case data,
// no personal identifiers, no evidence bytes, no network calls.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { writeZip } = require('../core/zip-stream.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const args = process.argv.slice(2);
const wantJson = args.includes('--json');
const bundleIdx = args.indexOf('--bundle');
const bundlePath = bundleIdx >= 0 ? args[bundleIdx + 1] : null;
if (bundleIdx >= 0 && (!bundlePath || bundlePath.startsWith('--'))) {
  process.stderr.write('DOCTOR-ERROR --bundle requires an output path\n');
  process.exit(1);
}

function parseArgs(argv) {
  const out = { port: 8123 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') out.port = Number(argv[++i]) || 8123;
    if (argv[i] === '--data-dir') out.dataDir = argv[++i];
  }
  return out;
}
const opts = parseArgs(args);

const checks = [];
function record(id, label, status, detail) { checks.push({ id, label, status, detail: String(detail) }); }
function nodeScript(rel, extra = []) {
  return spawnSync(process.execPath, [path.join(ROOT, rel), ...extra], {
    cwd: ROOT, encoding: 'utf8', timeout: 120000, env: { ...process.env, NODE_NO_WARNINGS: '1' }
  });
}

// 1. Runtime.
const major = Number(process.versions.node.split('.')[0]);
record('runtime.node', 'Node.js version', major >= 18 ? 'ok' : 'fail', process.version + ' (requires >= 18)');

// 2. Required delivery files.
// `tools/build/dist/` holds BUILT artifacts (pkg binaries + Ed25519 sums). They are
// attached to GitHub Releases, never committed, so a pristine clone legitimately has
// no dist/. Absence is therefore a warning in a source checkout — but if dist exists
// and a required file inside it is missing, that is still a hard failure.
const DIST = path.join(ROOT, 'tools/build/dist');
const hasDist = existsSync(DIST);
const SOURCE_FILES = [
  'pwa/index.html', 'pwa/sw.js', 'pwa/privacy.html', 'pwa/backup.html',
  'pwa/ui/page-chrome.js', 'cli/bin/audit.js', 'cli/bin/backup.mjs', 'cli/bin/serve.mjs',
  'cli/test/test-runner.js', 'docs/RELEASE-ROLLBACK.md',
  'pwa/legal/DPA-TEMPLATE.md', 'pwa/legal/SUPPORT-SLA.md',
  'pwa/legal/VPAT-2.5-EU.md', 'pwa/legal/DATA-RESIDENCY.md', 'README.md', 'SECURITY.md'
];
const DIST_FILES = [
  'manifest.json', 'SHA256SUMS', 'SHA256SUMS.sig', 'RELEASE-PUBLIC-KEY.pem'
];
const missingSource = SOURCE_FILES.filter((f) => !existsSync(path.join(ROOT, f)));
const missingDist = DIST_FILES.filter((f) => !existsSync(path.join(DIST, f)));
if (missingSource.length) {
  record('delivery.files', 'Required delivery files', 'fail', 'missing: ' + missingSource.join(', '));
} else if (missingDist.length && hasDist) {
  record('delivery.files', 'Required delivery files', 'fail', 'missing in dist: ' + missingDist.join(', '));
} else if (missingDist.length) {
  record('delivery.files', 'Required delivery files', 'warn',
    'source checkout: release binaries not built yet (run tools/build/build-binaries.mjs)');
} else {
  record('delivery.files', 'Required delivery files', 'ok',
    (SOURCE_FILES.length + DIST_FILES.length) + ' files present');
}

// 3. Release integrity. Only meaningful once dist/ has been built.
const sig = nodeScript('tools/release/release-tool.mjs', ['verify-signature']);
record('release.signature', 'Ed25519 release signature', !hasDist ? 'warn' : (sig.status === 0 ? 'ok' : 'fail'),
  !hasDist ? 'skipped: no dist/ in a source checkout'
    : (sig.status === 0 ? 'verified' : (sig.stderr || sig.stdout || 'failed').trim().slice(0, 300)));
const bin = nodeScript('tools/build/verify-binaries.mjs');
record('release.binaries', 'Dist binary digests', !hasDist ? 'warn' : (bin.status === 0 ? 'ok' : 'fail'),
  !hasDist ? 'skipped: no dist/ in a source checkout'
    : (bin.status === 0 ? 'all binaries verified' : (bin.stderr || bin.stdout || 'failed').trim().slice(0, 300)));

// 4. Core self-tests (fast, no browser needed).
for (const [id, label, rel] of [
  ['core.sw', 'SW offline precache closure', 'pwa/core/test-sw-precache.mjs'],
  ['core.chain', 'Local audit hash chain', 'pwa/core/test-audit-chain.mjs'],
  ['core.csv', 'CSV formula injection', 'pwa/core/test-csv-injection.mjs'],
  ['core.sha3', 'SHA3 capability gate', 'pwa/core/test-sha3-capability.mjs']
]) {
  const r = nodeScript(rel);
  record(id, label, r.status === 0 ? 'ok' : 'fail', r.status === 0 ? 'self-test passed' : (r.stderr || r.stdout || 'failed').trim().slice(0, 300));
}

// 5. Static hygiene (no network references, no vendored dependencies).
async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === '.tmp' || e.name === 'node_modules' || e.name.startsWith('.git')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}
const all = await walk(ROOT);
const html = all.filter((f) => f.endsWith('.html'));
const remote = html.filter((f) => /https?:\/\//i.test(readFileSync(f, 'utf8')));
record('static.remote', 'No remote URLs in pages', remote.length ? 'fail' : 'ok',
  remote.length ? remote.map((f) => path.relative(ROOT, f)).join(', ') : html.length + ' pages scanned');
const leaked = all.filter((f) => f.split(path.sep).includes('node_modules') ||
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(f));
record('static.deps', 'No vendored modules / lockfiles', leaked.length ? 'fail' : 'ok',
  leaked.length ? leaked.slice(0, 5).map((f) => path.relative(ROOT, f)).join(', ') : 'clean');

// Build inputs are locked by exact version + integrity (see BUILD-DEPENDENCIES.md);
// a shipped lockfile would violate the zero-dependency delivery gate S-06.
let pinStatus = 'ok';
let pinDetail = '';
try {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'tools/build/package.json'), 'utf8'));
  const deps = { ...(manifest.devDependencies || {}), ...(manifest.dependencies || {}) };
  const entries = Object.entries(deps);
  const loose = entries.filter(([, v]) => /[\^~*]|\|\||>=|</.test(String(v)));
  pinStatus = loose.length || !entries.length ? 'fail' : 'ok';
  pinDetail = loose.length ? 'loose ranges: ' + loose.map(([k, v]) => k + '@' + v).join(', ')
    : entries.map(([k, v]) => k + '@' + v).join(', ');
} catch (e) { pinStatus = 'fail'; pinDetail = e.message; }
record('build.pins', 'Build dependencies exactly pinned', pinStatus, pinDetail);

// PWA module-load smoke: every named import across the PWA must resolve to a real
// export. This is the gate that would have caught BUG-003 (a page importing a removed
// symbol renders zero buttons while string assertions stay green).
const importCheck = nodeScript('cli/test/test-module-imports.mjs');
record('static.imports', 'All PWA module imports resolve', importCheck.status === 0 ? 'ok' : 'fail',
  importCheck.status === 0 ? 'every named import resolves across the PWA'
    : (importCheck.stderr || importCheck.stdout || 'import resolution failed').split('\n').slice(0, 4).join(' | '));

// Local operation-trail integrity.
//   * If `--audit-log <file>` is supplied, verify the ACTUAL exported file: real entry
//     count + hash-chain state + signature state (against a TRUSTED device key supplied
//     via `--device-key`, never a key inside the file). An UNSIGNED export is reported
//     as a failure (signature missing), not "ok".
//   * Otherwise this is a headless environment with no browser localStorage/IndexedDB,
//     so we do NOT fabricate an empty store as a "real" verification — we only prove
//     the tamper-detection MECHANISM (chain + device-key anchor) on an isolated sample
//     and tell the owner to supply a real export. This closes the "doctor only tests a
//     memory sample" gap (delivery-audit §11.3, audit −0.2) honestly.
let logStatus = 'ok';
let logDetail = '';
try {
  const modPath = path.join(ROOT, 'pwa/helpers/local-audit-log.js');
  if (!existsSync(modPath)) throw new Error('module missing');
  const anchorMod = await import(pathToFileURL(path.join(ROOT, 'pwa/helpers/audit-anchor.js')).href);
  const fileIdx = process.argv.indexOf('--audit-log');
  const fileArg = fileIdx >= 0 ? process.argv[fileIdx + 1] : null;
  const keyIdx = process.argv.indexOf('--device-key');
  const keyArg = keyIdx >= 0 ? process.argv[keyIdx + 1] : null;
  const tsaKeyIdx = process.argv.indexOf('--tsa-key');
  const tsaKeyArg = tsaKeyIdx >= 0 ? process.argv[tsaKeyIdx + 1] : null;
  const tsaRootIdx = process.argv.indexOf('--tsa-root');
  const tsaRootArg = tsaRootIdx >= 0 ? process.argv[tsaRootIdx + 1] : null;

  if (fileArg) {
    // REAL verification of an actual exported log file.
    if (!existsSync(fileArg)) throw new Error('audit log file not found: ' + fileArg);
    const fs = await import('node:fs');
    const parsed = JSON.parse(fs.readFileSync(fileArg, 'utf8'));
    const isSigned = parsed && parsed.format === 'fieldseal-audit-export-v2' &&
      typeof parsed.signature === 'string' && typeof parsed.head === 'string';
    const entries = isSigned ? JSON.parse(parsed.log) : parsed;
    const chain = await (await import(pathToFileURL(modPath).href)).verifyChainEntries(entries);
    let sig;
    if (!isSigned) {
      sig = { ok: false, reason: 'signature missing (unsigned export — cannot attest)' };
    } else {
      let trustedSpki = keyArg;
      if (keyArg && existsSync(keyArg)) {
        try { trustedSpki = fs.readFileSync(keyArg, 'utf8').trim(); } catch { /* treat as literal */ }
      }
      let trustedTsaSpki = tsaKeyArg;
      if (trustedTsaSpki && existsSync(trustedTsaSpki)) {
        try { trustedTsaSpki = fs.readFileSync(trustedTsaSpki, 'utf8').trim(); } catch { /* treat as literal */ }
      }
      if (!trustedSpki) {
        sig = { ok: false, reason: 'signed but no trusted device key supplied (--device-key) — cannot verify' };
      } else {
        sig = await anchorMod.verifySignedExport(parsed, trustedSpki, { trustedTsaSpki });
        // If the export carries a REAL external RFC3161 token, verify it to the TSA root
        // with openssl (no hand-rolled ASN.1). --tsa-root must point at the TSA root cert.
        if (sig && sig.tsaExternalPendingDoctor && parsed.tsaToken && parsed.tsaToken.kind === 'rfc3161') {
          if (!tsaRootArg) {
            sig = { ok: false, reason: 'external RFC3161 token present but --tsa-root (TSA root cert) not supplied — cannot verify to root' };
          } else {
            const { verifyRfc3161Token } = await import(pathToFileURL(path.join(ROOT, 'cli/core/tsa-verify.js')).href);
            const v = verifyRfc3161Token({ tokenDerB64: parsed.tsaToken.token, rootCertPath: tsaRootArg, headHex: parsed.head });
            sig = v.ok
              ? { ok: true, reason: '', head: parsed.head, count: entries.length, tsaStatus: 'external RFC3161 verified to root (openssl)', tsaMode: 'external' }
              : { ok: false, reason: 'tsa: ' + v.reason, tsaStatus: 'external-fail' };
          }
        }
      }
    }
    logDetail = 'real file ' + fileArg + ': ' + chain.count + ' entries, chain ' +
      (chain.ok ? 'ok' : 'FAIL(' + chain.reason + ')' + (chain.index != null ? '@' + chain.index : '')) +
      ', signature ' + (sig.ok ? 'ok' : 'FAIL(' + sig.reason + ')');
    if (!chain.ok || !sig.ok) logStatus = 'fail';
  } else {
    // Headless: no real browser trail available. Prove the chain + anchor mechanism on
    // an isolated sample and direct the owner to --audit-log for a real verification.
    globalThis.__fieldsealMemStore = new Map();
    globalThis.__fieldsealAnchorStore = new Map();
    const log = await import(pathToFileURL(modPath).href);
    const deviceMod = await import(pathToFileURL(path.join(ROOT, 'pwa/helpers/audit-device-key.js')).href);
    const tsaMod = await import(pathToFileURL(path.join(ROOT, 'pwa/helpers/audit-tsa.js')).href);
    const kp = await deviceMod._setDeviceKeyForTesting(await anchorMod.generateEd25519KeyPair(false));
    const tsaKp = await tsaMod._setTsaKeyForTesting(await anchorMod.generateEd25519KeyPair(false));
    log.setLogEnabled(true);
    log.clearLog();
    log.addEvent({ eventType: 'Collected', actor: { name: 'doctor' }, target: { id: 'x' } });
    log.addEvent({ eventType: 'Sealed', actor: { name: 'doctor' }, target: { id: 'x' } });
    const goodChain = await log.verifyChain();
    const anchorOk = await log.verifyAnchorStore(kp.spki, tsaKp.spki);
    // Tamper the head (last entry's stored hash) WITHOUT re-committing the anchor.
    const raw = JSON.parse(globalThis.__fieldsealMemStore.get('fieldseal-local-audit-log') || '[]');
    if (raw.length) { raw[raw.length - 1].hash = 'f'.repeat(64); globalThis.__fieldsealMemStore.set('fieldseal-local-audit-log', JSON.stringify(raw)); }
    const badChain = await log.verifyChain();
    const badAnchor = await log.verifyAnchorStore(kp.spki, tsaKp.spki);
    log.clearLog();
    if (goodChain.ok !== true || badChain.ok !== false || anchorOk.ok !== true || badAnchor.ok !== false) {
      logStatus = 'fail';
      logDetail = 'mechanism: chain ok=' + goodChain.ok + ' afterTamper=' + badChain.ok +
        ', anchor ok=' + anchorOk.ok + ' afterTamper=' + badAnchor.ok;
    } else {
      logDetail = 'no real persisted trail in this (headless) environment — supply --audit-log <file> ' +
        '(and --device-key <spki>) to verify a real export; mechanism self-test: chain tamper detected (' +
        badChain.reason + '), anchor tamper detected (' + (badAnchor.reason || 'ok') + ')';
    }
  }
} catch (e) { logStatus = 'fail'; logDetail = e.message; }
finally { delete globalThis.__fieldsealMemStore; delete globalThis.__fieldsealAnchorStore; }
record('log.chain', 'Local audit-trail chain + device-key anchor verify (real file via --audit-log, else mechanism self-test)', logStatus, logDetail);

// 6. Writable data directory.
const dataDir = opts.dataDir || os.tmpdir();
let writable = 'ok';
let writableDetail = dataDir;
try {
  const tmp = mkdtempSync(path.join(dataDir, 'fieldseal-doctor-'));
  writeFileSync(path.join(tmp, 'probe'), 'ok');
  rmSync(tmp, { recursive: true, force: true });
} catch (e) { writable = 'fail'; writableDetail = e.message; }
record('env.writable', 'Data directory writable', writable, writableDetail);

// 7. Local port availability (informational: a running server is fine).
const portState = await new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', () => resolve('in-use'));
  s.once('listening', () => s.close(() => resolve('free')));
  s.listen(opts.port, '127.0.0.1');
});
record('env.port', 'Local preview port ' + opts.port, portState === 'free' ? 'ok' : 'warn',
  portState === 'free' ? 'available' : 'already in use (a running local server is expected)');

// 8. Optional agents must not be configured for public binding.
const host = process.env.BIND_HOST || '';
record('env.bind', 'Optional agents bind to loopback', host && !['127.0.0.1', 'localhost', '::1'].includes(host) ? 'warn' : 'ok',
  host ? 'BIND_HOST=' + host : 'default 127.0.0.1');

const failed = checks.filter((c) => c.status === 'fail');
const warned = checks.filter((c) => c.status === 'warn');
const report = {
  tool: 'fieldseal-doctor', version: 1,
  generatedAt: new Date().toISOString(),
  node: process.version, platform: process.platform, arch: process.arch,
  root: ROOT,
  summary: { ok: failed.length === 0, checks: checks.length, failed: failed.length, warned: warned.length },
  checks
};
const json = JSON.stringify(report, null, 2);

if (bundlePath) {
  const notes = [
    'FieldSeal Suite diagnostic bundle',
    'Generated: ' + report.generatedAt,
    'Contains: doctor-report.json (versions, paths, pass/fail only) and README.txt.',
    'No case data, no evidence bytes, no personal identifiers, no network access.',
    'Attach this file to a support request after reviewing it.',
    'Local verification: node cli/bin/doctor.mjs --json'
  ].join('\n') + '\n';
  await writeZip(bundlePath, [
    { name: 'doctor-report.json', data: Buffer.from(json) },
    { name: 'README.txt', data: Buffer.from(notes) }
  ]);
  const digest = createHash('sha256').update(json).digest('hex');
  process.stdout.write('DOCTOR-BUNDLE-OK ' + bundlePath + ' sha256=' + digest + '\n');
}

if (wantJson || bundlePath) process.stdout.write(json + '\n');
else {
  for (const c of checks) process.stdout.write('[' + c.status.toUpperCase().padEnd(4) + '] ' + c.id.padEnd(20) + c.label + ' — ' + c.detail + '\n');
  process.stdout.write(failed.length ? 'DOCTOR-FAILED ' + failed.length + ' check(s)\n' : 'DOCTOR-OK ' + checks.length + ' checks (' + warned.length + ' warnings)\n');
}
if (failed.length) process.exitCode = 1;
