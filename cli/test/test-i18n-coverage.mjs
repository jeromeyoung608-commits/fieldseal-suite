#!/usr/bin/env node
/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 *
 * English-only UI gate: all 13 product pages load in English, with no German leftovers,
 * no language switch, and an English dynamic validation toast even when a legacy
 * `fieldseal-lang=de` preference is present in localStorage.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
const require = createRequire(import.meta.url);

const PAGES = ['backup.html','capture.html','case-capture.html','case-custody.html','case-detail.html','case-export.html','cases.html','custody.html','index.html','newcase.html','privacy.html','sign.html','templates.html'];
const PLAYWRIGHT = '/Users/yangjie/.npm-global/lib/node_modules/@playwright/cli/node_modules/playwright-core';
const CHROME = '/Users/yangjie/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const PORT = 8154;
const BASE = `http://127.0.0.1:${PORT}/pwa/`;
const GERMAN = /(?<![A-Za-z])(?:ä|ö|ü|ß|Deutsch|Sprache|Fallliste|Fall|Fälle|Titel|Erfassung|Erfassungsmodus|Abbrechen|Basisvorlagen|Vorlage|Vorlagen|Paket|Pakete|Aufnahme|Aufnahmen|Medien|Unterschrift|Unterschriften|Siegeln|Entwurf|Prüfen|Schlüssel|Gerät|Lokal|Zeitstempel|Kette|Ereignis|Ereignisse|Vermerk|Verwaltung|Übergabe|Wählen|Öffnen|Schließen|Anzeigen|Herunterladen|Anlegen|angelegt|gespeichert|geloescht|Notiz|Partei|Parteien|Sicherung|Wiederherstellen|Datenschutz|Datenresidenz|Konfiguration|ausstehend|Aktualisieren|Auswählen|Erforderlich|Bitte|Keine|Noch|Wird|Löschen|Sichern|Hinweis|Fehler|Zurück|Weiter|Speichern|Erstellen|Drucken|Teilen|Kopie|Laden|Datei|Dateien|Kamera|Aufnehmen|Stoppen|Schliessen|Offline bereit)(?![A-Za-z])/i;
const ALLOW = /FieldSeal|Copyright|License|SPDX|sha256|IndexedDB|localStorage|NIST|OSAC|CLI|JSON|ZIP|TSA|PWA|GDPR|DPA|SLA|VPAT|WCAG|eIDAS|RFC|UTC|IANA|UTF|API|CSP|CSV|href|http|\.js|\.mjs|\.css|\.html|\.zip|\.json|manifest|Verifikation|Export|optional|Seal/i;

const ROOT = new URL('../../', import.meta.url).pathname;
const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1200));
let browser;
const failures = [];
const ok = (m) => console.log('  ok  - ' + m);
const bad = (m) => { failures.push(m); console.log('  FAIL- ' + m); };

try {
 if (!existsSync(PLAYWRIGHT)) throw new Error('playwright-core missing at ' + PLAYWRIGHT);
 if (!existsSync(CHROME)) throw new Error('Chrome for Testing missing');
 const { chromium } = require(PLAYWRIGHT);
 browser = await chromium.launch({ headless: true, executablePath: CHROME });
 const open = async (file, storedLang = 'en') => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', locale: 'en-US' });
  await ctx.addInitScript((l) => localStorage.setItem('fieldseal-lang', l), storedLang);
  const page = await ctx.newPage();
  await page.goto(BASE + file, { waitUntil: 'commit', timeout: 15000 });
  await page.waitForTimeout(450);
  const snap = await page.evaluate(() => {
   const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
   const controls = [...document.querySelectorAll('button, select, option, label, h1, h2, h3, input, textarea, [role="button"]')]
    .filter(visible).map((el) => ((el.innerText || '') + ' ' + (el.getAttribute('placeholder') || '') + ' ' + (el.getAttribute('title') || '') + ' ' + (el.getAttribute('aria-label') || '')).trim()).filter(Boolean);
   return { lang: document.documentElement.lang, text: document.body.innerText, controls, switchVisible: !!(document.querySelector('select.lang-switch') && visible(document.querySelector('select.lang-switch'))) };
  });
  await ctx.close();
  return snap;
 };

 for (const file of PAGES) {
  const en = await open(file, 'en');
  const legacy = await open(file, 'de');
  if (!en.text.trim()) bad(file + ': blank page');
  if (en.lang !== 'en') bad(file + ': html lang ' + en.lang);
  if (en.switchVisible) bad(file + ': language switch still visible');
  const lines = en.text.split('\n').filter(Boolean);
  const german = lines.filter((l) => GERMAN.test(l) && !ALLOW.test(l));
  if (german.length) bad(file + ': German left in English UI: ' + german.slice(0, 3).join(' | ').slice(0, 220));
  const germanControls = en.controls.filter((l) => GERMAN.test(l) && !ALLOW.test(l));
  if (germanControls.length) bad(file + ': German control in English UI: ' + germanControls.slice(0, 2).join(' | ').slice(0, 180));
  if (legacy.lang !== 'en' || legacy.text !== en.text) bad(file + ': legacy DE preference was not forced to English');
  ok(file + ' — English only, ' + lines.length + ' lines, no German, legacy DE forced to EN');
 }

 // Dynamic validation toast must be English, even with legacy DE stored.
 {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await ctx.addInitScript(() => localStorage.setItem('fieldseal-lang', 'de'));
  const page = await ctx.newPage();
  await page.goto(BASE + 'newcase.html', { waitUntil: 'commit', timeout: 15000 });
  await page.waitForTimeout(450);
  await page.click('#create-btn');
  await page.waitForTimeout(450);
  const toast = (await page.evaluate(() => [...document.querySelectorAll('.toast')].map((n) => n.innerText).join(' | '))).trim();
  if (!/Title required/i.test(toast) || /Titel erforderlich/i.test(toast)) bad('dynamic toast is not English: ' + toast);
  else ok('dynamic toast: ' + toast);
  await ctx.close();
 }
} catch (e) {
 bad('harness: ' + (e && e.message || e));
} finally {
 if (browser) await browser.close();
 srv.kill('SIGTERM');
}
if (failures.length) { console.error('I18N-COVERAGE: FAIL (' + failures.length + ')'); process.exit(1); }
console.log('I18N-COVERAGE: PASS — ' + PAGES.length + ' pages English-only + legacy DE forced to EN + dynamic toast');
