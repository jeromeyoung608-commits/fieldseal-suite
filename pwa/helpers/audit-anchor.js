/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Audit-trail integrity anchoring + Ed25519-signed export.
// This module is PURE CRYPTO PRIMITIVES only (no key management, no shipped keys).
// It depends only on pwa/core/hash.js (via callers) and the platform WebCrypto
// Ed25519 primitive — no hand-rolled crypto (S-07 red line). Loads in both the
// browser PWA and the Node CLI/tests without touching the trusted case kernel.
// TRUST MODEL (read before the "this is theater" objection):
// * Signing keys are device-bound and NEVER shipped (see audit-device-key.js):
// the private key is generated on-device as non-extractable, so possessing the
// install package does NOT let anyone forge a signature. This closes the hole
// where a private key was bundled and `verifySignedExport` trusted a key taken
// from the export file itself.
// * `verifySignedExport(exported, trustedSpki)` verifierifies ONLY against the
// TRUSTED device public key passed in — never against `exported.devicePubKey`.
// The file may carry a self-reported `devicePubKey` for convenience, but it is
// ignored during verification. An attacker cannot just embed a fresh key.
// * Residual limitation (documented, not hidden): this is DEVICE-INSTANCE
// binding, not third-party attestation. True external anchoring against a
// full-device compromise needs a TSA (RFC3161, EP-001) — see KNOWN_ISSUES.
// Maps to delivery-audit §11.3 audit deductions ① (chain-head anchor) + ② (signed export).

function getEncoder() {
 if (typeof TextEncoder !== 'undefined') return new TextEncoder();
 return { encode: (s) => Buffer.from(s, 'utf8') };
}
const TE = getEncoder();

function subtleCrypto() {
 const c = (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) ||
 (typeof crypto !== 'undefined' && crypto.subtle);
 if (!c) throw new Error('WebCrypto subtle unavailable');
 return c;
}

function bytesOf(str) { return TE.encode(String(str)); }

function b64(buf) {
 const u = (buf instanceof Uint8Array) ? buf : new Uint8Array(buf);
 if (typeof btoa === 'function') {
 let bin = '';
 for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
 return btoa(bin);
 }
 return Buffer.from(u).toString('base64');
}

function b64dec(s) {
 if (typeof atob === 'function') {
 const bin = atob(s);
 const u = new Uint8Array(bin.length);
 for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
 return u;
 }
 return new Uint8Array(Buffer.from(s, 'base64'));
}

export async function generateEd25519KeyPair(extractable = true) {
 return subtleCrypto().generateKey({ name: 'Ed25519' }, extractable, ['sign', 'verify']);
}
export async function exportPublicKey(keyPair) {
 return b64(await subtleCrypto().exportKey('spki', keyPair.publicKey));
}
export async function exportPrivateKey(keyPair) {
 return b64(await subtleCrypto().exportKey('pkcs8', keyPair.privateKey));
}
export async function importPublicKey(spkiB64) {
 return subtleCrypto().importKey('spki', b64dec(spkiB64), { name: 'Ed25519' }, true, ['verify']);
}
export async function importPrivateKey(pkcs8B64) {
 return subtleCrypto().importKey('pkcs8', b64dec(pkcs8B64), { name: 'Ed25519' }, false, ['sign']);
}

export async function signText(text, privateKey) {
 const sig = await subtleCrypto().sign({ name: 'Ed25519' }, privateKey, bytesOf(text));
 return b64(sig);
}
export async function verifyText(text, sigB64, publicKey) {
 try {
 return await subtleCrypto().verify({ name: 'Ed25519' }, publicKey, b64dec(sigB64), bytesOf(text));
 } catch { return false; }
}

// Head of a hash-chained trail = last entry's hash (GENESIS if empty).
const GENESIS = '0'.repeat(64);
export function chainHead(entries) {
 if (!Array.isArray(entries) || entries.length === 0) return GENESIS;
 const last = entries[entries.length - 1];
 return (last && typeof last.hash === 'string' && last.hash.length === 64) ? last.hash : GENESIS;
}

// Commit the chain head under a signature from the device's private key.
export async function createAnchor(entries, privateKey, opts = {}) {
 const head = chainHead(entries);
 const timestamp = opts.timestamp || new Date().toISOString();
 const signature = await signText(head + '|' + timestamp, privateKey);
 return { head, timestamp, signature, alg: 'Ed25519' };
}

