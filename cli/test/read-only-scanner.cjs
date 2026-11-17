'use strict';
/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * FieldSeal Suite — read-only scanner (zero dependencies).
 *
 * Modes:
 *   node cli/test/read-only-scanner.cjs page-modules   HTML inline-module syntax + import resolution
 *   node cli/test/read-only-scanner.cjs attribution    attribution / watermark four-layer scan
 *   node cli/test/read-only-scanner.cjs audit          dependency / remote / vendor-global audit
 *   node cli/test/read-only-scanner.cjs all             all of the above
 *
 * Nothing is modified outside cli/test/fixtures/.tmp/ (a git-ignored scratch directory).
 * Every check is read-then-report: no source file is ever rewritten by this scanner.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRATCH = path.join(__dirname, 'fixtures', '.tmp');
const modes = process.argv.slice(2);
const active = modes.length ? modes : ['all'];
const want = (m) => active.includes(m) || active.includes('all');

const errors = [];
const lines = [];
function fail(msg) { errors.push(msg); }
function say(msg) { lines.push(msg); }

function walk(dir, out = []) {
  let names;
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const entry of names) {
    if (entry.name === 'node_modules' || entry.name === '.tmp' || entry.name.startsWith('.git')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const files = walk(ROOT);
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const read = (p) => fs.readFileSync(p, 'utf8');
const htmlFiles = files.filter((f) => /\.html$/i.test(f));
const pwaJs = files.filter((f) => /\.js$/i.test(f) && f.startsWith(path.join(ROOT, 'pwa') + path.sep));
const cliJs = files.filter((f) => /\.js$/i.test(f) && f.startsWith(path.join(ROOT, 'cli') + path.sep));

function checkSyntax(source, label, kind, quiet = false) {
  fs.mkdirSync(SCRATCH, { recursive: true });
  const ext = kind === 'esm' ? '.mjs' : '.cjs';
  const tmp = path.join(SCRATCH, 'syntax-probe' + ext);
  fs.writeFileSync(tmp, source);
  const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
  if (r.status !== 0) {
    if (!quiet) fail(label + ': syntax error -> ' + String(r.stderr || r.stdout).trim().split('\n')[0]);
    return false;
  }
  return true;
}

// The cli/ tree holds BOTH CommonJS modules and ESM modules with a .js extension
// (e.g. cli/verify/tsa-verify.js). A .cjs probe rejects ESM syntax; a .mjs probe
// rejects nothing that valid CJS needs at parse time. Probe both and only report a
// real syntax error when neither parses — otherwise an ESM CLI file is a false
// positive that makes the whole scanner read SYNTAX-AND-IMPORTS-FAILED.
function checkSyntaxAuto(source, label) {
  if (checkSyntax(source, label, 'cjs', true)) return true;
  if (checkSyntax(source, label, 'esm', true)) return true;
  fail(label + ': syntax error (neither CJS nor ESM parses)');
  return false;
}

function specifiers(source) {
  const out = [];
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /^\s*import\s*['"]([^'"]+)['"]/gm,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(source)) !== null) out.push(m[1]);
  }
  return out;
}

