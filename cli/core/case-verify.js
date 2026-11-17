/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */
// Case-layer verification (Node side). Reuses pwa/core/case-manifest.js as the single source of
// truth (same module the PWA and the test harness load), so case integrity logic is never forked.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const zipStream = require('./zip-stream');
const verifyCore = require('./verify');

const ROOT = path.resolve(__dirname, '..', '..');
let caseCorePromise = null;
function loadCaseCore() {
  if (!caseCorePromise) {
    caseCorePromise = (async () => {
      const srcPath = path.join(ROOT, 'pwa', 'core', 'case-manifest.js');
      try {
        // Normal path (un-bundled Node / dev): import the ESM core directly.
        return await import(pathToFileURL(srcPath).href);
      } catch (primaryErr) {
        // pkg/nexe cannot dynamically import an ESM module from its snapshot ("Invalid host
        // defined options"), and its asset store uses build-machine-absolute paths that are not
        // portable. So the build transpiles the trusted ESM core (case-manifest.js + its sibling
        // hash.js) to CommonJS and embeds the result as strings inside
        // cli/core/_embedded-core.generated.js — a plain CJS module pkg bundles normally. Here we
        // materialize them into a real temp dir and require() them (CJS is pkg-native). The trusted
        // hash logic is byte-for-byte unchanged; only the module format/loading differs. This branch
        // runs ONLY inside the bundle (process.pkg is set).
        if (!process.pkg) throw primaryErr;
        // The trusted core (pwa/core/hash.js) relies on globalThis.crypto (WebCrypto). The Node
        // runtime embedded by pkg may not expose it globally; provide it from Node's webcrypto so
        // the kernel's hashing is unchanged. Adapter-level only — the kernel is untouched.
        if (!globalThis.crypto && typeof require === 'function') {
          try { globalThis.crypto = require('crypto').webcrypto; } catch (e) { /* ignore */ }
        }
        const embedded = require('./_embedded-core.generated.js');
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldseal-core-'));
        fs.writeFileSync(path.join(tmp, 'hash.cjs'), embedded['hash.cjs']);
        fs.writeFileSync(path.join(tmp, 'case-manifest.cjs'), embedded['case-manifest.cjs']);
        try {
          return require(path.join(tmp, 'case-manifest.cjs'));
        } catch (fallbackErr) {
          fallbackErr.message = 'failed to load case core: ' + (fallbackErr && fallbackErr.message);
          throw fallbackErr;
        }
      }
    })();
  }
  return caseCorePromise;
}

