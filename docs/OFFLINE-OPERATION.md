# Offline Operation Runbook

Version 1.0 · 2026-11-14 · FieldSeal Suite v0.5

All commands below run without network access, without `npm install` for the
product, and without administrator privileges. Node.js 18+ is the only runtime
requirement (and only for the CLI / local server; the PWA needs a current browser).

## 1. Install

```sh
./install.sh --verify-only                         # signature + binary preflight, writes nothing
./install.sh --prefix "$HOME/.local/share/fieldseal-suite" --port 8123
```

The installer verifies the Ed25519 release signature and all four binary digests
before copying anything. It records every file it writes in
`<prefix>/.fieldseal-install-manifest` so uninstall is exact and never touches
unknown files. Re-running the same command is idempotent.

Start the UI:

```sh
<prefix>/start.sh
# http://127.0.0.1:8123/pwa/index.html   (loopback only)
```

`cli/bin/serve.mjs` is a zero-dependency static server with `nosniff`,
`no-referrer`, no directory listing, and explicit rejection of `..` / empty path
segments. Overriding `--host` is possible but is an operator decision and is
outside the supported default posture.

## 2. Verify what you received (do this before first use)

```sh
node tools/release/release-tool.mjs verify-signature
node tools/build/verify-binaries.mjs
node cli/bin/doctor.mjs --json
node cli/bin/doctor.mjs --bundle /tmp/diagnostic.zip   # for support, contains no personal data
```

`doctor.mjs` checks the Node version, required files, release signature, binary
digests, four core self-tests, no remote URLs, no vendored modules, exact build
pins, a writable data directory, the local port, and loopback binding of optional
agents. Any `fail` makes it exit non-zero.

## 3. Everyday workflow (all local)

| Step | Where | Output |
|---|---|---|
| Capture | `pwa/capture.html` / `pwa/case-capture.html` | `evidence.zip` |
| Case management | `pwa/cases.html`, `pwa/templates.html` | IndexedDB `fieldseal-cases` |
| Multi-party sign | `pwa/sign.html`, `pwa/custody.html` | signed bundle + operation trail |
| Export / attestation | `pwa/case-export.html` | ZIP + CSV + printable report |
| Verify offline | `node cli/bin/audit.js case verify …` | `ok` / `tampered` / `invalid_spec` |

The browser never uploads anything. The optional local agents (`archive-agent`,
`receipt-service`, `aegis-crypto`) are off by default, bind `127.0.0.1`, and refuse to
start without their Bearer secret.

## 4. Backup & restore

```sh
# In the browser: open pwa/backup.html → "Export backup JSON"
node cli/bin/backup.mjs export  --input fieldseal-backup.json --out fieldseal-backup.zip
node cli/bin/backup.mjs verify  --input fieldseal-backup.zip --json
node cli/bin/backup.mjs restore --input fieldseal-backup.zip --out restored.json
```

The ZIP carries `backup.json`, `SHA256SUMS`, `MANIFEST.json` and `VERIFY.txt`.
`verify` recomputes the stored digest from the ZIP entry itself; `restore` refuses
to write anything if any digest, size or manifest field mismatches. The restored
JSON can be imported again with the Restore button (which requires an explicit
checkbox confirmation because it replaces all local cases).

## 5. Release rollback

See `docs/RELEASE-ROLLBACK.md`. Summary:

```sh
node tools/release/release-tool.mjs snapshot --label predeploy
node tools/release/release-tool.mjs rollback                 # dry-run plan
node tools/release/release-tool.mjs rollback --apply        # auto pre-rollback snapshot
node tools/build/verify-binaries.mjs
```

A real byte-corruption → rollback → re-verification rehearsal was executed on
2026-11-14 and is recorded in §5 of that runbook (8/8 files byte-identical after
rollback).

## 6. Privacy, legal and accessibility documents

All are linked from the footer of every page and pre-cached by the service worker:
`pwa/privacy.html`, `pwa/legal/DPA-TEMPLATE.md`, `SUPPORT-SLA.md`,
`VPAT-2.5-EU.md`, `DATA-RESIDENCY.md`. `SECURITY.md` and `KNOWN_ISSUES.md` live at
the repository root. Documents are templates / self-assessments, not third-party
certifications.

## 7. Uninstall / decommission

```sh
# 1. Export everything from pwa/backup.html first.
./install.sh --prefix "$HOME/.local/share/fieldseal-suite" --uninstall
# 2. In the browser: clear site data for the origin and unregister its service worker.
```

The uninstaller removes only the files listed in its manifest. Browser-stored
cases, signature images and the operation trail are deliberately NOT deleted by
the uninstaller — that is a separate, explicit operator action.

## 8. Troubleshooting

| Symptom | Action |
|---|---|
| `INSTALL-ERROR release signature verification failed` | Do not use this delivery. Re-obtain it from a trusted source. |
| `DOCTOR-FAILED` | Read the failing check IDs; `doctor.mjs --bundle` produces a redacted report. |
| Old UI after an update | `CACHE_NAME` is bumped on every precache change; also clear the browser HTTP cache (see `KNOWN_ISSUES.md`). |
| `Unrecognized algorithm name` on SHA3 | Runtime WebCrypto lacks SHA3-256; use SHA-256, or verify with the Node CLI. `C-15` covers both branches. |
| `BACKUP-VERIFY-FAILED` | The archive is corrupt or tampered with; do not restore it. Re-export from the browser. |
| Port already in use | `doctor` reports this as a warning only; choose another `--port`. |

## 9. Explicitly out of scope

Automatic cloud upload, eIDAS qualified signatures, AI truth determination,
content moderation, hosted services, SSO/SCIM/RBAC, SIEM forwarding, and legal
admissibility opinions. Admissibility depends on local law and operator testimony.
