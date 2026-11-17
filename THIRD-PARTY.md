# Third-party and platform dependencies

FieldSeal Suite's **shipped product code** has **zero third-party runtime dependencies**.
There is no npm package, CDN script, third-party WebAssembly, or vendored crypto/ZIP/PDF
library in `cli/core/`, `pwa/core/`, `cli/bin/`, `pwa/helpers/`, `pwa/ui/`, `pwa/export/`,
`pwa/vendor/` or the 13 pages.

This file records every *non-first-party* thing the repository references, including
test/build/platform items that are **not** shipped in the product runtime. It exists so
"zero dependency" is not a slogan but a checkable boundary.

## 1. Product runtime

| Item | Where used | License / source | Shipped? |
| --- | --- | --- | --- |
| Node.js built-in modules (`node:crypto`, `node:fs`, `node:path`, `node:stream`, `node:zlib`, `node:url`, `node:child_process`) | `cli/core/`, `cli/bin/`, `tools/*` | Node.js platform (MIT); built into the host runtime, not a package | Yes, as host runtime |
| Web-native APIs (`crypto.subtle`, Web Streams, IndexedDB, DOM, `MediaRecorder`, Canvas, Service Worker) | `pwa/core/`, `pwa/helpers/`, `pwa/ui/`, `pwa/export/`, `pwa/sw.js` | Browser platform specifications (W3C/WHATWG); implemented by the user's browser | Yes, as host platform |
| `node:22-alpine` base image | `Dockerfile` | Official Node.js Docker image; Node.js and Alpine components keep their upstream licenses | Optional container deployment only; no npm install |

**No third-party source code or license text is vendored in the product.** If third-party
code is ever added, it must live in its own directory with the upstream LICENSE/NOTICE
intact and must not carry a FieldSeal copyright header.

## 2. Test-only tooling (not shipped)

| Item | Exact version / location | License | Why it is not a product dependency |
| --- | --- | --- | --- |
| `playwright-core` | `1.65.1`, loaded from the local `@playwright/cli` global install; tests honour `PLAYWRIGHT_CORE` | Apache-2.0 | Drives headless browser checks only. Not imported by any `pwa/` file and not present in the Docker image. |
| Chrome for Testing | `/Users/yangjie/Library/Caches/ms-playwright/chromium-1248/.../Google Chrome for Testing`; tests honour `CHROME_BIN` | Chromium/Google upstream terms | Browser used by local UI/a11y/telemetry tests only. The product runs in whatever browser the operator already has. |
| Python 3 `http.server` | Used by a few local test harnesses | PSF License | Local static test server only; not a product runtime component. |

If a test tool is missing, the corresponding UI/a11y gate is **BLOCKED** and must not be
reported as passed. The product itself does not need any of these tools.

## 3. Build-only tooling (not installed at runtime)

| Item | Exact pin | License | Boundary |
| --- | --- | --- | --- |
| `pkg` → `@yao-pkg/pkg` | `5.8.1` (devDependency alias in `tools/build/package.json`) | MIT | Used only to build standalone verify binaries under `tools/build/dist/`. `npm install` is never run by `install.sh`, `serve.mjs`, the Dockerfile or the PWA. |
| Node runtime base images downloaded by `pkg` | pinned by `pkg` build target `node18` | Node.js MIT | Cached on the publisher's build machine; not installed by the product. |

The build tooling source may be present in a source checkout for reproducible builds, but
it is not a runtime dependency and its npm dependency is never installed by the product.

## 4. Optional external services (not code)

| Service | Default | What leaves the device | Code dependency? |
| --- | --- | --- | --- |
| Aegis hash anchor | off | text-only `rootHash`, `packageId`, `specVersion` to an operator-configured endpoint | No. First-party `fetch` call; no SDK. |
| External RFC3161 TSA | off | text-only `rootHash` to an operator-configured endpoint; returns a token | No. First-party adapter; no TSA vendor SDK. |

The operator is the controller for those optional transmissions and must perform their own
Art. 28/44 assessment. See `docs/EXTERNAL-TSA-DISCLOSURE.md` and `docs/gdpr-notes.md`.

## 5. How to re-check this file

```bash
node cli/test/test-supply-chain.mjs      # no remote scripts/CDN, SBOM consistency
node cli/bin/doctor.mjs                  # no node_modules/lockfiles, exact build pin
node scripts/verify-licensing.mjs        # first-party copyright + SPDX MIT
node scripts/verify-watermark.mjs        # four attribution layers
```

Last audit: 2026-11-16. The authoritative machine-readable boundary is `SBOM.md` and
`SBOM.cdx.json`.
