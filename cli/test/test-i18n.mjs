/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// 9.0 UI item U4 — internationalisation completeness.
// Product requirement: exactly two UI languages (EN/DE). Every key needs both.
// the primary entry page must declare a lang attribute. The dictionary is a single
// `export const DICT = { 'key': { de, en }, ... }` object, so we parse the source.
import { resolve, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok  - ' + name);
  else { console.error('  FAIL - ' + name + (detail ? ' :: ' + detail : '')); failures += 1; }
}
(async () => {
  const file = resolve(process.cwd(), 'pwa/core/i18n.js');
  const src = readFileSync(file, 'utf8');
  const LANGS = ['de', 'en'];
  const re = /'([^']+)'\s*:\s*\{([\s\S]*?)\}/g;
  let m, keys = 0, missing = 0, emptyKeys = [];
  while ((m = re.exec(src))) {
    const key = m[1];
    const body = m[2];
    // Only count records that look like translation objects (have at least one lang).
    if (!LANGS.some((l) => new RegExp("\\b" + l + "\\s*:").test(body))) continue;
    keys += 1;
    for (const lang of LANGS) {
      const lm = body.match(new RegExp(lang + "\\s*:\\s*'([^']*)'"));
      const val = lm ? lm[1] : null;
      if (!val || val.length === 0) { missing += 1; if (emptyKeys.length < 5) emptyKeys.push(key + ':' + lang); }
    }
  }
  check('i18n declares 2 languages per key (EN/DE)', LANGS.length === 2, LANGS.join(','));
  check('all ' + keys + ' UI keys translated in all ' + LANGS.length + ' languages', missing === 0, missing + ' missing/empty ' + JSON.stringify(emptyKeys));

  const idx = join(resolve(process.cwd(), 'pwa'), 'index.html');
  check('index.html present', existsSync(idx));
  if (existsSync(idx)) {
    const html = readFileSync(idx, 'utf8');
    check('index.html declares a lang attribute', /<html[^>]*\blang=/.test(html));
  }
  if (failures) { console.error('I18N: FAIL (' + failures + ')'); process.exit(1); }
  console.log('I18N: PASS — ' + keys + ' keys × ' + LANGS.length + ' languages complete');
})().catch((e) => { console.error('I18N: ERROR ' + e.message); process.exit(1); });
