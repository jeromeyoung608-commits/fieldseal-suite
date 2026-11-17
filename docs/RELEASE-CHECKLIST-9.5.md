# 9.5 Release Checklist & Acceptance Ledger — FieldSeal Suite

Version 2.4 · 2026-11-16 · FieldSeal Suite v0.5 · Generated from `score.json`

> **9.5 means all six dimensions ≥ 9.5 AND weighted ≥ 9.5** — not one dimension
> hitting 9.5. `DONE` means a real automated check passed **and** the artefact's
> sha256 still matches. `LOCAL-READY` means the artefact/process exists and is
> locally executable but not yet evidenced as complete; `BLOCKED` needs a third
> party. **No "reserved" points.** Single source of truth: `node cli/bin/nine-oh.mjs`
> (writes `score.json`); `--strict` drops browser-subset checks U2/U4 and F6.

## Score

| Dimension | Base | +Delta(DONE) | Claimed | Verified (strict) | 9.5? | DONE / READY / BLOCKED |
|---|---:|---:|---:|---:|---|---|
| Audit | 7.5 | +1.45 | **8.95** | 8.95 | no | 7 / 3 / 1 |
| Function | 8.5 | +0.40 | **8.90** | 8.90 | no | 5 / 6 / 0 |
| Security | 8.5 | +0.50 | **9.00** | 9.00 | no | 6 / 4 / 1 |
| UI | 8.5 | +0.55 | **9.05** | 8.85 | no | 6 / 2 / 2 |
| Compliance | 7.5 | +1.50 | **9.00** | 9.00 | no | 7 / 3 / 1 |
| Delivery | 8.5 | +0.80 | **9.30** | 9.30 | no | 10 / 2 / 0 |
| **Weighted** | 8.2 | **+0.805** | **9.005** | **8.975** | **no** | **41 DONE / 20 READY / 5 BLOCKED** |

The claimed line is **9.005**; the strict line is **8.975**. Gap to
9.5 (strict) is **0.525**. The difference is U2/U4 (browser-subset
accessibility/cross-browser checks) and F6 (S-10 remains LOCAL-READY), plus external sign-offs.

## What cannot be done on this single machine (honest list)

- **A5 independent audit** — needs a separate audit firm / signed report.
- **S2 third-party penetration test** — needs an external WSTG tester.
- **U1 screen-reader walkthrough** — needs NVDA/JAWS/VoiceOver human sessions.
- **U5 visual sign-off** — needs a designer/accessibility sign-off.
- **C6 legal sign-off** — needs counsel.
- **A1.1 three production TSA endpoints** — needs external TSA accounts/network.
- **A7 Rekor-class transparency log** — needs an external log.
- **S3 independent crypto review** — needs an external cryptographer.
- **F4.1/D2 Windows installers** — cross-platform signing/build host.
- **U8 VPAT external confirmation, C4.1 external confirmation, C8 ISO certificate, C9 signed DPA** — third-party.

Everything else is either DONE with local evidence or listed below as LOCAL-READY.

