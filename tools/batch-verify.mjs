#!/usr/bin/env node
/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 *
 * Batch Case Verification (zero runtime dependencies)
 *
 * Reuses the EXACT trusted verifier (cli/bin/audit.js case verify) for every package. The
 * verification logic is never re-implemented — only scheduling/wrapping is added — so batch output
 * is identical to single-file verification. Runs on a stock Node.js runtime (built-in modules only).
 *
 * Usage:
 *   node tools/batch-verify.mjs <path-or-dir> [<more>...] [--out <report.json>] [--strict]
 *
 * If an argument is a directory, every *.zip inside it (recursively) is verified.
 * Output: a combined JSON report listing each package's coreResult / specVersion / rootHash.
 * Exit code: 0 if all are ok, 1 if any tampered/invalid_spec (unless --strict only counts that).
 */
import { readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { argv } from 'node:process';

function collect(dir, out) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) collect(full, out);
    else if (name.toLowerCase().endsWith('.zip') && !name.startsWith('fieldseal-verify')) out.push(full);
  }
}

function verifyOne(path) {
  try {
    const raw = execFileSync('node', [resolve('cli/bin/audit.js'), 'case', 'verify', path, '--json'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    });
    const j = JSON.parse(raw);
    return { path, coreResult: j.coreResult, specVersion: j.specVersion, rootHash: j.rootHash, errors: j.errors || [] };
  } catch (e) {
    const msg = (e.stderr || e.stdout || e.message || '').toString();
    const m = msg.match(/"coreResult"\s*:\s*"([a-z]+)"/);
    if (m) return { path, coreResult: m[1], specVersion: null, rootHash: null, errors: [msg.split('\n')[0]] };
    return { path, coreResult: 'error', specVersion: null, rootHash: null, errors: [msg.split('\n')[0]] };
  }
}

function main() {
  const args = argv.slice(2);
  const inputs = [];
  let out = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') out = args[++i];
    else inputs.push(args[i]);
  }
  if (inputs.length < 1) {
    console.error('Usage: node tools/batch-verify.mjs <path-or-dir> [...] [--out <report.json>]');
    process.exit(2);
  }
  const targets = [];
  for (const inp of inputs) {
    const p = resolve(inp);
    if (!existsSync(p)) { console.error('Not found: ' + p); process.exit(2); }
    if (statSync(p).isDirectory()) collect(p, targets);
    else targets.push(p);
  }
  const results = targets.map(verifyOne);
  const summary = {
    tool: 'fieldseal-batch-verify',
    verifiedAtUtc: new Date().toISOString(),
    total: results.length,
    counts: results.reduce((acc, r) => { acc[r.coreResult] = (acc[r.coreResult] || 0) + 1; return acc; }, {}),
    results
  };
  const text = JSON.stringify(summary, null, 2);
  if (out) { writeFileSync(out, text); console.log('Wrote ' + out); }
  console.log(text);
  const bad = results.filter((r) => r.coreResult !== 'ok').length;
  process.exit(bad ? 1 : 0);
}

main();
