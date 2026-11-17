/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * Batch Exhibit index exporter (P1 #3). Reads sealed FieldSeal CASE packages (ZIP) and produces an
 * audit ledger (CSV + JSON) that assigns an Exhibit number to each evidence item / sealed case.
 *
 * HARD BOUNDARIES (do not cross):
 *   - READ-ONLY. It never modifies a case package, its manifest, or any sealHash / rootHash. The
 *     hash values in the ledger are COPIED from the manifest — never recomputed, never re-aggregated.
 *   - It does NOT participate in the trust root. referenceNtpTime (if present) is carried through but
 *     never written back into any case.
 *   - Only `sealed` cases are indexed. `draft` / `pending_countersign` are marked `skipped` + reason.
 *   - No upload, no network, no third-party dependency (Node built-ins + the kernel's read-only ZIP
 *     reader only). The kernel (case-manifest.js / hash.js) is used for reading, never modified.
 *
 * Usage:
 *   node exhibit-batch.mjs --cases <dir|file> [<dir|file> ...] [--out <dir>] [--prefix EXH]
 *                          [--copy] [--no-csv] [--no-json]
 */
import { createRequire } from 'node:module';
import { promises as fs, existsSync, statSync } from 'node:fs';
import { join, resolve, extname, basename } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const { readZip } = require('../../cli/core/zip-stream.js');

const MANIFEST_ENTRY = 'case-manifest.json';
const STATUS_SEALED = 'sealed';

export function formatExhibit(n, prefix = 'EXH') {
  return prefix + '-' + String(n).padStart(5, '0');
}

function csvField(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

const COLUMNS = [
  'caseId', 'caseTitle', 'sealHash', 'sealedAt', 'exhibitNo', 'evidencePackageId',
  'evidenceType', 'collectedAt', 'ntpReferenceTime', 'hashDigest', 'fileSize', 'status', 'note'
];

function buildRow(fields) {
  const row = {};
  for (const c of COLUMNS) row[c] = fields[c] != null ? fields[c] : '';
  return row;
}

/** Read a case package: returns { ok, manifest, handle, evidenceSizes, error }. Caller must close handle. */
export async function readCasePackage(zipPath) {
  let handle;
  try {
    handle = await readZip(zipPath);
    const entry = handle.getEntry(MANIFEST_ENTRY);
    if (!entry) return { ok: false, error: MANIFEST_ENTRY + ' missing', handle: null, evidenceSizes: {} };
    const text = await handle.readText(entry, 16 * 1024 * 1024);
    const manifest = JSON.parse(text);
    // Map each evidence sub-package id -> its stored ZIP size (read-only, from the central dir).
    const evidenceSizes = {};
    for (const e of handle.entries) {
      const m = /^evidence\/([^/]+)\.zip$/i.exec(e.name);
      if (m) evidenceSizes[m[1]] = e.uncompressedSize;
    }
    return { ok: true, manifest, handle, evidenceSizes };
  } catch (e) {
    if (handle) try { await handle.close(); } catch (_) {}
    return { ok: false, error: String((e && e.message) || e), handle: null, evidenceSizes: {} };
  }
}

/** Build the index rows from a list of unique zip paths. Returns { rows, errors }. */
export async function buildIndex(zipPaths, { prefix = 'EXH' } = {}) {
  const rows = [];
  const errors = [];
  let counter = 0;
  for (const zipPath of zipPaths) {
    const read = await readCasePackage(zipPath);
    if (!read.ok) {
      errors.push({ path: zipPath, error: read.error });
      rows.push(buildRow({ caseId: '', caseTitle: '', exhibitNo: '', status: 'error', note: read.error }));
      continue;
    }
    const m = read.manifest;
    const evidenceSizes = read.evidenceSizes || {};
    const caseId = m.packageId || '';
    const caseTitle = (m.caseMeta && m.caseMeta.title) || '';
    const sealHash = m.sealHash || '';
    const sealedAt = m.sealedAt || '';
    const state = m.state || '';
    try { await read.handle.close(); } catch (_) {}

    if (state !== STATUS_SEALED) {
      rows.push(buildRow({
        caseId, caseTitle, sealHash, sealedAt,
        exhibitNo: '', status: 'skipped', note: 'state=' + state + ' (not sealed)'
      }));
      continue;
    }

    const children = Array.isArray(m.children) ? m.children : [];
    if (children.length === 0) {
      counter += 1;
      rows.push(buildRow({
        caseId, caseTitle, sealHash, sealedAt,
        exhibitNo: formatExhibit(counter, prefix),
        evidencePackageId: caseId, evidenceType: 'sealed-case',
        collectedAt: sealedAt, ntpReferenceTime: '', hashDigest: sealHash,
        fileSize: '', status: 'ok', note: 'sealed case, no child evidence'
      }));
      continue;
    }

    for (const child of children) {
      counter += 1;
      rows.push(buildRow({
        caseId, caseTitle, sealHash, sealedAt,
        exhibitNo: formatExhibit(counter, prefix),
        evidencePackageId: child.packageId || '',
        evidenceType: child.evidenceType || child.type || child.spec || '',
        collectedAt: child.capturedUtc || child.collectedAt || '',
        ntpReferenceTime: child.referenceNtpTime || '',
        hashDigest: child.rootHash || '',
        fileSize: evidenceSizes[child.packageId] != null ? evidenceSizes[child.packageId] : '',
        status: 'ok', note: ''
      }));
    }
  }
  return { rows, errors };
}

export function toCsv(rows) {
  const lines = [COLUMNS.join(',')];
  for (const r of rows) lines.push(COLUMNS.map((c) => csvField(r[c])).join(','));
  return lines.join('\r\n') + '\r\n';
}

export function toJson(rows, { prefix = 'EXH' } = {}) {
  return {
    tool: 'fieldseal-exhibit-batch',
    generatedUtc: new Date().toISOString(),
    prefix,
    count: rows.length,
    columns: COLUMNS,
    exhibits: rows
  };
}

/** Collect unique *.zip paths from a mix of files and directories. */
export function collectZipPaths(inputs) {
  const out = [];
  const seen = new Set();
  const walk = (p) => {
    const st = statSync(p);
    if (st.isDirectory()) {
      for (const f of fsSyncReaddir(p)) walk(join(p, f));
    } else if (extname(p).toLowerCase() === '.zip') {
      const abs = resolve(p);
      if (!seen.has(abs)) { seen.add(abs); out.push(abs); }
    }
  };
  for (const inp of inputs) walk(resolve(inp));
  return out;
}
// Synchronous readdir to keep collectZipPaths simple (small fixture dirs).
import { readdirSync } from 'node:fs';
function fsSyncReaddir(p) { return readdirSync(p); }

export async function copyPackages(zipPaths, outDir) {
  if (!existsSync(outDir)) await fs.mkdir(outDir, { recursive: true });
  for (const p of zipPaths) {
    const dest = join(outDir, basename(p));
    await fs.copyFile(p, dest); // hard copy; originals are never modified
  }
}

export function parseArgs(argv) {
  const args = { cases: [], out: process.cwd(), prefix: 'EXH', copy: false, csv: true, json: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cases') { while (argv[i + 1] && !argv[i + 1].startsWith('--')) args.cases.push(argv[++i]); }
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--prefix') args.prefix = argv[++i];
    else if (a === '--copy') args.copy = true;
    else if (a === '--no-csv') args.csv = false;
    else if (a === '--no-json') args.json = false;
    else if (!a.startsWith('-')) args.cases.push(a);
  }
  return args;
}

export async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.cases.length) {
    throw new Error('no input: pass --cases <dir|file> [<dir|file> ...]');
  }
  const zipPaths = collectZipPaths(args.cases);
  const { rows, errors } = await buildIndex(zipPaths, { prefix: args.prefix });
  if (!existsSync(args.out)) await fs.mkdir(args.out, { recursive: true });
  if (args.json) await fs.writeFile(join(args.out, 'exhibit-index.json'), JSON.stringify(toJson(rows, { prefix: args.prefix }), null, 2), 'utf8');
  if (args.csv) await fs.writeFile(join(args.out, 'exhibit-index.csv'), toCsv(rows), 'utf8');
  if (args.copy) await copyPackages(zipPaths.filter((p) => existsSync(p)), args.out);
  return { out: args.out, rows, errors, zipCount: zipPaths.length };
}

// JSON output for the CLI is written to disk; also print a short summary to stdout.
export async function main() {
  const result = await run();
  process.stdout.write(
    'indexed ' + result.zipCount + ' package(s), ' + result.rows.length + ' row(s) -> ' + result.out + '\n' +
    (result.errors.length ? 'errors: ' + result.errors.length + '\n' : '')
  );
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { process.stderr.write('error: ' + String((e && e.message) || e) + '\n'); process.exit(2); });
}
