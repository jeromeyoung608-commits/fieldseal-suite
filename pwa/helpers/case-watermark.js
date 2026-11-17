/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Visible photo watermark (§.3) and anti-forwarding semi-transparent layer (§.5).
// Canvas 2D only, zero libraries, zero WASM. The ORIGINAL image bytes are never overwritten:
// a new PNG is produced and BOTH digests (original + watermarked) are recorded in the manifest
// through core `recordWatermark`, so they enter rootHash but NOT the sealHash aggregate.
// The anti-forward layer is presentation only and enters NO hash at all.

import { isoUtcNow, sha256Uri } from '../core/hash.js';

export const WATERMARK_MAX_PNG_BYTES = 2 * 1024 * 1024;

export function watermarkLabel(c, opts = {}) {
 return [
 'CaseID ' + String(c && c.packageId || ''),
 String(opts.utc || isoUtcNow()),
 'IANA ' + String(opts.ianaTimezone || 'UTC')
 ].join(' | ');
}

// Pure digest helper — usable in Node self-tests without any Canvas/DOM.
export async function computeWatermarkDigests(originalBytes, watermarkedBytes) {
 if (!originalBytes || !watermarkedBytes) throw new Error('both image byte arrays are required');
 return {
 originalSha256: await sha256Uri(originalBytes),
 watermarkedSha256: await sha256Uri(watermarkedBytes)
 };
}

function newCanvas(w, h) {
 if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
 if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
 const cv = document.createElement('canvas');
 cv.width = w; cv.height = h;
 return cv;
 }
 throw new Error('Canvas is unavailable; watermark rendering is browser-only');
}

function canvasToPngBytes(canvas) {
 if (typeof canvas.convertToBlob === 'function') {
 return canvas.convertToBlob({ type: 'image/png' }).then((b) => b.arrayBuffer()).then((ab) => new Uint8Array(ab));
 }
 if (typeof canvas.toBlob === 'function') {
 return new Promise((resolve, reject) => {
 canvas.toBlob((blob) => {
 if (!blob) return reject(new Error('PNG encoding failed'));
 blob.arrayBuffer().then((ab) => resolve(new Uint8Array(ab)), reject);
 }, 'image/png');
 });
 }
 return Promise.reject(new Error('PNG encoding is unavailable'));
}

// Redraws the image with `CaseID + UTC + IANA` burned in. Original Blob is read only.
export async function applyVisibleWatermark(imageBlob, c, opts = {}) {
 if (!imageBlob || typeof imageBlob.arrayBuffer !== 'function') throw new Error('image Blob required');
 const originalBytes = new Uint8Array(await imageBlob.arrayBuffer());
 const bitmap = await createImageBitmap(imageBlob);
 const w = bitmap.width || 1;
 const h = bitmap.height || 1;
 const canvas = newCanvas(w, h);
 const ctx = canvas.getContext('2d');
 if (!ctx) throw new Error('2D canvas context unavailable');
 ctx.drawImage(bitmap, 0, 0);
 if (typeof bitmap.close === 'function') bitmap.close();
 const label = watermarkLabel(c, opts);
 const size = Math.max(12, Math.round(Math.min(w, h) / 32));
 ctx.font = size + 'px sans-serif';
 ctx.fillStyle = 'rgba(255,255,255,0.72)';
 const pad = Math.round(size * 0.6);
 const textW = ctx.measureText(label).width;
 ctx.fillRect(pad, h - size - pad * 2, textW + pad * 2, size + pad * 2);
 ctx.fillStyle = 'rgba(0,0,0,0.92)';
 ctx.textBaseline = 'bottom';
 ctx.fillText(label, pad * 2, h - pad);
 const watermarkedBytes = await canvasToPngBytes(canvas);
 if (watermarkedBytes.byteLength > WATERMARK_MAX_PNG_BYTES) throw new Error('watermarked PNG exceeds size limit');
 const digests = await computeWatermarkDigests(originalBytes, watermarkedBytes);
 return {
 bytes: watermarkedBytes,
 blob: new Blob([watermarkedBytes], { type: 'image/png' }),
 label,
 ...digests
 };
}

// Semi-transparent tiled text layer on top of an already rendered canvas. Presentation only.
export function renderAntiForwardLayer(canvas, text, opacity = 0.14) {
 const ctx = canvas.getContext('2d');
 if (!ctx) return false;
 const w = canvas.width || 1;
 const h = canvas.height || 1;
 const size = Math.max(14, Math.round(Math.min(w, h) / 22));
 ctx.save();
 ctx.globalAlpha = opacity;
 ctx.fillStyle = '#000';
 ctx.font = size + 'px sans-serif';
 ctx.rotate(-Math.PI / 9);
 for (let y = -h; y < h * 2; y += size * 3) {
 for (let x = -w; x < w * 2; x += size * 8) ctx.fillText(String(text || 'FieldSeal'), x, y);
 }
 ctx.restore();
 return true;
}

// Report / print overlay. Inline CSS only; no remote resource, no hash participation.
export function antiForwardOverlayHtml(text) {
 const safe = String(text || '').replace(/[&<>"']/g, (ch) => ({
 '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
 }[ch]));
 return '<div class="anti-forward" aria-hidden="true">' + safe + '</div>';
}
