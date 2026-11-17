/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * Self-test for the read-only audit-log archive agent (no external services). Run:
 *   node test-archive.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppendLog } from './archive-core.mjs';
import { LocalBackend } from './local-backend.mjs';
import { isEvidencePayload, createServer } from './archive-agent.mjs';
import { selfTestSigV4 } from './s3r2.mjs';

let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ok  - ' + msg); }
  else { console.error('  FAIL- ' + msg); failures++; }
}

async function testLocalChain() {
  console.log('[local chain + GDPR redaction]');
  const dir = mkdtempSync(join(tmpdir(), 'fieldseal-archive-'));
  try {
    const log = new AppendLog(new LocalBackend(dir), { salt: 'test-salt' });
    const id1 = await log.append({ rootHash: 'sha256:abc', auditEntry: { event: 'SEAL', actor: 'courtA', operatorId: 'op-123', ts: '2026-01-01' } });
    const id2 = await log.append({ rootHash: 'sha256:abc', auditEntry: { event: 'VERIFY', actor: 'courtB', operatorId: 'op-456', ts: '2026-01-02' } });
    const id3 = await log.append({ rootHash: 'sha256:def', auditEntry: { event: 'EXPORT', actor: 'courtC', ts: '2026-01-03' } });
    const recs = await log.readVerified();
    assert(recs.length === 3, 'three records appended and verified');
    assert(recs[0].prevHash === 'GENESIS', 'first record chains from GENESIS');
    assert(recs[2].prevHash === recs[1].entryHash, 'chain links prev->current');
    assert(recs[0].entry.auditEntry.operatorId.startsWith('blind:'), 'operatorId is blinded (GDPR redaction)');
    assert(recs[2].entry.operatorId === undefined, 'record without operatorId stays clean');
    assert([id1, id2, id3].every(Boolean), 'recordIds returned');
    // Tamper test: rewrite a line and ensure verification throws.
    const { promises: fs } = await import('node:fs');
    const lines = (await fs.readFile(join(dir, 'audit-log.jsonl'), 'utf8')).split('\n').filter(Boolean);
    const tampered = JSON.parse(lines[1]); tampered.entry.auditEntry.actor = 'EVIL';
    lines[1] = JSON.stringify(tampered);
    await fs.writeFile(join(dir, 'audit-log.jsonl'), lines.join('\n') + '\n');
    let threw = false;
    try { await log.readVerified(); } catch (e) { threw = true; }
    assert(threw, 'tampered record breaks the hash chain (detected)');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function testEvidenceGuard() {
  console.log('[evidence-upload guard]');
  assert(isEvidencePayload({ evidencePackage: { name: 'x.zip' } }) === true, 'rejects evidencePackage key');
  const big = 'x'.repeat(9000);
  assert(isEvidencePayload({ note: big }) === true, 'rejects oversized string field');
  assert(isEvidencePayload({ auditEntry: { event: 'SEAL' }, rootHash: 'sha256:1' }) === false, 'accepts a normal audit record');
  assert(isEvidencePayload([{ files: ['a'] }]) === true, 'rejects array containing evidence key');
}

async function testHttpRoundTrip() {
  console.log('[http agent round-trip]');
  const dir = mkdtempSync(join(tmpdir(), 'fieldseal-archive-http-'));
  const log = new AppendLog(new LocalBackend(dir), { salt: 'httptest' });
  log.backend.updateIndexSafe = async () => { if (typeof log.backend.updateIndex === 'function') await log.backend.updateIndex(await log.readVerified().catch(() => [])); };
  const server = createServer({ log, maxBodyBytes: 65536 });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const base = 'http://localhost:' + port;
  try {
    let res = await fetch(base + '/health'); assert(res.ok, 'health endpoint ok');
    res = await fetch(base + '/archive', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rootHash: 'sha256:aaa', auditEntry: { event: 'SEAL', actor: 'a1' } }) });
    let j = await res.json(); assert(res.status === 201 && j.ok && j.accepted === 1, 'POST single entry accepted');
    res = await fetch(base + '/archive', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entries: [ { rootHash: 'sha256:bbb', auditEntry: { event: 'VERIFY', actor: 'a2' } }, { rootHash: 'sha256:bbb', auditEntry: { event: 'EXPORT', actor: 'a3' } } ] }) });
    j = await res.json(); assert(j.accepted === 2, 'POST batch of two accepted');
    res = await fetch(base + '/archive'); j = await res.json(); assert(j.count === 3, 'GET /archive returns 3 verified records');
    res = await fetch(base + '/archive', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ evidencePackage: { name: 'case.zip', size: 12345 } }) });
    j = await res.json(); assert(res.status === 403 && !j.ok, 'evidence upload rejected with 403');
  } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
}

function testSigV4() {
  console.log('[sigv4 self-test]');
  let ok = false;
  try { selfTestSigV4(); ok = true; } catch (e) { console.error('   ' + e.message); }
  assert(ok, 'SigV4 signer matches AWS published test vector');
}

(async () => {
  testEvidenceGuard();
  await testLocalChain();
  await testHttpRoundTrip();
  testSigV4();
  console.log(failures === 0 ? '\nALL ARCHIVE TESTS PASSED' : '\n' + failures + ' ARCHIVE TEST(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})();
