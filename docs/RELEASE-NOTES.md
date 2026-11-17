# FieldSeal Suite — Release Notes

All figures in this file come from recorded real runs. See `reports/closing/` for the raw logs.

> **Current gate status (2026-11-15, v0.5 close-out): default `143/143`, `--full` `144/144`.**
> Additional verified: read-only scanner three checks OK, licensing gate PASS (all first-party
> sources incl. `pwa/vendor`), Ed25519 release signature OK, four-platform binary digests OK,
> real byte-level rollback rehearsal OK, `doctor.mjs` all checks green, and `143/143` on a
> simulated runtime without WebCrypto SHA3-256.
> Every numbered figure in the dated sections below is a **historical snapshot** of that release
> (v0.3 closing `120/120` / `121/121`, v0.4 `131/131` / `132/132`) and is deliberately preserved
> as evidence — it is not the current count. See `docs/CHANGELOG-v0.5.md` for the chronological
> record and `docs/RELEASE-ROLLBACK.md` for the signed-manifest + rollback runbook.

## 2026-11-16

- **Product UI is English-only.** German UI strings, German legal paragraphs and the DE/EN switch were removed; a legacy `fieldseal-lang=de` preference is forced to English at boot.

## v0.5 — 2026-11-15
- **Emergency Quick Capture fixed (2026-11-16):** `newcase.html?origin=emergency` now creates a
  `pending-configuration` case immediately, redirects to `case-capture.html?quick=1`, opens the
  real `getUserMedia` video stream, and starts recording. The title/metadata form appears only
  after the take. Regression: `cli/test/ui-quick-capture.mjs` → `UI-QUICK-CAPTURE: PASS`.

- Controlled extension: operator identity, forensic notes, witness statements, retention hold,
  Bates numbering, media redaction, k-of-n approvals, geo attestation, BagIt OAIS export.
  All additive; v0.2–v0.4 `sealHash` remains byte-identical (golden fixtures).
- **Open-source relicense (current):** the project is MIT-licensed. `LICENSE` carries the MIT
  text plus a commercial notice; the code may be used, modified, deployed, redistributed and
  sold without purchasing anything. `COMMERCIAL-LICENSE.md`, `PRICING.md` and `EULA.md` were
  rewritten as **optional services / not applicable to MIT code** — they grant no licence and
  restrict no MIT right. `LICENSES/` now holds only a README (no third-party license texts).
  `scripts/verify-licensing.mjs` enforces four layers: MIT SPDX on every first-party source
  (including the self-written `pwa/vendor/` adapters), a MIT root `LICENSE`, a consistent
  seven-document legal set, and zero surviving references to the retired licence terms.
- Watermark unified at `FieldSeal Suite v0.5` across PWA pages, report template, legal docs and
  SBOM; 14/14 footers carry `License: MIT` + Ownership; `read-only-scanner` rejects a missing
  licence or a stale version instead of passing on `class="attribution"` alone.
- Historical (superseded): an earlier draft of this release shipped a restricted-use licence
  with commercial-use conditions, annual terms and liability caps. Those commercial-licence
  terms are **no longer in force**; only the optional-service terms remain.
- External RFC3161 TSA disclosed in `LICENSE`, `NOTICE`, `EULA`, privacy/GDPR notes, DPA,
  ROPA/DPIA and data-residency: only the textual root hash leaves the device, to an
  operator-selected endpoint; the default off mode remains no-network.
- Gate: `test-runner` 143/143, `--full` 144/144, `audit-acceptance` 16/16, `doctor` OK,
  `verify-licensing` PASS, `read-only-scanner` OK, `ui-browser-check` PASS.
- Known gaps: independent audit, third-party penetration test, screen-reader transcript,
  visual regression sign-off and legal signature remain external (`KNOWN_ISSUES.md`).

## v0.4 — second round (2026-11-12)

- Explicit `fieldseal-case-v0.4` dispatch; new `sealInput.v04` aggregate. v0.2 / v0.3 sealHash
  proven byte-identical with two fixed golden fixtures (`C-37`).
