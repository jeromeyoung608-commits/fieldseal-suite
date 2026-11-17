# Known Issues

Zero-dependency, no-cloud field evidence suite, open source under the MIT License — no
commercial licence purchase is required to use it (see `LICENSE`; optional paid services are
described in `PRICING.md`). Entries below are observed behaviours and environment quirks, not
acceptance blockers. Each entry states the impact and the workaround. Items that genuinely
cannot be closed locally (external audit, penetration test, screen-reader and visual sign-off,
legal sign-off) are tracked in `BLOCKERS.md`.

## Runtime / environment

- **IDE delete guard vs. test fixtures** — the IDE injects `CODEBUDDY_SAFE_DELETE_ENABLED=1`
  through `NODE_OPTIONS`; `test-runner.js` clearing `cli/test/fixtures/.tmp` can hit
  `SAFE_DELETE_BULK_GUARD_ERROR … ETIMEDOUT`. Workaround: prefix the runner with
  `env CODEBUDDY_SAFE_DELETE_ENABLED=0`. No repository code or IDE config is changed.
- **Two runners must not run concurrently** — all cases share `cli/test/fixtures/.tmp`;
  run default and `--full` strictly in sequence.
- **PWA SHA3-256 is capability-gated** — `pwa/core/hash.js::sha3Supported()` performs a real
  `subtle.digest('SHA3-256', …)` probe (cached for the process). Node 26 (this build/test
  environment) exposes it experimentally; Node 18/20 LTS, the v22.23.2 delivery-audit machine,
  and most browsers reject the algorithm name. On those runtimes SHA3-256 is
  dropped from `availableHashAlgorithms()`, creating a new case with `hashAlgorithm: 'sha3-256'`
  fails closed with a clear error, and `C-15` asserts the sha256 fallback instead. Consequence: a
  manifest *created elsewhere* with `sha3-256` cannot be re-hashed by the PWA kernel there —
  verify it with the zero-dependency CLI (`node cli/bin/audit.js case verify`), whose `node:crypto`
  hasher supports sha3-256 on all supported Node versions. No handwritten SHA3 primitive is added
  (S-07 red line). The gate is validated on **both** runtime classes: Node 26 (SHA3 enabled) and
  Node 22.23.2 (SHA3 disabled) each yield `143/143`.
- **`spawnSync` CLI output** — consumers must use `fs.writeSync(1, …)`; buffered stdout can be lost.
- **`case-verify` unzip** — ZIP handles must be closed with `handle.close()` before returning.
- **Service Worker cache** — any change to a precached module requires bumping `CACHE_NAME`
  (`pwa/sw.js`); otherwise offline users keep the stale module.
- **Browser cannot write files silently** — local backup timers can only trigger a
  user-confirmed download; there is no background filesystem write.

## Core / hash semantics

- **`pwa/core` file count** — S-09 asserts exactly 7 JS files in `pwa/core`; new modules must
  live in `pwa/helpers`, `pwa/ui` or `pwa/vendor`.
- **In-place mutation** — `sealCase` / `addCountersign` / `setCaseEncryption` mutate the object
  passed in and rehash it. Tests must use copies; UI optimistic-concurrency baselines
  (`putCaseIfUnchanged`) must be captured **before** calling the mutating function, otherwise
  they compare the new `rootHash` against the stored one and report `STALE_CASE`.
- **`pwa` zip-builder nested writes** — writing raw evidence bytes through nested entries corrupts
  them; use `{ name, blob }` entries. The CLI `zipStream` `sourcePath` path is the reliable one.
- **Canonical JSON** — `undefined` / `NaN` / `Infinity` / function / symbol / bigint are rejected;
  absent fields in v0.3/v0.4 sealHash aggregation use `FIELD_ABSENT`, never `||` / `=== true`.

## v0.3 closing observations

- **Orphan signature attachments** — a rejected/failed countersign writes its PNG to
  `signature-images` before the case record is saved, so an export ZIP may contain PNGs that no
  `countersignList` entry references. The CLI only verifies digests declared in the manifest, so
  this does not affect the trust verdict. Not fixed (would require changing the accepted write
  order); monitored as a cosmetic artefact.
- **Playwright snapshot paths** — `snapshot --filename=x.yaml` writes to the current working
  directory, not to `.playwright-cli/`.
