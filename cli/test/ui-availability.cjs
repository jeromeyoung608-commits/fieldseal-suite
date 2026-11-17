/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */

// Pre-preview UI availability self-check. Read-only with respect to the repository; it drives a
// real browser through playwright-cli, creates throw-away UI-CHECK cases in IndexedDB and deletes
// them again. Extension featureFlags stay false. No concurrency / stress testing.
// Usage: node cli/test/ui-availability.cjs   (requires the local static server on :8123)

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const BASE = 'http://127.0.0.1:8123/pwa/';
const SESSION = process.env.UI_SESSION || 'uicheck';
const OUT = path.join(ROOT, 'reports', 'v04', 'UI-AVAILABILITY.txt');

const wrap = (body, ctx) =>
  `async () => { const BASE = ${JSON.stringify(BASE)}; const CTX = ${JSON.stringify(ctx)}; ${body} }`;

function call(args) {
  const r = spawnSync('playwright-cli', ['-s', SESSION, ...args], {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 180000
  });
  return (r.stdout || '') + (r.stderr || '');
}

function parse(out) {
  const m = /### Result\s*\n([\s\S]*?)\n### Ran/.exec(out);
  if (!m) return { ok: false, error: 'missing Result block', tail: out.slice(-400) };
  try { return JSON.parse(m[1].trim()); }
  catch (e) { return { ok: false, error: 'bad Result JSON', raw: m[1].slice(0, 300) }; }
}

// Shared browser-side helper: exact "dead button" detection via CDP event listeners.
const AUDIT_FN = `
  async function auditButtons() {
    const cdp = await page.context().newCDPSession(page);
    const n = await page.evaluate(() => document.querySelectorAll('button.btn, a.btn').length);
    const dead = [], disabled = [], live = [];
    for (let i = 0; i < n; i++) {
      try {
        const { result } = await cdp.send('Runtime.evaluate', {
          expression: 'document.querySelectorAll("button.btn, a.btn")[' + i + ']'
        });
        if (!result.objectId) continue;
        const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
        const { result: meta } = await cdp.send('Runtime.callFunctionOn', {
          objectId: result.objectId,
          functionDeclaration: 'function(){return {tag:this.tagName,text:(this.innerText||"").trim().slice(0,64),disabled:this.disabled===true,aria:this.getAttribute("aria-disabled"),href:this.getAttribute("href"),title:this.getAttribute("title")}}',
          returnByValue: true
        });
        const m = meta.value;
        const hasClick = listeners.some((l) => l.type === 'click');
        const hasHref = !!(m.href && m.href !== '#');
        if (m.disabled || m.aria === 'true') {
          disabled.push(m.text);
          if (m.tag === 'A' && m.aria === 'true' && !hasClick) dead.push(m);
        } else if (m.tag === 'A' ? !hasHref : !hasClick) dead.push(m);
        else live.push(m.text);
      } catch (e) { dead.push({ text: 'CDP probe ' + i, error: String(e.message || e) }); }
    }
    await cdp.detach();
    return { total: n, live: live.length, disabled: disabled.length, dead };
  }
`;

const SNAP_FN = `
  async function snap(url) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.state-banner', { timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(120);
    return await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button.btn'));
      const one = (re) => btns.find((b) => re.test(b.innerText));
      const a = Array.from(document.querySelectorAll('a.btn')).find((x) => /Aufnahme sichern|Save capture/i.test(x.innerText));
      const schema = one(/Schema sperren|Schema entsperren/);
      const seal = one(/Versiegeln|Seal Final|Bereits versiegelt/);
      const names = ['字典新增','批量改字段','保存水印配置','应用可见水印','生成快照','登记快照','追加第三方批注','软删除','保存报告品牌','备份提醒预览','配额检查'];
      // The v0.4 feature panel is labelled in English in the shipped UI
      // (case-detail.html). Match the real labels, keep the Chinese assertion keys.
      const labels = ['Dictionary ADD','Batch field update','Save watermark config','Apply visible watermark','Generate snapshot','Register snapshot metadata','Add third-party note','Soft delete','Save report branding','Backup reminder preview','Quota check'];
      const v04 = {};
      for (let i = 0; i < names.length; i++) {
        const b = btns.find((x) => (x.innerText || '').includes(labels[i]));
        v04[names[i]] = b ? !b.disabled : null;
      }
      return {
        banner: (document.querySelector('.state-banner') || { className: '' }).className,
        schemaEnabled: schema ? !schema.disabled : null,
        schemaTitle: schema ? (schema.title || '') : '',
        captureAria: a ? a.getAttribute('aria-disabled') : null,
        sealDisabled: seal ? seal.disabled : null,
        disabledCount: btns.filter((b) => b.disabled).length,
        disabledMissingTitle: btns.filter((b) => b.disabled && !b.title).map((b) => b.innerText.trim().slice(0, 40)),
        v04
      };
    });
  }
`;

