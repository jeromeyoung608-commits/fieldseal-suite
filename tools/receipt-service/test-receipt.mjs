/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * Self-test for the receipt service. Run:  node test-receipt.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { issueReceipt, verifyReceipt, isEvidencePayload, signReceipt, RECEIPT_KIND } from './receipt-core.mjs';
import { createServer } from './receipt-agent.mjs';

let failures = 0;
function assert(c, m) { if (c) console.log('  ok  - ' + m); else { console.error('  FAIL- ' + m); failures++; } }

function testCore() {
  console.log('[receipt core]');
  const secret = 'test-secret';
  const r = issueReceipt({ rootHash: 'sha256:abc', sealHash: 'sha256:def', metadata: { caseId: 'C1', actor: 'court', operatorId: 'op-9' } }, { secret });
  assert(r.kind === RECEIPT_KIND, 'receipt kind marked RECEIPT_NOT_EVIDENCE');
  assert(!!r.signature && r.signature.length === 64, 'receipt is HMAC-SHA256 signed');
  assert(r.metadata.operatorId.startsWith('blind:'), 'operatorId blinded in metadata');
  assert(r.metadata.caseId.startsWith('blind:'), 'caseId blinded in metadata');
  assert(verifyReceipt(r, secret) === true, 'verifyReceipt true for valid receipt');
  const tampered = JSON.parse(JSON.stringify(r)); tampered.receivedUtc = '2099-01-01T00:00:00Z';
  assert(verifyReceipt(tampered, secret) === false, 'verifyReceipt false after tamper');
  assert(verifyReceipt(r, 'wrong-secret') === false, 'verifyReceipt false with wrong secret');
  assert(signReceipt(r, secret).length === 64, 'signReceipt deterministic');
  assert(isEvidencePayload({ evidencePackage: {} }) === true, 'evidence payload rejected by guard');
  assert(isEvidencePayload({ rootHash: 'x'.repeat(9000) }) === true, 'oversized field rejected by guard');
}

async function testHttp() {
  console.log('[receipt http]');
  const dir = mkdtempSync(join(tmpdir(), 'fieldseal-receipt-'));
  const server = createServer({ secret: 's3cr3t', dir });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const base = 'http://localhost:' + port;
  // The service requires a Bearer token (the signing secret) on every route
  // except /health. Send it on each request and assert the unauthenticated
  // path is rejected as well.
  const auth = { authorization: 'Bearer s3cr3t' };
  const json = { 'content-type': 'application/json' };
  try {
    let res = await fetch(base + '/health'); assert(res.ok, 'health ok');
    res = await fetch(base + '/receipt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rootHash: 'sha256:aaa' }) });
    assert(res.status === 401, 'POST without bearer token rejected with 401');
    res = await fetch(base + '/receipt', { method: 'POST', headers: { ...json, ...auth }, body: JSON.stringify({ rootHash: 'sha256:aaa', sealHash: 'sha256:bbb', metadata: { caseId: 'C2', actor: 'a' } }) });
    let j = await res.json();
    assert(res.status === 201 && j.ok && j.receipt.signature, 'POST receipt accepted + signed');
    const id = j.receipt.receiptId;
    res = await fetch(base + '/receipt/' + id, { headers: auth }); j = await res.json();
    assert(j.ok && j.verified === true, 'GET receipt returns verified receipt');
    res = await fetch(base + '/receipt', { method: 'POST', headers: { ...json, ...auth }, body: JSON.stringify({ evidencePackage: { name: 'case.zip' } }) });
    j = await res.json(); assert(res.status === 403 && !j.ok, 'evidence upload rejected with 403');
    res = await fetch(base + '/receipt', { method: 'POST', headers: { ...json, ...auth }, body: JSON.stringify({ metadata: { x: 'y' } }) });
    j = await res.json(); assert(res.status === 400, 'missing rootHash/sealHash rejected');
  } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
}

(async () => {
  testCore();
  await testHttp();
  console.log(failures === 0 ? '\nALL RECEIPT TESTS PASSED' : '\n' + failures + ' RECEIPT TEST(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})();
