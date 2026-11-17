/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
const STATE_COLORS = {
 sealed: 'sealed', pending_countersign: 'pending', tampered: 'tampered', draft: 'draft'
};

export function timelineStatusOf(item) {
 const r = (item && item.raw) || {};
 if (r.caseStateAfter) return r.caseStateAfter;
 if (item && item.kind === 'custody') return 'custody';
 if (r.eventType) return r.eventType;
 return 'draft';
}

export function timelineColorOf(status) {
 if (STATE_COLORS[status]) return STATE_COLORS[status];
 if (status === 'custody') return 'custody';
 if (status === 'HUMAN_NOTE') return 'note';
 return 'draft';
}

function tsOf(item) {
 const r = (item && item.raw) || {};
 return r.timestampUtc || r.ts || r.when || '';
}

export function auditTimelineEvents(c) {
 const audit = Array.isArray(c && c.auditLog) ? c.auditLog.map((a, i) => ({ kind: 'audit', raw: a, i })) : [];
 const custody = Array.isArray(c && c.custodyLog) ? c.custodyLog.map((e, i) => ({ kind: 'custody', raw: e, i })) : [];
 const all = audit.concat(custody);
 all.sort((a, b) => {
 const ta = tsOf(a), tb = tsOf(b);
 if (ta < tb) return -1;
 if (ta > tb) return 1;
 return a.i - b.i;
 });
 return all;
}

function titleOf(item) {
 const r = (item && item.raw) || {};
 if (item.kind === 'custody') return 'Custody' + (r.action ? '' + r.action : '');
 return r.eventType || 'Event';
}

function summaryOf(item) {
 const r = (item && item.raw) || {};
 if (item.kind === 'custody') return [r.actor, r.ianaTz, r.purpose].filter(Boolean).join('');
 if (r.eventType === 'HUMAN_NOTE' && r.payload) return r.payload.noteText || '';
 return r.operatorNote || r.noteText || '';
}

function detailText(item) {
 try { return JSON.stringify(item.raw, null, 2); } catch (_e) { return String(item.raw); }
}

// Render a DOM timeline into `host`. Returns the created wrapper element.
export function renderAuditTimeline(host, c, opts) {
 opts = opts || {};
 const wrap = document.createElement('div');
 wrap.className = 'timeline';
 const events = auditTimelineEvents(c);
 const detail = document.createElement('div');
 detail.className = 'tl-detail';
 detail.textContent = opts.emptyDetail || 'Select an item to see details.';

 if (!events.length) {
 const empty = document.createElement('div');
 empty.className = 'section-empty';
 empty.textContent = 'No audit events.';
 wrap.appendChild(empty);
 } else {
 for (const item of events) {
 const color = timelineColorOf(timelineStatusOf(item));
 const node = document.createElement('div');
 node.className = 'tl-node tl-' + color;
 node.setAttribute('tabindex', '0');
 const dot = document.createElement('div'); dot.className = 'tl-dot';
 const body = document.createElement('div'); body.className = 'tl-body';
 const t = document.createElement('div'); t.className = 'tl-time'; t.textContent = tsOf(item);
 const ti = document.createElement('div'); ti.className = 'tl-title'; ti.textContent = titleOf(item);
 const su = document.createElement('div'); su.className = 'tl-summary'; su.textContent = summaryOf(item);
 body.appendChild(t); body.appendChild(ti); body.appendChild(su);
 node.appendChild(dot); node.appendChild(body);
 const show = () => {
 detail.textContent = '';
 const pre = document.createElement('pre');
 pre.textContent = detailText(item);
 detail.appendChild(pre);
 };
 node.addEventListener('click', show);
 node.addEventListener('keydown', (e) => {
 if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(); }
 });
 wrap.appendChild(node);
 }
 }

 host.appendChild(wrap);
 if (opts.detailHost) opts.detailHost.appendChild(detail);
 return wrap;
}
