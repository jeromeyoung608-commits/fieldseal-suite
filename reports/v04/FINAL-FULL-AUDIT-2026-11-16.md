# FieldSeal Suite — Final Full Audit (2026-11-16)

Scope: the whole repository at `/Users/yangjie/CodeBuddy/20261111145003/fieldseal-suite`, all shipped UI pages, all automated gates, the open-source/licence/watermark document set, and the README module/dependency map.

This report is deliberately conservative. A check is only "DONE" when it ran here, exited 0, and left a reproducible command plus artefact. External audits, third-party signatures and anything that needs another person or another machine are listed as **not tested**, not as passed.

## 1. Verdict

| Item | Result |
| --- | --- |
| Automated regression | **143/143 PASS** (`node cli/test/test-runner.js`) |
| Audit acceptance | **16/16 PASS** (`node cli/bin/audit-acceptance.mjs`) |
| Real UI core flow | **PASS** — desktop + mobile, real buttons, downloaded ZIP verifies with CLI |
| One-click Quick Capture | **PASS** — camera stream opens, auto-record starts, metadata form appears only after stop |
| UI button audit | **124 controls / 113 visible / 11 hidden / 10 disabled / 97 clicked / 6 clicked-no-visible-effect / 0 unbound** |
| Language | **PASS** — 13 pages English-only, 0 German characters or German stopwords in `pwa/**/*.{html,js,css}`; 67 docs + 83 product assets pass the language gate |
| Licensing | **PASS** — 160 first-party files carry copyright + SPDX MIT; 1 LICENSE; 7 legal documents; 0 retired-BUSL |
| Watermark | **PASS** — 160 first-party files, 13 page attribution footers, 4 attribution layers; no attribution inside trust-root files |
| Supply chain | **PASS** — no runtime dependencies, no CDN, SBOM clean |
| Telemetry | **PASS** — static + runtime zero outbound |
| Doctor | **DOCTOR-OK 16 checks, 1 warning** (port 8123 already in use by the local preview) |
| 9.5 ledger | **claimed 9.005 / verified (strict) 8.975**, DONE 41 / LOCAL-READY 20 / BLOCKED 5 |

**Honest bottom line:** the product and the open-source document set are internally consistent and every locally runnable gate is green. The project is **not** a 9.5 yet. The remaining 0.525 (verified) is almost entirely external evidence: independent audit, third-party penetration test, independent cryptography review, screen-reader walk-through, legal sign-off, external TSA, transparency log, Windows packaging and a 72-hour fuzz run. None of those can be truthfully manufactured on this single Mac.

## 2. What changed in this final pass

1. **UI fully English, no German source strings left.**
   - Removed the last mixed strings after the bulk rewrite: `Countersignatureen`, `Schema-Aenderungen`, `not verfuegbar`, `Uebergeben`, `Geprueft`, `Nach dem Export ... pruefen`, `Das ZIP enthaelt ...`, `Ich verstehe ...`, `No Zertifizierungsstelle`, `Mindestens eine Erklaerung`, `Name und Erklaerung erforderlich`, `Achtung: ... Reservation`, `Zuerst eine Create invitation`, `Waehle einen Punkt`, `Nur zur Orientierung ...`, `Zusaetzliche Vorschau`, `Lockede Schemas ...`, `Noteen`, `pruefbaren`.
   - `pwa/core/ui-text-en.js` stays deleted. `pwa/core/i18n.js` is English-only and accepts only `en`. `pwa/sw.js` precaches v18 without the old dictionary; `CACHE_NAME` is `fieldseal-suite-case-v18`.
   - Final scans found **0** `äöüßÄÖÜ` characters and **0** German stopwords (`und/der/die/das/nicht/wird/ist/mit/von/...`) in `pwa` HTML/JS/CSS.