- **Canvas drawing** — the signature canvas must be scrolled into view and its bounding box
  re-read before pointer/mouse events, otherwise strokes land outside the element.
- **Shadow DOM** — `<fieldseal-signature-pad>` keeps its `<canvas>` inside an open shadow root;
  `document.querySelector('canvas')` cannot find it.

## v0.4

- **Shebang vs. copyright header** — `cli/bin/audit.js` and `cli/bin/batch-verify.js` start with
  `#!/usr/bin/env node`; the layer-1 attribution header MUST be placed AFTER the shebang, otherwise
  Node treats line 6 as a syntax error and every CLI-driven regression fails. The other 48 source
  files carry the identical header at the top. This is the only deliberate "header position"
  exception to the "file-by-file consistency" rule.
- **Service Worker tag history** — `reports/closing/CLOSING-REPORT.md` and the v0.3 closing
  section of `docs/RELEASE-NOTES.md` are historical snapshots that record the v5 cache tag. The
  live code is `fieldseal-suite-case-v18` (v0.4 added eight precached modules / camera panel at v8;
  v9 is the mobile/touch + scoped print CSS round). Any precached module change requires another bump.
- **Orphan hook attachments** — if a hook returns data for a case whose export is later cancelled,
  nothing is written to IndexedDB (attachments are built at export time only), so no orphan is
  possible for hooks. Orphan SIGNATURE PNGs from rejected countersigns remain a v0.3 cosmetic
  issue (see above); CLI only verifies digests declared in `countersignList`.
- **Snapshot is not a trust source** — `snapshot-*.zip` is archive-only. Always verify the MAIN
  case export with `node cli/bin/audit.js case verify <main-case.zip> --json`.
- **Browser storage** — `navigator.storage.estimate()` may be unavailable or return `quota = 0`;
  the helper degrades to `{ supported: false, warning: false }` and never blocks a frozen
  evidence package write.
- **Static import scanner false positive** — `extractModuleSpecifiers()` matches any `from '…'`
  text, so a documentation string ending in `from` directly before a quote can be misread as an
  ESM specifier. Keep reporter strings away from that pattern.
- **ESM CLI files vs. the read-only scanner (fixed 2026-11-14)** — `cli/verify/tsa-verify.js` is an
  ESM module with a `.js` extension. `read-only-scanner.cjs` used to probe every `cli/**/*.js` as CJS
  (`syntax-probe.cjs`), which produced a bogus `SYNTAX-AND-IMPORTS-FAILED` / "Failed to load the ES
  module". `checkSyntaxAuto()` now probes CJS then ESM and only reports a real error when neither
  parses. Do not revert to a single CJS probe.
- **`.mjs` self-tests in `pwa/core`** — S-09 counts `.js` modules only, so the `test-*.mjs`
  regression files do not affect that count. Adding a new `.js` module there still requires
  updating S-09.
- **UI availability gate** — `cli/test/ui-availability.cjs` unregisters Service Workers and clears
  Cache Storage before every run; without that step a stale precache silently reintroduces old
  modules and a "disappearing control" looks like a product bug. Any precached module change still
  requires a `CACHE_NAME` bump (currently `fieldseal-suite-case-v18`).
- **`page.evaluate` cannot read Node-side variables** — pass `CTX` values as explicit arguments
  (`page.evaluate(async (id) => {...}, CTX.draft)`). Use CDP `DOMDebugger.getEventListeners` to
  prove a button has a click handler; DOM attributes cannot reveal `addEventListener` bindings.
- **Signature pad API** — the Web Component exposes `empty` / `strokeCount` / `value`, not
  `strokes`; its Undo / Clear buttons live inside an OPEN shadow root (`button[data-act]`).
- **`passwordDialog` has two password inputs** — a Playwright `locator('input[type=password]')`
  is strict-mode ambiguous; use `.first()`. `openQuotaDialog()` awaits
  `navigator.storage.estimate()` before creating the overlay, so UI checks must
  `waitFor({ state: 'visible' })` instead of counting synchronously.
- **Case detail logs use `dl.kv`, not `<table>`** — UI assertions should check the log block text
  and `.card` count rather than requiring table elements.
