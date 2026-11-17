# FieldSeal Suite — Final Full Audit (2026-11-16)

**Repository:** `/Users/yangjie/CodeBuddy/20261111145003/fieldseal-suite`  
**Audit time:** 2026-11-16 08:51 CST  
**Repository state:** no `.git` directory. This audit is against the files present on disk; it cannot use a commit diff.

## 1. Verdict

**Local score: 8.643 claimed / 8.643 verified. 9.5 is not met; 9.0 is not met.**

- DONE **17**
- LOCAL-READY **44**
- BLOCKED **5**
- Local automated failures **0**
- Weighted gap to 9.0: **0.357**
- Weighted gap to 9.5: **0.857**

Dimensions: audit 8.50, function 8.75, security 8.65, UI 8.50, compliance 8.60, delivery 8.85.

The five BLOCKED items are external and cannot be closed on this machine: independent audit (A5), third-party penetration test (S2), screen-reader transcript/sign-off (U1), visual-regression human sign-off (U5), and German/EU legal sign-off (C6).

## 2. Test execution

All commands below were run in this audit; exit codes were 0 unless stated otherwise.

| Gate | Result |
| --- | --- |
| `node cli/test/test-runner.js` | **143/143 passed** |
| `node cli/test/test-runner.js --full` | **144/144 passed** |
| `node cli/test/pwa-tests.mjs` | **28/28 passed** |
| `node cli/bin/audit-acceptance.mjs` | **16/16 passed** (negative matrix + real OpenSSL RFC3161 + external round-trip + real-file doctor) |
| `node cli/bin/doctor.mjs` | **DOCTOR-OK, 16 checks, 1 warning** (port 8123 already in use) |
| `node cli/test/read-only-scanner.cjs all` | **SYNTAX-AND-IMPORTS-OK / ATTRIBUTION-4-LAYERS-OK / AUDIT-OK** (14/14 footers, 73/73 headers) |
| `node scripts/verify-licensing.mjs` | **PASS** — 149 first-party sources, 1 LICENSE, 7 legal docs, 0 retired-BUSL |
| `node scripts/verify-bilingual.mjs` | **LANGUAGE-POLICY-OK** — 60 docs, 83 product assets, i18n de/en (31 keys) |
| `node cli/test/ui-availability.cjs` | **UI-AVAILABILITY-OK, 12/12** (real browser session) |
| `node cli/test/ui-e2e.mjs` | **PASS, 8/8** (browser export → CLI re-verification) |
| `node cli/test/ui-failure-matrix.mjs` | **PASS, 8/8** (tamper / missing / truncation classes) |
| `node cli/test/ui-browser-check.mjs` | **UI-BROWSER: PASS** (keyboard, 200% zoom, high contrast, visual baselines) |
| 13-page browser sweep, 390x844 | **13/13 PASS** — 0 page errors, 0 console errors, 0 horizontal overflow |
| `verify-golden.cjs` | **GOLDEN-OK** (genuine accepted, altered detected) |
| `test-module-imports.mjs` | **OK — 53 modules** |
| 24 `pwa/core/test-*.mjs` + 6 `tools/*/test-*.mjs` + 7 CLI direct tests | **37/37 PASS** |
| fuzz | **50,000 cases, 0 crash** |
| scale | **10k entries + 100MB evidence within budget** |
| i18n / determinism / zip-slip / failure-paths / large-evidence / csv-injection / audit-retention | **all PASS** |

### UI defects fixed in this audit

1. **Missing favicon on `backup.html`, `custody.html`, `privacy.html`** caused a real `/favicon.ico` 404 console error. Added the existing `./assets/icon.svg` link; all 13 pages now load with 0 console errors.
2. The UI session was found closed once during the audit; reopening `playwright-cli -s uicheck` and rerunning produced the final **12/12** result. This was a harness precondition, not a product regression.

### UI language coverage — the largest remaining gap

This audit measured the actual EN/DE switch, not the dictionary size:

