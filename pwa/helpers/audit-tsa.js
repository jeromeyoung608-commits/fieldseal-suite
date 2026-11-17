/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// TIMESTAMP ANCHORING for the audit trail — the missing 8.5 piece.
// TWO DISTINCT MECHANISMS — do not conflate them:
// * LOCAL timestamp attestation (kind 'local-tsa'): a token signed by a SEPARATE
// on-device non-extractable TSA key, stored in its OWN IndexedDB. It is DEVICE-
// INSTANCE anchoring only and is explicitly NOT RFC3161 (we do not parse/forge DER).
// * EXTERNAL RFC3161 (kind 'rfc3161'): a REAL RFC3161 TimeStampToken obtained from a
// third-party service (EP-001 contract). Verification is `doctor`'s `openssl ts
// -verify` — we NEVER hand-roll ASN.1/DER parsing (S-07 red line). If openssl (or the
// TSA) is unavailable, external mode degrades HONESTLY (no token, anchor rejected).
// WHY A SEPARATE TSA KEY (and why it is NOT the signing key):
// The device signing key (audit-device-key.js) proves "this device signed the head".
// But a single device-bound key means a FULLY-CONTROLLED device can re-sign both the
// log AND the anchor after tampering. To raise the bar, the anchor also carries a
// TIMESTAMP TOKEN issued by a SEPARATE authority key (the "TSA"), stored in its OWN
// IndexedDB — so an attacker must compromise TWO independent non-extractable keys in
// TWO separate stores to forge an anchor undetected.
// TRUST MODEL:
// * The TSA key is generated on-device as non-extractable and kept in a DIFFERENT
// IndexedDB (`fieldseal-audit-tsa`) from the signing key (`fieldseal-audit-devicekey`).
// * The verifier supplies the TRUSTED TSA public key out-of-band (browser self-check
// uses its own enrolled TSA key; `doctor --tsa-key <spki>` takes it as an argument;
// a recipient compares the TSA fingerprint with one recorded at enrolment). The
// token's self-reported `tsaSpki` is NEVER trusted during verification.
// * `mode: 'external'`: the head hash is sent to a configured RFC3161 endpoint; the
// returned token is verified against the configured trusted root. Unreachable =>
// honest degradation (the caller records 'tsa: degraded', and a verifier WITHOUT the
// external root treats the export as device-bound only, not third-party anchored).
// No hand-rolled crypto: everything uses the platform WebCrypto Ed25519 primitive.

import {
 signText, verifyText, exportPublicKey, importPublicKey, generateEd25519KeyPair
} from './audit-anchor.js';

const TSA_DB = 'fieldseal-audit-tsa';
let _cached = null; // { publicKey, privateKey, spki }

function subtle() {
 const c = (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) ||
 (typeof crypto !== 'undefined' && crypto.subtle);
 if (!c) throw new Error('WebCrypto subtle unavailable');
 return c;
}
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