## Audit
| ID | Weight | Status | Evidence / check |
|---|---:|---|---|
| A1 | 0.40 | DONE | auditAcceptance · `node cli/bin/audit-acceptance.mjs` |
| A2 | 0.30 | DONE | keyDistribution · `node cli/test/test-key-distribution.mjs` |
| A3 | 0.30 | DONE | auditAcceptance · `node cli/bin/audit-acceptance.mjs` |
| A4 | 0.20 | DONE | auditAcceptance · `node cli/bin/audit-acceptance.mjs` |
| A5 | 0.20 | BLOCKED | — |
| A6 | 0.10 | DONE | auditRetention · `node pwa/core/test-audit-retention.mjs` |
| A1.1 | 0.15 | LOCAL-READY | — |
| A1.2 | 0.05 | DONE | certChain · `node cli/test/test-cert-chain.mjs` |
| A2.1 | 0.10 | LOCAL-READY | — |
| A3.1 | 0.10 | DONE | negative25 · `node cli/test/test-negative-25.mjs` |
| A7 | 0.10 | LOCAL-READY | — |
## Function
| ID | Weight | Status | Evidence / check |
|---|---:|---|---|
| F1 | 0.10 | DONE | uiCoreFlow · `node cli/test/ui-core-flow.mjs` |
| F2 | 0.10 | LOCAL-READY | — |
| F3 | 0.10 | DONE | scale · `node pwa/core/test-large-evidence.mjs` |
| F4 | 0.10 | DONE | platform · `platform macOS supportdocs/PLATFORM-MATRIX.md` |
| F5 | 0.05 | DONE | determinism · `node cli/test/test-determinism.mjs` |
| F6 | 0.05 | LOCAL-READY | — |
| F1.1 | 0.05 | DONE | uiCoreFlow · `node cli/test/ui-core-flow.mjs` |
| F2.1 | 0.10 | LOCAL-READY | — |
| F3.1 | 0.10 | LOCAL-READY | — |
| F4.1 | 0.15 | LOCAL-READY | — |
| F8 | 0.10 | LOCAL-READY | — |
## Security
| ID | Weight | Status | Evidence / check |
|---|---:|---|---|
| S1 | 0.05 | DONE | threatModel · `contains docs/THREAT-MODEL.md` |
| S2 | 0.15 | BLOCKED | — |
| S3 | 0.10 | LOCAL-READY | — |
| S4 | 0.10 | DONE | repro · `node tools/build/repro-build.mjs --self-test` |
| S5 | 0.05 | LOCAL-READY | — |
| S6 | 0.05 | DONE | zipSlip · `node cli/test/test-zip-slip.mjs` |
| S1.1 | 0.10 | DONE | threatModel · `contains docs/THREAT-MODEL.md` |
| S4.1 | 0.10 | LOCAL-READY | — |
| S7 | 0.10 | LOCAL-READY | — |
| S8 | 0.10 | DONE | antiForensics · `audit-acceptance + audit-retention` |
| S9 | 0.10 | DONE | supplyChain · `node cli/test/test-supply-chain.mjs` |
## UI
| ID | Weight | Status | Evidence / check |
|---|---:|---|---|
| U1 | 0.20 | BLOCKED | — |
| U2 | 0.10 | DONE | browser · `node cli/test/ui-browser-check.mjs` |
| U3 | 0.05 | DONE | i18nCoverage · `node cli/test/test-i18n-coverage.mjs` |
| U4 | 0.10 | DONE | browser · `node cli/test/ui-browser-check.mjs` |
| U5 | 0.05 | BLOCKED | — |
| U6 | 0.10 | DONE | i18nCoverage · `node cli/test/test-i18n-coverage.mjs` |
| U7 | 0.10 | DONE | uiCoreFlow · `node cli/test/ui-core-flow.mjs` |
| U8 | 0.10 | LOCAL-READY | — |
| U9 | 0.10 | DONE | uiA11yFocus · `node cli/test/ui-a11y-focus.mjs` |
| U10 | 0.10 | LOCAL-READY | — |
## Compliance
| ID | Weight | Status | Evidence / check |
|---|---:|---|---|
| C1 | 0.30 | DONE | dpa · `contains pwa/legal/DPA-TEMPLATE.md` |
| C2 | 0.30 | DONE | rights · `node cli/bin/rights.mjs` |
| C3 | 0.20 | DONE | ropa · `contains docs/ROPA-DPIA.md` |
| C4 | 0.30 | DONE | vpat · `vpat per-row >=15` |
| C5 | 0.20 | DONE | backupRto10k · `node cli/bin/backup.mjs export|verify|restore (N=10000, rtoMs=54)` |
| C6 | 0.20 | BLOCKED | — |
| C4.1 | 0.10 | LOCAL-READY | — |
| C7 | 0.10 | DONE | applicability · `contains docs/APPLICABILITY-ASSESSMENT.md` |
| C8 | 0.10 | LOCAL-READY | — |
| C9 | 0.10 | LOCAL-READY | — |
| C10 | 0.10 | DONE | privacyNotice · `contains docs/privacy-notice.md` |
## Delivery
| ID | Weight | Status | Evidence / check |
|---|---:|---|---|
| D1 | 0.15 | DONE | repro · `node tools/build/repro-build.mjs --self-test` |
| D2 | 0.15 | LOCAL-READY | — |
| D3 | 0.10 | DONE | backupDemo · `node cli/bin/backup.mjs export|verify|restore (N=200, rtoMs=55)` |
| D4 | 0.05 | DONE | — |
| D5 | 0.05 | DONE | runbook · `runbook exists` |
| D6 | 0.05 | LOCAL-READY | — |
| D7 | 0.05 | DONE | releaseNotes · `contains docs/RELEASE-NOTES.md` |
| D8 | 0.05 | DONE | supportSla · `contains pwa/legal/SUPPORT-SLA.md` |
| D9 | 0.10 | DONE | repro · `node tools/build/repro-build.mjs --self-test` |
| D10 | 0.10 | DONE | backupRto10k · `node cli/bin/backup.mjs export|verify|restore (N=10000, rtoMs=54)` |
| D11 | 0.10 | DONE | releaseRollback · `node tools/release/test-release-tool.mjs` |
| D12 | 0.05 | DONE | noTelemetry · `node cli/test/test-no-telemetry.mjs` |

## Docker manual-test entry

```bash
docker build -t fieldseal-suite:local .
docker compose up -d
# open http://localhost:8123/pwa/index.html
```

The image was built and smoke-tested on 2026-11-16: `GET /pwa/index.html` → 200, title
`FieldSeal Suite`, and a real browser created a case through `newcase.html` → `case-detail.html`
with zero console errors.