- `pwa/core/i18n.js` has **31 keys × 2 languages**, and the i18n unit tests pass.
- But the 13 pages contain only **17 marked `[data-i18n]` / `[data-i18n-ph]` elements** in total.
- Toggling DE → EN changed only **16 of 662 visible text lines**.
- Pages with **0 marked strings**: `backup.html`, `case-custody.html`, `case-detail.html`, `newcase.html`, `privacy.html`.
- Pages with only 1 marked string: `capture.html`, `case-capture.html`, `case-export.html`, `custody.html`, `sign.html`, `templates.html`.
- `index.html` has 9; `cases.html` has 2.

**Consequence:** the product is not yet fully EN/DE. A German-default user sees German static copy; switching to English leaves most of those pages unchanged. This is why U3/U6 remain LOCAL-READY and UI stays at 8.50. The README now states this limitation instead of implying full coverage.

**Exact fix:** for every visible static label, heading, hint, empty state, error and dialog in the 13 pages, add an `en` + `de` key; for JS-generated strings use `t(key, fallback)`. Add a browser assertion that for every page the DE and EN visible text differ in the expected number of nodes and that no German-only string remains in EN mode.

### S-10 self-check status

The audit did not treat “S-10” as one green checkbox. Current evidence:

- Button/control existence: covered for main pages and 9-button path in `ui-availability` / `ui-e2e`.
- Event binding: covered; dead-button CDP check in U-03.
- Loading / error / disabled / retry: partially covered by `ui-failure-matrix` (8 classes); the browser-level 10-class matrix remains incomplete (F2).
- Boundary fallback: partially covered (ZIP slip, tamper, truncation, large evidence).
- Form validation: covered on create/sign/custody paths.
- Component linkage: covered on the main create→capture→seal→export chain.
- Keyboard accessibility: real Tab/skip-link/focus-trap probe in `ui-browser-check`.
- Async catch: unit/negative paths; not every browser async branch.
- Offline consistency: service-worker precache test passes; full offline user journey not replayed.
- Business-chain replay: CLI + browser export/re-verify pass; full 9-button browser replay is still a LOCAL-READY item.

## 3. Delivery-document audit

- **53 customer documents scanned** (root docs, `docs/**/*.md`, `pwa/legal/*.md`); **0 contain CJK characters**.
- **0 broken Markdown links**. The former `reports/v05/UI-CLOSURE.md` references are no longer present in `KNOWN_ISSUES.md` or `VPAT-2.5-EU.md`.
- Counts in README / `Manual-Test-Checklist.md` / `KNOWN_ISSUES.md` / `BLOCKERS.md` / `docs/RELEASE-CHECKLIST-9.5.md` agree with the actual run: 143/143, 144/144, 28/28, 16/16, 12/12, 8/8, 8/8, 149 sources, 7 legal docs, 31 i18n keys.
- `qa-run.json` was stale on dimension values (claimed UI 8.75 / verified 8.55, FUNC claimed 8.80) while `score.json` said 8.50/8.50 and 8.75/8.75. It has been refreshed to the ledger values and the 13-page result.
- `README.md` previously said the product UI is EN/DE without stating the coverage limit. It now says the switch and 31-key dictionary ship in both languages and that full visible-copy coverage is a known gap (U3).
- Golden artefact contains the historical `License: Proprietary, local-only use` text because it was sealed on 2026-11-13; `docs/VERSION-CHANGE-AUDIT.md` explains that this is the state at sealing time and that current behaviour is MIT. This is intentional; the golden anchor must not be rewritten.

## 4. Legal and open-source audit

### MIT and commercial boundary

- `LICENSE` is the standard MIT text with the required copyright + permission notice, plus a clearly labelled **Commercial notice**. The notice states that support/integration/training/assurance are optional and “do not restrict, condition, or delay any right granted by the MIT License”. No seat count, production threshold, paid upgrade or purchase obligation is imposed on the code.
- `EULA.md` is explicitly “not applicable to MIT-licensed code”; it grants no rights beyond MIT and imposes no additional conditions. Service terms are separated.
- `COMMERCIAL-LICENSE.md` and `PRICING.md` sell optional services only and repeat that no commercial licence is required.
- `TRADEMARK.md` and `NOTICE` now name the same trademark owner (`FieldSeal Suite project (Jerome Young / Yang Jie)`). MIT grants no trademark rights; nominative use and re-branding rules are stated.
- `LICENSES/README.md` now distinguishes **runtime** from build-only tooling: zero third-party runtime dependencies; `tools/build/` is not shipped; `pwa/vendor/` contains three first-party adapters, not vendored third-party libraries.
- `tools/build/package.json` now declares `"license": "MIT"` for the build tooling.

