// scripts/verify-licensing.mjs
// FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
// SPDX-License-Identifier: MIT
//
// Licensing gate for the MIT-licensed project. Four layers, so a legal
// inconsistency cannot hide behind correct source headers:
//   1. Every first-party source file carries the FieldSeal copyright line AND
//      `SPDX-License-Identifier: MIT`.
//   2. The root LICENSE is the MIT License (copyright + permission text +
//      commercial notice); no first-party LICENSE file contradicts it.
//   3. The legal/compliance document set exists, names MIT, and states that MIT
//      rights are unrestricted.
//   4. No activity file still mentions the retired BUSL terms.
//
//   node scripts/verify-licensing.mjs          # report + exit non-zero on misses
//   node scripts/verify-licensing.mjs --fix    # inject the missing SPDX line

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const COPYRIGHT = 'Copyright (c) 2026 FieldSeal Suite contributors';
const SPDX = 'MIT';
const SPDX_LINE = 'SPDX-License-Identifier: ' + SPDX;
const TARGET_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.css', '.html']);
// LICENSES/ holds only a README (no third-party license texts to protect).
// fixtures/ is NOT skipped: the golden authoring scripts inside it are
// first-party and must carry the MIT header too.
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'LICENSES', '.playwright-cli', '.tmp']);
const ROOT = process.cwd();

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (TARGET_EXT.has(extname(name))) out.push(p);
  }
}

const files = [];
walk(ROOT, files);

// The copyright line sits INSIDE an existing block comment, so the SPDX line
// must be a bare line with the comment's interior prefix — never a nested
// /* */ or <!-- --> (that would terminate/comment-break the header).
function spdxLiteral(ext, copyrightLine) {
  const indent = (copyrightLine.match(/^\s*/) || [''])[0];
  if (ext === '.html') return indent + 'SPDX-License-Identifier: ' + SPDX;
  return indent + '* ' + SPDX_LINE;
}

// First-party files intentionally exempt from the MIT header go here as
// repo-relative paths. FieldSeal ships no third-party source, so this is empty.
const EXEMPT = new Set([]);
const scoped = files.filter((f) => !EXEMPT.has(f.replace(ROOT + '/', '')));

// -- Layer 2: the root LICENSE must BE the MIT License; no sub-directory LICENSE
// file may contradict it.
const licenseFiles = [join(ROOT, 'LICENSE')];
for (const sub of ['cli', 'pwa', 'tools', 'scripts']) {
  const dir = join(ROOT, sub);
  if (!existsSync(dir)) continue;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = join(dir, e.name, 'LICENSE');
    if (existsSync(p)) licenseFiles.push(p);
  }
}
const licenseProblems = [];
const rootLicense = readFileSync(join(ROOT, 'LICENSE'), 'utf8');
if (!/^MIT License/m.test(rootLicense)) licenseProblems.push({ f: 'LICENSE', why: 'first line is not "MIT License"' });
if (!rootLicense.includes(COPYRIGHT)) licenseProblems.push({ f: 'LICENSE', why: 'missing copyright line' });
if (!/Permission is hereby granted, free of charge/.test(rootLicense)) {
  licenseProblems.push({ f: 'LICENSE', why: 'missing MIT permission text' });
}
if (!/THE SOFTWARE IS PROVIDED "AS IS"/.test(rootLicense)) {
  licenseProblems.push({ f: 'LICENSE', why: 'missing MIT warranty disclaimer' });
}
if (!/Commercial notice/i.test(rootLicense)) {
  licenseProblems.push({ f: 'LICENSE', why: 'missing commercial notice' });
}
for (const lf of licenseFiles.slice(1)) {
  const t = readFileSync(lf, 'utf8');
  if (!/MIT License/.test(t) || !/Permission is hereby granted, free of charge/.test(t)) {
    licenseProblems.push({ f: lf.replace(ROOT + '/', ''), why: 'sub-directory LICENSE is not the MIT License' });
  }
}

// -- Layer 3: the legal/compliance document set must exist, name MIT, and not
// re-introduce a licence requirement.
const LEGAL_DOCS = [
  'NOTICE',
  'TRADEMARK.md',
  'EULA.md',
  'PRICING.md',
  'COMMERCIAL-LICENSE.md',
  'SBOM.md',
  'SBOM.cdx.json',
];
// `\s+` so a phrase broken across a line wrap still matches (Markdown hard-wraps).
const UNRESTRICTED_RE = /does not\s+(restrict|limit)|not a\s+condition|without\s+restricting|no\s+(license\s+)?(fee|gate|obligation)|sole\s+license|unrestricted|free\s+—/i;
const legalProblems = [];
for (const rel of LEGAL_DOCS) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) { legalProblems.push({ f: rel, why: 'missing' }); continue; }
  const t = readFileSync(p, 'utf8');
  if (!/\bMIT\b/.test(t)) legalProblems.push({ f: rel, why: 'does not name MIT' });
  if (!UNRESTRICTED_RE.test(t)) legalProblems.push({ f: rel, why: 'does not state that MIT rights are unrestricted' });
}

