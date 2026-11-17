/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
import { buildCaseLedgerCsv, redactPii } from '../helpers/case-export.js';
// Single source of truth for the attribution line (version + copyright + licence + ownership).
// A local hard-coded copy could drift from the page footers and the sealed golden artefact.
import { ATTRIBUTION_LINE } from '../helpers/attribution.js';

// --- pinned jurisdiction / trust disclaimer (English only) -----------------------------------
// Fixed in the export page AND the print PDF as a prominent block. Advisory only; never legal advice.
export const ASE_DISCLAIMER_EN =
 'This export report is an auxiliary audit aid only. The trust baseline is the case\'s native ' +
 'sealHash, which must be independently verified with the zero-dependency CLI (`case verify`). ' +
 'Forensic regulations differ across jurisdictions; this report constitutes no legal guarantee ' +
 'of admissibility and is not a qualified electronic signature under eIDAS.';





function escapeHtml(value) {
 return String(value === undefined || value === null ? '' : value)
 .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// CSV formula-injection guard: neutralise leading = + - @ (see case-export.js).
function csvCell(value) {
 let text = String(value === undefined || value === null ? '' : value).replace(/\r?\n/g, ' ');
 if (/^\s*[=+\-@]/.test(text)) text = "'" + text;
 return /[",]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}
/** Prominent pinned English disclaimer block (pure HTML string). */
export function buildAseDisclaimerHtml() { return '<section class="disclaimer no-break">'
 + '<h2>Disclaimer</h2>'
 + '<p><strong>EN</strong> ' + escapeHtml(ASE_DISCLAIMER_EN) + '</p>'
 + '</section>';
}

/**
 * Render the Exhibit index (produced by tools/exhibit-batch-export) into an HTML table.
 * `exhibitIndex` = { rows: [ { exhibitNo, casePackageId, caseTitle, evidencePackageId, evidenceTitle,
 * capturedUtc, ntpReferenceTime, hashDigest, fileSize, status, note } ] }. Tolerant of missing fields.
 *
 */
export function buildExhibitIndexHtml(exhibitIndex) {
 const rows = (exhibitIndex && Array.isArray(exhibitIndex.rows) ? exhibitIndex.rows : []);
 const head = ['Exhibit No', 'Case ID', 'Case Title', 'Evidence ID', 'Evidence Title',
 'Captured UTC', 'NTP Ref', 'Hash', 'Size', 'Status', 'Note'];
 const body = rows.map((r) => '<tr>'
 + ['exhibitNo', 'casePackageId', 'caseTitle', 'evidencePackageId', 'evidenceTitle',
 'capturedUtc', 'ntpReferenceTime', 'hashDigest', 'fileSize', 'status', 'note']
 .map((k) => '<td class="mono">' + escapeHtml(r[k]) + '</td>').join('') + '</tr>').join('\n')
 || '<tr><td colspan="11" class="note">No Exhibit index rows supplied / td>< / tr>';
 return '<table><thead><tr>' + head.map((h) => '<th>' + escapeHtml(h) + '</th>').join('') + '</tr></thead>'
 + '<tbody>' + body + '</tbody></table>';
}

/** Base CSV = the canonical case ledger (frozen v0.2 header), reused verbatim. Display/transport only. */
export function buildBaseCsv(manifest, opts) {
 return buildCaseLedgerCsv(manifest, opts);
}

/**
 * Extended audit CSV — adds audit fields read ONLY from the manifest (no computed fields, no new hash
 * rules). Per capture row (+ one case row). Fields: NTP ref, clock drift, device UA, capture timezone,
 * note, encryption flag, countersign list. Missing manifest fields render as empty cells.
 *
 */
export function buildAseExtendedCsv(manifest, opts) {
 const c = (opts && opts.redact) ? redactPii(manifest, opts.redact) : (manifest || {});
 // Extended audit fields read ONLY from the manifest (no computed fields, no new hash rules).
 // operatorIdentity is additive, NON-trust metadata (excluded from rootHash/sealHash) — surfaced here
 // for audit context only; it is never part of the trust root.
 const header = ['record_utc', 'record_type', 'evidence_item_id', 'item_hash', 'ntp_reference_time',
 'clock_drift', 'device_ua', 'capture_timezone', 'note', 'encryption_flag', 'countersign_list',
 'op_operator_id', 'op_full_name', 'op_badge_id', 'op_org', 'op_role', 'op_contact_ref', 'op_signature_fp',
 'note_type', 'note_author',
 'env_user_agent', 'env_language', 'env_timezone', 'env_screen', 'env_online', 'env_capture_url',
 'tsa_status', 'tsa_gen_time', 'seal_hash'];
 const oi = (c.caseMeta && c.caseMeta.operatorIdentity) || {};
 const es = (c.caseMeta && c.caseMeta.envSnapshot) || {};
 const tss = (c.caseMeta && c.caseMeta.tsaTimestamps) || [];
 const latestTsa = (tss.filter((x) => x.status === 'fetched').slice(-1)[0]) || {};
 const ua = (c.caseMeta && c.caseMeta.deviceUserAgent) || '';
 const encryptionFlag = c.caseEncryptionMeta ? 'yes' : 'no';
 const countersignList = (c.countersignList || []).map((x) => (x.actorName || '')).filter(Boolean).join('|');
 const seal = c.sealHash || '';
 const rows = [header.join(',')];
 const push = (cells) => rows.push(header.map((h) => csvCell(cells[h] === undefined ? '' : cells[h])).join(','));

 push(Object.assign({
 record_utc: c.createdAt || '', record_type: 'CaseCreated', evidence_item_id: '',
 item_hash: '', ntp_reference_time: '', clock_drift: '', device_ua: ua,
 capture_timezone: '', note: '', encryption_flag: encryptionFlag,
 countersign_list: countersignList,
 op_operator_id: oi.operatorId || '', op_full_name: oi.fullName || '', op_badge_id: oi.badgeId || '',
 op_org: oi.org || '', op_role: oi.role || '', op_contact_ref: oi.contactRef || '', op_signature_fp: oi.signatureFingerprint || '',
 note_type: '', note_author: '',
 env_user_agent: es.userAgent || '', env_language: es.language || '', env_timezone: es.timezone || '',
 env_screen: (es.screenWidth && es.screenHeight) ? (es.screenWidth + 'x' + es.screenHeight) : '',
 env_online: es.online || '', env_capture_url: es.capturePageUrl || '',
 tsa_status: latestTsa.status || '', tsa_gen_time: latestTsa.genTime || '', seal_hash: seal
 }));
 for (const ch of c.children || []) {
 push({
 record_utc: ch.capturedUtc || '', record_type: 'Capture',
 evidence_item_id: ch.evidenceId || ch.packageId || '', item_hash: ch.rootHash || '',
 ntp_reference_time: ch.referenceNtpTime || '',
 clock_drift: ch.deviceClockDrift || '',
 device_ua: ch.capturedDeviceUA || ua,
 capture_timezone: ch.capturedIanaTz || ch.ianaTz || '',
 note: ch.note || '', encryption_flag: encryptionFlag,
 countersign_list: countersignList,
 op_operator_id: oi.operatorId || '', op_full_name: oi.fullName || '', op_badge_id: oi.badgeId || '',
 op_org: oi.org || '', op_role: oi.role || '', op_contact_ref: oi.contactRef || '', op_signature_fp: oi.signatureFingerprint || '',
 note_type: '', note_author: '', seal_hash: seal
 });
 }
 // humanNotes (additive, non-trust, caseMeta.humanNotes) — full list surfaced for audit context only.
 for (const n of (c.caseMeta && c.caseMeta.humanNotes) || []) {
 push({
 record_utc: n.createdAt || '', record_type: 'HumanNote',
 evidence_item_id: '', item_hash: '',
 ntp_reference_time: '', clock_drift: '', device_ua: '', capture_timezone: '',
 note: n.content || '', encryption_flag: '', countersign_list: '',
 op_operator_id: '', op_full_name: '', op_badge_id: '', op_org: '', op_role: '', op_contact_ref: '', op_signature_fp: '',
 note_type: n.noteType || '', note_author: n.authorOperatorId || '', seal_hash: seal
 });
 }
 rows.push('# ' + ATTRIBUTION_LINE);
 return rows.join('\r\n') + '\r\n';
}

function csvToTableHtml(csv) {
 const lines = csv.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.length && !l.startsWith('#'));
 if (!lines.length) return '<p class="note">empty</p>';
 const cells = (line) => line.split(',').map((x) => x.replace(/^"|"$/g, '').replace(/""/g, '"'));
 const head = cells(lines[0]).map((h) => '<th>' + escapeHtml(h) + '</th>').join('');
 const body = lines.slice(1).map((l) => '<tr>' + cells(l).map((v) => '<td class="mono">' + escapeHtml(v) + '</td>').join('') + '</tr>').join('\n');
 return '<table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>';
}

/**
 * Build the full standalone ASE export HTML document (links print-export.css). Pure string; the
 * manifest and exhibit index are rendered read-only. Corrupted / draft cases are surfaced gracefully.
 * `opts` = { caseLabel, pkgPath }.
 *
 */
export function buildAseExportHtml(manifest, exhibitIndex, opts = {}) {
 manifest = (opts && opts.redact) ? redactPii(manifest, opts.redact) : manifest;
 const c = manifest || {};
 const sealed = c.state === 'sealed';
 const draftBanner = sealed ? '' :
 '<div class="banner draft">DRAFT ONLY / NOT EVIDENTIARILY CERTIFIED / div>';
 const baseCsv = buildBaseCsv(c);
 const extCsv = buildAseExtendedCsv(c);
 const baseData = 'data:text/csv;charset=utf-8,' + encodeURIComponent(baseCsv);
 const extData = 'data:text/csv;charset=utf-8,' + encodeURIComponent(extCsv);

 return '<!doctype html>\n'
 + '<html lang="en"><head><meta charset="utf-8">'
 + '<meta name="viewport" content="width=device-width, initial-scale=1">'
 + '<title>FieldSeal Suite — ASE Export Report</title>'
 + '<link rel="stylesheet" href="print-export.css">'
 + '</head><body>\n'
 + '<div class="toolbar no-print">'
 + '<button onclick="window.print()">Print / button>'
 + '<a class="btn" href="' + baseData + '" download="case-ledger.csv">Download base CSV</a> '
 + '<a class="btn" href="' + extData + '" download="extended.csv">Download extended.csv</a>'
 + '</div>\n'
 + '<div class="page">\n'
 + '<h1>FieldSeal Suite / ASE Export Report / h1>'
 + '<p class="subtitle">' + escapeHtml(opts.caseLabel || 'Auxiliary audit export') + ' · Generated '
 + escapeHtml(new Date().toISOString()) + ' · Offline, local-only</p>\n'
 + draftBanner + '\n'
 + buildAseDisclaimerHtml() + '\n'
 + '<section class="no-break"><h2>1. Case Identification / read-only)< / h2><table><tbody>'
 + '<tr><th>Case ID</th><td class="mono">' + escapeHtml(c.packageId || '') + '</td></tr>'
 + '<tr><th>State</th><td>' + escapeHtml(c.state || '') + '</td></tr>'
 + '<tr><th>rootHash</th><td class="mono">' + escapeHtml(c.rootHash || '') + '</td></tr>'
 + '<tr><th>sealHash (trust baseline)</th><td class="mono">' + escapeHtml(c.sealHash || '') + '</td></tr>'
 + '<tr><th>Sealed UTC</th><td class="mono">' + escapeHtml(c.sealedAt || 'n/a') + '</td></tr>'
 + '</tbody></table></section>\n'
 + '<section class="no-break"><h2>2. Exhibit Index / h2>' + buildExhibitIndexHtml(exhibitIndex) + '</section>\n'
 + '<section class="no-break"><h2>3. Extended Audit Ledger / extended.csv)< / h2>' + csvToTableHtml(extCsv) + '</section>\n'
 + '<section class="no-break"><h2>4. Base Ledger / case-ledger.csv)< / h2>' + csvToTableHtml(baseCsv) + '</section>\n'
 + '<footer><p>' + escapeHtml(ATTRIBUTION_LINE) + '</p>'
 + '<p class="note">Report generated from a read-only view of the case package; it does not alter '
 + 'rootHash / sealHash. Verify with: <span class="mono">node cli/bin/audit.js case verify &lt;case.zip&gt; --json</span></p>'
 + '</footer>\n'
 + '</div></body></html>\n';
}

/** Browser helper: render the export HTML into a target element. Guarded — no-op outside a DOM. */
export function renderAseExport(target, manifest, exhibitIndex, opts) {
 if (typeof document === 'undefined' || !target) return;
 target.innerHTML = buildAseExportHtml(manifest, exhibitIndex, opts);
}
