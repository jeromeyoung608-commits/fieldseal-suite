# FieldSeal Suite — Full Audit (2026-11-16)

**Scope:** full local test run (including every browser-driven UI gate), delivery-document
audit, engineering-file hygiene, and legal/open-source compliance review.
**Result:** all gates green after five real fixes. Score ledger unchanged at
**8.643 claimed / 8.643 verified**, DONE 17 / LOCAL-READY 44 / BLOCKED 5 — 9.5 is **not**
claimed.

---

## 1. Test results — every entry point, run locally

| Command | Result |
| --- | --- |
| `node cli/test/test-runner.js` | **143/143 passed** |
| `node cli/test/test-runner.js --full` | **144/144 passed** (adds the 66000-entry ZIP64 round trip) |
| `node cli/bin/audit-acceptance.mjs` | **PASS — 16/16** (11-case negative matrix + real openssl RFC3161 + real external round-trip + real-file doctor) |
| `node cli/bin/doctor.mjs` | **DOCTOR-OK** — 16 checks, 0 failed, 1 warning (port) |
| `node cli/test/read-only-scanner.cjs all` | **SYNTAX-AND-IMPORTS-OK / ATTRIBUTION-4-LAYERS-OK / AUDIT-OK** — 73/73 source headers, 14/14 page footers, 4/4 export markers |
| `node scripts/verify-licensing.mjs` | **PASS** — 149 first-party source files carry copyright + `SPDX-License-Identifier: MIT`; 1 LICENSE consistent; 7 legal documents consistent; 0 retired-licence mentions |
| `node cli/test/pwa-tests.mjs` | **28/28 passed — GATE OK** |
| `node cli/test/ui-availability.cjs` | **UI-AVAILABILITY-OK — 12/12** (browser session `uicheck`) |
| `node cli/test/ui-e2e.mjs` | **FIELDSEAL-E2E: PASS (8/8)** |
| `node cli/test/ui-failure-matrix.mjs` | **FIELDSEAL-FAIL-MATRIX: PASS (8/8)** |
| `node cli/test/ui-browser-check.mjs` | **UI-BROWSER: PASS** (8 checks) |
| `node cli/test/fixtures/golden/verify-golden.cjs` | **GOLDEN-OK** (genuine verifies `ok`, altered surfaces `tampered`) |
| `node cli/test/test-module-imports.mjs` | **MODULE-IMPORT-CHECK: OK** — 53 PWA modules |
| `node cli/test/test-determinism.mjs` | PASS |
| `node cli/test/test-i18n.mjs` | PASS |
| `node cli/test/test-zip-slip.mjs` | PASS |
| `node cli/test/test-failure-paths.mjs` | PASS |
| `node cli/test/tsa-test-helpers.mjs` | PASS |
| `node cli/test/test-fuzz-inputs.mjs` | **FUZZ: PASS** — 50 000 cases, 0 crashes, memory Δ < 64 MB |
| `node cli/test/test-scale.mjs` | PASS — 10 000 entries / 100 MB hash / heap budget |
| `node pwa/core/test-large-evidence.mjs` | PASS |
| `node pwa/core/test-csv-injection.mjs` | PASS — 4 modules, 64 checks |
| `node pwa/core/test-audit-retention.mjs` | **RETENTION-AUDIT: PASS** |
| `node tools/build/repro-build.mjs --self-test` | **REPRO-BUILD: PASS** |
| `node cli/bin/rights.mjs` | **RIGHTS: PASS** |
| tools self-tests (aegis-crypto, archive-agent, ntp-agent, exhibit-batch-export, release, receipt-service) | **6/6 PASS** |
| `node scripts/verify-bilingual.mjs` | PASS |
| `node cli/bin/nine-oh.mjs --strict` | Local automated failures **0**; ledger regenerated |

`node --check` over every JS/MJS/CJS in `cli/ pwa/ tools/ scripts/ fixtures/ reports/` → **0 syntax
errors**. IDE lint → **0 diagnostics**.

---

## 2. Findings and fixes (five real defects)

### 2.1 UI availability gate could not pass — 6 of 12 checks were stale, not broken

`cli/test/ui-availability.cjs` asserted **Chinese UI labels** (`字典新增`, `备份提醒预览`,
`配额检查`, `Foto / 拍照`, `Abbrechen / 取消`, `v0.4 增量功能`, `回收站为空`) while the shipped UI
had been localised to German/English (`Dictionary ADD`, `Backup reminder preview`,
`Quota check`, `Foto aufnehmen`, `Abbrechen`, `v0.4 / Incremental features`,
`Recycle bin is empty`). Every one of those selectors matched nothing, so U-02/U-04/U-08/U-09
failed on a healthy UI. The selectors now match the real labels; the Chinese assertion keys are
kept so the expectations stay readable. **U-02, U-04, U-09 went from FAIL to PASS.**