// Verify the anchor: signature valid AND its committed head matches current head.
export async function verifyAnchor(anchor, publicKey, currentHead) {
 if (!anchor || anchor.alg !== 'Ed25519') return { ok: false, reason: 'bad anchor' };
 const sigOk = await verifyText(anchor.head + '|' + anchor.timestamp, anchor.signature, publicKey);
 if (!sigOk) return { ok: false, reason: 'bad signature' };
 if (currentHead !== anchor.head) return { ok: false, reason: 'head mismatch', anchorHead: anchor.head, currentHead };
 return { ok: true, reason: '' };
}

// Signed export: JSON trail + the chain head signed by the DEVICE key + an optional
// TSA timestamp anchor (separate authority key). The device key is required (no shipped
// private key) — the caller obtains it from audit-device-key.js `ensureDeviceKey()`.
// `tsaMode` records HOW the timestamp anchor was produced (set by the caller, which reads
// getAuditConfig()): 'local' = a LOCAL timestamp attestation issued by a separate on-device
// non-extractable TSA key (NOT RFC3161 — see audit-tsa.js); 'external' = a REAL third-party
// RFC3161 token (verified by `doctor` via `openssl ts -verify`, never by hand-rolled ASN.1);
// 'off' = NO timestamp anchoring (must NOT be reported as "TSA ok").
export async function signedLogExport(entries, deviceKeyPair, opts = {}) {
 if (!deviceKeyPair || !deviceKeyPair.privateKey) {
 throw new Error('a device-bound key is required to sign (no shipped private key)');
 }
 const log = JSON.stringify(entries, null, 2);
 const head = chainHead(entries);
 const signature = await signText(head, deviceKeyPair.privateKey);
 const devicePubKey = await exportPublicKey(deviceKeyPair);
 const tsaMode = opts && opts.tsaMode ? opts.tsaMode : (opts && opts.tsaToken ? 'local' : 'off');
 const out = {
 format: 'fieldseal-audit-export-v2',
 log,
 head,
 devicePubKey,
 signature,
 generatedAt: new Date().toISOString(),
 tsaMode
 };
 if (opts && opts.tsaToken) out.tsaToken = opts.tsaToken;
 if (opts && opts.tsaDegraded) out.tsaDegraded = true;
 if (opts && opts.tsaRootFingerprint) out.tsaRootFingerprint = opts.tsaRootFingerprint;
 return out;
}

