/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Case store: IndexedDB persistence for the case layer (browser only).
// Storage ONLY — this module never participates in any hash computation (per SPEC-case.md).
// Deleting this file must not affect verification; hashing/verification live in pwa/core/case-manifest.js.
import { purgeActorFromLogs } from './local-audit-log.js';

const DB_NAME = 'fieldseal-cases';
const STORE = 'cases';
const EVIDENCE_STORE = 'evidence-packages';
const CIPHER_STORE = 'case-ciphers';
const SIGNATURE_STORE = 'signature-images';
// v2 -> v3 (cipher blobs) -> v4 (signature attachments). Every upgrade only ADDS object stores:
// onupgradeneeded never drops or rewrites existing data, so a failed/interrupted upgrade cannot
// lose a case.
const DB_VERSION = 4;
const CURRENT_SCHEMA_VERSION = 1;

function hasIndexedDB() {
 return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

function openDB() {
 return new Promise((resolve, reject) => {
 if (!hasIndexedDB()) return reject(new Error('IndexedDB unavailable in this environment'));
 const req = indexedDB.open(DB_NAME, DB_VERSION);
 req.onupgradeneeded = () => {
 const db = req.result;
 if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'packageId' });
 // Child evidence packages: raw ZIP blobs keyed by the same packageId recorded in children[].
 // Export names them evidence<packageId>.zip; verification reads them back verbatim.
 if (!db.objectStoreNames.contains(EVIDENCE_STORE)) db.createObjectStore(EVIDENCE_STORE, { keyPath: 'packageId' });
 // v0.3: verbatim AES-GCM ciphertext of a case-manifest.json snapshot. Storage only.
 if (!db.objectStoreNames.contains(CIPHER_STORE)) db.createObjectStore(CIPHER_STORE, { keyPath: 'packageId' });
 // v0.3 closing: hand-drawn PNG signatures live OUTSIDE the manifest as attachments.
 if (!db.objectStoreNames.contains(SIGNATURE_STORE)) db.createObjectStore(SIGNATURE_STORE, { keyPath: 'packageId' });
 };
 req.onsuccess = () => resolve(req.result);
 req.onerror = () => reject(req.error);
 });
}

function tx(db, mode, store = STORE) {
 return db.transaction(store, mode).objectStore(store);
}

// Schema migration: bring a stored case up to the current core version without losing data.
// v1 has no breaking changes, so migration is a no-op that stamps the version.
export function migrateCase(caseObj) {
 if (!caseObj || !caseObj.schemaDef) return caseObj;
 if ((caseObj.schemaDef.version || 0) < CURRENT_SCHEMA_VERSION) {
 caseObj.schemaDef.version = CURRENT_SCHEMA_VERSION;
 }
 return caseObj;
}

export async function putCase(caseObj) {
 const db = await openDB();
 return new Promise((resolve, reject) => {
 const req = tx(db, 'readwrite').put(caseObj);
 req.onsuccess = () => resolve(caseObj);
 req.onerror = () => reject(req.error);
 });
}

export async function getCase(packageId) {
 const db = await openDB();
 return new Promise((resolve, reject) => {
 const req = tx(db, 'readonly').get(packageId);
 req.onsuccess = () => resolve(req.result ? migrateCase(req.result) : null);
 req.onerror = () => reject(req.error);
 });
}