async function readCaseManifestFromDir(dir) {
  const p = path.join(dir, 'case-manifest.json');
  if (!fs.existsSync(p)) throw new Error('case-manifest.json not found in ' + dir);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Reject path traversal / absolute paths: any entry containing `..`, a leading `/` or `\`, an empty segment,
// or a dot segment is refused (returns null and is skipped during extraction). This guarantees extraction
// can never write outside the temp dir (ZIP-Slip protection — delivery audit B-03). We reject rather than
// silently sanitize so a crafted entry name is never written anywhere.
function safeEntryRel(name) {
  if (typeof name !== 'string' || !name) return null;
  if (name[0] === '/' || name[0] === '\\') return null;
  const parts = name.split('/');
  for (const p of parts) {
    if (p === '' || p === '.' || p === '..') return null;
  }
  return parts.join('/');
}

async function extractCaseToTmp(zipPath) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldseal-case-'));
  const handle = await zipStream.readZip(zipPath);
  try {
    for (const entry of handle.entries) {
      if (entry.name === 'manifest.json' || entry.name === 'bundle-index.json') continue;
      const rel = safeEntryRel(entry.name);
      if (!rel) {
        console.warn('[verify] skipped unsafe zip entry (path traversal): ' + entry.name);
        continue;
      }
      const target = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      await handle.extractToFile(entry, target);
    }
  } finally {
    await handle.close();
  }
  return tmp;
}

async function childVerify(child, caseDir) {
  let evPath;
  const direct = path.join(caseDir, 'evidence', child.packageId + '.zip');
  if (fs.existsSync(direct)) evPath = direct;
  else {
    const byName = path.join(caseDir, 'evidence', child.packageId + '.zip');
    if (fs.existsSync(byName)) evPath = byName;
  }
  if (!evPath) return { packageId: child.packageId, rootHash: child.rootHash, coreResult: 'missing_evidence' };
  const r = await verifyCore.verifyPackage(evPath, { noLink: true, autoDiscover: false });
  return { packageId: child.packageId, rootHash: r.rootHash, coreResult: r.coreResult };
}

const PLAINTEXT_MANIFEST = 'case-manifest.json';
const CIPHER_SNAPSHOT = 'case-manifest.json.enc';

async function verifyCaseExport(casePath) {
  const isZip = /\.zip$/i.test(casePath);
  const tmp = isZip ? await extractCaseToTmp(casePath) : null;
  const caseDir = tmp || casePath;

  // ENCRYPTION CONTRACT: a normal export always carries a PLAINTEXT case-manifest.json, so any
  // third party can verify it without a passphrase. `case-manifest.json.enc` is only an optional
  // encrypted SNAPSHOT. If somebody ships an encrypted-only container instead, the contract is
  // degraded and we MUST say so explicitly — never return `ok` (which would imply verification).
  const hasPlain = fs.existsSync(path.join(caseDir, PLAINTEXT_MANIFEST));
  const hasCipher = fs.existsSync(path.join(caseDir, CIPHER_SNAPSHOT));
  if (!hasPlain && hasCipher) {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    return {
      coreResult: 'needs_password',
      specVersion: null,
      sealHash: '', rootHash: '', children: [],
      errors: ['encrypted-only container: ' + PLAINTEXT_MANIFEST + ' is absent; decrypt ' + CIPHER_SNAPSHOT + ' first']
    };
  }

  const caseObj = await readCaseManifestFromDir(caseDir);
  const caseCore = await loadCaseCore();
  const result = await caseCore.verifyCase(caseObj, { verifyChild: (child) => childVerify(child, caseDir) });

  // PNG signatures are attachments; the manifest holds only their digest (bound to rootHash /
  // sealHash). A missing or altered attachment must downgrade the case, never pass silently.
  // `invalid_spec` stays the highest-severity verdict.
  const downgrade = (msg) => {
    result.errors.push(msg);
    if (result.coreResult !== 'invalid_spec') result.coreResult = 'tampered';
  };
  for (const cs of caseObj.countersignList || []) {
    if (!cs || !cs.signatureSha256 || !cs.signatureFile) continue;
    if (!/^signatures\/[A-Za-z0-9_-]+\.png$/.test(cs.signatureFile)) {
      downgrade('invalid signature attachment path');
      continue;
    }
    const attachment = path.join(caseDir, cs.signatureFile);
    if (!fs.existsSync(attachment)) {
      downgrade('missing signature attachment: ' + cs.signatureFile);
      continue;
    }
    const digest = 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(attachment)).digest('hex');
    if (digest !== cs.signatureSha256) downgrade('signature attachment digest mismatch: ' + cs.signatureFile);
  }

  // v0.4 §十一: extension-hook products live in attachments/ and are deliberately OUTSIDE the
  // manifest / sealHash. Their integrity statement is case-files.sha256 (file-level only).
  // Verify every declared attachments/* line byte-for-byte, and refuse any attachment that is
  // present in the package but NOT declared (so deleting a checksum line cannot bypass it).
  const checksumPath = path.join(caseDir, 'case-files.sha256');
  const declared = new Set();
  if (fs.existsSync(checksumPath)) {
    for (const line of fs.readFileSync(checksumPath, 'utf8').split(/\r?\n/)) {
      const m = /^([0-9a-f]{64})\s+\*?(\S.*)$/.exec(line.trim());
      if (!m) continue;
      const rel = m[2].trim();
      if (!rel.startsWith('attachments/')) continue;
      declared.add(rel);
      if (rel.includes('..') || path.isAbsolute(rel)) { downgrade('invalid attachment path: ' + rel); continue; }
      const attachment = path.join(caseDir, rel);
      if (!fs.existsSync(attachment)) { downgrade('missing attachment: ' + rel); continue; }
      const digest = crypto.createHash('sha256').update(fs.readFileSync(attachment)).digest('hex');
      if (digest !== m[1]) downgrade('attachment digest mismatch: ' + rel);
    }
  }
  const attachDir = path.join(caseDir, 'attachments');
  if (fs.existsSync(attachDir) && fs.statSync(attachDir).isDirectory()) {
    for (const name of fs.readdirSync(attachDir)) {
      const rel = 'attachments/' + name;
      if (!declared.has(rel)) downgrade('undeclared attachment: ' + rel);
    }
  }

  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  return result;
}

module.exports = { verifyCaseExport, safeEntryRel };
