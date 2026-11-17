#!/usr/bin/env node
/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */
'use strict';

// Batch verification for recipient-side / internal audit bulk processing.
// Uses only Node.js built-ins (fs, path) and the project's trusted verify core.
// Scans a directory (recursively) or a single file for *.zip packages and
// verifies each, then writes batch-summary.csv and batch-summary.txt.

const fs = require('fs');
const path = require('path');
const verifyCore = require('../core/verify');

let TOOL_VERSION;
try { TOOL_VERSION = require('../package.json').version; } catch (error) { TOOL_VERSION = 'dev'; }

const USAGE = `FieldSeal Suite - batch verification (zero runtime dependencies)

Usage:
  node cli/bin/batch-verify.js <directory-or-file> [--no-link]

Walks the target for *.zip packages (evidence / signature-record / supplement /
bundle), verifies each, and writes:
  - batch-summary.csv  (packageType,packageId,rootHash,signers,referenceIds,result,path)
  - batch-summary.txt  (human-readable summary)

Options:
  --no-link   skip cross-package binding discovery (verify each package standalone)

Exit code: 0 if every package verifies ok, 1 if any failed, 2 on usage error.
`;

function parseArgs(args) {
  const positional = [];
  let noLink = false;
  for (const arg of args) {
    if (arg === '--no-link') noLink = true;
    else if (arg.startsWith('-')) throw new Error('unknown option: ' + arg);
    else positional.push(arg);
  }
  return { positional, noLink };
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.zip')) out.push(full);
  }
}

// CSV formula-injection guard: neutralise leading = + - @ (optionally after whitespace).
function csvCell(value) {
  let text = String(value === null || value === undefined ? '' : value);
  if (/^\s*[=+\-@]/.test(text)) text = "'" + text;
  return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length) { process.stdout.write(USAGE); return 2; }
  const { positional, noLink } = parseArgs(argv);
  const target = positional[0];

  let files = [];
  const stat = fs.statSync(target);
  if (stat.isDirectory()) walk(target, files);
  else if (stat.isFile()) files.push(target);
  else throw new Error('target must be a file or directory');

  const rows = [];
  const details = [];
  const counts = { total: 0, ok: 0, tampered: 0, missing_linked_package: 0, failed: 0, unsupported: 0 };

  for (const file of files) {
    let res;
    try {
      res = await verifyCore.verifyPackage(file, { autoDiscover: !noLink, noLink });
    } catch (error) {
      res = { coreResult: 'failed', packageType: 'unknown', packageId: '', rootHash: '', pluginExtras: {} };
    }
    const extras = res.pluginExtras || {};
    const parties = extras.parties || [];
    const signers = parties.map((p) => p.name).join('|');
    const refs = parties.map((p) => p.referenceId || '').join('|');
    rows.push([res.packageType, res.packageId, res.rootHash, signers, refs, res.coreResult, file].map(csvCell).join(','));
    details.push({ file, type: res.packageType, result: res.coreResult });
    counts.total += 1;
    if (res.coreResult === 'ok') counts.ok += 1;
    else if (res.coreResult === 'tampered') counts.tampered += 1;
    else if (res.coreResult === 'missing_linked_package') counts.missing_linked_package += 1;
    else counts.failed += 1;
  }

  const csv = ['packageType,packageId,rootHash,signers,referenceIds,result,path'].concat(rows).join('\n') + '\n';
  const lines = [];
  lines.push('FieldSeal Suite - Batch Verification Report');
  lines.push('Tool version : ' + TOOL_VERSION);
  lines.push('Generated     : ' + new Date().toISOString());
  lines.push('Target        : ' + target);
  lines.push('Total packages: ' + counts.total);
  lines.push('');
  lines.push('  ok                    : ' + counts.ok);
  lines.push('  tampered              : ' + counts.tampered);
  lines.push('  missing_linked_package: ' + counts.missing_linked_package);
  lines.push('  failed/unsupported    : ' + counts.failed);
  lines.push('');
  lines.push('Details:');
  for (const d of details) lines.push('  ' + d.file + '  [' + d.type + ']  ' + d.result);
  const txt = lines.join('\n') + '\n';

  fs.writeFileSync('batch-summary.csv', csv);
  fs.writeFileSync('batch-summary.txt', txt);
  process.stdout.write(txt);
  return counts.total > 0 && counts.total === counts.ok ? 0 : 1;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((err) => {
    process.stderr.write('error: ' + String((err && err.message) || err) + '\n');
    process.exitCode = 2;
  });
