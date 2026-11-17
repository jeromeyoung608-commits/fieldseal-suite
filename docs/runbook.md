# Operations Runbook — FieldSeal Suite

Version 1.0 · 2026-11-15 · FieldSeal Suite
Reference: 9.0 delivery item D5. For operators / support / release engineers.

## 1. First-line self-service (no contact required)

| Symptom | Action | Artefact |
|---|---|---|
| Page won't load | Run `node cli/bin/doctor.mjs --json`; check `env.writable`, `env.port` | doctor report |
| Export won't verify | `node cli/bin/doctor.mjs --audit-log <file> --device-key <spki> --tsa-key <tsaSpki>` | log.chain line |
| Suspicious behaviour | `node cli/bin/doctor.mjs --bundle <out.zip>` and attach | diagnostic bundle |
| Reinstall | `install.sh --prefix <dir> --uninstall` then reinstall | install.sh |
| Rollback | `docs/RELEASE-ROLLBACK.md`, `tools/release/release-tool.mjs` | rollback target |

## 2. Health check (`doctor.mjs`)

Exit 0 = all green; non-zero = at least one `fail`. Always run with `--json` in CI.
Known `warn` (not fail): `env.port` "in-use" (a local server is expected).
The audit checks: `log.chain` (chain + dual-key anchor + unsigned rejection), `core.sw`
(offline precache closure), `core.chain`, `core.csv` (formula injection), `core.sha3`
(capability gate), `static.remote` (no remote URLs), `static.deps` (no vendored modules),
`build.pins` (exact pins), `static.imports` (every PWA import resolves).

## 3. Release verification

```
node tools/build/verify-binaries.mjs            # checks dist digests + signature
node tools/release/release-tool.mjs verify-signature   # verifies SHA256SUMS.sig
```
A reproducible build can be re-run and compared:
```
node tools/build/repro-build.mjs --verify
```

## 4. Incident response (severity → SLA)

| Severity | Definition | First response | Notify |
|---|---|---|---|
| S1 Critical | data loss / cannot open exported evidence | 1h ack, 24h fix or workaround | customer + legal |
| S2 High | a workflow blocked, data safe | 4h ack, 72h fix | customer |
| S3 Medium | degraded UX, workaround exists | 1 business day ack | customer |
| S4 Low | cosmetic / doc | next release | — |

Notification template and contact: `SECURITY.md` + `pwa/legal/SUPPORT-SLA.md`.

## 5. Backup / restore (D3)

`pwa/backup.html` (GUI) or `node cli/bin/backup.mjs export|restore`. Restore re-imports
the IndexedDB store and re-verifies the chain + anchor. RTO is operator-driven (offline
product); a documented restore drill is in `docs/RELEASE-CHECKLIST-9.5.md` item D3.

## 6. Support channels & docs index

- Security reporting: `SECURITY.md`
- Privacy / DPA / VPAT: `pwa/privacy.html`, `pwa/legal/*.md`
- Known limitations: `KNOWN_ISSUES.md`
- Offline operation: `docs/OFFLINE-OPERATION.md`, `README.md`
- Versioning: `docs/CHANGELOG-v0.5.md`, `docs/RELEASE-NOTES.md`, `docs/VERSION-CHANGE-AUDIT.md`
- Change management: every release updates the changelog + the SHA256SUMS signature