- **Camera buttons vs. file picker** — `#photo-btn` / `#video-btn` used to only `.click()` a hidden
  `<input type=file capture="environment">`. Desktop browsers ignore the `capture` attribute, so
  both buttons opened a folder dialog. They now go through `<fieldseal-camera-panel>` and
  `getUserMedia` (Canvas shutter for photos, `MediaRecorder` for video). `capture="environment"`
  remains only as a mobile hint on the fallback inputs. Headless / no camera / denied permission
  intentionally degrades to the matching file picker with a toast.
- **Camera self-check timing** — `U-11` fakes a MediaStream with `canvas.captureStream(5)` and
  hooks `HTMLInputElement.prototype.click`, proving the button took the camera path without opening
  a real OS dialog. `FieldsealCameraPanel.open()` awaits `video.play()` before revealing its panel,
  so assertions must `waitForFunction` on panel state rather than a fixed timeout.
- **HTTP cache survives SW cleanup** — unregistering Service Workers and deleting Cache Storage is
  NOT enough: `cache.addAll()` on the next `install` can re-seed the precache from the browser HTTP
  cache, so a changed `pwa/ui/style.css` still renders the old bytes. UI checks must additionally
  `Network.clearBrowserCache` + `Network.setCacheDisabled` via CDP before reloading, and bump
  `CACHE_NAME` for real offline users (camera round v8 → mobile round v9).
- **Attestation CSS is global unless scoped** — `buildCaseReportHtml()` returns a full-document
  `<style>` containing `body`, `h1/h2`, `table`, `footer` and a 10px `.attribution`. Injected
  verbatim into `case-export.html` it repaints the app white and makes headings unreadable.
  `scopeReportCss()` prefixes every selector with `#print-report` (recursing into `@media print`),
  so the screen UI keeps the app stylesheet while print output keeps its own layout.
- **iOS auto-zoom / inline link buttons** — form text below 16px makes Mobile Safari zoom on focus;
  `min-height` does not apply to an inline `<a class="btn">`. The mobile block therefore sets
  16px form text and `display: inline-flex` on buttons. `U-12` asserts both and requires every
  visible tap target to be at least 44px.