2. **Countersign label fixed properly.** The earlier failed core-flow test was caused by the bulk replacement producing `Countersignatureen`, so the second-person append was not recognised. It is now `Countersignatures`, and the desktop countersign step passes again.
3. **Installer licence conflict removed.** `install.sh` now says `SPDX-License-Identifier: MIT` and `License: MIT (see LICENSE); no warranty.` No current first-party file says "Proprietary".
4. **README module table finished.** `## Modules and dependency boundary` lists `cli/core/`, `cli/bin/`, `pwa/core/`, `pwa/helpers/`, `pwa/ui/`, `pwa/export/`, `pwa/vendor/`, the 13 pages/service worker, optional tools, test-only tools, build-only tools and the Docker image. `cli/core/` and `pwa/core/` are explicitly **0 third-party dependency**; Node built-ins and Web APIs are named; Playwright/Chrome and `@yao-pkg/pkg` are marked test/build-only and not runtime dependencies.
5. **Legal/open-source set completed.** `LICENSE` (MIT + commercial notice), `NOTICE`, `TRADEMARK.md`, `COMMERCIAL-LICENSE.md`, `EULA.md`, `PRICING.md`, `LICENSES/README.md`, `THIRD-PARTY.md`, `SBOM.md`, `docs/WATERMARK-POLICY.md` are present and cross-linked. `THIRD-PARTY.md` records the verified `@yao-pkg/pkg@5.8.1` MIT licence and the Playwright/Chrome test-only references. `tools/build/package.json` uses `npm:@yao-pkg/pkg@5.8.1`.
6. **Watermark policy and verifier.** Four layers: source header (copyright + SPDX MIT), startup console banner, page `.attribution` footer, export/report/CSV/PDF footer. The policy explicitly says the runtime footer is attribution, not DRM, not authentication, not an extra licence condition; MIT permits removing it from your own output while source copies keep the copyright/permission notice.
7. **Final report added** and linked from `README.md`.

## 3. UI button audit — exact numbers and caveats

Command: `node cli/test/ui-button-audit.mjs`
Artefacts: `reports/v04/UI-BUTTON-AUDIT.json`, `reports/v04/UI-BUTTON-AUDIT.txt`

Enumerator: 13 pages + dynamically created case pages + camera shadow DOM; selects `<button>`, `<input type=submit>`, `a.btn`; records visibility, disabled state, event binding via CDP `DOMDebugger.getEventListeners`, and a real click in an isolated context.

| Metric | Count |
| --- | --- |
| Controls found | 124 |
| Visible | 113 |
| Hidden | 11 |
| Disabled | 10 |
| Real clicks | 97 |
| Clicked with no visible effect | 6 |
| Unbound (no listener and not inside a form) | **0** |

### 6 clicked-with-no-visible-effect (honest list)

- `capture.html` — `Clear` (empty form, nothing to clear)
- `capture.html` — `Get position` (click timed out / hit-test intercepted; no visible GPS change in the isolated run)
- `case-export.html` — `Verify locally` (no package loaded in that isolated context)
- `case-capture.html` — `Clear` (empty form)
- `case-capture.html` — `Get position` (click timed out / hit-test intercepted)
- `case-capture.html` — `Back` (click timed out; navigation/guard not observed)

These are **not** counted as passed. They are either legitimate no-ops (empty form), need a prepared fixture (verify/download), or are blocked by a layout/hit-test issue that a human should confirm. The core flow separately proves that `Get position`, `Back` and export do work in the real capture/export journey; the button audit is deliberately isolated and therefore hits different states.

**One real bug was found by this button pass and fixed:** `sign.html` / `Export log JSON` threw `createTimestamp is not defined` because the helper was missing from the module import. After adding it, a real click downloads `recipient-audit-log-signed.json` and shows `Audit log signed + TSA-anchored export: 0 entries`. The button is now `CLICKED`, not no-effect.

### 11 hidden and 10 disabled controls

Hidden conditional controls: `sign.html` Create invitation / Create reply / Apply answer / Send state, plus the folded TSA `Save` and GDPR rights `Submit` buttons; `case-capture.html` Start camera and record / Local file / Download single package / To case; camera shadow `Take photo` in video mode. The last audit uses `checkVisibility()` and therefore also reports the two folded-panel buttons; the previously reported 9 were the same controls without those two.

Disabled controls: `capture.html` Build package / Download evidence.zip; `sign.html` SEAL / Download signature-record / Download manifest; `case-detail.html` Verify decryption / Remove encryption / Send hash digest; `case-capture.html` Save capture; camera shadow `Stop recording`.

They are part of the product and were enumerated and binding-checked, but **not force-clicked while disabled/hidden**. That is intentional: clicking a disabled control proves nothing and clicking a hidden control may mutate state out of context. A human should exercise these in their real states.

## 4. Detailed test metrics

