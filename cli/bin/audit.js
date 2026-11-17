#!/usr/bin/env node
/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const verifyCore = require('../core/verify');
const bundleCore = require('../core/bundle');
const zipStream = require('../core/zip-stream');
const custodyCore = require('../core/custody');
const publicSchema = require('../core/public-schema');
const { computeRootHash, shaUri, normalizeAlgorithm, HASH_PREFIX } = require('../core/hash');

let TOOL_VERSION;
try { TOOL_VERSION = require('../package.json').version; } catch (error) { TOOL_VERSION = 'dev'; }

// Synchronous stdout so piped/spawnSync consumers always receive the full output
// (async process.stdout.write can truncate on exit when stdout is a pipe).
function writeOut(s) { fs.writeSync(1, s); }

const USAGE = `FieldSeal Suite - file-forensics-audit (zero runtime dependencies)

Usage:
  node cli/bin/audit.js verify <package.zip> [--json] [--linked <evidence.zip>]... [--no-link]
                                       [--strict] [--audit-only] [--hash-algorithm sha256|sha3-256]
  node cli/bin/audit.js bundle <pkg1.zip> <pkg2.zip> ... <out.zip> [--json]
  node cli/bin/audit.js custody <evidence.zip> --meta-json <file|-> [--hash-algorithm sha256|sha3-256] [--out <path>] [--json]
  node cli/bin/audit.js schema
  node cli/bin/audit.js report-html <package.zip> [--linked <evidence.zip>]... [--no-link]
  node cli/bin/audit.js report-certificate <package.zip> [--linked <evidence.zip>]... [--no-link]
  node cli/bin/audit.js report-txt <package.zip> [--linked <evidence.zip>]... [--no-link]
  node cli/bin/audit.js report-csv <bundle.zip>
  node cli/bin/audit.js case verify <case-dir|case.zip> [--json]

Options:
  --json            machine-readable JSON on stdout (verify / bundle / custody)
  --linked <path>   additional evidence package for cross-package hash binding
  --no-link         skip cross-package binding check (verify / report-html)
  --strict          court mode: only explicit --linked counts, no auto-discovery
  --audit-only      internal-audit mode: tolerate a missing linked package
  --hash-algorithm  sha256 (default) or sha3-256 for manifest rootHash binding
  --meta-json       custody metadata JSON file for --custody (use - for stdin)
  --out             output path for --custody (default: overwrite input)

Exit codes: 0 = ok, 1 = verification failed, 2 = usage or internal error.
`;