- **Two runners share `.tmp`** — `cli/test/test-runner.js` and `cli/test/read-only-scanner.cjs`
  both write temp module files under `cli/test/fixtures/.tmp`; running them in parallel yields
  bogus inline-module syntax errors. Run them serially, and set `CODEBUDDY_SAFE_DELETE_ENABLED=0`
  for `--full` (66000 ZIP64 entries exceed the IDE delete guard's bulk threshold).
- **`<style>` is never "visible"** — `page.waitForSelector('#print-report style')` times out
  because Playwright defaults to `state: 'visible'`. Use `state: 'attached'`, otherwise the print
  CSS scoping assertion becomes a false positive.

## Final delivery (2026-11-14) — remaining, deliberately scoped

Closed in this round: SW precache closure, four unlabelled inputs, `outline:none` focus ring,
low-contrast badge, `aria-live`, skip link, refresh-button feedback, language-switch visibility,
log default/fields/hash-chain/erasure/retention, CSV injection, ZIP-slip, large evidence,
aegis loopback + Bearer, SHA3 capability gate, install/doctor/backup/serve, in-product legal
documents, build pin, release re-signing and a real byte-level rollback rehearsal.

Closed by final-audit rework (2026-11-14): the emergency-notice `span.mono` low-contrast
(`.notice .mono { color: var(--text) }`); focus outline now also on `:focus` so all eight
pages show a visible ring (no `none` on index/custody/templates); per-paragraph `lang` on the
privacy page's EN/DE passages; Node-version wording corrected to "dual runtime, both
143/143" (Node 26 SHA3-enabled + v22.23.2 SHA3-disabled audit machine). Case closure
build→seal→export→CLI-verify is automated in `reports/v05/closure-case.mjs` (`CLOSURE-OK`).

Closed by third-round manual browser run (2026-11-14): **BUG-003 (P0)** — `case-export.html`
imported the removed `createSha256` from `pwa/core/hash.js`, so the export page rendered zero
buttons (`SyntaxError: does not provide an export named 'createSha256'`). Fixed by switching to
the unified `verifyFileHash(bytes, expected)` (prefix-form manifest hashes only) and adding a
PWA-wide import-graph smoke (`cli/test/test-module-imports.mjs`) plus a real `verifyChain()`
run inside `cli/bin/doctor.mjs`. The grep confirmed `case-export.html` was the sole broken
consumer. This P0 can no longer pass silently: `static.imports` fails the health check.

The following are **open but not acceptance blockers**:

- **No manual assistive-technology pass** — the VPAT 2.5 EU self-assessment
  (`pwa/legal/VPAT-2.5-EU.md`) explicitly lists what was NOT verified with NVDA / VoiceOver:
  a full focus-order walkthrough. A 2026-11-14 re-review confirmed the contrast (1.4.3),
  focus-visible (2.4.7) and language-of-parts (3.1.2) findings were scanner / headless
  false positives, not real defects; per-passage `lang` is set on the privacy page.
  The only remaining AT item is the manual NVDA / VoiceOver pass — this is **release
  condition 2**. The procedure is stated in this entry and the core-flow script is
  `reports/v05/closure-case.mjs`:

  1. Serve `pwa/` on localhost and open `index.html`.
  2. NVDA (Windows) and VoiceOver (macOS), one run each, over: open case → seal → export.
  3. Record the spoken read order per step, the announced state changes, and the
     focus order of the sign/export/confirmation controls.
  4. Write the transcript, attach it to this entry, and flip the matching rows in
     `pwa/legal/VPAT-2.5-EU.md` from "not verified" to the evidence that was actually seen.

  Claiming full EN 301 549 conformance without that pass would be inaccurate.
- **No `package-lock.json` in the delivery tree** — by design. Gate `S-06` and the read-only
  scanner reject any lockfile because the shipped product must stay zero-dependency. Build inputs
  are locked by exact version + `dist.integrity` (`tools/build/BUILD-DEPENDENCIES.md`) and
  enforced by `doctor.mjs`. Keep the full lockfile on the build machine only.
- **Server-side features are not applicable** — SSO/OIDC/SCIM/RBAC, SIEM forwarding, SOC 2
  certification and cloud uptime SLAs presuppose a hosted multi-user service. This product is an
  offline, single-device tool with no backend, account or telemetry. Printable/self-service DPA,
  SLA and VPAT documents are provided for procurement files instead.
- **Browser data is not inside `install.sh --prefix`** — cases and the trail live in the browser
  profile. Uninstall removes program files only; export from `pwa/backup.html` first, then clear
  site data and unregister the service worker.
- **Sealed cases are immutable** — GDPR rectification means creating a corrected new case and
  deleting the old one, rather than rewriting an existing evidentiary chain.
- **C-15 is capability-branched** — SHA3-256 is unavailable on runtimes whose WebCrypto rejects
  the algorithm name; those cases must be verified with the Node CLI (`node:crypto`) rather than
  the PWA kernel. See the SHA3 entry under "Runtime / environment".

## Pre-delivery verification conditions (release owner) — narrowed to one

The final-audit re-review's four re-review items: the **trust-model holes are fixed** (private key
no longer ships in the product; anchor moved off same-origin `localStorage`; `doctor` rejects
unsigned files) — see delivery report §11.5. **Audit remains 7.5 / weighted 8.2** (the earlier
8.5 / 8.3 claim was retracted after re-audit found the trust model was not externally anchored).
The device-key binding implemented is device-instance binding, not third-party external anchoring;
court-grade external anchoring needs a TSA (EP-001), not yet available. One 8.5 gap remains —
**compliance** (rights walkthrough / DPA signing / SLA drill / VPAT evidence), at 7.5. Only the
screen-reader pass is a release condition; the compliance gap is a score gap, not a release
blocker. Condition 1 (browser-level closure) was **closed by the four-audit** with a real
click-through replay (evidence in `reports/v05/evidence/browser-closure-fixed.log`).

1. **Browser-level seal→export→CLI re-play — CLOSED by four-audit.** Real browser click-through
   replay passed; evidence `reports/v05/evidence/browser-closure-fixed.log`: sealed `SEALED true`,
   export page shows **9 buttons** (visible/clickable), `case-7c5be71f-sealed.zip` exported,
   `ERRS []`, CLI re-verify `coreResult: ok` / `errors: []`. Module-level
   `reports/v05/closure-case.mjs` (`CLOSURE-OK`) remains as supporting evidence; the
   per-check UI results are in `reports/v05/UI-AVAILABILITY-run.txt`.