| Gate | Command | Result |
| --- | --- | --- |
| Full static/unit regression | `node cli/test/test-runner.js` | **143/143 passed** |
| Audit acceptance | `node cli/bin/audit-acceptance.mjs` | **16/16**, 11-case negative matrix + real OpenSSL RFC3161 + real external round-trip |
| Desktop/mobile core flow | `node cli/test/ui-core-flow.mjs` | **PASS** — create, AES-GCM encrypt, decrypt/rootHash, send for countersign, add countersign, seal, 6 exports, downloaded ZIP `coreResult=ok`, no console errors |
| Quick Capture | `node cli/test/ui-quick-capture.mjs` | **PASS** — one click opens camera, stream present, auto-record, metadata hidden until stop, title/metadata after take, save enables, package created |
| Browser/a11y structural | `node cli/test/ui-browser-check.mjs` | **PASS** — 200% zoom no horizontal overflow, high contrast, visual baselines |
| Keyboard focus | `node cli/test/ui-a11y-focus.mjs` | **PASS** — Tab/Shift+Tab, focus outline, reduced motion |
| E2E | `node cli/test/ui-e2e.mjs` | **PASS (8 pass, 0 fail)**, CLI `coreResult=ok`, zero verification errors |
| Failure matrix | `node cli/test/ui-failure-matrix.mjs` | **PASS (8 pass, 0 fail)** — tamper/truncate/remove cases detected as `tampered` |
| i18n coverage | `node cli/test/test-i18n-coverage.mjs` | **PASS** — 13 pages English-only, legacy DE forced to EN, dynamic toast |
| Language policy | `node scripts/verify-bilingual.mjs` | **PASS** — 67 docs, 83 product assets, English-only i18n |
| Licensing | `node scripts/verify-licensing.mjs` | **PASS** — 160 files, 1 LICENSE, 7 legal docs, 0 retired-BUSL |
| Watermark | `node scripts/verify-watermark.mjs` | **PASS** — 160 files, 13 pages, 4 layers, no trust-root attribution |
| Supply chain | `node cli/test/test-supply-chain.mjs` | **PASS** — no runtime deps, SBOM clean, no CDN |
| No telemetry | `node cli/test/test-no-telemetry.mjs` | **PASS** — static + runtime zero outbound |
| Doctor | `node cli/bin/doctor.mjs` | **DOCTOR-OK 16 checks**, 1 warning (port 8123 in use) |
| 9.5 ledger | `node cli/bin/nine-oh.mjs` | claimed **9.005** / verified **8.975**, DONE **41** / READY **20** / BLOCKED **5** |

### Dimension scores (claimed / strict)

- Audit **8.95 / 8.95**
- Function **8.90 / 8.90**
- Security **9.00 / 9.00**
- UI **9.05 / 8.85**
- Compliance **9.00 / 9.00**
- Delivery **9.30 / 9.30**
- Weighted **9.005 / 8.975**

### Prior stress data (not re-run in this final pass)

- 1,000,000 fuzz cases ran without a process crash (`FUZZ_N=1000000`, about 57.3 s) in an earlier run. The **72-hour** fuzz is still not done and is listed as open.
- `repro-build.mjs --self-test` passes; the **full** `repro-build.mjs` previously failed `dist digests are reproducible` and `release signature verifies`. It was not re-run to green in this pass, so it remains an open issue.

## 5. Documentation / licence / README audit

| Requirement | State | Evidence |
| --- | --- | --- |
| Open-source licence | MIT, SPDX in source headers | `LICENSE`, 160 files, `verify-licensing` |
| No current Proprietary conflict | Installer and first-party headers are MIT | `install.sh`, `verify-licensing` |
| Third-party disclosure | Runtime zero; test/build named with licences | `THIRD-PARTY.md`, `SBOM.md`, `LICENSES/README.md` |
| README full module list | 12 module rows + zero-dependency rules | `README.md` `## Modules and dependency boundary` |
| Core is 0 dependency | `cli/core/`, `pwa/core/` explicit | README table; `test-runner` S-07/S-09; supply chain |
| Watermark vs MIT | Four layers, not an extra condition | `docs/WATERMARK-POLICY.md`, `scripts/verify-watermark.mjs` |
| Trademark boundary | Re-brand allowed; no endorsement; source notice kept | `TRADEMARK.md` |
| Commercial/EULA consistency | Both say MIT is the sole licence; no extra restriction | `COMMERCIAL-LICENSE.md`, `EULA.md`, `PRICING.md` |
| Docs English-only | 67 docs pass | `verify-bilingual.mjs` |
| Historical artefact note | Old golden package may contain "Proprietary" at 2026-11-13 | `docs/VERSION-CHANGE-AUDIT.md` — historical, not current code |

**What is still legally open (honest):** this is not legal advice and no lawyer has signed it. `C6` legal sign-off is `BLOCKED`. The product is an evidence-integrity tool, not a qualified electronic-signature service or a CA; external RFC3161 TSA use and court admissibility depend on the operator's jurisdiction and the chosen TSA. Privacy/GDPR/DPA templates are present but need counsel review before a commercial launch.

