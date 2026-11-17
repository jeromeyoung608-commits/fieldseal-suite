# Security Policy — FieldSeal Suite

_Last updated: 2026-11-15 · Applies to: v0.5 (released) and v0.4 (stable)_

## 1. Scope & Supported Versions

FieldSeal Suite is a **local-first, offline, zero-dependency** forensic capture + multi-party
countersign + unified-verification toolkit. There is **no backend, no cloud account, and no
automatic upload** in the main branch. This posture is intentional and is the primary security
property: the trusted root is always the locally produced, hash-bound case package.

| Version | Supported | Notes |
| --- | --- | --- |
| v0.5 (released) | ✅ active | additive case layer: operator identity / forensic note / witness / retention-hold / Bates / media redaction / multi-control (k-of-n) / geo attestation; BagIt OAIS export (packaging wrapper, non-trust) |
| v0.4 (stable) | ✅ active | Countersign + Encryption + Signature baseline |
| v0.3 / v0.2 | ⚠️ historical | accepted by current verifier for backward compatibility only |

> The optional **Aegis hash-anchoring hook** (v0.4+) and the optional **external RFC3161 TSA**
> (v0.5+) are *external* services. Aegis transmits **only** the hash string (`packageId`,
> `specVersion`, `rootHash`); the external TSA transmits **only** the textual `rootHash` and
> receives a timestamp token. Neither sends original media, signatures, notes or the ZIP. Both
> are off by default and **not** part of the trusted root; a misbehaving endpoint cannot alter
> evidence integrity. The TSA endpoint is selected by the operator and may be a third party
> outside the operator's jurisdiction. See `docs/EXTERNAL-TSA-DISCLOSURE.md`.

## 2. Reporting a Vulnerability

Please report suspected vulnerabilities **privately** — do not open a public issue.

- **Preferred:** use the repository's private security advisory ("Report a vulnerability" under
  Security → Advisories). This is the authoritative private channel and requires no email address.
- **No published PGP key:** do not send secrets or exploit details by plain email. If you need
  encrypted email, request a key inside the private advisory first. See `docs/security-contact.md`.

Include: affected version, a minimal reproduction, the trust boundary impacted, and suggested
severity. We acknowledge receipt within **2 business days**.

## 3. Disclosure Policy

We follow **coordinated disclosure**:

1. Reporter submits privately (§2).
2. We confirm and triage within 5 business days.
3. A fix and advisory are prepared; the reporter may review before public release.
4. Public disclosure only after a patch is available and deployed, or after a mutually agreed
   embargo (default **90 days**).

## 4. Response SLA (targets)

| Severity | Initial response | Fix / mitigation target |
| --- | --- | --- |
| Critical (integrity bypass, hash collision feasibility) | 2 business days | 14 days |
| High (verifier bypass on a configured path) | 5 business days | 30 days |
| Medium | 10 business days | 60 days |
| Low / informational | 20 business days | next release |

> "Integrity bypass" here means any path that lets a tampered case package verify as `ok`, or lets
> a `sealed` package be mutated without `tampered`. Such issues are treated as critical.

## 5. Trust Model & Threat Model

**What FieldSeal guarantees**

- Tamper-evidence: any modification to a captured evidence package, the case manifest, or the
  custody/audit log changes `rootHash`/`sealHash` and fails verification (`tampered`).
- Separation of duties: draft → pending_countersign → sealed is one-way; a sealed package is
  read-only.
- Local-first: no network call is made by capture, sealing, or verification.

**What FieldSeal does NOT guarantee (explicitly out of scope)**

- It is **not** a qualified electronic signature (eIDAS QES). The hand-drawn signature is a
  capture-confirmation mark, not a legal qualified signature.
- It does **not** attest the *truth* of captured content — only integrity and continuity of
  custody.
- Operator identity (`operatorProfile`) is a **local identity attestation by the operator**, not a
  CA-strong authentication. Downstream relying parties must verify identity independently
  (OSAC field-forensics convention).
- Device clock integrity is the operator's responsibility; an attacker who controls the device
  clock can influence logged timestamps. An optional NTP reference (v0.5+ roadmap) is advisory
  only and never overrides the native log time.

## 6. Hardening Guidance for Deployers

- Store evidence packages on write-once or access-controlled media.
- Use the `media-verify` helper (roadmap) to hash the delivery medium and keep a medium custody log.
- For independent verification, rely on the **golden test package** to confirm your verifier build
  matches the reference before trusting production output:
  `node cli/test/fixtures/golden/verify-golden.cjs` (genuine package → `ok`, deliberately altered
  copy → `tampered`). The v0.5 golden anchor is `cli/test/fixtures/golden/fieldseal-golden-v0.5-sealed.zip`.
- If you deploy the optional Aegis anchoring hook, run your own Aegis endpoint and ensure it
  enforces CORS and TLS; the endpoint never receives original evidence.

