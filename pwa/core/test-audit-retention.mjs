/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// A6 real test: audit-log retention (365d default) deletion is detectable, and a tampered
// external anchor raises a recorded anchor-mismatch alert on boot. Runs in Node (local-audit-log
// falls back to an in-memory store when IndexedDB is unavailable, so no browser is needed).
// Run: node pwa/core/test-audit-retention.mjs
import {
 clearLog, setRetentionDays, addEvent, runRetentionSweep, checkChainOnBoot,
 getLastAnchorAlert, getAnchorStore, commitAnchor
} from '../helpers/local-audit-log.js';

const ANCHOR_KEY = 'fieldseal-audit-anchor';
let failures = 0;
function assert(cond, msg) { if (cond) console.log(' ok - ' + msg); else { console.log(' FAIL- ' + msg); failures++; } }

const REAL_NOW = Date.now;

async function main() {
 console.log('[audit-retention]');

 // 1) Retention deletion is DETECTABLE. Set a 1-day window, add entries at "now", then advance
 // the clock 2 days and sweep — every entry must be pruned and the count returned.
 clearLog();
 setRetentionDays(1);
 for (let i = 0; i < 5; i++) addEvent({ eventType: 'test.evt', action: 'test', packageId: 'pkg-' + i });
 const virtual = REAL_NOW() + 2 * 24 * 60 * 60 * 1000;
 Date.now = () => virtual;
 const removed = runRetentionSweep();
 Date.now = REAL_NOW;
 assert(removed === 5, 'retention sweep removed all 5 stale entries (detectable deletion), got ' + removed);
 assert(removed > 0, 'retention sweep returns a real deletion count (>0)');

 // 2) A VALID anchor on a fresh/empty trail must NOT raise a false anchor alert.
 // (clearLog changes the chain head, so we commit a fresh anchor that matches the empty head.)
 clearLog();
 await commitAnchor();
 await checkChainOnBoot();
 assert(getLastAnchorAlert() === null, 'valid anchor on fresh trail raises no false alert');

 // 3) A TAMPERED external anchor MUST raise a recorded alert on boot (anti-forensic / ).
 // Corrupt the stored anchor's signature and re-verify.
 const store = await getAnchorStore();
 const raw = await store.get(ANCHOR_KEY);
 assert(raw != null, 'anchor committed to separate store');
 const anchorObj = JSON.parse(raw);
 if (anchorObj && anchorObj.signature && anchorObj.signature.length) {
 anchorObj.signature = 'AA' + anchorObj.signature.slice(2); // flip so signature verification fails
 } else { anchorObj.tampered = true; }
 await store.set(ANCHOR_KEY, JSON.stringify(anchorObj));
 await checkChainOnBoot();
 const alert = getLastAnchorAlert();
 assert(alert !== null, 'tampered anchor raises a recorded anchor-mismatch alert');
 assert(alert && alert.ok === false, 'anchor alert marked not-ok');

 console.log(failures === 0 ? '\nRETENTION-AUDIT: PASS' : '\n' + failures + ' RETENTION-AUDIT TEST(S) FAILED');
 process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