- Added: field dictionaries, single-event batch field update, visible watermark with dual digests,
  anti-forward overlay, independent archive-only snapshots, report branding, third-party
  Concur/Dissent notes, soft-delete recycle bin, timed backup reminder, chunked writes + quota
  warning, 10 new audit event types, report blocks 11–14, VERIFY.txt v0.4 section, CSV
  attribution metadata line, `/attachments` checksum contract (`C-38..C-46`, `S-16`).
- Migration is **draft-only**; pending / sealed cases stay read-only at their original version.
  Snapshot generation never mutates the main case. Contract A sealed write lock unchanged.
- Five extension hooks are placeholders only, featureFlag default `false`, symbol-isolated,
  zero third-party code. Four attribution layers added across 52 source files / 12 pages.
- `sw.js` bumped to `fieldseal-suite-case-v9` with the new modules precached.
- Real runs (2026-11-12): `node cli/test/test-runner.js` → `131/131 passed`; `--full` →
  `132/132 passed`; IDE lint → `totalCount: 0`; read-only scanner →
  `SYNTAX-AND-IMPORTS-OK` / `ATTRIBUTION-4-LAYERS-OK` / `AUDIT-OK`; playwright-cli v0.4 smoke
  → export `coreResult: ok` (14 report sections) + archive-only snapshot, 0 console errors.
- Camera buttons fixed after preview feedback: `Foto / Photo` and `Video` on both
  `capture.html` and `case-capture.html` now use the real device camera via the zero-dependency
  `<fieldseal-camera-panel>` (Canvas shutter / MediaRecorder) instead of a hidden file input.
  Only `Lokale Dateien` opens a file picker; missing camera or denied permission degrades with a
  toast. Captured files still go through the frozen `addFiles()` pipeline. Covered by `U-11`.
- Mobile / touch UX fixed after preview feedback: a 390x844 audit of all 11 main pages found
  ~43px buttons, 21px unstyled inputs, 11px text, 150px-fixed `.kv` hash columns and a print
  stylesheet leaking a white `body` / dark unreadable headings into `case-export.html`.
  `pwa/ui/style.css` now has a `<= 620px` block (46px taps, 16px form text without iOS
  auto-zoom, single-column data, wrapped top bar, bottom-sheet dialogs, safe-area padding);
  `pwa/case-export.html` scopes the attestation CSS to `#print-report`. `sw.js` bumped again to
  `fieldseal-suite-case-v9`. Enforced by `U-12` → `UI-AVAILABILITY-OK (12/12)`; mobile export
  smoke keeps `coreResult: ok` on the page and in the CLI, with all 14 report sections intact.
- Real run outputs, environment fingerprint and artefact paths: `reports/v04/`.
- Bug fixed during closing (carried into this release): `doAddCountersign` captured the
  optimistic-concurrency baseline after the in-place mutation, producing `STALE_CASE`.

## v0.3 closing — 2026-11-12

- `pwa/sw.js` bumped to `fieldseal-suite-case-v5`; `README.md`, `cli/test/TEST-CASES.md` and the
  S-15 assertion are synchronised; a full-tree grep finds no previous cache tag.
- Real runs: `node cli/test/test-runner.js` → `120/120 passed`;
  `node cli/test/test-runner.js --full` → `121/121 passed`; IDE lint → `totalCount: 0`;
  read-only page-module scanner → `SYNTAX-AND-IMPORTS-OK`.
- playwright-cli closing smoke (two segments) passed with 0 console errors:
  create → Schema Lock → send for countersign → hand-drawn PNG signature → Seal Final →
  export → CLI `case verify` → `coreResult: ok`; and a separate case with AES-GCM encryption,
  generic wrong-passphrase failure and successful decryption.
- Bug fixed during closing: optimistic-concurrency baseline in
  `pwa/case-detail.html::doAddCountersign` is now captured before the in-place mutation, so
  countersigns no longer fail with `STALE_CASE`.
- Full evidence: `reports/closing/CLOSING-REPORT.md`.