const checks = [
  {
    id: 'U-01', title: '11 个主干页面渲染 + 三态案卷准备 + 无 JS 报错',
    body: `
      await page.goto(BASE + 'cases.html', { waitUntil: 'domcontentloaded' });
      // Always test the CURRENT source, never a stale Service Worker cache.
      await page.evaluate(async () => {
        if (navigator.serviceWorker) {
          for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
        }
        if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
      });
      await page.reload({ waitUntil: 'domcontentloaded' });
      const ids = await page.evaluate(async () => {
        const K = await import('./core/case-manifest.js');
        const S = await import('./helpers/case-store.js');
        for (const c of await S.listCases()) {
          if (String((c.caseMeta || {}).title || '').startsWith('UI-CHECK')) await S.deleteCase(c.packageId);
        }
        const mk = async (label) => K.createCase({ metaTemplate: 'blank', caseMeta: { title: 'UI-CHECK ' + label } });
        const d = await mk('draft'); await S.putCase(d);
        const p = await mk('pending'); await K.sendForCountersign(p, { ianaTz: 'UTC' }); await S.putCase(p);
        const s = await mk('sealed'); await K.sealCase(s, { actorName: 'UI Check' }); await S.putCase(s);
        return { draft: d.packageId, pending: p.packageId, sealed: s.packageId };
      });
      const pages = [
        ['index.html',''], ['cases.html',''], ['newcase.html','?origin=standard'], ['capture.html',''],
        ['sign.html',''], ['custody.html',''], ['templates.html',''],
        ['case-detail.html','?id=' + ids.draft], ['case-capture.html','?id=' + ids.draft],
        ['case-custody.html','?id=' + ids.draft], ['case-export.html','?id=' + ids.draft]
      ];
      const errors = [];
      const onErr = (e) => errors.push(String(e.message || e));
      page.on('pageerror', onErr);
      const bad = [], rows = [];
      for (const [n, q] of pages) {
        await page.goto(BASE + n + q, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(140);
        const s = await page.evaluate(() => ({
          chars: document.body.innerText.length,
          footer: !!document.querySelector('.attribution'),
          buttons: document.querySelectorAll('button.btn, a.btn').length
        }));
        rows.push({ n, ...s });
        if (s.chars < 40) bad.push(n + ': empty body');
        if (!s.footer) bad.push(n + ': attribution missing');
      }
      page.off('pageerror', onErr);
      return { ok: bad.length === 0 && errors.length === 0, pages: pages.length, bad, errors, rows, ids };
    `
  },
  {
    id: 'U-02', title: '新建案卷按钮链路：列表 → 表单 → 创建 → 详情（真实点击）',
    body: `
      await page.goto(BASE + 'cases.html', { waitUntil: 'domcontentloaded' });
      await page.getByRole('link', { name: /Neuer Fall \\(Standard\\)/ }).click();
      await page.waitForURL(/newcase/);
      await page.locator('#title').fill('UI-CHECK newcase button');
      await page.locator('#template').selectOption('builtin:blank');
      const modeOK = await page.locator('#mode').isEnabled();
      await page.getByRole('button', { name: /Fall anlegen/ }).click();
      await page.waitForURL(/case-detail/);
      await page.waitForSelector('.state-banner', { timeout: 6000 });
      const info = await page.evaluate(() => ({
        v04: document.body.innerText.includes('v0.4 / Incremental features'),
        spec: document.body.innerText.includes('fieldseal-case-v0.5'),
        banner: (document.querySelector('.state-banner') || { className: '' }).className,
        buttons: document.querySelectorAll('button.btn').length
      }));
      return { ok: modeOK && info.v04 && info.spec && info.banner.includes('draft') && info.buttons > 10, ...info };
    `
  },
  {
    id: 'U-03', title: 'CDP 死按钮检测：三态详情页 + 导出面板 + 列表页',
    body: AUDIT_FN + `
      const targets = [
        ['draft detail', BASE + 'case-detail.html?id=' + CTX.draft],
        ['pending detail', BASE + 'case-detail.html?id=' + CTX.pending],
        ['sealed detail', BASE + 'case-detail.html?id=' + CTX.sealed],
        ['export panel', BASE + 'case-export.html?id=' + CTX.draft],
        ['case list', BASE + 'cases.html']
      ];
      const rows = [];
      for (const [name, url] of targets) {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        if (name.includes('detail')) await page.waitForSelector('.state-banner', { timeout: 6000 }).catch(() => {});
        await page.waitForTimeout(140);
        rows.push({ name, ...(await auditButtons()) });
      }
      const dead = rows.flatMap((r) => r.dead.map((d) => r.name + ':' + (d.text || JSON.stringify(d))));
      return { ok: dead.length === 0, dead, rows: rows.map((r) => ({ name: r.name, total: r.total, live: r.live, disabled: r.disabled })) };
    `
  },
  {
    id: 'U-04', title: 'draft / pending_countersign / sealed 禁用态逻辑',
    body: SNAP_FN + `
      const d = await snap(BASE + 'case-detail.html?id=' + CTX.draft);
      const p = await snap(BASE + 'case-detail.html?id=' + CTX.pending);
      const s = await snap(BASE + 'case-detail.html?id=' + CTX.sealed);
      const errs = [];
      const expect = (cond, msg) => { if (!cond) errs.push(msg); };
      expect(d.banner.includes('draft') && d.schemaEnabled === true && d.captureAria === null, 'draft: schema/capture must be editable');
      expect(d.sealDisabled === false, 'draft: Seal Final must be enabled');
      expect(Object.values(d.v04).every((v) => v === true), 'draft: every v0.4 entry must be enabled');
      expect(p.schemaEnabled === false && p.captureAria === 'true', 'pending: schema/capture must be greyed out');
      expect(p.v04['字典新增'] === false && p.v04['批量改字段'] === false && p.v04['软删除'] === false && p.v04['保存报告品牌'] === false, 'pending: v0.4 writes must be greyed out');
      expect(p.v04['生成快照'] === true && p.v04['追加第三方批注'] === true, 'pending: read-only snapshot + note must stay enabled');
      expect(p.v04['备份提醒预览'] === true && p.v04['配额检查'] === true, 'pending: dialogs must stay reachable');
      expect(s.schemaEnabled === false && s.captureAria === 'true' && s.sealDisabled === true, 'sealed: all writes greyed out');
      expect(s.v04['生成快照'] === true && s.v04['追加第三方批注'] === false && s.v04['字典新增'] === false, 'sealed: only read-only snapshot stays enabled');
      expect(s.v04['备份提醒预览'] === true && s.v04['配额检查'] === true, 'sealed: dialogs must stay reachable');
      for (const [n, x] of [['draft', d], ['pending', p], ['sealed', s]]) {
        expect(x.disabledMissingTitle.length === 0, n + ': disabled buttons missing tooltip: ' + x.disabledMissingTitle.join('|'));
      }
      return { ok: errs.length === 0, errs, draft: d, pending: p, sealed: s };
    `
  },
  {
    id: 'U-05', title: '下拉字典 / 批量编辑 / 批注 / 会签表单可录入，展开收起正常',
    body: `
      // Dictionary is really rendered as a <select> on the capture page.
      await page.goto(BASE + 'case-detail.html?id=' + CTX.draft, { waitUntil: 'domcontentloaded' });
      await page.evaluate(async (draftId) => {
        const K = await import('./core/case-manifest.js');
        const S = await import('./helpers/case-store.js');
        const c = await S.getCase(draftId);
        if (!c.schemaDictionaries || !c.schemaDictionaries.condition) {
          await K.addSchemaDictionary(c, 'condition', ['sealed', 'damaged'], { ianaTz: 'UTC' });
          await S.putCase(c);
        }
      }, CTX.draft);
      await page.goto(BASE + 'case-capture.html?id=' + CTX.draft, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(200);
      const capture = await page.evaluate(() => {
        const sels = Array.from(document.querySelectorAll('select[data-key]'));
        const hit = sels.find((s) => Array.from(s.options).some((o) => o.value === 'sealed'));
        return { selects: sels.length, dictionaryDropdown: !!hit, options: hit ? Array.from(hit.options).map((o) => o.value) : [] };
      });
      await page.goto(BASE + 'case-detail.html?id=' + CTX.draft, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#v04-dict-id', { timeout: 6000 });
      const fills = {
        '#v04-dict-id': 'condition', '#v04-dict-vals': 'sealed,damaged,intact',
        '#v04-bf-key': 'condition', '#v04-bf-val': 'sealed',
        '#v04-wm-text': 'Confidential', '#v04-note-by': 'Reviewer', '#v04-note-org': 'Lab',
        '#v04-note-text': 'Dissent sample', '#v04-brand-header': 'Acme', '#v04-brand-footer': 'Local'
      };
      const filled = {};
      for (const [sel, val] of Object.entries(fills)) {
        const loc = page.locator(sel);
        await loc.fill(val);
        filled[sel] = await loc.inputValue();
      }
      await page.locator('#v04-wm-on').check();
      await page.locator('#v04-note-decision').selectOption('Dissent');
      const detail = await page.evaluate(() => ({
        wmOn: document.querySelector('#v04-wm-on').checked,
        decision: document.querySelector('#v04-note-decision').value,
        captures: document.querySelectorAll('input[data-capture]').length,
        fileInput: !!document.querySelector('#v04-wm-file')
      }));
      const okFills = Object.entries(fills).every(([k, v]) => filled[k] === v);
      await page.goto(BASE + 'case-detail.html?id=' + CTX.pending, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#cs-name', { timeout: 6000 });
      await page.locator('#cs-name').fill('Alice');
      await page.locator('#cs-title').fill('Custodian');
      await page.locator('#cs-decision').selectOption('Approve');
      await page.locator('#cs-remark').fill('UI check');
      const cs = await page.evaluate(() => ({
        name: document.querySelector('#cs-name').value,
        decision: document.querySelector('#cs-decision').value,
        pad: !!document.querySelector('fieldseal-signature-pad#cs-pad')
      }));
      return { ok: capture.dictionaryDropdown && okFills && detail.wmOn && detail.decision === 'Dissent' && detail.fileInput && cs.name === 'Alice' && cs.pad, capture, detail, cs };
    `
  },
  {
    id: 'U-06', title: 'Canvas 签名画布响应鼠标 / 触屏，清空 / 撤销不卡死',
    body: `
      await page.goto(BASE + 'case-detail.html?id=' + CTX.pending, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('fieldseal-signature-pad#cs-pad', { timeout: 6000 });
      const pad = page.locator('fieldseal-signature-pad#cs-pad');
      const canvas = pad.locator('canvas');
      await canvas.scrollIntoViewIfNeeded();
      const box = await canvas.boundingBox();
      if (!box) return { ok: false, error: 'signature canvas has no bounding box' };
      const x = box.x + box.width * 0.25, y = box.y + box.height * 0.5;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 55, y + 18, { steps: 8 });
      await page.mouse.move(x + 100, y - 12, { steps: 8 });
      await page.mouse.up();
      const afterMouse = await page.evaluate(() => {
        const p = document.querySelector('fieldseal-signature-pad');
        return { empty: p.empty, strokes: p.strokeCount, preview: !!p.shadowRoot.querySelector('img.preview[src]') };
      });
      await pad.locator('button[data-act="undo"]').click();
      const afterUndo = await page.evaluate(() => ({ empty: document.querySelector('fieldseal-signature-pad').empty, strokes: document.querySelector('fieldseal-signature-pad').strokeCount }));
      // Real touch input through CDP -> pointerType=touch Pointer Events, not synthetic DOM events.
      const cdp = await page.context().newCDPSession(page);
      const tx = box.x + box.width * 0.3, ty = box.y + box.height * 0.55;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tx, y: ty }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: tx + 40, y: ty + 10 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
      const afterTouch = await page.evaluate(() => ({ empty: document.querySelector('fieldseal-signature-pad').empty, strokes: document.querySelector('fieldseal-signature-pad').strokeCount }));
      await pad.locator('button[data-act="clear"]').click();
      const afterClear = await page.evaluate(() => ({ empty: document.querySelector('fieldseal-signature-pad').empty, strokes: document.querySelector('fieldseal-signature-pad').strokeCount }));
      const undoBtnDisabled = await pad.locator('button[data-act="undo"]').isDisabled();
      return { ok: afterMouse.strokes >= 1 && afterUndo.strokes < afterMouse.strokes && afterTouch.strokes >= 1 && afterClear.empty === true && undoBtnDisabled,
        afterMouse, afterUndo, afterTouch, afterClear, undoBtnDisabled };
    `
  },
  {
    id: 'U-07', title: '弹窗 / 确认框 / 告警提示可弹出、勾选门控、可关闭',
    body: `
      const fail = [];
      const expect = (c, m) => { if (!c) fail.push(m); };
      const overlay = page.locator('.dialog-overlay');
      // (a) gatedDialog: Schema Lock
      await page.goto(BASE + 'case-detail.html?id=' + CTX.draft, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.state-banner', { timeout: 6000 });
      await page.getByRole('button', { name: /Schema sperren/ }).click();
      expect(await overlay.count() === 1, 'gatedDialog did not open');
      const confirm = overlay.locator('button.btn-primary');
      expect(await confirm.isDisabled(), 'gatedDialog confirm should start disabled');
      await overlay.locator('label.check input[type=checkbox]').check();
      expect(await confirm.isEnabled(), 'gatedDialog confirm should enable after checkbox');
      await overlay.getByRole('button', { name: /Abbrechen|Cancel/ }).click();
      expect(await overlay.count() === 0, 'gatedDialog did not close');
      // (b) passwordDialog: empty / mismatched input shows inline hint
      await page.getByRole('button', { name: /Fall verschluesseln/ }).click();
      expect(await overlay.count() === 1, 'passwordDialog did not open');
      const pw = overlay.locator('input[type=password]').first();
      await pw.fill('abc');
      await overlay.locator('button.btn-primary').click();
      const hint = (await overlay.locator('div.hint').innerText().catch(() => '')) || '';
      expect(hint.length > 0 || await overlay.count() === 0, 'passwordDialog gave no feedback');
      if (await overlay.count()) await overlay.getByRole('button', { name: /Abbrechen|Cancel/ }).click();
      // (c) sealConfirmDialog
      await page.getByRole('button', { name: /Versiegeln & Finalisieren/ }).click();
      expect(await overlay.count() === 1, 'sealConfirmDialog did not open');
      expect(await page.locator('#seal-understand').count() === 1, 'seal checkbox missing');
      await overlay.getByRole('button', { name: /Abbrechen|Cancel/ }).click();
      // (d) backup reminder dialog + toast
      await page.getByRole('button', { name: /Backup reminder preview/ }).click();
      expect(await overlay.count() === 1, 'backup dialog did not open');
      const exportBtn = overlay.getByRole('button', { name: /Jetzt exportieren/ });
      expect(await exportBtn.count() === 1 && await exportBtn.isEnabled(), 'one-click export button missing/dead');
      await overlay.getByRole('button', { name: /Spaeter/ }).click();
      expect(await overlay.count() === 0, 'backup dialog did not close');
      expect(await page.locator('#toast-host .toast').count() >= 1, 'backup dismissal gave no toast');
      // (e) quota dialog + toast (estimateQuota is async, so wait for the overlay)
      await page.getByRole('button', { name: /Quota check/ }).click();
      await overlay.first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      expect(await overlay.count() === 1, 'quota dialog did not open');
      const quotaText = await overlay.innerText();
      expect(quotaText.includes('navigator.storage.estimate()'), 'quota dialog lacks estimate feedback');
      await overlay.getByRole('button', { name: /Schliessen/ }).click();
      expect(await overlay.count() === 0, 'quota dialog did not close');
      expect(await page.locator('#toast-host .toast').count() >= 1, 'quota check gave no toast');
      // (f) confirmDialog on the case list (cancel path, no destructive action)
      await page.goto(BASE + 'cases.html', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(180);
      const del = page.locator('#case-list button', { hasText: /Loeschen/ }).first();
      await del.click();
      expect(await overlay.count() === 1, 'confirmDialog did not open');
      await overlay.getByRole('button', { name: /Abbrechen \\/ Cancel/ }).click();
      expect(await overlay.count() === 0, 'confirmDialog did not close');
      return { ok: fail.length === 0, fail, leftoverDialogs: await overlay.count() };
    `
  },
  {
    id: 'U-08', title: '日志 / 报告预览 / 分页 / 路由切换与刷新后控件状态',
    body: `
      const fail = [];
      const expect = (c, m) => { if (!c) fail.push(m); };
      await page.goto(BASE + 'case-detail.html?id=' + CTX.draft, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.state-banner', { timeout: 6000 });
      const detail = await page.evaluate(() => ({
        cards: document.querySelectorAll('.card').length,
        tables: document.querySelectorAll('table').length,
        v04: document.body.innerText.includes('v0.4 / Incremental features'),
        audit: document.body.innerText.includes('DICTIONARY_ADD') || document.body.innerText.includes('Unified Audit')
      }));
      // The detail page renders custody/audit as definition lists, not <table> elements.
      expect(detail.cards >= 3 && detail.audit && detail.v04, 'detail log/cards missing: ' + JSON.stringify(detail));
      await page.goto(BASE + 'case-export.html?id=' + CTX.draft, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(260);
      const exp = await page.evaluate(() => ({
        report: !!document.querySelector('#print-report .page'),
        h2: document.querySelectorAll('#print-report h2').length,
        panel: !!document.querySelector('#panel'),
        result: (document.querySelector('#verify-result') || {}).innerText || '',
        downloads: Array.from(document.querySelectorAll('button.btn')).filter((b) => /HTML-Bericht|CSV-Ledger|VERIFY.txt|case-files.sha256/.test(b.innerText)).length
      }));
      expect(exp.report && exp.h2 === 16, 'report preview missing or incomplete: ' + JSON.stringify(exp));
      expect(exp.panel && exp.downloads === 4, 'export buttons missing: ' + JSON.stringify(exp));
      expect(exp.result.includes('ok'), 'verification panel did not render ok');
      await page.goto(BASE + 'cases.html', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(180);
      const before = await page.locator('#case-list li').count();
      await page.locator('#show-recycled').check();
      await page.waitForTimeout(140);
      const recycled = await page.locator('#case-list').innerText();
      await page.locator('#show-recycled').uncheck();
      await page.waitForTimeout(140);
      const after = await page.locator('#case-list li').count();
      expect(before >= 3 && after === before && /Recycle bin is empty/.test(recycled), 'recycle bin pagination broken');
      // Route switching + refresh must not scramble the state banner / disabled controls.
      await page.goto(BASE + 'case-detail.html?id=' + CTX.sealed, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.state-banner', { timeout: 6000 });
      const sealed1 = await page.locator('.state-banner').getAttribute('class');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.state-banner', { timeout: 6000 });
      const sealed2 = await page.locator('.state-banner').getAttribute('class');
      await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.goForward({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(160);
      const sealed3 = await page.locator('.state-banner').getAttribute('class').catch(() => null);
      expect(sealed1 === sealed2 && sealed1 === sealed3, 'state banner scrambled after refresh/navigation');
      return { ok: fail.length === 0, fail, detail, exp, listRows: before, banner: sealed1 };
    `
  },
  {
    id: 'U-09', title: '导出按钮一键备份、勾选门控写盘、清理测试数据',
    body: `
      // One-click backup must really produce a download without mutating the case.
      await page.goto(BASE + 'case-detail.html?id=' + CTX.sealed, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.state-banner', { timeout: 6000 });
      const before = await page.evaluate(async (sealedId) => {
        const S = await import('./helpers/case-store.js');
        const c = await S.getCase(sealedId);
        return { rootHash: c.rootHash, specVersion: c.specVersion };
      }, CTX.sealed);
      await page.getByRole('button', { name: /Backup reminder preview/ }).click();
      const [dl] = await Promise.all([
        page.waitForEvent('download', { timeout: 10000 }),
        page.locator('.dialog-overlay').getByRole('button', { name: /Jetzt exportieren/ }).click()
      ]);
      const after = await page.evaluate(async (sealedId) => {
        const S = await import('./helpers/case-store.js');
        const c = await S.getCase(sealedId);
        return { rootHash: c.rootHash, specVersion: c.specVersion };
      }, CTX.sealed);
      // Clean up throw-away cases so the preview opens on a tidy case list.
      const cleaned = await page.evaluate(async () => {
        const S = await import('./helpers/case-store.js');
        const all = await S.listCases();
        let n = 0;
        for (const c of all) if (String((c.caseMeta || {}).title || '').startsWith('UI-CHECK')) { await S.deleteCase(c.packageId); n++; }
        return n;
      });
      return { ok: dl.suggestedFilename().endsWith('.zip') && before.rootHash === after.rootHash && before.specVersion === after.specVersion && cleaned >= 3,
        download: dl.suggestedFilename(), mainUnchanged: before.rootHash === after.rootHash, cleaned };
    `
  },
  {
    id: 'U-11', title: '拍照/录像走设备相机；只有「本地文件」打开文件选择器',
    body: `
      const fail = [];
      const expect = (c, m) => { if (!c) fail.push(m); };
      const cid = await page.evaluate(async () => {
        const K = await import('./core/case-manifest.js');
        const S = await import('./helpers/case-store.js');
        const c = await K.createCase({ metaTemplate: 'blank', caseMeta: { title: 'UI-CHECK camera' } });
        await S.putCase(c);
        return c.packageId;
      });
      const targets = [
        ['capture.html', BASE + 'capture.html', 'Foto aufnehmen', 'Video aufnehmen'],
        ['case-capture.html', BASE + 'case-capture.html?id=' + cid, 'Foto', 'Video']
      ];
      for (const [name, url, photoLabel, videoLabel] of targets) {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(200);
        const reg = await page.evaluate(() => ({
          defined: !!customElements.get('fieldseal-camera-panel'),
          panel: !!document.querySelector('#camera'),
          hasOpen: typeof (document.querySelector('#camera') || {}).open === 'function',
          details: !!document.querySelector('#camera-details')
        }));
        expect(reg.defined && reg.panel && reg.hasOpen && reg.details, name + ': camera panel missing ' + JSON.stringify(reg));
        // Fake a device stream so the UI can run headless. Record which path every button takes:
        // getUserMedia => camera; HTMLInputElement.click => file picker.
        await page.evaluate(() => {
          if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {} });
          const cv = document.createElement('canvas'); cv.width = 320; cv.height = 240;
          cv.getContext('2d').fillRect(0, 0, 320, 240);
          const stream = cv.captureStream(5);
          window.__camCalls = 0; window.__inputClicks = [];
          HTMLInputElement.prototype.click = function () { window.__inputClicks.push(this.id || 'file-input'); };
          Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
            configurable: true, value: async () => { window.__camCalls++; return stream; }
          });
        });
        await page.getByRole('button', { name: photoLabel }).first().click();
        // open() awaits video.play() before revealing the panel: wait on the state, not a timer.
        await page.waitForFunction(() => {
          const c = document.querySelector('#camera');
          return c && c.active && c.shadowRoot && !c.shadowRoot.querySelector('.panel').hidden;
        }, null, { timeout: 6000 }).catch(() => {});
        const photo = await page.evaluate(() => {
          const c = document.querySelector('#camera');
          const r = c.shadowRoot;
          return { calls: window.__camCalls, clicks: window.__inputClicks.slice(), active: c.active, mode: c.mode,
            panelVisible: !r.querySelector('.panel').hidden,
            shutterVisible: !r.querySelector('[data-act="shutter"]').hidden };
        });
        expect(photo.calls >= 1 && photo.clicks.length === 0, name + ': PHOTO opened the file picker instead of the camera ' + JSON.stringify(photo));
        expect(photo.active && photo.mode === 'photo' && photo.panelVisible && photo.shutterVisible, name + ': photo camera controls unusable');
        await page.locator('#camera').locator('[data-act="shutter"]').click();
        await page.waitForFunction(() => /camera-photo-/.test(document.querySelector('#file-list').innerText),
          null, { timeout: 6000 }).catch(() => {});
        const listText = await page.locator('#file-list').innerText();
        expect(/camera-photo-/.test(listText), name + ': shutter produced no photo in the file list: ' + listText.slice(0, 120));
        await page.evaluate(() => { window.__camCalls = 0; window.__inputClicks = []; });
        await page.getByRole('button', { name: videoLabel }).first().click();
        await page.waitForFunction(() => {
          const c = document.querySelector('#camera');
          return c && c.mode === 'video' && c.shadowRoot && !c.shadowRoot.querySelector('[data-act="rec-start"]').hidden;
        }, null, { timeout: 6000 }).catch(() => {});
        const video = await page.evaluate(() => {
          const c = document.querySelector('#camera');
          return { calls: window.__camCalls, clicks: window.__inputClicks.slice(), mode: c.mode,
            recVisible: !c.shadowRoot.querySelector('[data-act="rec-start"]').hidden };
        });
        expect(video.calls >= 1 && video.clicks.length === 0, name + ': VIDEO opened the file picker instead of the camera ' + JSON.stringify(video));
        expect(video.mode === 'video' && video.recVisible, name + ': recording controls unusable');
        await page.evaluate(() => { window.__camCalls = 0; window.__inputClicks = []; });
        await page.getByRole('button', { name: /Lokale Dateien/ }).first().click();
        await page.waitForTimeout(150);
        const local = await page.evaluate(() => ({ calls: window.__camCalls, clicks: window.__inputClicks.slice() }));
        expect(local.calls === 0 && local.clicks.indexOf('local-input') !== -1, name + ': local button did not open the file picker ' + JSON.stringify(local));
        await page.evaluate(() => { const c = document.querySelector('#camera'); if (c && c.close) c.close(); });
      }
      const cleaned = await page.evaluate(async (id) => {
        const S = await import('./helpers/case-store.js');
        await S.deleteCase(id);
        return true;
      }, cid);
      return { ok: fail.length === 0 && cleaned, fail, targets: targets.map((t) => t[0]) };
    `
  },
  {
    id: 'U-12', title: '390×844 手机视口：无横向溢出 / 触控 ≥44px / 16px 输入 / 底部弹窗 / 打印样式不污染主 UI',
    body: `
      const fail = [];
      const expect = (c, m) => { if (!c) fail.push(m); };
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.clearBrowserCache');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(BASE + 'cases.html', { waitUntil: 'domcontentloaded' });
      await page.evaluate(async () => {
        if (navigator.serviceWorker) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
        if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
      });
      await page.reload({ waitUntil: 'domcontentloaded' });
      const cid = await page.evaluate(async () => {
        const K = await import('./core/case-manifest.js');
        const S = await import('./helpers/case-store.js');
        for (const c of await S.listCases()) if (String((c.caseMeta || {}).title || '').startsWith('UI-CHECK mobile')) await S.deleteCase(c.packageId);
        const d = await K.createCase({ metaTemplate: 'blank', caseMeta: { title: 'UI-CHECK mobile' } });
        await S.putCase(d);
        return d.packageId;
      });
      const targets = [
        ['index.html',''], ['cases.html',''], ['newcase.html','?origin=standard'], ['capture.html',''],
        ['sign.html',''], ['custody.html',''], ['templates.html',''],
        ['case-detail.html','?id=' + cid], ['case-capture.html','?id=' + cid],
        ['case-custody.html','?id=' + cid], ['case-export.html','?id=' + cid]
      ];
      const rows = [];
      for (const [n, q] of targets) {
        await page.goto(BASE + n + q, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(180);
        if (n === 'case-detail.html') await page.waitForSelector('.kv', { timeout: 6000 }).catch(() => {});
        if (n === 'case-export.html') await page.waitForSelector('#print-report style', { state: 'attached', timeout: 6000 }).catch(() => {});
        const m = await page.evaluate(() => {
          const de = document.documentElement, vw = de.clientWidth;
          const vis = (el) => {
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };
          const all = Array.from(document.querySelectorAll('body *'));
          let wide = 0, tiny = 0, small = 0;
          const smallNames = [];
          for (const el of all) {
            if (!vis(el)) continue;
            const r = el.getBoundingClientRect();
            if (r.right > vw + 1 || r.left < -1) wide++;
            if (el.children.length || !(el.textContent || '').trim()) continue;
            if (parseFloat(getComputedStyle(el).fontSize) < 12) tiny++;
          }
          const taps = Array.from(document.querySelectorAll('button, a.btn, a.nav-card, input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), select, textarea, summary'));
          for (const el of taps) {
            if (!vis(el)) continue;
            const h = Math.round(el.getBoundingClientRect().height);
            if (h < 44) { small++; smallNames.push(el.tagName.toLowerCase() + '#' + el.id + ':' + h); }
          }
          const skip = ['checkbox','radio','range','color','hidden','submit','button','reset','image'];
          let minInputFont = 99;
          for (const el of Array.from(document.querySelectorAll('input, select, textarea'))) {
            if (!vis(el) || skip.indexOf(el.type) !== -1) continue;
            minInputFont = Math.min(minInputFont, parseFloat(getComputedStyle(el).fontSize));
          }
          const kv = document.querySelector('.kv');
          const printStyle = document.querySelector('#print-report style');
          const h2 = document.querySelector('.card h2');
          const badSel = [];
          if (printStyle && printStyle.sheet) {
            for (const r of printStyle.sheet.cssRules) {
              if (!r.selectorText) continue;
              for (const s of r.selectorText.split(',')) {
                const t = s.trim();
                if (t === 'body' || t === 'html' || t === ':root' || t.indexOf('body ') === 0) badSel.push(t);
              }
            }
          }
          return {
            mq: matchMedia('(max-width: 620px)').matches,
            wrapPad: parseFloat(getComputedStyle(document.querySelector('.wrap')).paddingTop),
            overflow: de.scrollWidth - vw, wide, small, smallNames: smallNames.slice(0, 6), tiny,
            minInputFont: minInputFont === 99 ? null : minInputFont,
            kvCols: kv ? getComputedStyle(kv).gridTemplateColumns.trim().split(' ').filter(Boolean).length : null,
            bodyBg: getComputedStyle(document.body).backgroundColor,
            h2Border: h2 ? getComputedStyle(h2).borderBottomWidth : null,
            badPrintSelectors: badSel
          };
        });
        rows.push({ page: n, ...m });
        expect(m.mq, n + ': mobile media query inactive');
        expect(m.wrapPad <= 16, n + ': mobile spacing inactive (padding ' + m.wrapPad + ')');
        expect(m.overflow === 0 && m.wide === 0, n + ': horizontal overflow ' + m.overflow + '/' + m.wide);
        expect(m.small === 0, n + ': touch targets <44px ' + JSON.stringify(m.smallNames));
        expect(m.tiny === 0, n + ': ' + m.tiny + ' visible texts <12px');
        expect(m.minInputFont === null || m.minInputFont >= 16, n + ': iOS auto-zoom risk (input font ' + m.minInputFont + ')');
        if (n === 'case-detail.html') expect(m.kvCols === 1, 'case-detail: kv not single column');
        if (n === 'case-export.html') {
          expect(m.bodyBg === 'rgb(11, 11, 13)', 'case-export: app theme polluted by print CSS (' + m.bodyBg + ')');
          expect(m.h2Border === '0px', 'case-export: print CSS leaked into h2 (' + m.h2Border + ')');
          expect(m.badPrintSelectors.length === 0, 'case-export: unscoped print CSS ' + JSON.stringify(m.badPrintSelectors));
        }
      }
      // Mobile bottom-sheet dialog: reachable, inside the viewport, tappable, closable.
      await page.goto(BASE + 'case-detail.html?id=' + cid, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.state-banner', { timeout: 6000 });
      await page.getByRole('button', { name: /Backup reminder preview/ }).click();
      const overlay = page.locator('.dialog-overlay');
      await overlay.waitFor({ state: 'visible', timeout: 5000 });
      const dlg = await page.evaluate(() => {
        const d = document.querySelector('.dialog');
        const r = d.getBoundingClientRect();
        const btns = Array.from(d.querySelectorAll('button.btn'));
        return { right: Math.round(r.right), bottom: Math.round(r.bottom), w: Math.round(r.width),
          vw: document.documentElement.clientWidth, vh: window.innerHeight,
          minBtn: Math.min.apply(null, btns.map((b) => Math.round(b.getBoundingClientRect().height))),
          buttons: btns.length, radius: getComputedStyle(d).borderTopLeftRadius };
      });
      expect(dlg.buttons >= 2 && dlg.minBtn >= 44, 'backup dialog: buttons not tappable ' + JSON.stringify(dlg));
      expect(dlg.right <= dlg.vw + 1 && dlg.bottom <= dlg.vh + 1 && dlg.w <= dlg.vw, 'backup dialog: outside mobile viewport ' + JSON.stringify(dlg));
      await overlay.getByRole('button', { name: /Spaeter/ }).click();
      expect(await overlay.count() === 0, 'backup dialog did not close on mobile');
      await page.evaluate(async (id) => {
        const S = await import('./helpers/case-store.js');
        await S.deleteCase(id);
        return true;
      }, cid);
      await page.setViewportSize({ width: 1280, height: 720 });
      await cdp.detach();
      return { ok: fail.length === 0, fail, pages: rows.length,
        rows: rows.map((r) => ({ page: r.page, overflow: r.overflow, small: r.small, tiny: r.tiny, inputFont: r.minInputFont, wrapPad: r.wrapPad })),
        dialog: dlg };
    `
  }
];

