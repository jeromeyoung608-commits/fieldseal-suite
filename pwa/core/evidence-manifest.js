/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
import { canonicalJson, computeRootHash, isoUtcNow, isoLocalNow, uuidV4, isHash } from './hash.js';
import { buildZip, inspectBlob } from './zip-builder.js';
import { validateCustody } from './custody.js';

export const EVIDENCE_V01 = 'fieldseal-evidence-v0.1';
export const EVIDENCE_V02 = 'fieldseal-evidence-v0.2';
export const SUPPLEMENT_SPEC = 'fieldseal-supplement-v0.1';
export const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DECIMAL_RE = /^-?\d+(?:\.\d+)?$/;
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function sanitizeFileName(originalName, type, index) {
 const lower = String(originalName || '').toLowerCase();
 const dot = lower.lastIndexOf('.');
 let extension = dot >= 0 ? lower.slice(dot + 1) : '';
 if (!/^[a-z0-9]{1,5}$/.test(extension)) extension = type === 'video' ? 'mp4' : 'jpg';
 const name = (type === 'video' ? 'video' : 'photo') + '-' + index + '.' + extension;
 if (!NAME_RE.test(name)) throw new Error('generated name violates C5: ' + name);
 return name;
}

export function normalizeDecimal(value) {
 const text = String(value === null || value === undefined ? '' : value).trim();
 if (!DECIMAL_RE.test(text)) return '0';
 const number = Number(text);
 if (!Number.isFinite(number)) return '0';
 const normalized = String(Number(number.toFixed(6)));
 return DECIMAL_RE.test(normalized) ? normalized : '0';
}

export async function sanityCheckMedia(blob, type) {
 if (type !== 'video') return { status: 'skipped', note: 'not a video container' };
 const head = new Uint8Array(await blob.slice(0, 8192).arrayBuffer());
 let ascii = '';
 for (let i = 0; i < head.length; i++) ascii += String.fromCharCode(head[i]);
 if (ascii.slice(4, 8) !== 'ftyp') {
 return { status: 'skipped', note: 'container check skipped for non-ISO-BMFF media' };
 }
 return ascii.indexOf('moov') !== -1 || ascii.indexOf('mdat') !== -1
 ? { status: 'ok', note: 'moov/mdat segment found' }
 : { status: 'failed', note: 'moov/mdat segment not found in file header' };
}

export async function buildEvidenceManifest(options) {
 const version = options.version === EVIDENCE_V01 ? EVIDENCE_V01 : EVIDENCE_V02;
 const files = (options.files || []).map((file) => ({ name: file.name, hash: file.hash, type: file.type }));
 for (const file of files) {
 if (!NAME_RE.test(file.name)) throw new Error('file name violates C5: ' + file.name);
 if (!isHash(file.hash)) throw new Error('file hash violates C1: ' + file.name);
 if (file.type !== 'image' && file.type !== 'video') throw new Error('file type must be image or video');
 }

 const base = {
 spec: version,
 packageId: options.packageId || uuidV4(),
 createdAt: options.createdAt || isoUtcNow(),
 files
 };
 if (version === EVIDENCE_V02) {
 base.captureTsDevice = options.captureTsDevice || isoLocalNow();
 base.gps = {
 lat: normalizeDecimal(options.gps ? options.gps.lat : ''),
 lon: normalizeDecimal(options.gps ? options.gps.lon : '')
 };
 base.note = String(options.note === undefined || options.note === null ? '' : options.note);
 base.tags = Array.isArray(options.tags) ? options.tags.map(String) : [];
 base.mp4SanityCheck = options.mp4SanityCheck || { status: 'skipped', note: 'no container check performed' };
 }
 if (options.supersedesPackageId) {
 if (!UUID_V4_RE.test(options.supersedesPackageId)) throw new Error('supersedesPackageId must be a UUID v4 string');
 base.supersedesPackageId = options.supersedesPackageId;
 }
 if (options.revisionReason !== undefined && options.revisionReason !== null && options.revisionReason !== '') {
 base.revisionReason = String(options.revisionReason);
 }
 if (options.tzIana) base.tzIana = String(options.tzIana);
 if (options.hashAlgorithm) {
 if (options.hashAlgorithm !== 'sha256' && options.hashAlgorithm !== 'sha3-256') {
 throw new Error('hashAlgorithm must be sha256 or sha3-256');
 }
 base.hashAlgorithm = options.hashAlgorithm;
 }
 if (options.custody) {
 const result = validateCustody(options.custody);
 if (!result.ok) throw new Error('custody validation failed: ' + result.errors.join('; '));
 base.custody = options.custody;
 }

 const rootHash = await computeRootHash(base);
 return Object.assign({}, base, { rootHash });
}

export async function buildSupplementManifest(options) {
 if (!UUID_V4_RE.test(options.supplementToEvidenceId)) throw new Error('supplementToEvidenceId must be a UUID v4 string');
 const files = (options.files || []).map((file) => ({ name: file.name, hash: file.hash, type: file.type }));
 for (const file of files) {
 if (!NAME_RE.test(file.name)) throw new Error('file name violates C5: ' + file.name);
 if (!isHash(file.hash)) throw new Error('file hash violates C1: ' + file.name);
 if (file.type !== 'image' && file.type !== 'video') throw new Error('file type must be image or video');
 }
 const base = {
 spec: SUPPLEMENT_SPEC,
 packageId: options.packageId || uuidV4(),
 createdAt: options.createdAt || isoUtcNow(),
 supplementToEvidenceId: options.supplementToEvidenceId,
 note: String(options.note === undefined || options.note === null ? '' : options.note)
 };
 if (files.length) base.files = files;
 if (options.tzIana) base.tzIana = String(options.tzIana);
 const rootHash = await computeRootHash(base);
 return Object.assign({}, base, { rootHash });
}

export async function buildSupplementZip(manifest, fileBlobs = []) {
 const entries = [{ name: 'manifest.json', data: new TextEncoder().encode(canonicalManifestText(manifest)) }];
 for (const fb of fileBlobs) {
 const info = await inspectBlob(fb.blob);
 entries.push({ name: fb.name, blob: fb.blob, size: info.size, crc32: info.crc32, sha256: info.sha256 });
 }
 return buildZip(entries);
}

export function canonicalManifestText(manifest) {
 return canonicalJson(manifest);
}
