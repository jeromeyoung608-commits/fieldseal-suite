/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Regression: offline cold start must not 404 (delivery audit RM-04 / F6). Build the
// transitive closure of every relative ES module imported by a PWA page, then assert
// sw.js PRECACHE contains all of them and that every PRECACHE entry exists on disk.
// This is a static check: no browser, no network, no dependencies.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve, relative, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const PWA = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SW = readFileSync(join(PWA, 'sw.js'), 'utf8');

const block = SW.match(/const PRECACHE = \[([\s\S]*?)\];/);
assert(block, 'sw.js: cannot locate PRECACHE array');
const precache = new Set(
 [...block[1].matchAll(/['"](\.\/[^'"]+)['"]/g)]
 .map((m) => posix.normalize(m[1]).replace(/^\.\//, ''))
);

const IMPORT_RE = /(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+\.(?:js|mjs))['"]/g;
const pages = readdirSync(PWA).filter((f) => f.endsWith('.html'));
const needed = new Set();
const visited = new Set();

function walk(file) {
 const abs = resolve(file);
 if (visited.has(abs) || !existsSync(abs)) return;
 visited.add(abs);
 const source = readFileSync(abs, 'utf8');
 for (const match of source.matchAll(IMPORT_RE)) {
 const target = resolve(dirname(abs), match[1]);
 if (!existsSync(target)) continue;
 const rel = relative(PWA, target).split('\\').join('/');
 needed.add(rel);
 walk(target);
 }
}
for (const page of pages) walk(join(PWA, page));

// Every first-party page and every in-product legal document must also open on a
// cold offline start: the footer links to them, and a 404 there breaks GDPR Art.12
// self-service even though the app itself still boots.
const pageEntries = pages.map((f) => f);
const legalDir = join(PWA, 'legal');
const legalEntries = existsSync(legalDir)
 ? readdirSync(legalDir).filter((f) => f.endsWith('.md')).map((f) => 'legal/' + f)
 : [];
const missingPages = [...pageEntries, ...legalEntries].filter((f) => !precache.has(f)).sort();
const missing = [...needed].filter((f) => !precache.has(f)).sort();
const dangling = [...precache].filter((f) => !existsSync(join(PWA, f))).sort();
assert.deepEqual(missing, [], 'sw.js PRECACHE misses modules imported by pages: ' + missing.join(', '));
assert.deepEqual(missingPages, [], 'sw.js PRECACHE misses pages/legal documents: ' + missingPages.join(', '));
assert.deepEqual(dangling, [], 'sw.js PRECACHE lists files that do not exist: ' + dangling.join(', '));
assert(/fieldseal-suite-case-v\d+/.test(SW), 'CACHE_NAME must be versioned (bump on every PRECACHE change)');

process.stdout.write('FIELDSEAL-TEST-OK sw-precache (' + pages.length + ' pages, ' + needed.size + ' modules, ' +
 legalEntries.length + ' legal docs, ' + precache.size + ' precached)\n');