function parseArgs(args) {
  const positional = [];
  const linked = [];
  const flags = { json: false, noLink: false, strict: false, auditOnly: false, hashAlgorithm: 'sha256' };
  let metaJson = null;
  let out = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') flags.json = true;
    else if (arg === '--no-link') flags.noLink = true;
    else if (arg === '--strict') flags.strict = true;
    else if (arg === '--audit-only') flags.auditOnly = true;
    else if (arg === '--linked') {
      if (i + 1 >= args.length) throw new Error('--linked requires a path');
      linked.push(args[++i]);
    } else if (arg.startsWith('--linked=')) linked.push(arg.slice('--linked='.length));
    else if (arg === '--hash-algorithm') {
      if (i + 1 >= args.length) throw new Error('--hash-algorithm requires a value');
      flags.hashAlgorithm = args[++i];
    } else if (arg === '--meta-json') {
      if (i + 1 >= args.length) throw new Error('--meta-json requires a value');
      metaJson = args[++i];
    } else if (arg === '--out') {
      if (i + 1 >= args.length) throw new Error('--out requires a value');
      out = args[++i];
    } else if (arg.startsWith('-')) throw new Error('unknown option: ' + arg);
    else positional.push(arg);
  }
  return { positional, linked, flags, metaJson, out };
}

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function localTz(utc, tzIana) {
  if (!utc || !tzIana) return '';
  try {
    return new Intl.DateTimeFormat('de-DE', { timeZone: tzIana, dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(utc));
  } catch (error) {
    return '';
  }
}

function renderParties(parties) {
  if (!Array.isArray(parties) || parties.length === 0) return '';
  let rows = '';
  for (const party of parties) {
    const role = party.role || 'Signatory';
    const cls = role === 'Witness' ? 'witness' : 'signatory';
    const local = localTz(party.signedAt, party.tzIana);
    const reservation = party.reservation
      ? '<span class="reservation">&#9888; Reservation / Vorbehalt: ' + escapeHtml(party.reservation) + '</span>'
      : '';
    const witnessNote = role === 'Witness'
      ? '<br><small>A witness only attests that the signature event took place; does not confirm evidence validity.</small>'
      : '';
    rows += '<tr>'
      + '<td>' + escapeHtml(party.name) + (party.organization ? ' &middot; ' + escapeHtml(party.organization) : '') + '</td>'
      + '<td class="' + cls + '">' + escapeHtml(role) + witnessNote + '</td>'
      + '<td>' + escapeHtml(party.referenceId || '-') + '</td>'
      + '<td>' + escapeHtml(party.licenseNo || '-') + '</td>'
      + '<td class="mono">' + escapeHtml(party.signedAt) + (local ? '<br><small>' + escapeHtml(local) + '</small>' : '') + '</td>'
      + '<td>' + reservation + '</td>'
      + '</tr>';
  }
  return '<h2>Parties / Beteiligte</h2>'
    + '<table><thead><tr><th>Name</th><th>Role</th><th>Ref / Geschäfts-Nr.</th><th>License</th><th>Signed (UTC / local)</th><th>Reservation</th></tr></thead>'
    + '<tbody>' + rows + '</tbody></table>';
}

function renderRevision(extras) {
  if (!extras || !extras.supersedesPackageId) return '';
  return '<h2>Revision / Revision</h2>'
    + '<table><tbody>'
    + '<tr><th>Supersedes packageId</th><td class="mono">' + escapeHtml(extras.supersedesPackageId) + '</td></tr>'
    + (extras.revisionReason ? '<tr><th>Reason</th><td>' + escapeHtml(extras.revisionReason) + '</td></tr>' : '')
    + '</tbody></table>';
}

function renderSupplement(result) {
  if (result.packageType !== 'supplement') return '';
  const e = result.pluginExtras || {};
  return '<h2>Supplemental supporting document / Ergänzende Unterlage</h2>'
    + '<p class="note">This is a supplemental package. It does not alter the original evidence package hash. / Dies ist eine Ergänzung; sie verändert den Hash des Original-Beweispakets nicht.</p>'
    + '<table><tbody>'
    + '<tr><th>Bound evidence packageId</th><td class="mono">' + escapeHtml(e.supplementToEvidenceId || '') + '</td></tr>'
    + '<tr><th>Note</th><td>' + escapeHtml(e.note || '') + '</td></tr>'
    + '</tbody></table>';
}

function renderTimezone(result) {
  const e = result.pluginExtras || {};
  if (!e.tzIana || !e.createdAt) return '';
  const local = localTz(e.createdAt, e.tzIana);
  return '<h2>Timestamp / Zeitstempel</h2>'
    + '<table><tbody>'
    + '<tr><th>Created (UTC)</th><td class="mono">' + escapeHtml(e.createdAt) + '</td></tr>'
    + '<tr><th>' + escapeHtml(e.tzIana) + ' (local)</th><td>' + escapeHtml(local) + '</td></tr>'
    + '</tbody></table>';
}

function renderCustody(result) {
  const e = result.pluginExtras || {};
  const c = e.custody;
  if (!c || typeof c !== 'object') return '';
  const rows = (pairs) => pairs.filter((p) => p[1] !== undefined && p[1] !== '').map((p) =>
    '<tr><th>' + escapeHtml(p[0]) + '</th><td>' + escapeHtml(p[1]) + '</td></tr>').join('');
  let html = '<h2>Chain of Custody / 保管链</h2>';
  html += '<table><tbody>'
    + rows([
      ['Meta template', c.metaTemplate],
      ['Evidence purpose', c.evidencePurpose],
      ['Jurisdiction', c.jurisdiction],
      ['Case / Audit reference', c.caseReference],
      ['Evidence ID', c.evidenceIdentifier],
      ['Custody start (UTC)', c.custodyStartUtc],
      ['General note', c.custodyNote]
    ])
    + '</tbody></table>';
  if (Array.isArray(c.chainOfCustody) && c.chainOfCustody.length) {
    html += '<h2>Custody transfers / 流转条目</h2><table><thead><tr>'
      + '<th>Actor</th><th>Role</th><th>Organization</th><th>Contact</th><th>Action</th><th>Time (UTC)</th><th>Location</th><th>Device</th><th>Signature ref</th><th>Note</th>'
      + '</tr></thead><tbody>';
    for (const it of c.chainOfCustody) {
      html += '<tr>'
        + '<td>' + escapeHtml(it.actorName || '') + '</td>'
        + '<td>' + escapeHtml(it.actorRole || '') + '</td>'
        + '<td>' + escapeHtml(it.actorOrganization || '') + '</td>'
        + '<td>' + escapeHtml(it.actorContactRef || '') + '</td>'
        + '<td>' + escapeHtml(it.actionType || '') + '</td>'
        + '<td class="mono">' + escapeHtml(it.actionUtc || '') + '</td>'
        + '<td>' + escapeHtml(it.location || '') + '</td>'
        + '<td>' + escapeHtml(it.deviceRef || '') + '</td>'
        + '<td>' + escapeHtml(it.signatureReference || '') + '</td>'
        + '<td>' + escapeHtml(it.entryNote || '') + '</td>'
        + '</tr>';
    }
    html += '</tbody></table>';
  }
  if (Array.isArray(c.customExtraFields) && c.customExtraFields.length) {
    html += '<h2>Custom extra fields / 自定义扩展字段</h2><table><thead><tr>'
      + '<th>Key</th><th>Label</th><th>Value</th><th>Type</th></tr></thead><tbody>';
    for (const f of c.customExtraFields) {
      html += '<tr><td class="mono">' + escapeHtml(f.fieldKey || '') + '</td>'
        + '<td>' + escapeHtml(f.fieldLabel || '') + '</td>'
        + '<td>' + escapeHtml(f.fieldValue || '') + '</td>'
        + '<td>' + escapeHtml(f.fieldType || '') + '</td></tr>';
    }
    html += '</tbody></table>';
  }
  return html;
}

const ADMISSIBILITY_DISCLAIMER = 'This report is a tamper-evident cryptographic verification record generated by the FieldSeal Suite. '
  + 'It is NOT a qualified electronic signature under eIDAS and provides no legal advice or guarantee of admissibility in any court or jurisdiction. '
  + 'Hashes bind the recorded metadata (including chain-of-custody) to the evidence package; however, device timestamps may be altered and the '
  + 'identity and authority of all participants must be independently verified by the relying party.';

function renderReport(template, result, source) {
  const e = result.pluginExtras || {};
  const map = {
    TITLE: escapeHtml('FieldSeal Suite - Audit Report'),
    GENERATED_AT: escapeHtml(new Date().toISOString()),
    SOURCE: escapeHtml(path.basename(source)),
    CORE_RESULT: escapeHtml(result.coreResult),
    RESULT_CLASS: result.coreResult === 'ok' ? 'ok' : 'bad',
    PACKAGE_TYPE: escapeHtml(result.packageType),
    PACKAGE_ID: escapeHtml(result.packageId),
    ROOT_HASH: escapeHtml(result.rootHash),
    EXTRAS_JSON: escapeHtml(JSON.stringify(result.pluginExtras, null, 2)),
    SIGN_MODE_SECTION: (e.signMode)
      ? '<h2>Signing mode / Unterschriftsmodus</h2>\n<table><tbody>\n'
        + '<tr><th>Mode</th><td class="mono">' + escapeHtml(e.signMode) + '</td></tr>\n'
        + (e.modeNote ? '<tr><th>Note</th><td>' + escapeHtml(e.modeNote) + '</td></tr>\n' : '')
        + '</tbody></table>'
      : '',
    TIMEZONE_SEC: renderTimezone(result),
    PARTIES_SEC: renderParties(e.parties),
    REVISION_SEC: renderRevision(e),
    SUPPLEMENT_SEC: renderSupplement(result),
    CUSTODY_SEC: renderCustody(result),
    DISCLAIMER_SEC: '<h2>Admissibility Disclaimer</h2>\n<p class="note">' + escapeHtml(ADMISSIBILITY_DISCLAIMER) + '</p>'
  };
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(map, key) ? map[key] : match);
}

