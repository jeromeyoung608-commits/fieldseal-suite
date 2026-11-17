/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 *
 * Offline release integrity + rollback tool. Zero third-party dependencies: Node built-ins only.
 *
 * Two independent guarantees:
 *   1. SIGNED MANIFEST — an Ed25519 detached signature over dist/SHA256SUMS, distributed together
 *      with the public key. A recipient can verify every released binary offline, with no GPG
 *      installation and no network. The private key NEVER lives in the repository.
 *   2. BACKUP / RESTORE / ROLLBACK — a content-addressed snapshot of the whole release set before
 *      any deployment. Every restore is preceded by an automatic "pre-rollback" snapshot, so a bad
 *      rollback is itself reversible. Restore/rollback are dry-run by default (require --apply).
 *
 * Commands (run with `node tools/release/release-tool.mjs <command> [options]`):
 *   keygen                    generate an Ed25519 keypair OUTSIDE the repo (release engineer, air-gapped)
 *   sign                      sign dist/SHA256SUMS -> SHA256SUMS.sig + RELEASE-PUBLIC-KEY.pem
 *   verify-signature          verify the signed manifest offline
 *   snapshot                  back up the release set to a content-verified snapshot
 *   list                      list available snapshots
 *   verify <id>               verify a snapshot's hashes + manifest self-hash + signature
 *   restore <id>              restore a snapshot (dry-run unless --apply)
 *   rollback                  roll back to the newest verified snapshot (dry-run unless --apply)
 *   status                    show current dist signature state + rollback targets
 *
 * Options: --dist DIR (default <repo>/tools/build/dist), --store DIR (default
 *   $FIELDSEAL_RELEASE_STORE or ~/.fieldseal/releases), --key FILE, --label TEXT,
 *   --apply, --metadata-only. Environment: FIELDSEAL_RELEASE_KEY_FILE, FIELDSEAL_RELEASE_STORE.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

export const RELEASE_SPEC = 'fieldseal-release-v0.1';
export const SUMS_FILE = 'SHA256SUMS';
export const SIG_FILE = 'SHA256SUMS.sig';
export const PUBKEY_FILE = 'RELEASE-PUBLIC-KEY.pem';
export const BACKUP_MANIFEST = 'BACKUP-MANIFEST.json';
export const DIST_MANIFEST = 'manifest.json';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');
export const DEFAULT_DIST = path.join(REPO_ROOT, 'tools', 'build', 'dist');
export const DEFAULT_STORE = process.env.FIELDSEAL_RELEASE_STORE || path.join(os.homedir(), '.fieldseal', 'releases');

export function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
export function sha256File(p) { return sha256(fs.readFileSync(p)); }
function canonical(v) { return JSON.stringify(v); }

// --- private key must never be written inside the repository -----------------
export function assertKeyOutsideRepo(target) {
  const abs = path.resolve(target);
  const rel = path.relative(REPO_ROOT, abs);
  if (rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel))) {
    throw new Error('refusing to write a private key inside the repository: ' + abs);
  }
  return abs;
}

export function generateKeypair(keyDir) {
  const dir = assertKeyOutsideRepo(keyDir || path.join(os.homedir(), '.fieldseal'));
  fs.mkdirSync(dir, { recursive: true });
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const privatePath = path.join(dir, 'release-private-key.pem');
  const publicPath = path.join(dir, 'release-public-key.pem');
  fs.writeFileSync(privatePath, privatePem, { mode: 0o600 });
  fs.writeFileSync(publicPath, publicPem, { mode: 0o644 });
  try { fs.chmodSync(privatePath, 0o600); } catch { /* best effort on Windows */ }
  return { privatePath, publicPath, publicPem, fingerprint: sha256(Buffer.from(publicPem)) };
}

export function readPrivateKey(explicit) {
  const pemFile = explicit || process.env.FIELDSEAL_RELEASE_KEY_FILE;
  if (pemFile) return fs.readFileSync(pemFile, 'utf8');
  if (process.env.FIELDSEAL_RELEASE_KEY) return process.env.FIELDSEAL_RELEASE_KEY;
  const candidate = path.join(os.homedir(), '.fieldseal', 'release-private-key.pem');
  if (fs.existsSync(candidate)) return fs.readFileSync(candidate, 'utf8');
  throw new Error('no release private key: run `keygen` on an air-gapped machine, or pass --key / FIELDSEAL_RELEASE_KEY_FILE');
}

