/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Recipient-side local operation trail — DEFAULT ON, opt-out (`setLogEnabled(false)`).
// IMPORTANT BOUNDARY:
// - This module NEVER writes into any manifest and NEVER affects any root hash.
// - Persistence is best-effort: browser localStorage, or an in-memory store
// when running under Node (for automated tests).
// - It can be exported as JSON / TXT and, if desired, attached to a bundle as
// an aux file -- which also does NOT enter the bundle root hash.
// Delivery audit A1..A4 / A6 (2026-11-14):
// - Every entry answers the six questions: who (actor), when (timestamp),
// what (action/eventType), on what data (target), authorised (authz),
// from where (source: origin/UA/platform/lang; browsers cannot expose a
// reliable IP, so origin+UA+platform are used instead and this limitation
// is documented here).
// - v2 entries carry a SHA-256 hash chain (prevHash + hash over canonical
// JSON). `verifyChain()` detects a modified or deleted entry; the sign page
// raises a visible banner when the chain is broken. The digest is computed
// by the platform WebCrypto kernel (pwa/core/hash.js), never by a
// hand-written primitive (S-07 red line). Sealing is asynchronous, so
// `addEvent()` still appends synchronously and `getLog()` is immediately
// consistent (K-01 / D-08 contract).
// - `purgeActorFromLogs()` removes / redacts entries linked to a deleted case.
// - Retention defaults to 365 days; `runRetentionSweep()` prunes on boot and
// on the hourly timer, recording the sweep itself.
// GDPR controls (local only, no network):
// - setGdprEnabled(true): on write AND export, mask the packageId, redact the
// actor, and drop environment fields (tzIana, toolVersion, source) so the
// stored trail carries no directly identifying device/location data.
// - Chain/authorisation fields are intentionally preserved so integrity
// verification still works on a redacted trail.

import { sha256Hex } from '../core/hash.js';
import { createAnchor, verifyAnchor, importPublicKey, chainHead } from './audit-anchor.js';
import { ensureDeviceKey, getDeviceSpki, importTrustedKey } from './audit-device-key.js';
import { createTimestamp, verifyTimestamp, ensureTsaKey, getTsaSpki, externalTimestamp } from './audit-tsa.js';
import { fingerprintSpki } from './audit-key-export.js';

const STORE_KEY = 'fieldseal-local-audit-log';
const ANCHOR_KEY = 'fieldseal-audit-anchor';
const ENABLED_KEY = 'fieldseal-local-audit-enabled';
const GDPR_KEY = 'fieldseal-local-audit-gdpr';
const RETENTION_KEY = 'fieldseal-local-audit-retention';
const GENESIS = '0'.repeat(64);
const DEFAULT_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

let retentionTimer = null;
let generation = 0;
let idSeq = 0;
let sealQueue = Promise.resolve();

