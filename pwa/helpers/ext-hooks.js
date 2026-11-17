/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// All extension hooks are side-effect isolated. Extension libraries can only receive read-only copies of case data. Any mutation to core case state, custody logs, schema or seal hash MUST go through the native core functions of the main branch. Extension-generated attachments are excluded from the top-level seal hash. Core hash and state machine never reference window.EXT_HOOKS.

// Normalised first-party hook interface. Four isolation requirements:
// 1. lazy resolution — the vendor global is read at CALL time, never captured at module load;
// 2. isAvailable() for every hook;
// 3. a normalised return shape ({ ok, data, message }) — never a raw re-export of a library;
// 4. an injectable replacement seam (setHookOverride) so tests can mock without any library.
// No network calls, no imports of third-party code, no WASM, no CDN.

import { readVendorHook } from '../vendor/ext-hooks.js';

export const HOOK_IDS = [
 'EXTENSION_ZXING_BARCODE_SCAN',
 'EXTENSION_ENCRYPTED_ZIP',
 'EXTENSION_PDF_LIB',
 'EXTENSION_QR_GENERATE',
 'EXTENSION_CLOUD_SYNC'
];

export const HOOK_LABELS = {
 EXTENSION_ZXING_BARCODE_SCAN: 'Scan Barcode',
 EXTENSION_ENCRYPTED_ZIP: 'Password Encrypted Zip',
 EXTENSION_PDF_LIB: 'Custom Styled PDF',
 EXTENSION_QR_GENERATE: 'Generate QR Label',
 EXTENSION_CLOUD_SYNC: 'Cloud Sync (placeholder only)'
};

// featureFlag default false for EVERY hook.
export const FEATURE_FLAGS = HOOK_IDS.reduce((acc, id) => { acc[id] = false; return acc; }, {});

const overrides = Object.create(null);

export function setFeatureFlag(id, enabled) {
 if (!HOOK_IDS.includes(id)) return false;
 FEATURE_FLAGS[id] = !!enabled;
 return true;
}
export function resetFeatureFlags() {
 for (const id of HOOK_IDS) FEATURE_FLAGS[id] = false;
}

// Injectable seam: tests supply a stub; production resolves the vendor adapter lazily.
export function setHookOverride(id, impl) { overrides[id] = impl || null; }
export function clearHookOverride(id) { delete overrides[id]; }
export function resetHookOverrides() {
 for (const k of Object.keys(overrides)) delete overrides[k];
}

function resolveImpl(id) {
 if (!HOOK_IDS.includes(id)) return null;
 if (FEATURE_FLAGS[id] !== true) return null;
 const injected = overrides[id];
 if (injected) return injected;
 return readVendorHook(id);
}

export function isAvailable(id) {
 const impl = resolveImpl(id);
 if (!impl) return false;
 if (typeof impl.isAvailable === 'function') {
 try { return !!impl.isAvailable(); } catch (_) { return false; }
 }
 return true;
}

// Every invocation returns the SAME normalised envelope. `caseData` is deep-cloned and frozen
// before being handed out, so a library cannot mutate the live case object.
export function callHook(id, method, payload = {}) {
 const unavailable = (message) => ({ ok: false, data: null, message });
 const impl = resolveImpl(id);
 if (!impl) {
 if (FEATURE_FLAGS[id] === true) return unavailable('Extension library not loaded; core flow continues unchanged.');
 return unavailable('Feature flag is disabled.');
 }
 const fn = typeof impl === 'function' ? impl : impl[method];
 if (typeof fn !== 'function') return unavailable('Extension capability not available; core flow continues unchanged.');
 const copy = payload && typeof payload === 'object' ? deepFreeze(cloneJson(payload)) : payload;
 try {
 const data = fn.call(impl, copy);
 return { ok: true, data: data === undefined ? null : data, message: '' };
 } catch (e) {
 return unavailable('Extension call failed; core flow continues unchanged.');
 }
}

export function hookStatus(id) {
 return { id, flag: FEATURE_FLAGS[id] === true, available: isAvailable(id), label: HOOK_LABELS[id] || id };
}

export const ATTACHMENT_DIR = 'attachments/';

// Hook products are EXPORT ATTACHMENTS ONLY: excluded from sealHash, included in
// case-files.sha256 by the export layer. Names are whitelisted to prevent path traversal.
export function normaliseAttachmentName(name) {
 const clean = String(name || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
 if (!clean || clean === '.' || clean === '..') return null;
 return ATTACHMENT_DIR + clean;
}

export function attachmentStub(id, bytes, name) {
 const path = normaliseAttachmentName(name || (id.toLowerCase() + '.bin'));
 if (!path) return null;
 return { name: path, blob: new Blob([bytes], { type: 'application/octet-stream' }), hookId: id };
}

function cloneJson(value) {
 return JSON.parse(JSON.stringify(value === undefined ? null : value));
}
function deepFreeze(value) {
 if (value && typeof value === 'object' && !Object.isFrozen(value)) {
 Object.freeze(value);
 for (const k of Object.keys(value)) deepFreeze(value[k]);
 }
 return value;
}
