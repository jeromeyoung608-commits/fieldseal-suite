/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Standalone self-test for the zero-dependency i18n kernel (pure logic + mock DOM).
// The product is English-only by policy (see scripts/verify-bilingual.mjs), so this
// file asserts the English-only contract: one supported language, no German dictionary,
// stored legacy "de" values ignored, and non-English legal blocks hidden.
// Run: node pwa/core/test-i18n.mjs
import { getLang, setLang, t, applyI18n, I18N_LANGS } from './i18n.js';

const isSupported = (code) => I18N_LANGS.some((l) => l.code === code);
let failures = 0;
function assert(cond, msg) { if (cond) console.log(' ok - ' + msg); else { console.log(' FAIL- ' + msg); failures++; } }

function mockEl(attrs, text) { return { attrs, textContent: text, style: {}, getAttribute: (k) => attrs[k], setAttribute: (k, v) => { attrs[k] = v; } }; }
function mockRoot(groups) {
 const all = [];
 const bySel = {};
 for (const sel of Object.keys(groups)) { bySel[sel] = groups[sel]; all.push(...groups[sel]); }
 return { querySelectorAll: (sel) => bySel[sel] || [] };
}

console.log('[i18n]');
assert(I18N_LANGS.length === 1 && I18N_LANGS[0].code === 'en', 'one lang only: en (no German dictionary)');
assert(isSupported(getLang()), 'default lang is a supported language');
assert(getLang() === 'en', 'default lang is en regardless of stored value or browser locale');
assert(setLang('en') === true, 'setLang en accepted');
assert(getLang() === 'en', 'lang stays en');
// Copy is authored in English in the pages themselves; t() resolves to the caller's
// English string and never invents a translation from a hidden dictionary.
assert(t('nav.cases', 'Case Management') === 'Case Management', 'en copy resolved from the page string');
assert(t('nonexistent', 'fb') === 'fb', 'missing key -> fallback');
assert(t('nonexistent') === '', 'no fallback -> empty string (no hidden dictionary)');
assert(setLang('de') === false, 'setLang de rejected (product is English-only)');
assert(setLang('fr') === false && setLang('es') === false && setLang('zh') === false, 'fr/es/zh rejected');
assert(getLang() === 'en', 'rejected switches leave lang at en');

// applyI18n: a non-English legal block must never render, an English one must.
const elDe = mockEl({ 'data-lang': 'de' }, 'DE text');
const elEn = mockEl({ 'data-lang': 'en' }, 'EN text');
const root = mockRoot({ '[data-i18n]': [], '[data-lang]': [elDe, elEn] });
applyI18n(root);
assert(elEn.style.display === '' && elDe.style.display === 'none', 'data-lang shows only the en block');
assert(applyI18n(null) === undefined, 'applyI18n tolerates a missing root');

console.log(failures === 0 ? '\nALL I18N TESTS PASSED' : '\n' + failures + ' I18N TEST(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
