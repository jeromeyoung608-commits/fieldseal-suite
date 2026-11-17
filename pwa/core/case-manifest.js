/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
import { canonicalJson, shaUri, uuidV4, isoUtcNow, isHash, HASH_ALGORITHMS } from './hash.js';

export const CASE_SPEC = 'fieldseal-case-v0.1';
// Explicit, hash-bound version tag. A manifest with NO specVersion is not "versionless": it is
// bound to the frozen v0.2 legacy contract (see resolveSpecVersion). Nothing is ever inferred
// from which optional fields happen to be present.
export const SPEC_VERSION_V02 = 'fieldseal-case-v0.2';
export const SPEC_VERSION_V03 = 'fieldseal-case-v0.3';
export const SPEC_VERSION_V04 = 'fieldseal-case-v0.4';
export const SPEC_VERSION_V05 = 'fieldseal-case-v0.5';
export const CASE_SPEC_VERSIONS = [SPEC_VERSION_V02, SPEC_VERSION_V03, SPEC_VERSION_V04, SPEC_VERSION_V05];
export const CURRENT_SPEC_VERSION = SPEC_VERSION_V05;
export const V03_FIELDS = ['schemaLocked', 'countersignList', 'caseEncryptionMeta', 'auditLog'];
// v0.4 hash ruling (SPEC-case §): these four fields enter the versioned sealHash aggregate;
// reportBranding / watermarkConfig / attachments stay OUTSIDE sealHash (watermark digests still
// live in the manifest and are therefore bound to rootHash, so tampering is never silent).
export const V04_SEAL_FIELDS = ['schemaDictionaries', 'snapshots', 'thirdPartyNotes', 'isDeleted'];
export const V04_NON_SEAL_FIELDS = ['reportBranding', 'watermarkConfig'];
export const V04_AGGREGATE_FIELDS = V03_FIELDS.concat(V04_SEAL_FIELDS);
export const NOTE_DECISIONS = ['Concur', 'Dissent'];
export const V04_AUDIT_EVENT_TYPES = [
 'DICTIONARY_ADD', 'DICTIONARY_EDIT', 'DICTIONARY_REMOVE', 'BATCH_FIELD_UPDATE',
 'WATERMARK_APPLIED', 'SNAPSHOT_CREATED', 'NOTE_ADDED', 'CASE_SOFT_DELETED',
 'CASE_RESTORED', 'CASE_MIGRATED_V04', 'HUMAN_NOTE'
];
// `pending-configuration` is the retained v0.2 emergency pre-schema state (not part of the
// countersign workflow); `pending_countersign` is the v0.3 multi-party workflow state.
export const CASE_STATES = ['draft', 'pending-configuration', 'pending_countersign', 'sealed'];
export const WORKFLOW_STATES = ['draft', 'pending_countersign', 'sealed'];
export const COUNTERSIGN_DECISIONS = ['Approve', 'Object'];
// PNG signatures are ATTACHMENTS, never embedded data URLs. The manifest stores only the digest.
export const MAX_SIGNATURE_BYTES = 64 * 1024;
export const SIGNATURE_FILE_PREFIX = 'signatures/';
const SIG_HASH_RE = /^sha256:[0-9a-f]{64}$/;
export const AUDIT_EVENT_TYPES = [
 'SCHEMA_LOCK', 'SCHEMA_UNLOCK', 'CASE_ENCRYPT', 'CASE_DECRYPT',
 'COUNTERSIGN_ADD', 'SIGNATURE_RECORDED', 'COUNTERSIGN_SENT', 'CASE_SEALED',
 ...V04_AUDIT_EVENT_TYPES
];
export const EVENT_TYPES = ['Collected', 'Transferred', 'Reviewed', 'Sealed', 'Unsealed', 'Archived', 'Destroyed'];
export const TRANSFER_PURPOSES = [
 'Intake', 'Review', 'Transport', 'Laboratory Analysis', 'Court Presentation', 'Internal Audit', 'Disposition', 'Other'
];
export const EVIDENCE_CONDITIONS = [
 'As observed - Intact', 'As observed - Damaged', 'As observed - Powered On',
 'As observed - Powered Off', 'As observed - Unknown'
];

const FIELD_KEY_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const FIELD_TYPES = ['text', 'datetime', 'boolean', 'select'];

// --- NIST/OSAC calibrated built-in templates (read-only presets) ---
export const META_TEMPLATES = {
 'forensic-investigator': {
 label: 'Forensic Investigator',
 globalFields: [
 { key: 'caseReference', label: 'Case Reference', type: 'text', required: true },
 { key: 'jurisdiction', label: 'Jurisdiction', type: 'text', required: false },
 { key: 'evidencePurpose', label: 'Evidence Purpose', type: 'text', required: false },
 { key: 'collectorOrg', label: 'Collector Organization', type: 'text', required: false },
 { key: 'custodianName', label: 'Custodian Name', type: 'text', required: true },
 { key: 'custodianTitle', label: 'Custodian Title', type: 'text', required: false },
 { key: 'custodianBadgeId', label: 'Custodian Badge/ID', type: 'text', required: false },
 { key: 'evidenceDescription', label: 'Evidence Description', type: 'text', required: false },
 { key: 'evidenceCondition', label: 'Evidence Condition', type: 'select', required: false, options: EVIDENCE_CONDITIONS },
 { key: 'sealNumber', label: 'Seal Number', type: 'text', required: false },
 { key: 'packagingType', label: 'Packaging Type', type: 'text', required: false },
 { key: 'extractionTool', label: 'Extraction Tool + Version', type: 'text', required: false }
 ],
 itemFields: [
 { key: 'sceneZone', label: 'Scene Zone', type: 'text', required: false },
 { key: 'specimenNo', label: 'Specimen No', type: 'text', required: false },
 { key: 'collectionMethod', label: 'Collection Method', type: 'text', required: false },
 { key: 'damageDesc', label: 'Damage Description', type: 'text', required: false },
 { key: 'transferPurpose', label: 'Transfer Purpose', type: 'select', required: false, options: TRANSFER_PURPOSES },
 { key: 'deviceSerial', label: 'Device Serial', type: 'text', required: false },
 { key: 'deviceMakeModel', label: 'Device Make/Model', type: 'text', required: false }
 ]
 },
 'compliance-auditor': {
 label: 'Compliance Auditor',
 globalFields: [
 { key: 'auditFramework', label: 'Audit Framework', type: 'select', required: true, options: ['SOC2', 'ISO27001'] },
 { key: 'auditPeriod', label: 'Audit Period', type: 'text', required: false },
 { key: 'controlId', label: 'Control ID', type: 'text', required: false },
 { key: 'auditee', label: 'Auditee', type: 'text', required: false },
 { key: 'auditorName', label: 'Auditor Name', type: 'text', required: true },
 { key: 'auditorTitle', label: 'Auditor Title', type: 'text', required: false },
 { key: 'evidenceOwner', label: 'Evidence Owner (ISO27001)', type: 'text', required: true },
 { key: 'evidenceDescription', label: 'Evidence Description', type: 'text', required: false },
 { key: 'evidenceCondition', label: 'Evidence Condition', type: 'select', required: false, options: EVIDENCE_CONDITIONS }
 ],
 itemFields: [
 { key: 'testSampleNo', label: 'Test Sample No', type: 'text', required: false },
 { key: 'controlResult', label: 'Control Result', type: 'text', required: false },
 { key: 'findingDesc', label: 'Finding Description', type: 'text', required: false },
 { key: 'transferPurpose', label: 'Transfer Purpose', type: 'select', required: false, options: TRANSFER_PURPOSES },
 { key: 'sampleSource', label: 'Sample Source', type: 'text', required: false }
 ]
 },
 'legal-counsel': {
 label: 'Legal Counsel',
 globalFields: [
 { key: 'matterNo', label: 'Matter No', type: 'text', required: true },
 { key: 'courtJurisdiction', label: 'Court Jurisdiction', type: 'text', required: false },
 { key: 'partyA', label: 'Party A (Plaintiff/Applicant)', type: 'text', required: false },
 { key: 'partyB', label: 'Party B (Defendant/Respondent)', type: 'text', required: false },
 { key: 'evidenceAdmission', label: 'Evidence Admission Purpose', type: 'text', required: false },
 { key: 'custodianName', label: 'Custodian Name', type: 'text', required: true },
 { key: 'custodianBarNo', label: 'Custodian Bar No', type: 'text', required: false },
 { key: 'evidenceDescription', label: 'Evidence Description', type: 'text', required: false }
 ],
 itemFields: [
 { key: 'exhibitNo', label: 'Exhibit No', type: 'text', required: false },
 { key: 'witnessName', label: 'Witness Name', type: 'text', required: false },
 { key: 'exhibitDesc', label: 'Exhibit Description', type: 'text', required: false },
 { key: 'exhibitCondition', label: 'Exhibit Condition', type: 'select', required: false, options: EVIDENCE_CONDITIONS },
 { key: 'transferPurpose', label: 'Transfer Purpose', type: 'select', required: false, options: TRANSFER_PURPOSES }
 ]
 },
 'devops-security': {
 label: 'DevOps Security / IR',
 globalFields: [
 { key: 'incidentId', label: 'Incident ID', type: 'text', required: true },
 { key: 'affectedAsset', label: 'Affected Asset Scope', type: 'text', required: false },
 { key: 'severity', label: 'Severity', type: 'select', required: false, options: ['Low', 'Medium', 'High', 'Critical'] },
 { key: 'responseTeam', label: 'Response Team', type: 'text', required: false },
 { key: 'incidentType', label: 'Incident Type', type: 'text', required: false },
 { key: 'custodianName', label: 'Response Lead', type: 'text', required: true },
 { key: 'extractionTool', label: 'Extraction Tool + Version', type: 'text', required: false },
 { key: 'evidenceDescription', label: 'Evidence Description', type: 'text', required: false },
 { key: 'evidenceCondition', label: 'Collection State', type: 'select', required: false, options: EVIDENCE_CONDITIONS }
 ],
 itemFields: [
 { key: 'assetId', label: 'Asset ID', type: 'text', required: false },
 { key: 'artifactType', label: 'Artifact Type', type: 'select', required: false, options: ['Memory Image', 'Log', 'Disk Snapshot'] },
 { key: 'iocIndicator', label: 'IOC Indicator', type: 'text', required: false },
 { key: 'logSourceHost', label: 'Log Source Host', type: 'text', required: false },
 { key: 'transferPurpose', label: 'Transfer Purpose', type: 'select', required: false, options: TRANSFER_PURPOSES }
 ]
 },
 'blank': {
 label: 'Blank (NIST minimum baseline)',
 globalFields: [
 { key: 'caseReference', label: 'Case Reference', type: 'text', required: true },
 { key: 'evidencePurpose', label: 'Evidence Purpose', type: 'text', required: false },
 { key: 'evidenceDescription', label: 'Evidence Description', type: 'text', required: false },
 { key: 'evidenceCondition', label: 'Evidence Condition', type: 'select', required: false, options: EVIDENCE_CONDITIONS }
 ],
 itemFields: []
 },
 'custom': { label: 'Custom', globalFields: [], itemFields: [] }
};

function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

function buildSchemaDef(metaTemplate, mode, customGlobalFields = [], customItemFields = []) {
 const tpl = META_TEMPLATES[metaTemplate] || META_TEMPLATES['blank'];
 let globals = clone(tpl.globalFields).concat(customGlobalFields.map(clone));
 let items = clone(tpl.itemFields).concat(customItemFields.map(clone));
 if (mode === 'quick') {
 globals = globals.filter((f) => f.required);
 items = items.filter((f) => f.required);
 }
 return { metaTemplate, mode, version: 1, globalFields: globals, itemFields: items };
}