const results = [];
let ctx = {};
console.log('FieldSeal Suite - UI availability self-check (session ' + SESSION + ')');
for (const chk of checks) {
  const parsed = parse(call(['run-code', wrap(chk.body, ctx)]));
  const ok = parsed && parsed.ok === true;
  results.push({ id: chk.id, title: chk.title, ok, detail: parsed });
  if (parsed && parsed.ids) ctx = Object.assign({}, ctx, parsed.ids);
  console.log((ok ? 'PASS ' : 'FAIL ') + chk.id + '  ' + chk.title);
  if (!ok) console.log('      ' + JSON.stringify(parsed).slice(0, 600));
}

const consoleOut = call(['console', 'error']);
const consoleClean = /Errors: 0/.test(consoleOut) || /Total messages: 0/.test(consoleOut);
results.push({ id: 'U-10', title: '控制台 0 JS 错误', ok: consoleClean, detail: consoleOut.trim().slice(-500) });
console.log((consoleClean ? 'PASS ' : 'FAIL ') + 'U-10  控制台 0 JS 错误');

const failed = results.filter((r) => !r.ok);
const report = [
  'FieldSeal Suite — UI availability self-check',
  'DATE: ' + new Date().toISOString(),
  'SESSION: ' + SESSION,
  'BASE: ' + BASE,
  'COMMAND: node cli/test/ui-availability.cjs',
  '',
  ...results.map((r) => (r.ok ? 'PASS ' : 'FAIL ') + r.id + '  ' + r.title + '\n      ' + JSON.stringify(r.detail).slice(0, 1600)),
  '',
  failed.length ? 'UI-AVAILABILITY-FAILED (' + failed.length + ')' : 'UI-AVAILABILITY-OK',
  ''
].join('\n');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, report);
console.log('\n' + (failed.length ? 'UI-AVAILABILITY-FAILED' : 'UI-AVAILABILITY-OK'));
console.log('report: ' + OUT);
process.exitCode = failed.length ? 1 : 0;
