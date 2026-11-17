#!/usr/bin/env node
/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */
// Static PWA module-load smoke: verifies every named import used by a PWA HTML/JS
// module resolves to a real export in its target module. This catches the exact bug
// class behind BUG-003 ("X does not provide an export named Y") WITHOUT a browser.
//
// Why a browser-less check is enough here: a <script type=module> that fails to
// resolve a single named import throws at load time and renders ZERO buttons. String
// assertions in the old gate saw the button markup in source but never executed the
// module graph, so 140/140 stayed green while the export page was dead. Resolving the
// full import graph statically finds the same failure the browser would.
//
// Run: node cli/test/test-module-imports.mjs   (exit 0 = OK, 1 = broken import)
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

const ROOT = resolve(process.cwd(), 'pwa');
if (!existsSync(ROOT)) {
  console.error('MODULE-IMPORT-CHECK: pwa/ not found at ' + ROOT);
  process.exit(1);
}
const errors = [];

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(html|js)$/.test(name)) out.push(p);
  }
  return out;
}

// Strip JS comments (line + block) while respecting string literals, so that
// `import '...'` mentions inside comments or strings are not mistaken for code.
function stripComments(src) {
  let out = '';
  let i = 0;
  let inStr = null;
  while (i < src.length) {
    const c = src[i];
    if (inStr) {
      if (c === '\\') { out += c + (src[i + 1] || ''); i += 2; continue; }
      if (c === inStr) { inStr = null; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2; out += '\n'; continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; out += c; i++; continue; }
    out += c; i++;
  }
  return out;
}

function collectExports(src) {
  const names = new Set();
  let hasDefault = false;
  let wildcard = false;
  for (const line of src.split('\n')) {
    const s = line.trim();
    if (/^export\s+default\b/.test(s)) hasDefault = true;
    let m;
    const reFn = /^export\s+(?:async\s+)?(?:function\*?|class)\s+([A-Za-z0-9_$]+)/;
    if ((m = reFn.exec(s))) names.add(m[1]);
    const reVar = /^export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/;
    if ((m = reVar.exec(s))) names.add(m[1]);
    const reList = /^export\s*\{([^}]*)\}/;
    if ((m = reList.exec(s))) {
      for (let part of m[1].split(',')) {
        part = part.trim();
        if (!part) continue;
        const exported = part.split(/\s+as\s+/).pop().trim();
        if (exported) names.add(exported);
      }
    }
    if (/^export\s+\*\s+from\b/.test(s)) wildcard = true;
  }
  return { names, hasDefault, wildcard };
}

function parseImports(src, file, problems) {
  const importRe = /import\s+(?:([A-Za-z0-9_$]+)\s*,?\s*)?(?:\*\s+as\s+[A-Za-z0-9_$]+\s*)?(?:\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = importRe.exec(src))) {
    const def = m[1];
    const named = m[2];
    const spec = m[3];
    if (!spec.startsWith('.')) continue; // skip node:/bare specifiers
    const target = resolve(dirname(file), spec);
    if (!existsSync(target)) { problems.push(`${relative(ROOT, file)} -> ${spec}: target not found`); continue; }
    const ex = collectExports(readFileSync(target, 'utf8'));
    if (def && !ex.hasDefault && !ex.wildcard) {
      problems.push(`${relative(ROOT, file)} imports default from ${spec} but it has no default export`);
    }
    if (named) {
      for (let part of named.split(',')) {
        part = part.trim();
        if (!part) continue;
        const name = part.split(/\s+as\s+/)[0].trim();
        if (!name) continue;
        if (!ex.wildcard && !ex.names.has(name)) {
          problems.push(`${relative(ROOT, file)} imports { ${name} } from ${spec} but ${relative(ROOT, target)} does not export it`);
        }
      }
    }
  }
  const sideRe = /import\s*['"]([^'"]+)['"]/g;
  while ((m = sideRe.exec(src))) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue;
    if (!existsSync(resolve(dirname(file), spec))) {
      problems.push(`${relative(ROOT, file)} side-effect import ${spec}: target not found`);
    }
  }
}

const files = walk(ROOT, []);
for (const f of files) {
  let src;
  try { src = readFileSync(f, 'utf8'); } catch { continue; }
  src = stripComments(src);
  if (f.endsWith('.html')) {
    const re = /<script\s+type=["']module["'][^>]*>([\s\S]*?)<\/script>/g;
    let s;
    while ((s = re.exec(src))) parseImports(s[1], f, errors);
  } else {
    parseImports(src, f, errors);
  }
}

if (errors.length) {
  console.error('MODULE-IMPORT-CHECK: FAIL (' + errors.length + ')');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('MODULE-IMPORT-CHECK: OK — every named import resolves across ' + files.length + ' PWA modules');
