# FieldSeal Suite

Local field capture, multi-party sign-off, and offline verification — no cloud by default.

> **Status: v0.5 · open source (MIT) · local gates green · 9.5 not claimed; 9.005 claimed / 8.975 verified (strict), 41 DONE / 20 READY / 5 external blockers.**
> **No commercial license is required.** The code is MIT-licensed (see `LICENSE`); commercial
> support, integration, training, and assurance are **optional** services and never a condition
> of use. Trademarks are not granted by MIT — see `TRADEMARK.md`.

![license](https://img.shields.io/badge/license-MIT-green)
![version](https://img.shields.io/badge/version-v0.5-blue)
![deps](https://img.shields.io/badge/runtime%20deps-zero-brightgreen)

> **Release status:** v0.5 released (2026-11-15). SPEC FROZEN (2026-11-11, Q1–Q6 accepted).
> Steps 0–4 accepted; Step 5 delivered and locally verified; external sign-offs remain in
> `BLOCKERS.md`. Step 6 (optional Aegis hash anchor) is implemented and off by default.

## Why this exists

Field work — insurance loss assessment, trade acceptance, forensic documentation — is still
done with photos on a phone and a trust problem afterwards. The evidence exists, but proving
it was not altered between capture and handover usually means uploading it to someone else,
often across a border.

FieldSeal Suite answers that **without a server**: capture binds media into a hash-anchored
evidence package, multiple parties sign off, and one CLI verifies the whole chain offline —
on the device, in the field, with no network, no account, and no third-party runtime
dependency. The trust root is the native `sealHash` / `rootHash`, computed by first-party
code you can read end to end.

## What it does

- **Capture** — camera, video, local files, offline PWA; frozen `fieldseal-evidence-v0.2` and
  `v0.3` package formats.
- **Case layer** — group captures into a case, add custody and schema metadata, and compute a
  single top-level `sealHash`.
- **Countersign and seal** — multi-party sign-off, irreversible one-way seal, `sealHash` as the
  single trust root.
- **Verify** — CLI `verify`, `bundle`, and `case verify` (Node built-ins, streaming, ZIP64);
  the PWA uses the same trusted-core rules.
- **Chain of custody** — `custodyLog` and `auditLog`, rendered as a native DOM timeline.
- **Reports** — attestation HTML, CSV ledger, and print-to-PDF; English legal disclaimers.
- **Optional v0.5 metadata** — operator profile/identity and audit events are hash-bound
  (editing them after sealing makes verification return `tampered`); case-level human
  notes, device environment snapshot, TSA anchors and Bates metadata are additive
  non-trust fields excluded from `rootHash` / `sealHash`.
- **Tooling** — media verification, batch verification, read-only archive agent, receipt
  service, NTP proxy, exhibit batch index, Aegis envelope crypto, ASE export, NIST 800-88
  erasure guidance, static-binary packaging helper.

## Modules and dependency boundary

**The trusted product modules are zero-dependency:** no npm package, no CDN fetch, no
third-party WebAssembly, no vendored crypto/ZIP/PDF library. The CLI uses Node.js
**built-in** modules; the PWA uses **Web-native** APIs. Everything below is shipped
code unless marked test/build-only.

| Module | Path | What it does | Runtime dependency (who is referenced) |
| --- | --- | --- | --- |
| CLI trusted kernel | `cli/core/` | SHA-256 canonical hashing, store-only ZIP reader/writer, schema validation, evidence verify, case verify, custody validation, bundle reassembly, TSA token verify | **0 third-party.** Node built-ins only: `node:crypto`, `node:fs`, `node:path`, `node:stream`, `node:zlib`, `node:url`. |
| CLI commands / local server | `cli/bin/` | `audit.js` verify/bundle/case commands, `serve.mjs` loopback static server, `doctor.mjs`, `backup.mjs`, acceptance/score gates | **0 third-party.** Node built-ins + first-party `cli/core/`. |
| Browser trusted kernel | `pwa/core/` | Case state machine, `rootHash` / `sealHash`, evidence/signature manifests, custody, ZIP builders, schema validation | **0 third-party.** Web Crypto (`crypto.subtle`), Web Streams/DOM, IndexedDB; first-party modules only. |
| Browser storage/helpers | `pwa/helpers/` | IndexedDB case store, export ZIP/report, optional case encryption, audit trail, snapshots, watermarks, backup reminder, quota check | **0 third-party.** Browser APIs + first-party `pwa/core/`; outputs are presentation/export only. |
| UI components | `pwa/ui/` | Page chrome, toasts/dialogs, camera panel (`MediaRecorder`), signature pad (`canvas`/Pointer Events), styles | **0 third-party.** DOM, Canvas, MediaRecorder, Pointer Events. |
| Reports / export | `pwa/export/` | ASE HTML report, print CSS, CSV ledger helpers | **0 third-party.** DOM/Blob + first-party code. |
| First-party vendor adapters | `pwa/vendor/` | RFC3161 TSA adapter and extension-hook slot — **project-written MIT code**, not a vendored library | **0 third-party.** `fetch`/Web Crypto only. |
| Offline shell | `pwa/*.html`, `pwa/sw.js`, `manifest.webmanifest`, `pwa/components/` | 13 pages, service-worker precache, timeline component | **0 third-party.** Browser APIs; all assets first-party. |
| Optional agents / tools | `tools/*`, `cli/verify/`, `cli/bagit-tool.mjs` | Archive agent, receipt service, NTP proxy, exhibit batch index, Aegis envelope, BagIt/OAIS wrapper | **0 third-party** for the shipped Node code; Node built-ins only. |
| Test-only tooling | `cli/test/`, `scripts/` | Unit/integration/browser/a11y/fuzz/UI gates, licensing and language gates | **Not shipped.** Test-only references: Playwright (`playwright-core`, Apache-2.0) from the local `@playwright/cli` install, and Chrome for Testing; neither is a product runtime dependency. |
| Build-only tooling | `tools/build/` | Builds standalone verify binaries and release signatures | **Not shipped / not installed at runtime.** `pkg` = `@yao-pkg/pkg@5.8.1` (MIT), a pinned devDependency; no `npm install` is run in the product or Docker image. |
| Container image | `Dockerfile`, `compose.yaml` | Optional local deployment | **Platform only.** Base image `node:22-alpine` supplies Node.js; the image runs `serve.mjs` and performs no npm install. |

### What “zero dependency” means here

- **`cli/core/` and `pwa/core/` are 0-dependency kernels.** They are the only places
  `rootHash` / `sealHash` are computed. They import only first-party modules and
  Node/Web platform APIs.
- **`pwa/helpers/`, `pwa/ui/`, `pwa/export/`, `pwa/vendor/`, and the 13 pages are 0
  third-party runtime dependency modules.** They may read kernel hashes but never
  recompute the trust root.
- **Test and build tools are not product dependencies.** Playwright/Chrome are used
  only by local UI tests; `@yao-pkg/pkg` is used only to build binaries. They are
  neither bundled into the PWA nor installed in the Docker runtime.
- **External services are not code dependencies.** The optional, off-by-default
  Aegis anchor and external RFC3161 TSA send only a textual root hash to an
  operator-configured endpoint. See `docs/EXTERNAL-TSA-DISCLOSURE.md`.
- The authoritative boundary and per-package details are in `SBOM.md`,
  `SBOM.cdx.json`, and `THIRD-PARTY.md`.

## Quick start

**One command, no clone, no build, no npm install:**

```bash
docker run -d --name fieldseal -p 8123:8123 \
  ghcr.io/jeromeyoung608-commits/fieldseal-suite:latest
```

Then open <http://localhost:8123/> — it redirects to `/pwa/index.html`. The image is
built by `.github/workflows/docker-publish.yml` for both `linux/amd64` and
`linux/arm64`, from the exact commit the gates job verified, and the workflow pulls
the published image back and probes every page before it can go green. Pin a digest
when you need reproducibility:

```bash
docker inspect --format '{{index .RepoDigests 0}}' ghcr.io/jeromeyoung608-commits/fieldseal-suite:latest
```

Building it yourself instead (same result, no npm involved):

```bash
git clone https://github.com/jeromeyoung608-commits/fieldseal-suite.git && cd fieldseal-suite
docker build -t fieldseal . && docker run -d -p 8123:8123 fieldseal
```

### Without Docker

1. Serve locally (a secure context is required for WebCrypto and Service Worker):
   `cd pwa && python3 -m http.server 8123`
2. Open `index.html` and use **Evidence Capture** (`capture.html`).
3. Seal the package, then verify it offline:

   ```bash
   node cli/bin/audit.js verify ./evidence.zip --json
   node cli/bin/audit.js case verify ./case.zip --json
   ```

Or use the offline installer, which writes nothing outside its prefix:

```bash
./install.sh                      # to ~/.local/share/fieldseal-suite
./install.sh --prefix /opt/fieldseal --port 8123
./install.sh --verify-only        # signature check without installing
```

## Install and test

```bash
./install.sh
node cli/test/test-runner.js
node cli/test/test-runner.js --full
```

The v0.3 closing baseline recorded `120/120 passed`; the current suite count is printed by `node cli/test/test-runner.js`. The suite is zero-dependency at runtime. Tests use Node.js built-ins only; `--full` adds a
66,000-entry ZIP64 read/write case. The repository does not require npm or a package registry.

## Documentation map

All project documentation is **English only**. The product UI is **English only**:
every visible label, button, hint and dynamic message on all 13 pages is English
(brand names, CLI commands and file names stay unchanged). German UI strings, German legal
paragraphs and the DE/EN switch were removed; a legacy `fieldseal-lang=de` preference is
forced to English at boot. Coverage is asserted by `node cli/test/test-i18n-coverage.mjs`
(13 pages English-only + legacy DE forced to EN + dynamic toast).

| Area | Documents |
| --- | --- |
| License and attribution | `LICENSE`, `NOTICE`, `TRADEMARK.md`, `LICENSES/README.md`, `THIRD-PARTY.md`, `docs/WATERMARK-POLICY.md`, `COMMERCIAL-LICENSE.md`, `EULA.md`, `PRICING.md` |
| Security | `SECURITY.md`, `docs/SECURITY.md`, `docs/security-contact.md`, `docs/THREAT-MODEL.md`, `docs/CRYPTO-REVIEW.md` |
| Compliance | `docs/privacy-notice.md`, `docs/gdpr-notes.md`, `docs/ROPA-DPIA.md`, `docs/EXTERNAL-TSA-DISCLOSURE.md`, `pwa/legal/DPA-TEMPLATE.md`, `pwa/legal/DATA-RESIDENCY.md`, `pwa/legal/SUPPORT-SLA.md`, `pwa/legal/VPAT-2.5-EU.md` |
| Release and operations | `docs/RELEASE-NOTES.md`, `docs/RELEASE-CHECKLIST-9.5.md`, `docs/CHANGELOG-v0.5.md`, `docs/RELEASE-ROLLBACK.md`, `docs/runbook.md`, `docs/PLATFORM-MATRIX.md`, `KNOWN_ISSUES.md` |
| Acceptance | `Manual-Test-Checklist.md`, `Module-Acceptance-Report.md`, `docs/ACCESSIBILITY-STATEMENT.md`, `docs/INCIDENT-RESPONSE.md`, `docs/BUSINESS-CONTINUITY.md`, `reports/v04/UI-BUTTON-AUDIT.json`, `reports/v04/FINAL-FULL-AUDIT-2026-11-16.md` |
| Project | `GOVERNANCE.md`, `CHANGELOG.md`, `SUPPORT.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` |
| Open gaps | `KNOWN_ISSUES.md`, `BLOCKERS.md` (external items that cannot be closed locally) |

## Security and privacy

- Default operation is fully offline: no backend, no account, no telemetry, no analytics SDK,
  no cookies, and no outbound network calls.
- Evidence, cases, signatures, and the local audit trail stay in the browser profile or in
  files you export.
- The optional timestamp, Aegis anchor, and receipt integrations are **off by default** and
  disclosed in `docs/EXTERNAL-TSA-DISCLOSURE.md`.
- Report vulnerabilities privately through the repository security advisory, never a public
  issue. See `SECURITY.md`.

## License and attribution

The code is released under the MIT License. MIT requires only that the copyright notice and
permission notice travel with copies or substantial portions of the software. The
`FieldSeal Suite v0.5` footer and generated provenance markup are a project-attribution
convention and a nominative-use aid for the FieldSeal marks; they are **not** an additional
condition on code use and **not** a condition on your own outputs. You may remove the
runtime footer from your own outputs; keep the MIT copyright/permission notice in source
copies. See `LICENSE`, `NOTICE`, `TRADEMARK.md`, and `docs/WATERMARK-POLICY.md`.

The MIT text and commercial notice are a structural starting point, **not legal advice**.
Have a qualified German/EU attorney confirm them before you publish or redistribute.

## Acceptance and limitations

- Local gates cover unit, integration, browser, accessibility, service-worker, audit-anchor,
  backup/restore, and destructive robustness checks. See `cli/test/TEST-CASES.md` and
  `docs/RELEASE-CHECKLIST-9.5.md`.
- The product is not a qualified electronic signature under eIDAS. It does not guarantee
  court admissibility. Identity verification and lawful use remain the operator's
  responsibility; device time and GPS can be altered.
- External blockers — independent audit, third-party penetration test, screen-reader lab,
  visual sign-off, and legal sign-off — are tracked in `BLOCKERS.md` and are not claimed as
  done.