export function normalizeAlgorithm(algo) {
 const a = (algo || 'sha256').toLowerCase();
 if (!HASH_ALGORITHMS.includes(a)) throw new Error('unsupported hash algorithm: ' + algo);
 return a;
}

function stripIntegrity(c) {
 const copy = clone(c);
 delete copy.rootHash;
 delete copy.sealHash;
 return copy;
}

// Additive, NON-trust metadata keys (v0.5+). Stored in caseMeta for UI / export only and DELIBERATELY
// excluded from BOTH rootHash and sealHash, so they can never become a trust root and never alter
// verification / tamper detection. Tasks 1-3 (operatorIdentity / humanNotes / envSnapshot) live here.
// Existing v0.2..v0.5 packages lack these keys, so stripping them is a no-op and their hashes stay
// byte-identical (backward compatible; the v0.4 / v0.5 aggregate branches are untouched).
export const ADDITIVE_NON_HASH_KEYS = ['envSnapshot', 'tsaTimestamps', 'bates', 'humanNotes'];

function stripAdditiveMeta(c) {
 const copy = stripIntegrity(c);
 if (copy.caseMeta && typeof copy.caseMeta === 'object') {
 for (const k of ADDITIVE_NON_HASH_KEYS) delete copy.caseMeta[k];
 }
 return copy;
}

export async function computeRootHash(c) {
 return shaUri(canonicalJson(stripAdditiveMeta(c)), normalizeAlgorithm(c.hashAlgorithm));
}

/**
 * Resolve the parsing contract. ONLY `specVersion` is consulted — never field shapes.
 * A missing specVersion maps to the FROZEN v0.2 contract (legacy exports stay verifiable).
 * An unknown version value is rejected by validateCaseManifest before hashing.
 *
 */
export function resolveSpecVersion(c) {
 return c && c.specVersion === undefined ? SPEC_VERSION_V02 : (c ? c.specVersion : null);
}

function isV03Spec(c) { return resolveSpecVersion(c) === SPEC_VERSION_V03; }
function isV04Spec(c) { return resolveSpecVersion(c) === SPEC_VERSION_V04; }
function isV05Spec(c) { return resolveSpecVersion(c) === SPEC_VERSION_V05; }
// v0.4 and v0.5 share the same aggregate field set (v0.5 only adds additive case-layer fields that
// are already bound through caseMeta / auditLog / rootHash); the v0.4 branch stays byte-identical.
function isV04PlusSpec(c) { const v = resolveSpecVersion(c); return v === SPEC_VERSION_V04 || v === SPEC_VERSION_V05; }

// Sentinel for a stripped field. canonicalJson renders it as a unique object, so an absent
// v0.3 / v0.4 field can NEVER serialise to the same bytes as false / null / [] / 0"""false".
// v0.4 deliberately re-uses the SAME frozen sentinel object: only specVersion selects the path.
const FIELD_ABSENT = { __field_absent__: 'fieldseal-case-v0.3' };

export async function computeSealHash(c) {
 const sealCaseMeta = clone(c.caseMeta || {});
 for (const k of ADDITIVE_NON_HASH_KEYS) delete sealCaseMeta[k]; // additive metadata never enters sealHash
 const sealInput = {
 schemaDef: c.schemaDef,
 caseMeta: sealCaseMeta,
 childrenRootHashes: (c.children || []).map((ch) => ch.rootHash),
 custodyLog: c.custodyLog || [],
 schemaChangeLog: c.schemaChangeLog || [],
 state: c.state
 };
 if (isV03Spec(c)) {
 sealInput.v03 = { specVersion: c.specVersion };
 for (const k of V03_FIELDS) {
 sealInput.v03[k] = Object.prototype.hasOwnProperty.call(c, k) ? c[k] : FIELD_ABSENT;
 }
 } else if (isV04Spec(c)) {
 // v0.4 is a NEW aggregate key, so the v0.3 branch above stays byte-for-byte untouched.
 // V03 fields keep their binding; the four v0.4 hash-bound fields join them. Missing
 // fields use the sentinel, never `||` / `=== true` normalisation. reportBranding,
 // watermarkConfig and /attachments are intentionally absent from this aggregate.
 sealInput.v04 = { specVersion: c.specVersion };
 for (const k of V04_AGGREGATE_FIELDS) {
 sealInput.v04[k] = Object.prototype.hasOwnProperty.call(c, k) ? c[k] : FIELD_ABSENT;
 }
 } else if (isV05Spec(c)) {
 // v0.5 shares the v0.4 aggregate field set exactly: operatorProfile (inside caseMeta),
 // human_note (inside auditLog) and exhibitId (child reference tag, rootHash-bound) are all
 // already covered by the v0.4 binding, so no new sealHash field is introduced and the v0.4
 // branch remains byte-identical for back-compat.
 sealInput.v05 = { specVersion: c.specVersion };
 for (const k of V04_AGGREGATE_FIELDS) {
 sealInput.v05[k] = Object.prototype.hasOwnProperty.call(c, k) ? c[k] : FIELD_ABSENT;
 }
 }
 return shaUri(canonicalJson(sealInput), normalizeAlgorithm(c.hashAlgorithm));
}

// In pending_countersign the only legal writes are countersign records / signatures and the
// final seal. Captures, custody entries, schema edits and encryption changes are rejected.
const COUNTERSIGN_WRITES = new Set(['addCountersign', 'sealFinal']);
// v0.4 §2.4 matrix: third-party verification notes are the ONE additional append allowed in
// pending_countersign. Everything else stays draft-only; sealed remains a hard write lock.
const V04_PENDING_WRITES = new Set(['addThirdPartyNote', 'thirdPartyNoteAdd', 'bindOperator', 'bindOperatorIdentity', 'attachEnvSnapshot', 'setExhibit', 'addHumanNote', 'setJurisdiction', 'bindConsent', 'bindAffidavit', 'recordTransferReceipt', 'configureBates', 'assignBates', 'addWitness', 'setRetention', 'addMediaRedaction', 'setApprovalPolicy', 'recordApproval', 'recordGeoAttestation']);

export const V04_ACTIONS = [
 'migrateV04', 'dictionaryWrite', 'batchFieldUpdate', 'watermarkApply',
 'snapshotCreate', 'thirdPartyNoteAdd', 'softDeleteOrRestore', 'extensionHookRead'
];
// The single source of truth for the v0.4 modification permission matrix (§2.4). UI and S-16
// read this table; the kernel enforces it through requireV04Action().
export const V04_PERMISSION_MATRIX = {
 draft: {
 migrateV04: true, dictionaryWrite: true, batchFieldUpdate: true, watermarkApply: true,
 snapshotCreate: true, thirdPartyNoteAdd: true, softDeleteOrRestore: true, extensionHookRead: true
 },
 pending_countersign: {
 migrateV04: false, dictionaryWrite: false, batchFieldUpdate: false, watermarkApply: false,
 snapshotCreate: true, thirdPartyNoteAdd: true, softDeleteOrRestore: false, extensionHookRead: true
 },
 sealed: {
 migrateV04: false, dictionaryWrite: false, batchFieldUpdate: false, watermarkApply: false,
 snapshotCreate: true, thirdPartyNoteAdd: false, softDeleteOrRestore: false, extensionHookRead: true
 }
};
export function v04ActionAllowed(state, action) {
 const row = V04_PERMISSION_MATRIX[state];
 return !!(row && Object.prototype.hasOwnProperty.call(row, action) && row[action] === true);
}

function requireMutable(c, action = 'write') {
 if (c.state === 'sealed') throw new Error('case is sealed; no mutations permitted');
 if (c.state === 'pending_countersign' && !COUNTERSIGN_WRITES.has(action) && !V04_PENDING_WRITES.has(action)) {
 throw new Error('case is pending_countersign; only countersign records / third-party notes may be appended');
 }
}

// Every v0.4 write goes through this gate. Reading hooks and generating a snapshot never call it.
function requireV04Action(c, action) {
 if (!isV04PlusSpec(c)) throw new Error(action + ' requires ' + SPEC_VERSION_V04 + '+; migrate the draft first');
 if (!v04ActionAllowed(c.state, action)) throw new Error(action + ' is forbidden in state ' + c.state);
 requireMutable(c, action);
}

function requireSchemaMutable(c) {
 requireMutable(c, 'changeSchema');
 if (c.schemaLocked === true) throw new Error('schema is locked; unlock before editing');
}

// Unified audit log. Writes only when the manifest already declares auditLog, so a plain v0.2
// object loaded from disk is never structurally mutated by the v0.3 kernel.
function appendAudit(c, eventType, payload, opts = {}, stateBefore, stateAfter) {
 if (!Array.isArray(c.auditLog)) return;
 if (!AUDIT_EVENT_TYPES.includes(eventType)) throw new Error('invalid audit eventType: ' + eventType);
 c.auditLog.push({
 eventId: uuidV4(),
 eventType,
 timestampUtc: isoUtcNow(),
 ianaTimezone: opts.ianaTz || 'UTC',
 caseStateBefore: stateBefore || c.state,
 caseStateAfter: stateAfter === undefined ? c.state : stateAfter,
 payload: clone(payload || {}),
 operatorNote: opts.note || ''
 });
}

async function rehash(c) {
 c.rootHash = await computeRootHash(c);
 c.sealHash = await computeSealHash(c); // preview while draft; authoritative once sealed
 return c;
}

// v0.4 default payload. `watermarkConfig.records` carries BOTH the original and the
// watermarked image digests (SPEC §11.3); it is in the manifest (=> rootHash) but never in the
// versioned sealHash aggregate. `attachments` is an export directory, NOT a manifest field.
export function v04DefaultFields() {
 return {
 schemaDictionaries: {},
 snapshots: [],
 thirdPartyNotes: [],
 isDeleted: false,
 reportBranding: { headerText: '', footerText: '' },
 watermarkConfig: { enabled: false, text: '', appliedAtUtc: null, records: [] }
 };
}
export const V04_DEFAULT_FIELD_KEYS = Object.keys(v04DefaultFields());

export async function createCase(opts = {}) {
 const origin = opts.origin === 'emergency' ? 'emergency' : 'standard';
 const mode = opts.mode === 'quick' ? 'quick' : 'full';
 const metaTemplate = opts.metaTemplate || (origin === 'emergency' ? 'blank' : 'blank');
 const ts = isoUtcNow();
 const isEmergency = origin === 'emergency';
 const c = {
 spec: CASE_SPEC,
 specVersion: CURRENT_SPEC_VERSION,
 packageId: uuidV4(),
 rootHash: '',
 hashAlgorithm: normalizeAlgorithm(opts.hashAlgorithm),
 createdAt: ts,
 caseCreatedUtc: ts,
 caseOrigin: isEmergency ? 'emergency' : 'standard',
 emergencyCaptureUtc: isEmergency ? ts : null,
 schemaSupplementedUtc: null,
 state: isEmergency ? 'pending-configuration' : 'draft',
 schemaDef: isEmergency ? { metaTemplate: 'blank', mode, version: 1, globalFields: [], itemFields: [] } : buildSchemaDef(metaTemplate, mode, opts.customGlobalFields, opts.customItemFields),
 caseMeta: opts.caseMeta ? clone(opts.caseMeta) : {},
 children: [],
 custodyLog: [],
 schemaChangeLog: [],
 sealHash: '',
 sealedAt: null,
 // v0.3 state (all bound to rootHash; bound to sealHash via conditional extension)
 schemaLocked: false,
 countersignList: [],
 caseEncryptionMeta: null,
 auditLog: [],
 ...v04DefaultFields()
 };
 return rehash(c);
}

