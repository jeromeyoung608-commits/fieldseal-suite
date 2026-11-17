/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Regression: local operation trail (delivery audit A1..A4 / A6, RH-04).
// Default-on, six-question fields, SHA-256 hash chain tamper detection,
// GDPR erasure linkage and retention pruning. Zero dependencies, Node built-ins only.
import assert from 'node:assert/strict';

globalThis.__fieldsealMemStore = new Map();
const log = await import('../helpers/local-audit-log.js');
const KEY = 'fieldseal-local-audit-log';
const store = globalThis.__fieldsealMemStore;

function raw() { return JSON.parse(store.get(KEY) || '[]'); }
function put(arr) { store.set(KEY, JSON.stringify(arr)); }

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }

// A1 — default ON on a fresh profile (the audit found it defaulted to '0').
ok(log.isLogEnabled() === true, 'A1 logging is enabled by default');
log.setRetentionMaxAge(0); // keep this test's timeline deterministic
log.clearLog();

// A2 — every entry answers who / when / what / on what / authorised / from where.
log.addEvent({ eventType: 'import-evidence', packageId: 'case-A', actor: { name: 'Alice', id: 'op-1' } });
const first = log.getLog()[0];
ok(first.v === 2 && first.eventType === 'import-evidence', 'A2 eventType captured');
ok(/^\d{4}-\d{2}-\d{2}T/.test(first.timestamp), 'A2 when captured');
ok(first.action === 'import-evidence' && first.target.id === 'case-A', 'A2 what + on-what captured');
ok(first.actor.name === 'Alice', 'A2 who captured');
ok(first.authz === 'allowed', 'A2 authorisation captured');
ok(first.source && typeof first.source.origin === 'string' && typeof first.source.ua === 'string', 'A2 source captured');

// A3 — hash chain seals and verifies.
let health = await log.verifyChain();
ok(health.ok === true && health.count === 1, 'A3 fresh chain verifies');
ok(/^[0-9a-f]{64}$/.test(log.getLog()[0].hash), 'A3 entry carries a SHA-256 seal');
ok(log.getLog()[0].prevHash === '0'.repeat(64), 'A3 first link anchored at genesis');

log.addEvent({ eventType: 'seal', packageId: 'case-A', actor: { name: 'Alice', id: 'op-1' } });
log.addEvent({ eventType: 'export-certificate', packageId: 'case-B', actor: { name: 'Bob', id: 'op-2' } });
health = await log.verifyChain();
ok(health.ok === true && health.count === 3, 'A3 three-link chain verifies');
ok(log.getLog()[1].prevHash === log.getLog()[0].hash, 'A3 prevHash links to previous seal');

// A3 — naive tampering of a stored entry is detected.
const tampered = raw();
tampered[1].action = 'never-happened';
put(tampered);
health = await log.verifyChain();
ok(health.ok === false && health.reason === 'tampered entry' && health.index === 1, 'A3 edited entry detected');

// A3 — deletion of an entry breaks the chain.
const shortened = raw();
shortened.splice(1, 1);
put(shortened);
health = await log.verifyChain();
ok(health.ok === false, 'A3 deleted entry detected');

// A4 — erasure linkage removes / redacts entries tied to a deleted case, then re-anchors.
log.clearLog();
log.addEvent({ eventType: 'import-evidence', packageId: 'case-A', actor: { name: 'Alice', id: 'op-1' } });
log.addEvent({ eventType: 'import-evidence', packageId: 'case-B', actor: { name: 'Bob', id: 'op-2' } });
log.addEvent({ eventType: 'review', packageId: 'case-C', actor: { name: 'Alice', id: 'op-1' } });
await log.verifyChain();
const removed = log.purgeActorFromLogs(['case-A', 'op-1']);
ok(removed >= 2, 'A4 linked entries removed / actor redacted');
ok(!log.getLog().some((e) => e.packageId === 'case-A'), 'A4 deleted case absent from trail');
ok(log.getLog().some((e) => e.actor && e.actor.name === 'REDACTED'), 'A4 surviving actor redacted');
health = await log.verifyChain();
ok(health.ok === true, 'A4 chain re-anchored after erasure');

// GDPR redaction must not destroy integrity evidence.
log.setGdprEnabled(true);
log.addEvent({ eventType: 'export-certificate', packageId: 'case-B', actor: { name: 'Bob', id: 'op-2' } });
const red = log.getLog().slice(-1)[0];
ok(red.redacted === true && red.tzIana === undefined && red.toolVersion === undefined, 'GDPR env fields dropped');
health = await log.verifyChain();
ok(health.ok === true, 'GDPR-redacted entries stay verifiable');
log.setGdprEnabled(false);

// A6 — retention pruning leaves a valid chain.
log.setRetentionMaxAge(1000);
log.addEvent({ eventType: 'fresh', packageId: 'case-D' });
put([{ eventType: 'old', packageId: 'case-E', timestamp: new Date(Date.now() - 100000).toISOString() }, ...raw()]);
const purged = log.pruneExpired();
ok(purged === 1, 'A6 expired entry pruned');
health = await log.verifyChain();
ok(health.ok === true, 'A6 chain re-anchored after pruning');
log.setRetentionMaxAge(0);
log.stopRetentionTimer();

process.stdout.write('FIELDSEAL-TEST-OK audit-chain (' + checks + ' checks)\n');