// -- Layer 4: no retired BUSL terminology may survive in any activity file.
// This gate script itself is exempt: it necessarily names the retired terms in
// order to detect them.
const SELF = 'scripts/verify-licensing.mjs';
const BUSL_RE = /BUSL-1\.1|Business[- ]Source License|Change Date:|Change License:|Additional Use Grant|source-available/i;
const buslHits = [];
for (const f of scoped) {
  if (f.replace(ROOT + '/', '') === SELF) continue;
  const t = readFileSync(f, 'utf8');
  if (BUSL_RE.test(t)) buslHits.push(f.replace(ROOT + '/', ''));
}
for (const rel of LEGAL_DOCS.concat(['LICENSE'])) {
  const p = join(ROOT, rel);
  if (existsSync(p) && BUSL_RE.test(readFileSync(p, 'utf8'))) buslHits.push(rel);
}

const problems = [];
for (const f of scoped) {
  const text = readFileSync(f, 'utf8');
  const head = text.split('\n').slice(0, 8).join('\n');
  const hasCopy = head.includes(COPYRIGHT);
  const hasSpdx = head.includes(SPDX_LINE);
  if (!hasCopy || !hasSpdx) problems.push({ f, hasCopy, hasSpdx });
}

function reportProblems() {
  if (licenseProblems.length) {
    console.log('[licensing] FAIL — ' + licenseProblems.length + ' LICENSE problem(s):');
    for (const { f, why } of licenseProblems) console.log('  -', f, '(' + why + ')');
  }
  if (legalProblems.length) {
    console.log('[licensing] FAIL — ' + legalProblems.length + ' legal document(s) inconsistent:');
    for (const { f, why } of legalProblems) console.log('  -', f, '(' + why + ')');
  }
  if (buslHits.length) {
    console.log('[licensing] FAIL — ' + buslHits.length + ' file(s) still mention retired BUSL terms:');
    for (const f of buslHits.slice(0, 20)) console.log('  -', f);
    if (buslHits.length > 20) console.log('  ... and ' + (buslHits.length - 20) + ' more');
  }
  if (problems.length) {
    console.log('[licensing] FAIL — ' + problems.length + ' of ' + scoped.length + ' first-party files missing required licensing metadata:');
    for (const { f, hasCopy, hasSpdx } of problems.slice(0, 20)) {
      const miss = [];
      if (!hasCopy) miss.push('copyright');
      if (!hasSpdx) miss.push('SPDX');
      console.log('  -', f.replace(ROOT + '/', ''), '(' + miss.join(' + ') + ')');
    }
    if (problems.length > 20) console.log('  ... and ' + (problems.length - 20) + ' more (run --fix)');
  }
}

const fix = process.argv.includes('--fix');
if (fix) {
  let fixed = 0;
  for (const { f, hasCopy, hasSpdx } of problems) {
    if (hasCopy && !hasSpdx) {
      const lines = readFileSync(f, 'utf8').split('\n');
      const ext = extname(f);
      const cIdx = lines.findIndex((l) => l.includes(COPYRIGHT));
      if (cIdx === -1) continue; // copyright missing — read-only-scanner owns that
      lines.splice(cIdx + 1, 0, spdxLiteral(ext, lines[cIdx]));
      writeFileSync(f, lines.join('\n'));
      fixed++;
    }
  }
  console.log('[licensing] injected SPDX into ' + fixed + ' file(s).');
  const still = problems.filter(({ f, hasCopy }) => {
    if (!hasCopy) return false;
    const t = readFileSync(f, 'utf8');
    return !t.split('\n').slice(0, 8).join('\n').includes(SPDX_LINE);
  });
  console.log(still.length === 0 ? '[licensing] ALL COVERED' : '[licensing] ' + still.length + ' still missing');
  reportProblems();
  process.exit(still.length === 0 && licenseProblems.length === 0 && legalProblems.length === 0 && buslHits.length === 0 ? 0 : 1);
}

if (problems.length === 0 && licenseProblems.length === 0 && legalProblems.length === 0 && buslHits.length === 0) {
  console.log('[licensing] PASS — ' + scoped.length + ' first-party source files carry copyright + ' + SPDX + '; ' + licenseFiles.length + ' LICENSE file(s) consistent; ' + LEGAL_DOCS.length + ' legal documents consistent; 0 retired-BUSL mentions.');
  process.exit(0);
}
reportProblems();
process.exit(1);