function renderCertificate(result, source) {
  const e = result.pluginExtras || {};
  const local = localTz(e.createdAt, e.tzIana);
  const parties = Array.isArray(e.parties) ? e.parties.map((p) => escapeHtml(p.name) + (p.role ? ' (' + escapeHtml(p.role) + ')' : '')).join(', ') : '';
  const cls = result.coreResult === 'ok' ? 'ok' : 'bad';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>FieldSeal Verification Certificate</title>'
    + '<style>body{font:14px/1.6 -apple-system,Segoe UI,Arial,sans-serif;max-width:720px;margin:40px auto;color:#1d1d1f}'
    + '.badge{padding:6px 14px;border-radius:999px;font-weight:600}.badge.ok{background:#e3f6e8;color:#1a6b32}.badge.bad{background:#fdeaea;color:#a32121}'
    + 'table{width:100%;border-collapse:collapse;margin:16px 0}td,th{text-align:left;padding:8px;border-bottom:1px solid #e5e5ea}'
    + 'th{width:160px;color:#6e6e73}.mono{font-family:ui-monospace,Menlo,monospace;font-size:12px;word-break:break-all}'
    + '@media print{body{margin:0}}</style></head><body>'
    + '<h1>Verification Certificate / Verifizierungszertifikat</h1>'
    + '<p>Tool: FieldSeal Suite v' + escapeHtml(TOOL_VERSION) + ' &middot; Generated: ' + escapeHtml(new Date().toISOString()) + '</p>'
    + '<p><span class="badge ' + cls + '">' + escapeHtml(result.coreResult) + '</span></p>'
    + '<table><tbody>'
    + '<tr><th>Package type</th><td>' + escapeHtml(result.packageType) + '</td></tr>'
    + '<tr><th>Package ID</th><td class="mono">' + escapeHtml(result.packageId) + '</td></tr>'
    + '<tr><th>Root hash</th><td class="mono">' + escapeHtml(result.rootHash) + '</td></tr>'
    + (e.createdAt ? '<tr><th>Created (UTC)</th><td class="mono">' + escapeHtml(e.createdAt) + '</td></tr>' : '')
    + (local ? '<tr><th>Created (local)</th><td>' + escapeHtml(local) + '</td></tr>' : '')
    + (e.signMode ? '<tr><th>Signing mode</th><td>' + escapeHtml(e.signMode) + '</td></tr>' : '')
    + (parties ? '<tr><th>Parties</th><td>' + parties + '</td></tr>' : '')
    + '</tbody></table>'
    + '<p class="mono" style="color:#6e6e73">This certificate is a tamper-evident cryptographic verification record. It is NOT a qualified electronic signature under eIDAS and provides no legal advice.</p>'
    + '</body></html>';
}

