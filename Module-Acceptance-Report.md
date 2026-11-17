# Module Acceptance Report — FieldSeal Suite v0.5

_Last updated: 2026-11-15 · Automated evidence is reproducible; manual sign-off is marked honestly._

**Overall:** automated gates are green; the release is **not** claiming 9.5. External
independent audit, penetration test, screen-reader transcript, visual regression sign-off and
legal review remain open (see `KNOWN_ISSUES.md`).

| Module | What it does | Automated evidence | Status |
|---|---|---|---|
| Trusted core (`cli/core`, `pwa/core`) | SHA-256/SHA3 hash, ZIP, manifest, sealHash | `test-runner` 143/143; `--full` 144/144; golden v0.5 anchor | PASS (automated) |
| Capture (`capture.html`, `case-capture.html`) | camera/video/files, GPS, notes, tags | PWA tests + UI browser check | PASS (automated), manual camera pass pending |
| Sign / Seal (`sign.html`) | parties, drawn signatures, countersign, seal | E-01..E-04 + C-21..C-24 | PASS (automated), manual signature pass pending |
| Case layer (`case-detail`, `cases`, custody) | draft/emergency, custody, seal lock, export | C-09..C-24, case verify CLI | PASS (automated) |
| Audit / anchor (`local-audit-log`, Aegis) | hash chain, retention, tamper banner, optional anchor | A6 retention test + browser check; Aegis off by default | PASS (automated), live endpoint test pending |
| External TSA (`pwa/vendor/tsa-timestamp.js`) | optional RFC3161 token | unit adapter test; `doctor --audit-log --tsa-root` path | PASS (unit), real TSA endpoint test pending |
| Export / report (`case-export`, `cli/report`) | attestation, CSV, HTML report, watermarks | report tests + footer scanner 14/14 | PASS (automated) |
| Backup / restore (`backup.html`, `cli/bin/backup.mjs`) | export/verify/restore | D3 200-record round trip + RTO | PASS (automated) |
| PWA UI (`pwa/ui`, all pages) | dark theme, responsive, dialogs, keyboard | `ui-browser-check` PASS; 200% zoom/high contrast | PASS (subset), full manual visual pass pending |
| CLI / doctor / nine-oh | verify, bundle, report, doctor, ledger | `audit-acceptance` 16/16; `doctor` 16 checks 0 failed | PASS (automated) |
| Licensing / watermark | MIT, SPDX, 4-layer attribution | `verify-licensing` PASS (148 sources / 7 legal docs); scanner 14/14 | PASS (automated) |

## Reproduce

```bash
node cli/test/test-runner.js
node cli/test/test-runner.js --full
node cli/bin/audit-acceptance.mjs
node cli/bin/doctor.mjs
node cli/test/read-only-scanner.cjs all
node scripts/verify-licensing.mjs
node cli/test/ui-browser-check.mjs
node cli/bin/nine-oh.mjs --strict
```

## Not accepted by this report

- **Independent audit / penetration test** — third-party engagement, not self-run.
- **Screen-reader transcript** — manual NVDA/VoiceOver pass still required.
- **Visual regression sign-off** — human sign-off on the v0.5 screenshots.
- **Legal review** — the licence family is structurally consistent, not attorney-approved.
- **Live external TSA endpoint** — adapter is unit-tested; a real endpoint/CORS chain is operator-specific.

These are listed as `BLOCKED` or `LOCAL-READY` in `score.json`; do not read this table as a 9.5 claim.
