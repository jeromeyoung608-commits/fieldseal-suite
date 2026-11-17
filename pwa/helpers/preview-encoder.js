/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// ISOLATED HELPER LAYER - pwa/helpers
// Preview artifacts are written to aux/ only. They are never listed in files[],
// never hashed into the evidence root hash tree, and helper logic never runs inside pwa/core.

export const PREVIEW_LABEL = {
 en: 'Reference only, not the original evidence'
};

export const PREVIEW_NOTE_TEXT = [
 'FieldSeal Suite - auxiliary preview',
 PREVIEW_LABEL.en,
 'This file is an auxiliary attachment under aux/. It is NOT part of files[]',
 'and is NOT included in the root hash tree. The original media is unchanged.'
].join('\n');

const MAX_SIDE = 640;
const JPEG_QUALITY = 0.45;

function canvasToBlob(canvas) {
 return new Promise((resolve, reject) => {
 canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('canvas encoding failed')), 'image/jpeg', JPEG_QUALITY);
 });
}

function drawScaled(source, width, height) {
 const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
 const canvas = document.createElement('canvas');
 canvas.width = Math.max(1, Math.round(width * scale));
 canvas.height = Math.max(1, Math.round(height * scale));
 canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
 return canvas;
}

async function loadBitmap(blob) {
 if (typeof createImageBitmap === 'function') {
 try {
 return { source: await createImageBitmap(blob), width: 0, height: 0, revoke: true };
 } catch (err) {
 /* fall through to the image element path */
 }
 }
 const url = URL.createObjectURL(blob);
 try {
 const image = await new Promise((resolve, reject) => {
 const element = new Image();
 element.onload = () => resolve(element);
 element.onerror = () => reject(new Error('image decode failed'));
 element.src = url;
 });
 return { source: image, width: image.naturalWidth, height: image.naturalHeight, revoke: false, url };
 } catch (err) {
 URL.revokeObjectURL(url);
 throw err;
 }
}

async function imagePreview(blob) {
 const loaded = await loadBitmap(blob);
 const width = loaded.width || loaded.source.width;
 const height = loaded.height || loaded.source.height;
 const result = await canvasToBlob(drawScaled(loaded.source, width, height));
 if (loaded.source.close) loaded.source.close();
 if (loaded.url) URL.revokeObjectURL(loaded.url);
 return result;
}

async function videoPoster(blob) {
 const url = URL.createObjectURL(blob);
 const video = document.createElement('video');
 video.muted = true;
 video.playsInline = true;
 video.preload = 'metadata';
 video.src = url;
 try {
 await Promise.race([
 new Promise((resolve, reject) => {
 video.onloadeddata = () => resolve();
 video.onerror = () => reject(new Error('video decode failed'));
 }),
 new Promise((resolve, reject) => setTimeout(() => reject(new Error('video preview timeout')), 8000))
 ]);
 if (video.duration > 0) {
 video.currentTime = Math.min(0.2, video.duration);
 await Promise.race([
 new Promise((resolve) => { video.onseeked = () => resolve(); }),
 new Promise((resolve) => setTimeout(resolve, 2000))
 ]);
 }
 const width = video.videoWidth || 640;
 const height = video.videoHeight || 360;
 return await canvasToBlob(drawScaled(video, width, height));
 } finally {
 video.removeAttribute('src');
 video.load();
 URL.revokeObjectURL(url);
 }
}

export async function createPreview(blob, type) {
 if (type === 'video') {
 try {
 return { blob: await videoPoster(blob), extension: 'jpg', kind: 'video-poster' };
 } catch (err) {
 /* fall through to a generic poster attempt */
 }
 }
 return { blob: await imagePreview(blob), extension: 'jpg', kind: 'image' };
}