async function openIdb() {
 if (typeof indexedDB === 'undefined') return null;
 return new Promise((resolve, reject) => {
 const req = indexedDB.open(TSA_DB, 1);
 req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('keys')) req.result.createObjectStore('keys'); };
 req.onsuccess = () => resolve(req.result);
 req.onerror = () => reject(req.error);
 });
}
async function idbGet(db, key) {
 return new Promise((res, rej) => { const t = db.transaction('keys', 'readonly'); const r = t.objectStore('keys').get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function idbPut(db, key, val) {
 return new Promise((res, rej) => { const t = db.transaction('keys', 'readwrite'); t.objectStore('keys').put(val, key); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}

// Ensure a SEPARATE TSA key exists (different store, different non-extractable key).
export async function ensureTsaKey() {
 if (_cached) return _cached;
 const sub = subtle();
 let db = null;
 try { db = await openIdb(); } catch { db = null; }
 if (db) {
 try {
 const stored = await idbGet(db, 'tsa-signing');
 if (stored && stored.privateKey) { _cached = stored; return _cached; }
 } catch { /* fall through to generate */ }
 }
 const kp = await sub.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
 const spki = b64(await sub.exportKey('spki', kp.publicKey));
 _cached = { publicKey: kp.publicKey, privateKey: kp.privateKey, spki };
 if (db) { try { await idbPut(db, 'tsa-signing', _cached); } catch { /* ignore */ } }
 return _cached;
}
export function getTsaSpki() { return _cached ? _cached.spki : null; }

// Node/test only: inject a key without IndexedDB (still no shipped key).
export async function _setTsaKeyForTesting(kp) {
 const sub = subtle();
 const spki = b64(await sub.exportKey('spki', kp.publicKey));
 _cached = { publicKey: kp.publicKey, privateKey: kp.privateKey, spki };
 return _cached;
}

// Deterministic canonical string of the token fields (signature excluded).
function canonicalToken(t) {
 return JSON.stringify({
 version: t.version,
 hashAlgorithm: t.hashAlgorithm,
 hashedMessage: t.hashedMessage,
 genTime: t.genTime,
 policy: t.policy,
 tsaSpki: t.tsaSpki
 });
}

// Create a LOCAL timestamp attestation token attesting that `headHash` existed at
// `genTime`, signed by the SEPARATE on-device TSA private key. This is DEVICE-INSTANCE
// anchoring only — it is explicitly NOT RFC3161 (no DER, no third-party root).
export async function createTimestamp(headHash, opts = {}) {
 const tsa = opts.tsaKeyPair || await ensureTsaKey();
 const token = {
 kind: 'local-tsa',
 version: 'fieldseal-tsa-v1',
 hashAlgorithm: 'sha256',
 hashedMessage: headHash,
 genTime: opts.genTime || new Date().toISOString(),
 policy: opts.policy || 'fieldseal-device-tsa',
 tsaSpki: opts.tsaSpki || tsa.spki
 };
 token.signature = await signText(canonicalToken(token), tsa.privateKey);
 return token;
}

export async function verifyTimestamp(token, trustedTsaSpki) {
 // We ONLY handle the local attestation token (kind 'local-tsa'). A real RFC3161 DER
 // token is verified by `doctor` via `openssl ts -verify` — never hand-rolled here.
 if (!token || token.kind !== 'local-tsa' || token.version !== 'fieldseal-tsa-v1') {
 return { ok: false, reason: 'not a local-tsa token (RFC3161 must be verified by doctor/openssl)' };
 }
 if (typeof trustedTsaSpki !== 'string' || !trustedTsaSpki) {
 return { ok: false, reason: 'no trusted TSA key supplied — cannot verify' };
 }
 let pub;
 try { pub = await importPublicKey(trustedTsaSpki); } catch { return { ok: false, reason: 'bad trusted TSA public key' }; }
 const sigOk = await verifyText(canonicalToken(token), token.signature, pub);
 if (!sigOk) return { ok: false, reason: 'bad timestamp signature (not signed by the trusted TSA key)' };
 return { ok: true, reason: '', genTime: token.genTime, tsaSpki: token.tsaSpki };
}

// Obtain a REAL RFC3161 token from an EXTERNAL TSA service. Accepts either a raw DER
// TimeStampResponse or a JSON wrapper `{ token: <base64 DER>, alg: 'RFC3161' }`. We
// NEVER parse/forge DER here — the returned token is verified by `doctor` via
// `openssl ts -verify` against the trusted TSA root cert. Throws on unreachable, on a
// non-RFC3161 response, or when no trusted root is supplied — so the caller degrades
// HONESTLY (no token, anchor rejected) rather than faking external anchoring.
export async function externalTimestamp(headHash, endpoint, trustedRootSpki) {
 if (!endpoint) throw new Error('no external TSA endpoint configured');
 const body = JSON.stringify({ hashAlgorithm: 'sha256', hashedMessage: headHash });
 const resp = await fetch(endpoint, {
 method: 'POST',
 headers: { 'content-type': 'application/json' },
 body
 });
 if (!resp.ok) throw new Error('external TSA returned ' + resp.status);
 const bytes = new Uint8Array(await resp.arrayBuffer());
 let derB64;
 if (bytes[0] === 0x30) { // DER SEQUENCE (raw TimeStampResponse)
 derB64 = b64(bytes);
 } else {
 const data = JSON.parse(new TextDecoder().decode(bytes));
 if (data.alg && data.alg !== 'RFC3161') {
 throw new Error('external TSA returned a non-RFC3161 token — refusing to label it RFC3161');
 }
 derB64 = data.token;
 }
 if (!derB64) throw new Error('external TSA returned no token');
 if (!trustedRootSpki) throw new Error('external RFC3161 token needs the trusted TSA root (cert) to verify');
 return { kind: 'rfc3161', token: derB64, tsaRootSpki: trustedRootSpki };
}
