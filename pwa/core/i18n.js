/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 *
 * English-only UI runtime. The product has exactly one UI language. There is no
 * German dictionary, no hidden fallback and no language switch. The module keeps the
 * historical export names (`I18N_LANGS`, `t`, `applyI18n`, `setLang`, `mountLangSwitch`)
 * so existing pages continue to boot without edits.
 */
'use strict';

import { mountPageChrome } from '../ui/page-chrome.js';

export const I18N_LANGS = [{ code: 'en', label: 'English' }];

const STORAGE_KEY = 'fieldseal-lang';

export function getLang() {
  // English-only product: ignore stored legacy DE values and browser locale.
  return 'en';
}

export function setLang(code) {
  if (code !== 'en') return false;
  try { localStorage.setItem(STORAGE_KEY, 'en'); } catch { /* private mode */ }
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('lang', 'en');
    try { document.dispatchEvent(new Event('fieldseal:langchange')); } catch { /* non-fatal */ }
  }
  return true;
}

export function t(_key, fallback) {
  // Visible copy is authored in English; keep fallback semantics for callers.
  return fallback != null ? fallback : '';
}

export function applyI18n(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  // No non-English legal blocks remain; keep any future [data-lang="en"] visible.
  root.querySelectorAll('[data-lang]').forEach((el) => {
    el.style.display = el.getAttribute('data-lang') === 'en' ? '' : 'none';
  });
}

// The language switch is intentionally absent in the English-only product.
export function mountLangSwitch() {
  return null;
}

if (typeof document !== 'undefined') {
  try {
    document.documentElement.setAttribute('lang', 'en');
    const host = document.getElementById('lang-switch');
    if (host) host.style.display = 'none';
    applyI18n(document);
    try { mountPageChrome(); } catch { /* non-fatal: a11y/legal chrome must never break boot */ }
  } catch { /* non-fatal: i18n must never break page boot */ }
}