export async function addCapture(c, cap) {
 requireMutable(c, 'write');
 if (!cap || !cap.rootHash || !isHash(cap.rootHash)) throw new Error('addCapture requires a valid evidence rootHash');
 if (cap.capturedUtc && Number.isNaN(Date.parse(cap.capturedUtc))) throw new Error('addCapture requires a valid capturedUtc');
 const evidenceId = cap.evidenceId || uuidV4();
 c.children.push({
 evidenceId,
 packageId: cap.packageId || '',
 rootHash: cap.rootHash,
 spec: cap.spec || 'fieldseal-evidence-v0.2',
 capturedUtc: cap.capturedUtc || isoUtcNow()
 });
 c.custodyLog.push({
 eventType: 'Collected',
 utc: cap.capturedUtc || isoUtcNow(),
 ianaTz: cap.ianaTz || 'UTC',
 actorName: cap.actorName || '',
 actorTitle: cap.actorTitle || '',
 evidenceId,
 itemHash: cap.rootHash,
 itemValues: cap.itemValues ? clone(cap.itemValues) : {},
 note: cap.note || '',
 gps: cap.gps || null,
 deviceRef: cap.deviceRef || null
 });
 return rehash(c);
}

export async function addCustodyEntry(c, entry) {
 requireMutable(c, 'write');
 const e = entry || {};
 if (!EVENT_TYPES.includes(e.eventType)) throw new Error('invalid custody eventType: ' + e.eventType);
 if (e.eventType !== 'Collected' && e.eventType !== 'Sealed' && e.transferPurpose && !TRANSFER_PURPOSES.includes(e.transferPurpose)) {
 throw new Error('invalid transferPurpose: ' + e.transferPurpose);
 }
 c.custodyLog.push({
 eventType: e.eventType,
 utc: e.utc || isoUtcNow(),
 ianaTz: e.ianaTz || 'UTC',
 actorName: e.actorName || '',
 actorTitle: e.actorTitle || '',
 transferPurpose: e.transferPurpose || null,
 scope: e.scope || 'all',
 note: e.note || '',
 evidenceId: e.evidenceId || null
 });
 return rehash(c);
}

// Emergency capture: pending-configuration -> draft after schema supplementation.
export async function supplementSchema(c, opts = {}) {
 requireSchemaMutable(c);
 const mode = opts.mode === 'quick' ? 'quick' : 'full';
 const metaTemplate = opts.metaTemplate || 'blank';
 const def = buildSchemaDef(metaTemplate, mode, opts.customGlobalFields, opts.customItemFields);
 const addedKeys = def.globalFields.concat(def.itemFields).map((f) => f.key);
 c.schemaDef = def;
 if (c.caseOrigin === 'emergency' && !c.schemaSupplementedUtc) c.schemaSupplementedUtc = isoUtcNow();
 c.state = 'draft';
 c.schemaChangeLog.push({
 utc: isoUtcNow(),
 ianaTz: opts.ianaTz || 'UTC',
 operator: opts.operator || 'system',
 summary: 'Created via Emergency Capture, metadata supplemented at ' + (c.schemaSupplementedUtc || isoUtcNow()) + ' (' + (opts.ianaTz || 'UTC') + ')',
 added: addedKeys,
 deleted: [],
 schemaVersion: def.version
 });
 return rehash(c);
}

// Draft/pending schema edits. Historical custodyLog/itemValues are NEVER purged.
export async function changeSchema(c, opts = {}) {
 requireSchemaMutable(c);
 const added = opts.added || [];
 const deleted = opts.deleted || [];
 const errors = [];
 for (const f of added) {
 if (!FIELD_KEY_RE.test(f.key)) errors.push('invalid field key: ' + f.key);
 if (!FIELD_TYPES.includes(f.type)) errors.push('invalid field type: ' + f.type);
 if (f.options && !Array.isArray(f.options)) errors.push('options must be array for ' + f.key);
 }
 for (const d of deleted) {
 if (!FIELD_KEY_RE.test(d.key)) errors.push('invalid delete key: ' + d.key);
 if (d.scope !== 'global' && d.scope !== 'item') errors.push('delete scope must be global|item for ' + d.key);
 }
 if (errors.length) throw new Error('schema change rejected: ' + errors.join('; '));

 const target = (scope) => (scope === 'global' ? c.schemaDef.globalFields : c.schemaDef.itemFields);
 const exists = (scope, key) => target(scope).some((f) => f.key === key);
 for (const f of added) {
 const scope = f.scope === 'item' ? 'item' : 'global';
 if (exists(scope, f.key)) throw new Error('field already exists: ' + f.key);
 const field = { key: f.key, label: f.label || f.key, type: f.type, required: !!f.required };
 if (Array.isArray(f.options)) field.options = f.options;
 target(scope).push(field);
 }
 for (const d of deleted) {
 const list = target(d.scope);
 const idx = list.findIndex((f) => f.key === d.key);
 if (idx === -1) throw new Error('field not found for deletion: ' + d.key);
 list.splice(idx, 1); // removes future-input entry only; historical data untouched
 }
 c.schemaDef.version += 1;
 c.schemaChangeLog.push({
 utc: isoUtcNow(),
 ianaTz: opts.ianaTz || 'UTC',
 operator: opts.operator || 'system',
 summary: 'Added [' + added.map((f) => f.key).join(', ') + ']; Removed [' + deleted.map((d) => d.key).join(', ') + ']',
 added: added.map((f) => f.scope === 'item' ? 'item:' + f.key : f.key),
 deleted: deleted.map((d) => d.scope + ':' + d.key),
 schemaVersion: c.schemaDef.version
 });
 return rehash(c);
}

// v0.2 path: draft -> sealed. v0.3 path: pending_countersign -> sealed ("Seal Final").
export async function sealCase(c, opts = {}) {
 if (c.state === 'pending-configuration') throw new Error('cannot seal a pending-configuration case; complete schema supplementation first');
 if (c.state === 'sealed') throw new Error('case already sealed');
 if (c.state !== 'draft' && c.state !== 'pending_countersign') throw new Error('cannot seal from state: ' + c.state);
 requireApproval(c, 'seal'); // multi-control gate (no-op unless a policy requires 'seal')
 const before = c.state;
 const ts = isoUtcNow();
 c.state = 'sealed';
 c.sealedAt = opts.utc || ts;
 c.custodyLog.push({
 eventType: 'Sealed',
 utc: c.sealedAt,
 ianaTz: opts.ianaTz || 'UTC',
 actorName: opts.actorName || '',
 actorTitle: opts.actorTitle || '',
 transferPurpose: null,
 scope: 'all',
 note: opts.note || ''
 });
 appendAudit(c, 'CASE_SEALED', {
 sealedAt: c.sealedAt,
 countersignCount: (c.countersignList || []).length,
 schemaLocked: c.schemaLocked === true
 }, opts, before, c.state);
 c.sealHash = await computeSealHash(c); // authoritative
 c.rootHash = await computeRootHash(c);
 return c;
}

// --- v0.3 Schema Lock --------------------------------------------------------
export async function setSchemaLocked(c, locked, opts = {}) {
 requireMutable(c, 'setSchemaLocked');
 const next = !!locked;
 if (c.schemaLocked === next) return c;
 c.schemaLocked = next;
 appendAudit(c, next ? 'SCHEMA_LOCK' : 'SCHEMA_UNLOCK',
 { schemaVersion: c.schemaDef.version }, opts, c.state, c.state);
 return rehash(c);
}

// --- v0.3 multi-party countersign workflow ----------------------------------
export async function sendForCountersign(c, opts = {}) {
 requireMutable(c, 'sendForCountersign');
 if (c.state !== 'draft') throw new Error('sendForCountersign requires draft state');
 const before = c.state;
 c.state = 'pending_countersign';
 appendAudit(c, 'COUNTERSIGN_SENT', {
 schemaVersion: c.schemaDef.version,
 childCount: (c.children || []).length
 }, opts, before, c.state);
 return rehash(c);
}

export async function addCountersign(c, entry = {}, opts = {}) {
 requireMutable(c, 'addCountersign');
 if (c.state !== 'pending_countersign') throw new Error('countersign records require pending_countersign state');
 if (!COUNTERSIGN_DECISIONS.includes(entry.decision)) throw new Error('invalid countersign decision: ' + entry.decision);
 const actorName = String(entry.actorName || '').trim();
 if (!actorName) throw new Error('countersign requires actorName');
 if (!Array.isArray(c.countersignList)) c.countersignList = [];

 // Append-only + explicit duplicate rejection: two submissions by the same signer (or two tabs
 // racing) must NEVER silently overwrite an earlier decision.
 const identity = (r) => String(r.actorName || '').trim().toLowerCase() + '|' + String(r.actorOrg || '').trim().toLowerCase();
 const key = actorName.toLowerCase() + '|' + String(entry.actorOrg || '').trim().toLowerCase();
 if (c.countersignList.some((r) => identity(r) === key)) {
 throw new Error('duplicate countersign for signer; append-only, use a distinct signer/organization');
 }

 // The manifest carries ONLY the digest of the PNG attachment. Embedded base64 data URLs are
 // refused so countersignList cannot bloat canonicalJson / the CLI verifier.
 if (entry.signatureDataUrl !== undefined && entry.signatureDataUrl !== null) {
 throw new Error('signatureDataUrl is forbidden in the manifest; pass signatureSha256 of the PNG attachment bytes');
 }
 const signatureSha256 = entry.signatureSha256 || null;
 if (signatureSha256 !== null && !SIG_HASH_RE.test(signatureSha256)) {
 throw new Error('signatureSha256 must be sha256:<64 lowercase hex> of the PNG attachment bytes');
 }
 const countersignId = entry.countersignId || uuidV4();
 if (signatureSha256 && !/^[A-Za-z0-9_-]+$/.test(countersignId)) {
 throw new Error('countersignId must be a safe file stem for the signature attachment');
 }
 const rec = {
 countersignId,
 utc: isoUtcNow(),
 ianaTz: opts.ianaTz || 'UTC',
 actorName,
 actorTitle: entry.actorTitle || '',
 actorOrg: entry.actorOrg || '',
 decision: entry.decision,
 remark: entry.remark || '',
 signatureSha256,
 signatureFile: signatureSha256 ? SIGNATURE_FILE_PREFIX + countersignId + '.png' : null
 };
 c.countersignList.push(rec);
 appendAudit(c, 'COUNTERSIGN_ADD', {
 countersignId: rec.countersignId, decision: rec.decision, actorName: rec.actorName
 }, opts, c.state, c.state);
 if (signatureSha256) {
 appendAudit(c, 'SIGNATURE_RECORDED', { countersignId, signatureSha256 }, opts, c.state, c.state);
 }
 return rehash(c);
}

// --- v0.3 storage-encryption metadata (cipher lives in helpers/case-crypto.js) ----
export async function setCaseEncryption(c, meta, opts = {}) {
 requireMutable(c, 'setCaseEncryption');
 if (!meta || typeof meta !== 'object') throw new Error('encryption metadata required');
 c.caseEncryptionMeta = clone(meta);
 appendAudit(c, 'CASE_ENCRYPT', {
 algorithm: meta.algorithm, kdf: meta.kdf, ciphertextSha256: meta.ciphertextSha256
 }, opts, c.state, c.state);
 return rehash(c);
}

