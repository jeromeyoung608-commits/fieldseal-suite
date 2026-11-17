// cli/test/ui-button-audit.mjs
// FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
// SPDX-License-Identifier: MIT
//
// Exhaustive visible-control audit for the 13 shipped pages, including dynamic case pages
// and the camera-panel shadow DOM. It records presence, visibility, disabled state,
// direct/delegated click binding, and a real click in an isolated context.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || '/Users/yangjie/.npm-global/lib/node_modules/@playwright/cli/node_modules/playwright-core');
const CHROME = process.env.CHROME_BIN || '/Users/yangjie/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const PORT = Number(process.env.UI_BUTTON_PORT || 8175);
const BASE = `http://127.0.0.1:${PORT}/pwa/`;
const OUT = 'reports/v04';
mkdirSync(OUT, { recursive: true });

const STATIC_PAGES = ['index.html','cases.html','newcase.html','capture.html','sign.html','custody.html','templates.html','privacy.html','backup.html'];
const DYNAMIC_PAGES = ['case-detail.html','case-export.html','case-custody.html','case-capture.html'];

const srv = spawn(process.execPath, ['cli/bin/serve.mjs','--host','127.0.0.1','--port',String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 900));

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: ['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required']
});

const rows = [];
const errors = [];
const pageUrl = (name, id) => BASE + name + (id ? '?id=' + encodeURIComponent(id) : '');

async function seedCase(page) {
  return page.evaluate(async () => {
    const K = await import('./core/case-manifest.js');
    const S = await import('./helpers/case-store.js');
    const c = await K.createCase({ metaTemplate: 'blank', caseMeta: { title: 'UI-BUTTON-AUDIT' } });
    await S.putCase(c);
    return c.packageId;
  });
}

async function prepare(page, name) {
  if (!DYNAMIC_PAGES.includes(name)) {
    await page.goto(pageUrl(name), { waitUntil: 'domcontentloaded' });
    if (name === 'newcase.html') await page.locator('#title').fill('UI-BUTTON-AUDIT').catch(() => {});
    await page.waitForTimeout(1000);
    return null;
  }
  await page.goto(pageUrl('newcase.html'), { waitUntil: 'domcontentloaded' });
  const id = await seedCase(page);
  await page.goto(pageUrl(name, id), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  return id;
}

function enumerate() {
  return [...document.querySelectorAll('button, input[type=submit], a.btn')].map((e, i) => ({
    i, tag: e.tagName.toLowerCase(), id: e.id || '',
    text: (e.innerText || e.value || e.getAttribute('aria-label') || '').trim().slice(0, 100),
    disabled: e.disabled === true || e.getAttribute('aria-disabled') === 'true',
    visible: (typeof e.checkVisibility === 'function') ? e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length),
    href: e.getAttribute('href') || ''
  }));
}

async function binding(page, i) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { result } = await cdp.send('Runtime.evaluate', { expression: `document.querySelectorAll('button, input[type=submit], a.btn')[${i}]` });
    let obj = result.objectId;
    for (let d = 0; d < 7 && obj; d++) {
      const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: obj });
      if (listeners.some((l) => l.type === 'click' || l.type === 'submit' || l.type === 'keydown')) return true;
      const { result: parent } = await cdp.send('Runtime.callFunctionOn', { objectId: obj, functionDeclaration: 'function(){return this.parentNode || this.host || null}' });
      obj = parent.objectId;
    }
    return false;
  } catch { return false; } finally { await cdp.detach().catch(() => {}); }
}

async function clickOne(page, ctrl, name) {
  const before = await page.evaluate(() => ({ text: document.body.innerText.slice(0, 1200), html: document.body.innerHTML.length, nav: location.href }));
  let dialog = false, chooser = false, download = false, nav = false;
  const onDialog = async (d) => { dialog = true; await d.dismiss().catch(() => {}); };
  const onChooser = async (fc) => { chooser = true; await fc.setFiles([]).catch(() => {}); };
  const onDownload = async (d) => { download = true; await d.cancel().catch(() => {}); };
  const onNav = () => { nav = true; };
  page.on('dialog', onDialog); page.on('filechooser', onChooser); page.on('download', onDownload); page.on('framenavigated', onNav);
  if (name === 'privacy.html') await page.evaluate(() => { window.__fieldsealPrint = false; window.print = () => { window.__fieldsealPrint = true; }; });
  let clickErr = '';
  let forced = false;
  const idx = await page.evaluate(({ id, text, tag }) => {
    const els = [...document.querySelectorAll('button, input[type=submit], a.btn')];
    if (id) { const byId = els.findIndex((e) => e.id === id); if (byId >= 0) return byId; }
    return els.findIndex((e) => e.tagName.toLowerCase() === tag && ((e.innerText || e.value || '').trim().slice(0, 100) === text));
  }, { id: ctrl.id || '', text: ctrl.text || '', tag: ctrl.tag || 'button' }).catch(() => -1);
  const loc = idx >= 0 ? page.locator('button, input[type=submit], a.btn').nth(idx) : page.locator('button, input[type=submit], a.btn').nth(ctrl.i);
  try { await loc.click({ timeout: 3000 }); await page.waitForTimeout(1500); if (chooser) await page.waitForTimeout(1200); }
  catch (e) { clickErr = String(e.message || e).slice(0, 160); try { await loc.click({ timeout: 3000, force: true }); forced = true; await page.waitForTimeout(1500); if (chooser) await page.waitForTimeout(1200); } catch (e2) { clickErr += ' | ' + String(e2.message || e2).slice(0, 120); } }
  page.off('dialog', onDialog); page.off('filechooser', onChooser); page.off('download', onDownload); page.off('framenavigated', onNav);
  const after = await page.evaluate(() => ({ text: document.body.innerText.slice(0, 1200), html: document.body.innerHTML.length, nav: location.href, overlay: document.querySelectorAll('.dialog-overlay').length, toast: document.querySelectorAll('#toast-host .toast, .toast').length, printed: window.__fieldsealPrint === true })).catch(() => ({ text:'', html:0, nav:'', overlay:0, toast:0, printed:false }));
  const changed = dialog || chooser || download || nav || after.printed || after.overlay > 0 || after.toast > 0 || after.text !== before.text || after.html !== before.html || after.nav !== before.nav;
  return { activated: changed, dialog, chooser, download, nav, print: after.printed, overlay: after.overlay, toast: after.toast, forced, clickErr };
}