// --- signed manifest ---------------------------------------------------------
export function signSums(distDir, privatePem) {
  const sumsPath = path.join(distDir, SUMS_FILE);
  if (!fs.existsSync(sumsPath)) throw new Error('missing ' + sumsPath + ' — run `npm run build` in tools/build first');
  const sums = fs.readFileSync(sumsPath);
  const privateKey = crypto.createPrivateKey(privatePem);
  const publicPem = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
  const signature = crypto.sign(null, sums, privateKey).toString('base64');
  const envelope = {
    spec: RELEASE_SPEC,
    algorithm: 'Ed25519',
    signedFile: SUMS_FILE,
    signedUtc: new Date().toISOString(),
    sha256OfSignedFile: sha256(sums),
    publicKeyFile: PUBKEY_FILE,
    publicKeyFingerprint: sha256(Buffer.from(publicPem)),
    signature
  };
  fs.writeFileSync(path.join(distDir, SIG_FILE), JSON.stringify(envelope, null, 2) + '\n');
  fs.writeFileSync(path.join(distDir, PUBKEY_FILE), publicPem);

  // Keep the build manifest honest: record that this release set IS signed.
  const manifestPath = path.join(distDir, DIST_MANIFEST);
  if (fs.existsSync(manifestPath)) {
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    m.signature = {
      scheme: 'ed25519-detached',
      status: 'signed',
      signedFile: SUMS_FILE,
      signatureFile: SIG_FILE,
      publicKeyFile: PUBKEY_FILE,
      publicKeyFingerprint: envelope.publicKeyFingerprint,
      signedUtc: envelope.signedUtc,
      note: 'Verify offline with: node tools/release/release-tool.mjs verify-signature'
    };
    fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n');
  }
  return envelope;
}

export function verifySignature(distDir) {
  const problems = [];
  const sigPath = path.join(distDir, SIG_FILE);
  const pubPath = path.join(distDir, PUBKEY_FILE);
  const sumsPath = path.join(distDir, SUMS_FILE);
  if (!fs.existsSync(sigPath)) return { ok: false, problems: ['missing ' + SIG_FILE] };
  if (!fs.existsSync(pubPath)) return { ok: false, problems: ['missing ' + PUBKEY_FILE] };
  if (!fs.existsSync(sumsPath)) return { ok: false, problems: ['missing ' + SUMS_FILE] };
  let envelope;
  try { envelope = JSON.parse(fs.readFileSync(sigPath, 'utf8')); }
  catch (e) { return { ok: false, problems: ['signature envelope unreadable: ' + e.message] }; }
  if (envelope.spec !== RELEASE_SPEC) problems.push('unexpected release spec');
  if (envelope.algorithm !== 'Ed25519') problems.push('unexpected signature algorithm');
  const pubPem = fs.readFileSync(pubPath, 'utf8');
  if (envelope.publicKeyFingerprint !== sha256(Buffer.from(pubPem))) problems.push('public key fingerprint mismatch');
  const sums = fs.readFileSync(sumsPath);
  if (envelope.sha256OfSignedFile !== sha256(sums)) problems.push('SHA256SUMS changed since it was signed');
  try {
    const ok = crypto.verify(null, sums, crypto.createPublicKey(pubPem), Buffer.from(envelope.signature, 'base64'));
    if (!ok) problems.push('Ed25519 signature does not verify');
  } catch (e) { problems.push('signature verification error: ' + e.message); }
  return { ok: problems.length === 0, problems };
}

// --- snapshots (backup / restore / rollback) ---------------------------------
export function listDistFiles(distDir) {
  if (!fs.existsSync(distDir)) throw new Error('dist dir not found: ' + distDir);
  return fs.readdirSync(distDir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort();
}

// Reject any name that could escape the snapshot dir (ZIP-Slip-style traversal).
export function safeFileName(name) {
  if (typeof name !== 'string' || !name || name.includes('/') || name.includes('\\') ||
      name === '.' || name === '..' || name.startsWith('.') || /[\x00-\x1f]/.test(name)) return null;
  return name;
}

export function snapshotId(label) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const slug = String(label || 'release').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 40) || 'release';
  return stamp + '-' + slug;
}