export async function clearCaseEncryption(c, opts = {}) {
 requireMutable(c, 'clearCaseEncryption');
 c.caseEncryptionMeta = null;
 appendAudit(c, 'CASE_DECRYPT', {}, opts, c.state, c.state);
 return rehash(c);
}

// Generic audit append for helper-driven actions that do not change case state (e.g. a verified
// decryption). Keeps the unified field set and recomputes both hashes atomically.
export async function appendAuditEvent(c, eventType, payload = {}, opts = {}) {
 requireMutable(c, 'appendAuditEvent');
 appendAudit(c, eventType, payload, opts, c.state, c.state);
 return rehash(c);
}

// --- v0.4 kernel (§) ----------------------------------------------------
// All functions below are ADDITIONS. No v0.2 / v0.3 branch, state transition, audit field,
// decision flow or aggregate above was rewritten to implement them.

export function isV04Case(c) { return isV04PlusSpec(c); }

// Migration is an EXPLICIT, LEGAL change that produces a NEW rootHash. Only `draft` may migrate:
// in pending_countersign / sealed the case stays at its original specVersion and is opened
// read-only, because a rehash would invalidate countersigned objects and the sealed conclusion.
// Previously exported packages continue to verify under their original version.
export async function migrateCaseToV04(c, opts = {}) {
 const from = resolveSpecVersion(c);
 if (c.state !== 'draft') {
 throw new Error('migration to v0.4 requires draft; ' + c.state + ' stays read-only at ' + from);
 }
 if (from === SPEC_VERSION_V04 || from === SPEC_VERSION_V05) throw new Error('case already declares v0.4 or newer');
 if (!CASE_SPEC_VERSIONS.includes(from)) throw new Error('unknown specVersion: ' + String(from));
 const previousRootHash = c.rootHash;
 // A v0.2 legacy object lacks the four v0.3 fields the v0.4 aggregate binds.
 if (!Object.prototype.hasOwnProperty.call(c, 'schemaLocked')) c.schemaLocked = false;
 if (!Array.isArray(c.countersignList)) c.countersignList = [];
 if (!Object.prototype.hasOwnProperty.call(c, 'caseEncryptionMeta')) c.caseEncryptionMeta = null;
 if (!Array.isArray(c.auditLog)) c.auditLog = [];
 for (const [k, v] of Object.entries(v04DefaultFields())) {
 if (!Object.prototype.hasOwnProperty.call(c, k)) c[k] = v;
 }
 c.specVersion = SPEC_VERSION_V04;
 appendAudit(c, 'CASE_MIGRATED_V04', {
 from, to: SPEC_VERSION_V04, previousRootHash
 }, opts, c.state, c.state);
 return rehash(c);
}

function requireDraftV04(c, action) {
 if (!isV04PlusSpec(c)) throw new Error(action + ' requires ' + SPEC_VERSION_V04 + '+; migrate the draft first');
 if (c.state !== 'draft') throw new Error(action + ' is draft-only (v0.4 matrix §2.4)');
 requireMutable(c, action);
}

function dictionaryValues(values) {
 if (!Array.isArray(values) || values.some((v) => typeof v !== 'string')) {
 throw new Error('dictionary values must be string[]');
 }
 return values.slice();
}
function checkDictionaryKey(fieldId) {
 if (!FIELD_KEY_RE.test(fieldId)) throw new Error('invalid dictionary fieldId: ' + fieldId);
}

// Schema Lock also locks dictionaries (§.1): requireSchemaMutable enforces both state and lock.
export async function addSchemaDictionary(c, fieldId, values = [], opts = {}) {
 requireV04Action(c, 'dictionaryWrite');
 requireSchemaMutable(c);
 checkDictionaryKey(fieldId);
 if (!c.schemaDictionaries || typeof c.schemaDictionaries !== 'object') c.schemaDictionaries = {};
 if (Object.prototype.hasOwnProperty.call(c.schemaDictionaries, fieldId)) {
 throw new Error('dictionary already exists: ' + fieldId);
 }
 c.schemaDictionaries[fieldId] = dictionaryValues(values);
 appendAudit(c, 'DICTIONARY_ADD', { fieldId, values: c.schemaDictionaries[fieldId].slice() }, opts, c.state, c.state);
 return rehash(c);
}

export async function editSchemaDictionary(c, fieldId, values = [], opts = {}) {
 requireV04Action(c, 'dictionaryWrite');
 requireSchemaMutable(c);
 checkDictionaryKey(fieldId);
 if (!c.schemaDictionaries || !Object.prototype.hasOwnProperty.call(c.schemaDictionaries, fieldId)) {
 throw new Error('dictionary not found: ' + fieldId);
 }
 c.schemaDictionaries[fieldId] = dictionaryValues(values);
 appendAudit(c, 'DICTIONARY_EDIT', { fieldId, values: c.schemaDictionaries[fieldId].slice() }, opts, c.state, c.state);
 return rehash(c);
}

export async function removeSchemaDictionary(c, fieldId, opts = {}) {
 requireV04Action(c, 'dictionaryWrite');
 requireSchemaMutable(c);
 checkDictionaryKey(fieldId);
 if (!c.schemaDictionaries || !Object.prototype.hasOwnProperty.call(c.schemaDictionaries, fieldId)) {
 throw new Error('dictionary not found: ' + fieldId);
 }
 delete c.schemaDictionaries[fieldId];
 appendAudit(c, 'DICTIONARY_REMOVE', { fieldId }, opts, c.state, c.state);
 return rehash(c);
}

// One audit event carries the full affectedCaptureIds list (§.2). Only Collected custody
// records are touched: the frozen evidence ZIPs and the children[] hashes are never rewritten.
export async function batchUpdateItemField(c, update = {}, opts = {}) {
 requireV04Action(c, 'batchFieldUpdate');
 const ids = Array.isArray(update.captureIds) ? update.captureIds.map(String) : [];
 const key = String(update.fieldKey || '');
 if (!FIELD_KEY_RE.test(key)) throw new Error('invalid fieldKey: ' + key);
 if (!Object.prototype.hasOwnProperty.call(update, 'value')) throw new Error('value required');
 const affected = [];
 for (const e of c.custodyLog || []) {
 if (e.eventType !== 'Collected' || !ids.includes(String(e.evidenceId))) continue;
 if (!e.itemValues || typeof e.itemValues !== 'object') e.itemValues = {};
 e.itemValues[key] = update.value;
 affected.push(String(e.evidenceId));
 }
 if (!affected.length) throw new Error('no matching captures for batch update');
 appendAudit(c, 'BATCH_FIELD_UPDATE', {
 fieldKey: key, value: update.value, affectedCaptureIds: affected
 }, opts, c.state, c.state);
 return rehash(c);
}

// Both digests are written INTO the manifest (=> rootHash), never into the sealHash aggregate.
// C-40 proves that flipping either one yields `tampered` without touching sealHash semantics.
export async function recordWatermark(c, records = [], opts = {}) {
 requireV04Action(c, 'watermarkApply');
 const list = Array.isArray(records) ? records : [records];
 for (const r of list) {
 if (!r || !SIG_HASH_RE.test(r.originalSha256) || !SIG_HASH_RE.test(r.watermarkedSha256)) {
 throw new Error('watermark record requires originalSha256 + watermarkedSha256 digests');
 }
 }
 if (!c.watermarkConfig || typeof c.watermarkConfig !== 'object') {
 c.watermarkConfig = v04DefaultFields().watermarkConfig;
 }
 if (!Array.isArray(c.watermarkConfig.records)) c.watermarkConfig.records = [];
 for (const r of list) c.watermarkConfig.records.push(clone(r));
 c.watermarkConfig.appliedAtUtc = opts.utc || isoUtcNow();
 appendAudit(c, 'WATERMARK_APPLIED', {
 count: list.length, evidenceIds: list.map((r) => r.evidenceId || '')
 }, opts, c.state, c.state);
 return rehash(c);
}

// Only metadata of ALREADY EXPORTED snapshots is recorded (no binaries). Recording is a
// separate, explicit draft-only write: snapshot GENERATION itself lives in helpers and never
// touches the case. pending_countersign / sealed snapshots are pure read-only exports.
export async function recordSnapshot(c, rec = {}, opts = {}) {
 requireV04Action(c, 'snapshotCreate');
 const snapshot = {
 snapshotId: rec.snapshotId || uuidV4(),
 createdAtUtc: rec.createdAtUtc || isoUtcNow(),
 rootHash: rec.rootHash || c.rootHash,
 specVersion: rec.specVersion || c.specVersion
 };
 if (!Array.isArray(c.snapshots)) c.snapshots = [];
 c.snapshots.push(snapshot);
 appendAudit(c, 'SNAPSHOT_CREATED', {
 snapshotId: snapshot.snapshotId, snapshotRootHash: snapshot.rootHash
 }, opts, c.state, c.state);
 return rehash(c);
}

// Independent of countersignList. Allowed in draft AND pending_countersign (matrix §2.4),
// forbidden in sealed by requireMutable.
export async function addThirdPartyNote(c, note = {}, opts = {}) {
 requireV04Action(c, 'thirdPartyNoteAdd');
 if (!NOTE_DECISIONS.includes(note.decision)) throw new Error('invalid note decision: ' + note.decision);
 const by = String(note.noteBy || '').trim();
 if (!by) throw new Error('noteBy required');
 if (!Array.isArray(c.thirdPartyNotes)) c.thirdPartyNotes = [];
 const rec = {
 noteId: note.noteId || uuidV4(),
 noteBy: by,
 noteOrg: String(note.noteOrg || ''),
 noteText: String(note.noteText || ''),
 decision: note.decision,
 timestampUtc: note.timestampUtc || isoUtcNow(),
 ianaTimezone: opts.ianaTz || 'UTC'
 };
 c.thirdPartyNotes.push(rec);
 appendAudit(c, 'NOTE_ADDED', { noteId: rec.noteId, decision: rec.decision }, opts, c.state, c.state);
 return rehash(c);
}

// Soft delete / restore never physically removes IndexedDB records.
export async function setSoftDeleted(c, deleted, opts = {}) {
 requireV04Action(c, 'softDeleteOrRestore');
 const next = !!deleted;
 if (c.isDeleted === next) return c;
 c.isDeleted = next;
 appendAudit(c, next ? 'CASE_SOFT_DELETED' : 'CASE_RESTORED', { isDeleted: next }, opts, c.state, c.state);
 return rehash(c);
}

// Local presentation configuration: in the manifest (=> rootHash) but OUTSIDE sealHash.
export async function setReportBranding(c, branding = {}, opts = {}) {
 requireDraftV04(c, 'setReportBranding');
 const b = branding || {};
 c.reportBranding = {
 headerText: String(b.headerText || ''),
 footerText: String(b.footerText || ''),
 ...(typeof b.logoDataUrl === 'string' ? { logoDataUrl: b.logoDataUrl } : {})
 };
 return rehash(c);
}

export async function setWatermarkConfig(c, config = {}, opts = {}) {
 requireDraftV04(c, 'setWatermarkConfig');
 if (!c.watermarkConfig || typeof c.watermarkConfig !== 'object') {
 c.watermarkConfig = v04DefaultFields().watermarkConfig;
 }
 c.watermarkConfig.enabled = !!config.enabled;
 c.watermarkConfig.text = String(config.text || '');
 return rehash(c);
}

