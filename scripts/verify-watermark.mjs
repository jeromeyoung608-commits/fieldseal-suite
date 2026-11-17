// scripts/verify-watermark.mjs
// FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
// SPDX-License-Identifier: MIT
//
// Four-layer attribution gate. It does NOT claim the watermark is a license condition;
// it verifies that the project's own attribution is consistent and that it never
// enters the evidence trust root.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const ROOT = process.cwd();
const COPY = 'Copyright (c) 2026 FieldSeal Suite contributors';
const SPDX = 'SPDX-License-Identifier: MIT';
const EXTS = new Set(['.js', '.mjs', '.cjs', '.html', '.css']);
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.playwright-cli', 'archive-data']);
const PAGES = readdirSync(join(ROOT, 'pwa')).filter((f) => f.endsWith('.html')).sort();

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXTS.has(extname(name))) out.push(p);
  }
}

const files = [];
walk(ROOT, files);
const problems = [];

for (const f of files) {
  const head = readFileSync(f, 'utf8').split('\n').slice(0, 8).join('\n');
  if (!head.includes('FieldSeal Suite') || !head.includes(COPY) || !head.includes(SPDX)) {
    problems.push('source header missing: ' + relative(ROOT, f));
  }
}

for (const page of PAGES) {
  const html = readFileSync(join(ROOT, 'pwa', page), 'utf8');
  if (!/class="attribution"/.test(html)) problems.push(page + ': missing .attribution footer');
  if (!/FieldSeal Suite v0\.5/.test(html)) problems.push(page + ': footer lacks FieldSeal Suite v0.5');
  if (!/License: MIT/.test(html)) problems.push(page + ': footer lacks License: MIT');
}

const attr = readFileSync(join(ROOT, 'pwa', 'helpers', 'attribution.js'), 'utf8');
for (const token of ['ATTRIBUTION_LINE', 'ATTRIBUTION_LAYERS', 'printStartupBanner', 'csvAttributionLine', 'reportFooterHtml']) {
  if (!attr.includes(token)) problems.push('attribution.js missing ' + token);
}

for (const [f, token] of [
  ['pwa/export/ase-export.js', 'ATTRIBUTION_LINE'],
  ['pwa/helpers/case-export.js', 'reportFooterHtml']
]) {
  if (!existsSync(join(ROOT, f)) || !readFileSync(join(ROOT, f), 'utf8').includes(token)) {
    problems.push(f + ': export footer is not wired to ' + token);
  }
}

// The attribution text must never be written into the trust-root computation.
for (const f of ['pwa/core/case-manifest.js', 'cli/core/hash.js', 'cli/core/case-verify.js']) {
  const text = readFileSync(join(ROOT, f), 'utf8');
  if (/ATTRIBUTION_LINE|FieldSeal Suite v0\.5/.test(text)) {
    problems.push(f + ': attribution text appears in a trust-root file');
  }
}

if (problems.length) {
  console.log('[watermark] FAIL — ' + problems.length + ' problem(s):');
  for (const p of problems.slice(0, 30)) console.log('  - ' + p);
  process.exit(1);
}
console.log('[watermark] PASS — ' + files.length + ' first-party files, ' + PAGES.length + ' pages, 4 attribution layers; no attribution in trust-root files.');
