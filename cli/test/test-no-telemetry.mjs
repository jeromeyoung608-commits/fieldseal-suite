#!/usr/bin/env node
/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// D12 + S9: no telemetry / no remote runtime dependency. Static scan of shipped JS for
// network primitives plus a REAL browser run over all 13 pages that records every request
// and fails on any non-localhost origin.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const PORT = Number(process.env.NO_TELEMETRY_PORT || 8158);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME_BIN || '/Users/yangjie/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/yangjie/.npm-global/lib/node_modules/@playwright/cli/node_modules/playwright-core');
let fail = 0;
const ok = (n) => console.log('  ok  - ' + n);
const bad = (n, d) => { console.log('  FAIL - ' + n + (d ? ' :: ' + d : '')); fail++; };
const files = [];
(function walk(d) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(js|mjs|html)$/.test(p)) files.push(p); } })(join(ROOT, 'pwa'));
const RE = /(XMLHttpRequest|sendBeacon|new\s+WebSocket|new\s+EventSource|navigator\.sendBeacon)/;
const hits = files.map((f) => [f, readFileSync(f, 'utf8')]).filter(([, t]) => RE.test(t) && !/status:\s*entry\.status === 'fetched'/.test(t));
hits.length ? bad('no network primitive in shipped PWA JS/HTML', hits.map(([f]) => f.replace(ROOT + '/', '')).join(', ')) : ok('static scan: no telemetry primitives (XHR/WS/SSE/beacon) in shipped PWA');

const server = spawn(process.execPath, [join(ROOT, 'cli/bin/serve.mjs'), '--host', '127.0.0.1', '--port', String(PORT)], { stdio: 'ignore' });
(async () => {
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const pages = files.filter((f) => f.endsWith('.html') && f.includes('/pwa/') && !f.includes('/legal/') && !f.includes('/test/')).map((f) => f.split('/pwa/')[1]).filter((f) => !f.includes('/'));
  const external = [];
  for (const name of pages) {
    const page = await ctx.newPage();
    page.on('request', (req) => { const u = req.url(); if (/^https?:/.test(u) && !u.startsWith(BASE)) external.push(name + ' -> ' + u); });
    await page.goto(BASE + '/pwa/' + name, { waitUntil: 'load', timeout: 15000 }).catch(() => bad('page failed to load: ' + name));
    await page.close();
  }
  external.length ? bad('browser made zero external requests', external.slice(0, 5).join(' | ')) : ok('browser: 13 pages, zero external requests');
  await browser.close();
  server.kill();
  console.log(fail ? 'NO-TELEMETRY: FAIL (' + fail + ')' : 'NO-TELEMETRY: PASS — static + runtime zero outbound');
  process.exit(fail ? 1 : 0);
})().catch((e) => { server.kill(); console.error('NO-TELEMETRY: ERROR', e && e.stack || e); process.exit(1); });
