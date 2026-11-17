# Software Bill of Materials (SBOM) — FieldSeal Suite

*Version: v0.5 · Generated for EU audit / supplier review*
*Language: English only*
*Project license: MIT (see `LICENSE`) — the software itself is open source and free; commercial
support/integration/assurance are optional services and do not restrict or condition any
right granted by the MIT License.*

This SBOM documents the **dependency boundaries** of FieldSeal Suite. The central assurance
for auditors is simple: **the trusted verification kernel has zero third-party runtime
dependencies** (no npm package, no CDN, no third-party WebAssembly, no third-party
crypto/zip/pdf library).

---

## 1. Trusted kernel — zero runtime dependencies

These directories use **only Node.js built-in modules** (CLI) and **Web-native APIs**
(PWA). They contain **no `package.json`, no `require()`/`import` of external packages**.

### `cli/core/` (CLI verification kernel)
| File | Responsibility |
| --- | --- |
| `hash.js` | SHA-256 hashing, stable key-ordered JSON canonicalisation (reproducible hashes) |
| `zip-stream.js` | Minimal ZIP reader/writer (store, no compression lib) |
| `schema-validate.js` | Frozen `SPEC.md` manifest validation |
| `public-schema.js` | Published schema constants (no external schema registry) |
| `verify.js` | Core verify decision flow (`ok` / `tampered` / `needs_password` / `invalid_spec`) |
| `case-verify.js` | Case-layer (`fieldseal-case-*`) verification |
| `custody.js` | Chain-of-custody validation logic |
| `bundle.js` | Evidence-bundle reassembly |

### `pwa/core/` (browser verification kernel)
| File | Responsibility |
| --- | --- |
| `hash.js` | Web `crypto.subtle` SHA-256, stable JSON canonicalisation |
| `zip-builder.js` | Store-only ZIP builder (no library) |
| `zip-reader.js` | Store-only ZIP reader (no library) |
| `evidence-manifest.js` | Evidence-package manifest assembly |
| `case-manifest.js` | Case-layer state machine, `sealHash` aggregation, v0.4 dispatch |
| `custody.js` | Browser chain-of-custody logic |
| `signature-manifest.js` | Signature package manifest |

> **Audit assertion:** a grep for `require(` / `import ... from 'npm'` / `from 'http` across
> `cli/core` and `pwa/core` returns no third-party module references. `NODE_PATH`/bundler
> dependencies are not used in the kernel.

---

## 2. Isolated helper layer — does NOT enter the root hash / Isolierte Hilfsschicht

`pwa/helpers/` produces **presentation / convenience artifacts only**. Its outputs
(canvas snapshots, preview encodings, watermarks, export bundles) are **excluded from the
root-hash computation**. The layer may grow dependencies later without affecting the
verification kernel; it can be removed wholesale and the CLI verifier still produces identical
results.

| File | Responsibility | Notes |
| --- | --- | --- |
| `case-store.js` | IndexedDB storage (explicitly excluded from all hashing per `docs/SPEC-case.md`) | Storage only |
| `case-checksums.js` | Per-file checksums for attachments | Derived data |
| `case-crypto.js` | Local key handling for optional encrypted snapshot | Optional, not the trust source |
| `case-export.js` | Builds export ZIP/report — **never computes hashes** | Hash-free export |
| `case-snapshot.js` | Encrypted storage snapshot helper | Optional |
| `case-watermark.js` | Visual watermark rendering | Presentation |
| `canvas-draw.js` | Canvas snapshot drawing | Presentation |
| `preview-encoder.js` | Preview media encoding | Presentation |
| `attribution.js` | Four-layer attribution watermark text | Presentation |
| `backup-reminder.js` | Local backup reminder (no upload) | UX |
| `storage-quota.js` | `navigator.storage.estimate()` (degrades gracefully) | UX |
| `local-audit-log.js` | Local audit event log | Derived data |
| `ext-hooks.js` | Extension hook placeholders (`window.EXT_HOOKS = {}`) | No behavior |
| `webrtc-sync.js` | Optional local peer sync (no cloud) | Optional |

