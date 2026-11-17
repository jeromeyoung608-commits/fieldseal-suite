/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * Standalone self-test for pwa/export/ase-export.js (not part of the 136 regression runner).
 * Run: node pwa/export/test-ase-export.mjs
 */
import {
 buildAseExportHtml, buildAseDisclaimerHtml, buildExhibitIndexHtml,
 buildBaseCsv, buildAseExtendedCsv, ASE_DISCLAIMER_EN
} from './ase-export.js';

let failures = 0;
function assert(cond, msg) {
 if (cond) console.log(' ok - ' + msg);
 else { console.error(' FAIL- ' + msg); failures++; }
}

const manifest = {
 spec: 'fieldseal-case-v0.5', packageId: 'CASE-ASE-1', state: 'sealed',
 createdAt: '2026-11-13T04:00:00Z', sealedAt: '2026-11-13T04:36:42Z',
 rootHash: 'sha256:abc', sealHash: 'sha256:def', caseMeta: { title: 'ASE demo', jurisdiction: 'US-FRE' },
 caseEncryptionMeta: { algorithm: 'AES-GCM-256', kdf: 'PBKDF2-SHA256' },
 children: [
 { evidenceId: 'e1', packageId: 'EV-1', rootHash: 'sha256:111', capturedUtc: '2026-11-13T03:00:00Z',
 referenceNtpTime: '2026-11-13T03:00:01Z', capturedDeviceUA: 'FieldSeal/1.0', note: '', ianaTz: 'Europe/Berlin' },
 { evidenceId: 'e2', packageId: 'EV-2', rootHash: 'sha256:222', capturedUtc: '2026-11-13T03:05:00Z', ianaTz: 'UTC' }
 ],
 countersignList: [{ actorName: 'Counsel A', decision: 'concur' }, { actorName: 'Lead B', decision: 'concur' }]
};

const exhibitIndex = { rows: [
 { exhibitNo: 'EXH-00001', casePackageId: 'CASE-ASE-1', caseTitle: 'ASE demo', evidencePackageId: 'EV-1',
 evidenceTitle: 'photo', capturedUtc: '2026-11-13T03:00:00Z', ntpReferenceTime: '2026-11-13T03:00:01Z',
 hashDigest: 'sha256:111', fileSize: 128, status: 'ok', note: '' }
] };

console.log('[ase-export]');
const html = buildAseExportHtml(manifest, exhibitIndex, { caseLabel: 'ASE demo' });
assert(html.includes('<!doctype html>'), 'produces a standalone HTML document');
assert(html.includes('auxiliary audit aid') && !html.includes('<strong>DE</strong>'), 'pinned English-only disclaimer present');
assert(html.includes('CASE-ASE-1') && html.includes('sha256:def'), 'case id + sealHash rendered read-only');
assert(html.includes('print-export.css'), 'links the dedicated print stylesheet');
assert(html.includes('class="toolbar no-print"'), 'toolbar marked no-print (hidden on paper)');
assert(html.includes('EXH-00001'), 'Exhibit index rendered');

const draftHtml = buildAseExportHtml({ packageId: 'X', state: 'draft', sealHash: 's', rootHash: 'r' }, exhibitIndex);
assert(draftHtml.includes('DRAFT ONLY'), 'draft case shows non-certified banner');

const emptyHtml = buildAseExportHtml(null, null);
assert(emptyHtml.includes('<!doctype html>'), 'null manifest does not crash (graceful)');

console.log('[exhibit index html]');
const exHtml = buildExhibitIndexHtml(exhibitIndex);
assert(exHtml.includes('EXH-00001') && exHtml.includes('sha256:111'), 'exhibit index table built');
assert(buildExhibitIndexHtml({}).includes(''), 'missing index handled gracefully');

console.log('[base csv]');
const base = buildBaseCsv(manifest);
assert(base.split('\r\n')[0].startsWith('record_utc'), 'base CSV uses canonical ledger header');
assert(!/https?:\/\//.test(base), 'base CSV has no remote URLs');

console.log('[extended csv]');
const ext = buildAseExtendedCsv(manifest);
const extHeader = ext.split('\r\n')[0];
['ntp_reference_time', 'clock_drift', 'device_ua', 'capture_timezone', 'note', 'encryption_flag', 'countersign_list'].forEach((h) =>
 assert(extHeader.includes(h), 'extended CSV has field: ' + h));
assert(ext.includes('2026-11-13T03:00:01Z'), 'extended CSV carries NTP reference time from manifest');
assert(ext.includes('yes'), 'encryption_flag = yes when caseEncryptionMeta present');
assert(ext.includes('Counsel A|Lead B'), 'countersign list read from manifest');
assert(!/https?:\/\//.test(ext), 'extended CSV has no remote URLs');

console.log(failures === 0 ? '\nALL ASE-EXPORT TESTS PASSED' : '\n' + failures + ' ASE-EXPORT TEST(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