export function createSnapshot({ distDir = DEFAULT_DIST, storeDir = DEFAULT_STORE, label = 'release', metadataOnly = false }) {
  const names = listDistFiles(distDir);
  if (!names.length) throw new Error('nothing to back up in ' + distDir);
  const id = snapshotId(label);
  const dir = path.join(storeDir, id);
  const payloadDir = path.join(dir, 'files');
  fs.mkdirSync(payloadDir, { recursive: true });
  const files = [];
  for (const name of names) {
    if (!safeFileName(name)) throw new Error('unsafe dist file name: ' + name);
    const src = path.join(distDir, name);
    const buf = fs.readFileSync(src);
    const isMeta = /\.(json|pem|sig|txt)$/i.test(name) || name === SUMS_FILE;
    if (!metadataOnly || isMeta) fs.writeFileSync(path.join(payloadDir, name), buf);
    files.push({ name, sha256: sha256(buf), size: buf.length, stored: (!metadataOnly || isMeta) });
  }
  const base = {
    spec: RELEASE_SPEC,
    id,
    label,
    createdUtc: new Date().toISOString(),
    sourceDist: path.relative(REPO_ROOT, distDir),
    metadataOnly: !!metadataOnly,
    signature: fs.existsSync(path.join(distDir, SIG_FILE))
      ? JSON.parse(fs.readFileSync(path.join(distDir, SIG_FILE), 'utf8'))
      : null,
    files
  };
  const manifest = Object.assign({}, base, { backupHash: sha256(Buffer.from(canonical(base))) });
  fs.writeFileSync(path.join(dir, BACKUP_MANIFEST), JSON.stringify(manifest, null, 2) + '\n');
  return { id, dir, manifest };
}

export function listSnapshots(storeDir = DEFAULT_STORE) {
  if (!fs.existsSync(storeDir)) return [];
  return fs.readdirSync(storeDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(storeDir, e.name, BACKUP_MANIFEST)))
    .map((e) => e.name)
    .sort();
}

export function verifySnapshot({ storeDir = DEFAULT_STORE, id }) {
  const problems = [];
  const dir = path.join(storeDir, path.basename(String(id || '')));
  const manifestPath = path.join(dir, BACKUP_MANIFEST);
  if (!fs.existsSync(manifestPath)) return { ok: false, problems: ['snapshot not found: ' + id] };
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
  catch (e) { return { ok: false, problems: ['backup manifest unreadable: ' + e.message] }; }
  const { backupHash, ...base } = manifest;
  if (backupHash !== sha256(Buffer.from(canonical(base)))) problems.push('backup manifest self-hash mismatch (manifest tampered)');
  if (manifest.spec !== RELEASE_SPEC) problems.push('unexpected release spec');
  for (const f of manifest.files || []) {
    if (!safeFileName(f.name)) { problems.push('unsafe entry name: ' + f.name); continue; }
    if (!f.stored) continue;
    const p = path.join(dir, 'files', f.name);
    if (!fs.existsSync(p)) { problems.push('missing payload: ' + f.name); continue; }
    const buf = fs.readFileSync(p);
    if (buf.length !== f.size) problems.push('size mismatch: ' + f.name);
    if (sha256(buf) !== f.sha256) problems.push('hash mismatch: ' + f.name);
  }
  // Signature carried in the snapshot must itself be internally consistent.
  if (manifest.signature) {
    const sig = manifest.signature;
    const sumsEntry = (manifest.files || []).find((f) => f.name === SUMS_FILE);
    if (!sumsEntry || sig.sha256OfSignedFile !== sumsEntry.sha256) problems.push('signed SHA256SUMS does not match snapshot payload');
  }
  return { ok: problems.length === 0, problems, manifest, dir };
}

export function restoreSnapshot({ distDir = DEFAULT_DIST, storeDir = DEFAULT_STORE, id, apply = false }) {
  const check = verifySnapshot({ storeDir, id });
  if (!check.ok) throw new Error('refusing to restore an unverified snapshot: ' + check.problems.join('; '));
  const missing = (check.manifest.files || []).filter((f) => f.stored && !fs.existsSync(path.join(check.dir, 'files', f.name)));
  if (missing.length) throw new Error('snapshot payload incomplete: ' + missing.map((f) => f.name).join(', '));
  const plan = (check.manifest.files || []).filter((f) => f.stored).map((f) => f.name);
  if (!apply) return { applied: false, plan, id: check.manifest.id };

  // Make the rollback itself reversible BEFORE touching the live release set.
  const safety = createSnapshot({ distDir, storeDir, label: 'pre-rollback' });
  const notStored = (check.manifest.files || []).filter((f) => !f.stored);
  fs.mkdirSync(distDir, { recursive: true });
  for (const name of plan) {
    const src = path.join(check.dir, 'files', name);
    const buf = fs.readFileSync(src);
    const declared = check.manifest.files.find((f) => f.name === name);
    if (sha256(buf) !== declared.sha256) throw new Error('payload changed during restore: ' + name);
    fs.writeFileSync(path.join(distDir, name), buf);
  }
  const post = verifySignature(distDir);
  return {
    applied: true,
    plan,
    id: check.manifest.id,
    safetySnapshot: safety.id,
    skippedBinaryRestore: notStored.map((f) => f.name),
    signatureOk: post.ok
  };
}