**v0.5 additive features (all tamper-evident; none weaken the v0.4 `sealHash` contract).** New
case-layer fields are hash-bound where they must be (`operatorProfile`, `witnessStatements`, `retention`,
and since the 2026-11-14 delivery audit also `operatorIdentity` / `humanNotes` — editing either after
seal now yields `tampered`); rootHash-only where they are additive presentation context (`bates`,
`envSnapshot`, `tsaTimestamps`). The multi-control gate (`requireApproval`) is a *pre-action
authorization* check, not a signature, and is a no-op unless a policy is configured (backward
compatible). The BagIt / OAIS export (`cli/bagit-tool.mjs`) is a **packaging wrapper** — it copies
`rootHash`/`sealHash` into `bag-info.txt` and provides OAIS fixity, but is **non-trust (Class B)** and
never substitutes for `case verify`.

**Release integrity & rollback (B-08).** The shipped binaries are covered by an **Ed25519 detached
signature** over `dist/SHA256SUMS` (`SHA256SUMS.sig` + `RELEASE-PUBLIC-KEY.pem`), verifiable fully
offline with Node built-ins — no GPG, no network. The release private key lives on the air-gapped
release machine and is **never** in the repository; `tools/release/release-tool.mjs` refuses to write
it inside the repo tree. Content-addressed snapshots provide backup / verify / restore / rollback;
restore and rollback are dry-run by default and always create a `pre-rollback` snapshot first. Trust
boundary: the signed manifest proves **the release artefacts were not substituted** — it says nothing
about the legal validity of a case, whose verdict still comes exclusively from `case verify`.
Runbook: `docs/RELEASE-ROLLBACK.md`; gate anchor: `S-23`.

**Optional custody services.** `receipt-agent` and `archive-agent` bind to `127.0.0.1` by default
(override with `BIND_HOST` only for a deliberately exposed, firewalled interface) and require a
Bearer token; `archive-agent` refuses to start without `ARCHIVE_SECRET`. `/health` stays open for
liveness checks. These services are Class C optional agents, never part of the trust kernel.

## 7. Cryptography

- Hash: **SHA-256** (`sha256:` URI scheme) for both `rootHash` and `sealHash`.
- No third-party crypto libraries in the trusted core (`cli/core`, `pwa/core`); only platform
  Web Crypto / Node `crypto`.
- Encryption (v0.4) uses the browser/Node native AES-GCM with a randomly generated,
  operator-held key; the key is never stored in the manifest.

## 8. Delivery audit closure (2026-11-14)

- **Local operation trail**: enabled by default (opt-out via `setLogEnabled(false)`),
  records actor / timestamp / action / target / authorisation / source, and seals each
  entry in a SHA-256 hash chain. `verifyChain()` detects edits or deletions; the sign
  page shows a persistent banner and offers a chain export. Deleting a case purges its
  trail entries and redacts surviving actor references. GDPR redaction masks package
  identifiers and drops timezone / tool / source fields while preserving the chain.
  Retention defaults to 365 days with an hourly sweep. No IP address is stored:
  a static page cannot obtain one reliably (see `pwa/legal/DATA-RESIDENCY.md`).
- **CSV formula injection**: all four `csvCell()` implementations neutralise cells
  starting with `= + - @` (leading whitespace included) before RFC4180 quoting.
- **ZIP / path handling**: ZIP extraction rejects `..`, absolute paths and empty
  segments; `cli/bin/serve.mjs` applies the same rule and binds `127.0.0.1` only.
  Malformed archive fuzzing is covered by `test-fuzz-inputs.mjs`.
- **Optional agents**: aegis, archive and receipt agents all default to loopback,
  require a Bearer secret and fail closed when it is absent. `/health` is the only
  unauthenticated endpoint.
- **Release integrity**: detached Ed25519 signature over `SHA256SUMS`, the private
  key generated outside the repository, offline verification with the bundled public
  key, content-addressed snapshots, dry-run-by-default restore/rollback, and an
  automatic `pre-rollback` safety snapshot. A real byte-corruption → rollback →
  re-verification rehearsal is recorded in `docs/RELEASE-ROLLBACK.md` §5.
- **Build supply chain**: `pkg` is pinned exactly (no caret) with a recorded
  `dist.integrity`; `doctor.mjs` enforces the pin. Build scaffolding is removed from
  the delivery tree. A `package-lock.json` is intentionally NOT shipped because the
  zero-dependency gate `S-06` rejects it (see `tools/build/BUILD-DEPENDENCIES.md`).
- **Diagnostics contain no personal data**: `doctor.mjs --bundle` includes only
  versions, paths and pass/fail results. Never attach real evidence packages to a
  support request.
- **Self-service legal artefacts**: `pwa/privacy.html` and `pwa/legal/*.md` ship the
  privacy notice, DPA template, support SLA, VPAT 2.5 EU self-assessment and the
  data-residency / no-subprocessor statement, all pre-cached for offline use.
  They are self-assessments and templates, not third-party certifications.
- **Explicit exclusions**: no eIDAS qualified signature, no automatic upload, no AI
  truth determination, no content moderation, no hosted service, no SSO/SCIM/SIEM.
