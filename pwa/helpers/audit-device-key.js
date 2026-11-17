/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Device-bound signing key for the local audit trail.
// WHY A DEVICE KEY (and why NO key ships in the product):
// The previous design shipped an Ed25519 PRIVATE key in the bundle so the app could
// sign exports. That is not a trust anchor — anyone with the package could sign
// arbitrary logs. Per delivery-audit re-audit, that makes "export is verifiable"
// false. Here the signing key is GENERATED ON THE DEVICE at first run and stored as
// a NON-EXPORTABLE CryptoKey (browser: IndexedDB; the private key can sign but can
// never be read out). The product ships no private key, so possessing the installer
// does not grant signing ability. (This is device-instance binding, not third-party
// attestation — see KNOWN_ISSUES for the TSA follow-up.)
// VERIFICATION: a verifier NEVER trusts a key inside the export file. The trusted
// device public key is supplied out-of-band: the browser self-check uses the device's
// own registered key (`ensureDeviceKey().spki`); `doctor --device-key <spki>` takes it
// as an argument; a recipient compares the device public-key fingerprint with one
// recorded at enrolment.

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

async function openIdb() {
 if (typeof indexedDB === 'undefined') return null;
 return new Promise((resolve, reject) => {
 const req = indexedDB.open('fieldseal-audit-devicekey', 1);
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

// Ensure a device key exists; returns { publicKey, privateKey, spki } (privateKey
// non-extractable in the browser). Safe to call repeatedly.
export async function ensureDeviceKey() {
 if (_cached) return _cached;
 const sub = subtle();
 let db = null;
 try { db = await openIdb(); } catch { db = null; }
 if (db) {
 try {
 const stored = await idbGet(db, 'audit-signing');
 if (stored && stored.privateKey) { _cached = stored; return _cached; }
 } catch { /* fall through to generate */ }
 }
 const kp = await sub.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
 const spki = b64(await sub.exportKey('spki', kp.publicKey));
 _cached = { publicKey: kp.publicKey, privateKey: kp.privateKey, spki };
 if (db) { try { await idbPut(db, 'audit-signing', _cached); } catch { /* ignore */ } }
 return _cached;
}

export function getDeviceSpki() { return _cached ? _cached.spki : null; }

// Import a trusted device public key (spki base64) for verification. The verifier
// supplies this; it is NEVER read from the export file.
export async function importTrustedKey(spkiB64) {
 const sub = subtle();
 return sub.importKey('spki', (() => {
 const s = spkiB64;
 if (typeof atob === 'function') { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
 return new Uint8Array(Buffer.from(s, 'base64'));
 })(), { name: 'Ed25519' }, true, ['verify']);
}

// Node/test only: inject a key without IndexedDB (still no shipped key — the test
// generates it in-process). Keeps the acceptance script honest (device-key path).
export async function _setDeviceKeyForTesting(kp) {
 const sub = subtle();
 const spki = b64(await sub.exportKey('spki', kp.publicKey));
 _cached = { publicKey: kp.publicKey, privateKey: kp.privateKey, spki };
 return _cached;
}