---

## 3. External optional service — "Aegis" (out-of-band, interface only) / Externe optionale Dienst

- **No Aegis code is embedded.** The suite only reserves a **push interface** (UI toggle,
  default **off**).
- When explicitly enabled, it issues a single native `fetch` `POST` carrying **text-only**:
  `rootHash`, `packageId`, `specVersion`. It never transmits the ZIP, media or signatures.
- Failure is surfaced only as a toast; it never blocks sealing, export or verification, and it
  never alters `manifest`, `rootHash` or the package.
- See `docs/gdpr-notes.md` for the data-minimisation assessment.

## 3a. External optional service — RFC3161 TSA (out-of-band, interface only)

- **No TSA provider code is embedded.** The adapter is first-party (`pwa/vendor/tsa-timestamp.js`)
  and the mode is **off by default**.
- When explicitly enabled, it sends **only** the textual `rootHash` to the operator-configured
  TSA endpoint and receives an RFC3161 token. It never transmits the ZIP, media, signatures or
  notes. Failure sets `tsaDegraded`; it does not silently substitute local time.
- The endpoint may be a third party outside the operator's jurisdiction; the operator is the
  controller for that transmission and must complete its own Art. 28/44 assessment.
  See `docs/EXTERNAL-TSA-DISCLOSURE.md`.

---

## 4. Presentation / offline shell (excluded from root hash) / Darstellungsschicht

`pwa/ui/`, `pwa/*.html`, `pwa/ui/style.css`, `pwa/sw.js`, `pwa/manifest.webmanifest`.
These render and cache the app; they are **not part of the evidence hash**. The offline
Service Worker (`sw.js`) precaches only first-party assets (`CACHE_NAME = fieldseal-suite-case-v18`).

---

## 5. Tooling / test layer (build-time only) / Werkzeuge (nur Build-Zeit)

`cli/test/` — regression, lint, read-only scanner, UI-availability gate. Test-only; not
shipped inside any evidence package. It uses `playwright-core` 1.65.1 (Apache-2.0) and
Chrome for Testing, both test-only; see `THIRD-PARTY.md`.

`tools/build/` — build-only binary/release tooling. It references `@yao-pkg/pkg` 5.8.1
(MIT) as a pinned devDependency; the product and Docker image never run `npm install`.
The build input is locked by exact version + integrity in `tools/build/BUILD-DEPENDENCIES.md`.

---

## 5a. `pwa/vendor/` — first-party adapters (NOT third-party code)

The directory name is a legacy architecture label. The files under it
(`tsa-timestamp.js`, `ext-hooks.js`, `test-tsa-timestamp.mjs`) are **first-party
adapter / glue code written by this project**, licensed **MIT**
(`SPDX-License-Identifier: MIT`).

FieldSeal Suite ships **no vendored third-party source code**. Should an upstream
library ever be added, it must be placed under its own directory with its upstream
LICENSE/NOTICE intact and must not carry a FieldSeal copyright header.

---

## 6. Supply-chain statement

- **Project license:** MIT — see `LICENSE`. The MIT License does not restrict, condition or
  delay any right it grants; no third-party code is redistributed.
- **Third-party runtime packages:** none in the kernel and helpers.
- **CDN / remote scripts:** none. All assets are first-party and precached locally.
- **Third-party WebAssembly:** none.
- **Third-party crypto / ZIP / PDF libraries:** none. ZIP is store-only (native); PDF is
  produced by the browser's native *Print → Save as PDF* — no PDF library.
- **Telemetry / analytics:** none.
- **External services (not code dependencies):** the optional "Aegis" hash-anchor toggle
  and the optional external RFC3161 TSA — both default **off**, both send only a textual
  root hash to an operator-configured endpoint. See `docs/EXTERNAL-TSA-DISCLOSURE.md`.

*End of SBOM — v0.5.*