// --- v0.5 case-layer identity / forensic note / exhibit tagging (additive) ----------------
// operatorProfile lives inside caseMeta (already in the versioned sealHash aggregate and the whole-
// payload rootHash). exhibitId is a tag on a child reference (rootHash-bound). human_note is an
// auditLog entry (auditLog is in the aggregate). All three are draft/pending writable and sealed-
// locked via requireMutable; no hash algorithm or verdict priority is changed.

const OPERATOR_PROFILE_KEYS = ['operatorName', 'operatorTitle', 'orgId', 'operatorId'];

function requireV05Action(c, action) {
 if (!isV04PlusSpec(c)) throw new Error(action + ' requires ' + SPEC_VERSION_V04 + '+ (case identity / forensic note / exhibit fields)');
 requireMutable(c, action);
}

export async function bindOperatorProfile(c, profile, opts = {}) {
 requireV05Action(c, 'bindOperator');
 if (profile === null || profile === undefined) {
 if (c.caseMeta) delete c.caseMeta.operatorProfile;
 } else {
 const p = {};
 for (const k of OPERATOR_PROFILE_KEYS) {
 if (profile[k] !== undefined) {
 if (typeof profile[k] !== 'string') throw new Error('operatorProfile.' + k + ' must be a string');
 p[k] = profile[k];
 }
 }
 c.caseMeta = c.caseMeta || {};
 c.caseMeta.operatorProfile = p;
 }
 return rehash(c);
}

// --- v0.5 operatorIdentity (HASH-BOUND since delivery audit B-06) ----------------------
// Distinct from operatorProfile (also hash-bound). operatorIdentity is a richer, audit profile
// (operatorId / fullName / badgeId / org / role / contactRef / signatureFingerprint) that lives in
// caseMeta and is HASH-BOUND (rootHash + sealHash) — tampering makes verifyCase return `tampered`.
// It is corroborating context and MUST NEVER replace a signature or act as a trust root.
const OPERATOR_IDENTITY_KEYS = ['operatorId', 'fullName', 'badgeId', 'org', 'role', 'contactRef', 'signatureFingerprint'];

export async function bindOperatorIdentity(c, identity, opts = {}) {
 requireV05Action(c, 'bindOperatorIdentity');
 if (identity === null || identity === undefined) {
 if (c.caseMeta) delete c.caseMeta.operatorIdentity;
 } else {
 const p = {};
 for (const k of OPERATOR_IDENTITY_KEYS) {
 if (identity[k] !== undefined) {
 if (typeof identity[k] !== 'string') throw new Error('operatorIdentity.' + k + ' must be a string');
 p[k] = identity[k];
 }
 }
 c.caseMeta = c.caseMeta || {};
 c.caseMeta.operatorIdentity = p;
 }
 return rehash(c);
}

export async function addHumanNote(c, note = {}, opts = {}) {
 requireV05Action(c, 'addHumanNote');
 const text = String(note.noteText || '').trim();
 if (!text) throw new Error('human_note requires non-empty noteText');
 const op = c.caseMeta && c.caseMeta.operatorProfile;
 const operatorId = String(note.operatorId || (op && op.operatorId) || '');
 if (!Array.isArray(c.auditLog)) c.auditLog = [];
 appendAudit(c, 'HUMAN_NOTE', {
 noteText: text,
 jurisdictionContext: String(note.jurisdictionContext || ''),
 operatorId
 }, opts, c.state, c.state);
 return rehash(c);
}

// --- v0.5 RFC3161 TSA timestamps (ADDITIVE, non-trust metadata, caseMeta.tsaTimestamps) ----------
// Optional, out-of-trust-chain corroborating anchor. Stores the TSA-returned token for the case
// `rootHash` (never media / signatures / ZIP). Additive + excluded from both hashes; the native
// sealHash remains the sole trust root. CA-chain signature verification is out-of-kernel (see tsa-timestamp.js).
export async function attachTsaTimestamp(c, entry, opts = {}) {
 if (!c.caseMeta) c.caseMeta = {};
 const list = Array.isArray(c.caseMeta.tsaTimestamps) ? c.caseMeta.tsaTimestamps : (c.caseMeta.tsaTimestamps = []);
 list.push({
 status: entry.status === 'fetched' ? 'fetched' : 'pending',
 tsaUrl: entry.tsaUrl || '',
 algo: entry.algo || 'sha256',
 hashHex: entry.hashHex || '',
 genTime: entry.genTime || '',
 rawTokenB64: entry.rawTokenB64 || '',
 verified: false,
 error: entry.error || '',
 fetchedAt: entry.fetchedAt || new Date().toISOString()
 });
 return c; // excluded from hashes — no rehash needed
}

// --- v0.5 humanNotes (ADDITIVE non-trust case-level annotations, caseMeta.humanNotes) ---------------
// Distinct from the hash-bound auditLog HUMAN_NOTE *events*. humanNotes is a CASE-LEVEL, append-only
// annotation list that is ADDITIVE NON-TRUST metadata (excluded from both rootHash and sealHash via
// ADDITIVE_NON_HASH_KEYS). Rationale: a sealed case must remain immutable — adding a post-seal audit
// note must NOT mutate the evidentiary rootHash, or it would break external TSA/witness anchors and the
// "sealed = immutable" guarantee. Tamper-evidence for the note TEXT is provided by the separate
// hash-bound auditLog HUMAN_NOTE events, not by binding the note into rootHash. (Corrects a prior
// B-06-era comment that wrongly conflated it with the auditLog events.)
// - noteType 'field' : field / on-site note. Writable in draft / pending_countersign, frozen after seal.
// - noteType 'audit' : review note. Allowed ONLY after sealing; never edits prior notes.
const HUMAN_NOTE_TYPES = ['field', 'audit'];

export async function addHumanNoteMeta(c, note, opts = {}) {
 if (!c.caseMeta) c.caseMeta = {};
 const notes = Array.isArray(c.caseMeta.humanNotes)
 ? c.caseMeta.humanNotes
 : (c.caseMeta.humanNotes = []);
 const type = note && note.noteType;
 if (!HUMAN_NOTE_TYPES.includes(type)) throw new Error('noteType must be "field" or "audit"');
 const content = (note && note.content != null) ? String(note.content) : '';
 if (!content.trim()) throw new Error('human note content is required');
 if (type === 'field') {
 if (c.state === 'sealed') throw new Error('field notes are frozen after sealing');
 } else {
 if (c.state !== 'sealed') throw new Error('audit notes are allowed only after sealing');
 }
 notes.push({
 noteType: type,
 content,
 createdAt: new Date().toISOString(),
 authorOperatorId: note.authorOperatorId ? String(note.authorOperatorId) : ''
 });
 return rehash(c); // humanNotes is additive non-trust (stripped from both hashes), so this is a no-op w.r.t. rootHash/sealHash
}

// --- v0.5 envSnapshot (ADDITIVE, non-trust metadata, caseMeta.envSnapshot) -----------------------
// Coarse device / browser environment context captured ONCE at first capture. Immutable (cannot be
// re-captured or edited) and excluded from both rootHash and sealHash (ADDITIVE_NON_HASH_KEYS). No
// sensitive identifiers (no camera hardware ID, no MAC, no precise geolocation).
const ENV_SNAPSHOT_KEYS = ['capturedAt', 'userAgent', 'language', 'languages', 'timezone', 'screenWidth', 'screenHeight', 'online', 'capturePageUrl', 'docTitle'];

export async function attachEnvSnapshot(c, snapshot, opts = {}) {
 requireV05Action(c, 'attachEnvSnapshot');
 if (c.caseMeta && c.caseMeta.envSnapshot) throw new Error('envSnapshot already captured (immutable)');
 const s = {};
 for (const k of ENV_SNAPSHOT_KEYS) if (snapshot && snapshot[k] !== undefined) s[k] = String(snapshot[k]);
 c.caseMeta = c.caseMeta || {};
 c.caseMeta.envSnapshot = s;
 return c; // non-hash
}

export async function setExhibitId(c, evidenceId, exhibitId, opts = {}) {
 requireV05Action(c, 'setExhibit');
 if (!evidenceId) throw new Error('evidenceId required');
 const child = (c.children || []).find((ch) => ch.evidenceId === evidenceId);
 if (!child) throw new Error('child evidence not found: ' + evidenceId);
 if (exhibitId === null || exhibitId === undefined || exhibitId === '') delete child.exhibitId;
 else child.exhibitId = String(exhibitId);
 return rehash(c);
}

// Jurisdiction disclaimer selection (display-only metadata). Stored in caseMeta.jurisdiction (an
// existing field) and rehashed; it affects ONLY the rendered disclaimer text, never the hash logic.
export async function setJurisdiction(c, jurisdiction, opts = {}) {
 requireMutable(c, 'setJurisdiction');
 c.caseMeta = c.caseMeta || {};
 c.caseMeta.jurisdiction = String(jurisdiction || '');
 return rehash(c);
}

// --- v0.5 consent / lawful-basis record (HASH-BOUND, participates in rootHash & sealHash) --------
// Unlike operatorIdentity / humanNotes (additive, non-trust), the consent / lawful-basis record is a
// claim about the LEGALITY of collection. It is integrity-protected: any post-seal alteration surfaces
// as `tampered` during verify. It is OPTIONAL (legacy packages without it still verify) but, when
// present, must be well-formed. Covers GDPR Art.6(1) lawful bases and US legal-compulsion scenarios.
const CONSENT_BASIS = ['consent', 'legalCompulsion', 'publicInterest', 'contractual', 'vitalInterest', 'other'];
const CONSENT_KEYS = ['basis', 'authorityRef', 'consentBy', 'basisDetail', 'notedAt', 'operatorId'];

export async function bindConsentRecord(c, record, opts = {}) {
 requireV05Action(c, 'bindConsent');
 if (record === null || record === undefined) {
 if (c.caseMeta) delete c.caseMeta.consentRecord;
 } else {
 if (!record || typeof record !== 'object') throw new Error('consentRecord must be an object');
 if (record.basis !== undefined && !CONSENT_BASIS.includes(record.basis)) {
 throw new Error('consentRecord.basis must be one of: ' + CONSENT_BASIS.join(', '));
 }
 const r = {};
 for (const k of CONSENT_KEYS) {
 if (record[k] !== undefined) {
 if (typeof record[k] !== 'string') throw new Error('consentRecord.' + k + ' must be a string');
 r[k] = record[k];
 }
 }
 if (!r.basis) throw new Error('consentRecord.basis is required (e.g. consent | legalCompulsion)');
 r.notedAt = r.notedAt || new Date().toISOString();
 c.caseMeta = c.caseMeta || {};
 c.caseMeta.consentRecord = r;
 }
 return rehash(c); // hash-bound: setting/clearing changes rootHash & sealHash
}

// --- v0.5 affidavit / sworn declaration (HASH-BOUND, participates in rootHash & sealHash) ---------
// A formal, court-facing declaration by the collector (US-style affidavit / EU statutory declaration).
// The rendered affidavit text references the case sealHash, so the printed declaration is tied to the
// sealed record and any alteration surfaces as `tampered`. Hash-bound (integrity-protected), but the
// declaration is the declarant's attestation — it is NOT a signature / trust root and never replaces one.
const AFFIDAVIT_KEYS = ['declarant', 'declarantTitle', 'jurisdiction', 'declaredAt', 'operatorId'];

