/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
export const HASH_PREFIX = 'sha256:';
export const HASH_ALGORITHMS = ['sha256', 'sha3-256'];
export const HASH_RE = /^(sha256|sha3-256):[0-9a-f]{64}$/;

function webcrypto() {
 const api = globalThis.crypto;
 if (!api || !api.subtle) throw new Error('WebCrypto requires a secure context (localhost or HTTPS)');
 return api;
}

function isHash(value) {
 return typeof value === 'string' && HASH_RE.test(value);
}

function normalizeAlgorithm(algo) {
 return HASH_ALGORITHMS.includes(algo) ? algo : 'sha256';
}

function hashPrefix(algo) {
 return normalizeAlgorithm(algo) === 'sha3-256' ? 'sha3-256:' : 'sha256:';
}

function toHex(buffer) {
 const bytes = new Uint8Array(buffer);
 let out = '';
 for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
 return out;
}

// Real capability probe — NOT a structural check. `typeof subtle.digest === 'function'`
// is true on every runtime, but many of them (Node 18/20 LTS, most browsers, and the
// pkg-packaged binaries) reject the *name* 'SHA3-256' only when digest() is actually
// called, throwing DOMException("Unrecognized algorithm name"). The old implementation
// ended in a tautology (`'SHA3-256' === 'SHA3-256'`) and therefore always claimed
// support, which made C-15 fail on those runtimes. Probe by computing a real digest,
// cache the in-flight promise for the process lifetime, and never leak a raw
// WebCrypto error to callers.
let sha3ProbePromise = null;

export async function sha3Supported() {
 if (!sha3ProbePromise) {
 sha3ProbePromise = (async () => {
 try {
 const api = globalThis.crypto;
 if (!api || !api.subtle || typeof api.subtle.digest !== 'function') return false;
 const probe = await api.subtle.digest('SHA3-256', new Uint8Array(0));
 return !!probe && probe.byteLength === 32;
 } catch (error) {
 return false; // NotSupportedError: "Unrecognized algorithm name"
 }
 })();
 }
 return sha3ProbePromise;
}

// Algorithms actually USABLE in this runtime. HASH_ALGORITHMS remains the set of
// syntactically valid values (needed to parse/verify manifests created elsewhere);
// this is the subset the UI/CLI is allowed to OFFER for new packages. Callers must
// await it before enabling a sha3-256 option.
export async function availableHashAlgorithms() {
 return (await sha3Supported()) ? HASH_ALGORITHMS.slice() : ['sha256'];
}

export async function shaUri(source, algo) {
 let bytes;
 if (typeof source === 'string') bytes = new TextEncoder().encode(source);
 else if (source instanceof ArrayBuffer) bytes = new Uint8Array(source);
 else if (ArrayBuffer.isView(source)) bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
 else if (source instanceof Blob) bytes = new Uint8Array(await source.arrayBuffer());
 else throw new TypeError('unsupported hash input');
 const alg = normalizeAlgorithm(algo);
 let digest;
 if (alg === 'sha3-256') {
 if (!(await sha3Supported())) {
 throw new Error('SHA3-256 is not available in this runtime WebCrypto; use sha256 (see availableHashAlgorithms())');
 }
 digest = await webcrypto().subtle.digest('SHA3-256', bytes);
 } else {
 digest = await webcrypto().subtle.digest('SHA-256', bytes);
 }
 return hashPrefix(alg) + toHex(digest);
}

export async function sha256Uri(source) {
 return shaUri(source, 'sha256');
}

// Plain 64-char lowercase hex digest (no `sha256:` prefix), for `sha256sum -c` manifests.
// Still delegated to WebCrypto through shaUri; no second crypto implementation.
export async function sha256Hex(source) {
 return (await shaUri(source, 'sha256')).slice(HASH_PREFIX.length);
}

// Verify raw bytes against a declared hash. Accepts a `sha256:` / `sha3-256:`-prefixed
// digest — the on-disk manifest format (see evidence-manifest.js `isHash`, which only
// accepts the prefixed form). Delegates to WebCrypto through shaUri; never reimplements
// crypto. Returns false for malformed input instead of throwing, so callers can treat a
// bad digest as "tampered" without special-casing formatting mistakes. This single helper
// replaces the two previously drifted surfaces (`createSha256().update().digest()` and a
// bare `sha256Hex` comparison) that caused BUG-003, where a bare comparison would have
// mismatched the prefixed manifest hash and flagged every file as tampered.
export async function verifyFileHash(bytes, expected) {
 if (typeof expected !== 'string') return false;
 const algo = expected.startsWith('sha3-256:') ? 'sha3-256'
 : expected.startsWith('sha256:') ? 'sha256'
 : null;
 if (!algo) return false;
 const actual = await shaUri(bytes, algo);
 return actual === expected;
}

export { isHash, normalizeAlgorithm, hashPrefix };

/**
 * Canonicalisation MUST be injective for the values a manifest may legitimately carry.
 * Plain JSON.stringify silently DROPS `undefined` object properties, coerces non-finite numbers
 * and array `undefined` slots to `null`, and drops function/symbol values. That creates the exact
 * "strip a field and the digest stays the same" ambiguity. We refuse those values instead.
 *
 * Distinct encodings (verified by C-30): false"false" / 0 / null / [] / absent key.
 * `false` -> false, `"false"` -> "\"false\"", `0` -> 0, `null` -> null, `[]` -> [],
 * absent key -> the key is not emitted at all (and an explicit `undefined` is rejected).
 *
 */
export function canonicalize(value) {
 if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
 throw new TypeError('canonicalJson: unsupported value type (undefined / function / symbol / bigint)');
 }
 if (typeof value === 'number' && !Number.isFinite(value)) {
 throw new TypeError('canonicalJson: non-finite number (NaN / Infinity)');
 }
 if (Array.isArray(value)) return value.map(canonicalize);
 if (value !== null && typeof value === 'object') {
 const out = {};
 for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
 return out;
 }
 return value;
}

export function canonicalJson(value) {
 return JSON.stringify(canonicalize(value));
}

export async function computeRootHash(manifest) {
 const payload = Object.assign({}, manifest);
 delete payload.rootHash;
 return shaUri(canonicalJson(payload), manifest && manifest.hashAlgorithm);
}

export function isoUtcNow() {
 return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function isoLocalNow() {
 const date = new Date();
 const pad = (n) => String(n).padStart(2, '0');
 const offsetMinutes = -date.getTimezoneOffset();
 const sign = offsetMinutes >= 0 ? '+' : '-';
 const absolute = Math.abs(offsetMinutes);
 return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds()) +
 sign + pad(Math.floor(absolute / 60)) + ':' + pad(absolute % 60);
}

export function uuidV4() {
 return webcrypto().randomUUID();
}