### 2.2 `pwa/vendor` — iOS auto-zoom risk (real UI defect)

`.lang-switch` (the v0.5 language switcher) had `font-size: 12px`. Because `.lang-switch`
(0,1,0) outranks the bare `select` rule (0,0,1), it won over the 16px form-control rule — 13
pages exposed a 12 px `<select>`, and iOS Safari auto-zooms any form control below 16 px, which
breaks the mobile layout. Now 16 px (`pwa/ui/style.css`).

### 2.3 `pwa/sign.html` — 54 px horizontal overflow at 390 px

The data-subject-rights `<select>` carried an inline `min-width:220px`, which pushed it past a
390 px viewport where the `details` box clipped the overflow — the control was unreachable on a
phone. The inline style is replaced by a `.rights-field` class with a narrow-viewport override in
the 620 px breakpoint.

### 2.4 Attribution line lost its separator (real defect, export artefacts)

`pwa/helpers/attribution.js` built `ATTRIBUTION_LINE` with `join('')`, so every **runtime**
attribution string ran together: `FieldSeal Suitev0.5Copyright (c) 2026 … All rights
reserved.License: MITOwnership: …`. This reached the exported HTML report footer and the CSV
metadata line — the two export layers of the four-layer watermark. The separator is restored to
`' · '`, matching the static page footers and the sealed golden artefact.

### 2.5 `pwa/export/ase-export.js` carried its own hard-coded attribution line

That copy held only the copyright line — no version, **no `License: MIT`**, no ownership — so the
CSV and report it produced did not carry the MIT permission notice that MIT requires in copies.
It now imports `ATTRIBUTION_LINE` from `pwa/helpers/attribution.js`, so there is one source of
truth and the MIT line cannot drift again.

### Also fixed

- `tools/receipt-service/test-receipt.mjs` never sent the Bearer token the service requires
  (401) and never asserted the unauthenticated path. Fixed, plus a new 401 assertion.
- `cli/test/ui-availability.cjs` and `tools/receipt-service/test-receipt.mjs` were the only two
  failing entries in the whole suite before these fixes.

---

## 3. Delivery-document audit

- **Internal links**: 3 markdown links checked — all valid.
- **Backticked path references**: 425 references across 51 documents — **3 real broken links** found
  and fixed (below).
- **Counts**: `143/143`, `144/144`, `14/14`, `73/73`, `16/16`, `28/28`, `149 first-party
  sources`, `7 legal documents` — every figure matches a live measurement.
- **Terminology**: 0 retired-licence mentions in any activity file (only the marked historical
  records and the gate script itself, which must name them to detect them).

### Broken links found and fixed

`reports/v05/UI-CLOSURE.md` is referenced by `KNOWN_ISSUES.md` (×2) and
`pwa/legal/VPAT-2.5-EU.md` (×1) as the location of the NVDA/VoiceOver procedure — **the file no
longer exists** (it was removed with the earlier report clean-up). The procedure is now written
out in `KNOWN_ISSUES.md` itself (five numbered steps) and the VPAT points there, with
`reports/v05/closure-case.mjs` (the core-flow script) and `reports/v05/UI-AVAILABILITY-run.txt`
(the per-check UI results) as the surviving evidence. Nothing that was referenced is now missing.

### The golden anchor and its historic licence line

`cli/test/fixtures/golden/fieldseal-golden-v0.5-sealed.zip` was sealed on 2026-11-13, so the
attribution line inside its `case-report.html` and CSV ledgers still reads
`License: Proprietary, local-only use; …`. That is the state **at sealing time** — the project
has since been relicensed to MIT. The golden is deliberately **not** edited: rewriting its bytes
would destroy the anchor it exists to provide, and `verify-golden.cjs` validates the package
against its own manifest rather than against freshly generated output. This is now stated
explicitly in `docs/VERSION-CHANGE-AUDIT.md` so no reader can mistake the historic line for the
current licence.

---

## 4. Engineering-file hygiene

| Item | Action |
| --- | --- |
| `.fieldseal-rights/` (runtime store written by `cli/bin/rights.mjs`) | removed; `.gitignore` now covers it |
| `cli/test/fixtures/.tmp/` (23 MB of test fixtures) | removed — regenerated by the suite |
| `reports/closing/http-server.pid` (stale, empty) | removed; `*.pid` added to `.gitignore` |
| `.playwright-cli/` (browser session artefacts) | files kept — they are historical evidence; now git-ignored so they cannot be committed |
| `tools/build/dist/` (179 MB cross-platform binaries) | kept — build outputs, already git-ignored, and the binaries are not reproducible on this machine |
| `.gitignore` | extended with `.fieldseal-rights/`, `*.pid`, `.playwright-cli/` |

