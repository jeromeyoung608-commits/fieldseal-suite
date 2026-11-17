/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
import { canonicalJson, computeRootHash, isoUtcNow, uuidV4, sha256Uri, isHash } from './hash.js';
import { buildZip, inspectBlob } from './zip-builder.js';
import { readZip } from './zip-reader.js';

export const SIGNATURE_SPEC = 'fieldseal-signature-v0.1';
export const DRAFT_MODE = 'DRAFT MODE';
export const SEALED_MODE = 'SEALED LOCKED MODE';

// Signing mode is an informational, non-schema field. It is NOT stored in the
// (frozen) manifest; instead it travels inside an aux attachment that never
// enters the root hash. The CLI surfaces it via the verify output `pluginExtras`.
export const SIGN_MODES = ['joint', 'independent'];
export const DEFAULT_MODE_NOTE = {
 joint: 'joint confirmation record',
 independent: 'independent mode does not enforce approval workflow'
};

const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const OFFSET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DECIMAL_RE = /^-?\d+(?:\.\d+)?$/;

const EVIDENCE_KEYS = {
 'fieldseal-evidence-v0.1': ['spec', 'packageId', 'rootHash', 'createdAt', 'files'],
 'fieldseal-evidence-v0.2': ['spec', 'packageId', 'rootHash', 'createdAt', 'captureTsDevice', 'gps', 'note', 'tags', 'files', 'mp4SanityCheck']
};

// Controlled, backward-compatible optional extensions for evidence manifests.
const EVIDENCE_OPTIONAL = ['supersedesPackageId', 'revisionReason', 'tzIana'];
const PARTY_OPTIONAL_KEYS = ['role', 'organization', 'referenceId', 'licenseNo', 'reservation', 'tzIana'];

function sameKeys(object, keys) {
 const actual = Object.keys(object).sort();
 const expected = keys.slice().sort();
 return actual.length === expected.length && actual.every((key, i) => key === expected[i]);
}

function validateEvidenceStructure(manifest) {
 const problems = [];
 if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return ['manifest is not an object'];
 const keys = EVIDENCE_KEYS[manifest.spec];
 if (!keys) return ['unsupported evidence spec'];
 if (!keys.every((k) => k in manifest)) problems.push('manifest missing required keys');
 const allowed = new Set([...keys, ...EVIDENCE_OPTIONAL]);
 const extra = Object.keys(manifest).filter((k) => !allowed.has(k));
 if (extra.length) problems.push('manifest has unknown keys: ' + extra.join(','));
 if (!isHash(manifest.rootHash)) problems.push('rootHash format');
 if (!UUID_V4_RE.test(String(manifest.packageId))) problems.push('packageId must be UUID v4');
 if (!UTC_RE.test(String(manifest.createdAt))) problems.push('createdAt must be ISO8601 UTC');
 if (!Array.isArray(manifest.files)) problems.push('files must be an array');
 else manifest.files.forEach((file, i) => {
 if (!file || typeof file !== 'object' || !sameKeys(file, ['name', 'hash', 'type'])) { problems.push('files[' + i + '] key set'); return; }
 if (!NAME_RE.test(String(file.name))) problems.push('files[' + i + '].name violates C5');
 if (!isHash(file.hash)) problems.push('files[' + i + '].hash format');
 if (file.type !== 'image' && file.type !== 'video') problems.push('files[' + i + '].type');
 });
 if ('supersedesPackageId' in manifest && manifest.supersedesPackageId !== '' && !UUID_V4_RE.test(manifest.supersedesPackageId)) problems.push('supersedesPackageId format');
 if ('revisionReason' in manifest && typeof manifest.revisionReason !== 'string') problems.push('revisionReason');
 if ('tzIana' in manifest && typeof manifest.tzIana !== 'string') problems.push('tzIana');
 if (manifest.spec === 'fieldseal-evidence-v0.2') {
 if (!OFFSET_RE.test(String(manifest.captureTsDevice))) problems.push('captureTsDevice format');
 if (!manifest.gps || !sameKeys(manifest.gps, ['lat', 'lon'])) problems.push('gps key set');
 else {
 if (typeof manifest.gps.lat !== 'string' || !DECIMAL_RE.test(manifest.gps.lat)) problems.push('gps.lat');
 if (typeof manifest.gps.lon !== 'string' || !DECIMAL_RE.test(manifest.gps.lon)) problems.push('gps.lon');
 }
 if (typeof manifest.note !== 'string') problems.push('note');
 if (!Array.isArray(manifest.tags) || !manifest.tags.every((tag) => typeof tag === 'string')) problems.push('tags');
 const check = manifest.mp4SanityCheck;
 if (!check || !sameKeys(check, ['status', 'note'])) problems.push('mp4SanityCheck key set');
 else {
 if (!['ok', 'failed', 'skipped'].includes(check.status)) problems.push('mp4SanityCheck.status');
 if (typeof check.note !== 'string') problems.push('mp4SanityCheck.note');
 }
 }
 return problems;
}

