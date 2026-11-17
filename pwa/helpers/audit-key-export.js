/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// 9.0 A2 — make the device signing key and the (separate) TSA key DISTRIBUTABLE.
// A recipient verifies an export against these public keys out-of-band: they download the
// .pub files, compare the fingerprint with one recorded at enrolment, and pass the SPKI to
// `doctor --device-key <file> --tsa-key <file>`. The private keys stay non-extractable and
// are NEVER exported (this module only ever handles public keys).
import { sha256Hex } from '../core/hash.js';
import { ensureDeviceKey } from './audit-device-key.js';
import { ensureTsaKey, getTsaSpki } from './audit-tsa.js';

// SHA-256 of the SPKI bytes, displayed as a short base64url fingerprint.
export async function fingerprintSpki(spkiB64) {
 let bytes;
 if (typeof atob === 'function') {
 const b = atob(spkiB64);
 bytes = new Uint8Array(b.length);
 for (let i = 0; i < b.length; i++) bytes[i] = b.charCodeAt(i);
 } else {
 bytes = new Uint8Array(Buffer.from(spkiB64, 'base64'));
 }
 const hex = await sha256Hex(bytes); // 64-char hex
 const raw = new Uint8Array(32);
 for (let i = 0; i < 32; i++) raw[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
 let b64url;
 if (typeof btoa === 'function') {
 let bin = '';
 for (let i = 0; i < raw.length; i++) bin += String.fromCharCode(raw[i]);
 b64url = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
 } else {
 b64url = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
 }
 return b64url.slice(0, 16);
}

export async function deviceFingerprint() { return fingerprintSpki((await ensureDeviceKey()).spki); }
export async function tsaFingerprint() { const spki = getTsaSpki() || (await ensureTsaKey()).spki; return fingerprintSpki(spki); }

function triggerDownload(filename, text) {
 if (typeof document === 'undefined' || !document.createElement) return;
 const blob = new Blob([text], { type: 'application/octet-stream' });
 const url = URL.createObjectURL(blob);
 const a = document.createElement('a');
 a.href = url; a.download = filename;
 document.body.appendChild(a); a.click();
 setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}

// Export the DEVICE signing public key as device-key-<fingerprint>.pub
export async function exportDevicePub() {
 const kp = await ensureDeviceKey();
 const fp = await deviceFingerprint();
 triggerDownload('device-key-' + fp + '.pub', kp.spki + '\n');
 return { fingerprint: fp, spki: kp.spki };
}
// Export the SEPARATE TSA public key as tsa-key-<fingerprint>.pub
export async function exportTsaPub() {
 const kp = await ensureTsaKey();
 const fp = await tsaFingerprint();
 triggerDownload('tsa-key-' + fp + '.pub', kp.spki + '\n');
 return { fingerprint: fp, spki: kp.spki };
}
