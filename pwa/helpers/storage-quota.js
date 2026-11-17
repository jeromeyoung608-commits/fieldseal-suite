/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Chunked writes + quota warning (§.5). Browser-native Blob.slice / navigator.storage.estimate
// only. IMPORTANT: this helper is for AUXILIARY blobs (watermarked previews, hook attachments).
// Frozen evidence packages are written verbatim through case-store.putEvidencePackage and are
// NEVER routed through chunking — a low-quota warning must not block an already fixed package.

export const DEFAULT_CHUNK_BYTES = 256 * 1024;
export const QUOTA_WARN_RATIO = 0.15;

export function sliceBlob(blob, chunkSize = DEFAULT_CHUNK_BYTES) {
 if (!blob || typeof blob.slice !== 'function' || typeof blob.size !== 'number') {
 throw new TypeError('a Blob is required');
 }
 const size = Math.max(1, Math.floor(chunkSize));
 const out = [];
 for (let offset = 0; offset < blob.size; offset += size) {
 out.push({ index: out.length, offset, blob: blob.slice(offset, Math.min(offset + size, blob.size)) });
 }
 return out;
}

export async function estimateQuota() {
 const fallback = { supported: false, usage: 0, quota: 0, freeRatio: 1, warning: false };
 if (typeof navigator === 'undefined' || !navigator.storage || typeof navigator.storage.estimate !== 'function') {
 return fallback;
 }
 try {
 const est = await navigator.storage.estimate();
 const usage = Number(est && est.usage) || 0;
 const quota = Number(est && est.quota) || 0;
 const freeRatio = quota > 0 ? Math.max(0, (quota - usage) / quota) : 1;
 return { supported: true, usage, quota, freeRatio, warning: quota > 0 && freeRatio < QUOTA_WARN_RATIO };
 } catch (_) {
 return fallback;
 }
}

// Sequential chunk delivery. `onChunk` may persist each slice; failures are reported to the
// caller, never swallowed and never allowed to touch the frozen evidence write path.
export async function writeInChunks(blob, onChunk, chunkSize = DEFAULT_CHUNK_BYTES) {
 if (typeof onChunk !== 'function') throw new TypeError('onChunk is required');
 const chunks = sliceBlob(blob, chunkSize);
 for (const chunk of chunks) await onChunk(chunk);
 return { chunks: chunks.length, bytes: blob.size };
}

export function quotaWarningText(est) {
 if (!est || !est.warning) return '';
 const pct = (est.freeRatio * 100).toFixed(1);
 return 'Local storage almost full (' + pct + '% free). Export a backup. Evidence packages already fixed are NOT affected.' + pct + '';
}