export async function bindAffidavit(c, affidavit, opts = {}) {
 requireV05Action(c, 'bindAffidavit');
 if (affidavit === null || affidavit === undefined) {
 if (c.caseMeta) delete c.caseMeta.affidavit;
 } else {
 if (!affidavit || typeof affidavit !== 'object') throw new Error('affidavit must be an object');
 if (typeof affidavit.declarant !== 'string' || !affidavit.declarant.trim()) throw new Error('affidavit.declarant is required');
 if (!Array.isArray(affidavit.statements) || affidavit.statements.length === 0) {
 throw new Error('affidavit.statements must be a non-empty array of strings');
 }
 const statements = [];
 for (const s of affidavit.statements) {
 if (typeof s !== 'string' || !s.trim()) throw new Error('affidavit.statements entries must be non-empty strings');
 statements.push(s);
 }
 const a = { declarant: affidavit.declarant.trim() };
 for (const k of AFFIDAVIT_KEYS) {
 if (k === 'declarant') continue;
 if (affidavit[k] !== undefined) {
 if (typeof affidavit[k] !== 'string') throw new Error('affidavit.' + k + ' must be a string');
 a[k] = affidavit[k];
 }
 }
 a.statements = statements;
 a.declaredAt = a.declaredAt || new Date().toISOString();
 c.caseMeta = c.caseMeta || {};
 c.caseMeta.affidavit = a;
 }
 return rehash(c); // hash-bound
}

// --- v0.5 transfer receipt / handover acknowledgment (HASH-BOUND, a custodyLog Transferred event) ----
// A legal handover is incomplete without the RECIPIENT's acknowledgment. recordTransferReceipt appends a
// `Transferred` custody event carrying a `recipient` block (name / title / org / acknowledged / optional
// signature sha256). It is hash-bound (custodyLog is part of rootHash & sealHash), so a tampered or
// missing receipt surfaces as `tampered`. This closes the chain-of-custody gap at the "hand-off" node.
export async function recordTransferReceipt(c, receipt, opts = {}) {
 requireV05Action(c, 'recordTransferReceipt');
 requireApproval(c, 'transfer'); // multi-control gate (no-op unless a policy requires 'transfer')
 if (!receipt || typeof receipt !== 'object') throw new Error('receipt must be an object');
 const r = receipt.recipient || receipt;
 if (typeof r.name !== 'string' || !r.name.trim()) throw new Error('receipt.recipient.name is required');
 const rec = {
 name: r.name.trim(),
 title: typeof r.title === 'string' ? r.title : '',
 org: typeof r.org === 'string' ? r.org : '',
 acknowledged: r.acknowledged === true,
 signatureSha256: typeof r.signatureSha256 === 'string' ? r.signatureSha256 : '',
 receivedAt: (typeof r.receivedAt === 'string' && r.receivedAt) ? r.receivedAt : new Date().toISOString()
 };
 c.custodyLog = c.custodyLog || [];
 c.custodyLog.push({
 eventType: 'Transferred',
 utc: rec.receivedAt,
 ianaTz: opts.ianaTz || 'UTC',
 actorName: '',
 actorTitle: '',
 transferPurpose: null,
 scope: 'all',
 note: opts.note || '',
 evidenceId: (typeof receipt.evidenceId === 'string' && receipt.evidenceId) ? receipt.evidenceId : null,
 recipient: rec
 });
 return rehash(c); // hash-bound
}

// --- v0.5 Bates numbering (US litigation standard sequential numbering) ----------------------------
// `caseMeta.bates` is ADDITIVE non-trust config (prefix + next counter). Per-child `batesId` is assigned
// and lives on the child (like `exhibitId`): it enters rootHash only, never sealHash, so the v0.4 sealHash
// stays byte-identical. Bates is a LABELING convenience, not a trust claim.
export async function configureBates(c, cfg, opts = {}) {
 requireV05Action(c, 'configureBates');
 c.caseMeta = c.caseMeta || {};
 const b = c.caseMeta.bates || { enabled: false, prefix: '', next: 1 };
 if (cfg && cfg.enabled !== undefined) b.enabled = !!cfg.enabled;
 if (cfg && cfg.prefix !== undefined) b.prefix = String(cfg.prefix || '');
 if (cfg && cfg.next !== undefined) {
 const n = parseInt(cfg.next, 10);
 if (!Number.isFinite(n) || n < 1) throw new Error('bates.next must be an integer >= 1');
 b.next = n;
 }
 c.caseMeta.bates = b;
 return rehash(c);
}

export async function assignBates(c, evidenceId, opts = {}) {
 requireV05Action(c, 'assignBates');
 const b = (c.caseMeta && c.caseMeta.bates) || { enabled: false, prefix: '', next: 1 };
 if (!b.enabled) throw new Error('bates numbering is not enabled (configureBates first)');
 const child = (c.children || []).find((ch) => ch.evidenceId === evidenceId);
 if (!child) throw new Error('child evidence not found: ' + evidenceId);
 const num = b.next || 1;
 child.batesId = b.prefix + String(num).padStart(5, '0');
 b.next = num + 1;
 c.caseMeta = c.caseMeta || {};
 c.caseMeta.bates = b;
 return rehash(c);
}

// --- v0.5 Witness endorsement (HASH-BOUND; see addWitnessStatement) --------------------------------
// A formal third-party witness attestation. Like affidavit, it is a credibility claim and is
// integrity-protected (enters rootHash & sealHash); any post-seal alteration surfaces as `tampered`.
const WITNESS_KEYS = ['witnessName', 'witnessTitle', 'witnessedAt', 'operatorId'];

export async function addWitnessStatement(c, stmt, opts = {}) {
 requireV05Action(c, 'addWitness');
 if (!stmt || typeof stmt !== 'object') throw new Error('witness statement must be an object');
 if (typeof stmt.witnessName !== 'string' || !stmt.witnessName.trim()) throw new Error('witnessName is required');
 if (typeof stmt.statement !== 'string' || !stmt.statement.trim()) throw new Error('statement is required');
 const w = { witnessName: stmt.witnessName.trim(), statement: stmt.statement.trim() };
 for (const k of WITNESS_KEYS) {
 if (stmt[k] !== undefined) {
 if (typeof stmt[k] !== 'string') throw new Error('witness.' + k + ' must be a string');
 w[k] = stmt[k];
 }
 }
 w.witnessedAt = w.witnessedAt || new Date().toISOString();
 c.caseMeta = c.caseMeta || {};
 c.caseMeta.witnessStatements = c.caseMeta.witnessStatements || [];
 c.caseMeta.witnessStatements.push(w);
 return rehash(c); // hash-bound
}

// --- v0.5 Retention / legal hold (HASH-BOUND; see setRetention) ------------------------------------
// Litigation hold + retention policy marker. A legally significant status, so it is integrity-protected
// (enters rootHash & sealHash); post-seal alteration surfaces as `tampered`. The hold is set before
// sealing; after sealing all writes (including this) are rejected.
const RETENTION_KEYS = ['policy', 'holdUntil', 'holdReason', 'operatorId'];

export async function setRetention(c, cfg, opts = {}) {
 requireV05Action(c, 'setRetention');
 c.caseMeta = c.caseMeta || {};
 const r = c.caseMeta.retention || {};
 if (cfg && cfg.legalHold !== undefined) r.legalHold = !!cfg.legalHold;
 if (cfg && cfg.policy !== undefined) r.policy = String(cfg.policy || '');
 if (cfg && cfg.holdUntil !== undefined) r.holdUntil = cfg.holdUntil ? String(cfg.holdUntil) : '';
 if (cfg && cfg.holdReason !== undefined) r.holdReason = cfg.holdReason ? String(cfg.holdReason) : '';
 if (cfg && cfg.operatorId !== undefined) r.operatorId = String(cfg.operatorId || '');
 r.notedAt = new Date().toISOString();
 c.caseMeta.retention = r;
 return rehash(c); // hash-bound
}

// --- v0.5 Media redaction (rootHash-only derivative record, OUTSIDE sealHash; see addMediaRedaction) -
// Visual redaction (blur / pixelate / crop / blackout of faces / plates) produces a DERIVATIVE media
// copy. The ORIGINAL evidence media is NEVER altered (it remains the integrity-bound record). We store
// BOTH the original and the redacted digest (mirroring the watermark dual-digest pattern) so the
// redaction is transparent and auditable. This is a derivative annotation, so it lives at top level and
// is excluded from sealHash (rootHash only) — it never substitutes for or weakens original evidence.
const REDACTION_METHODS = ['blur', 'pixelate', 'crop', 'blackout'];

export async function addMediaRedaction(c, redaction, opts = {}) {
 requireV05Action(c, 'addMediaRedaction');
 if (!redaction || typeof redaction !== 'object') throw new Error('redaction must be an object');
 if (typeof redaction.evidenceId !== 'string' || !redaction.evidenceId.trim()) throw new Error('redaction.evidenceId is required');
 if (typeof redaction.originalSha256 !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(redaction.originalSha256)) throw new Error('redaction.originalSha256 must be sha256:<64hex>');
 if (typeof redaction.redactedSha256 !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(redaction.redactedSha256)) throw new Error('redaction.redactedSha256 must be sha256:<64hex>');
 const region = redaction.region && typeof redaction.region === 'object' ? redaction.region : {};
 const rc = {
 evidenceId: redaction.evidenceId.trim(),
 region: { x: Number(region.x) || 0, y: Number(region.y) || 0, w: Number(region.w) || 0, h: Number(region.h) || 0 },
 method: REDACTION_METHODS.includes(redaction.method) ? redaction.method : 'blur',
 originalSha256: redaction.originalSha256,
 redactedSha256: redaction.redactedSha256,
 redactedAt: (typeof redaction.redactedAt === 'string' && redaction.redactedAt) ? redaction.redactedAt : new Date().toISOString(),
 operatorId: typeof redaction.operatorId === 'string' ? redaction.operatorId : ''
 };
 c.mediaRedactions = c.mediaRedactions || [];
 c.mediaRedactions.push(rc);
 return rehash(c); // rootHash only; outside sealHash (derivative annotation)
}

// --- v0.5 Multi-person multi-control / dual-control approval gate (rootHash-only; see setApprovalPolicy)
// Configurable k-of-n approval policy that HARD-gates sensitive actions (seal / export / transfer). This is
// a pre-action AUTHORISATION gate, DISTINCT from countersignature (which is additive attestation that never
// blocks an action). Approvals live at top level and enter rootHash only (outside the sealHash aggregate) so
// they are tamper-evident without altering the v0.4 sealHash bytes. With no policy set the gate is a no-op
// (backward compatible). Authored identities are recorded as metadata only — no cryptographic signature is
// required here (eIDAS QES is explicitly out of scope per project red lines).
const APPROVAL_ACTIONS = ['seal', 'export', 'transfer'];
const APPROVAL_METHODS = ['operatorProfile', 'certificate', 'externalIdP'];

