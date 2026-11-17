# Security Policy — FieldSeal Suite

> Reporting channel and SLA: the root `SECURITY.md` is authoritative. This document is the detailed threat-model and trust-boundary reference. Do not publish an email address or PGP key that is not actually monitored.

**Scope:** This document defines the threat model, trust boundaries, hash-trust rules, cryptographic
modules, and the vulnerability-reporting process for the FieldSeal Suite. It applies to the whole
repository (`cli/core`, `pwa/core`, `pwa/helpers`, `pwa/export`, and the optional `tools/` agents).

**Languages:** English only.

---

## 1. Trust boundaries (three classes — read this first)

FieldSeal deliberately splits code into three risk classes. **Only class A carries trust.**

### Class A — Kernel trust chain (authoritative, zero-dependency)
- **Code:** `cli/core/*`, `pwa/core/*`, and the shared `cli/test` verifier.
- **Property:** zero third-party runtime dependencies. The aggregate `sealHash` (and per-evidence
  `rootHash`) is computed **only** here and is the **sole source of truth** for integrity.
- **Rule:** any post-seal modification to schema, media, custody log, or audit log fails verification
  (`tampered`). This class is never modified by display or agent tools.

### Class B — Pure presentation / export layer (read-only, display/transport only)
- **Code:** `pwa/helpers/case-export.js`, `pwa/export/ase-export.js`, `print-export.css`, and the
  rendered `case-report.html` / `case-ledger*.csv`.
- **Property:** reads the authoritative `rootHash` / `sealHash` and renders them. It **never**
  computes, recomputes, re-aggregates, or overwrites a hash. The Exhibit index and the ASE extended
  ledger are **derived views**; they are not part of the trust root.
- **Rule:** a corrupted input or a `draft` case is surfaced with a friendly message, never crashes,
  and never silently "fixes" a hash. Export never writes back to the case manifest.

### Class C — Optional external / agent tools (value-add, OUTSIDE the trust chain)
- **Code:** `tools/*` — `archive-agent`, `receipt-service`, `ntp-agent`, `aegis-crypto`,
  `exhibit-batch-export`, `media-verify`, `batch-verify`, and `tools/pkg`.
- **Property:** optional, Node-built-in only (no third-party crypto). They consume case packages
  read-only and must **never** be treated as the trust root. The verifier (Class A) remains the
  authority. Where a tool uses cryptography (e.g. `aegis-crypto` RSA-OAEP/AES-GCM envelope, or the
  kernel's AES-GCM storage encryption), key material stays local/in-memory and is never written to
  disk or transmitted; encryption is **storage/transport protection only** and does **not** replace
  the `sealHash` check.
- **Rule:** a compromised or misconfigured agent must not be able to fake a `sealHash` verdict. The
  CLI `case verify` is the independent check.

---

## 2. Hash-trust rules (non-negotiable)

1. `sealHash` is computed exclusively in Class A and binds schema, case metadata, ordered child
   `rootHashes`, the custody log, the schema-change log, and the case state.
2. `rootHash` (case) and each evidence sub-package `rootHash` are canonical-JSON + SHA-256. Verification is
   **deterministic**: the same package always yields the same hash.
3. **Verification, never trust the printout.** HTML reports and CSV ledgers are derived; only
   `case-manifest.json` + `evidence/` are authoritative.
4. No code outside Class A may recompute a hash for a verdict. Display/agent tools may *read* a
   recorded hash; they may never *produce* one used for trust.
5. A SHA-256 checksum file (`case-files.sha256`) covers exported files (including attachments) for
   file-level integrity; it does not replace the manifest `sealHash`.

---

## 3. Cryptographic modules

| Module | Location | Algorithm | Role | Trust impact |
| --- | --- | --- | --- | --- |
| Evidence/case hashing | `cli/core`, `pwa/core` | SHA-256 over canonical JSON | Authoritative root/seal | **Hash root** |
| Storage encryption | `pwa/helpers/case-crypto.js` | AES-GCM-256 + PBKDF2-SHA256(100000) | Encrypts an *additional* `.enc` snapshot only | None on trust root |
| Aegis envelope (optional) | `tools/aegis-crypto` | AES-GCM-256 + RSA-OAEP-SHA256 (multi-recipient) | Group-share a manifest copy | None — `sourceSealHash` is copied, not recomputed |
| Reference time | `tools/ntp-agent` | NTP client | Supplies `referenceNtpTime` advisory timestamp | None — advisory only |

**Key-hygiene rules:** no private key or passphrase is ever written to disk by a tool; keys/passphrases
are passed in memory and discarded. NTP time is advisory and never feeds a hash.

---

## 4. Threat model

**Assets:** evidence integrity (`sealHash`/`rootHash`), case confidentiality (storage encryption),
operator identity, chain-of-custody log.

**Adversaries considered:**
- *Standard (non-forensic)* — cannot break SHA-256 / AES-GCM; may attempt to edit files or replace media.
  → Detected by `tampered` on verify.
- *Insider / custodian* — may try to alter a manifest or custody entry after sealing.
  → Detected: any post-seal change invalidates `sealHash`.
- *Compromised verifier* — a tampered verifier could falsely report `ok`.
  → Mitigated by the golden-package check + open source + reproducible `sealHash` + binary checksum.
- *Network attacker* — interception of case data in transit.
  → Mitigated: local-only by default; optional S3/R2 agent uses SigV4 + TLS; no case data is sent by
  export/display tools.

**Out of scope / explicitly excluded:** qualified eIDAS electronic signatures, legal admissibility
guarantees (jurisdiction-dependent), and tamper-proof hardware. FieldSeal is a *tamper-evident*
record, not a qualified signature.

---

## 5. Vulnerability reporting & disclosure

- **Private disclosure:** report suspected vulnerabilities to the maintainers through a private
  channel (security contact published in the release notes / repository security tab). **Do not**
  open a public issue for a suspected security flaw.
- **Response SLA:** acknowledgement within **2 business days**; a mitigation or fix timeline within
  **30 days** for confirmed, exploitable issues.
- **Coordinated disclosure:** please allow the maintainers time to ship a fix before any public
  disclosure. A safe-harbor policy applies to good-faith researchers who follow this process.
- **Out-of-band:** if no security contact is configured, treat the repository owner as the recipient
  and encrypt sensitive reports.

---

## 6. External-facing security statement (use verbatim)

> FieldSeal Suite produces a tamper-evident, hash-bound forensic record. It is **not** a qualified
> electronic signature under eIDAS and provides **no guarantee of admissibility** in any court or
> jurisdiction. The aggregate `sealHash` is the sole source of trust; all other artifacts (reports,
> ledgers, envelopes, agent outputs) are derived or advisory. Admissibility is determined by the
> relevant authority; obtain independent legal review where relied upon. Device timestamps and GPS may
> be altered; participant identity and authority must be verified independently by the relying party.

---

## 7. Supply-chain & build hygiene

- The trusted core is **zero third-party runtime dependencies**; the repository root ships no
  `package.json` / lockfile.
- Optional `tools/pkg/build-nexe.mjs` uses **nexe as an external, optional dev tool only**; nexe is
  never added to the repository and the static binary is a distribution artifact, not a code change.
- Reproducibility: `git checkout <tag> && node cli/test/test-runner.js` must yield byte-identical
  `sealHash` behaviour; the golden package is the regression anchor.
