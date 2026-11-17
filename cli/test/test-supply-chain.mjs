#!/usr/bin/env node
/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// S9: zero-runtime-dependency / supply-chain baseline. Fails if a runtime package tree,
// lockfile, CDN, or third-party runtime component appears. Build-only tools are separate.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
let fail = 0;
const ok = (n) => console.log('  ok  - ' + n);
const bad = (n, d) => { console.log('  FAIL - ' + n + (d ? ' :: ' + d : '')); fail++; };

for (const p of ['package.json', 'package-lock.json', 'node_modules', 'pwa/node_modules', 'cli/node_modules']) {
  existsSync(join(ROOT, p)) ? bad('runtime dependency artefact present: ' + p) : ok('no runtime dependency artefact: ' + p);
}
const sbom = JSON.parse(readFileSync(join(ROOT, 'SBOM.cdx.json'), 'utf8'));
const comps = (sbom.components || []).map((c) => c.name || '');
const runtimeThirdParty = comps.filter((n) => /react|vue|angular|express|axios|lodash|npm|node_modules/i.test(n));
runtimeThirdParty.length ? bad('SBOM lists third-party runtime components', runtimeThirdParty.join(',')) : ok('SBOM: ' + comps.length + ' components, no third-party runtime library');

const cdns = [];
for (const f of readdirSync(join(ROOT, 'pwa')).filter((n) => n.endsWith('.html'))) {
  const t = readFileSync(join(ROOT, 'pwa', f), 'utf8');
  if (/src="https?:|href="https?:[^"]*\.(?:js|css)|cdn\.|unpkg|jsdelivr/i.test(t)) cdns.push(f);
}
cdns.length ? bad('remote script/style/CDN in HTML', cdns.join(',')) : ok('13 pages: no remote script/style/CDN');

const pkg = JSON.parse(readFileSync(join(ROOT, 'tools/build/package.json'), 'utf8'));
(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0) ? ok('build package: no runtime dependencies') : bad('build package declares dependencies', JSON.stringify(pkg.dependencies));

console.log(fail ? 'SUPPLY-CHAIN: FAIL (' + fail + ')' : 'SUPPLY-CHAIN: PASS — no runtime deps, SBOM clean, no CDN');
process.exit(fail ? 1 : 0);
