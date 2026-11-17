/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Case export layer (ESM, 0 runtime dependencies). Pure presentation / packaging helpers.
// This module NEVER computes or alters hashes: it only reads the authoritative rootHash / sealHash
// already fixed by pwa/core/case-manifest.js. Deleting it must not affect verification.
// Export layout (see docs/SPEC-case.md §/§):
// case-manifest.json
// evidence<packageId>.zip (verbatim frozen fieldseal-evidence-v0.2 children)
// case-report.html (English Attestation audit report)
// case-ledger.csv (CSV audit ledger)
// VERIFY.txt (self-contained root/seal hash manifest + case-verify command)
// => `node cli/bin/audit.js case verify <case.zip> --json` verifies the export directly.

import { buildZip } from '../core/zip-builder.js';
import { sha256Hex, isoUtcNow } from '../core/hash.js';
import { buildCaseFilesSha256, CHECKSUM_FILE } from './case-checksums.js';
import { ATTRIBUTION_LINE, csvAttributionLine, reportFooterHtml } from './attribution.js';
import { antiForwardOverlayHtml } from './case-watermark.js';

const SIGNATURE_DIR = 'signatures';
const ATTACHMENT_DIR = 'attachments';

export const CASE_EXPORT_SPEC = 'fieldseal-case-export-v0.1';
export const CSV_HEADER = [
 'record_utc', 'record_type', 'actor_name', 'actor_title', 'transfer_purpose',
 'evidence_item_id', 'item_hash', 'schema_change_note', 'case_reference', 'seal_hash'
];

