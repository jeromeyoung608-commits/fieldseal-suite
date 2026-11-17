/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
// SPDX-License-Identifier: MIT
// License: MIT (see LICENSE); AS IS, no warranty.
// Ownership: FieldSeal Suite project / ：FieldSeal Suite.
// Aegis anchoring hook — UI / transport layer ONLY.
// * No dependency on pwa/core or cli/core. Reads only the already-computed
// rootHash / packageId / specVersion; never computes, mutates or re-hashes anything.
// * Uses the browser-native fetch; no SDK, no third-party library, no CDN.
// * Sends ONLY the textual hash digest. Media, signatures and the evidence ZIP
// are NEVER uploaded.
// * Config (opt-in flag + target URL) lives in localStorage, never in the case
// manifest, so it never enters the evidence hash tree.
// * Failures are reported to the caller; they never block sealing / export.

const ENABLED_KEY = 'fieldseal.aegis.enabled';
const URL_KEY = 'fieldseal.aegis.url';

export function loadAegisConfig() {
 let enabled = false;
 try { enabled = localStorage.getItem(ENABLED_KEY) === '1'; } catch (_) { enabled = false; }
 let url = '';
 try { url = localStorage.getItem(URL_KEY) || ''; } catch (_) { url = ''; }
 return { enabled, url };
}

export function saveAegisConfig(cfg) {
 try {
 localStorage.setItem(ENABLED_KEY, cfg.enabled ? '1' : '0');
 localStorage.setItem(URL_KEY, cfg.url || '');
 } catch (_) { /* storage unavailable — non-fatal, UI keeps working */ }
}

// Posts ONLY the textual hash digest to the user-configured Aegis endpoint.
// Resolves to { ok, status?, error? } and NEVER throws, so callers can rely on
// it to never disrupt the sealing / export main flow.
export async function pushHashToAegis(payload, url) {
 const target = (url || '').trim();
 if (!/^https?:\/\//i.test(target)) {
 return { ok: false, error: 'invalid-url' };
 }
 const body = JSON.stringify({
 packageId: payload.packageId,
 specVersion: payload.specVersion,
 rootHash: payload.rootHash
 });
 try {
 const res = await fetch(target, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body,
 mode: 'cors',
 cache: 'no-store'
 });
 if (!res.ok) return { ok: false, status: res.status, error: 'http-' + res.status };
 return { ok: true, status: res.status };
 } catch (e) {
 return { ok: false, error: 'network', message: String((e && e.message) || e) };
 }
}