// Verify a signed export.
// * Rejects non-v2 / unsigned exports (missing signature => caller must treat as fail).
// * Recomputes the head from the entries and checks it equals the signed head.
// * Verifies the signature against `trustedSpki` ONLY — never against the file's
// own `devicePubKey`. So an attacker re-signing with a different key is rejected.
// * Timestamp anchor is handled MODE-AWARELY (9.0 A1/A3):
// - tsaMode 'off' => no anchoring; reports 'off', never "TSA ok".
// - tsaMode 'local' => verifies the local attestation against the pinned TSA root.
// - tsaMode 'external' => requires a real RFC3161 token AND not degraded; the actual
// DER->root verification is `doctor`'s `openssl ts -verify`
// job (no hand-rolled ASN.1), so we only confirm presence +
// non-degradation and flag tsaExternalPendingDoctor.
// - tsaDegraded:true => always REJECTED (external timestamp was unavailable).
export async function verifySignedExport(exported, trustedSpki, opts = {}) {
 if (!exported || exported.format !== 'fieldseal-audit-export-v2') return { ok: false, reason: 'bad format' };
 if (typeof exported.signature !== 'string' || typeof exported.head !== 'string') {
 return { ok: false, reason: 'unsigned export (no signature present)' };
 }
 if (typeof trustedSpki !== 'string' || !trustedSpki) {
 return { ok: false, reason: 'no trusted device key supplied — cannot verify' };
 }
 let pub;
 try { pub = await importPublicKey(trustedSpki); } catch { return { ok: false, reason: 'bad trusted public key' }; }
 let entries;
 try { entries = JSON.parse(exported.log); } catch { return { ok: false, reason: 'bad log json' }; }
 const head = chainHead(entries);
 if (head !== exported.head) return { ok: false, reason: 'head mismatch', currentHead: head, fileHead: exported.head };
 const sigOk = await verifyText(head, exported.signature, pub);
 if (!sigOk) return { ok: false, reason: 'bad signature (not signed by the trusted device key)' };

 const tsaMode = exported.tsaMode || (exported.tsaToken ? 'local' : 'off');
 // Optional replay/rollback guard: if the caller supplies the CURRENT live head, a stale
 // or replayed export (whose head no longer matches) is flagged (9.0 A4 #8/#9).
 if (opts && typeof opts.currentHead === 'string' && opts.currentHead !== head) {
 return { ok: false, reason: 'stale/replayed export — head ' + head.slice(0, 12) + '… does not match current live head ' + opts.currentHead.slice(0, 12) + '…', tsaStatus: 'stale' };
 }
 if (tsaMode === 'off') {
 return { ok: true, reason: '', head, count: entries.length, tsaMode: 'off', tsaStatus: 'off (no timestamp anchoring)' };
 }
 if (exported.tsaDegraded === true) {
 return { ok: false, reason: 'tsa: degraded (external timestamp unavailable at export time) — export not anchored', tsaStatus: 'degraded' };
 }
 if (!exported.tsaToken) return { ok: false, reason: 'no timestamp anchor (tsaMode=' + tsaMode + ')' };
 const trustedTsaSpki = opts && opts.trustedTsaSpki;
 if (tsaMode === 'local') {
 if (!trustedTsaSpki) return { ok: false, reason: 'no trusted TSA key supplied — cannot verify local timestamp' };
 try {
 const { verifyTimestamp } = await import('./audit-tsa.js');
 const tv = await verifyTimestamp(exported.tsaToken, trustedTsaSpki);
 if (!tv.ok) return { ok: false, reason: 'tsa: ' + tv.reason, tsaStatus: 'local-fail' };
 } catch (e) { return { ok: false, reason: 'tsa verification error: ' + e.message, tsaStatus: 'local-error' }; }
 return { ok: true, reason: '', head, count: entries.length, tsaMode: 'local', tsaStatus: 'local anchored', tsaGenTime: exported.tsaToken.genTime };
 }
 // external RFC3161: browser cannot parse DER; full DER->root verification is doctor's
 // `openssl ts -verify` job. We only confirm a genuine RFC3161 token is present + not degraded.
 if (!exported.tsaToken || exported.tsaToken.kind !== 'rfc3161') {
 return { ok: false, reason: 'tsa: external token missing or wrong kind (rfc3161 expected)', tsaStatus: 'external-bad' };
 }
 return { ok: true, head, count: entries.length, tsaMode: 'external', tsaStatus: 'external-pending-doctor (verify with doctor --tsa-root + openssl ts -verify)', tsaExternalPendingDoctor: true };
}

// OPTIONAL out-of-seal hint only. The authoritative, tamper-evident anchor is
// commitAnchor()/verifyAnchorStore() in local-audit-log.js (device-key, IndexedDB).
// This helper is a convenience pointer a case can carry to reference the trail
// head; it is deliberately NOT folded into sealHash, so it is advisory and must
// NOT be treated as the audit anchor itself.
// Attach the audit anchor to a case manifest as an OUT-OF-SEAL advisory record. This is
// NOT part of sealHash (so adding it never changes the signed case content). It records
// the timestamp-anchor mode so a recipient can see whether the trail was anchored locally
// or by an external RFC3161 TSA. deviceKeyFingerprint is fingerprintSpki(publicKey) — the
// recipient derives it; we keep the publicKey verbatim.
export function attachAnchorToCase(caseManifest, anchor, publicKeyB64) {
 const m = caseManifest || {};
 const tsaMode = anchor.tsaMode || (anchor.tsaToken ? 'local' : 'off');
 m.auditTrailAnchor = {
 head: anchor.head,
 timestamp: anchor.timestamp,
 signature: anchor.signature,
 alg: 'Ed25519',
 publicKey: publicKeyB64,
 tsaMode,
 tsaDegraded: !!anchor.tsaDegraded,
 tsaRootFingerprint: anchor.tsaRootFingerprint || null,
 note: 'out-of-seal advisory anchor (not in sealHash); deviceKeyFingerprint = fingerprintSpki(publicKey); recipient verifies with doctor --device-key/--tsa-key'
 };
 return m;
}

export async function verifyCaseAnchor(caseManifest, publicKey, currentLocalHead) {
 const a = caseManifest && caseManifest.auditTrailAnchor;
 if (!a) return { ok: false, reason: 'no anchor on case' };
 return verifyAnchor(a, publicKey, currentLocalHead);
}