function renderTxt(result) {
  const e = result.pluginExtras || {};
  const local = localTz(e.createdAt, e.tzIana);
  let out = '';
  out += 'FieldSeal Suite - Audit Summary / Prüfzusammenfassung\n';
  out += 'Tool version : ' + TOOL_VERSION + '\n';
  out += 'Generated     : ' + new Date().toISOString() + '\n';
  out += 'Result        : ' + result.coreResult + '\n';
  out += 'Package type  : ' + result.packageType + '\n';
  out += 'Package ID    : ' + result.packageId + '\n';
  out += 'Root hash     : ' + result.rootHash + '\n';
  if (e.createdAt) out += 'Created (UTC)  : ' + e.createdAt + (e.tzIana ? '  (' + e.tzIana + ': ' + local + ')' : '') + '\n';
  if (e.supersedesPackageId) out += 'Supersedes    : ' + e.supersedesPackageId + '\n';
  if (e.revisionReason) out += 'Revision note : ' + e.revisionReason + '\n';
  if (e.signMode) out += 'Signing mode   : ' + e.signMode + '\n';
  if (Array.isArray(e.parties) && e.parties.length) {
    out += 'Parties:\n';
    for (const party of e.parties) {
      out += '  - ' + party.name
        + (party.role ? ' (' + party.role + ')' : '')
        + (party.referenceId ? '  ref=' + party.referenceId : '')
        + (party.reservation ? '  [RESERVATION: ' + party.reservation + ']' : '')
        + '\n';
    }
  }
  if (result.packageType === 'supplement') {
    out += 'Bound evidence: ' + (e.supplementToEvidenceId || '') + '\n';
    out += 'Supplement note: ' + (e.note || '') + '\n';
  }
  return out;
}