export async function listCases() {
 const db = await openDB();
 return new Promise((resolve, reject) => {
 const req = tx(db, 'readonly').getAll();
 req.onsuccess = () => resolve((req.result || []).map(migrateCase).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
 req.onerror = () => reject(req.error);
 });
}

// --- child evidence packages (raw ZIP blobs; storage only) ---

export async function putEvidencePackage(rec) {
 const db = await openDB();
 return new Promise((resolve, reject) => {
 const req = tx(db, 'readwrite', EVIDENCE_STORE).put(rec);
 req.onsuccess = () => resolve(rec);
 req.onerror = () => reject(req.error);
 });
}

export async function getEvidencePackage(packageId) {
 const db = await openDB();
 return new Promise((resolve, reject) => {
 const req = tx(db, 'readonly', EVIDENCE_STORE).get(packageId);
 req.onsuccess = () => resolve(req.result || null);
 req.onerror = () => reject(req.error);
 });
}

export async function listEvidencePackages(caseId) {
 const db = await openDB();
 const all = await new Promise((resolve, reject) => {
 const req = tx(db, 'readonly', EVIDENCE_STORE).getAll();
 req.onsuccess = () => resolve(req.result || []);
 req.onerror = () => reject(req.error);
 });
 return caseId ? all.filter((rec) => rec.caseId === caseId) : all;
}

export async function deleteEvidencePackage(packageId) {
 const db = await openDB();
 return new Promise((resolve, reject) => {
 const req = tx(db, 'readwrite', EVIDENCE_STORE).delete(packageId);
 req.onsuccess = () => resolve(true);
 req.onerror = () => reject(req.error);
 });
}

export async function deleteCasePackages(caseId) {
 const doomed = (await listEvidencePackages(caseId)).map((rec) => rec.packageId);
 if (!doomed.length) return 0;
 const db = await openDB();
 return new Promise((resolve, reject) => {
 const store = tx(db, 'readwrite', EVIDENCE_STORE);
 let pending = doomed.length;
 for (const id of doomed) {
 const req = store.delete(id);
 req.onsuccess = () => { if (--pending === 0) resolve(doomed.length); };
 req.onerror = () => reject(req.error);
 }
 });
}

// --- v0.3 encrypted case snapshot (storage only; never enters hashes) ---

export async function putCaseCipher(rec) {
 const db = await openDB();
 return new Promise((resolve, reject) => {
 const req = tx(db, 'readwrite', CIPHER_STORE).put(rec);
 req.onsuccess = () => resolve(rec);
 req.onerror = () => reject(req.error);
 });
}

export async function getCaseCipher(packageId) {
 const db = await openDB();
 return new Promise((resolve, reject) => {
 const req = tx(db, 'readonly', CIPHER_STORE).get(packageId);
 req.onsuccess = () => resolve(req.result || null);
 req.onerror = () => reject(req.error);
 });
}

export async function deleteCaseCipher(packageId) {
 const db = await openDB();
 return new Promise((resolve, reject) => {
 const req = tx(db, 'readwrite', CIPHER_STORE).delete(packageId);
 req.onsuccess = () => resolve(true);
 req.onerror = () => reject(req.error);
 });
}

// --- v0.3 closing: signature attachments (storage only; hash is in the manifest) ---

export async function putSignatureImage(rec) {
 const db = await openDB();
 return new Promise((resolve, reject) => {
 const req = tx(db, 'readwrite', SIGNATURE_STORE).put(rec);
 req.onsuccess = () => resolve(rec);
 req.onerror = () => reject(req.error);
 });
}

export async function getSignatureImage(countersignId) {
 const db = await openDB();
 return new Promise((resolve, reject) => {
 const req = tx(db, 'readonly', SIGNATURE_STORE).get(countersignId);
 req.onsuccess = () => resolve(req.result || null);
 req.onerror = () => reject(req.error);
 });
}

export async function listSignatureImages(caseId) {
 const db = await openDB();
 const all = await new Promise((resolve, reject) => {
 const req = tx(db, 'readonly', SIGNATURE_STORE).getAll();
 req.onsuccess = () => resolve(req.result || []);
 req.onerror = () => reject(req.error);
 });
 return caseId ? all.filter((rec) => rec.caseId === caseId) : all;
}

export async function deleteCaseSignatures(caseId) {
 const doomed = (await listSignatureImages(caseId)).map((rec) => rec.packageId);
 if (!doomed.length) return 0;
 const db = await openDB();
 return new Promise((resolve, reject) => {
 const store = tx(db, 'readwrite', SIGNATURE_STORE);
 let pending = doomed.length;
 for (const id of doomed) {
 const req = store.delete(id);
 req.onsuccess = () => { if (--pending === 0) resolve(doomed.length); };
 req.onerror = () => reject(req.error);
 }
 });
}

// Optimistic concurrency guard: two tabs appending countersigns at the same time must never
// silently overwrite each other. get + compare + put happen in ONE readwrite transaction.
export async function putCaseIfUnchanged(caseObj, expectedRootHash) {
 const db = await openDB();
 return new Promise((resolve, reject) => {
 const store = tx(db, 'readwrite');
 const getReq = store.get(caseObj.packageId);
 getReq.onsuccess = () => {
 const current = getReq.result;
 if (current && current.rootHash !== expectedRootHash) {
 reject(new Error('STALE_CASE: the case was modified by another session; reload before writing'));
 return;
 }
 if (!current && expectedRootHash) {
 reject(new Error('STALE_CASE: case no longer exists'));
 return;
 }
 const putReq = store.put(caseObj);
 putReq.onsuccess = () => resolve(caseObj);
 putReq.onerror = () => reject(putReq.error);
 };
 getReq.onerror = () => reject(getReq.error);
 });
}

export async function deleteCase(packageId) {
 await deleteCasePackages(packageId);
 await deleteCaseCipher(packageId);
 await deleteCaseSignatures(packageId);
 const db = await openDB();
 await new Promise((resolve, reject) => {
 const req = tx(db, 'readwrite').delete(packageId);
 req.onsuccess = () => resolve(true);
 req.onerror = () => reject(req.error);
 });
 // GDPR erasure linkage (delivery audit RH-04): a deleted case must not leave
 // actor identifiers in the local operation trail. Best-effort, never blocks
 // the delete itself.
 try { purgeActorFromLogs([packageId]); } catch { /* ignore */ }
 return true;
}

export function available() { return hasIndexedDB(); }
