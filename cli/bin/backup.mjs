#!/usr/bin/env node
/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */
// Offline, zero-dependency backup wrapper for pwa/backup.html exports.
//   export  : JSON -> checksum-protected ZIP (SHA256SUMS + MANIFEST.json + VERIFY.txt)
//   verify  : ZIP -> recompute every entry digest, fail closed on any mismatch
//   restore : verify, then extract the original JSON for browser re-import
// No network, no third-party ZIP library, no personal data is logged.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { readZip, writeZip } = require('../core/zip-stream.js');

const ENTRY = 'backup.json';
const FORMAT = 'fieldseal-backup-v1';

function die(message) { process.stderr.write('BACKUP-ERROR ' + message + '\n'); process.exit(1); }
function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

function usage() {
  return [
    'FieldSeal Suite offline backup tool (zero dependencies)',
    '',
    '  node cli/bin/backup.mjs export  --input <backup.json> --out <backup.zip> [--label TEXT]',
    '  node cli/bin/backup.mjs verify  --input <backup.zip> [--json]',
    '  node cli/bin/backup.mjs restore --input <backup.zip> --out <restored.json>',
    '',
    'Exports come from pwa/backup.html. The ZIP is verified offline before any',
    'restore writes a file. Never attach real evidence to a support ticket.'
  ].join('\n');
}

async function cmdExport(args) {
  const input = args.input;
  const out = args.out;
  if (!input || !out) die('export requires --input and --out');
  const data = await readFile(input);
  let parsed;
  try { parsed = JSON.parse(data.toString('utf8')); } catch (e) { die('input is not valid JSON: ' + e.message); }
  if (parsed.format !== FORMAT) die('not a FieldSeal backup (expected ' + FORMAT + ')');
  if (!parsed.stores || typeof parsed.stores !== 'object') die('backup has no stores');
  for (const name of ['cases', 'evidence-packages', 'case-ciphers', 'signature-images']) {
    if (!Array.isArray(parsed.stores[name])) die('missing or corrupt store: ' + name);
  }
  const digest = sha256(data);
  const manifest = {
    format: 'fieldseal-backup-archive-v1',
    entry: ENTRY,
    sha256: digest,
    size: data.length,
    createdAt: parsed.createdAt || '',
    label: typeof args.label === 'string' ? args.label : '',
    counts: parsed.counts || {},
    tool: 'fieldseal-suite/backup.mjs'
  };
  const sums = digest + '  ' + ENTRY + '\n';
  const verifyText = [
    'FieldSeal Suite offline backup',
    '',
    'Verify:  node cli/bin/backup.mjs verify --input ' + path.basename(out),
    'Restore: node cli/bin/backup.mjs restore --input ' + path.basename(out) + ' --out restored.json',
    '',
    'backup.json SHA-256: ' + digest,
    'Entries: ' + Object.entries(manifest.counts).map(([k, v]) => k + '=' + v).join(', '),
    '',
    'All processing is local. No network access is used by this tool.'
  ].join('\n') + '\n';
  await writeZip(out, [
    { name: ENTRY, data },
    { name: 'SHA256SUMS', data: Buffer.from(sums) },
    { name: 'MANIFEST.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) },
    { name: 'VERIFY.txt', data: Buffer.from(verifyText) }
  ]);
  const s = await stat(out);
  process.stdout.write('BACKUP-EXPORT-OK ' + out + ' (' + s.size + ' bytes, sha256=' + digest + ')\n');
}

async function inspect(zipPath) {
  const zip = await readZip(zipPath);
  try {
    const entry = zip.getEntry(ENTRY);
    if (!entry) die('archive has no ' + ENTRY);
    const sumsEntry = zip.getEntry('SHA256SUMS');
    const manifestEntry = zip.getEntry('MANIFEST.json');
    if (!sumsEntry || !manifestEntry) die('archive is missing SHA256SUMS or MANIFEST.json');
    const sums = await zip.readText(sumsEntry);
    const manifest = JSON.parse(await zip.readText(manifestEntry));
    // zip-stream.hashEntry() returns the CLI hasher's URI form ("sha256:<hex>");
    // SHA256SUMS / MANIFEST.json store the bare hex digest.
    const actual = String(await zip.hashEntry(entry)).replace(/^sha256:/, '');
    const expected = (sums.trim().split(/\s+/)[0] || '').toLowerCase();
    const problems = [];
    if (actual !== expected) problems.push('SHA256SUMS mismatch');
    if (manifest.sha256 !== actual) problems.push('MANIFEST.json sha256 mismatch');
    if (manifest.size !== entry.uncompressedSize) problems.push('size mismatch');
    if (manifest.entry !== ENTRY) problems.push('manifest entry name mismatch');
    return { zip, entry, actual, manifest, problems };
  } catch (e) {
    await zip.close();
    throw e;
  }
}

async function cmdVerify(args) {
  if (!args.input) die('verify requires --input');
  const info = await inspect(args.input);
  try {
    if (info.problems.length) {
      process.stdout.write('BACKUP-VERIFY-FAILED ' + info.problems.join('; ') + '\n');
      process.exitCode = 1;
    } else if (args.json) {
      process.stdout.write(JSON.stringify({ ok: true, sha256: info.actual, size: info.manifest.size, counts: info.manifest.counts }, null, 2) + '\n');
    } else {
      process.stdout.write('BACKUP-VERIFY-OK sha256=' + info.actual + ' size=' + info.manifest.size + '\n');
    }
  } finally { await info.zip.close(); }
}

async function cmdRestore(args) {
  if (!args.input || !args.out) die('restore requires --input and --out');
  const info = await inspect(args.input);
  try {
    if (info.problems.length) die('archive failed verification: ' + info.problems.join('; '));
    await info.zip.extractToFile(info.entry, args.out);
    const restored = await readFile(args.out);
    if (sha256(restored) !== info.actual) die('restored file does not match the verified digest');
    process.stdout.write('BACKUP-RESTORE-OK ' + args.out + ' (sha256=' + info.actual + ')\n');
  } finally { await info.zip.close(); }
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0];
if (!command || command === 'help' || args.help) process.stdout.write(usage() + '\n');
else if (command === 'export') await cmdExport(args);
else if (command === 'verify') await cmdVerify(args);
else if (command === 'restore') await cmdRestore(args);
else die('unknown command: ' + command);
