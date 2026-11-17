/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
const TAG = 'fieldseal-signature-pad';

const STYLE = `
 :host { display:block; font-family:inherit; }
 .pad { border:1px dashed var(--line, #4a5262); border-radius:8px; background:#fff; overflow:hidden; }
 canvas { display:block; width:100%; height:150px; touch-action:none; cursor:crosshair; background:#fff; }
 :host([disabled]) canvas { cursor:not-allowed; opacity:.6; }
 .bar { display:flex; gap:8px; align-items:center; flex-wrap:wrap; padding:8px 10px; border-top:1px solid var(--line, #4a5262); }
 button { font:inherit; font-size:12px; padding:5px 10px; border-radius:6px; cursor:pointer;
 border:1px solid var(--line, #4a5262); background:transparent; color:inherit; }
 button:disabled { opacity:.4; cursor:not-allowed; }
 .hint { margin-left:auto; font-size:11px; opacity:.65; }
 .preview { display:block; max-width:220px; max-height:70px; margin-top:8px; border:1px solid var(--line, #4a5262);
 border-radius:6px; background:#fff; object-fit:contain; }
 .preview[hidden] { display:none; }
`;

// A DOM-less runtime (e.g. the zero-dependency Node self-test importing every pwa module
// statically) must still be able to load this file; the component is only defined in a browser.
const ElementBase = typeof HTMLElement !== 'undefined' ? HTMLElement : class {};

export class FieldsealSignaturePad extends ElementBase {
 constructor() {
 super();
 this._strokes = [];
 this._active = null;
 this._lineWidth = 2.2;
 this._disabled = false;
 this._w = 1;
 this._h = 1;
 this._root = this.attachShadow({ mode: 'open' });
 }

 static get observedAttributes() { return ['disabled', 'stroke-width']; }

 connectedCallback() {
 if (this._root.childElementCount) return;
 this._root.innerHTML = `<style>${STYLE}</style>
 <div class="pad"><canvas part="canvas"></canvas></div>
 <div class="bar">
 <button type="button" data-act="undo">Undo last stroke</button>
 <button type="button" data-act="clear">Clear</button>
 <span class="hint">Black ink &middot; mouse / pen / touch</span>
 </div>
 <img class="preview" alt="Signature preview" hidden>`;
 this._canvas = this._root.querySelector('canvas');
 this._ctx = this._canvas.getContext('2d');
 this._preview = this._root.querySelector('.preview');
 this._undoBtn = this._root.querySelector('[data-act="undo"]');
 this._clearBtn = this._root.querySelector('[data-act="clear"]');
 this._disabled = this.hasAttribute('disabled');
 this._lineWidth = Number(this.getAttribute('stroke-width')) || this._lineWidth;

 const onDown = (ev) => {
 if (this._disabled) return;
 ev.preventDefault();
 try { this._canvas.setPointerCapture(ev.pointerId); } catch (_) { /* capture is best-effort */ }
 this._active = [this._point(ev)];
 this._strokes.push(this._active);
 this._redraw();
 };
 const onMove = (ev) => {
 if (this._disabled || !this._active) return;
 ev.preventDefault();
 this._active.push(this._point(ev));
 this._redraw();
 };
 const onUp = () => {
 if (!this._active) return;
 this._active = null;
 this._emit();
 };
 this._canvas.addEventListener('pointerdown', onDown);
 this._canvas.addEventListener('pointermove', onMove);
 this._canvas.addEventListener('pointerup', onUp);
 this._canvas.addEventListener('pointercancel', onUp);
 this._canvas.addEventListener('pointerleave', onUp);
 this._undoBtn.addEventListener('click', () => this.undo());
 this._clearBtn.addEventListener('click', () => this.clear());
 this._onResize = () => this._resize();
 globalThis.addEventListener('resize', this._onResize);
 this._resize();
 this._syncButtons();
 }

 disconnectedCallback() {
 if (this._onResize) globalThis.removeEventListener('resize', this._onResize);
 }

