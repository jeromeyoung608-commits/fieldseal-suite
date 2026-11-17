#!/usr/bin/env node
/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 *
 * Media Verification Helper (zero runtime dependencies)
 *
 * Scans a delivery medium (USB stick / external SSD) directory and produces a tamper-evident
 * DIRECTORY hash manifest, used to form a MEDIUM chain of custody alongside the per-case
 * FieldSeal packages. It NEVER touches a case manifest, never uploads, and requires no npm
 * packages — it runs on a stock Node.js (v16+) runtime using only built-in modules.
 *
 * Usage:
 *   node tools/media-verify.mjs <directory> [--id <mediumId>] [--out <file.json>]
 *
 * Output manifest (JSON):
 *   {
 *     "tool": "fieldseal-media-verify",
 *     "mediumId": "...",            // supplied or derived (hostname + volume label if present)
 *     "scannedUtc": "...",
 *     "directory": "...",
 *     "algorithm": "sha256",
 *     "files": [ { "path": "...", "size": 123, "sha256": "..." }, ... ],   // sorted by path
 *     "directoryHash": "sha256:..."   // hash over sorted (path + size + sha256) concatenation
 *   }
 *
 * The directoryHash is recomputable by any independent auditor: re-run the tool on the same
 * medium and compare. Any added / removed / altered file changes the directoryHash.
 */
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { argv } from 'node:process';

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function walk(dir, base, out) {
  for (const name of readdirSync(dir)) {
    if (name === 'media-manifest.json' && resolve(dir, name) === resolve(base, 'media-manifest.json')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, base, out);
    else if (st.isFile()) out.push({ full, rel: relative(base, full).split(sep).join('/'), size: st.size });
  }
}

function main() {
  const args = argv.slice(2);
  const positional = [];
  let id = null, out = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--id') id = args[++i];
    else if (args[i] === '--out') out = args[++i];
    else positional.push(args[i]);
  }
  if (positional.length < 1) {
    console.error('Usage: node tools/media-verify.mjs <directory> [--id <mediumId>] [--out <file.json>]');
    process.exit(2);
  }
  const directory = resolve(positional[0]);
  const files = [];
  walk(directory, directory, files);
  const records = files
    .map((f) => ({ path: f.rel, size: f.size, sha256: sha256(readFileSync(f.full)) }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const concat = records.map((r) => r.path + '\t' + r.size + '\t' + r.sha256).join('\n');
  const directoryHash = 'sha256:' + sha256(concat);
  const manifest = {
    tool: 'fieldseal-media-verify',
    mediumId: id || (hostname() + '/' + directory),
    scannedUtc: new Date().toISOString(),
    directory,
    algorithm: 'sha256',
    fileCount: records.length,
    files: records,
    directoryHash
  };
  const text = JSON.stringify(manifest, null, 2);
  if (out) { writeFileSync(out, text); console.log('Wrote ' + out); }
  console.log(text);
}

main();
