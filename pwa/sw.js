/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
const CACHE_NAME = 'fieldseal-suite-case-v18';

const PRECACHE = [
 '.',
 './index.html',
 './capture.html',
 './sign.html',
 './custody.html',
 // case layer (Phase 2 shell + Phase 3 flows)
 './cases.html',
 './newcase.html',
 './templates.html',
 './case-detail.html',
 './case-capture.html',
 './case-custody.html',
 './case-export.html',
 './privacy.html',
 './backup.html',
 './manifest.webmanifest',
 './assets/icon.svg',
 './ui/style.css',
 './ui/components.js',
 './ui/page-chrome.js',
 './core/hash.js',
 './core/zip-builder.js',
 './core/zip-reader.js',
 './core/evidence-manifest.js',
 './core/signature-manifest.js',
 './core/custody.js',
 './core/case-manifest.js',
 './core/i18n.js',
 './helpers/preview-encoder.js',
 './helpers/canvas-draw.js',
 './helpers/webrtc-sync.js',
 './helpers/local-audit-log.js',
 './helpers/audit-anchor.js',
 './helpers/audit-device-key.js',
 './helpers/audit-tsa.js',
 './helpers/audit-key-export.js',
 './helpers/case-store.js',
 './helpers/case-export.js',
 // v0.3 Core Baseline (Countersign + Encryption + Signature)
 './ui/signature-pad.js',
 './ui/camera-panel.js',
 './helpers/case-crypto.js',
 './helpers/case-checksums.js',
 // v0.4 second round: dictionaries / snapshots / watermark / notes / hooks / attribution
 './helpers/attribution.js',
 './helpers/ext-hooks.js',
 './vendor/ext-hooks.js',
 './helpers/case-snapshot.js',
 './helpers/case-watermark.js',
 './helpers/storage-quota.js',
 './helpers/backup-reminder.js',
 // v0.4 Aegis anchoring hook (UI / transport only; zero core dependency)
 './helpers/aegis-push.js',
 // v0.5 operator identity profiles (UI / localStorage only; zero core dependency)
 './helpers/operator-profiles.js',
 // Offline cold-start closure (delivery audit RM-04 / F6): every relative module
 // imported by a page must be precached, otherwise the first offline load 404s.
 './helpers/audit-timeline.js',
 './helpers/env-snapshot.js',
 './vendor/tsa-timestamp.js',
 // In-product legal documents must open offline from the footer (GDPR Art.12).
 './legal/DPA-TEMPLATE.md',
 './legal/SUPPORT-SLA.md',
 './legal/VPAT-2.5-EU.md',
 './legal/DATA-RESIDENCY.md'
];

self.addEventListener('install', (event) => {
 event.waitUntil(
 caches.open(CACHE_NAME)
 .then((cache) => cache.addAll(PRECACHE))
 .then(() => self.skipWaiting())
 );
});

self.addEventListener('activate', (event) => {
 event.waitUntil(
 caches.keys()
 .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
 .then(() => self.clients.claim())
 );
});

self.addEventListener('fetch', (event) => {
 const request = event.request;
 if (request.method !== 'GET') return;
 if (new URL(request.url).origin !== self.location.origin) return;
 event.respondWith(
 caches.match(request).then((cached) => {
 if (cached) return cached;
 return fetch(request).then((response) => {
 if (response && response.ok && response.type === 'basic') {
 const copy = response.clone();
 caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
 }
 return response;
 }).catch(() => caches.match('./index.html'));
 })
 );
});