### Attribution in generated artefacts

- `pwa/helpers/attribution.js` now produces:
  `FieldSeal Suite v0.5 · Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved. · License: MIT · Ownership: FieldSeal Suite project / FieldSeal Suite`
- The string has real separators and contains `License: MIT`; the earlier glued form (`FieldSeal Suitev0.5…`) is gone.
- `ase-export.js` imports the same `ATTRIBUTION_LINE` instead of a local hard-coded copy.
- CSV metadata and HTML/print report footer both use the shared line; four-layer attribution gate passes.
- Test-only TSA CA/leaf keys remain under `cli/verify/fixtures/`; they are fake, documented as test-only, excluded from release signing, and are not part of the shipped runtime. No release private key was found in the repository.

### Open-source conclusion

The code is genuinely MIT: commercial use, modification, redistribution, sublicensing and resale are permitted; the only MIT obligation is keeping the copyright + permission notice with copies or substantial portions. The commercial notice and footer attribution do not add a condition to code use or to the user’s own output.

**Not claimed:** legal compliance is not “signed off”. C6 remains BLOCKED; the documents are a structural starting point, not legal advice. The in-repo texts are internally consistent, but a German/EU attorney must still review them.

## 5. Engineering cleanliness

Removed after the test run:

- `cli/test/fixtures/.tmp/` — 25 MB of generated test fixtures (recreated by the runner; ignored by `.gitignore`).
- `.playwright-cli/` — 744 KB of browser session logs/snapshots/exported throw-away cases (UI evidence is preserved in `reports/v04/UI-AVAILABILITY.txt`).
- `reports/closing/http-server.txt` — 516 KB local static-server log (not a deliverable, not referenced by docs).

Confirmed absent: `.fieldseal-rights/`, `reports/closing/http-server.pid`, untracked `*.pid` files.

Kept deliberately:

- `tools/build/dist/` — 175 MB signed cross-platform verify binaries, `SHA256SUMS`, `SHA256SUMS.sig`, `RELEASE-PUBLIC-KEY.pem` and `manifest.json`. These are release artefacts, not test junk; they are git-ignored.
- `reports/closing/` historical audit logs/ZIP evidence — retained as delivery history; 644 KB.

`.gitignore` covers `node_modules/`, `*.log`, `*.zip`, `dist/`, `cli/test/fixtures/.tmp/`, `.fieldseal-rights/`, `*.pid`, `.playwright-cli/`. No `.git` repository is present, so ignore rules are advisory only.

## 6. Remaining work to 9.5 (local, then external)

### Local (can be done on this machine)

1. **Full EN/DE coverage (U3/U6)** — key every visible string in the 13 pages; verify DE and EN on every page; add a browser assertion that no German-only node remains in EN mode. This is the largest UI gap.
2. **Browser full chain (F1.1)** — drive all 9 buttons in a real browser: create → capture → custody → countersign → seal → export ZIP → CLI `case verify`, with screenshots and exit codes.
3. **Browser failure matrix (F2.1)** — add the missing 10 classes: cancel, disk full, truncated file, wrong password, offline, refresh mid-flow, quota full, concurrent tab, crash/reload, permission denied. Assert structured error + retry.
4. **A2** — export the audit public key (`.pub`), run `doctor` against that exact key, and show the fingerprint. The ledger no longer claims QR because QR is not implemented.
5. **A1.1/A1.2/A3 + S7–S9 + C4.1/C5/C7–C10 + D2/D6–D12** — follow the per-item acceptance conditions already in `score.json`; do not mark them DONE from file existence.

### External (cannot be closed here)

- **A5** independent audit; **S2** third-party penetration test; **U1** screen-reader transcript/sign-off; **U5** visual human sign-off; **C6** German/EU legal sign-off.

## 7. Bottom line

All local gates are green and the deliverable is clean, but **8.643 is the honest score**. The biggest product gap is not a failing test: it is that the EN/DE switch covers only 17 marked elements across 13 pages while the dictionary has 31 keys. Until every visible string is paired, the UI cannot honestly be called fully bilingual and U3/U6 cannot move to DONE.