function newId() {
 idSeq += 1;
 return Date.now().toString(36) + '-' + idSeq.toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function memStore(map) {
 return {
 getItem: (k) => (map.has(k) ? map.get(k) : null),
 setItem: (k, v) => { map.set(k, String(v)); },
 removeItem: (k) => { map.delete(k); }
 };
}

function getStore() {
 if (globalThis.__fieldsealMemStore) return memStore(globalThis.__fieldsealMemStore);
 try {
 if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
 } catch (error) { /* ignore */ }
 if (!globalThis.__fieldsealMemStore) globalThis.__fieldsealMemStore = new Map();
 return memStore(globalThis.__fieldsealMemStore);
}

function safeGet(key, fallback) {
 try { const v = getStore().getItem(key); return v == null ? fallback : v; } catch { return fallback; }
}
function safeSet(key, value) {
 try { getStore().setItem(key, String(value)); } catch { /* ignore */ }
}

function loadFrom(store) {
 try {
 const arr = JSON.parse(store.getItem(STORE_KEY) || '[]');
 return Array.isArray(arr) ? arr : [];
 } catch { return []; }
}
function saveTo(store, all) {
 try { store.setItem(STORE_KEY, JSON.stringify(all)); } catch { /* ignore */ }
}
function loadAll() { return loadFrom(getStore()); }
function saveAll(all) { saveTo(getStore(), all); }

// Injective canonical form: sorted object keys, no silent dropping of values.
function canonical(value) {
 if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
 if (value !== null && typeof value === 'object') {
 return '{' + Object.keys(value).sort()
 .filter((k) => value[k] !== undefined)
 .map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
 }
 return JSON.stringify(value === undefined ? null : value);
}

export function isLogEnabled() { return safeGet(ENABLED_KEY, '1') === '1'; }
export function setLogEnabled(value) { safeSet(ENABLED_KEY, value ? '1' : '0'); }
// Anchor store — deliberately NOT the same localStorage as the log (the previous
// design kept both under localStorage, so one attacker could rewrite both). In the
// browser this is IndexedDB (a different storage surface); under Node it falls back
// to a separate in-memory map. The anchor proves "this head was committed by the
// device key" and is checked on boot (checkChainOnBoot) and by doctor --audit-log.
const ANCHOR_DB = 'fieldseal-audit-anchor';
async function openAnchorStore() {
 if (typeof indexedDB !== 'undefined') {
 const db = await new Promise((resolve, reject) => {
 const req = indexedDB.open(ANCHOR_DB, 1);
 req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('anchor')) req.result.createObjectStore('anchor'); };
 req.onsuccess = () => resolve(req.result);
 req.onerror = () => reject(req.error);
 });
 return {
 async get(k) { return new Promise((res, rej) => { const t = db.transaction('anchor', 'readonly'); const r = t.objectStore('anchor').get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
 async set(k, v) { return new Promise((res, rej) => { const t = db.transaction('anchor', 'readwrite'); t.objectStore('anchor').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); },
 async remove(k) { return new Promise((res, rej) => { const t = db.transaction('anchor', 'readwrite'); t.objectStore('anchor').delete(k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
 };
 }
 const m = globalThis.__fieldsealAnchorStore || (globalThis.__fieldsealAnchorStore = new Map());
 return {
 async get(k) { return m.has(k) ? m.get(k) : null; },
 async set(k, v) { m.set(k, String(v)); },
 async remove(k) { m.delete(k); }
 };
}

// Audit configuration (persisted). TSA anchoring is ON by default (device TSA key);
// set `tsa.mode: 'external'` + `tsa.endpoint` + `tsa.trustedRoot` to use a third-party
// RFC3161 service (EP-001 contract). `tsa.mode: 'off'` disables timestamp anchoring.
export function getAuditConfig() {
 let raw = null;
 try { raw = getStore().getItem('fieldseal-audit-config'); } catch { raw = null; }
 let cfg = {};
 if (raw) { try { cfg = JSON.parse(raw); } catch { cfg = {}; } }
 cfg.tsa = cfg.tsa || {};
 if (!cfg.tsa.mode) cfg.tsa.mode = 'local';
 return cfg;
}
export function setAuditConfig(partial) {
 const cfg = getAuditConfig();
 const merged = Object.assign({}, cfg, partial);
 if (partial && partial.tsa) merged.tsa = Object.assign({}, cfg.tsa, partial.tsa);
 try { getStore().setItem('fieldseal-audit-config', JSON.stringify(merged)); } catch { /* ignore */ }
 return merged;
}

export function clearLog() {
 // Invalidate any in-flight seals so a later test/profile cannot receive a
 // stale write from an earlier store.
 generation += 1;
 sealQueue = Promise.resolve();
 try { getStore().removeItem(ANCHOR_KEY); } catch { /* legacy key, harmless */ }
 try { openAnchorStore().then((s) => s.remove(ANCHOR_KEY)).catch(() => {}); } catch { /* ignore */ }
 saveAll([]);
}

let _lastAnchorCheck = { ok: true, reason: '' };
export function getLastAnchorCheck() { return _lastAnchorCheck; }

// A6: dedicated anchor-mismatch alert record. checkChainOnBoot() populates this whenever the
// genuine external anchor (separate store, device-key signed) fails verification (mismatch or bad
// signature) — distinct from a fresh/empty trail that simply has no anchor yet.
let _lastAnchorAlert = null;
export function getLastAnchorAlert() { return _lastAnchorAlert; }
// Test/tooling accessor for the genuine external anchor store (separate surface from the log).
export async function getAnchorStore() { return openAnchorStore(); }

// Genuine external anchor: the chain head is committed to a SEPARATE store (IndexedDB,
// not the log's localStorage) under the DEVICE key. verifyAnchorStore() checks the
// signature against the trusted device key — so an attacker who tampers the log and
// re-commits with the SAME device key is caught when the head no longer matches, and
// cannot substitute a foreign key (the verifier never trusts a key from the file).
// This is the "independent anchor store" option from delivery-audit §11.3 (①).
// Genuine external anchor: the chain head is committed to a SEPARATE store (IndexedDB,
// not the log's localStorage) under the DEVICE key AND attested by a SEPARATE TSA key
// (its own IndexedDB). verifyAnchorStore() checks BOTH signatures against trusted keys
// — so an attacker who tampers the log and re-commits must forge two independent
// non-extractable keys in two separate stores. With tsa.mode='external' the timestamp is
// issued by a third-party RFC3161 service (key not on the device at all).
export async function commitAnchor() {
 const entries = loadAll();
 const head = chainHead(entries);
 const devKp = await ensureDeviceKey();
 const anchor = await createAnchor(entries, devKp.privateKey);
 const cfg = getAuditConfig();
 const mode = (cfg.tsa && cfg.tsa.mode) || 'local';
 anchor.tsaMode = mode;
 anchor.tsaDegraded = false;
 let tsaToken = null;
 if (mode === 'off') {
 // No timestamp anchoring — deliberately omit the token.
 } else if (mode === 'external' && cfg.tsa.endpoint) {
 // Real third-party RFC3161. On ANY failure we do NOT silently fall back to a local
 // token (that would fake external anchoring). The anchor is recorded as degraded with
 // NO token, so verification correctly REJECTS it (9.0 A1).
 try {
 const ext = await externalTimestamp(head, cfg.tsa.endpoint, cfg.tsa.trustedRoot);
 if (ext && ext.kind === 'rfc3161') tsaToken = ext;
 else anchor.tsaDegraded = true;
 } catch { anchor.tsaDegraded = true; }
 } else {
// 'local' (default): a LOCAL timestamp attestation by a separate on-device non-extractable
 // TSA key. This is NOT RFC3161 — it is device-instance anchoring only.
 tsaToken = await createTimestamp(head, { tsaKeyPair: await ensureTsaKey(), genTime: anchor.timestamp });
 }
 if (tsaToken) {
 anchor.tsaToken = tsaToken;
 const rootSpki = tsaToken.tsaRootSpki || tsaToken.tsaSpki;
 if (rootSpki) anchor.tsaRootFingerprint = await fingerprintSpki(rootSpki);
 }
 const store = await openAnchorStore();
 try { await store.set(ANCHOR_KEY, JSON.stringify(anchor)); } catch { /* ignore */ }
 return anchor;
}

export async function verifyAnchorStore(trustedSpki, trustedTsaSpki) {
 const store = await openAnchorStore();
 let raw;
 try { raw = await store.get(ANCHOR_KEY); } catch { raw = null; }
 if (!raw) return { ok: false, reason: 'no anchor committed (startup/doctor warning)' };
 let anchor;
 try { anchor = JSON.parse(raw); } catch { return { ok: false, reason: 'bad anchor json' }; }
 const entries = loadAll();
 const currentHead = chainHead(entries);
 // 1) Signer signature (device key).
 const spki = trustedSpki || getDeviceSpki();
 let pub;
 try { pub = spki ? await importPublicKey(spki) : await importTrustedKey(getDeviceSpki()); } catch { return { ok: false, reason: 'bad trusted key' }; }
 const v = await verifyAnchor(anchor, pub, currentHead);
 if (!v.ok) return v;
 // 2) Timestamp anchor — mode-aware (9.0 A1/A3).
 const mode = anchor.tsaMode || (anchor.tsaToken ? 'local' : 'off');
 if (mode === 'off') {
 return { ok: true, reason: '', head: currentHead, anchorHead: anchor.head, tsaMode: 'off', tsaStatus: 'off (no timestamp anchoring)' };
 }
 if (anchor.tsaDegraded === true) {
 return { ok: false, reason: 'tsa: degraded (external timestamp unavailable at commit time) — anchor not externally anchored' };
 }
 if (!anchor.tsaToken) return { ok: false, reason: 'anchor missing timestamp token (tsaMode=' + mode + ')' };
 if (mode === 'local') {
 const tsaSpki = trustedTsaSpki || getTsaSpki();
 const tv = await verifyTimestamp(anchor.tsaToken, tsaSpki);
 if (!tv.ok) return { ok: false, reason: 'tsa: ' + tv.reason };
 return { ok: true, reason: '', head: currentHead, anchorHead: anchor.head, tsaMode: 'local', tsaStatus: 'local anchored', tsaGenTime: tv.genTime };
 }
 // external RFC3161 — DER->root verification is doctor's `openssl ts -verify` job.
 if (!anchor.tsaToken || anchor.tsaToken.kind !== 'rfc3161') {
 return { ok: false, reason: 'tsa: external token missing or wrong kind (rfc3161 expected)' };
 }
 return { ok: true, reason: '', head: currentHead, anchorHead: anchor.head, tsaMode: 'external', tsaStatus: 'external-pending-doctor', tsaExternalPendingDoctor: true };
}

// Verify an ARBITRARY array of entries (e.g. an exported file) without touching
// the live store. Mirrors verifyChain() exactly so doctor --audit-log validates
// a real export the same way the in-browser chain is validated.
export async function verifyChainEntries(entries) {
 if (!Array.isArray(entries)) return { ok: false, reason: 'not an array', count: 0 };
 let expectedPrev = GENESIS;
 for (let i = 0; i < entries.length; i++) {
 const e = entries[i];
 if (!e || typeof e !== 'object' || typeof e.hash !== 'string' || e.hash.length !== 64) {
 return { ok: false, reason: 'missing hash', index: i, count: entries.length };
 }
 if (e.prevHash !== expectedPrev) {
 return { ok: false, reason: 'broken link', index: i, count: entries.length };
 }
 const body = Object.assign({}, e);
 delete body.hash;
 const hash = await sha256Hex(canonical(body));
 if (hash !== e.hash) return { ok: false, reason: 'tampered entry', index: i, count: entries.length };
 expectedPrev = e.hash;
 }
 return { ok: true, reason: '', index: -1, count: entries.length };
}

export function isGdprEnabled() { return safeGet(GDPR_KEY, '0') === '1'; }
export function setGdprEnabled(value) { safeSet(GDPR_KEY, value ? '1' : '0'); }
export function getRetentionMaxAge() {
 const v = Number(safeGet(RETENTION_KEY, String(DEFAULT_RETENTION_MS)));
 return Number.isFinite(v) && v >= 0 ? v : DEFAULT_RETENTION_MS;
}
export function setRetentionMaxAge(ms) { safeSet(RETENTION_KEY, String(Math.max(0, Math.floor(Number(ms) || 0)))); }
export function setRetentionDays(days) { setRetentionMaxAge(Number(days) * 24 * 60 * 60 * 1000); }

export function getLog() { return loadAll(); }

// Mask an identifier so it stays useful for correlation but reveals no full value.
function maskId(id) {
 const s = String(id || '');
 if (s.length <= 8) return '****';
 return '…' + s.slice(-8);
}

export function redactEvent(event) {
 if (!isGdprEnabled()) return event;
 const out = {};
 // Integrity / authorisation evidence is deliberately preserved.
 for (const k of ['v', 'id', 'timestamp', 'eventType', 'action', 'authz', 'prevHash', 'hash']) {
 if (event[k] !== undefined) out[k] = event[k];
 }
 if (event.packageId !== undefined) out.packageId = maskId(event.packageId);
 if (event.target) out.target = { type: event.target.type || '', id: maskId(event.target.id) };
 if (event.actor) out.actor = { name: 'REDACTED', id: maskId(event.actor.id) };
 out.redacted = true;
 // tzIana, toolVersion, source and free-text detail are dropped (device / location data).
 return out;
}

function sourceInfo() {
 if (typeof navigator !== 'undefined' && navigator) {
 return {
 origin: (typeof location !== 'undefined' && location.origin) ? location.origin : 'local',
 ua: String(navigator.userAgent || ''),
 platform: String(navigator.platform || ''),
 lang: String(navigator.language || '')
 };
 }
 return {
 origin: 'local', ua: 'node',
 platform: (typeof process !== 'undefined' ? String(process.platform) : ''), lang: ''
 };
}

// Asynchronously seal one entry. Seals are strictly serialised, so the previous
// entry always carries its final hash when the next link is computed.
function enqueueSeal(id, store, gen) {
 sealQueue = sealQueue.then(async () => {
 if (gen !== generation) return;
 const all = loadFrom(store);
 const idx = all.findIndex((e) => e && e.id === id);
 if (idx < 0) return;
 const prevHash = idx > 0 ? (all[idx - 1].hash || GENESIS) : GENESIS;
 const body = Object.assign({}, all[idx], { prevHash });
 delete body.hash;
 const hash = await sha256Hex(canonical(body));
 if (gen !== generation) return;
 const fresh = loadFrom(store);
 const pos = fresh.findIndex((e) => e && e.id === id);
 if (pos < 0) return;
 fresh[pos].prevHash = prevHash;
 fresh[pos].hash = hash;
 saveTo(store, fresh);
 // Re-commit the genuine external anchor (pinned-key) so it always reflects the
 // latest sealed head. Additive and best-effort: a failure here is NOT allowed
 // to break the operation trail.
 try { await commitAnchor(); } catch { /* anchor is additive; ignore */ }
 }).catch(() => { /* best-effort trail must never break the caller */ });
 return sealQueue;
}

// Re-anchor the whole chain after a structural mutation (prune / purge).
function resealAll() {
 generation += 1;
 sealQueue = Promise.resolve();
 const store = getStore();
 const all = loadFrom(store);
 for (let i = 0; i < all.length; i++) {
 if (!all[i] || typeof all[i] !== 'object') continue;
 if (!all[i].id) all[i].id = newId();
 all[i].prevHash = GENESIS;
 all[i].hash = '';
 }
 saveTo(store, all);
 const gen = generation;
 for (const e of all) if (e && e.id) enqueueSeal(e.id, store, gen);
}

export function addEvent(entry) {
 if (!isLogEnabled()) return null;
 const store = getStore();
 const packageId = entry && entry.packageId ? String(entry.packageId) : '';
 const eventType = entry && entry.eventType ? String(entry.eventType) : 'unknown';
 const event = {
 v: 2,
 id: newId(),
 eventType,
 action: (entry && entry.action) ? String(entry.action) : eventType,
 timestamp: new Date().toISOString(),
 actor: {
 name: (entry && entry.actor && entry.actor.name) ? String(entry.actor.name) : '',
 id: (entry && entry.actor && entry.actor.id) ? String(entry.actor.id) : ''
 },
 target: {
 type: (entry && entry.target && entry.target.type) ? String(entry.target.type) : 'package',
 id: (entry && entry.target && entry.target.id) ? String(entry.target.id) : packageId
 },
 authz: (entry && entry.authz) ? String(entry.authz) : 'allowed',
 source: sourceInfo(),
 packageId,
 tzIana: (entry && entry.tzIana) ? String(entry.tzIana) : (Intl.DateTimeFormat().resolvedOptions().timeZone || ''),
 toolVersion: (entry && entry.toolVersion) ? String(entry.toolVersion) : 'fieldseal-web',
 prevHash: GENESIS,
 hash: ''
 };
 const stored = redactEvent(event);
 const all = loadFrom(store);
 all.push(stored);
 saveTo(store, all);
 enqueueSeal(event.id, store, generation);
 if (getRetentionMaxAge() > 0) pruneExpired();
 return stored;
}

export function pruneExpired() {
 const maxAge = getRetentionMaxAge();
 if (!maxAge) return 0;
 const cutoff = Date.now() - maxAge;
 const all = loadAll();
 const kept = all.filter((e) => {
 const t = Date.parse(e && e.timestamp);
 return Number.isNaN(t) ? true : t >= cutoff;
 });
 const removed = all.length - kept.length;
 if (removed > 0) { saveAll(kept); resealAll(); }
 return removed;
}

export function runRetentionSweep() {
 const removed = pruneExpired();
 if (removed > 0) {
 addEvent({ eventType: 'log.retention_purged', action: 'purge', target: { type: 'log', id: '' }, detail: 'purged ' + removed });
 }
 return removed;
}

export function startRetentionTimer(intervalMs) {
 const interval = intervalMs && intervalMs > 1000 ? intervalMs : 60 * 60 * 1000;
 stopRetentionTimer();
 retentionTimer = setInterval(() => {
 try { runRetentionSweep(); } catch { /* ignore */ }
 }, interval);
 if (retentionTimer.unref) retentionTimer.unref();
 return true;
}

export function stopRetentionTimer() {
 if (retentionTimer) { clearInterval(retentionTimer); retentionTimer = null; }
}

export async function verifyChain() {
 await sealQueue;
 const all = loadAll();
 let expectedPrev = GENESIS;
 for (let i = 0; i < all.length; i++) {
 const e = all[i];
 if (!e || typeof e !== 'object' || typeof e.hash !== 'string' || e.hash.length !== 64) {
 return { ok: false, reason: 'missing hash', index: i, count: all.length };
 }
 if (e.prevHash !== expectedPrev) {
 return { ok: false, reason: 'broken link', index: i, count: all.length };
 }
 const body = Object.assign({}, e);
 delete body.hash;
 const hash = await sha256Hex(canonical(body));
 if (hash !== e.hash) return { ok: false, reason: 'tampered entry', index: i, count: all.length };
 expectedPrev = e.hash;
 }
 return { ok: true, reason: '', index: -1, count: all.length };
}

export async function checkChainOnBoot() {
 try { runRetentionSweep(); } catch { /* non-fatal */ }
 const chain = await verifyChain();
 // Verify the external anchor too (device-key, separate store). A fresh/empty trail
 // has no anchor yet — that is not a failure; only a real mismatch/bad signature is.
 try {
 const spki = (await ensureDeviceKey()).spki;
 const a = await verifyAnchorStore(spki, getTsaSpki());
 _lastAnchorCheck = a.ok ? a
 : (a.reason === 'no anchor committed' ? { ok: true, reason: 'no anchor committed yet (fresh/empty trail)' } : a);
 // A6: a real anchor mismatch (not a fresh trail) is an alert-worthy event and must be recorded.
 if (!a.ok && a.reason !== 'no anchor committed') {
 _lastAnchorAlert = { timestamp: new Date().toISOString(), reason: a.reason || 'anchor mismatch', ok: false };
 }
 } catch (e) { _lastAnchorCheck = { ok: false, reason: e.message }; _lastAnchorAlert = { timestamp: new Date().toISOString(), reason: e.message, ok: false }; }
 return chain;
}

// GDPR erasure linkage: remove entries tied to a deleted case and redact the
// actor on any surviving entry that references it, then re-anchor the chain.
export function purgeActorFromLogs(ids = []) {
 const targets = new Set((Array.isArray(ids) ? ids : [ids]).filter(Boolean).map(String));
 if (!targets.size) return 0;
 const all = loadAll();
 let changed = 0;
 const kept = [];
 for (const e of all) {
 if (!e || typeof e !== 'object') continue;
 const pid = String(e.packageId || '');
 const tid = e.target ? String(e.target.id || '') : '';
 if ((pid && targets.has(pid)) || (tid && targets.has(tid))) { changed += 1; continue; }
 const aid = e.actor ? String(e.actor.id || '') : '';
 if (aid && targets.has(aid)) {
 e.actor = { name: 'REDACTED', id: '' };
 e.redacted = true;
 changed += 1;
 }
 kept.push(e);
 }
 if (!changed) return 0;
 saveAll(kept);
 resealAll();
 return changed;
}

export function exportJson() {
 const events = loadAll().map(redactEvent);
 return JSON.stringify(events, null, 2);
}

export function exportTxt() {
 const lines = [];
 for (const e of loadAll().map(redactEvent)) {
 lines.push([
 e.timestamp, e.eventType, e.packageId,
 e.actor ? e.actor.name : '', e.authz || '',
 e.tzIana || '', e.toolVersion || ''
 ].join(' | '));
 }
 return (lines.length ? lines.join('\n') + '\n' : '');
}
