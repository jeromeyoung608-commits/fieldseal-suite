#!/usr/bin/env node
/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// F1/F1.1 + U7: real browser buttons, not kernel-only. Creates a case, seals it through
// the irreversible confirm dialog, then clicks the export-panel buttons (verify, report,
// CSV, extended CSV, VERIFY.txt, checksums, case ZIP) and verifies the downloaded ZIP with
// the shipped CLI. Runs on desktop 1280×900 and mobile 390×844.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const ROOT = resolve(import.meta.dirname, '..', '..');
const PORT = Number(process.env.UI_CORE_PORT || 8156);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME_BIN || '/Users/yangjie/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const PW = process.env.PLAYWRIGHT_CORE || '/Users/yangjie/.npm-global/lib/node_modules/@playwright/cli/node_modules/playwright-core';
const require = createRequire(import.meta.url);
const { chromium } = require(PW);
let fail = 0;
const ok = (name) => console.log('  ok  - ' + name);
const bad = (name, detail) => { console.log('  FAIL - ' + name + (detail ? ' :: ' + detail : '')); fail++; };

const server = spawn(process.execPath, [join(ROOT, 'cli/bin/serve.mjs'), '--host', '127.0.0.1', '--port', String(PORT)], { stdio: 'ignore' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function downloadFrom(page, buttonText, dir) {
  const p = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
  const btn = page.locator(`button:has-text("${buttonText}")`).first();
  await btn.click();
  const d = await p;
  if (!d) throw new Error('no download for ' + buttonText);
  const file = join(dir, d.suggestedFilename());
  await d.saveAs(file);
  return file;
}

async function runFlow(label, viewport, mobile) {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block', acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const dir = mkdtempSync(join(tmpdir(), 'fieldseal-flow-'));

  await page.goto(BASE + '/pwa/newcase.html', { waitUntil: 'load' });
  await page.fill('#title', 'UI core flow ' + label);
  await page.click('#create-btn');
  await page.waitForURL(/case-detail\.html/, { timeout: 10000 });
  ok(label + ': created case through UI');

  if (!mobile) {
    // F1.1: real encryption round-trip (AES-GCM + PBKDF2), then a second-person countersign.
    await page.click('button:has-text("Encrypt case")');
    const pw = page.locator('.dialog input[type=password]');
    await pw.nth(0).fill('Test-Pass-2026');
    await pw.nth(1).fill('Test-Pass-2026');
    await page.click('.dialog button:has-text("Encrypt")');
    await page.waitForTimeout(1000);
    (/AES-GCM/.test(await page.locator('body').innerText()))
      ? ok(label + ': encrypted case (AES-GCM) through password dialog')
      : bad(label + ': encryption did not complete');

    await page.click('button:has-text("Verify decryption")');
    await page.locator('.dialog input[type=password]').first().fill('Test-Pass-2026');
    await page.click('.dialog button:has-text("Decrypt")');
    await page.waitForTimeout(1000);
    (/CASE_DECRYPT/.test(await page.locator('body').innerText()))
      ? ok(label + ': decryption verified against rootHash')
      : bad(label + ': decryption verify failed');

    await page.click('button:has-text("Send for countersign")');
    await page.locator('.dialog input[type=checkbox]').check();
    await page.click('.dialog button:has-text("Send")');
    await page.waitForTimeout(900);
    const afterSend = await page.locator('body').innerText();
    /Awaiting countersign|Gegenzeichnung ausstehend/.test(afterSend)
      ? ok(label + ': moved to pending_countersign')
      : bad(label + ': countersign state not reached');

    await page.fill('#cs-name', 'Anna Beispiel');
    await page.fill('#cs-title', 'Counsel');
    await page.fill('#cs-remark', 'Reviewed in UI flow');
    await page.click('button:has-text("Add countersign")');
    await page.waitForTimeout(900);
    const afterCountersign = await page.locator('body').innerText();
    /Countersignatures \(1\)|Gegenzeichnungen \(1\)/.test(afterCountersign)
      ? ok(label + ': second person countersign appended')
      : bad(label + ': countersign not appended');
  }

  await page.click('button:has-text("Seal & finalize"), button:has-text("Seal Final")');
  await page.check('#seal-understand');
  await page.click('button:has-text("Seal irrevocably")');
  await page.waitForTimeout(900);
  const bodyText = await page.locator('body').innerText();
  const sealed = /Versiegelt|Sealed/.test(bodyText);
  sealed ? ok(label + ': sealed through irreversible confirm dialog') : bad(label + ': seal did not complete');

  const id = new URL(page.url()).searchParams.get('id');
  await page.goto(BASE + '/pwa/case-export.html?id=' + encodeURIComponent(id), { waitUntil: 'load' });

  const files = [];
  files.push(await downloadFrom(page, 'HTML report', dir));
  files.push(await downloadFrom(page, 'CSV ledger', dir));
  files.push(await downloadFrom(page, 'CSV extended', dir));
  files.push(await downloadFrom(page, 'VERIFY.txt', dir));
  files.push(await downloadFrom(page, 'case-files.sha256', dir));
  const zip = await downloadFrom(page, 'Export case ZIP', dir);
  ok(label + ': clicked 6 export buttons and received files');

  const verify = spawnSync(process.execPath, [join(ROOT, 'cli/bin/audit.js'), 'case', 'verify', zip, '--json'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  let parsed = null; try { parsed = JSON.parse((verify.stdout || '').slice((verify.stdout || '').indexOf('{'))); } catch { }
  const coreOk = verify.status === 0 && parsed && parsed.coreResult === 'ok' && (!parsed.errors || parsed.errors.length === 0);
  coreOk ? ok(label + ': downloaded case ZIP verifies with CLI (coreResult=ok)') : bad(label + ': CLI verify failed', (verify.stdout || verify.stderr || '').slice(0, 200));

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  if (mobile) overflow ? bad(label + ': horizontal overflow') : ok(label + ': no horizontal overflow at 390×844');
  errors.length ? bad(label + ': console errors', errors.join(' | ').slice(0, 160)) : ok(label + ': zero console errors');

  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}

(async () => {
  await wait(600);
  try {
    await runFlow('desktop', { width: 1280, height: 900 }, false);
    await runFlow('mobile', { width: 390, height: 844 }, true);
  } catch (e) { bad('flow error', e && e.message || String(e)); }
  server.kill();
  console.log(fail ? 'UI-CORE-FLOW: FAIL (' + fail + ')' : 'UI-CORE-FLOW: PASS — desktop + mobile, 9+ real buttons, ZIP verifies');
  process.exit(fail ? 1 : 0);
})();
