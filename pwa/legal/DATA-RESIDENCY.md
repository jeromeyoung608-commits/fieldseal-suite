# Data Residency & Subprocessor Statement

Version 1.0 · 2026-11-14 · FieldSeal Suite

## 1. Where data lives

All data resides on the device where the operator runs the product:

- Evidence packages, cases and signature images: browser IndexedDB
  (`fieldseal-cases`), plus files the operator exports (ZIP / JSON / CSV / PDF-print).
- Local operation trail: browser localStorage (`fieldseal-local-audit-log`).
- UI preferences and flags: browser localStorage.
- Installed program files: the directory chosen via `install.sh --prefix`.

There is **no** publisher-operated server, database, bucket, CDN, telemetry endpoint,
error-reporting service or analytics SDK. The publisher cannot access, list, export
or delete customer data.

## 2. Network behaviour

The static PWA contains no remote URL, no remote font, no external script and no
import map. All module imports are relative and shipped locally. The service worker
pre-caches the full module closure for offline cold start. No automatic upload is
performed at any point in the workflow.

Optional, off-by-default local agents (`tools/archive-agent`,
`tools/receipt-service`, `tools/aegis-crypto`) bind to `127.0.0.1` by default,
require a Bearer secret, and refuse to start without one. Overriding `BIND_HOST`
is an explicit operator decision and is documented in `../../SECURITY.md`.

The release tooling (`tools/release`) is fully offline. It uses Node built-ins only.
RFC 3161 timestamping, OCSP/CRL retrieval and certificate-chain validation are
**optional vendor extensions** and are not part of this offline baseline.

## 3. Subprocessors

**None by default.** There is no third party that processes personal data on behalf of the
Customer or the Publisher in the default deployment model. The product has zero runtime
dependencies. Build-time tooling (`pkg`) is used only on the publisher's build machine and
never sees customer data. The optional external RFC3161 TSA endpoint is selected by the
Customer; it may be a third-party recipient or sub-processor depending on the configuration,
and the Customer must complete its own Art. 28/44 assessment. The Publisher is not a party
to it. See `../../docs/EXTERNAL-TSA-DISCLOSURE.md`.

## 4. Cryptography and integrity

- Hashing: SHA-256, and SHA3-256 only when the runtime WebCrypto actually supports
  it (real capability probe, otherwise disabled with a clear error).
- Release integrity: detached Ed25519 signature over `SHA256SUMS`, verified with
  the bundled public key; the private key is generated outside the repository.
- Local trail: SHA-256 hash chain (`prevHash` + `hash` over canonical JSON) with
  boot-time verification and a visible tamper banner.
- No eIDAS qualified signature, no HSM, no central PKI.

## 5. Retention and deletion

| Data | Default retention | Deletion path |
|---|---|---|
| Local operation trail | 365 days, hourly sweep, configurable via `setRetentionDays()` | `clearLog()`, `purgeActorFromLogs()`, or clearing browser site data |
| Cases and evidence | Indefinite, operator-controlled | `deleteCase()` in Case Management (also purges linked trail entries) |
| Installed program files | Until uninstalled | `install.sh --uninstall` plus browser cache/SW deregistration |

A sealed case is intentionally immutable: correction means creating a new case and
deleting the old one, preserving the evidentiary chain rather than rewriting it.

## 6. Transfers

No cross-border transfer occurs in the default off mode. If the operator enables the
optional external RFC3161 TSA mode, only the textual root hash is sent to the operator-selected
TSA endpoint; that endpoint may be outside the EEA/UK and the operator must complete its own
Art. 44 assessment. If an operator voluntarily copies an exported evidence package to another
system (email, shared drive, cloud storage), that transfer is the operator's own processing
activity, outside this product's boundary.

## 7. Contact

Security and privacy questions: see `../../SECURITY.md`. The privacy page
`../privacy.html` lists the same documents in-product.
