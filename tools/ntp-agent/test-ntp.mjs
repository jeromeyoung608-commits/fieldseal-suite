/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * Self-test for the NTP reference-time agent (P1 #2). Run:  node test-ntp.mjs
 *
 * Tests 1 (live NTP) is network-dependent: if the sandbox has no UDP egress to pool.ntp.org the
 * happy-path is SKIPPED (not failed) so the suite stays green offline. Tests 2-6 are deterministic
 * and must always pass.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { queryNtp, queryNtpBatch, parseTransmitTimestamp, ntpToUnixMs, mergeReferenceTime } from './ntp-client.mjs';
import { createServer } from './ntp-proxy.mjs';

let failures = 0;
let skips = 0;
function assert(cond, msg) {
  if (cond) console.log('  ok  - ' + msg);
  else { console.error('  FAIL- ' + msg); failures++; }
}
function skip(msg) { skips++; console.log('  skip- ' + msg); }

function testLiveNtp() {
  // Network-dependent; degrades to SKIP when offline.
  return (async () => {
    console.log('[1] live NTP query (network-dependent)');
    const r = await queryNtp({ server: 'pool.ntp.org', timeoutMs: 3000 });
    if (r.status === 'ok') {
      assert(r.ntpServer === 'pool.ntp.org', 'ntpServer echoed');
      assert(typeof r.referenceNtpTime === 'string' && r.referenceNtpTime.endsWith('Z'), 'referenceNtpTime is ISO UTC');
      assert(typeof r.driftMs === 'number' && Number.isFinite(r.driftMs), 'driftMs is a finite number');
      assert(Math.abs(r.driftMs) < 600000, 'drift within sane bounds (<10 min)');
      assert(r.localSystemTime.endsWith('Z'), 'localSystemTime is ISO UTC');
    } else {
      skip('no UDP egress to pool.ntp.org (status=' + r.status + '); live happy-path skipped');
    }
  })();
}

async function testTimeout() {
  console.log('[2] blocked / unreachable query degrades gracefully');
  const t = await queryNtp({ server: '192.0.2.1', timeoutMs: 600 }); // TEST-NET-1: non-routable
  assert(t.status === 'timeout' || t.status === 'invalid', 'resolves without throwing (status=' + t.status + ')');
  assert(t.referenceNtpTime === null, 'no reference time on failure');
  assert(typeof t.localSystemTime === 'string', 'localSystemTime still reported');
}

function testMalformed() {
  console.log('[3] malformed / wrong-mode NTP packets rejected');
  let shortThrew = false;
  try { parseTransmitTimestamp(Buffer.alloc(10)); } catch (e) { shortThrew = true; }
  assert(shortThrew, 'short buffer rejected as malformed');

  // Valid 48-byte response, server mode (VN=3, Mode=4 => 0x1C), transmit sec=3900000000.
  const good = Buffer.alloc(48);
  good[0] = 0x1c;
  good.writeUInt32BE(3900000000, 40);
  good.writeUInt32BE(0, 44);
  let parsed = null, parseOk = true;
  try { parsed = parseTransmitTimestamp(good); } catch (e) { parseOk = false; }
  assert(parseOk && parsed.sec === 3900000000, 'valid server packet parsed');
  const ms = ntpToUnixMs(parsed);
  assert(Math.abs(ms - (3900000000 - 2208988800) * 1000) < 1, 'ntpToUnixMs converts correctly');

  // Client-mode (Mode=3 => 0x1B) response must be rejected.
  const client = Buffer.alloc(48); client[0] = 0x1b;
  let clientThrew = false;
  try { parseTransmitTimestamp(client); } catch (e) { clientThrew = true; }
  assert(clientThrew, 'non-server mode (3) rejected');
}

function testMergeNonOverride() {
  console.log('[4] referenceNtpTime never overrides native log time fields');
  const entry = { createdAt: '2026-11-13T10:00:00Z', sealedAt: '2026-11-13T10:05:00Z', actor: 'court' };
  const ntp = { ntpServer: 'pool.ntp.org', referenceNtpTime: '2026-11-13T10:00:01Z', localSystemTime: '2026-11-13T10:00:02Z', driftMs: -1000, queryAt: '2026-11-13T10:00:02Z', status: 'ok' };
  const merged = mergeReferenceTime(entry, ntp);
  assert(merged.createdAt === '2026-11-13T10:00:00Z', 'createdAt preserved');
  assert(merged.sealedAt === '2026-11-13T10:05:00Z', 'sealedAt preserved');
  assert(merged.actor === 'court', 'actor preserved');
  assert(merged.referenceNtpTime === ntp, 'referenceNtpTime added as separate field');
  assert(entry.createdAt === '2026-11-13T10:00:00Z', 'original entry object NOT mutated');
}

async function testProxy() {
  console.log('[5] HTTP proxy round-trip (offline-safe)');
  const dir = mkdtempSync(join(tmpdir(), 'fieldseal-ntp-'));
  const server = createServer({ defaultServer: '192.0.2.1', timeoutMs: 400 });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const base = 'http://localhost:' + port;
  try {
    let res = await fetch(base + '/health');
    let j = await res.json();
    assert(res.ok && j.referenceOnly === true, 'health ok + referenceOnly flag');

    res = await fetch(base + '/ntp?server=192.0.2.1');
    j = await res.json();
    assert(res.ok && ['timeout', 'invalid'].includes(j.status), '/ntp resolves gracefully (status=' + j.status + ')');
    assert(j.ntpServer === '192.0.2.1', '/ntp echoes requested server');
    assert('referenceNtpTime' in j && 'driftMs' in j && 'queryAt' in j, '/ntp returns full structure');

    res = await fetch(base + '/ntp/batch?server=192.0.2.1&server=10.255.255.1');
    j = await res.json();
    assert(res.ok && Array.isArray(j.results) && j.results.length === 2, '/ntp/batch returns two results');

    const direct = await queryNtpBatch(['192.0.2.1', '10.255.255.1'], { timeoutMs: 400 });
    assert(Array.isArray(direct) && direct.length === 2, 'queryNtpBatch returns an array of results');
  } finally {
    server.close();
  }
  // No disk writes happen; remove the temp dir only if it was somehow created.
  try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

(async () => {
  await testLiveNtp();
  await testTimeout();
  testMalformed();
  testMergeNonOverride();
  await testProxy();
  console.log(failures === 0 ? '\nALL NTP TESTS PASSED' + (skips ? ' (skips=' + skips + ')' : '') : '\n' + failures + ' NTP TEST(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})();
