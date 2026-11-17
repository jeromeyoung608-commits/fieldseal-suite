/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// ISOLATED HELPER LAYER - pwa/helpers
// Drawing engine and stroke synchronisation are NOT part of pwa/core.
// Only the final sealed snapshot hash (canvasSnapshotHash, a frozen manifest field) is bound by the root hash.

export function createSignatureCanvas(canvas) {
 const context = canvas.getContext('2d');
 const strokeListeners = [];
 const changeListeners = [];
 let strokes = [];
 let current = null;
 let locked = false;
 let cssWidth = 1;
 let cssHeight = 1;
 let color = '#111318';
 let width = 2.6;

 function emit(listeners, payload) {
 for (const listener of listeners) listener(payload);
 }

 function redraw() {
 context.setTransform(1, 0, 0, 1, 0, 0);
 context.fillStyle = '#ffffff';
 context.fillRect(0, 0, canvas.width, canvas.height);
 const ratio = window.devicePixelRatio || 1;
 context.setTransform(ratio, 0, 0, ratio, 0, 0);
 context.lineCap = 'round';
 context.lineJoin = 'round';
 for (const stroke of strokes) {
 if (!stroke.points || stroke.points.length === 0) continue;
 context.strokeStyle = stroke.color;
 context.lineWidth = stroke.width;
 context.beginPath();
 context.moveTo(stroke.points[0].x, stroke.points[0].y);
 for (let i = 1; i < stroke.points.length; i++) context.lineTo(stroke.points[i].x, stroke.points[i].y);
 if (stroke.points.length === 1) context.lineTo(stroke.points[0].x + 0.1, stroke.points[0].y + 0.1);
 context.stroke();
 }
 }

 function resize() {
 const rect = canvas.getBoundingClientRect();
 cssWidth = Math.max(1, rect.width);
 cssHeight = Math.max(1, rect.height);
 const ratio = window.devicePixelRatio || 1;
 canvas.width = Math.max(1, Math.round(cssWidth * ratio));
 canvas.height = Math.max(1, Math.round(cssHeight * ratio));
 redraw();
 }

 function pointFrom(event) {
 const rect = canvas.getBoundingClientRect();
 return { x: event.clientX - rect.left, y: event.clientY - rect.top };
 }

 function onPointerDown(event) {
 if (locked) return;
 event.preventDefault();
 canvas.setPointerCapture(event.pointerId);
 current = {
 id: crypto.randomUUID(),
 color,
 width,
 points: [pointFrom(event)]
 };
 strokes.push(current);
 redraw();
 }

 function onPointerMove(event) {
 if (locked || !current) return;
 event.preventDefault();
 current.points.push(pointFrom(event));
 redraw();
 }

 function onPointerUp(event) {
 if (!current) return;
 const finished = current;
 current = null;
 if (event && event.pointerId !== undefined && canvas.hasPointerCapture(event.pointerId)) {
 canvas.releasePointerCapture(event.pointerId);
 }
 emit(strokeListeners, finished);
 emit(changeListeners, strokes.length);
 }

 canvas.addEventListener('pointerdown', onPointerDown);
 canvas.addEventListener('pointermove', onPointerMove);
 canvas.addEventListener('pointerup', onPointerUp);
 canvas.addEventListener('pointercancel', onPointerUp);
 window.addEventListener('resize', resize);
 resize();

 return {
 setLocked(value) {
 locked = Boolean(value);
 canvas.style.opacity = locked ? '0.85' : '1';
 canvas.style.cursor = locked ? 'not-allowed' : 'crosshair';
 },
 isLocked() { return locked; },
 setStyle(nextColor, nextWidth) {
 if (nextColor) color = nextColor;
 if (nextWidth) width = nextWidth;
 },
 undo() {
 if (locked) return;
 strokes.pop();
 redraw();
 emit(changeListeners, strokes.length);
 },
 clear() {
 if (locked) return;
 strokes = [];
 redraw();
 emit(changeListeners, 0);
 },
 getStrokes() { return strokes.map((stroke) => JSON.parse(JSON.stringify(stroke))); },
 addRemoteStroke(stroke) {
 if (!stroke || !stroke.id || strokes.some((item) => item.id === stroke.id)) return false;
 strokes.push(stroke);
 redraw();
 emit(changeListeners, strokes.length);
 return true;
 },
 mergeStrokes(list) {
 let added = 0;
 const known = new Set(strokes.map((stroke) => stroke.id));
 for (const stroke of Array.isArray(list) ? list : []) {
 if (!stroke || !stroke.id || known.has(stroke.id)) continue;
 known.add(stroke.id);
 strokes.push(stroke);
 added++;
 }
 if (added) { redraw(); emit(changeListeners, strokes.length); }
 return added;
 },
 exportSnapshot() {
 return new Promise((resolve, reject) => {
 canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('snapshot export failed')), 'image/png');
 });
 },
 onStroke(listener) { strokeListeners.push(listener); },
 onChange(listener) { changeListeners.push(listener); },
 destroy() {
 canvas.removeEventListener('pointerdown', onPointerDown);
 canvas.removeEventListener('pointermove', onPointerMove);
 canvas.removeEventListener('pointerup', onPointerUp);
 canvas.removeEventListener('pointercancel', onPointerUp);
 window.removeEventListener('resize', resize);
 }
 };
}