function checkImports(source, baseDir, label) {
  let n = 0;
  for (const spec of specifiers(source)) {
    if (/^https?:\/\//i.test(spec)) { fail(label + ': remote specifier ' + spec); continue; }
    if (!spec.startsWith('.')) { fail(label + ': non-relative specifier ' + spec); continue; }
    const target = path.resolve(baseDir, spec.split('?')[0].split('#')[0]);
    if (!fs.existsSync(target)) fail(label + ': unresolved import ' + spec);
    n++;
  }
  return n;
}

function pageModules() {
  say('-- page inline-module syntax and import resolution --');
  let pages = 0, inline = 0, imports = 0;
  for (const file of htmlFiles) {
    const src = read(file);
    const blocks = Array.from(src.matchAll(/<script\b[^>]*\btype\s*=\s*["']module["'][^>]*>([\s\S]*?)<\/script>/gi));
    for (const b of blocks) {
      inline++;
      const label = rel(file) + ' inline module #' + (inline);
      checkSyntax(b[1], label, 'esm');
      imports += checkImports(b[1], path.dirname(file), label);
    }
    pages++;
    say('OK  ' + rel(file) + '  (inline modules: ' + blocks.length + ')');
  }
  for (const file of pwaJs) {
    checkSyntax(read(file), rel(file), 'esm');
    imports += checkImports(read(file), path.dirname(file), rel(file));
  }
  for (const file of cliJs) checkSyntaxAuto(read(file), rel(file));
  say('scanned ' + pages + ' HTML pages, ' + pwaJs.length + ' PWA JS modules, ' + cliJs.length + ' CLI JS modules, ' + inline + ' inline modules, ' + imports + ' relative imports');
  say(errors.length ? 'SYNTAX-AND-IMPORTS-FAILED' : 'SYNTAX-AND-IMPORTS-OK');
}

const HEADER_MARK = 'FieldSeal Suite — Copyright (c) 2026';
const ISOLATION_NOTICE = 'All extension hooks are side-effect isolated. Extension libraries can only receive read-only copies of case data. Any mutation to core case state, custody logs, schema or seal hash MUST go through the native core functions of the main branch. Extension-generated attachments are excluded from the top-level seal hash. Core hash and state machine never reference window.EXT_HOOKS.';

function sourceFiles() {
  return files.filter((f) => /\.(js|cjs|html|css)$/i.test(f) && !f.split(path.sep).includes('.tmp'));
}

function codeOnly(source) {
  // Strip comment lines so a documentation sentence mentioning window.EXT_HOOKS is not
  // mistaken for a first-party read of the vendor global.
  return source.split(/\r?\n/).filter((line) => !/^\s*(\/\/|\*|\/\*|<!--)/.test(line)).join('\n');
}

const VENDOR_GLOBAL_RE = /window\s*\.\s*EXT_HOOKS|window\s*\[\s*['"]EXT_HOOKS['"]\s*\]|window\s*\[\s*VENDOR_GLOBAL_NAME\s*\]/;

function attribution() {
  say('-- attribution / four-layer watermark scan --');
  const n0 = errors.length;
  const src = sourceFiles();
  const missing1 = src.filter((f) => !read(f).includes(HEADER_MARK));
  say('layer 1 source headers : ' + (src.length - missing1.length) + '/' + src.length + ' identical');
  for (const f of missing1.slice(0, 30)) say('  MISSING ' + rel(f));
  if (missing1.length) fail('layer 1: ' + missing1.length + ' source files lack the identical header');

  const bannerPages = htmlFiles.filter((f) => read(f).includes('printStartupBanner()'));
  say('layer 2 startup banner : ' + bannerPages.length + ' page(s) -> ' + bannerPages.map(rel).join(', '));
  if (!bannerPages.length) fail('layer 2: no startup console banner');

  const attrSrc = read(path.join(ROOT, 'pwa', 'helpers', 'attribution.js'));
  const versionMatch = attrSrc.match(/version:\s*'([^']+)'/);
  const version = versionMatch ? versionMatch[1] : null;
  if (!version) fail('layer 3: cannot read ATTRIBUTION.version from pwa/helpers/attribution.js');
  const footerPages = htmlFiles.filter((f) => /<footer[\s>]/i.test(read(f)));
  const missing3 = footerPages.filter((f) => {
    const page = read(f);
    return !page.includes('class="attribution"')
      || !page.includes('FieldSeal Suite ' + version)
      || !page.includes('License: MIT')
      || !page.includes('Ownership:');
  });
  say('layer 3 UI footer      : ' + (footerPages.length - missing3.length) + '/' + footerPages.length
    + ' pages (version ' + version + ', MIT, Ownership)');
  for (const f of missing3.slice(0, 30)) say('  MISSING/INCOMPLETE ' + rel(f));
  if (missing3.length) fail('layer 3: ' + missing3.length + ' pages lack the full ' + version + ' attribution footer (version + licence + ownership)');

  const exportSrc = read(path.join(ROOT, 'pwa', 'helpers', 'case-export.js'));
  const layer4 = ['ATTRIBUTION_LINE', 'csvAttributionLine', 'reportFooterHtml', 'print-attribution'];
  const missing4 = layer4.filter((t) => !exportSrc.includes(t));
  say('layer 4 export artefacts: ' + (layer4.length - missing4.length) + '/' + layer4.length + ' markers');
  for (const t of missing4) fail('layer 4: missing ' + t);
  say(errors.length > n0 ? 'ATTRIBUTION-INCOMPLETE' : 'ATTRIBUTION-4-LAYERS-OK');
}

function audit() {
  say('-- dependency / remote / vendor-global audit --');
  const n0 = errors.length;
  const banned = ['package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];
  const manifests = banned.filter((n) => fs.existsSync(path.join(ROOT, n)));
  say('dependency manifests   : ' + (manifests.length ? manifests.join(', ') : '0'));
  if (manifests.length) fail('dependency manifest present: ' + manifests.join(', '));
  const modules = files.filter((f) => f.split(path.sep).includes('node_modules'));
  say('vendored modules       : ' + modules.length);
  if (modules.length) fail('node_modules present');

  const builtins = new Set(require('module').builtinModules);
  const external = [];
  for (const f of files.filter((x) => /\.(js|html)$/i.test(x))) {
    for (const spec of specifiers(read(f))) {
      const bare = spec.startsWith('node:') ? spec.slice(5) : spec;
      if (!spec.startsWith('.') && !builtins.has(bare)) external.push(rel(f) + ' -> ' + spec);
    }
  }
  say('external imports       : ' + external.length);
  for (const e of external.slice(0, 20)) say('  ' + e);
  if (external.length) fail(external.length + ' external imports');

  const remotePages = htmlFiles.filter((f) => /https?:\/\//i.test(read(f)));
  say('remote URLs in pages   : ' + remotePages.length);
  if (remotePages.length) fail('remote URL in ' + remotePages.map(rel).join(', '));

  const vendorReaders = files.filter((f) => /\.(js|html)$/i.test(f) && VENDOR_GLOBAL_RE.test(codeOnly(read(f))));
  const illegal = vendorReaders.filter((f) => !rel(f).startsWith('pwa/vendor/'));
  say('vendor-global readers  : ' + vendorReaders.length + ' (illegal outside pwa/vendor: ' + illegal.length + ')');
  for (const f of illegal) fail('first-party code reads window.EXT_HOOKS: ' + rel(f));
  const hookSrc = read(path.join(ROOT, 'pwa', 'helpers', 'ext-hooks.js'));
  say('fixed isolation notice : ' + (hookSrc.includes(ISOLATION_NOTICE) ? 'present verbatim' : 'MISSING'));
  if (!hookSrc.includes(ISOLATION_NOTICE)) fail('fixed English isolation notice missing');
  for (const t of ['isAvailable(', 'setHookOverride(', 'readVendorHook', 'FEATURE_FLAGS']) {
    if (!hookSrc.includes(t)) fail('hook isolation missing ' + t);
  }

  const exportSrc = read(path.join(ROOT, 'pwa', 'helpers', 'case-export.js'));
  const hashes = /subtle\.digest|createHash|shaUri\(|computeRootHash\(/.test(exportSrc);
  say('export layer computes hashes : ' + (hashes ? 'YES (forbidden)' : 'no'));
  if (hashes) fail('export layer computes hashes');
  say('attachments in checksum contract : ' + (exportSrc.includes('extra.attachments') && exportSrc.includes('buildCaseFilesSha256(entries)') ? 'yes' : 'MISSING'));
  if (!exportSrc.includes('extra.attachments')) fail('attachments not wired into export entries');
  say(errors.length > n0 ? 'AUDIT-FAILED' : 'AUDIT-OK');
}

if (want('page-modules')) pageModules();
if (want('attribution')) attribution();
if (want('audit')) audit();

process.stdout.write(lines.join('\n') + '\n');
if (errors.length) {
  process.stdout.write('\nERRORS (' + errors.length + '):\n' + errors.join('\n') + '\n');
  process.exit(1);
}
