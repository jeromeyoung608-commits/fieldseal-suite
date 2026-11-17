/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Zero-dependency device-camera panel. "Photo" and "Video" MUST use the real camera,
// not a file picker. This component owns the MediaStream only while open, never writes to disk,
// never uploads, and emits ordinary File objects that the caller feeds into the EXISTING frozen
// addFiles() pipeline. If the browser has no camera (or permission is denied) open() returns false
// so the caller can fall back to <input type=file> instead of leaving a dead button.

const ElementBase = typeof HTMLElement !== 'undefined' ? HTMLElement : class {};

const MIME_CANDIDATES = [
 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'
];

export const CAMERA_UNAVAILABLE = 'Camera unavailable';

function supportedMime() {
 if (typeof MediaRecorder === 'undefined') return '';
 return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

export class FieldsealCameraPanel extends ElementBase {
 static supported(mode = 'photo') {
 const hasCamera = !!(typeof navigator !== 'undefined' && navigator.mediaDevices &&
 typeof navigator.mediaDevices.getUserMedia === 'function');
 if (!hasCamera) return false;
 return mode === 'video' ? typeof MediaRecorder !== 'undefined' : true;
 }

 constructor() {
 super();
 if (typeof HTMLElement === 'undefined') return; // Node static import with no DOM
 this._stream = null;
 this._recorder = null;
 this._chunks = [];
 this._mode = 'photo';
 const root = this.attachShadow({ mode: 'open' });
 root.innerHTML = `
 <style>
 :host { display: block; }
 .panel { margin-top: 10px; }
 video { display: block; width: 100%; max-width: 100%; max-height: 60vh; background: #000; border-radius: 8px; object-fit: contain; }
 .row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
 button { font: inherit; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border, #3a4552);
 background: var(--surface-2, #222b36); color: inherit; cursor: pointer; }
 button:disabled { opacity: .4; cursor: not-allowed; }
 .state { margin-top: 8px; font-size: 12px; opacity: .8; }
 .hint { margin-top: 8px; font-size: 12px; opacity: .7; }
 </style>
 <div class="panel" part="panel" hidden>
 <video part="video" playsinline muted></video>
 <div class="row">
 <button type="button" data-act="shutter" part="shutter">Take photo</button>
 <button type="button" data-act="rec-start" part="rec-start">Start recording</button>
 <button type="button" data-act="rec-stop" part="rec-stop" disabled>Stop recording</button>
 <button type="button" data-act="close" part="close">Close camera</button>
 </div>
 <div class="state" part="state"></div>
 <div class="hint">The captured file is the ORIGINAL of this take; it is stored verbatim (STORE, no transcoding).</div>
 </div>`;
 this._panel = root.querySelector('.panel');
 this._video = root.querySelector('video');
 this._state = root.querySelector('.state');
 this._shutterBtn = root.querySelector('[data-act="shutter"]');
 this._startBtn = root.querySelector('[data-act="rec-start"]');
 this._stopBtn = root.querySelector('[data-act="rec-stop"]');
 root.addEventListener('click', (ev) => {
 const act = ev.target && ev.target.getAttribute ? ev.target.getAttribute('data-act') : null;
 if (act === 'shutter') this._shutter();
 else if (act === 'rec-start') this._startRec();
 else if (act === 'rec-stop') this._stopRec();
 else if (act === 'close') this.close();
 });
 }

 get active() { return !!(this._stream); }
 get recording() { return !!(this._recorder && this._recorder.state === 'recording'); }

 async startRecording() { this._startRec(); }
 get mode() { return this._mode; }

 async open(mode = 'photo') {
 if (!this._panel) return false;
 const wanted = mode === 'video' ? 'video' : 'photo';
 if (!FieldsealCameraPanel.supported(wanted)) {
 this._setState(CAMERA_UNAVAILABLE + ': browser/API not supported');
 return false;
 }
 try {
 this._releaseStream();
 const stream = await navigator.mediaDevices.getUserMedia({
 video: { facingMode: 'environment' }, audio: wanted === 'video'
 });
 this._stream = stream;
 this._mode = wanted;
 this._video.srcObject = stream;
 await this._video.play().catch(() => {});
 this._panel.hidden = false;
 this._syncButtons();
 this._setState(wanted === 'photo'
 ? 'Camera ready - press shutter'
 : 'Camera ready - start recording');
 this._emit('opened', { mode: wanted });
 return true;
 } catch (error) {
 this._setState(CAMERA_UNAVAILABLE + ': ' + (error && error.message ? error.message : 'permission denied'));
 this._releaseStream();
 this._panel.hidden = false; // keep the explanatory state visible
 this._syncButtons();
 return false;
 }
 }

 close() {
 if (this._recorder && this._recorder.state === 'recording') {
 try { this._recorder.stop(); } catch (_) { /* stream may already be gone */ }
 }
 this._releaseStream();
 if (this._panel) this._panel.hidden = true;
 this._setState('');
 this._emit('closed', {});
 }

 _releaseStream() {
 if (this._stream) for (const track of this._stream.getTracks()) track.stop();
 this._stream = null;
 if (this._video) this._video.srcObject = null;
 }

 _syncButtons() {
 if (!this._shutterBtn) return;
 const recording = !!(this._recorder && this._recorder.state === 'recording');
 const ready = this.active;
 this._shutterBtn.hidden = this._mode !== 'photo';
 this._startBtn.hidden = this._mode !== 'video';
 this._stopBtn.hidden = this._mode !== 'video';
 this._shutterBtn.disabled = !ready;
 this._startBtn.disabled = !ready || recording;
 this._stopBtn.disabled = !recording;
 }

 _setState(text) { if (this._state) this._state.textContent = text; }

 _emit(name, detail) {
 this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
 }

 async _shutter() {
 if (!this.active) return;
 const w = this._video.videoWidth || 0, h = this._video.videoHeight || 0;
 if (!w || !h) { this._setState('Camera frame not ready'); return; }
 const canvas = document.createElement('canvas');
 canvas.width = w; canvas.height = h;
 canvas.getContext('2d').drawImage(this._video, 0, 0, w, h);
 const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
 if (!blob) { this._setState('Capture failed'); return; }
 const file = new File([blob], 'camera-photo-' + Date.now() + '.png', { type: 'image/png' });
 this._emit('capture', { file, type: 'image' });
 this._setState('Photo captured');
 }

 _startRec() {
 if (!this.active || (this._recorder && this._recorder.state === 'recording')) return;
 const mime = supportedMime();
 this._chunks = [];
 try {
 this._recorder = new MediaRecorder(this._stream,
 mime ? { mimeType: mime, videoBitsPerSecond: 900000 } : undefined);
 } catch (error) {
 this._setState('MediaRecorder unavailable' + (error.message || ''));
 return;
 }
 this._recorder.ondataavailable = (ev) => { if (ev.data && ev.data.size) this._chunks.push(ev.data); };
 this._recorder.onstop = () => {
 const type = this._recorder.mimeType || 'video/webm';
 const blob = new Blob(this._chunks, { type });
 this._chunks = [];
 const ext = type.indexOf('mp4') !== -1 ? 'mp4' : 'webm';
 const file = new File([blob], 'camera-video-' + Date.now() + '.' + ext, { type });
 this._emit('capture', { file, type: 'video' });
 this._setState('Recording saved');
 this._syncButtons();
 };
 this._recorder.start(1000);
 this._syncButtons();
 this._setState('Recording');
 }

 _stopRec() {
 if (this._recorder && this._recorder.state === 'recording') this._recorder.stop();
 }
}

if (typeof customElements !== 'undefined' && !customElements.get('fieldseal-camera-panel')) {
 customElements.define('fieldseal-camera-panel', FieldsealCameraPanel);
}