2. **NVDA (Windows) + VoiceOver (macOS) pass** — one run each over open-case / seal / export,
   record the read order, and backfill `pwa/legal/VPAT-2.5-EU.md`.

> Hard gate added this round: `cli/test/test-module-imports.mjs` (PWA import-graph smoke,
> wired into `doctor.mjs` as `static.imports`) and a real `verifyChain()` run (`log.chain`).
> Together they make the "export page renders zero buttons" no_go-class impossible to pass
> silently in this build environment. Shared-`pwa/core` API changes must grep all consumers
> AND pass this smoke before any closure.

## Post-delivery (30-day) backlog for the sub-8.5 dimensions

To continue raising EU/US compliance toward 8.5 after first delivery:
- **Log external anchoring — PARTIAL (device-key binding done; TSA external anchoring pending)** —
  The earlier `audit-keypair.js` shipped a private key (forgeryable) and is removed. Now
  `audit-device-key.js` generates a **device-bound non-extractable key**; `commitAnchor()` commits
  the chain head to **IndexedDB (separate from the log's localStorage)** under that key;
  `verifyAnchorStore()` / `checkChainOnBoot()` verify against a **trusted spki** (never the file's
  key). Product export is wired: `sign.html` / `backup.html` call `signedLogExport()` (device key)
  and ship `recipient-audit-log-signed.json` with a "verify" entry; `verifySignedExport()` trusts
  only the trusted spki, so a swapped-key re-sign is rejected. `doctor --audit-log <file>` verifies
  a **real exported file** (entry count + chain state + signature), exit 0/1, and **rejects
  unsigned files** (`signature missing` → fail). This is **device-instance binding**, not
  third-party external anchoring — same-device re-sign still passes; court-grade external anchoring
  requires a **TSA (RFC3161, EP-001)**, not yet available, so the 8.5 external-anchoring item is
  NOT met via device binding alone. Audit stays 7.5 on the verified line.
- **9.5 readiness (this round)** — the 9.5 acceptance ledger (`docs/RELEASE-CHECKLIST-9.5.md`,
  machine version `cli/bin/nine-oh.mjs`) implements every locally-achievable item with **evidence objects**
  (each DONE requires a real automated check to pass AND its artefact's sha256 to still match). **9.5 = six
  dimensions ALL ≥ 9.5 AND weighted ≥ 9.5**, not one dimension hitting 9.5. **Single source of truth:
  `score.json`** (generated by `node cli/bin/nine-oh.mjs`). Current **claimed 9.005 / verified(strict) 8.975**,
  **DONE 41 / LOCAL-READY 20 / BLOCKED 5**; dimensions (claimed / strict): audit 8.95/8.95, function 8.90/8.90,
  security 9.00/9.00, UI 9.05/8.85, compliance 9.00/9.00, delivery 9.30/9.30. The strict line is lower because
  U2/U4 are browser-subset checks (strict drops them) and F6 remains LOCAL-READY. Genuine evidence added this
  round: A2 key distribution (`.pub` + fingerprint + doctor + tamper refusal), C5/D10 10k-entry backup RTO,
  F1/F1.1/U7 real desktop+mobile create→encrypt→decrypt→countersign→seal→export→ZIP→CLI verify,
  U9 Tab/focus/reduced-motion, D7/D8/D11/D12 release notes/SLA/rollback/zero-telemetry, S1/S1.1 STRIDE/LINDDUN/
  attack tree, S8 anti-forensics (acceptance + retention), S9 zero-runtime-dependency/SBOM/CDN, C7 applicability
  assessment, C10 privacy notice, A1.2 real X.509 root/expired/purpose/tamper chain tests, A3.1 25 real negative
  cases. The 20 LOCAL-READY items are locally-doable or pending sign-off; the 5 BLOCKED need a third party
  (A5/S2/U1/U5/C6). 9.5 cannot be claimed until every non-DONE item is closed. No "reserved".
- **Full WSTG penetration test + CVE comparison** — external dependency (9.5 S2), owner: third-party, 2 weeks.
- **Full keyboard / screen-reader focus-order walkthrough** — external dependency (9.5 U1), owner: accessibility advisor, 1 day.