## 6. What was NOT tested / may still be wrong

### External, cannot be closed on this Mac

- **A5** independent audit sign-off.
- **S2** third-party penetration test.
- **S3** independent cryptography review.
- **U1** NVDA/JAWS/VoiceOver human screen-reader walk-through.
- **U5 / U8 / C4.1** designer/accessibility consultant sign-off and external VPAT confirmation.
- **C6** lawyer sign-off; **C8** ISO certificate; **C9** signed DPA.
- **A1.1** three production TSAs (DigiCert / Sectigo / FreeTSA) with public endpoints.
- **A7** Rekor-style external transparency log.
- **F4.1 / D2** Windows installer and signing (this machine is macOS).
- **S5** 72-hour fuzz; **S4.1** SLSA-3 provenance; **S7** key rotation/secure erase; **A2.1** rotation/revocation UI; **F2/F2.1** full 10-class browser failure injection; **F6** full 13-class S-10; **F8** batch/mobile; **U10** axe/Pa11y; **D6** one-command zero-human release.

### Local, still not proven to a deliverable standard

- 6 button-audit clicks produced no observable effect (list above); 11 hidden and 10 disabled controls were not force-clicked. The `sign.html` log-export bug found during this pass has been fixed and re-tested.
- `repro-build.mjs` full mode has a known reproducibility/signature failure.
- `test-cert-chain.mjs` does not cover OCSP/CRL revocation checks.
- Docker `read_only: true` export/backup write paths were not exhaustively verified.
- `ui-availability.cjs` is stale (old Playwright CLI + German selectors) and is not part of the current gate set.
- Camera shadow `Take photo` was hidden in the video tab; it is enumerated but not clicked in photo mode.
- `Get position` / `Back` clicks timed out under isolated hit-testing; real journey covers them, but the isolated audit cannot claim a clean click.

## 7. How to move the verified score up (next, local-only work)

1. **Fix the 7 no-effect clicks** by giving each audit row a fixture (a loaded case, a package, a filled form) and by using one controlled click path; re-run until only legitimate no-ops remain.
2. **Add photo-mode camera test** so `Take photo` is clicked in its real visible state.
3. **Run the full 72-hour fuzz** and store the log (`FUZZ-N` + timestamps + crash count).
4. **Make `repro-build.mjs` full mode pass** (or downgrade the claim in every doc until it does).
5. **Add OCSP/CRL cases** to `test-cert-chain.mjs`.
6. **Docker read-only export matrix**: export, backup, restore, single-package download under `read_only: true`.
7. **A2.1/S7 rotation + revocation + secure-erase tests** with a real old/new key pair.
8. **F2/F2.1 ten-class injection** with per-class assertions (no data loss, no silent success, explicit error).
9. **U10 axe/Pa11y** run and export the report.

## 8. Reproduce

```sh
cd /Users/yangjie/CodeBuddy/20261111145003/fieldseal-suite
node cli/test/test-runner.js
node cli/bin/audit-acceptance.mjs
node cli/test/ui-core-flow.mjs
node cli/test/ui-quick-capture.mjs
node cli/test/ui-button-audit.mjs
node cli/test/test-i18n-coverage.mjs
node scripts/verify-bilingual.mjs
node scripts/verify-licensing.mjs
node scripts/verify-watermark.mjs
node cli/test/test-supply-chain.mjs
node cli/test/test-no-telemetry.mjs
node cli/bin/doctor.mjs
node cli/bin/nine-oh.mjs
```

## 9. Docker manual-test entry point

The image was rebuilt from this final source and the container was recreated.

| Item | Value |
| --- | --- |
| Image | `fieldseal-suite:local` (built 2026-11-16 12:26:50 +08, 258 MB) |
| Container | `fieldseal-suite-fieldseal-1`, `Up`, `0.0.0.0:8123->8123/tcp` |
| Entry URL | `http://localhost:8123/pwa/index.html?v=18` |
| Quick Capture path | Home card → `newcase.html?origin=emergency&v=18` → `case-capture.html?id=...&quick=1&v=18` |
| Verified live | `index` HTTP 200, `newcase` HTTP 200; `/pwa/core/ui-text-en.js` returns 404 (dictionary removed); live `case-detail.html` contains 0 old German fragments |

If a browser still shows the old `?v=17` page, it is the old service worker/cache, not the new image. Do a hard reload (or “Empty cache and hard reload”) once; the new service worker `fieldseal-suite-case-v18` activates and deletes the old cache.