export function rollback({ distDir = DEFAULT_DIST, storeDir = DEFAULT_STORE, apply = false }) {
  const ids = listSnapshots(storeDir).filter((s) => !s.includes('pre-rollback'));
  const verified = [];
  for (const sid of ids) {
    const r = verifySnapshot({ storeDir, id: sid });
    if (r.ok) verified.push(sid);
  }
  if (!verified.length) throw new Error('no verified snapshot available to roll back to');
  const target = verified[verified.length - 1];
  return restoreSnapshot({ distDir, storeDir, id: target, apply });
}

export function status({ distDir = DEFAULT_DIST, storeDir = DEFAULT_STORE } = {}) {
  const sig = fs.existsSync(path.join(distDir, SIG_FILE)) ? verifySignature(distDir) : { ok: false, problems: ['unsigned'] };
  return {
    distDir,
    storeDir,
    files: fs.existsSync(distDir) ? listDistFiles(distDir) : [],
    signedRelease: sig.ok,
    signatureProblems: sig.problems || [],
    snapshots: listSnapshots(storeDir),
    rollbackTargets: listSnapshots(storeDir).filter((s) => !s.includes('pre-rollback') && verifySnapshot({ storeDir, id: s }).ok)
  };
}

// --- CLI ---------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') opts.apply = true;
    else if (a === '--metadata-only') opts.metadataOnly = true;
    else if (a.startsWith('--')) { const k = a.slice(2); opts[k] = argv[++i]; }
    else opts._.push(a);
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cmd = opts._[0];
  const distDir = path.resolve(opts.dist || DEFAULT_DIST);
  const storeDir = path.resolve(opts.store || DEFAULT_STORE);
  const out = (v) => process.stdout.write(JSON.stringify(v, null, 2) + '\n');

  switch (cmd) {
    case 'keygen': {
      const r = generateKeypair(opts.out);
      out({ ok: true, privateKeyPath: r.privatePath, publicKeyPath: r.publicPath, publicKeyFingerprint: r.fingerprint,
        warning: 'Private key is OUTSIDE the repository. Keep it on the offline release machine; never commit it.' });
      break;
    }
    case 'sign': {
      const envelope = signSums(distDir, readPrivateKey(opts.key));
      out({ ok: true, signatureFile: SIG_FILE, publicKeyFile: PUBKEY_FILE, publicKeyFingerprint: envelope.publicKeyFingerprint, signedUtc: envelope.signedUtc });
      break;
    }
    case 'verify-signature': {
      const r = verifySignature(distDir);
      out(r);
      if (!r.ok) process.exitCode = 1;
      break;
    }
    case 'snapshot': {
      const r = createSnapshot({ distDir, storeDir, label: opts.label || 'release', metadataOnly: !!opts.metadataOnly });
      out({ ok: true, id: r.id, dir: r.dir, files: r.manifest.files.length, metadataOnly: !!opts.metadataOnly, backupHash: r.manifest.backupHash });
      break;
    }
    case 'list': out({ ok: true, snapshots: listSnapshots(storeDir) }); break;
    case 'verify': {
      const r = verifySnapshot({ storeDir, id: opts._[1] });
      out({ ok: r.ok, problems: r.problems || [], id: r.manifest && r.manifest.id });
      if (!r.ok) process.exitCode = 1;
      break;
    }
    case 'restore': {
      if (!opts._[1]) throw new Error('usage: restore <snapshot-id> [--apply]');
      out(Object.assign({ ok: true }, restoreSnapshot({ distDir, storeDir, id: opts._[1], apply: !!opts.apply })));
      break;
    }
    case 'rollback': out(Object.assign({ ok: true }, rollback({ distDir, storeDir, apply: !!opts.apply }))); break;
    case 'status': out(Object.assign({ ok: true }, status({ distDir, storeDir }))); break;
    default:
      out({ ok: false, usage: ['keygen', 'sign', 'verify-signature', 'snapshot', 'list', 'verify <id>', 'restore <id> [--apply]', 'rollback [--apply]', 'status'] });
      process.exitCode = 2;
  }
}

const invokedDirectly = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  try { main(); }
  catch (e) { process.stderr.write('release-tool: ' + (e.message || e) + '\n'); process.exitCode = 1; }
}
