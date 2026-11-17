/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */
/**
 * nexe static-binary build helper (P2 — tools/pkg).
 *
 * IMPORTANT / RED LINE: nexe is a THIRD-PARTY bundler and is NOT part of the shipped product. The
 * fieldseal-suite baseline forbids third-party runtime dependencies (the repo root has no
 * package.json / lockfile). This script therefore treats nexe strictly as an OPTIONAL, EXTERNAL dev
 * tool: it is never added to the repository, never imported at runtime, and the static binary it
 * produces is a distribution artifact, not a codebase change. If nexe is not installed, the script
 * exits with a clear, non-fatal message and the exact command a packager should run.
 *
 * What it builds: a single self-contained executable of the zero-dependency CLI verifier
 * (cli/bin/audit.js) so field operators can run `fieldseal-verify case verify <case.zip>` on a
 * machine with no Node install. All original cli arguments are preserved (nexe passes through argv).
 */
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const CLI_ENTRY = resolve(ROOT, 'cli', 'bin', 'audit.js');
const OUT = resolve(ROOT, 'tools', 'pkg', 'dist', 'fieldseal-verify.exe');
const TARGET_NODE = '20.0.0'; // LTS-ish; adjust to your deployment baseline

console.log('nexe build helper — external dev tool only (not a repo dependency).');

// Detect nexe without importing it (keep this file zero-runtime-dependency).
const probe = spawnSync('npx', ['--yes', 'nexe', '--version'], { encoding: 'utf8', timeout: 60000 });
const available = probe.status === 0;

if (!available) {
  console.log('');
  console.log('nexe is NOT installed in this environment — skipping the build.');
  console.log('This is expected: nexe is an OPTIONAL external packager, not part of the product.');
  console.log('To produce the static binary, install nexe once (globally / in an isolated build');
  console.log('workspace — NOT in this repo) and run:');
  console.log('');
  console.log('  npx nexe@latest ' + CLI_ENTRY + ' -o ' + OUT + ' -t ' + TARGET_NODE + ' --build');
  console.log('');
  console.log('The resulting executable embeds Node + the CLI; all `audit.js` arguments pass through.');
  process.exit(0);
}

// If nexe is available, perform the build.
const r = spawnSync('npx', ['--yes', 'nexe', CLI_ENTRY, '-o', OUT, '-t', TARGET_NODE, '--build'],
  { stdio: 'inherit', timeout: 600000 });
process.exit(r.status === null ? 1 : r.status);
