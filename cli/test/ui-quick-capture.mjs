#!/usr/bin/env node
/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Regression: Notfall-Schnellerfassung must NOT land on a metadata form first.
// One click -> create pending-configuration case -> capture page -> real getUserMedia
// video area -> recording starts -> stop -> metadata form appears -> save -> package verifies.
// Uses Chromium's fake camera so it runs headless and does not touch a real camera.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const ROOT = resolve(import.meta.dirname, '..', '..');
const PORT = Number(process.env.UI_QUICK_PORT || 8161);
const BASE = 'http://127.0.0.1:' + PORT;
const CHROME = process.env.CHROME_BIN || '/Users/yangjie/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const PW = process.env.PLAYWRIGHT_CORE || '/Users/yangjie/.npm-global/lib/node_modules/@playwright/cli/node_modules/playwright-core';
const require = createRequire(import.meta.url);
const { chromium } = require(PW);
let fail = 0;
const ok = (m) => console.log('  ok  - ' + m);
const bad = (m, d) => { console.log('  FAIL- ' + m + (d ? ' :: ' + d : '')); fail++; };
const assert = (c, m, d) => c ? ok(m) : bad(m, d);

const server = spawn(process.execPath, [join(ROOT, 'cli/bin/serve.mjs'), '--host', '127.0.0.1', '--port', String(PORT)], { stdio: 'ignore' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await wait(600);
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required']
  });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    permissions: ['camera', 'microphone'],
    serviceWorkers: 'block',
    acceptDownloads: true
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  try {
    await page.goto(BASE + '/pwa/index.html', { waitUntil: 'load' });
    await page.click('#quick-home-link');
    await page.waitForURL(/case-capture\.html.*quick=1/, { timeout: 12000 });
    ok('homepage Quick Capture click created a case and landed on the camera page');

    const panel = page.locator('fieldseal-camera-panel');
    const video = panel.locator('video');
    await page.waitForTimeout(1600);
    assert(await panel.isVisible(), 'camera panel visible without opening a metadata form');
    assert(await video.isVisible(), 'video area visible');
    assert(await video.evaluate((v) => !!v.srcObject), 'video has a real MediaStream');
    assert(await panel.evaluate((el) => el.recording), 'recording started automatically');
    assert(await page.locator('#meta-card').isHidden(), 'metadata form stays hidden until recording is stopped');

    await panel.locator('[data-act="rec-stop"]').click();
    await page.waitForTimeout(1200);
    assert(await page.locator('#quick-title-card').isVisible(), 'title field appears after the take');
    assert(await page.locator('#meta-card').isVisible(), 'metadata form appears after the take');
    assert(await page.locator('#capture-btn').isEnabled(), 'save button enables after the take');

    await page.fill('#quick-title', 'Quick capture video');
    await page.click('#capture-btn');
    await page.waitForTimeout(1600);
    assert(await page.locator('#result').evaluate((el) => el.classList.contains('visible')), 'package created');
    const pid = (await page.locator('#result-package-id').innerText()).trim();
    assert(/^[0-9a-f-]{36}$/i.test(pid), 'packageId rendered');

    assert(errors.length === 0, 'zero console errors', errors.join(' | ').slice(0, 200));
  } catch (e) {
    bad('quick capture flow threw', e && e.message || String(e));
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(fail ? 'UI-QUICK-CAPTURE: FAIL (' + fail + ')' : 'UI-QUICK-CAPTURE: PASS — one-click camera, video stream, auto-record, post-fill');
  process.exit(fail ? 1 : 0);
})();
