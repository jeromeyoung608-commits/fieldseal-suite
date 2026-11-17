# Manual Test Checklist — FieldSeal Suite v0.5

_Last updated: 2026-11-15 · Companion: `Module-Acceptance-Report.md`_

This is the human acceptance path. Run the automated gates first, then walk the main path
with real camera/files. Do not mark a row PASS from a screenshot alone; record the command
or the page/state you actually observed.

## 0. Start

| # | Step | Expected | Evidence |
|---|---|---|---|
| 0.1 | `cd pwa && python3 -m http.server 8123` | page served on localhost | terminal line |
| 0.2 | Open `http://localhost:8123/index.html` in Chrome/Edge | app shell loads, no console error | DevTools console |
| 0.3 | Install as PWA / reload offline | app shell still opens | browser install prompt + offline reload |

## 1. Precheck

| # | Command | Expected |
|---|---|---|
| 1.1 | `node cli/test/test-runner.js` | 143/143 PASS |
| 1.2 | `node cli/test/test-runner.js --full` | 144/144 PASS |
| 1.3 | `node cli/bin/audit-acceptance.mjs` | 16/16 PASS |
| 1.4 | `node cli/bin/doctor.mjs` | DOCTOR-OK, 16 checks, 0 failed (1 port warning allowed) |
| 1.5 | `node cli/test/read-only-scanner.cjs all` | `ATTRIBUTION-4-LAYERS-OK` + `AUDIT-OK` |
| 1.6 | `node scripts/verify-licensing.mjs` | PASS, all first-party sources + 7 legal docs |
| 1.7 | `node cli/test/ui-browser-check.mjs` | PASS |
| 1.8 | `node cli/bin/nine-oh.mjs --strict` | 0 local failures; score honest |

## 2. Main path

| # | Step | Expected | S-check |
|---|---|---|---|
| 2.1 | Capture a photo + a short video + a local file | each appears in the media list with preview | S-01, S-02 |
| 2.2 | Fill title, actor, GPS (allow/deny), note, tags | values persist; deny GPS degrades with a clear message | S-03, S-04 |
| 2.3 | Export `evidence.zip` | ZIP downloads; `audit.js verify` → `coreResult: ok` | S-10 business replay |
| 2.4 | Open `sign.html`, import evidence ZIP | linked evidence shows the correct `rootHash` | S-01, S-05 |
| 2.5 | Add two parties, draw signatures, **SEAL** | seal succeeds; second seal is refused | S-02, S-06 |
| 2.6 | Export signature record, verify with `--linked` | `coreResult: ok`, no cross-package mismatch | S-10 |
| 2.7 | Bundle evidence + signature, verify bundle | `coreResult: ok` | S-10 |
| 2.8 | `report-html` and open the report | 14 sections render; footer says `FieldSeal Suite v0.5` + `License: MIT` | S-07 |

## 3. Additional

| # | Scenario | Expected |
|---|---|---|
| 3.1 | Case layer: create → capture → custody → seal → export | case verifies by CLI; sealed case is read-only |
| 3.2 | Encryption: set passphrase → export cipher → wrong passphrase | `needs_password`, never `ok`; correct passphrase decrypts |
| 3.3 | Audit log: tamper an entry | boot banner shows tamper; chain verify fails |
| 3.4 | Backup: export JSON → verify ZIP → restore | round trip preserves cases; count matches |
| 3.5 | External TSA: configure endpoint, export | token present; failure produces `tsaDegraded`, no silent fallback |
| 3.6 | Aegis: off by default; enable with a local sink | only rootHash/packageId/specVersion leave; media never sent |
| 3.7 | GDPR redaction / actor purge | target fields masked; other cases unaffected |
| 3.8 | 200% zoom + high contrast + keyboard-only | no clipped controls; focus visible; dialogs reachable |

## 4. Snapshot

Record these after a green run:

- `node cli/test/test-runner.js` output (last line and counts).
- `node cli/test/read-only-scanner.cjs all` output (`14/14` footers, version v0.5).
- `node scripts/verify-licensing.mjs` output (149 first-party source files, 7 legal documents, 0 retired-licence mentions).
- `node cli/bin/nine-oh.mjs --strict` output (DONE / LOCAL-READY / BLOCKED).
- Screenshot of the report footer and the backup/privacy footer.

## 5. Failure lookup

| Symptom | First check | Do not |
|---|---|---|
| `tampered` on an untouched package | hash of media vs manifest; line endings; ZIP re-pack | re-seal to “make it pass” |
| `needs_password` on plaintext | `.enc` present without plaintext manifest | treat it as tampered |
| brand/footer stale | `pwa/helpers/attribution.js` version + page footer | edit only the report template |
| licensing gate fails | run `--fix` only for missing SPDX; legal-doc errors are manual | suppress the gate |
| TSA token missing | endpoint, CORS/TLS, `tsaDegraded` flag | silently fall back to local time |

## S-10 self-check

| ID | Check | Evidence |
|---|---|---|
| S-01 | All buttons/controls exist on every page | DOM list per page |
| S-02 | Every control has an event binding | click/keyboard smoke |
| S-03 | Loading and error states visible | slow/failed request |
| S-04 | Boundary fallbacks (empty, oversized, denied permission) | real negative case |
| S-05 | Form validation (required, format, duplicate) | invalid submit |
| S-06 | Component linkage (case ↔ capture ↔ sign ↔ export) | replay |
| S-07 | Keyboard accessibility (Tab/Enter/Escape/focus) | keyboard-only run |
| S-08 | Async catch (no unhandled rejection) | DevTools console |
| S-09 | Offline consistency (SW cache vs IndexedDB) | offline reload |
| S-10 | Business chain replay end-to-end | capture→seal→export→CLI verify |
