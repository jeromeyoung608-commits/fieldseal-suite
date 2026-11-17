# Optional Support & Service Levels — Open-source / Self-hosted Edition

Version 1.1 · 2026-11-15 · FieldSeal Suite

> The **code** is MIT-licensed and comes with **no support obligation**. This document
> describes only an **optional paid support engagement** for a self-hosted, offline
> deployment. FieldSeal Suite has no server operated by the publisher, so there is no
> cloud uptime commitment: availability is entirely under the customer's control.

## 1. What "availability" means here

The product is a set of static files and offline binaries. There is no publisher-side
endpoint that can go down. Availability depends on the Customer's own device,
browser and storage. The optional local agents bind to `127.0.0.1` and are not
network services.

Consequence: a classic 99.9% uptime SLA is not applicable and is not claimed.
Customers who need a contractual uptime figure should obtain it from their own
infrastructure provider, not from this offline tool.

## 2. Self-service (immediate, no contact required)

All of the following ship inside the delivery and work offline:

| Need | Self-service artefact |
| Install / reinstall | `install.sh` (`--help`, `--prefix`, `--port`, `--uninstall`) |
| Health check | `node cli/bin/doctor.mjs --json` / `--bundle` |
| Backup & restore | `pwa/backup.html`, `node cli/bin/backup.mjs export\|restore` |
| Rollback | `docs/RELEASE-ROLLBACK.md`, `tools/release/release-tool.mjs` |
| Release verification | `node tools/build/verify-binaries.mjs` |
| Privacy / DPA / VPAT | `pwa/privacy.html` + `pwa/legal/*.md` |
| Known limitations | `KNOWN_ISSUES.md` |
| Security reporting | `SECURITY.md` |
| Offline guide | `README.md`, `docs/OFFLINE-OPERATION.md` |

## 2b. Recovery objectives (RTO / RPO)

Because the product is offline and operator-controlled, recovery is driven by the
Customer's own actions, not by a publisher-side service:

| Objective | Definition | Target |
|---|---|---|
| RPO (Recovery Point Objective) | Maximum data-loss window | Determined by the operator's own export cadence. `pwa/backup.html` and `node cli/bin/backup.mjs` allow a full export at any moment, so RPO can be made near-zero by exporting after each session. |
| RTO (Recovery Time Objective) | Time to restore operation after loss | Minutes: reinstall from the delivery (`install.sh`) onto a clean device and re-import the last backup. No publisher-side dependency. |
| Backup frequency | How often a restorable copy exists | Operator-initiated; no automatic schedule. Recommended after every sealing session. |

These figures are operator-controlled and are provided as guidance, not a contractual
availability commitment (see §1). They align with the backup / restore workflow in
`docs/OFFLINE-OPERATION.md`.

## 3. Optional paid support scope and response targets
| Severity | Definition | Basic plan | Plus plan |
| --- | --- | --- | --- |
| S1 | Release signature cannot be verified, or a shipped binary fails the golden case | Acknowledgement within 2 business days; corrected release or documented workaround within 10 business days | Acknowledgement within 1 business day; corrected release or documented workaround within 5 business days |
| S2 | A documented offline workflow fails reproducibly on a supported runtime | Acknowledgement within 3 business days; fix in the next release | Acknowledgement within 1 business day; fix in the next release |
| S3 | Documentation gap, cosmetic issue, feature request | Acknowledgement within 5 business days; roadmap triage, no committed date | Acknowledgement within 2 business days; roadmap triage, no committed date |

"Business day" means Monday–Friday excluding public holidays at the Supplier's
place of business. These are targets for an **ordered support service**, not a condition on the MIT-licensed
code. They are not a promise of on-site or legal assistance, and no 24/7 on-call is offered.

## 4. Supported runtimes and maintenance window (paid support scope)

- Node.js LTS with built-in `node:crypto` (18+) for the CLI and release tools.
- Current versions of Chromium, Firefox and Safari for the PWA. WebCrypto
  `SHA3-256` is capability-gated; when unavailable the product uses SHA-256.
- Security fixes for the current minor release line. Older lines receive fixes
  only for S1 issues. End-of-life notices appear in `CHANGELOG`.

## 5. Escalation and evidence

Include `doctor.mjs --bundle` output, the exact CLI command, the platform/Node
version and the (redacted) case identifier. Never attach real evidence packages or
personal data to a support ticket.

## 6. Explicit exclusions

eIDAS qualified signatures, legal admissibility opinions, forensic testimony,
cloud hosting, automatic upload, AI truth determination, content moderation,
SSO/SCIM, SIEM forwarding and hardware/HSM provisioning are **out of scope**.