`node --check` over all sources: 0 errors. No duplicate, orphaned or backup files were found.

---

## 5. Legal / open-source compliance

| Check | Result |
| --- | --- |
| MIT text verbatim (13 mandatory clauses) | **Complete** — title, copyright, permission grant, conditions, warranty disclaimer, liability limitation, all present |
| Commercial notice | Present — services are optional and do not restrict, condition or delay any MIT right |
| Root `LICENSE` is the only licence file | Yes — no sub-directory `LICENSE` can contradict it |
| `LICENSES/` | Contains only a README — the project ships **zero** third-party runtime code, so there is no third-party licence text to carry |
| Source headers | **149** first-party files carry `SPDX-License-Identifier: MIT` + the copyright line |
| Export artefacts | Report footer, CSV metadata line, HTML print footer and the sealed golden all carry the attribution; the ASE export now carries `License: MIT` too (was copyright-only) |
| Vendor / third-party rights | **`pwa/vendor` contains 3 first-party adapters; `grep 'Jerome\|Yang Jie'` → 0 hits.** No third-party code carries your copyright header, and none would be allowed to |
| `NOTICE` / `TRADEMARK.md` | Consistent: MIT grants no trademark rights; nominative fair use allowed; re-branding allowed while the attribution is retained. Trademark owner now named identically in both files |
| `EULA.md` | Titled *"not applicable to MIT-licensed code"*; states it must not be read as a restriction |
| `PRICING.md` | Sells optional support/services only; states plainly that the code is free under MIT and that MIT rights in a received copy are irrevocable |
| `COMMERCIAL-LICENSE.md` | Describes services, not a licence; states that buying or not buying never restricts any MIT right |
| `SBOM.md` / `SBOM.cdx.json` | Root component `MIT`; `pwa/vendor` declared as first-party MIT; dev tools marked `excluded`; no third-party runtime component claimed |
| Data-protection documents | `docs/privacy-notice.md`, `gdpr-notes.md`, `ROPA-DPIA.md`, `EXTERNAL-TSA-DISCLOSURE.md`, `pwa/legal/DPA-TEMPLATE.md`, `DATA-RESIDENCY.md` — licence premise removed, data terms untouched, `License: MIT` referenced where the licence is named |
| Trademark vs. copyright holders | Copyright `FieldSeal Suite contributors` (community grant, standard for MIT); trademark `FieldSeal Suite project (Jerome Young / Yang Jie)` (named in both `NOTICE` and `TRADEMARK.md`) |

### Open-source requirement check

The project is **genuinely open source**, not "source-available":

1. MIT permission is unrestricted — use, modify, redistribute, sublicense, sell, including
   commercially.
2. No seat count, no production-use threshold, no licence fee, no paid upgrade for the code.
3. The single condition MIT imposes — keep the copyright and permission notice with copies — is
   implemented in all four watermark layers (source headers, console banner, page footers,
   export artefacts).
4. Nothing in `EULA.md`, `PRICING.md` or `COMMERCIAL-LICENSE.md` can be read as a purchase
   obligation, and the licensing gate enforces that reading.
5. A later release may change the licence, but cannot retroactively revoke rights already
   granted under MIT — stated in `PRICING.md`.

---

## 6. Score — unchanged, honestly reported

`score.json` was regenerated by `node cli/bin/nine-oh.mjs --strict --json` only; it was **not**
edited by hand. `qa-run.json` was updated to the figures measured above (revision 9).

- weighted claimed **8.643** / weighted verified **8.643**
- DONE **17** / LOCAL-READY **44** / BLOCKED **5**
- **9.0 is not met** (gap 0.36) — **9.5 is not met** (gap 0.86)

Note on the ledger: four items whose automatic check did not cover what their name claimed
(A2 `.pub` distribution, F1 browser end-to-end, F2 browser failure matrix and one browser-subset
item) were moved from DONE to LOCAL-READY in the ledger definition. All 16 automated checks still
pass, so this makes the score lower but **more honest**; the earlier 8.693 figure was never a
defect-free one. The fixes in §2 close real gaps but do not by themselves promote those four
items — F1/F2 still need the browser-driven 9-button flow and the 10-class failure matrix, and
A2 still needs "export `.pub` → doctor verifies with that `.pub`".

## 7. Still not done — external only (`BLOCKERS.md`)

Independent third-party audit · third-party penetration test · screen-reader transcript and
accessibility sign-off · visual-regression human sign-off · legal sign-off on the MIT text and
the commercial notice. 40 further items are LOCAL-READY (locally doable, not yet evidenced).

**Legal caveat.** This is a compliance review of the repository as it stands, not legal advice.
MIT plus a commercial notice is a structural starting point; the trademark position and the
wording of the optional-service terms should be confirmed by a qualified German/EU attorney
before commercial publication.
