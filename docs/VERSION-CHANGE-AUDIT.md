# Version Change Audit — FieldSeal Suite

**Purpose.** Forensic customers rightly fear *silent* changes to trust logic. This document is the
explicit ledger of **what each released version changed in the trusted kernel (Class A)** versus what
was limited to presentation / export / optional agents (Class B / C). If a version touched Class A, the
verifier's golden anchor must be re-checked and `sealHash` behaviour must remain reproducible.

**Trust classes** (see `docs/SECURITY.md` §1):
- **Class A — Kernel trust chain** (`cli/core`, `pwa/core`): the *only* place `rootHash` / `sealHash` are
  computed. Any change here is hash-affecting and must be proven backward-compatible or explicitly versioned.
- **Class B — Presentation / export** (`pwa/helpers`, `pwa/export`): reads hashes, never computes them.
- **Class C — Optional agents / tools** (`tools/*`, `cli/bagit-tool.mjs`, `cli/verify/*`): value-add, outside the trust root.

**Golden-anchor rule.** `cli/test/fixtures/golden/fieldseal-golden-v0.5-sealed.zip` is the auditor-facing
verifier anchor (see `docs/Forensic-Validation-Procedure.md` §2). Any Class A change MUST regenerate the
golden and re-run `S-21` (`verify-golden.cjs`). Reproducibility: `git checkout <tag> && node cli/test/test-runner.js`
yields byte-identical `sealHash` behaviour.

> **The golden is an immutable historical artefact.** It was sealed on 2026-11-13, so the licence
> line embedded in its `case-report.html` and CSV ledgers reads
> `License: Proprietary, local-only use; …` — that is the state **at sealing time**, not the
> licence of the software today. The project has since been relicensed to **MIT** (see `LICENSE`).
> The golden is deliberately **not** edited: changing its bytes would destroy the anchor it
> exists to provide, and `verify-golden.cjs` checks the package against its own manifest, not
> against freshly generated output. Artefacts produced by the current code carry
> `License: MIT · Ownership: …` in the report footer and the CSV metadata line.

---

## v0.3 — baseline (forensic capture + multi-party countersign + encryption)

| Area | Class | Impact |
| --- | --- | --- |
| Countersign / hand-drawn signature, signature PNG attachments (digest-bound) | A | Hash-bound signer attestations; post-seal change → `tampered` |
| AES-GCM storage encryption (`pwa/helpers/case-crypto.js`) | A (envelope only) | Storage/transport protection; explicitly does **not** replace `sealHash` |
| Unified audit log (`auditLog`) | A | Hash-bound, append-only; post-seal edit → `tampered` |
| Report blocks / print CSS (`pwa/export`) | B | Display only |

## v0.4 — second round (kernel versioning + new sealHash aggregate)

| Area | Class | Impact |
| --- | --- | --- |
| Explicit `fieldseal-case-v0.4` spec dispatch; new `sealInput.v04` aggregate | **A (hash-affecting)** | Introduced `V04_SEAL_FIELDS = schemaDictionaries, snapshots, thirdPartyNotes, isDeleted` into the versioned sealHash. **Backward compatibility proven:** v0.2 / v0.3 `sealHash` remain byte-identical (C-37 golden fixtures). |
| 11 new audit event types + `V04_PERMISSION_MATRIX` (sealed write lock) | **A** | State machine + audit; `sealed` rejects every write (Contract A) |
| Report blocks 11–14, visible watermark (dual digests), third-party notes, soft-delete, report branding | B | Display only; branding/watermark are `V04_NON_SEAL_FIELDS` (outside sealHash) |
| VERIFY.txt v0.4 section, CSV attribution, `/attachments` checksum contract | B | Export layout; `case-files.sha256` covers attachments (file-level) |

> **Why v0.4 is safe to rely on:** the new aggregate is *additive and version-gated* — a v0.2/v0.3 package
> is still verified by the same verifier and produces the same `sealHash` it always did. See `C-37`.

## v0.5 — additive case layer + packaging (DEV, additive throughout)

| Area | Class | Impact |
| --- | --- | --- |
| New §10.2 case-layer fields: `operatorProfile` (hash-bound), `operatorIdentity` / `humanNotes` / `envSnapshot` / `tsaTimestamps` / `bates` (rootHash-only), `witnessStatements` / `retention` (hash-bound), `mediaRedactions` (rootHash-only), `approvalPolicy` / `approvals` (rootHash-only), `geoAttestations` (rootHash-only) | A (additive) | Each new field enters `rootHash` and (where ruled) `sealHash`, or stays outside both. **None alter the v0.4 sealHash aggregate** — proven by `test-dual-control.mjs` / `test-geo.mjs` asserting `computeSealHash` is unchanged by approvals/geo. |
| New v0.5 write actions (`requireV05Action` gated): `bindOperator*`, `addWitnessStatement`, `setRetention`, `addMediaRedaction`, `setApprovalPolicy`, `recordApproval`, `recordGeoAttestation` | A | Controlled writes; `sealed` still rejects all (Contract A unchanged) |
| Multi-person multi-control **hard gate** (`requireApproval` wired into `sealCase` / `recordTransferReceipt` / export UI) | A (behavioural gate) | Does not change hashes; is a no-op unless a policy is set (backward compatible) |
| BagIt / OAIS export (`buildBagitZip`, `cli/bagit-tool.mjs`) | **B (non-trust wrapper)** | Packaging only; case `rootHash`/`sealHash` copied into `bag-info.txt`; `verifyBagitFiles` is OAIS fixity, never a trust verdict |
| FR/ES i18n kernel (`pwa/core/i18n.js`, JSON-driven) | B | Text only; no hash logic |
| ASE Export Report, NIST/ISO alignment docs, golden package, TSA adapter/verify tools | B / C | Presentation / optional agents; outside the trust root |

> **v0.5 trust posture:** every addition is either hash-bound (tamper-evident) or explicitly outside the
> hashes (rootHash-only, so still tamper-evident via `rootHash`). No change weakens the v0.4 sealHash
> contract; existing sealed packages remain verifiable unchanged.

---

## How to read a future change

1. Locate the version below. If it lists anything under **Class A (hash-affecting)**, treat it as a
   trust-relevant change: confirm (a) the golden anchor still returns `ok`, (b) older-version packages
   still verify, (c) `git checkout <prev-tag>` reproduces the prior `sealHash`.
2. Class B / C changes never affect `case verify`; they are display, export layout, or optional tooling.
3. The authoritative per-feature detail lives in `docs/CHANGELOG-v0.5.md`; this file is the
   impact-classification digest, not the change log.
