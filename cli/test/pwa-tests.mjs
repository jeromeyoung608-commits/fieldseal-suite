#!/usr/bin/env node
/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 *
 * Runs every PWA-side unit test (pwa/<dir>/test-*.mjs across core/helpers/vendor/export/ui)
 * as a real gate. These tests were
 * previously orphaned (not referenced by any gate), so their passing evidence was never
 * counted. This runner makes them first-class: any failure => non-zero exit (gate red).
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const dirs = ['pwa/core', 'pwa/helpers', 'pwa/vendor', 'pwa/export', 'pwa/ui'];
const tests = [];
for (const d of dirs) {
  const full = join(ROOT, d);
  if (!existsSync(full)) continue;
  for (const f of readdirSync(full).sort()) {
    if (/^test-.*\.mjs$/.test(f)) tests.push(join(full, f));
  }
}

let failed = 0;
const seen = new Set();
for (const t of tests) {
  if (seen.has(t)) continue;
  seen.add(t);
  const rel = t.replace(ROOT + '/', '');
  const r = spawnSync(process.execPath, [t], { cwd: ROOT, encoding: 'utf8', timeout: 120000, env: { ...process.env, NODE_NO_WARNINGS: '1' } });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log('[' + (ok ? 'PASS' : 'FAIL') + '] ' + rel + (ok ? '' : '  (exit ' + (r.status ?? 'timeout') + ')'));
  if (!ok && r.stdout) console.log('   ' + (r.stdout || '').trim().split('\n').slice(-6).join('\n   '));
}
console.log('\nPWA unit tests: ' + (tests.length - failed) + '/' + tests.length + ' passed' + (failed ? '  — GATE FAIL' : '  — GATE OK'));
process.exitCode = failed ? 1 : 0;
