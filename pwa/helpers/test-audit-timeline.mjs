/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Standalone self-test for Task 4 timeline pure logic (no DOM required).
// Run: node pwa/helpers/test-audit-timeline.mjs
import { auditTimelineEvents, timelineStatusOf, timelineColorOf } from './audit-timeline.js';

let failures = 0;
function assert(cond, msg) {
 if (cond) console.log(' ok - ' + msg);
 else { console.log(' FAIL- ' + msg); failures++; }
}

function main() {
 console.log('[audit-timeline]');

 // 1) linear time ordering across auditLog + custodyLog
 const c = {
 auditLog: [
 { eventType: 'SEAL', timestampUtc: '2026-11-13T03:00:00Z', caseStateAfter: 'sealed' },
 { eventType: 'CREATE', timestampUtc: '2026-11-13T01:00:00Z', caseStateAfter: 'draft' }
 ],
 custodyLog: [
 { action: 'collect', actor: 'OP-1', timestampUtc: '2026-11-13T02:00:00Z' }
 ]
 };
 const events = auditTimelineEvents(c);
 const order = events.map((e) => (e.kind === 'custody' ? 'CUSTODY@' + e.raw.timestampUtc : e.raw.eventType + '@' + e.raw.timestampUtc));
 assert(order[0] === 'CREATE@2026-11-13T01:00:00Z', 'first event is CREATE');
 assert(order[1] === 'CUSTODY@2026-11-13T02:00:00Z', 'second event is CUSTODY');
 assert(order[2] === 'SEAL@2026-11-13T03:00:00Z', 'third event is SEAL');

 // 2) corruption / missing fields must not throw
 let safe = true;
 try { auditTimelineEvents({}); auditTimelineEvents(null); auditTimelineEvents({ auditLog: [null, {}, 'x', { eventType: 'X' }] }); }
 catch (e) { safe = false; }
 assert(safe, 'corrupted / missing logs do not throw');
 assert(auditTimelineEvents({}).length === 0, 'empty case yields empty timeline');

 // 3) color mapping
 assert(timelineColorOf(timelineStatusOf({ raw: { caseStateAfter: 'sealed' } })) === 'sealed', 'sealed -> green');
 assert(timelineColorOf('HUMAN_NOTE') === 'note', 'HUMAN_NOTE -> note color');
 assert(timelineColorOf(timelineStatusOf({ kind: 'custody', raw: {} })) === 'custody', 'custody -> accent');
 assert(timelineColorOf('unknown-event') === 'draft', 'unknown -> neutral');

 console.log(failures === 0 ? '\nALL AUDIT-TIMELINE TESTS PASSED' : '\n' + failures + ' AUDIT-TIMELINE TEST(S) FAILED');
 process.exit(failures === 0 ? 0 : 1);
}

main();
