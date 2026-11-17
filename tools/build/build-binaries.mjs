/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 *
 * Build tooling: wraps the EXISTING trusted CLI (cli/bin/audit.js) into statically
 * bundled, offline, cross-platform binaries using `pkg`. The trusted kernel
 * (pwa/core/case-manifest.js) is byte-for-byte unchanged — the binary is purely a
 * distribution form of the audited CLI. cli/core/case-verify.js carries only a pkg-safe
 * loader shim (a fallback used exclusively when running inside the bundle).
 *
 * It then emits a SHA256 manifest (SHA256SUMS) plus a structured manifest.json. The
 * release engineer signs SHA256SUMS with the offline release key (see verify-binaries.mjs).
 *
 * Run:  cd tools/build && npm install && npm run build
 */
import { exec } from 'pkg';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..'); // project root (fieldseal-suite)
const ENTRY = join(ROOT, 'cli', 'bin', 'audit.js');
const OUT_DIR = join(HERE, 'dist');
const BINARY_BASE = 'fieldseal-case-verify';

// pkg base binaries: pin an LTS that pkg ships (5.8.1 supports up to node18).
const NODE_BASE = 'node18';
const TARGETS = [
  { target: `${NODE_BASE}-linux-x64`,   ext: '' },
  { target: `${NODE_BASE}-macos-x64`,   ext: '' },
  { target: `${NODE_BASE}-macos-arm64`, ext: '' },
  { target: `${NODE_BASE}-win-x64`,     ext: '.exe' }
];

// case-verify.js loads the ESM core (pwa/core/case-manifest.js, which statically imports
// ./hash.js) via a computed dynamic import(). pkg cannot serve ESM from its snapshot through a
// dynamic import, and its asset store uses build-machine-absolute paths that are not portable.
// So the build transpiles the two ESM modules to CommonJS and embeds the result as strings inside
// cli/core/_embedded-core.generated.js — a plain CJS module pkg bundles normally. At runtime the
// loader shim materializes them into a real temp dir and require()s them (CJS is pkg-native). The
// trusted hash logic is byte-for-byte unchanged; only the module format/loading differs.

const EMBEDDED_CORE_PATH = join(ROOT, 'cli', 'core', '_embedded-core.generated.js');

// Targeted ESM -> CJS transform for these specific, simple ES modules (only export const/function
// and one sibling import / one re-export list). Verified end-to-end by the golden case-verify run.
function esmToCjs(source, siblingRequirePath) {
  let s = source;
  // Sibling ESM import -> CJS require.
  s = s.replace(
    /import\s*\{([^}]*)\}\s*from\s*['"]\.\/hash\.js['"]\s*;?/g,
    (_m, names) => `const {${names}} = require('${siblingRequirePath}');`
  );
  const exported = new Set();
  // export const|let|var NAME
  s = s.replace(/export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/g, (_m, name) => {
    exported.add(name);
    return `const ${name}`;
  });
  // export (async )function NAME
  s = s.replace(/export\s+(async\s+)?function\s+([A-Za-z0-9_$]+)/g, (_m, asyncKw, name) => {
    exported.add(name);
    return `${asyncKw || ''}function ${name}`;
  });
  // export { a, b, c };
  s = s.replace(/export\s*\{([^}]*)\}\s*;?/g, (_m, names) => {
    names.split(',').forEach((n) => { const t = n.trim(); if (t) exported.add(t); });
    return '';
  });
  const list = [...exported].join(', ');
  return s + `\nmodule.exports = { ${list} };\n`;
}

function platformLabel(target) {
  return target.replace(/^node\d+-/, '');
}

async function buildOne({ target, ext }) {
  const outName = `${BINARY_BASE}-${platformLabel(target)}${ext}`;
  const out = join(OUT_DIR, outName);
  const args = [
    ENTRY,
    '--target', target,
    '--output', out
  ];
  console.log('[build] pkg ' + target + ' -> ' + outName);
  await exec(args);
  return outName;
}

function generateEmbeddedCore() {
  const hashSrc = readFileSync(join(ROOT, 'pwa', 'core', 'hash.js'), 'utf8');
  const manifestSrc = readFileSync(join(ROOT, 'pwa', 'core', 'case-manifest.js'), 'utf8');
  const hashCjs = esmToCjs(hashSrc, './hash.cjs');
  const manifestCjs = esmToCjs(manifestSrc, './hash.cjs');
  const content =
`/**
 * GENERATED build artifact — embedded CommonJS port of the trusted ESM case core, for the pkg
 * bundle only. Produced by tools/build/build-binaries.mjs; not used in un-bundled Node
 * (cli/core/case-verify.js imports the ESM directly there). Do not edit by hand.
 */
module.exports = {
  'hash.cjs': ${JSON.stringify(hashCjs)},
  'case-manifest.cjs': ${JSON.stringify(manifestCjs)}
};
`;
  writeFileSync(EMBEDDED_CORE_PATH, content);
}

function removeEmbeddedCore() {
  if (existsSync(EMBEDDED_CORE_PATH)) {
    try { unlinkSync(EMBEDDED_CORE_PATH); } catch (e) { /* best-effort */ }
  }
}

function sha256File(p) {
  const h = createHash('sha256');
  h.update(readFileSync(p));
  return h.digest('hex');
}

async function main() {
  if (!existsSync(ENTRY)) throw new Error('entry not found: ' + ENTRY);
  generateEmbeddedCore();
  let built = [];
  try {
    mkdirSync(OUT_DIR, { recursive: true });
    for (const t of TARGETS) built.push(await buildOne(t));
  } finally {
    removeEmbeddedCore();
  }

  // SHA256SUMS (sha256sum-compatible: "<hash>  <name>")
  const sums = [];
  const entries = [];
  for (const name of built) {
    const p = join(OUT_DIR, name);
    const hash = sha256File(p);
    const size = statSync(p).size;
    sums.push(`${hash}  ${name}`);
    entries.push({ name, sha256: hash, size, target: name.replace(BINARY_BASE + '-', '').replace(/\.exe$/, '') });
  }
  const sumsText = sums.join('\n') + '\n';
  writeFileSync(join(OUT_DIR, 'SHA256SUMS'), sumsText);

  const manifest = {
    tool: 'fieldseal-case-verify',
    generatedUtc: new Date().toISOString(),
    nodeBase: NODE_BASE,
    entry: 'cli/bin/audit.js',
    usage: 'fieldseal-case-verify case verify <case.zip|case-dir> [--json]',
    signature: {
      scheme: 'ed25519-detached',
      status: 'unsigned',
      signedFile: 'SHA256SUMS',
      signatureFile: 'SHA256SUMS.sig',
      publicKeyFile: 'RELEASE-PUBLIC-KEY.pem',
      note: 'SHA256SUMS is unsigned by this script. Sign with `node tools/release/release-tool.mjs sign` using the offline release key, and take a `snapshot` before deploying.'
    },
    binaries: entries
  };
  writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log('\n[build] wrote dist/SHA256SUMS and dist/manifest.json');
  console.log(sumsText);
  console.log('[build] next: node tools/release/release-tool.mjs snapshot   (rollback point BEFORE deploy)');
  console.log('[build] next: node tools/release/release-tool.mjs sign       (offline release key)');
  console.log('[build] next: node tools/build/verify-binaries.mjs           (offline verification)');
}

main().catch((e) => { console.error('build failed:', e && e.message ? e.message : e); process.exit(1); });
