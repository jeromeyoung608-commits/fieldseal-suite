/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');

// Supported hash algorithms. File content hashes keep the canonical `sha256:`
// prefix (C1); `hashAlgorithm` only selects the digest used to bind the
// manifest into `rootHash`. Both prefixes are accepted by isHash.
const HASH_ALGORITHMS = ['sha256', 'sha3-256'];
const HASH_PREFIX = 'sha256:';
const HASH_RE = /^(sha256|sha3-256):[0-9a-f]{64}$/;
const CHUNK_SIZE = 64 * 1024;

function isHash(value) {
  return typeof value === 'string' && HASH_RE.test(value);
}

function normalizeAlgorithm(algo) {
  return HASH_ALGORITHMS.includes(algo) ? algo : 'sha256';
}

function hashPrefix(algo) {
  return normalizeAlgorithm(algo) === 'sha3-256' ? 'sha3-256:' : 'sha256:';
}

function createHasher(algo) {
  const h = crypto.createHash(normalizeAlgorithm(algo));
  return {
    update(buf) { h.update(buf); return this; },
    digest() { return hashPrefix(algo) + h.digest('hex'); }
  };
}

function createSha256() {
  return createHasher('sha256');
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256Uri(buffer) {
  return HASH_PREFIX + sha256Hex(buffer);
}

function shaUri(buffer, algo) {
  return createHasher(algo).update(buffer).digest();
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

// Additive, NON-trust metadata keys (v0.5+). DELIBERATELY excluded from rootHash so they can never
// become a trust root and never alter verification / tamper detection. Mirrors pwa/core/case-manifest.js
// so the two trusted kernels stay byte-identical. v0.2..v0.5 packages lack these keys → no-op.
const ADDITIVE_NON_HASH_KEYS = ['operatorIdentity', 'humanNotes', 'envSnapshot', 'tsaTimestamps'];

function computeRootHash(manifest) {
  const payload = Object.assign({}, manifest);
  delete payload.rootHash;
  if (payload.caseMeta && typeof payload.caseMeta === 'object') {
    for (const k of ADDITIVE_NON_HASH_KEYS) delete payload.caseMeta[k];
  }
  const algo = normalizeAlgorithm(manifest && manifest.hashAlgorithm);
  return shaUri(Buffer.from(canonicalJson(payload), 'utf8'), algo);
}

async function hashFile(filePath, algo) {
  const sink = createHasher(algo || 'sha256');
  for await (const chunk of fs.createReadStream(filePath, { highWaterMark: CHUNK_SIZE })) sink.update(chunk);
  return sink.digest();
}

function isoUtcNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function uuidV4() {
  return crypto.randomUUID();
}

module.exports = {
  HASH_PREFIX, HASH_RE, CHUNK_SIZE, HASH_ALGORITHMS,
  isHash, normalizeAlgorithm, hashPrefix,
  createSha256, createHasher, sha256Hex, sha256Uri, shaUri,
  canonicalize, canonicalJson, computeRootHash,
  hashFile, isoUtcNow, uuidV4
};
