/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Regression: delivery-audit RB-02. Simulate a runtime whose WebCrypto rejects the
// algorithm name 'SHA3-256' (Node 18/20 LTS, most browsers, pkg node18 base). The old
// sha3Supported() was a synchronous tautology, so C-15 crashed with
// "Unrecognized algorithm name" instead of degrading. Here the capability probe must
// detect it, SHA3-256 must be disabled from the offered algorithms, every SHA3 path
// must fail closed with a clear error, and SHA256 must remain fully operational.
import assert from 'node:assert/strict';

const realCrypto = globalThis.crypto;
assert(realCrypto && realCrypto.subtle && typeof realCrypto.subtle.digest === 'function', 'test requires WebCrypto');

const fakeSubtle = {
 digest(name, data) {
 if (String(name).toUpperCase() === 'SHA3-256') return Promise.reject(new Error('Unrecognized algorithm name'));
 return realCrypto.subtle.digest(name, data);
 }
};

Object.defineProperty(globalThis, 'crypto', {
 configurable: true,
 writable: true,
 value: {
 subtle: fakeSubtle,
 randomUUID: () => realCrypto.randomUUID(),
 getRandomValues: (arr) => realCrypto.getRandomValues(arr)
 }
});

const hash = await import('./hash.js');
const caseCore = await import('./case-manifest.js');

assert.equal(await hash.sha3Supported(), false, 'real probe must detect unsupported SHA3-256');
assert.deepEqual(await hash.availableHashAlgorithms(), ['sha256'], 'only sha256 may be offered');
await assert.rejects(() => hash.shaUri('probe', 'sha3-256'), /not available/i, 'shaUri must fail closed');
assert.match(await hash.shaUri('probe', 'sha256'), /^sha256:[0-9a-f]{64}$/, 'sha256 path unaffected');
await assert.rejects(() => caseCore.createCase({ hashAlgorithm: 'sha3-256' }), /not available/i, 'createCase must fail closed');
const c = await caseCore.createCase({});
assert.match(c.rootHash, /^sha256:/, 'default case rootHash still sha256');
assert.match(c.sealHash, /^sha256:/, 'default case sealHash still sha256');

process.stdout.write('FIELDSEAL-TEST-OK sha3-capability (unsupported-WebCrypto branch, 8 checks)\n');