export async function setApprovalPolicy(c, cfg, opts = {}) {
 requireV05Action(c, 'setApprovalPolicy');
 cfg = cfg || {};
 const requiredK = cfg.requiredK;
 const totalN = cfg.totalN;
 if (!Number.isInteger(requiredK) || requiredK < 2) throw new Error('approvalPolicy.requiredK must be an integer >= 2');
 if (!Number.isInteger(totalN) || totalN < requiredK) throw new Error('approvalPolicy.totalN must be an integer >= requiredK (and >= 2)');
 const actions = Array.isArray(cfg.actions) && cfg.actions.length
 ? cfg.actions.filter((a) => APPROVAL_ACTIONS.includes(a))
 : APPROVAL_ACTIONS.slice();
 if (!actions.length) throw new Error('approvalPolicy.actions must be a non-empty subset of ' + APPROVAL_ACTIONS.join(''));
 c.approvalPolicy = {
 requiredK, totalN, actions,
 setAt: isoUtcNow(),
 operatorId: typeof cfg.operatorId === 'string' ? cfg.operatorId : ''
 };
 // Reset derived authorisation status so a re-configured policy re-evaluates from scratch.
 c.approvalStatus = {};
 return rehash(c);
}

export async function recordApproval(c, approval, opts = {}) {
 requireV05Action(c, 'recordApproval');
 if (!c.approvalPolicy) throw new Error('no approval policy set (call setApprovalPolicy first)');
 if (!approval || typeof approval !== 'object') throw new Error('approval must be an object');
 const action = approval.action;
 if (!APPROVAL_ACTIONS.includes(action) || !c.approvalPolicy.actions.includes(action)) {
 throw new Error('approval.action must be in policy.actions');
 }
 const approverId = typeof approval.approverId === 'string' ? approval.approverId.trim() : '';
 if (!approverId) throw new Error('approval.approverId is required');
 const method = APPROVAL_METHODS.includes(approval.method) ? approval.method : 'operatorProfile';
 c.approvals = c.approvals || [];
 if (c.approvals.some((a) => a.action === action && a.approverId === approverId)) {
 throw new Error('approver ' + approverId + ' already approved action ' + action);
 }
 c.approvals.push({
 action,
 approverId,
 approverName: typeof approval.approverName === 'string' ? approval.approverName.trim() : '',
 method,
 proof: typeof approval.proof === 'string' ? approval.proof : '',
 approvedAt: (typeof approval.approvedAt === 'string' && approval.approvedAt) ? approval.approvedAt : isoUtcNow()
 });
 const count = new Set(c.approvals.filter((a) => a.action === action).map((a) => a.approverId)).size;
 c.approvalStatus = c.approvalStatus || {};
 c.approvalStatus[action] = count >= c.approvalPolicy.requiredK ? 'authorized' : 'pending';
 return rehash(c);
}

// Hard gate: throws if a policy is active for `action` and it has not yet reached `authorized`.
// Synchronous (no hashing) so it can guard sealCase / recordTransferReceipt / export directly.
export function requireApproval(c, action) {
 if (!c.approvalPolicy || !c.approvalPolicy.actions.includes(action)) return; // gate inactive
 if (c.approvalStatus && c.approvalStatus[action] === 'authorized') return;
 throw new Error('action "' + action + '" requires ' + c.approvalPolicy.requiredK + '-of-' + c.approvalPolicy.totalN + ' approval (policy active)');
}

// --- v0.5 Geographic attestation (rootHash-only; see recordGeoAttestation) ----------------------------
// Location attestation bound to a (sensitive) action or capture. Enters rootHash only (top level, outside
// the sealHash aggregate) so it is tamper-evident without altering the v0.4 sealHash bytes. method/source
// are recorded for transparency; this is a factual position claim, not a cryptographic fix.
const GEO_METHODS = ['gps', 'network', 'cell', 'manual'];

export async function recordGeoAttestation(c, geo, opts = {}) {
 requireV05Action(c, 'recordGeoAttestation');
 if (!geo || typeof geo !== 'object') throw new Error('geo attestation must be an object');
 const lat = Number(geo.latitude);
 const lon = Number(geo.longitude);
 if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error('geo.latitude must be a number in [-90, 90]');
 if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new Error('geo.longitude must be a number in [-180, 180]');
 const acc = geo.accuracyMeters === undefined ? 0 : Number(geo.accuracyMeters);
 if (!Number.isFinite(acc) || acc < 0) throw new Error('geo.accuracyMeters must be a number >= 0');
 const method = GEO_METHODS.includes(geo.method) ? geo.method : 'gps';
 c.geoAttestations = c.geoAttestations || [];
 c.geoAttestations.push({
 latitude: lat,
 longitude: lon,
 accuracyMeters: acc,
 source: typeof geo.source === 'string' ? geo.source : '',
 method,
 linkedAction: typeof geo.linkedAction === 'string' ? geo.linkedAction : '',
 linkedRef: typeof geo.linkedRef === 'string' ? geo.linkedRef : '',
 attestedAt: (typeof geo.attestedAt === 'string' && geo.attestedAt) ? geo.attestedAt : isoUtcNow()
 });
 return rehash(c); // rootHash only; outside sealHash
}