 attributeChangedCallback(name, oldValue, newValue) {
 if (oldValue === newValue) return;
 if (name === 'disabled') { this._disabled = newValue !== null; this._syncButtons(); }
 if (name === 'stroke-width' && Number(newValue)) {
 this._lineWidth = Number(newValue);
 this._redraw();
 }
 }

 _point(ev) {
 const rect = this._canvas.getBoundingClientRect();
 return {
 x: Math.min(1, Math.max(0, (ev.clientX - rect.left) / (rect.width || 1))),
 y: Math.min(1, Math.max(0, (ev.clientY - rect.top) / (rect.height || 1)))
 };
 }

 _resize() {
 if (!this._canvas || !this._ctx) return;
 const rect = this._canvas.getBoundingClientRect();
 const dpr = Math.max(1, globalThis.devicePixelRatio || 1);
 this._w = Math.max(1, Math.round(rect.width || 300));
 this._h = Math.max(1, Math.round(rect.height || 150));
 this._canvas.width = Math.round(this._w * dpr);
 this._canvas.height = Math.round(this._h * dpr);
 this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
 this._redraw();
 }

 _redraw() {
 if (!this._ctx) return;
 const ctx = this._ctx;
 ctx.clearRect(0, 0, this._w, this._h);
 ctx.fillStyle = '#ffffff';
 ctx.fillRect(0, 0, this._w, this._h);
 ctx.strokeStyle = '#111111';
 ctx.fillStyle = '#111111';
 ctx.lineWidth = this._lineWidth;
 ctx.lineCap = 'round';
 ctx.lineJoin = 'round';
 for (const stroke of this._strokes) {
 if (!stroke.length) continue;
 if (stroke.length === 1) {
 ctx.beginPath();
 ctx.arc(stroke[0].x * this._w, stroke[0].y * this._h, this._lineWidth / 2, 0, Math.PI * 2);
 ctx.fill();
 continue;
 }
 ctx.beginPath();
 ctx.moveTo(stroke[0].x * this._w, stroke[0].y * this._h);
 for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i].x * this._w, stroke[i].y * this._h);
 ctx.stroke();
 }
 }

 _syncButtons() {
 if (!this._undoBtn) return;
 this._undoBtn.disabled = this._disabled || this._strokes.length === 0;
 this._clearBtn.disabled = this._disabled || this._strokes.length === 0;
 }

 _emit() {
 this._syncButtons();
 const dataUrl = this.empty ? '' : this.toDataURL();
 if (this._preview) {
 this._preview.src = dataUrl;
 this._preview.hidden = !dataUrl;
 }
 this.dispatchEvent(new CustomEvent('change', {
 bubbles: true, composed: true,
 detail: { empty: this.empty, strokeCount: this._strokes.length, dataUrl }
 }));
 }

 get empty() { return this._strokes.length === 0; }
 get strokeCount() { return this._strokes.length; }
 get value() { return this.empty ? '' : this.toDataURL(); }

 setStrokeWidth(width) {
 const n = Number(width);
 if (!Number.isFinite(n) || n <= 0) throw new Error('stroke width must be a positive number');
 this._lineWidth = n;
 this._redraw();
 }

 setDisabled(flag) {
 if (!!flag) this.setAttribute('disabled', '');
 else this.removeAttribute('disabled');
 }

 undo() {
 if (this._disabled || !this._strokes.length) return;
 this._strokes.pop();
 this._active = null;
 this._redraw();
 this._emit();
 }

 clear() {
 if (this._disabled) return;
 this._strokes = [];
 this._active = null;
 this._redraw();
 this._emit();
 }

 toDataURL() {
 this._redraw();
 return this.empty ? '' : this._canvas.toDataURL('image/png');
 }
}

if (typeof customElements !== 'undefined' && !customElements.get(TAG)) {
 customElements.define(TAG, FieldsealSignaturePad);
}

export { TAG as SIGNATURE_PAD_TAG };
