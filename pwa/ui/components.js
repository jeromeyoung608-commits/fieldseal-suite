/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
export function el(tag, attributes = {}, children = []) {
 const node = document.createElement(tag);
 for (const [key, value] of Object.entries(attributes)) {
 if (key === 'class') node.className = value;
 else if (key === 'text') node.textContent = value;
 else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
 else if (value !== null && value !== undefined && value !== false) node.setAttribute(key, value === true ? '' : String(value));
 }
 for (const child of [].concat(children)) {
 if (child === null || child === undefined || child === false) continue;
 node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
 }
 return node;
}

export function formatBytes(size) {
 if (size < 1024) return size + ' B';
 if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
 return (size / (1024 * 1024)).toFixed(1) + ' MB';
}

export function showToast(message, kind = 'info') {
 let host = document.getElementById('toast-host');
 if (!host) {
 // WCAG 4.1.3: toasts must be announced to screen readers. Errors are urgent
 // (role=alert), everything else is polite status.
 host = el('div', { id: 'toast-host', class: 'toast-host', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'false' });
 document.body.appendChild(host);
 }
 const node = el('div', { class: 'toast toast-' + kind, text: message, role: kind === 'error' ? 'alert' : undefined });
 host.appendChild(node);
 setTimeout(() => node.classList.add('toast-out'), 3200);
 setTimeout(() => node.remove(), 3800);
}

export function setStatus(step, text) {
 const badge = document.getElementById('status-badge');
 const label = document.getElementById('status-text');
 if (badge) badge.dataset.step = step;
 if (label) label.textContent = text;
 const steps = ['draft', 'packed', 'download'];
 for (const item of steps) {
 const node = document.getElementById('step-' + item);
 if (node) node.classList.toggle('active', item === step);
 }
}

export function confirmDialog(message) {
 return new Promise((resolve) => {
 const overlay = el('div', { class: 'dialog-overlay' });
 const box = el('div', { class: 'dialog' }, [
 el('h3', { text: 'Bestaetigung / Confirm' }),
 el('p', { text: message }),
 el('div', { class: 'dialog-actions' }, [
 el('button', { class: 'btn btn-ghost', text: 'Cancel', onclick: () => { overlay.remove(); resolve(false); } }),
 el('button', { class: 'btn btn-primary', text: 'Confirm', onclick: () => { overlay.remove(); resolve(true); } })
 ])
 ]);
 overlay.appendChild(box);
 document.body.appendChild(overlay);
 });
}

export function downloadBlob(blob, filename) {
 const url = URL.createObjectURL(blob);
 const anchor = el('a', { href: url, download: filename });
 document.body.appendChild(anchor);
 anchor.click();
 anchor.remove();
 setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function registerServiceWorker() {
 if (!('serviceWorker' in navigator)) {
 showToast('Service Worker not supported; offline install unavailable', 'warn');
 return;
 }
 navigator.serviceWorker.register('./sw.js').catch(() => {
 showToast('Offline cache unavailable; open via localhost or HTTPS', 'warn');
 });
}

export function setOfflineIndicator() {
 const node = document.getElementById('net-state');
 if (!node) return;
 const update = () => {
 node.textContent = navigator.onLine ? 'Offline-ready' : 'Offline';
 node.classList.toggle('offline', !navigator.onLine);
 };
 window.addEventListener('online', update);
 window.addEventListener('offline', update);
 update();
}
