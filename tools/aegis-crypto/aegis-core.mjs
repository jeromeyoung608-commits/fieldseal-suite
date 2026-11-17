/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */
/**
 * Aegis group-envelope crypto (P2-b) — optional value-add component, zero third-party deps.
 *
 * Two independent capabilities, both READ-ONLY with respect to the trusted kernel:
 *
 *  1) STORAGE DECRYPT  — decrypt a FieldSeal case's `case-manifest.json.enc` using the SAME contract
 *     as the kernel (pwa/helpers/case-crypto.js): AES-GCM-256 with a PBKDF2-SHA256(passphrase,
 *     salt, 100000) key. The .enc file holds ONLY ciphertext; the auth tag lives in the plaintext
 *     manifest's `caseEncryptionMeta` (saltB64/ivB64/authTagB64/iterations/ciphertextSha256),
 *     which is bound to rootHash + sealHash. No kernel file is modified.
 *
 *  2) AEGIS ENVELOPE  — wrap a plaintext case manifest into a multi-recipient "group envelope":
 *     a random AES-GCM-256 data key (DEK) encrypts the manifest; each recipient's RSA-OAEP-SHA256
 *     public key wraps the DEK. Any holder of the matching private key can recover the manifest.
 *
 * HARD BOUNDARIES:
 *  - Encryption != sealing. The envelope / storage cipher NEVER alters, replaces or re-aggregates
 *    sealHash / rootHash. The source sealHash is COPIED into the envelope for reference only.
 *  - No key, passphrase or plaintext is ever written to disk by this module; callers pass them in
 *    memory. No network, no third-party crypto.
 *  - This tool does not verify a case; trust still rests on the native sealHash via `case verify`.
 */
import {
  createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes, createHash,
  generateKeyPairSync, createPublicKey, publicEncrypt, privateDecrypt, constants
} from 'node:crypto';

// ---- Kernel storage-encryption contract (mirror of pwa/helpers/case-crypto.js) ----
export const STORAGE_SPEC = 'fieldseal-case-encryption-v0.1';
const PBKDF2_ITERATIONS = 100000;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

// ---- Aegis envelope contract ----
export const AEGIS_SPEC = 'fieldseal-aegis-envelope-v0.1';

const b64 = (buf) => Buffer.from(buf).toString('base64');
const unb64 = (s) => Buffer.from(String(s || ''), 'base64');

/** sha256 hex (used for ciphertext integrity + key fingerprints). */
export function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** Extract the kernel's caseEncryptionMeta from a parsed case manifest (or return null). */
export function readStorageMeta(manifestJson) {
  const m = typeof manifestJson === 'string' ? JSON.parse(manifestJson) : manifestJson;
  return (m && m.caseEncryptionMeta) || null;
}

/**
 * Verify ciphertext integrity WITHOUT a passphrase: ciphertextSha256 (bound to rootHash/sealHash)
 * must equal sha256 of the .enc bytes.
 */
export function verifyStorageIntegrity(cipherBytes, meta) {
  if (!meta || typeof meta.ciphertextSha256 !== 'string' || !cipherBytes) return false;
  // The kernel stores this as a `sha256:<hex>` URI (hash.js sha256Uri); tolerate the prefix.
  const expected = meta.ciphertextSha256.replace(/^sha256:/, '');
  return sha256Hex(cipherBytes) === expected;
}

/**
 * Decrypt a case `case-manifest.json.enc` blob. Returns one of three STRICTLY separate outcomes
 * (matching the kernel semantics):
 *   { status: 'ok', plain }                — decrypted manifest (JSON string)
 *   { status: 'tampered' }                 — ciphertext bytes / meta altered
 *   { status: 'invalid_passphrase' }       — bytes intact, key or GCM tag failed (generic)
 * The auth tag is taken from meta.authTagB64 (NOT stored in the .enc file), per the kernel contract.
 */
export function decryptStorageCipher(cipherBytes, meta, passphrase) {
  if (!meta || typeof meta.saltB64 !== 'string' || !passphrase) return { status: 'invalid_passphrase' };
  if (!verifyStorageIntegrity(cipherBytes, meta)) return { status: 'tampered' };
  try {
    const salt = unb64(meta.saltB64);
    const iv = unb64(meta.ivB64);
    const tag = unb64(meta.authTagB64);
    if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      return { status: 'invalid_passphrase' };
    }
    const iterations = meta.iterations || PBKDF2_ITERATIONS;
    const key = pbkdf2Sync(passphrase, salt, iterations, KEY_BYTES, 'sha256');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(cipherBytes), decipher.final()]).toString('utf8');
    return { status: 'ok', plain };
  } catch (_) {
    return { status: 'invalid_passphrase' };
  }
}

/** SHA-256 fingerprint (hex) of an RSA public key (SPKI DER) — informational recipient id. */
export function publicKeyFingerprint(publicKeyPem) {
  const spki = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return sha256Hex(spki);
}

/** Generate an RSA-OAEP capable member key pair. Returns PEM strings + fingerprint. */
export function generateMemberKey(memberId = 'member-' + randomBytes(6).toString('hex')) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  return { memberId, publicKeyPem: publicKey, privateKeyPem: privateKey, fingerprint: publicKeyFingerprint(publicKey) };
}

/**
 * Build an Aegis group envelope from a plaintext case manifest (JSON string or object).
 * `recipients` = [{ memberId, publicKeyPem }]. The manifest is encrypted once with a random DEK;
 * each recipient's public key wraps the DEK (RSA-OAEP-SHA256). The source sealHash is copied for
 * reference only — never recomputed, never re-aggregated.
 */
export function wrapAegis(plaintextManifest, recipients) {
  const manifestStr = typeof plaintextManifest === 'string'
    ? plaintextManifest
    : JSON.stringify(plaintextManifest, null, 2);
  const manifestObj = JSON.parse(manifestStr); // validate JSON; do not mutate the manifest
  const dek = randomBytes(KEY_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', dek, iv);
  const ciphertext = Buffer.concat([cipher.update(manifestStr, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const wrappedRecipients = recipients.map((r) => ({
    memberId: r.memberId,
    keyFingerprint: publicKeyFingerprint(r.publicKeyPem),
    wrappedDekB64: b64(publicEncrypt(
      { key: r.publicKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      dek
    ))
  }));

  return {
    envelopeSpec: AEGIS_SPEC,
    source: 'case-manifest.json',
    sourceSealHash: manifestObj.sealHash || '',
    sourceRootHash: manifestObj.rootHash || '',
    algorithm: 'AES-GCM-256',
    kdf: 'none (random DEK)',
    ivB64: b64(iv),
    ciphertextB64: b64(ciphertext),
    tagB64: b64(tag),
    createdAtUtc: new Date().toISOString(),
    recipients: wrappedRecipients
  };
}

/**
 * Open an Aegis envelope for one recipient. Returns the plaintext case manifest (JSON string) on
 * success, or throws Error('recipient not found') / Error('decryption failed').
 */
export function openAegis(envelope, memberId, privateKeyPem) {
  const recipient = (envelope.recipients || []).find((r) => r.memberId === memberId);
  if (!recipient) throw new Error('recipient not found: ' + memberId);
  const dek = privateDecrypt(
    { key: privateKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    unb64(recipient.wrappedDekB64)
  );
  const decipher = createDecipheriv('aes-256-gcm', dek, unb64(envelope.ivB64));
  decipher.setAuthTag(unb64(envelope.tagB64));
  return Buffer.concat([decipher.update(unb64(envelope.ciphertextB64)), decipher.final()]).toString('utf8');
}