export function validateCaseManifest(obj) {
 const errors = [];
 if (!obj || typeof obj !== 'object') return { ok: false, errors: ['not an object'] };
 if (obj.spec !== CASE_SPEC) errors.push('spec must be ' + CASE_SPEC);
 if (!CASE_STATES.includes(obj.state)) errors.push('invalid state: ' + obj.state);
 if (!obj.schemaDef || !Array.isArray(obj.schemaDef.globalFields) || !Array.isArray(obj.schemaDef.itemFields)) errors.push('schemaDef malformed');
 if (!Array.isArray(obj.children) || !Array.isArray(obj.custodyLog) || !Array.isArray(obj.schemaChangeLog)) errors.push('case arrays malformed');
 if (obj.state === 'sealed' && (!obj.sealHash || !obj.sealedAt)) errors.push('sealed case must carry sealHash and sealedAt');
 if (obj.hashAlgorithm && !HASH_ALGORITHMS.includes(obj.hashAlgorithm)) errors.push('unsupported hashAlgorithm');
 // Version gate: specVersion is the ONLY selector of an aggregation path. Unknown values are
 // refused outright. A missing value is BOUND to the frozen v0.2 legacy contract, never guessed
 // from field shapes. We deliberately do not require the four v0.3 fields to be present here:
 // stripping them is an attack on rootHash and must surface as `tampered`, not a shape veto.
 if (obj.specVersion !== undefined && typeof obj.specVersion !== 'string') errors.push('specVersion must be a string');
 if (obj.specVersion !== undefined && !CASE_SPEC_VERSIONS.includes(obj.specVersion)) {
 errors.push('unknown specVersion: ' + String(obj.specVersion));
 }
 // v0.3 fields are OPTIONAL (legacy v0.2 manifests stay valid) but must be well-formed.
 if (obj.schemaLocked !== undefined && typeof obj.schemaLocked !== 'boolean') errors.push('schemaLocked must be boolean');
 if (obj.countersignList !== undefined && !Array.isArray(obj.countersignList)) errors.push('countersignList must be array');
 if (obj.auditLog !== undefined && !Array.isArray(obj.auditLog)) errors.push('auditLog must be array');
 if (obj.caseEncryptionMeta !== undefined && obj.caseEncryptionMeta !== null && typeof obj.caseEncryptionMeta !== 'object') errors.push('caseEncryptionMeta malformed');
 for (const cs of obj.countersignList || []) {
 if (!COUNTERSIGN_DECISIONS.includes(cs.decision)) { errors.push('invalid countersign decision'); break; }
 }
 // v0.4 fields are OPTIONAL at the structural gate: stripping one must surface as `tampered`
 // through rootHash, never as a shape veto. Only well-formedness is checked here.
 if (obj.specVersion === SPEC_VERSION_V04) {
 if (obj.schemaDictionaries !== undefined &&
 (!obj.schemaDictionaries || typeof obj.schemaDictionaries !== 'object' || Array.isArray(obj.schemaDictionaries))) {
 errors.push('schemaDictionaries malformed');
 }
 if (obj.snapshots !== undefined && !Array.isArray(obj.snapshots)) errors.push('snapshots must be array');
 if (obj.thirdPartyNotes !== undefined && !Array.isArray(obj.thirdPartyNotes)) errors.push('thirdPartyNotes must be array');
 if (obj.isDeleted !== undefined && typeof obj.isDeleted !== 'boolean') errors.push('isDeleted must be boolean');
 if (obj.reportBranding !== undefined && (!obj.reportBranding || typeof obj.reportBranding !== 'object' || Array.isArray(obj.reportBranding))) {
 errors.push('reportBranding malformed');
 }
 if (obj.watermarkConfig !== undefined && (!obj.watermarkConfig || typeof obj.watermarkConfig !== 'object' || Array.isArray(obj.watermarkConfig))) {
 errors.push('watermarkConfig malformed');
 }
 for (const n of obj.thirdPartyNotes || []) {
 if (!NOTE_DECISIONS.includes(n.decision)) { errors.push('invalid third-party note decision'); break; }
 }
 }
 // v0.5 additive case-layer fields (operatorProfile / exhibitId / human_note). OPTIONAL and
 // additive: stripping one must surface as `tampered` through rootHash, never a shape veto. Only
 // well-formedness is checked here.
 if (obj.specVersion === SPEC_VERSION_V04 || obj.specVersion === SPEC_VERSION_V05) {
 const op = obj.caseMeta && obj.caseMeta.operatorProfile;
 if (op !== undefined && op !== null) {
 if (typeof op !== 'object' || Array.isArray(op)) errors.push('operatorProfile malformed');
 else {
 for (const k of ['operatorName', 'operatorTitle', 'orgId', 'operatorId']) {
 if (op[k] !== undefined && typeof op[k] !== 'string') errors.push('operatorProfile.' + k + ' must be a string');
 }
 }
 }
 const oi = obj.caseMeta && obj.caseMeta.operatorIdentity;
 if (oi !== undefined && oi !== null) {
 if (typeof oi !== 'object' || Array.isArray(oi)) errors.push('operatorIdentity malformed');
 else {
 for (const k of ['operatorId', 'fullName', 'badgeId', 'org', 'role', 'contactRef', 'signatureFingerprint']) {
 if (oi[k] !== undefined && typeof oi[k] !== 'string') errors.push('operatorIdentity.' + k + ' must be a string');
 }
 }
 }
 const hn = obj.caseMeta && obj.caseMeta.humanNotes;
 if (hn !== undefined && hn !== null) {
 if (!Array.isArray(hn)) errors.push('humanNotes must be an array');
 else for (const n of hn) {
 if (typeof n !== 'object' || n === null) { errors.push('humanNotes entry malformed'); continue; }
 if (!['field', 'audit'].includes(n.noteType)) errors.push('humanNotes.noteType invalid');
 if (typeof n.content !== 'string' || !n.content.trim()) errors.push('humanNotes.content required');
 if (n.createdAt !== undefined && typeof n.createdAt !== 'string') errors.push('humanNotes.createdAt must be string');
 if (n.authorOperatorId !== undefined && typeof n.authorOperatorId !== 'string') errors.push('humanNotes.authorOperatorId must be string');
 }
 }
 const cr = obj.caseMeta && obj.caseMeta.consentRecord;
 if (cr !== undefined && cr !== null) {
 if (typeof cr !== 'object' || Array.isArray(cr)) errors.push('consentRecord malformed');
 else {
 if (cr.basis !== undefined && !['consent', 'legalCompulsion', 'publicInterest', 'contractual', 'vitalInterest', 'other'].includes(cr.basis)) {
 errors.push('consentRecord.basis invalid');
 }
 for (const k of ['authorityRef', 'consentBy', 'basisDetail', 'notedAt', 'operatorId']) {
 if (cr[k] !== undefined && typeof cr[k] !== 'string') errors.push('consentRecord.' + k + ' must be a string');
 }
 }
 }
 const af = obj.caseMeta && obj.caseMeta.affidavit;
 if (af !== undefined && af !== null) {
 if (typeof af !== 'object' || Array.isArray(af)) errors.push('affidavit malformed');
 else {
 if (typeof af.declarant !== 'string' || !af.declarant.trim()) errors.push('affidavit.declarant required');
 if (!Array.isArray(af.statements) || af.statements.length === 0) errors.push('affidavit.statements must be a non-empty array');
 else for (const s of af.statements) if (typeof s !== 'string' || !s.trim()) errors.push('affidavit.statements entries must be non-empty strings');
 for (const k of ['declarantTitle', 'jurisdiction', 'declaredAt', 'operatorId']) {
 if (af[k] !== undefined && typeof af[k] !== 'string') errors.push('affidavit.' + k + ' must be a string');
 }
 }
 }
 for (const ev of obj.custodyLog || []) {
 if (ev && typeof ev === 'object' && ev.recipient !== undefined && ev.recipient !== null) {
 const rcp = ev.recipient;
 if (typeof rcp !== 'object' || Array.isArray(rcp)) { errors.push('custodyLog recipient block malformed'); continue; }
 if (typeof rcp.name !== 'string' || !rcp.name.trim()) errors.push('custodyLog recipient.name required');
 for (const k of ['title', 'org', 'signatureSha256', 'receivedAt']) {
 if (rcp[k] !== undefined && typeof rcp[k] !== 'string') errors.push('custodyLog recipient.' + k + ' must be a string');
 }
 if (rcp.acknowledged !== undefined && typeof rcp.acknowledged !== 'boolean') errors.push('custodyLog recipient.acknowledged must be boolean');
 }
 }
 const es = obj.caseMeta && obj.caseMeta.envSnapshot;
 if (es !== undefined && es !== null) {
 if (typeof es !== 'object' || Array.isArray(es)) errors.push('envSnapshot malformed');
 else for (const k of ['capturedAt', 'userAgent', 'language', 'languages', 'timezone', 'screenWidth', 'screenHeight', 'online', 'capturePageUrl', 'docTitle']) {
 if (es[k] !== undefined && typeof es[k] !== 'string') errors.push('envSnapshot.' + k + ' must be a string');
 }
 }
 const ts = obj.caseMeta && obj.caseMeta.tsaTimestamps;
 if (ts !== undefined && ts !== null) {
 if (!Array.isArray(ts)) errors.push('tsaTimestamps must be an array');
 else for (const t of ts) {
 if (typeof t !== 'object' || t === null) { errors.push('tsaTimestamps entry malformed'); continue; }
 if (t.status !== 'fetched' && t.status !== 'pending') errors.push('tsaTimestamps.status invalid');
 if (t.hashHex !== undefined && typeof t.hashHex !== 'string') errors.push('tsaTimestamps.hashHex must be string');
 if (t.rawTokenB64 !== undefined && typeof t.rawTokenB64 !== 'string') errors.push('tsaTimestamps.rawTokenB64 must be string');
 if (t.genTime !== undefined && typeof t.genTime !== 'string') errors.push('tsaTimestamps.genTime must be string');
 }
 }
 // --- v0.5 Bates / witness / retention / media-redaction well-formedness (additive or hash-bound) ---
 const batesCfg = obj.caseMeta && obj.caseMeta.bates;
 if (batesCfg !== undefined && batesCfg !== null) {
 if (typeof batesCfg !== 'object' || Array.isArray(batesCfg)) errors.push('bates malformed');
 else {
 if (batesCfg.enabled !== undefined && typeof batesCfg.enabled !== 'boolean') errors.push('bates.enabled must be boolean');
 if (batesCfg.prefix !== undefined && typeof batesCfg.prefix !== 'string') errors.push('bates.prefix must be string');
 if (batesCfg.next !== undefined && (!Number.isInteger(batesCfg.next) || batesCfg.next < 1)) errors.push('bates.next must be integer >= 1');
 }
 }
 const ret = obj.caseMeta && obj.caseMeta.retention;
 if (ret !== undefined && ret !== null) {
 if (typeof ret !== 'object' || Array.isArray(ret)) errors.push('retention malformed');
 else {
 if (ret.legalHold !== undefined && typeof ret.legalHold !== 'boolean') errors.push('retention.legalHold must be boolean');
 for (const k of ['policy', 'holdUntil', 'holdReason', 'operatorId', 'notedAt']) {
 if (ret[k] !== undefined && typeof ret[k] !== 'string') errors.push('retention.' + k + ' must be a string');
 }
 }
 }
 const ws = obj.caseMeta && obj.caseMeta.witnessStatements;
 if (ws !== undefined && ws !== null) {
 if (!Array.isArray(ws)) errors.push('witnessStatements must be an array');
 else for (const w of ws) {
 if (typeof w !== 'object' || w === null) { errors.push('witnessStatements entry malformed'); continue; }
 if (typeof w.witnessName !== 'string' || !w.witnessName.trim()) errors.push('witnessStatements.witnessName required');
 if (typeof w.statement !== 'string' || !w.statement.trim()) errors.push('witnessStatements.statement required');
 for (const k of ['witnessTitle', 'witnessedAt', 'operatorId']) {
 if (w[k] !== undefined && typeof w[k] !== 'string') errors.push('witnessStatements.' + k + ' must be a string');
 }
 }
 }
 if (obj.mediaRedactions !== undefined && obj.mediaRedactions !== null) {
 if (!Array.isArray(obj.mediaRedactions)) errors.push('mediaRedactions must be an array');
 else for (const m of obj.mediaRedactions) {
 if (typeof m !== 'object' || m === null) { errors.push('mediaRedactions entry malformed'); continue; }
 if (typeof m.evidenceId !== 'string' || !m.evidenceId.trim()) errors.push('mediaRedactions.evidenceId required');
 if (typeof m.originalSha256 !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(m.originalSha256)) errors.push('mediaRedactions.originalSha256 must be sha256:<64hex>');
 if (typeof m.redactedSha256 !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(m.redactedSha256)) errors.push('mediaRedactions.redactedSha256 must be sha256:<64hex>');
 if (m.method !== undefined && !['blur', 'pixelate', 'crop', 'blackout'].includes(m.method)) errors.push('mediaRedactions.method invalid');
 if (m.region !== undefined && (typeof m.region !== 'object' || Array.isArray(m.region))) errors.push('mediaRedactions.region must be object');
 for (const k of ['redactedAt', 'operatorId']) {
 if (m[k] !== undefined && typeof m[k] !== 'string') errors.push('mediaRedactions.' + k + ' must be a string');
 }
 }
 }
 const ap = obj.approvalPolicy;
 if (ap !== undefined && ap !== null) {
 if (typeof ap !== 'object' || Array.isArray(ap)) errors.push('approvalPolicy malformed');
 else {
 if (!Number.isInteger(ap.requiredK) || ap.requiredK < 2) errors.push('approvalPolicy.requiredK must be integer >= 2');
 if (!Number.isInteger(ap.totalN) || ap.totalN < ap.requiredK) errors.push('approvalPolicy.totalN must be integer >= requiredK');
 if (!Array.isArray(ap.actions) || !ap.actions.length) errors.push('approvalPolicy.actions must be non-empty array');
 else for (const a of ap.actions) if (typeof a !== 'string') errors.push('approvalPolicy.actions entries must be strings');
 }
 }
 if (obj.approvals !== undefined && obj.approvals !== null) {
 if (!Array.isArray(obj.approvals)) errors.push('approvals must be an array');
 else for (const a of obj.approvals) {
 if (typeof a !== 'object' || a === null) { errors.push('approvals entry malformed'); continue; }
 if (typeof a.approverId !== 'string' || !a.approverId.trim()) errors.push('approvals.approverId required');
 if (typeof a.action !== 'string') errors.push('approvals.action required');
 if (a.method !== undefined && typeof a.method !== 'string') errors.push('approvals.method must be string');
 if (a.proof !== undefined && typeof a.proof !== 'string') errors.push('approvals.proof must be string');
 }
 }
 const ga = obj.geoAttestations;
 if (ga !== undefined && ga !== null) {
 if (!Array.isArray(ga)) errors.push('geoAttestations must be an array');
 else for (const g of ga) {
 if (typeof g !== 'object' || g === null) { errors.push('geoAttestations entry malformed'); continue; }
 if (typeof g.latitude !== 'number' || g.latitude < -90 || g.latitude > 90) errors.push('geoAttestations.latitude must be number in [-90,90]');
 if (typeof g.longitude !== 'number' || g.longitude < -180 || g.longitude > 180) errors.push('geoAttestations.longitude must be number in [-180,180]');
 if (g.accuracyMeters !== undefined && (typeof g.accuracyMeters !== 'number' || g.accuracyMeters < 0)) errors.push('geoAttestations.accuracyMeters must be number >= 0');
 for (const k of ['source', 'method', 'linkedAction', 'linkedRef', 'attestedAt']) {
 if (g[k] !== undefined && typeof g[k] !== 'string') errors.push('geoAttestations.' + k + ' must be string');
 }
 }
 }
 for (const ch of obj.children || []) {
 if (ch.exhibitId !== undefined && typeof ch.exhibitId !== 'string') errors.push('children[].exhibitId must be a string');
 if (ch.batesId !== undefined && typeof ch.batesId !== 'string') errors.push('children[].batesId must be a string');
 }
 for (const e of obj.auditLog || []) {
 if (e && e.eventType === 'HUMAN_NOTE' && (e.payload === undefined || typeof e.payload.noteText !== 'string')) {
 errors.push('human_note requires payload.noteText string');
 }
 }
 }
 return { ok: errors.length === 0, errors };
}

export async function verifyCase(c, opts = {}) {
 const errors = [];
 const specVersion = resolveSpecVersion(c);
 const struct = validateCaseManifest(c);
 if (!struct.ok) return { coreResult: 'invalid_spec', specVersion, errors: struct.errors, sealHash: '', rootHash: '', children: [] };

 let computedRoot, computedSeal;
 try {
 computedRoot = await computeRootHash(c);
 computedSeal = await computeSealHash(c);
 } catch (e) {
 return {
 coreResult: 'invalid_spec', specVersion,
 errors: ['non-canonical manifest: ' + (e.message || String(e))],
 sealHash: '', rootHash: '', children: []
 };
 }
 if (computedRoot !== c.rootHash) errors.push('rootHash mismatch');
 if (c.state === 'sealed' && computedSeal !== c.sealHash) errors.push('sealHash mismatch');
 if (!c.sealHash) errors.push('missing sealHash');

 const children = [];
 for (const child of c.children || []) {
 let res = { packageId: child.packageId, rootHash: child.rootHash, coreResult: 'ok' };
 if (typeof opts.verifyChild === 'function') {
 try { res = await opts.verifyChild(child); } catch (e) { res = { packageId: child.packageId, rootHash: child.rootHash, coreResult: 'tampered', error: String(e.message || e) }; }
 }
 if (res.rootHash && child.rootHash && res.rootHash !== child.rootHash) { res.coreResult = 'tampered'; res.error = 'child rootHash mismatch'; }
 if (res.coreResult !== 'ok') errors.push('child ' + child.packageId + ' ' + res.coreResult);
 children.push(res);
 }

 const coreResult = errors.length ? 'tampered' : 'ok';
 return { coreResult, specVersion, sealHash: computedSeal, rootHash: computedRoot, children, errors };
}