export function escapeHtml(value) {
 return String(value === undefined || value === null ? '' : value)
 .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
 .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// CSV formula-injection guard: a cell starting with = + - @ (optionally after leading
// whitespace) is executed as a formula by Excel / LibreOffice / Sheets. Prefix an
// apostrophe so spreadsheet apps store it as inert text; the marker is not displayed
// in the cell. Applied BEFORE RFC4180 quoting so the marker stays the first character.
function csvCell(value) {
 let text = String(value === undefined || value === null ? '' : value).replace(/\r?\n/g, ' ');
 if (/^\s*[=+\-@]/.test(text)) text = "'" + text;
 return /[",]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function tz(utc, iana) { return utc + ' (' + (iana || 'UTC') + ')'; }

// --- v0.5 GDPR PII redaction (export-only, never mutates the source manifest) --------------------
// When an operator chooses to redact PII from an exported artifact (report / ledger), this returns a
// CLONE with designated personal-data fields masked to 'REDACTED'. It is purely a presentation control:
// the original caseManifest and its rootHash / sealHash are untouched, and redaction can never change
// verification. Fields masked are additive non-trust metadata or display-only values, not the trust root.
const PII_MASK = 'REDACTED';
const REDACT_TARGETS = [
 ['caseMeta', 'operatorProfile', 'operatorName'],
 ['caseMeta', 'operatorProfile', 'operatorTitle'],
 ['caseMeta', 'operatorProfile', 'orgId'],
 ['caseMeta', 'operatorProfile', 'operatorId'],
 ['caseMeta', 'operatorIdentity', 'operatorId'],
 ['caseMeta', 'operatorIdentity', 'fullName'],
 ['caseMeta', 'operatorIdentity', 'badgeId'],
 ['caseMeta', 'operatorIdentity', 'contactRef'],
 ['caseMeta', 'operatorIdentity', 'signatureFingerprint'],
 ['caseMeta', 'deviceUserAgent']
];

export function redactPii(c, opts) {
 const doRedact = opts === true || (opts && opts.redact);
 if (!doRedact) return c;
 const mask = (opts && typeof opts === 'object' && opts.fields) ? opts.fields : REDACT_TARGETS;
 const clone = JSON.parse(JSON.stringify(c || {}));
 for (const path of mask) {
 let node = clone;
 let ok = true;
 for (let i = 0; i < path.length - 1; i++) {
 if (node && typeof node === 'object' && path[i] in node) node = node[path[i]];
 else { ok = false; break; }
 }
 if (ok && node && typeof node === 'object') {
 const key = path[path.length - 1];
 if (key in node && node[key] !== '') node[key] = PII_MASK;
 }
 }
 return clone;
}

// v0.5 jurisdiction disclaimer (pure display; does NOT affect hashes). Text is generated at render
// time from caseMeta.jurisdiction; advisory wording only, never legal advice.
const JURISDICTION_DISCLAIMERS = {
 'US-FRE': {
 label: 'United States — Federal Rules of Evidence',
 en: 'Under the U.S. Federal Rules of Evidence, the admissibility of electronically stored information (FRE 902(13)/(14), Rule 801, Rule 404) depends on authentication, reliability and the circumstances of collection. This tool produces a self-contained, hash-bound record intended to support authentication, but it does NOT constitute legal advice or a guarantee of admissibility. The relying party must have the exhibit independently reviewed by qualified U.S. counsel.',
 },
 'Germany-ZPO': {
 label: 'Germany — Zivilprozessordnung (ZPO) / BGH case law',
 en: 'Under German procedural law (ZPO §§ 371–373, § 142; BGH jurisprudence on digital evidence), the weight and admissibility of electronic records depend on verifiability of origin, integrity and an unbroken chain of custody. This tool supports those requirements but is NOT legal advice; a German court decides admissibility on the merits. Have the exhibit reviewed by qualified German counsel.',
 },
 'UK-Civil': {
 label: 'United Kingdom — Civil Procedure Rules',
 en: 'Under the UK Civil Procedure Rules (CPR Part 32, Practice Direction 32), a witness must verify the authenticity of electronic evidence and exhibit it properly. This tool produces a hash-bound record to assist authentication, but it provides NO legal advice or admissibility guarantee; have the exhibit reviewed by qualified UK solicitors / counsel.',
 },
 'General Audit': {
 label: 'General Audit / Internal Investigation',
 en: 'For internal audit and investigative use this tool provides a tamper-evident, hash-bound record of collection and chain of custody. It is NOT a qualified electronic signature and gives NO guarantee that any tribunal, regulator or court will accept the evidence. Admissibility is determined by the relevant authority; obtain independent legal review where relied upon.',
 }
};

function jurisdictionDisclaimerHtml(c) {
 const j = (c.caseMeta && c.caseMeta.jurisdiction) || '';
 const d = JURISDICTION_DISCLAIMERS[j];
 if (!d) return '';
 return '<div class="jurisdiction-note"><h3>Jurisdiction Notice / &mdash;' + escapeHtml(d.label) + '</h3>'
 + '<p><strong>EN</strong> ' + escapeHtml(d.en) + '</p></div>';
}

function operatorIdentityHtml(c) {
 const op = c.caseMeta && c.caseMeta.operatorProfile;
 if (!op) return '';
 return '<h2>1a. Operator Identity / h2>'
 + '<table><tbody>'
 + '<tr><th>Name / th><td>' + escapeHtml(op.operatorName || '') + '</td></tr>'
 + '<tr><th>Title / th><td>' + escapeHtml(op.operatorTitle || '') + '</td></tr>'
 + '<tr><th>Org / th><td>' + escapeHtml(op.orgId || '') + '</td></tr>'
 + '<tr><th>Operator ID / th><td class="mono">' + escapeHtml(op.operatorId || '') + '</td></tr>'
 + '</tbody></table>';
}

// v0.5 additive, NON-trust operator identity (operatorIdentity). Audit-only metadata, excluded from
// rootHash / sealHash. Distinct from operatorProfile; never a substitute for a signature or trust root.
function operatorIdentityV2Html(c) {
 const oi = c.caseMeta && c.caseMeta.operatorIdentity;
 if (!oi) return '';
 return '<h2>1a-b. Operator Identity (additive, non-trust) / h2>'
 + '<table><tbody>'
 + '<tr><th>Operator ID / th><td class="mono">' + escapeHtml(oi.operatorId || '') + '</td></tr>'
 + '<tr><th>Full name / th><td>' + escapeHtml(oi.fullName || '') + '</td></tr>'
 + '<tr><th>Badge ID / th><td class="mono">' + escapeHtml(oi.badgeId || '') + '</td></tr>'
 + '<tr><th>Org / th><td>' + escapeHtml(oi.org || '') + '</td></tr>'
 + '<tr><th>Role / th><td>' + escapeHtml(oi.role || '') + '</td></tr>'
 + '<tr><th>Contact ref / th><td>' + escapeHtml(oi.contactRef || '') + '</td></tr>'
 + '<tr><th>Signature fingerprint / th><td class="mono">' + escapeHtml(oi.signatureFingerprint || '') + '</td></tr>'
 + '</tbody></table>';
}

// v0.5 LAWFUL BASIS / consent record (HASH-BOUND; see bindConsentRecord). Integrity-protected record of
// the legal basis for collection (GDPR Art.6(1) / US legal compulsion). Surfaces as a report section so
// the printed/court-exported PDF carries the legality claim alongside the evidence.
function consentRecordHtml(c) {
 const r = c.caseMeta && c.caseMeta.consentRecord;
 if (!r) return '';
 const basisLabel = {
 consent: 'Consent', legalCompulsion: 'Legal compulsion',
 publicInterest: 'Public interest', contractual: 'Contractual',
 vitalInterest: 'Vital interest', other: 'Other'
 }[r.basis] || r.basis || '';
 return '<h2>1a-c. Lawful Basis / consent record)< / h2>'
 + '<div class="jurisdiction-note"><p><strong>Basis / strong>' + escapeHtml(basisLabel) + '</p>'
 + (r.authorityRef ? '<p><strong>Authority ref / strong> <span class="mono">' + escapeHtml(r.authorityRef) + '</span></p>' : '')
 + (r.consentBy ? '<p><strong>Consent by / strong>' + escapeHtml(r.consentBy) + '</p>' : '')
 + (r.basisDetail ? '<p><strong>Detail / strong>' + escapeHtml(r.basisDetail) + '</p>' : '')
 + '<p class="note">Recorded ' + escapeHtml(r.notedAt || '') + (r.operatorId ? ' · Operator ' + escapeHtml(r.operatorId) : '') + '. Hash-bound: post-seal alteration surfaces as tampered.</p></div>';
}

// v0.5 AFFIDAVIT / sworn declaration (HASH-BOUND; see bindAffidavit). The declarant's statement, tied to
// the case sealHash. Render near the custodian attestation so the court-facing declaration is explicit.
function affidavitHtml(c) {
 const af = c.caseMeta && c.caseMeta.affidavit;
 if (!af) return '';
 const stmts = (af.statements || []).map((s) => '<li>' + escapeHtml(s) + '</li>').join('');
 return '<h2>3b. Affidavit / Sworn Declaration / h2>'
 + '<div class="attestation">'
 + '<p>I, <strong>' + escapeHtml(af.declarant) + '</strong>'
 + (af.declarantTitle ? ' (' + escapeHtml(af.declarantTitle) + ')' : '')
 + (af.jurisdiction ? ', under the laws of <strong>' + escapeHtml(af.jurisdiction) + '</strong>' : '')
 + ', declare under penalty of perjury that the foregoing is true and correct to the best of my knowledge.</p>'
 + (stmts ? '<ol>' + stmts + '</ol>' : '')
 + '<p class="note">Declared ' + escapeHtml(af.declaredAt || '') + (af.operatorId ? ' · Operator ' + escapeHtml(af.operatorId) : '') + '. This affidavit is bound to sealHash <span class="mono">' + escapeHtml(c.sealHash) + '</span>; any alteration invalidates verification. This is NOT a qualified electronic signature under eIDAS.</p>'
 + '<p class="note">Declarant signature / : ____________________ &nbsp; Date (UTC): ____________________< / p>'
 + '</div>';
}

// v0.5 TRANSFER RECEIPT / handover acknowledgment (HASH-BOUND custody event; see recordTransferReceipt).
// Closes the chain-of-custody gap at the "hand-off" node by recording the recipient's acknowledgment.
function transferReceiptHtml(c) {
 const receipts = (c.custodyLog || []).filter((e) => e.eventType === 'Transferred' && e.recipient);
 if (!receipts.length) return '';
 const rows = receipts.map((e, i) =>
 '<tr><td>' + (i + 1) + '</td><td>' + escapeHtml(e.recipient.name || '') + '</td>'
 + '<td>' + escapeHtml((e.recipient.title || '') + (e.recipient.org ? '' + e.recipient.org : '')) + '</td>'
 + '<td>' + (e.recipient.acknowledged ? 'acknowledged' : 'NOT acknowledged') + '</td>'
 + '<td class="mono">' + escapeHtml(e.recipient.receivedAt || '') + '</td>'
 + (e.recipient.signatureSha256 ? '<td class="mono">' + escapeHtml(e.recipient.signatureSha256) + '</td>' : '<td></td>')
 + '</tr>'
 ).join('\n');
 return '<h2>4b. Transfer Receipts / h2>'
 + '<p class="note">Recipient acknowledgments appended as hash-bound Transferred custody events.</p>'
 + '<table><thead><tr><th>#< / th><th>Recipient / th><th>Title / Org< / th><th>Ack< / th><th>Received UTC< / th><th>Signature sha256< / th>< / tr>< / thead>'
 + '<tbody>' + rows + '</tbody></table>';
}

// v0.5 BATES index (US litigation numbering; per-child batesId, rootHash-only). Renders an index of
// assigned Bates IDs alongside exhibit/evidence IDs.
function batesHtml(c) {
 const b = (c.caseMeta && c.caseMeta.bates) || null;
 const rows = (c.children || []).filter((ch) => ch.batesId).map((ch, i) =>
 '<tr><td>' + (i + 1) + '</td><td class="mono">' + escapeHtml(ch.batesId) + '</td><td class="mono">' + escapeHtml(ch.evidenceId || '') + '</td><td class="mono">' + escapeHtml(ch.exhibitId || '') + '</td></tr>'
 ).join('\n');
 if (!rows) return '';
 const cfg = b && b.enabled ? '<p class="note">Bates enabled' + (b.prefix ? ' · prefix ' + escapeHtml(b.prefix) : '') + '.</p>' : '';
 return '<h2>5c. Bates Index / h2>' + cfg + '<table><thead><tr><th>#</th><th>Bates ID</th><th>Evidence ID</th><th>Exhibit</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

// v0.5 WITNESS endorsements (HASH-BOUND; see addWitnessStatement). Formal third-party attestations.
function witnessHtml(c) {
 const ws = (c.caseMeta && c.caseMeta.witnessStatements) || [];
 if (!ws.length) return '';
 const rows = ws.map((w, i) =>
 '<tr><td>' + (i + 1) + '</td><td>' + escapeHtml(w.witnessName || '') + (w.witnessTitle ? '' + escapeHtml(w.witnessTitle) : '') + '</td><td>' + escapeHtml(w.statement || '') + '</td><td class="mono">' + escapeHtml(w.witnessedAt || '') + '</td></tr>'
 ).join('\n');
 return '<h2>3c. Witness Endorsements / h2>'
 + '<table><thead><tr><th>#< / th><th>Witness / th><th>Statement / th><th>Witnessed< / th>< / tr>< / thead><tbody>' + rows + '</tbody></table>';
}

// v0.5 RETENTION / legal hold (HASH-BOUND; see setRetention). Litigation hold + retention policy marker.
function retentionHtml(c) {
 const r = (c.caseMeta && c.caseMeta.retention) || null;
 if (!r || (!r.legalHold && !r.policy && !r.holdUntil && !r.holdReason)) return '';
 return '<h2>15b. Retention &amp; Legal Hold / h2>'
 + '<div class="jurisdiction-note"><p><strong>Legal hold / strong>' + (r.legalHold ? 'ACTIVE' : 'inactive') + '</p>'
 + (r.policy ? '<p><strong>Policy / strong>' + escapeHtml(r.policy) + '</p>' : '')
 + (r.holdUntil ? '<p><strong>Hold until / strong> <span class="mono">' + escapeHtml(r.holdUntil) + '</span></p>' : '')
 + (r.holdReason ? '<p><strong>Reason / strong>' + escapeHtml(r.holdReason) + '</p>' : '')
 + '</div>';
}

// v0.5 MEDIA redaction (rootHash-only derivative record, OUTSIDE sealHash; see addMediaRedaction).
// Renders the dual-digest redaction ledger so the redaction is transparent and auditable.
function mediaRedactionHtml(c) {
 const ms = c.mediaRedactions || [];
 if (!ms.length) return '';
 const rows = ms.map((m, i) =>
 '<tr><td>' + (i + 1) + '</td><td class="mono">' + escapeHtml(m.evidenceId || '') + '</td><td>' + escapeHtml(m.method || 'blur') + '</td>'
 + '<td class="mono">x' + escapeHtml(String(m.region.x)) + ' y' + escapeHtml(String(m.region.y)) + ' w' + escapeHtml(String(m.region.w)) + ' h' + escapeHtml(String(m.region.h)) + '</td>'
 + '<td class="mono">' + escapeHtml(m.originalSha256) + '</td><td class="mono">' + escapeHtml(m.redactedSha256) + '</td></tr>'
 ).join('\n');
 return '<h2>16b. Media Redactions / h2>'
 + '<p class="note">Original media are NEVER altered; only a derivative redacted copy is produced and both digests are recorded (mirrors the watermark dual-digest pattern). The redacted copy is a derivative annotation, outside sealHash.</p>'
 + '<table><thead><tr><th>#</th><th>Evidence</th><th>Method</th><th>Region</th><th>Original sha256</th><th>Redacted sha256</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

// v0.5 MULTI-PERSON MULTI-CONTROL / dual-control approval gate (rootHash-only; see setApprovalPolicy).
// Renders the policy + approval ledger. This is a hard pre-action gate, distinct from countersignature.
function approvalHtml(c) {
 const pol = c.approvalPolicy || null;
 const status = c.approvalStatus || {};
 const approvals = c.approvals || [];
 if (!pol || !pol.requiredK) return '';
 const actionRows = (pol.actions || []).map((a) =>
 '<tr><td>' + E(a) + '</td><td>' + (status[a] === 'authorized' ? 'authorized' : 'pending') + '</td></tr>'
 ).join('\n');
 const recRows = approvals.length ? approvals.map((a, i) =>
 '<tr><td>' + (i + 1) + '</td><td>' + E(a.action) + '</td><td>' + E(a.approverName || a.approverId) + '</td><td>' + E(a.method || 'operatorProfile') + '</td><td class="mono">' + E(a.approvedAt || '') + '</td></tr>'
 ).join('\n') : '<tr><td colspan="5">No approvals recorded.</td></tr>';
 return '<h2>17. Multi-person Multi-control / h2>'
 + '<p class="note">Configurable k-of-n approval policy that HARD-gates sensitive actions (seal / export / transfer). Distinct from countersignature (additive attestation). Approvals enter rootHash only (outside sealHash); identity is a metadata record, not a cryptographic signature (eIDAS QES explicitly out of scope).</p>'
 + '<p><strong>Policy / strong>' + E(pol.requiredK) + '-of-' + E(pol.totalN) + '<strong>actions</strong> ' + E((pol.actions || []).join(', ')) + '</p>'
 + '<table><thead><tr><th>Action / th><th>Status / th>< / tr>< / thead><tbody>' + actionRows + '</tbody></table>'
 + '<table><thead><tr><th>#< / th><th>Action< / th><th>Approver / th><th>Method< / th><th>Approved< / th>< / tr>< / thead><tbody>' + recRows + '</tbody></table>';
}

// v0.5 GEOGRAPHIC attestation (rootHash-only; see recordGeoAttestation). Location attestation bound to an action.
function geoHtml(c) {
 const gas = c.geoAttestations || [];
 if (!gas.length) return '';
 const rows = gas.map((g, i) =>
 '<tr><td>' + (i + 1) + '</td><td class="mono">' + E(g.latitude != null ? String(g.latitude) : '') + ', ' + E(g.longitude != null ? String(g.longitude) : '') + (g.accuracyMeters ? ' ±' + E(String(g.accuracyMeters)) + 'm' : '') + '</td><td>' + E(g.method || 'gps') + '</td><td>' + E(g.source || '') + '</td><td>' + E(g.linkedAction || '') + '</td><td class="mono">' + E(g.attestedAt || '') + '</td></tr>'
 ).join('\n');
 return '<h2>18. Geographic Attestation / attestation< / h2>'
 + '<p class="note">Location attestations bound to a (sensitive) action or capture. Enter rootHash only (outside sealHash); tamper-evident, not a cryptographic position fix.</p>'
 + '<table><thead><tr><th>#</th><th>lat,lon</th><th>Method</th><th>Source</th><th>Linked action</th><th>Attested</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

function exhibitIndexHtml(c) {
 const rows = (c.children || []).map((ch, i) =>
 '<tr><td>' + (i + 1) + '</td><td class="mono">' + escapeHtml(ch.exhibitId || '') + '</td><td class="mono">' + escapeHtml(ch.evidenceId || '') + '</td><td class="mono">' + escapeHtml(ch.rootHash || '') + '</td></tr>'
 ).join('\n');
 if (!rows) return '<p class="note">No captures / p>';
 return '<table><thead><tr><th>#< / th><th>Exhibit / th><th>Evidence ID< / th><th>rootHash< / th>< / tr>< / thead><tbody>' + rows + '</tbody></table>';
}

// Fields introduced after a capture are marked in the report; historical values are never purged.
function addedAfterCaptureKeys(c) {
 const keys = [];
 for (const log of c.schemaChangeLog || []) for (const k of log.added || []) keys.push(String(k).split(':').pop());
 return keys;
}

// The PNG is an ATTACHMENT, not an embedded data URL. Only a whitelisted relative path + the
// hash already bound to rootHash/sealHash may be rendered; this keeps the manifest/canonical small.
function signatureImg(cs) {
 const hash = typeof cs.signatureSha256 === 'string' && /^sha256:[0-9a-f]{64}$/.test(cs.signatureSha256) ? cs.signatureSha256 : null;
 const file = typeof cs.signatureFile === 'string' && /^signatures\/[A-Za-z0-9_-]+\.png$/.test(cs.signatureFile) ? cs.signatureFile : null;
 if (!hash || !file) return '<span class="note">No hand-drawn signature recorded.</span>';
 return '<img class="sig" alt="Hand-drawn countersignature" src="' + escapeHtml(file) + '">' +
 '<div class="mono">' + escapeHtml(hash) + '</div><div class="sub">attachment: ' + escapeHtml(file) + '</div>';
}

export function buildCaseLedgerCsv(c, opts) {
 c = (opts && opts.redact) ? redactPii(c, opts.redact) : c;
 const rows = [CSV_HEADER.join(',')];
 const ref = (c.caseMeta && (c.caseMeta.caseReference || c.caseMeta.title)) || '';
 const push = (cells) => rows.push(CSV_HEADER.map((_, i) => csvCell(cells[i] === undefined ? '' : cells[i])).join(','));
 const base = (utc, type) => [utc, type, '', '', '', '', '', '', ref, c.sealHash || ''];

 push(base(c.createdAt, 'CaseCreated'));
 for (const ch of c.children || []) {
 const cells = base(ch.capturedUtc, 'Capture');
 cells[5] = ch.evidenceId || '';
 cells[6] = ch.rootHash || '';
 push(cells);
 }
 for (const e of c.custodyLog || []) {
 const cells = base(e.utc, e.eventType);
 cells[2] = e.actorName || '';
 cells[3] = e.actorTitle || '';
 cells[4] = e.transferPurpose || '';
 cells[5] = e.evidenceId || '';
 cells[6] = e.itemHash || '';
 push(cells);
 }
 for (const l of c.schemaChangeLog || []) {
 const cells = base(l.utc, 'SchemaChange');
 cells[2] = l.operator || '';
 cells[7] = l.summary || '';
 push(cells);
 }
 // v0.3: countersign decisions and unified audit events share the frozen v0.2 CSV header.
 for (const cs of c.countersignList || []) {
 const cells = base(cs.utc, 'Countersign:' + cs.decision);
 cells[2] = cs.actorName || '';
 cells[3] = cs.actorTitle || '';
 cells[7] = cs.remark || '';
 push(cells);
 }
 for (const a of c.auditLog || []) {
 const cells = base(a.timestampUtc, a.eventType);
 cells[2] = (a.payload && a.payload.actorName) || '';
 cells[7] = [a.operatorNote, (a.payload && a.payload.countersignId) || ''].filter(Boolean).join('');
 push(cells);
 }
 // Attribution layer 4 (CSV metadata). The v0.2 CSV HEADER is unchanged; this is a trailing
 // `#` comment line, not a data row, so CSV parsers keep the same column layout.
 rows.push(csvAttributionLine());
 return rows.join('\r\n') + '\r\n';
}

// v0.5 EXTENDED ledger: a SEPARATE file (does NOT touch the frozen v0.2 case-ledger.csv header).
// Adds operatorProfile, exhibitId, jurisdiction and best-effort Aegis anchor status. The Aegis
// status is read from the local UI store at export time and is advisory only — it is not part of the
// case manifest and never affects hashing.
export function buildCaseLedgerExtendedCsv(c, opts) {
 c = (opts && opts.redact) ? redactPii(c, opts.redact) : c;
 const header = ['record_utc', 'record_type', 'evidence_item_id', 'item_hash', 'case_reference', 'exhibit_id', 'operator_name', 'operator_id', 'operator_title', 'org_id', 'op_full_name', 'op_badge_id', 'op_role', 'op_contact_ref', 'op_signature_fp', 'jurisdiction', 'aegis_anchor_enabled', 'aegis_target', 'seal_hash'];
 const rows = [header.join(',')];
 const ref = (c.caseMeta && (c.caseMeta.caseReference || c.caseMeta.title)) || '';
 const op = (c.caseMeta && c.caseMeta.operatorProfile) || {};
 const oi = (c.caseMeta && c.caseMeta.operatorIdentity) || {};
 const j = (c.caseMeta && c.caseMeta.jurisdiction) || '';
 const aegis = (typeof localStorage !== 'undefined') ? (() => { try { return JSON.parse(localStorage.getItem('fieldseal.aegis') || '{}'); } catch (_e) { return {}; } })() : {};
 const push = (cells) => rows.push(header.map((h) => csvCell(cells[h] === undefined ? '' : cells[h])).join(','));
 const base = (utc, type) => ({
 record_utc: utc, record_type: type, evidence_item_id: '', item_hash: '', case_reference: ref, exhibit_id: '',
 operator_name: op.operatorName || '', operator_id: op.operatorId || '', operator_title: op.operatorTitle || '', org_id: op.orgId || '',
 op_full_name: oi.fullName || '', op_badge_id: oi.badgeId || '', op_role: oi.role || '', op_contact_ref: oi.contactRef || '', op_signature_fp: oi.signatureFingerprint || '',
 jurisdiction: j, aegis_anchor_enabled: aegis.enabled ? 'yes' : 'no', aegis_target: aegis.url || '', seal_hash: c.sealHash || ''
 });
 push(base(c.createdAt, 'CaseCreated'));
 for (const ch of c.children || []) {
 const cells = base(ch.capturedUtc, 'Capture');
 cells.evidence_item_id = ch.evidenceId || '';
 cells.item_hash = ch.rootHash || '';
 cells.exhibit_id = ch.exhibitId || '';
 push(cells);
 }
 for (const e of c.custodyLog || []) {
 const cells = base(e.utc, e.eventType);
 cells.evidence_item_id = e.evidenceId || '';
 cells.item_hash = e.itemHash || '';
 push(cells);
 }
 for (const a of c.auditLog || []) {
 const cells = base(a.timestampUtc, a.eventType);
 cells.operator_id = (a.payload && a.payload.operatorId) || op.operatorId || '';
 push(cells);
 }
 rows.push(csvAttributionLine());
 return rows.join('\r\n') + '\r\n';
}

export function buildVerifyManifest(c) {
 const lines = [
 'FIELDSEAL SUITE - CASE EXPORT VERIFICATION MANIFEST',
 'export spec : ' + CASE_EXPORT_SPEC,
 'case spec : ' + c.spec,
 'spec version: ' + (c.specVersion || 'fieldseal-case-v0.2 (legacy, undeclared)'),
 'generated : ' + isoUtcNow(),
 '',
 'caseId : ' + c.packageId,
 'state : ' + c.state,
 'origin : ' + c.caseOrigin,
 'template : ' + (c.schemaDef && c.schemaDef.metaTemplate),
 'schema ver : ' + (c.schemaDef && c.schemaDef.version),
 'algorithm : ' + c.hashAlgorithm,
 'created UTC : ' + c.createdAt,
 'sealed UTC : ' + (c.sealedAt || 'null'),
 '',
 'rootHash : ' + c.rootHash,
 'sealHash : ' + c.sealHash,
 '',
 'children : ' + (c.children || []).length
 ];
 for (const ch of c.children || []) {
 lines.push(' - evidenceId : ' + (ch.evidenceId || ''));
 lines.push(' packageId : ' + (ch.packageId || ''));
 lines.push(' rootHash : ' + (ch.rootHash || ''));
 lines.push(' file : evidence/' + (ch.packageId || '') + '.zip');
 }
 lines.push(
 '',
 'V0.3 WORKFLOW STATE',
 ' schema locked : ' + (c.schemaLocked === true ? 'yes' : 'no'),
 ' countersigns  : ' + (c.countersignList || []).length,
 ' encryption : ' + (c.caseEncryptionMeta ? c.caseEncryptionMeta.algorithm + ' / ' + c.caseEncryptionMeta.kdf : 'none'),
 ' audit events : ' + (c.auditLog || []).length,
 '',
 'V0.4 CONTRACT',
 ' specVersion : ' + (c.specVersion || 'fieldseal-case-v0.2 (legacy, undeclared)'),
 ' schema dictionaries: ' + Object.keys(c.schemaDictionaries || {}).length,
 ' snapshots : ' + (c.snapshots || []).length + ' (metadata only; ARCHIVE ONLY)',
 ' third-party notes : ' + (c.thirdPartyNotes || []).length,
 ' soft-deleted : ' + (c.isDeleted === true ? 'SOFT-DELETED' : 'no'),
 ' watermark : ' + (c.watermarkConfig && c.watermarkConfig.enabled ? 'ENABLED' : 'disabled') +
 ' (original + watermarked digests in manifest; never in sealHash)',
 ' reporting branding : local presentation only; excluded from sealHash',
 '',
 ' SNAPSHOT DECLARATION: snapshots are independent export packages for ARCHIVAL ONLY.',
 ' A snapshot is NOT an authoritative trust source and MUST NOT replace verification of the',
 'MAIN case export with "case verify".',
 '',
 ' attachments/ CONTRACT: extension-hook products live in attachments/, are NOT part of',
 ' the top-level sealHash, and MUST be covered by case-files.sha256 (file-level integrity).',
 ' A modified attachment byte downgrades the CLI verdict to tampered.',
 '',
 'LAYOUT',
 ' case-manifest.json PLAINTEXT case wrapper (rootHash + sealHash); NO PASSPHRASE NEEDED',
 ' evidence<packageId>.zip verbatim frozen fieldseal-evidence-v0.2 packages',
 ' case-report.html English Attestation audit report',
 ' case-ledger.csv CSV audit ledger (unchanged v0.2 header)',
 ' case-ledger-extended.csv EXTENDED CSV (operatorProfile, exhibitId, jurisdiction, Aegis status)',
 ' case-files.sha256 sha256sum -c compatible checksum manifest',
 ' case-manifest.json.enc OPTIONAL AES-GCM encrypted SNAPSHOT (not the trust source)',
 ' signatures<id>.png OPTIONAL hand-drawn countersign attachments; digest fixed in manifest',
 ' attachments<name> OPTIONAL extension-hook products; NOT in sealHash, IN checksums',
 ' VERIFY.txt this manifest',
 '',
 'VERIFY THE WHOLE CASE (no credentials required)',
 ' node cli/bin/audit.js case verify <case.zip> --json',
 ' expected: coreResult = ok | tampered | invalid_spec',
 ' sha256sum -c case-files.sha256 (after unpacking the ZIP)',
 'VERIFY AN INDIVIDUAL CHILD (frozen SPEC verifier, unchanged)',
 ' node cli/bin/audit.js verify evidence<packageId>.zip --json',
 '',
 'ENCRYPTION CONTRACT',
 ' case-manifest.json is PLAINTEXT and self-contained. A third party WITHOUT the passphrase can',
 ' still verify the whole case and obtain ok / tampered. Encryption is STORAGE protection for',
 ' the additional .enc snapshot ONLY; it does not replace or gate the sealHash check.',
 ' The .enc ciphertext digest is fixed in caseEncryptionMeta (bound to sealHash) and in',
 ' case-files.sha256, so ciphertext tampering is detectable without any password.',
 ' A container WITHOUT case-manifest.json but WITH case-manifest.json.enc is NOT directly',
 ' verifiable: the CLI returns coreResult = needs_password and NEVER returns ok.',
 ' The manifest file is plaintext; verification requires NO passphrase.',
 '.enc',
 '',
 'TRUST MODEL',
 ' specVersion is explicit and hash-bound; the version tag (never field shapes) selects the aggregate.',
 ' sealHash = hash(canonical(schemaDef + caseMeta + childrenRootHashes + custodyLog + schemaChangeLog + state [+ versioned v03 block]))',
 ' It is the sole source of trust. Any post-seal change to schema, media, custody or audit logs fails verification.',
 c.state === 'sealed'
 ? ' This case is SEALED: hashes are authoritative.'
 : ' DRAFT ONLY - NOT EVIDENTIARILY CERTIFIED. Hashes are preview values until the case is sealed.',
 '',
 'DISCLAIMER',
 ' Tamper-resistant record only. NOT a qualified electronic signature under eIDAS.',
 ' No guarantee of admissibility in court. Device timestamps and GPS may be altered.',
 ' Identity and authority of all participants must be verified independently by the relying party.',
 ' Not a qualified electronic signature under eIDAS. No guarantee of court admissibility.',
 ' Device time and GPS can be altered. Identity verification is the user’s responsibility.',
 'eIDAS and GPS limitations apply.',
 ''
 );
 return lines.join('\n') + '\n';
}

export function buildCaseReportHtml(c, opts) {
 c = (opts && opts.redact) ? redactPii(c, opts.redact) : c;
 const sealed = c.state === 'sealed';
 const draft = !sealed;
 const emergency = c.caseOrigin === 'emergency';
 const addedKeys = addedAfterCaptureKeys(c);
 const E = escapeHtml;
 const banner = draft
 ? '<div class="banner draft">DRAFT ONLY &mdash; NOT EVIDENTIARILY CERTIFIED<br><small>Hashes shown below are preview values. This report has no evidentiary effect until the case is sealed.</small></div>'
 : '<div class="banner sealed">SEALED &mdash; INTEGRITY ATTESTATION<br><small>Authoritative sealHash is bound to schema, media, custody and audit records.</small></div>';
 const emergencyNotice = emergency
 ? '<div class="banner emergency">EMERGENCY CAPTURE PATH<br><small>' + E('Created via Emergency Capture, metadata supplemented at ' + (c.schemaSupplementedUtc || 'pending') + '. Media were secured before schema configuration; historical captures were retained unchanged.') + '</small></div>'
 : '';

 const metaRows = [
 ['Case ID', c.packageId], ['State', c.state], ['Origin', c.caseOrigin],
 ['Template', c.schemaDef && c.schemaDef.metaTemplate], ['Schema version', c.schemaDef && c.schemaDef.version],
 ['Hash algorithm', c.hashAlgorithm], ['Case created (UTC)', c.createdAt],
 ['Emergency capture (UTC)', c.emergencyCaptureUtc || 'n/a'],
 ['Schema supplemented (UTC)', c.schemaSupplementedUtc || 'n/a'],
 ['Sealed (UTC)', c.sealedAt || 'n/a'],
 ['Schema lock', c.schemaLocked === true ? 'LOCKED (read-only)' : 'unlocked'],
 ['Encryption', c.caseEncryptionMeta ? c.caseEncryptionMeta.algorithm + ' / ' + c.caseEncryptionMeta.kdf : 'none'],
 ['Countersignatures', String((c.countersignList || []).length)],
 ['Audit events', String((c.auditLog || []).length)]
 ].map(([k, v]) => '<tr><th>' + E(k) + '</th><td class="mono">' + E(v) + '</td></tr>').join('\n');

 const globalRows = (c.schemaDef.globalFields || []).map((f) =>
 '<tr><td>' + E(f.label || f.key) + '</td><td class="mono">' + E(f.key) + '</td><td>' + E(f.type) + '</td><td>' + (f.required ? 'required' : 'optional') + '</td><td>' + E((c.caseMeta || {})[f.key] === undefined ? '' : (c.caseMeta || {})[f.key]) + '</td></tr>'
 ).join('\n');
 const itemRows = (c.schemaDef.itemFields || []).map((f) =>
 '<tr><td>' + E(f.label || f.key) + '</td><td class="mono">' + E(f.key) + '</td><td>' + E(f.type) + '</td><td>' + (f.required ? 'required' : 'optional') + '</td></tr>'
 ).join('\n');

 const timeline = (c.custodyLog || []).map((e) => {
 const missingAdded = addedKeys.filter((k) => !e.itemValues || !(k in e.itemValues));
 const marker = missingAdded.length
 ? '<div class="marker">Field added after capture: ' + E(missingAdded.join(', ')) + ' (blank in this historical record)</div>' : '';
 const gps = e.gps ? '<div class="sub">GPS lat/lon: ' + E(e.gps.lat) + ', ' + E(e.gps.lon) + '</div>' : '';
 const vals = e.itemValues && Object.keys(e.itemValues).length
 ? '<div class="sub">Item values: ' + E(JSON.stringify(e.itemValues)) + '</div>' : '';
 return '<tr><td class="mono">' + E(tz(e.utc, e.ianaTz)) + '</td><td>' + E(e.eventType) + '</td><td>' + E(e.actorName || '') + '<div class="sub">' + E(e.actorTitle || '') + '</div></td><td>' + E(e.transferPurpose || '') + '</td><td class="mono">' + E(e.evidenceId || '') + '</td><td class="mono">' + E(e.itemHash || '') + '</td><td>' + E(e.note || '') + gps + vals + marker + '</td></tr>';
 }).join('\n');

 const changeRows = (c.schemaChangeLog || []).map((l) =>
 '<tr><td class="mono">' + E(tz(l.utc, l.ianaTz)) + '</td><td>' + E(l.operator || '') + '</td><td>v' + E(l.schemaVersion) + '</td><td>' + E(l.summary || '') + '</td><td class="mono">+ ' + E((l.added || []).join(', ')) + ' / - ' + E((l.deleted || []).join(', ')) + '</td></tr>'
 ).join('\n') || '<tr><td colspan="5">No schema changes recorded.</td></tr>';

 const childRows = (c.children || []).map((ch, i) =>
 '<tr><td>' + (i + 1) + '</td><td class="mono">' + E(ch.evidenceId || '') + '</td><td class="mono">' + E(ch.packageId || '') + '</td><td class="mono">' + E(ch.rootHash || '') + '</td><td class="mono">' + E(ch.capturedUtc || '') + '</td><td class="mono">' + E(ch.exhibitId || '') + '</td><td class="mono">evidence/' + E(ch.packageId || '') + '.zip</td></tr>'
 ).join('\n') || '<tr><td colspan="6">No captures recorded.</td></tr>';

 const countersignRows = (c.countersignList || []).map((cs, i) =>
 '<tr><td>' + (i + 1) + '</td><td class="mono">' + E(tz(cs.utc, cs.ianaTz)) + '</td><td>' + E(cs.actorName || '') + '<div class="sub">' + E(cs.actorTitle || '') + '</div></td><td>' + E(cs.decision) + '</td><td>' + E(cs.remark || '') + '</td><td>' + signatureImg(cs) + '</td></tr>'
 ).join('\n') || '<tr><td colspan="6">No countersignatures recorded.</td></tr>';

 const auditRows = (c.auditLog || []).map((a) => {
 const isNote = a.eventType === 'HUMAN_NOTE';
 const payloadCell = isNote
 ? E((a.payload && a.payload.noteText) || '') +
 (a.payload && a.payload.jurisdictionContext ? '<div class="sub">Jurisdiction' + E(a.payload.jurisdictionContext) + '</div>' : '') +
 (a.payload && a.payload.operatorId ? '<div class="sub">Operator' + E(a.payload.operatorId) + '</div>' : '')
 : E(JSON.stringify(a.payload || {}));
 return '<tr class="' + (isNote ? 'human-note' : '') + '"><td class="mono">' + E(a.timestampUtc) + '</td><td class="mono">' + E(a.eventId) + '</td><td>' + (isNote ? 'Forensic Note' : E(a.eventType)) + '</td><td>' + E(a.caseStateBefore) + ' &rarr; ' + E(a.caseStateAfter) + '</td><td>' + E(a.ianaTimezone) + '</td><td class="mono">' + payloadCell + '</td><td>' + E(a.operatorNote || '') + '</td></tr>';
 }).join('\n') || '<tr><td colspan="7">No v0.3 audit events recorded.</td></tr>';

 // --- v0.4 report blocks (11..14) -------------------------------------------------
 const dictionaryRows = Object.entries(c.schemaDictionaries || {}).map(([fieldId, values], i) =>
 '<tr><td>' + (i + 1) + '</td><td class="mono">' + E(fieldId) + '</td><td>' + E((Array.isArray(values) ? values : []).join(', ')) + '</td></tr>'
 ).join('\n') || '<tr><td colspan="3">No custom field dictionaries configured.</td></tr>';

 const snapshotRows = (c.snapshots || []).map((s, i) =>
 '<tr><td>' + (i + 1) + '</td><td class="mono">' + E(s.snapshotId) + '</td><td class="mono">' + E(s.createdAtUtc) + '</td><td class="mono">' + E(s.rootHash) + '</td><td class="mono">' + E(s.specVersion) + '</td></tr>'
 ).join('\n') || '<tr><td colspan="5">No exported snapshots registered in the main case.</td></tr>';

 const noteRows = (c.thirdPartyNotes || []).map((n, i) =>
 '<tr><td>' + (i + 1) + '</td><td class="mono">' + E(n.timestampUtc) + '</td><td>' + E(n.noteBy) + '<div class="sub">' + E(n.noteOrg) + '</div></td><td>' + E(n.decision) + '</td><td>' + E(n.noteText) + '</td><td class="mono">' + E(n.noteId) + '</td><td class="mono">' + E(n.ianaTimezone) + '</td></tr>'
 ).join('\n') || '<tr><td colspan="7">No third-party verification notes recorded.</td></tr>';

 const branding = c.reportBranding || {};
 const wm = c.watermarkConfig || {};
 const wmRecords = Array.isArray(wm.records) ? wm.records : [];
 const watermarkRows = wmRecords.map((r, i) =>
 '<tr><td>' + (i + 1) + '</td><td class="mono">' + E(r.evidenceId || '') + '</td><td class="mono">' + E(r.originalSha256) + '</td><td class="mono">' + E(r.watermarkedSha256) + '</td></tr>'
 ).join('\n') || '<tr><td colspan="4">No watermarked image versions recorded.</td></tr>';
 const deletedNotice = c.isDeleted === true
 ? '<div class="banner draft">SOFT-DELETED<br><small>The case record is retained locally; it is not physically removed. Restore is draft-only.< / small>< / div>'
 : '';

 return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FieldSeal Suite - Case Audit Report</title>
<style>
 :root { color-scheme: light; }
 @page { size: A4; margin: 15mm; }
 body { margin:0; padding:32px; background:#fff; color:#111; font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif; }
 .page { max-width:1000px; margin:0 auto; }
 h1 { font-size:22px; letter-spacing:.02em; margin:0 0 4px; }
 h2 { font-size:15px; margin:28px 0 10px; border-bottom:1px solid #ccc; padding-bottom:6px; }
 .subtitle { color:#555; font-size:13px; margin:0 0 18px; }
 .banner { padding:14px 18px; border-radius:8px; margin:14px 0; font-weight:700; letter-spacing:.02em; }
 .banner small { display:block; font-weight:400; margin-top:6px; }
 .banner.draft { background:#eee; color:#777; border:2px dashed #999; }
 .banner.sealed { background:#111; color:#fff; border:1px solid #000; }
 .banner.emergency { background:#fff4d6; color:#7a5200; border:1px solid #e0b64a; }
 .draft .hashes, .draft .mono { color:#888; }
 table { border-collapse:collapse; width:100%; margin:8px 0 6px; font-size:12px; }
 th, td { border:1px solid #ddd; padding:7px 9px; text-align:left; vertical-align:top; }
 th { background:#fafafa; font-weight:600; }
 thead th { background:#f0f0f0; }
 .mono { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:11px; word-break:break-all; }
 .hash-box { border:1px solid #ccc; border-radius:8px; padding:14px; background:#fafafa; }
 .hash-box p { margin:0 0 8px; }
 .hash-box p:last-child { margin-bottom:0; }
 .attestation { border:1px solid #bbb; padding:18px; border-radius:8px; background:#fcfcfc; }
 .attestation p { margin:0 0 10px; }
 .marker { color:#a06a00; font-size:11px; margin-top:6px; }
 .sub { color:#666; font-size:11px; margin-top:3px; }
 .note { color:#555; font-size:12px; }
 footer { margin-top:30px; border-top:1px solid #ccc; padding-top:14px; color:#555; font-size:11px; }
 pre { background:#f6f6f6; border:1px solid #ddd; border-radius:6px; padding:10px; overflow-x:auto; font-size:11px; }
 .sig { max-width:220px; max-height:80px; border:1px solid #ccc; background:#fff; }
 .attribution { font-size:10px; color:#666; letter-spacing:.01em; }
 .brand-header { color:#333; font-size:13px; margin:0 0 8px; }
 .brand-logo { max-height:48px; max-width:180px; }
 .anti-forward { position:fixed; inset:0; pointer-events:none; display:flex; align-items:center;
 justify-content:center; font-size:42px; color:rgba(0,0,0,.06);
 transform:rotate(-24deg); z-index:0; }
 .page { position:relative; z-index:1; }
 .print-attribution { display:none; }
 .jurisdiction-note { border:1px solid #bcd; background:#f4f8ff; padding:12px 14px; border-radius:8px; margin:10px 0; }
 .jurisdiction-note h3 { margin:0 0 8px; font-size:14px; }
 .human-note { border-left:3px solid #2f6fdb; }
 .print-header { display:none; }
 /* This is native browser print flow. Precision layout, custom font, advanced PDF features are out of core scope, use extension hook for pdf-lib/jspdf later. */
 @media print {
 body { padding:0; }
 .no-print { display:none !important; }
 h2 { break-after:avoid; }
 table, .hash-box, .attestation, .banner, .jurisdiction-note, .sig { break-inside:avoid; }
 img { break-inside:avoid; }
 .print-header { display:block; position:fixed; top:0; left:0; right:0; font-size:9px; color:#555;
 border-bottom:1px solid #ccc; padding-bottom:4px; }
 .page { padding-top:24px; }
 .print-attribution { display:block; position:fixed; bottom:8px; left:0; right:0;
 text-align:center; font-size:9px; color:#555; }
 }
</style>
<!-- This is native browser print flow. Precision layout, custom font, advanced PDF features are out of core scope, use extension hook for pdf-lib/jspdf later. -->
</head>
<body>
${wm.enabled === true ? antiForwardOverlayHtml(wm.text || 'FieldSeal Suite') : ''}
<div class="print-header">FieldSeal caseId ${E(c.packageId)} &middot; sealHash ${E(c.sealHash)} &middot; ${E(isoUtcNow())}</div>
<div class="page ${draft ? 'draft' : ''}">
 <h1>FIELDSEAL SUITE &mdash; CASE AUDIT REPORT</h1>
 ${branding.headerText ? '<p class="brand-header">' + E(branding.headerText) + '</p>' : ''}
 ${branding.logoDataUrl && /^data:image\//.test(branding.logoDataUrl) ? '<img class="brand-logo" alt="Brand logo" src="' + E(branding.logoDataUrl) + '">' : ''}
 <p class="subtitle">Chain of Custody &amp; Integrity Attestation &middot; Generated ${E(isoUtcNow())} &middot; Offline, zero-dependency, local-only</p>
 <p class="note">Schema ${c.schemaLocked === true ? 'LOCKED (read-only)' : 'unlocked'} &middot; Storage encryption: ${E(c.caseEncryptionMeta ? c.caseEncryptionMeta.algorithm + ' / ' + c.caseEncryptionMeta.kdf : 'none')} &middot; Countersignatures: ${E((c.countersignList || []).length)} &middot; Watermark: ${wm.enabled === true ? 'ENABLED' : 'disabled'} &middot; Native browser print flow only.</p>
 ${banner}
 ${emergencyNotice}
 ${deletedNotice}

 <h2>1. Case Identification</h2>
 <table><tbody>${metaRows}</tbody></table>
 ${operatorIdentityHtml(c)}
 ${operatorIdentityV2Html(c)}
 ${consentRecordHtml(c)}

 <h2>2. Root of Trust / Cryptographic Hashes</h2>
 <div class="hash-box">
 <p><strong>rootHash</strong> (case wrapper)<br><span class="mono">${E(c.rootHash)}</span></p>
 <p><strong>sealHash</strong> (aggregate trust &mdash; sole source of trust)<br><span class="mono">${E(c.sealHash)}</span></p>
 <p class="note">${sealed ? 'SEALED: these hashes are authoritative and bound to schema, media, custody and audit records.' : 'DRAFT ONLY: these hashes are preview values and are not evidentiarily certified.'}</p>
 </div>

 <h2>3. Custodian Attestation</h2>
 <div class="attestation">
 <p>I, the undersigned custodian, attest that the evidence items listed in this report were collected, handled and recorded in the ordinary course of activity, and that the chain-of-custody timeline, schema change log and item-level values shown herein reflect the records entered at the times indicated (UTC, with the IANA time zone of the recording device noted alongside).</p>
 <p>The integrity of this case is bound to the aggregate <strong>sealHash</strong> <span class="mono">${E(c.sealHash)}</span> computed over the canonical case schema, case-level metadata, ordered child evidence-package root hashes, the full chain-of-custody log, the schema change log and the case state. Any alteration to any of these after sealing invalidates verification.</p>
 <p>All original media were stored verbatim (ZIP STORE, no transcoding) as independent <span class="mono">fieldseal-evidence-v0.2</span> packages, each independently verifiable with the unchanged frozen-SPEC verifier.</p>
 <p>${sealed ? 'This attestation is issued for a SEALED case.' : 'DRAFT ONLY &mdash; NOT EVIDENTIARILY CERTIFIED. This attestation has no evidentiary effect until the case is sealed.'}</p>
 <p class="note">Custodian signature / : ____________________ &nbsp; Date (UTC): ____________________</p>
 </div>

 ${affidavitHtml(c)}
 ${witnessHtml(c)}

 <h2>4. Chain of Custody Timeline</h2>
 <table><thead><tr><th>Record UTC (IANA)</th><th>Event</th><th>Actor / Title</th><th>Transfer purpose</th><th>Evidence item</th><th>Item hash</th><th>Note / GPS / Item values</th></tr></thead>
 <tbody>${timeline || '<tr><td colspan="7">No custody events recorded.</td></tr>'}</tbody></table>

 ${transferReceiptHtml(c)}

 <h2>5. Child Evidence Packages</h2>
 <table><thead><tr><th>#</th><th>Evidence ID</th><th>Package ID</th><th>rootHash</th><th>Captured UTC</th><th>Exhibit</th><th>Export path</th></tr></thead>
 <tbody>${childRows}</tbody></table>

 <h2>5b. Exhibit Index</h2>
 ${exhibitIndexHtml(c)}
 ${batesHtml(c)}
 <h2>6. Schema Definition</h2>
 <h3>Global (case-wide) fields / values</h3>
 <table><thead><tr><th>Label</th><th>Key</th><th>Type</th><th>Requirement</th><th>Value</th></tr></thead><tbody>${globalRows || '<tr><td colspan="5">No global fields.</td></tr>'}</tbody></table>
 <h3>Item (per-capture) fields</h3>
 <table><thead><tr><th>Label</th><th>Key</th><th>Type</th><th>Requirement</th></tr></thead><tbody>${itemRows || '<tr><td colspan="4">No item fields.</td></tr>'}</tbody></table>

 <h2>7. Schema Change Log (non-destructive)</h2>
 <p class="note">Deleting a field closes future input only; historical values are never purged. Fields added after a capture are marked in the timeline.</p>
 <table><thead><tr><th>UTC (IANA)</th><th>Operator</th><th>Version</th><th>Summary</th><th>Added / Removed</th></tr></thead><tbody>${changeRows}</tbody></table>

 <h2>8. Verification / Footer</h2>
 <p>Verify the exported case (directory or ZIP) with the zero-dependency CLI:</p>
 <pre>node cli/bin/audit.js case verify &lt;case.zip&gt; --json
node cli/bin/audit.js verify evidence/&lt;packageId&gt;.zip --json</pre>
 <p class="note">Expected <span class="mono">coreResult: ok</span>. The export carries <span class="mono">VERIFY.txt</span> with the same rootHash / sealHash and per-child hashes for independent cross-checking, plus <span class="mono">case-files.sha256</span> for <span class="mono">sha256sum -c</span>.</p>

 <h2>9. Countersignatures &amp; Hand-drawn Signatures</h2>
 <p class="note">Multi-party decisions recorded while the case was in <span class="mono">pending_countersign</span>. PNG signatures are separate <span class="mono">signatures/&lt;countersignId&gt;.png</span> attachments (max 64 KiB each); the manifest stores ONLY their <span class="mono">signatureSha256</span>, which is bound to rootHash / sealHash and verified by the CLI. A hand-drawn signature is NOT a qualified electronic signature under eIDAS.</p>
 <table><thead><tr><th>#</th><th>Record UTC (IANA)</th><th>Countersignatory</th><th>Decision</th><th>Remark</th><th>Signature attachment / digest</th></tr></thead>
 <tbody>${countersignRows}</tbody></table>

 <h2>10. Unified Audit Log (v0.3 / v0.4)</h2>
 <p class="note">eventId / eventType / timestampUtc / ianaTimezone / caseStateBefore / caseStateAfter / payload / operatorNote.</p>
 <table><thead><tr><th>UTC</th><th>eventId</th><th>eventType</th><th>State transition</th><th>IANA</th><th>payload</th><th>operatorNote</th></tr></thead>
 <tbody>${auditRows}</tbody></table>

 <h2>11. Schema Dictionaries</h2>
 <p class="note">Custom select values per field id. Hash-bound (<span class="mono">schemaDictionaries</span>). Locked together with the schema when Schema Lock is active.</p>
 <table><thead><tr><th>#</th><th>Field id</th><th>Allowed values</th></tr></thead><tbody>${dictionaryRows}</tbody></table>

 <h2>12. Case Snapshots (archive only)</h2>
 <p class="note">Metadata of already exported snapshots only (id / createdAtUtc / rootHash / specVersion); no binaries. <strong>Snapshots are for ARCHIVE ONLY and MUST NOT replace main-case case verify.</strong></p>
 <table><thead><tr><th>#</th><th>snapshotId</th><th>Created UTC</th><th>Snapshot rootHash</th><th>specVersion</th></tr></thead><tbody>${snapshotRows}</tbody></table>

 <h2>13. Third-party Verification Notes</h2>
 <p class="note">Independent of <span class="mono">countersignList</span>; hash-bound (<span class="mono">thirdPartyNotes</span>). Decision: Concur | Dissent. Appending is forbidden after sealing.</p>
 <table><thead><tr><th>#</th><th>UTC</th><th>Note by / Org</th><th>Decision</th><th>Note text</th><th>noteId</th><th>IANA</th></tr></thead><tbody>${noteRows}</tbody></table>

 <h2>15. Jurisdiction Notice</h2>
 ${jurisdictionDisclaimerHtml(c)}

 <h2>16. Deleted Items / Watermark Records</h2>
 <p class="note">Soft-delete status <span class="mono">${c.isDeleted === true ? 'SOFT-DELETED' : 'active'}</span> (hash-bound, no physical deletion). Watermark records hold BOTH the original and the watermarked image digests; both live in the manifest (rootHash) but never in sealHash.</p>
 <h3>Watermarked image versions (dual digests)</h3>
 <table><thead><tr><th>#</th><th>Evidence id</th><th>Original sha256</th><th>Watermarked sha256</th></tr></thead><tbody>${watermarkRows}</tbody></table>

 ${retentionHtml(c)}
 ${mediaRedactionHtml(c)}
 ${approvalHtml(c)}
 ${geoHtml(c)}

 <footer>
 <p><strong>EN</strong> This report is a tamper-evident cryptographic verification record. It is NOT a qualified electronic signature under eIDAS and provides no legal advice or guarantee of admissibility in any court or jurisdiction. Device timestamps and GPS may be altered; the identity and authority of all participants must be independently verified by the relying party.</p>
 ${branding.footerText ? '<p class="attribution">' + E(branding.footerText) + '</p>' : ''}
 ${reportFooterHtml()}
 <p>State at generation: ${E(c.state)} &middot; caseId <span class="mono">${E(c.packageId)}</span> &middot; sealHash <span class="mono">${E(c.sealHash)}</span></p>
 </footer>
</div>
<div class="print-attribution">${E(ATTRIBUTION_LINE)}</div>
</body>
</html>
`;
}

// Static preflight (no hashing, no DOM): callers in the UI run this before packaging.
export function preflightCaseExport(c, packages) {
 const errors = [];
 const warnings = [];
 const byId = new Map((packages || []).map((p) => [p.packageId, p.blob]));
 const missing = [];
 for (const ch of c.children || []) {
 if (!byId.has(ch.packageId) || !byId.get(ch.packageId)) missing.push(ch.packageId);
 }
 if (missing.length) errors.push('missing child evidence packages: ' + missing.join(', '));
 if (!c.rootHash || !c.sealHash) errors.push('case carries no rootHash / sealHash');
 if (c.state !== 'sealed') warnings.push('DRAFT ONLY: hashes are preview values; seal the case before using this export evidentially.');
 if (c.caseOrigin === 'emergency') warnings.push('Emergency capture path: metadata was supplemented after initial media capture.');
 return { ok: errors.length === 0, errors, warnings, missing };
}

// entries: array of { packageId, blob }. The blob is stored verbatim (never re-hashed).
// extra.cipherBlob is the optional AES-GCM snapshot produced by helpers/case-crypto.js.
export function buildCaseExportEntries(c, packages, extra = {}) {
 c = (extra && extra.redact) ? redactPii(c, extra.redact === true ? undefined : extra.redact) : c;
 const pre = preflightCaseExport(c, packages);
 if (!pre.ok) throw new Error('case export preflight failed: ' + pre.errors.join('; '));
 const byId = new Map((packages || []).map((p) => [p.packageId, p.blob]));
 const enc = new TextEncoder();
 const entries = [
 { name: 'case-manifest.json', data: enc.encode(JSON.stringify(c, null, 2)) },
 { name: 'case-report.html', data: enc.encode(buildCaseReportHtml(c)) },
 { name: 'case-ledger.csv', data: enc.encode(buildCaseLedgerCsv(c)) },
 { name: 'case-ledger-extended.csv', data: enc.encode(buildCaseLedgerExtendedCsv(c)) },
 { name: 'VERIFY.txt', data: enc.encode(buildVerifyManifest(c)) }
 ];
 for (const ch of c.children || []) {
 entries.push({ name: 'evidence/' + ch.packageId + '.zip', blob: byId.get(ch.packageId) });
 }
 if (extra.cipherBlob) entries.push({ name: 'case-manifest.json.enc', blob: extra.cipherBlob });
 for (const s of extra.signatureBlobs || []) {
 if (!s || !s.blob || !/^[A-Za-z0-9_-]+$/.test(s.countersignId)) continue;
 entries.push({ name: SIGNATURE_DIR + '/' + s.countersignId + '.png', blob: s.blob });
 }
 // Extension-hook products: export-directory attachments ONLY. They never enter the manifest
 // or sealHash; buildCaseFilesSha256 covers them automatically because they are entries.
 for (const a of extra.attachments || []) {
 if (!a || !a.blob || !a.name) continue;
 const raw = String(a.name);
 const nm = raw.startsWith(ATTACHMENT_DIR) ? raw : ATTACHMENT_DIR + '/' + raw.replace(/[^A-Za-z0-9._-]/g, '_');
 if (!/^attachments\/[A-Za-z0-9._-]+$/.test(nm)) continue;
 entries.push({ name: nm, blob: a.blob });
 }
 return entries;
}

// Standalone checksum download. Hashing is delegated, this layer only serialises.
export async function buildCaseChecksumText(c, packages, extra = {}) {
 return buildCaseFilesSha256(buildCaseExportEntries(c, packages, extra));
}

export async function buildCaseExportZip(c, packages, extra = {}) {
 const entries = buildCaseExportEntries(c, packages, extra);
 const sums = await buildCaseFilesSha256(entries);
 entries.push({ name: CHECKSUM_FILE, data: new TextEncoder().encode(sums) });
 return buildZip(entries);
}

export function caseExportFileName(c) {
 return 'case-' + c.packageId.slice(0, 8) + '-' + c.state + '.zip';
}

// --- v0.5 BagIt / OAIS long-term archival package (zero-dependency) ---------------------------------
// Produces a BagIt v1.0 structure (bagit.txt + bag-info.txt + manifest-sha256.txt + tagmanifest-sha256.txt
// + data/* payload). The original case manifest/report are preserved verbatim; BagIt is a packaging
// wrapper, NOT a re-seal — the case rootHash/sealHash remain authoritative and are recorded in bag-info.txt.
// `buildBagitZip` returns a single .zip (browser-downloadable); the Node tool `cli/bagit-tool.mjs` can
// also write a real BagIt *directory* and verify it offline (OAIS-style fixity + completeness).
function buildBagInfo(c) {
 const op = (c.caseMeta && c.caseMeta.operatorProfile && c.caseMeta.operatorProfile.name) || 'unknown';
 const lines = [
 'Source-Organization: FieldSeal Suite',
 'Organization-Address: local-only forensic evidence management',
 'Contact-Name: ' + op,
 'Bagging-Date: ' + isoUtcNow().slice(0, 10),
 'Bag-Software-Agent: FieldSeal Suite BagIt export (spec v' + (c.specVersion || '0.5') + ')',
 'FieldSeal-Package-Id: ' + c.packageId,
 'FieldSeal-Root-Hash: ' + c.rootHash,
 'FieldSeal-Seal-Hash: ' + c.sealHash,
 'FieldSeal-State: ' + c.state
 ];
 return lines.join('\n') + '\n';
}

export async function buildBagitEntries(c, packages, extra = {}) {
 const enc = new TextEncoder();
 const byId = new Map((packages || []).map((p) => [p.packageId, p]));
 const payload = [];
 payload.push({ rel: 'data/case-manifest.json', data: enc.encode(JSON.stringify(c, null, 2)) });
 payload.push({ rel: 'data/case-report.html', data: enc.encode(buildCaseReportHtml(c)) });
 payload.push({ rel: 'data/case-ledger.csv', data: enc.encode(buildCaseLedgerCsv(c)) });
 payload.push({ rel: 'data/case-ledger-extended.csv', data: enc.encode(buildCaseLedgerExtendedCsv(c)) });
 payload.push({ rel: 'data/VERIFY.txt', data: enc.encode(buildVerifyManifest(c)) });
 for (const ch of (c.children || [])) {
 const pkg = byId.get(ch.packageId);
 if (pkg && pkg.blob) payload.push({ rel: 'data/evidence/' + ch.packageId + '.zip', blob: pkg.blob });
 }
 for (const a of (extra && extra.attachments) || []) {
 if (!a || !a.blob || !a.name) continue;
 const nm = String(a.name).replace(/[^A-Za-z0-9._-]/g, '_');
 payload.push({ rel: 'data/attachments/' + nm, blob: a.blob });
 }
 const tagFiles = [
 { rel: 'bagit.txt', data: enc.encode('BagIt-Version: 1.0\nTag-File-Character-Encoding: UTF-8\n') },
 { rel: 'bag-info.txt', data: enc.encode(buildBagInfo(c)) }
 ];
 const manifestLines = [];
 for (const f of payload) {
 const hex = await sha256Hex(f.data !== undefined ? f.data : f.blob);
 manifestLines.push(hex + ' ' + f.rel);
 }
 tagFiles.push({ rel: 'manifest-sha256.txt', data: enc.encode(manifestLines.join('\n') + '\n') });
 const tagmanifestLines = [];
 for (const t of tagFiles) {
 const hex = await sha256Hex(t.data);
 tagmanifestLines.push(hex + ' ' + t.rel);
 }
 const all = tagFiles.concat([{ rel: 'tagmanifest-sha256.txt', data: enc.encode(tagmanifestLines.join('\n') + '\n') }], payload);
 return all.map((e) => ({ name: e.rel, ...(e.data !== undefined ? { data: e.data } : { blob: e.blob }) }));
}

export async function buildBagitZip(c, packages, extra = {}) {
 return buildZip(await buildBagitEntries(c, packages, extra));
}

// Verify a BagIt file map (relPath -> Uint8Array). Returns { ok, errors }. Pure / zero-dependency; the
// Node CLI reads a directory into this map then calls it (offline OAIS fixity + completeness check).
export async function verifyBagitFiles(fileMap) {
 const errors = [];
 const dec = new TextDecoder();
 if (!fileMap['bagit.txt']) errors.push('missing bagit.txt');
 if (!fileMap['manifest-sha256.txt']) errors.push('missing manifest-sha256.txt');
 if (!fileMap['tagmanifest-sha256.txt']) errors.push('missing tagmanifest-sha256.txt');
 const manMap = {};
 if (fileMap['manifest-sha256.txt']) {
 for (const l of dec.decode(fileMap['manifest-sha256.txt']).split('\n')) {
 const m = l.match(/^([0-9a-f]{64})[ \t]+(.+?)\s*$/);
 if (m) manMap[m[2]] = m[1];
 else if (l.trim()) errors.push('malformed manifest line: ' + l);
 }
 }
 for (const rel of Object.keys(manMap)) {
 const content = fileMap[rel];
 if (content === undefined) { errors.push('manifest lists missing payload: ' + rel); continue; }
 const hex = await sha256Hex(content);
 if (hex !== manMap[rel]) errors.push('payload checksum mismatch: ' + rel);
 }
 for (const rel of Object.keys(fileMap)) {
 if (rel.startsWith('data') && !manMap[rel]) errors.push('payload not in manifest: ' + rel);
 }
 const tagMap = {};
 if (fileMap['tagmanifest-sha256.txt']) {
 for (const l of dec.decode(fileMap['tagmanifest-sha256.txt']).split('\n')) {
 const m = l.match(/^([0-9a-f]{64})[ \t]+(.+?)\s*$/);
 if (m) tagMap[m[2]] = m[1];
 else if (l.trim()) errors.push('malformed tagmanifest line: ' + l);
 }
 }
 for (const rel of ['bagit.txt', 'bag-info.txt', 'manifest-sha256.txt']) {
 const content = fileMap[rel];
 if (content === undefined) { errors.push('tagmanifest lists missing tag: ' + rel); continue; }
 const hex = await sha256Hex(content);
 if (hex !== tagMap[rel]) errors.push('tag checksum mismatch: ' + rel);
 }
 return { ok: errors.length === 0, errors };
}
