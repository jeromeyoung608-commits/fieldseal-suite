/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
export function captureEnvSnapshot(target) {
 const w = target || (typeof globalThis !== 'undefined' ? globalThis : {});
 const nav = w.navigator || {};
 const scr = w.screen || {};
 const loc = w.location || {};
 const doc = w.document || {};
 let tz = '';
 try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_e) { tz = ''; }
 return {
 capturedAt: new Date().toISOString(),
 userAgent: typeof nav.userAgent === 'string' ? nav.userAgent : '',
 language: typeof nav.language === 'string' ? nav.language : '',
 languages: Array.isArray(nav.languages) ? nav.languages.join(',') : '',
 timezone: tz,
 screenWidth: scr.width != null ? String(scr.width) : '',
 screenHeight: scr.height != null ? String(scr.height) : '',
 online: typeof nav.onLine === 'boolean' ? (nav.onLine ? 'yes' : 'no') : '',
 capturePageUrl: typeof loc.href === 'string' ? loc.href : '',
 docTitle: typeof doc.title === 'string' ? doc.title : ''
 };
}