export async function inspectEvidencePackage(blob) {
 const handle = await readZip(blob);
 let manifest;
 try {
 manifest = JSON.parse(await handle.readText('manifest.json', MAX_MANIFEST_BYTES));
 } catch (error) {
 return { ok: false, problems: ['manifest.json unreadable: ' + error.message], manifest: null };
 }
 const problems = validateEvidenceStructure(manifest);
 if (problems.length === 0) {
 const computed = await computeRootHash(manifest);
 if (computed !== manifest.rootHash) problems.push('rootHash mismatch');
 const declared = new Set(['manifest.json'].concat(manifest.files.map((file) => file.name)));
 for (const entry of handle.entries) {
 if (entry.name.indexOf('') === -1 && !entry.name.endsWith('') && !declared.has(entry.name)) {
 problems.push('undeclared root entry: ' + entry.name);
 }
 }
 for (const file of manifest.files) {
 if (!handle.getEntry(file.name)) { problems.push('missing declared file: ' + file.name); continue; }
 try {
 if (await handle.hashEntry(file.name) !== file.hash) problems.push('file hash mismatch: ' + file.name);
 } catch (error) {
 problems.push('cannot read declared file: ' + file.name);
 }
 }
 }
 return {
 ok: problems.length === 0,
 problems,
 manifest,
 packageId: manifest.packageId,
 rootHash: manifest.rootHash,
 spec: manifest.spec,
 fileCount: Array.isArray(manifest.files) ? manifest.files.length : 0
 };
}

export async function buildSignatureManifest(options) {
 const parties = (options.parties || []).map((party) => {
 const mapped = {
 name: String(party.name),
 confirm: Boolean(party.confirm),
 signedAt: party.signedAt || isoUtcNow()
 };
 for (const key of PARTY_OPTIONAL_KEYS) {
 if (party[key] !== undefined && party[key] !== '') mapped[key] = party[key];
 }
 return mapped;
 });
 if (!UUID_V4_RE.test(String(options.linkedEvidenceId))) throw new Error('linkedEvidenceId must be the evidence packageId (UUID v4)');
 if (!isHash(options.linkedEvidenceRootHash)) throw new Error('linkedEvidenceRootHash violates C1');
 if (!isHash(options.canvasSnapshotHash)) throw new Error('canvasSnapshotHash violates C1');
 if (parties.length === 0) throw new Error('at least one party is required');
 for (const party of parties) {
 if (!party.name) throw new Error('party name must not be empty');
 if (!UTC_RE.test(party.signedAt)) throw new Error('party signedAt must be ISO8601 UTC');
 }

 const base = {
 spec: SIGNATURE_SPEC,
 packageId: options.packageId || uuidV4(),
 createdAt: options.createdAt || isoUtcNow(),
 linkedEvidenceId: options.linkedEvidenceId,
 linkedEvidenceRootHash: options.linkedEvidenceRootHash,
 parties,
 canvasSnapshotHash: options.canvasSnapshotHash,
 sealNote: String(options.sealNote === undefined || options.sealNote === null ? '' : options.sealNote)
 };
 if (options.tzIana) base.tzIana = String(options.tzIana);
 const rootHash = await computeRootHash(base);
 return Object.assign({}, base, { rootHash });
}

export function canonicalSignatureManifestText(manifest) {
 return canonicalJson(manifest);
}

export function createSealSession() {
 let sealed = false;
 return {
 get mode() { return sealed ? SEALED_MODE : DRAFT_MODE; },
 get sealed() { return sealed; },
 assertDraft() {
 if (sealed) throw new Error('SEALED LOCKED MODE: canvas, parties and note are immutable');
 },
 async seal(input) {
 this.assertDraft();
 const evidence = await inspectEvidencePackage(input.evidenceBlob);
 if (!evidence.ok) throw new Error('evidence package invalid: ' + evidence.problems.join('; '));
 const snapshotHash = await sha256Uri(input.snapshotBlob);
 const signMode = SIGN_MODES.includes(input.signMode) ? input.signMode : 'joint';
 const modeNote = input.modeNote !== undefined ? String(input.modeNote) : DEFAULT_MODE_NOTE[signMode];
 const manifest = await buildSignatureManifest({
 linkedEvidenceId: evidence.manifest.packageId,
 linkedEvidenceRootHash: evidence.manifest.rootHash,
 parties: input.parties,
 canvasSnapshotHash: snapshotHash,
 sealNote: input.sealNote,
 tzIana: input.tzIana
 });
 sealed = true;
 return { manifest, evidence, snapshotHash, signMode, modeNote, mode: SEALED_MODE };
 }
 };
}

export async function buildSignatureRecordZip(manifest, snapshotBlob, opts = {}) {
 const info = await inspectBlob(snapshotBlob);
 if (info.sha256 !== manifest.canvasSnapshotHash) throw new Error('snapshot bytes do not match canvasSnapshotHash');
 const entries = [
 { name: 'manifest.json', data: new TextEncoder().encode(canonicalSignatureManifestText(manifest)) },
 {
 name: 'aux/canvas-snapshot.png',
 blob: snapshotBlob,
 size: info.size,
 crc32: info.crc32,
 sha256: info.sha256
 }
 ];
 const signMode = SIGN_MODES.includes(opts.signMode) ? opts.signMode : 'joint';
 entries.push({
 name: 'aux/sign-mode.json',
 data: JSON.stringify({
 signMode,
 modeNote: opts.modeNote !== undefined ? String(opts.modeNote) : DEFAULT_MODE_NOTE[signMode]
 }, null, 2)
 });
 return buildZip(entries);
}
