# Platform Matrix — 9.5 F4

Version 1.0 · 2026-11-15 · FieldSeal Suite

> 9.5 F4 requires macOS arm64/x64 to be tested; Windows/Linux must either be
> really tested or explicitly declared NOT SUPPORTED. This product is a **local,
> static PWA + Node CLI** with **no runtime server and no automatic upload**, so
> the matrix covers the three layers: distribution, browser and CLI.

| Platform | Architecture | Status | Notes / acceptance |
| --- | --- | --- | --- |
| macOS | arm64 (Apple Silicon) | **SUPPORTED / tested** | Serve `pwa/` via local `python3 -m http.server` or any static server; Safari + Chrome; CLI `node cli/bin/*.mjs` |
| macOS | x64 (Intel) | **SUPPORTED / tested** | Same as above |
| Windows | x64 | **NOT SUPPORTED (explicit)** | PWA opens offline in Chromium, but **no official signed installer**; this release does not claim "cross-platform delivered". Change status only after an installer and real F2/D2 tests exist |
| Linux | x64 | **NOT SUPPORTED (explicit)** | Same as above; CLI requires Node ≥ 18 with WebCrypto, browser requires OPFS / IndexedDB |
| iOS / iPadOS | arm64 | **LIMITED (browser-only, no device test)** | Browser PWA capability only; not counted as an F4 mandatory platform |
| Android | arm64 | **LIMITED (browser-only, no device test)** | Same as above |

## Acceptance stance (honest)

- **Tested:** macOS arm64 + x64: PWA load, export, CLI re-verification
  (`audit-acceptance`, `doctor`, `test-runner` all ran on macOS).
- **Not done (external):** Windows/Linux installers and real-device tests. Per the
  9.5 discipline, **no cross-platform delivery is claimed**; status stays NOT
  SUPPORTED until an installer and real tests are supplied.
- **Browser requirements:** WebCrypto (`crypto.subtle`), OPFS or IndexedDB,
  Service Worker offline cache; without these offline use is impossible
  (environment limit, not a product defect).

## Three-platform install/upgrade/rollback (D2, external)

- **macOS:** static files + "Add to Home Screen"; upgrade = overwrite `pwa/` +
  clear the SW cache; rollback = restore the previous `pwa/`; user data lives in
  browser storage, uninstall = clear site data (no residue in system folders).
- **Windows / Linux:** **no installer is provided**, so the real-device D2 drill
  remains BLOCKED-OWNER (owner: publisher, week 2). Until then, no delivery claim.

Owner: publisher (Windows/Linux installers and real-device tests) · When: 1 day
before release · Acceptance: install/upgrade/rollback logs for three platforms
with no residue.
