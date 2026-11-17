#!/usr/bin/env node
/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Language-policy gate (zero dependencies).
// Policy:
//   1. Repository documentation is English only: no `.de.md`, no `docs/de/`, no German
//      counterpart requirement, and customer-facing docs contain no CJK characters.
//   2. Product UI is English only: exactly one language (en), no DE/FR/ES/ZH, no CJK
//      in pwa assets, and no German legal blocks or lang="de" declarations.
// Run: node scripts/verify-language-policy.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['.git', '.playwright-cli', 'node_modules', 'archive-data']);
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const failures = [];
const stats = { docs: 0, pwaFiles: 0, i18nKeys: 0, uiKeys: 0 };

function walk(dir, cb) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, cb);
    else cb(abs);
  }
}
const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');

// Customer-facing documents: must be English only and CJK-free.
const CUSTOMER_DOCS = [
  'README.md', 'LICENSE', 'NOTICE', 'EULA.md', 'PRICING.md', 'TRADEMARK.md',
  'COMMERCIAL-LICENSE.md', 'GOVERNANCE.md', 'SUPPORT.md', 'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md', 'SECURITY.md', 'SBOM.md', 'BLOCKERS.md',
  'KNOWN_ISSUES.md', 'Manual-Test-Checklist.md', 'Module-Acceptance-Report.md',
  'docs/ACCESSIBILITY-STATEMENT.md', 'docs/OFFLINE-OPERATION.md',
  'docs/RELEASE-NOTES.md', 'docs/RELEASE-CHECKLIST-9.5.md',
  'docs/RELEASE-ROLLBACK.md', 'docs/PLATFORM-MATRIX.md',
  'docs/github/FAQ.md', 'docs/github/QUICKSTART.md', 'docs/github/GLOSSARY.md',
  'pwa/legal/SUPPORT-SLA.md', 'pwa/legal/DPA-TEMPLATE.md',
  'pwa/legal/DATA-RESIDENCY.md', 'pwa/legal/VPAT-2.5-EU.md',
];

// 1a. No German document tree or siblings.
if (fs.existsSync(path.join(ROOT, 'README.de.md'))) failures.push('README.de.md still exists');
if (fs.existsSync(path.join(ROOT, 'docs/de'))) failures.push('docs/de/ still exists');
walk(ROOT, (abs) => {
  if (abs.endsWith('.de.md')) failures.push(`${rel(abs)}: German sibling still exists`);
  if (abs.endsWith('.md')) stats.docs++;
});

// 1b. Customer-facing docs: exist, English-only (no CJK).
for (const r of CUSTOMER_DOCS) {
  const abs = path.join(ROOT, r);
  if (!fs.existsSync(abs)) { failures.push(`${r}: missing`); continue; }
  const text = fs.readFileSync(abs, 'utf8');
  const hit = text.split('\n').find((line) => CJK.test(line));
  if (hit) failures.push(`${r}: Chinese characters remain: ${hit.slice(0, 80)}`);
}

// 2a. Product i18n must declare exactly one language: en, with no German dictionary.
const i18nPath = path.join(ROOT, 'pwa/core/i18n.js');
const i18n = fs.readFileSync(i18nPath, 'utf8');
const langsBlock = i18n.match(/export const I18N_LANGS = \[([\s\S]*?)\];/);
if (!langsBlock) failures.push('pwa/core/i18n.js: I18N_LANGS not found');
else {
  const codes = [...langsBlock[1].matchAll(/code:\s*'([^']+)'/g)].map((m) => m[1]);
  stats.langs = codes.join(',');
  if (codes.length !== 1 || codes[0] !== 'en') {
    failures.push(`pwa/core/i18n.js: languages must be exactly en (got ${codes.join(',')})`);
  }
}
if (/const DICT\s*=/.test(i18n)) failures.push('pwa/core/i18n.js: German DICT still present');
if (/ui-text-en\.js/.test(i18n)) failures.push('pwa/core/i18n.js: legacy German map import still present');

// 2b. Product assets must be CJK-free and expose no non-English language hooks.
walk(path.join(ROOT, 'pwa'), (abs) => {
  if (!/\.(?:html|js|mjs|css)$/.test(abs)) return;
  stats.pwaFiles++;
  const text = fs.readFileSync(abs, 'utf8');
  const hit = text.split('\n').find((line) => CJK.test(line));
  if (hit) failures.push(`${rel(abs)}: CJK remains: ${hit.slice(0, 80)}`);
  if (/data-lang="(?:de|fr|es|zh)"|lang="(?:de|fr|es|zh)"/.test(text)) {
    failures.push(`${rel(abs)}: non-English language block remains`);
  }
});

const summary = `LANGUAGE-POLICY-GATE: ${stats.docs} docs · ${stats.pwaFiles} product assets · i18n ${stats.langs || '?'} (English-only, no German dictionary)`;
if (failures.length) {
  console.error(summary);
  for (const f of failures) console.error(' - ' + f);
  console.error(`LANGUAGE-POLICY-FAILED: ${failures.length} issue(s)`);
  process.exit(1);
}
console.log(summary);
console.log('LANGUAGE-POLICY-OK');
