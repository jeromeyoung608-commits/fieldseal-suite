#!/usr/bin/env node
/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// U2 + U9: real keyboard walk and reduced-motion behaviour in Chromium.
// Presses Tab repeatedly on index.html, asserts the skip link is first, every stop is a
// visible focusable element, focus stays inside the page (no trap), Shift+Tab reverses,
// and :focus-visible actually paints an outline. With reducedMotion=reduce, transitions
// must collapse to ~0ms.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const PORT = Number(process.env.UI_A11Y_PORT || 8157);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME_BIN || '/Users/yangjie/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/yangjie/.npm-global/lib/node_modules/@playwright/cli/node_modules/playwright-core');
let fail = 0;
const ok = (n) => console.log('  ok  - ' + n);
const bad = (n, d) => { console.log('  FAIL - ' + n + (d ? ' :: ' + d : '')); fail++; };

const server = spawn(process.execPath, [join(ROOT, 'cli/bin/serve.mjs'), '--host', '127.0.0.1', '--port', String(PORT)], { stdio: 'ignore' });
(async () => {
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.goto(BASE + '/pwa/index.html', { waitUntil: 'load' });

  const focusableCount = await page.evaluate(() => [...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter((e) => { const r=e.getBoundingClientRect(); return r.width>0 && r.height>0 && !e.disabled; }).length);
  const N = Math.min(18, focusableCount);
  const walk = [];
  for (let i = 0; i < N; i++) {
    await page.keyboard.press('Tab');
    walk.push(await page.evaluate(() => {
      const a = document.activeElement;
      if (!a) return null;
      const cs = getComputedStyle(a);
      const r = a.getBoundingClientRect();
      return {
        tag: a.tagName,
        text: (a.innerText || a.getAttribute('aria-label') || a.id || '').trim().slice(0, 30),
        outline: cs.outlineStyle + ' ' + cs.outlineWidth,
        visible: r.width > 0 && r.height > 0,
        inPage: a !== document.body && a !== document.documentElement
      };
    }));
  }
  const clean = walk.filter(Boolean);
  const first = clean[0];
  first && /skip/i.test(first.text) ? ok('first Tab lands on skip link') : bad('first Tab is not skip link', JSON.stringify(first));
  clean.length === N && clean.every((x) => x.inPage && x.visible) ? ok('Tab stops stay in page and visible') : bad('Tab stop missing/escaped', JSON.stringify(clean.filter((x) => !x.inPage || !x.visible)));
  clean.some((x) => /solid|dashed|double/.test(x.outline) && !/0px/.test(x.outline)) ? ok('keyboard focus paints a visible outline') : bad('no visible focus outline', JSON.stringify(clean.slice(0, 3)));
  await page.keyboard.press('Shift+Tab');
  const back = await page.evaluate(() => (document.activeElement?.innerText || document.activeElement?.id || '').trim().slice(0, 30));
  back !== (clean[clean.length - 1] || {}).text ? ok('Shift+Tab reverses focus order') : bad('Shift+Tab did not reverse');

  const motion = await page.evaluate(() => {
    const el = document.querySelector('.btn') || document.querySelector('a');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { duration: cs.transitionDuration, scroll: getComputedStyle(document.documentElement).scrollBehavior };
  });
  motion && (/^(?:0s|0\.00?1s|1e-0?6s)$/.test(motion.duration)) ? ok('prefers-reduced-motion collapses transitions') : bad('reduced-motion not applied', JSON.stringify(motion));

  await browser.close();
  server.kill();
  console.log(fail ? 'UI-A11Y-FOCUS: FAIL (' + fail + ')' : 'UI-A11Y-FOCUS: PASS — Tab walk + focus outline + reduced motion');
  process.exit(fail ? 1 : 0);
})().catch((e) => { server.kill(); console.error('UI-A11Y-FOCUS: ERROR', e && e.stack || e); process.exit(1); });
