/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
import { sha256Uri, isoUtcNow } from '../core/hash.js';

export const ENCRYPTION_SPEC = 'fieldseal-case-encryption-v0.1';
export const PBKDF2_ITERATIONS = 100000;
export const CIPHER_FILE = 'case-manifest.json.enc';
export const CIPHER_ERROR_GENERIC = 'Decryption failed. Passphrase or encrypted archive may be incorrect.';
export const CIPHER_ERROR_TAMPERED = 'CIPHER_TAMPERED: ciphertext digest does not match caseEncryptionMeta';

const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function webCryptoAvailable() {
 return !!(globalThis.crypto && globalThis.crypto.subtle);
}

// In a browser served over plain http (non-localhost) isSecureContext === false and the UI must
// hide the encrypt button and show a fixed hint instead of throwing. Node (tests) has no
// isSecureContext flag but does provide Web Crypto, so it is treated as available.
export function secureContextAvailable() {
 if (!webCryptoAvailable()) return false;
 return globalThis.isSecureContext === undefined || globalThis.isSecureContext === true;
}

function toB64(bytes) {
 let out = '';
 for (const b of bytes) out += String.fromCharCode(b);
 return btoa(out);
}

function fromB64(text) {
 const raw = atob(String(text || ''));
 const out = new Uint8Array(raw.length);
 for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
 return out;
}

async function deriveKey(passphrase, salt, iterations) {
 const material = await globalThis.crypto.subtle.importKey(
 'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']
 );
 return globalThis.crypto.subtle.deriveKey(
 { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
 material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
 );
}

/**
 * Encrypt a case manifest into a verbatim ciphertext Blob plus non-secret metadata.
 * The metadata (salt / IV / authTag / ciphertext hash) is what enters case-manifest.json and is
 * therefore bound to rootHash + sealHash.
 *
 */
export async function encryptCaseArchive(c, passphrase) {
 if (!webCryptoAvailable()) throw new Error('Web Crypto is unavailable in this context');
 if (typeof passphrase !== 'string' || passphrase.length === 0) throw new Error('passphrase required');
 const crypto = globalThis.crypto;
 const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
 const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
 const plaintext = new TextEncoder().encode(JSON.stringify(c, null, 2));
 const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
 // Web Crypto AES-GCM returns ciphertext || 128-bit authentication tag.
 const combined = new Uint8Array(await crypto.subtle.encrypt(
 { name: 'AES-GCM', iv, tagLength: 128 }, key, plaintext
 ));
 const ciphertext = combined.slice(0, combined.length - TAG_BYTES);
 const authTag = combined.slice(combined.length - TAG_BYTES);
 const blob = new Blob([ciphertext], { type: 'application/octet-stream' });
 const meta = {
 spec: ENCRYPTION_SPEC,
 algorithm: 'AES-GCM-256',
 kdf: 'PBKDF2-SHA256',
 iterations: PBKDF2_ITERATIONS,
 saltB64: toB64(salt),
 ivB64: toB64(iv),
 authTagB64: toB64(authTag),
 ciphertextSha256: await sha256Uri(ciphertext),
 plaintextRootHash: c.rootHash,
 plaintextSealHash: c.sealHash,
 cipherFile: CIPHER_FILE,
 encryptedAtUtc: isoUtcNow(),
 note: 'Storage encryption only; it does not replace the case sealHash integrity check.'
 };
 return { blob, meta, ciphertext };
}

/**
 * Ciphertext integrity is checked WITHOUT a password: `ciphertextSha256` lives in
 * caseEncryptionMeta (bound to rootHash/sealHash) and in case-files.sha256.
 *
 */
export async function verifyCipherIntegrity(cipherBytes, meta) {
 if (!meta || typeof meta.ciphertextSha256 !== 'string' || !cipherBytes) return false;
 const bytes = cipherBytes instanceof Uint8Array ? cipherBytes : new Uint8Array(cipherBytes);
 return (await sha256Uri(bytes)) === meta.ciphertextSha256;
}

/**
 * Decrypt a stored cipher blob. Every passphrase/tag failure resolves to ONE generic error so the
 * UI never leaks the reason. Ciphertext byte tampering is caught BEFORE decryption and reported
 * as CIPHER_TAMPERED (never misclassified as a wrong password).
 *
 */
export async function decryptCaseArchive(cipherBytes, meta, passphrase, opts = {}) {
 const failed = () => new Error(CIPHER_ERROR_GENERIC);
 if (!webCryptoAvailable() || !meta || typeof passphrase !== 'string' || !passphrase) throw failed();
 if (opts.integrityChecked !== true && !(await verifyCipherIntegrity(cipherBytes, meta))) {
 throw new Error(CIPHER_ERROR_TAMPERED);
 }
 try {
 const salt = fromB64(meta.saltB64);
 const iv = fromB64(meta.ivB64);
 const tag = fromB64(meta.authTagB64);
 if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw failed();
 const cipher = cipherBytes instanceof Uint8Array ? cipherBytes : new Uint8Array(cipherBytes);
 const combined = new Uint8Array(cipher.length + tag.length);
 combined.set(cipher, 0);
 combined.set(tag, cipher.length);
 const key = await deriveKey(passphrase, salt, meta.iterations || PBKDF2_ITERATIONS);
 const plain = await globalThis.crypto.subtle.decrypt(
 { name: 'AES-GCM', iv, tagLength: 128 }, key, combined
 );
 return JSON.parse(new TextDecoder().decode(plain));
 } catch (_) {
 throw failed();
 }
}

/**
 * One entry point for the UI and the regression suite. The three outcomes are STRICTLY separate
 * and never rewrite the case's sealHash verdict:
 * tampered -> case manifest / encryption metadata (salt, IV, authTag) / ciphertext altered
 * invalid_passphrase -> all bytes intact, derivation or GCM tag failed (generic message only)
 * ok -> decrypted snapshot
 *
 */
export async function classifyCipherResult(c, cipherBytes, meta, passphrase, verifyCaseFn) {
 if (c && typeof verifyCaseFn === 'function') {
 const v = await verifyCaseFn(c);
 if (v.coreResult !== 'ok') {
 return {
 coreResult: 'tampered',
 reason: 'case manifest / encryption metadata altered (' + v.coreResult + ')',
 message: CIPHER_ERROR_TAMPERED
 };
 }
 }
 if (!(await verifyCipherIntegrity(cipherBytes, meta))) {
 return { coreResult: 'tampered', reason: 'ciphertext bytes altered', message: CIPHER_ERROR_TAMPERED };
 }
 try {
 const plain = await decryptCaseArchive(cipherBytes, meta, passphrase, { integrityChecked: true });
 return { coreResult: 'ok', reason: 'decrypted', plain };
 } catch (_) {
 return { coreResult: 'invalid_passphrase', reason: 'wrong passphrase', message: CIPHER_ERROR_GENERIC };
 }
}
