/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Shared page chrome. core/i18n.js is imported by every page, so injecting these
// three deliverables from ONE module avoids the markup drift that made 11 copies
// of the footer diverge in the delivery audit (RM-01 / RM-02 / D6):
// 1. keyboard skip link (WCAG 2.4.1)
// 2. persistent polite live region (WCAG 4.1.3)
// 3. in-product privacy / legal / backup (GDPR Art.12 transparency)
// Pure DOM, zero dependencies, no network, no storage. Safe to import under Node.

const LINKS = [
 ['privacy.html', 'Privacy'],
 ['legal/DPA-TEMPLATE.md', 'DPA'],
 ['legal/SUPPORT-SLA.md', 'Support SLA'],
 ['legal/VPAT-2.5-EU.md', 'VPAT / ACR'],
 ['legal/DATA-RESIDENCY.md', 'Data residency'],
 ['backup.html', 'Backup']
];

// Param-gated headless a11y probes (no effect in production; only act when the URL carries the flag).
// ?a11yZoom=1 -> measures horizontal overflow at the current narrow viewport and reports
// ZOOM-OVERFLOW-OK / ZOOM-OVERFLOW-FAIL so a 200% zoom check is REAL.
// ?a11yContrast=1 -> forces the high-contrast theme so a high-contrast screenshot is REAL.
function mountA11yProbe() {
 if (typeof document === 'undefined' || typeof location === 'undefined') return;
 const params = new URLSearchParams(location.search);
 if (params.get('a11yContrast') === '1') document.documentElement.classList.add('forced-contrast');
 if (params.get('a11yZoom') === '1') {
 const report = () => {
 if (document.getElementById('ZOOM-OVERFLOW-OK') || document.getElementById('ZOOM-OVERFLOW-FAIL')) return;
 const de = document.documentElement;
 const overflow = de.scrollWidth > de.clientWidth + 1;
 const el = document.createElement('div');
 el.id = overflow ? 'ZOOM-OVERFLOW-FAIL' : 'ZOOM-OVERFLOW-OK';
 el.style.display = 'none';
 document.body.appendChild(el);
 };
 const schedule = () => { requestAnimationFrame(report); setTimeout(report, 100); };
 if (document.readyState === 'complete') schedule();
 else window.addEventListener('load', schedule, { once: true });
 }
}

export function mountPageChrome() {
 if (typeof document === 'undefined' || !document.body) return false;
 mountA11yProbe();

 if (!document.querySelector('.skip-link')) {
 const target = document.querySelector('main') ||
 document.querySelector('header') ||
 document.querySelector('.container') ||
 document.body;
 if (!target.id) target.id = 'main-content';
 if (target !== document.body) target.setAttribute('tabindex', '-1');
 const link = document.createElement('a');
 link.className = 'skip-link';
 link.href = '#' + target.id;
 link.textContent = 'Skip to main content';
 document.body.insertBefore(link, document.body.firstChild);
 }

 if (!document.getElementById('a11y-live')) {
 const live = document.createElement('div');
 live.id = 'a11y-live';
 live.className = 'visually-hidden';
 live.setAttribute('role', 'status');
 live.setAttribute('aria-live', 'polite');
 live.setAttribute('aria-atomic', 'true');
 document.body.appendChild(live);
 }

 const footer = document.querySelector('footer');
 if (footer && !footer.querySelector('[data-legal-links]')) {
 const base = (typeof location !== 'undefined' && location.pathname.includes('/components')) ? '..' : '.';
 const nav = document.createElement('nav');
 nav.setAttribute('data-legal-links', '');
 nav.setAttribute('aria-label', 'Legal and privacy');
 nav.className = 'legal-links';
 for (const [path, label] of LINKS) {
 const a = document.createElement('a');
 a.href = base + path;
 a.textContent = label;
 nav.appendChild(a);
 }
 footer.appendChild(nav);
 }
 return true;
}

export function announce(message) {
 if (typeof document === 'undefined') return;
 const live = document.getElementById('a11y-live');
 if (live) live.textContent = message;
}