for (const name of [...STATIC_PAGES, ...DYNAMIC_PAGES]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', permissions: ['camera','microphone'] });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  await prepare(page, name);
  const controls = await page.evaluate(enumerate);
  for (const ctrl of controls) {
    const bound = await binding(page, ctrl.i);
    let outcome = { activated: false };
    if (!ctrl.disabled && ctrl.visible) { await prepare(page, name); outcome = await clickOne(page, ctrl, name); }
    rows.push({ page: name, ...ctrl, bound: bound || !!ctrl.href || outcome.activated,
      status: ctrl.disabled ? 'DISABLED' : (!ctrl.visible ? 'HIDDEN' : (outcome.activated ? 'CLICKED' : 'CLICKED-NO-VISIBLE-EFFECT')),
      outcome, clickError: outcome.clickErr || '' });
  }
  if (pageErrors.length) errors.push(name + ': ' + pageErrors.join(' | '));
  await ctx.close();
}

// Camera panel shadow DOM: real open, then click each shadow button once.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', permissions: ['camera','microphone'] });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  await page.goto(pageUrl('capture.html'), { waitUntil: 'domcontentloaded' });
  await page.locator('#video-btn').click();
  await page.waitForTimeout(700);
  const shadow = await page.evaluate(() => {
    const host = document.querySelector('fieldseal-camera-panel');
    const root = host && host.shadowRoot;
    return root ? [...root.querySelectorAll('button')].map((b, i) => ({ i, text: b.innerText.trim(), disabled: b.disabled, visible: !!(b.offsetWidth || b.offsetHeight) })) : [];
  });
  for (const b of shadow) {
    let activated = false, clickErr = '';
    const before = await page.evaluate(() => document.querySelector('fieldseal-camera-panel').shadowRoot.innerHTML);
    try {
      await page.locator('fieldseal-camera-panel').locator('button').nth(b.i).click({ timeout: 1200 });
      await page.waitForTimeout(400);
      const after = await page.evaluate(() => document.querySelector('fieldseal-camera-panel').shadowRoot.innerHTML);
      activated = after !== before;
    } catch (e) { clickErr = String(e.message || e).slice(0, 160); }
    rows.push({ page: 'camera-panel (shadow DOM)', i: b.i, tag: 'button', id: '', text: b.text, disabled: b.disabled, visible: b.visible, href: '', bound: true,
      status: b.disabled ? 'DISABLED' : (!b.visible ? 'HIDDEN' : (activated ? 'CLICKED' : 'CLICKED-NO-VISIBLE-EFFECT')),
      outcome: { activated }, clickError: clickErr });
  }
  if (pageErrors.length) errors.push('camera-panel: ' + pageErrors.join(' | '));
  await ctx.close();
}

await browser.close();
srv.kill('SIGTERM');

const summary = {
  generatedAt: new Date().toISOString(), pages: STATIC_PAGES.length + DYNAMIC_PAGES.length, total: rows.length,
  visible: rows.filter((r) => r.visible).length, hidden: rows.filter((r) => !r.visible).length,
  disabled: rows.filter((r) => r.disabled).length, clicked: rows.filter((r) => r.status === 'CLICKED').length,
  clickedNoVisibleEffect: rows.filter((r) => r.status === 'CLICKED-NO-VISIBLE-EFFECT').length,
  unbound: rows.filter((r) => !r.bound).length, errors, rows
};
writeFileSync(join(OUT, 'UI-BUTTON-AUDIT.json'), JSON.stringify(summary, null, 2));
writeFileSync(join(OUT, 'UI-BUTTON-AUDIT.txt'),
  `UI-BUTTON-AUDIT: ${summary.total} controls · ${summary.visible} visible · ${summary.hidden} hidden · ${summary.disabled} disabled · ${summary.clicked} clicked · ${summary.clickedNoVisibleEffect} clicked-no-visible-effect · ${summary.unbound} unbound\n` +
  rows.map((r) => `${r.page}\t${r.tag}#${r.id || '-'}\t${r.text.replace(/\s+/g, ' ')}\t${r.status}\tbound=${r.bound}`).join('\n'));
console.log(`UI-BUTTON-AUDIT: ${summary.total} controls · ${summary.visible} visible · ${summary.hidden} hidden · ${summary.disabled} disabled · ${summary.clicked} clicked · ${summary.clickedNoVisibleEffect} clicked-no-visible-effect · ${summary.unbound} unbound`);
console.log('rows: reports/v04/UI-BUTTON-AUDIT.{json,txt}');
if (summary.unbound) { console.log('UNBOUND: ' + rows.filter((r) => !r.bound).map((r) => r.page + ':' + r.text).join(' | ')); process.exit(1); }
if (errors.length) { console.log('PAGE ERRORS: ' + errors.join(' | ')); process.exit(1); }