// CSV formula-injection guard: neutralise leading = + - @ (optionally after whitespace).
function csvCell(value) {
  let text = String(value === null || value === undefined ? '' : value);
  if (/^\s*[=+\-@]/.test(text)) text = "'" + text;
  return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

async function reportCsv(bundlePath) {
  const handle = await zipStream.readZip(bundlePath);
  let manifest;
  try { manifest = JSON.parse(await handle.readText(handle.getEntry('bundle-index.json'))); } catch (error) { throw new Error('cannot read bundle manifest: ' + error.message); }
  if (!manifest || manifest.spec !== 'fieldseal-bundle-v0.1') throw new Error('report-csv requires a bundle package');

  const tmpDir = path.join(os.tmpdir(), 'fieldseal-csv-' + process.pid + '-' + Date.now());
  await fs.promises.mkdir(tmpDir, { recursive: true });
  const rows = [];
  const customKeys = new Set();
  try {
    for (const entry of handle.entries) {
      if (!entry.name.endsWith('.zip') || entry.name.indexOf('/') !== -1) continue;
      const tmp = path.join(tmpDir, entry.name);
      await handle.extractToFile(entry, tmp);
      const res = await verifyCore.verifyPackage(tmp, { noLink: true });
      const parties = res.pluginExtras.parties || [];
      const signers = parties.map((p) => p.name).join('|');
      const c = res.pluginExtras.custody || null;
      const actor = (c && Array.isArray(c.chainOfCustody) && c.chainOfCustody[0]) || {};
      const custodyEntries = (c && Array.isArray(c.chainOfCustody)) ? c.chainOfCustody.length : 0;
      const customFields = (c && Array.isArray(c.customExtraFields)) ? c.customExtraFields : [];
      for (const f of customFields) customKeys.add(f.fieldKey);
      rows.push({
        asset_id: (c && c.evidenceIdentifier) || res.packageId,
        control_domain: c ? (c.jurisdiction || '') : '',
        audit_ref: c ? (c.caseReference || '') : '',
        packageId: res.packageId,
        rootHash: res.rootHash,
        integrity_result: res.coreResult,
        signers,
        custodian: actor.actorName || '',
        collection_time: (c && c.custodyStartUtc) || '',
        custody_entries: custodyEntries,
        custom: customFields
      });
    }
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
  const baseCols = ['asset_id', 'control_domain', 'audit_ref', 'packageId', 'rootHash', 'integrity_result', 'signers', 'custodian', 'collection_time', 'custody_entries'];
  const customCols = Array.from(customKeys).sort();
  const header = baseCols.concat(customCols.map((k) => 'custom_' + k));
  const lines = [header.join(',')];
  for (const row of rows) {
    const cells = baseCols.map((col) => csvCell(row[col]));
    for (const k of customCols) {
      const f = (row.custom || []).find((x) => x.fieldKey === k);
      cells.push(csvCell(f ? f.fieldValue : ''));
    }
    lines.push(cells.join(','));
  }
  return lines.join('\n') + '\n';
}

async function applyCustody(evidencePath, rawMeta, algorithm, outPath) {
  let meta;
  try {
    meta = JSON.parse(rawMeta);
  } catch (error) {
    throw new Error('custody metadata is not valid JSON: ' + error.message);
  }
  const result = custodyCore.validateCustody(meta);
  if (!result.ok) throw new Error('custody validation failed: ' + result.errors.join('; '));

  const handle = await zipStream.readZip(evidencePath);
  let manifest;
  try {
    manifest = JSON.parse(await handle.readText(handle.getEntry('manifest.json'), 8 * 1024 * 1024));
    if (!manifest || !String(manifest.spec || '').startsWith('fieldseal-evidence-')) {
      throw new Error('custody target must be an evidence package');
    }
    if (algorithm !== 'sha256') {
      manifest.hashAlgorithm = algorithm;
      for (const file of (manifest.files || [])) {
        const entry = handle.getEntry(file.name);
        if (!entry) continue;
        file.hash = shaUri(await handle.readBytes(entry), algorithm);
      }
    }
    manifest.custody = meta;
    manifest.rootHash = computeRootHash(manifest);
  } finally {
    await handle.close();
  }

  const sources = [{ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest), 'utf8') }];
  const h2 = await zipStream.readZip(evidencePath);
  try {
    for (const entry of h2.entries) {
      if (entry.name === 'manifest.json') continue;
      sources.push({ name: entry.name, data: await h2.readBytes(entry) });
    }
  } finally {
    await h2.close();
  }
  await zipStream.writeZip(outPath, sources);
  return {
    packageId: manifest.packageId,
    rootHash: manifest.rootHash,
    hashAlgorithm: manifest.hashAlgorithm || 'sha256',
    custodyMetaTemplate: meta.metaTemplate || '',
    custodyEntries: Array.isArray(meta.chainOfCustody) ? meta.chainOfCustody.length : 0,
    customFields: Array.isArray(meta.customExtraFields) ? meta.customExtraFields.length : 0
  };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    writeOut(USAGE);
    return 0;
  }
  const command = argv[0];
  const { positional, linked, flags, metaJson, out } = parseArgs(argv.slice(1));

  if (command === 'verify') {
    if (positional.length !== 1) throw new Error('verify requires exactly one package path');
    const result = await verifyCore.verifyPackage(positional[0], {
      linkedPaths: linked,
      noLink: flags.noLink,
      autoDiscover: !flags.strict
    });
    if (flags.auditOnly && result.coreResult === 'missing_linked_package') {
      result.coreResult = 'ok';
      result.pluginExtras.auditOnly = true;
      result.pluginExtras.reason = 'missing linked package tolerated under --audit-only';
    }
    if (flags.json) {
      writeOut(JSON.stringify(result, null, 2) + '\n');
    } else {
      writeOut(
        'coreResult : ' + result.coreResult + '\n' +
        'packageType: ' + result.packageType + '\n' +
        'packageId  : ' + result.packageId + '\n' +
        'rootHash   : ' + result.rootHash + '\n' +
        'pluginExtras: ' + JSON.stringify(result.pluginExtras, null, 2) + '\n'
      );
    }
    return result.coreResult === 'ok' ? 0 : 1;
  }

  if (command === 'case') {
    const sub = argv[1];
    if (sub !== 'verify') throw new Error('unknown case subcommand: ' + sub);
    const target = positional.filter((p) => p !== sub);
    if (target.length < 1) throw new Error('case verify requires a case directory or .zip path');
    const caseVerify = require('../core/case-verify');
    const res = await caseVerify.verifyCaseExport(target[0]);
    if (flags.json) {
      writeOut(JSON.stringify(res, null, 2) + '\n');
    } else {
      const lines = ['coreResult : ' + res.coreResult, 'sealHash   : ' + res.sealHash, 'rootHash   : ' + res.rootHash, 'children   :'];
      for (const ch of res.children) lines.push('  - ' + ch.packageId + ' [' + ch.coreResult + '] rootHash ' + ch.rootHash);
      if (res.errors && res.errors.length) lines.push('errors     : ' + res.errors.join('; '));
      writeOut(lines.join('\n') + '\n');
    }
    return res.coreResult === 'ok' ? 0 : 1;
  }

  if (command === 'custody') {
    if (positional.length !== 1) throw new Error('custody requires exactly one evidence package path');
    if (!metaJson) throw new Error('custody requires --meta-json <file|->');
    let raw;
    if (metaJson === '-') {
      raw = fs.readFileSync(0, 'utf8');
    } else {
      raw = fs.readFileSync(metaJson, 'utf8');
    }
    const applied = await applyCustody(positional[0], raw, normalizeAlgorithm(flags.hashAlgorithm), out || positional[0]);
    if (flags.json) writeOut(JSON.stringify(applied, null, 2) + '\n');
    else writeOut('custody applied: ' + applied.packageId + ' rootHash=' + applied.rootHash + ' algorithm=' + applied.hashAlgorithm + '\n');
    return 0;
  }

  if (command === 'schema') {
    writeOut(JSON.stringify(publicSchema, null, 2) + '\n');
    return 0;
  }

  if (command === 'bundle') {
    if (positional.length < 2) throw new Error('bundle requires at least one input and one output path');
    const output = positional[positional.length - 1];
    const inputs = positional.slice(0, -1);
    const info = await bundleCore.buildBundle(inputs, output);
    if (flags.json) {
      writeOut(JSON.stringify({
        action: 'bundle',
        output: info.outputPath,
        bundleId: info.bundleId,
        rootHash: info.rootHash,
        items: info.items
      }, null, 2) + '\n');
    } else {
      writeOut(
        'bundle written: ' + info.outputPath + '\n' +
        'bundleId: ' + info.bundleId + '\n' +
        'rootHash: ' + info.rootHash + '\n' +
        'items: ' + info.items.length + '\n'
      );
    }
    return 0;
  }

  if (command === 'report-html') {
    if (positional.length !== 1) throw new Error('report-html requires exactly one package path');
    const result = await verifyCore.verifyPackage(positional[0], {
      linkedPaths: linked, noLink: flags.noLink, autoDiscover: true
    });
    const template = fs.readFileSync(path.join(__dirname, '..', 'report', 'template.html'), 'utf8');
    writeOut(renderReport(template, result, positional[0]));
    return 0;
  }

  if (command === 'report-certificate') {
    if (positional.length !== 1) throw new Error('report-certificate requires exactly one package path');
    const result = await verifyCore.verifyPackage(positional[0], {
      linkedPaths: linked, noLink: flags.noLink, autoDiscover: true
    });
    writeOut(renderCertificate(result, positional[0]));
    return 0;
  }

  if (command === 'report-txt') {
    if (positional.length !== 1) throw new Error('report-txt requires exactly one package path');
    const result = await verifyCore.verifyPackage(positional[0], {
      linkedPaths: linked, noLink: flags.noLink, autoDiscover: true
    });
    writeOut(renderTxt(result));
    return 0;
  }

  if (command === 'report-csv') {
    if (positional.length !== 1) throw new Error('report-csv requires exactly one bundle path');
    writeOut(await reportCsv(positional[0]));
    return 0;
  }

  throw new Error('unknown command: ' + command);
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((err) => {
    process.stderr.write('error: ' + String((err && err.message) || err) + '\n');
    process.stderr.write(USAGE);
    process.exitCode = 2;
  });
