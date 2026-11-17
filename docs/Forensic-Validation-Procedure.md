# Forensic Validation Procedure — FieldSeal Suite

**Purpose:** Give an independent auditor, relying party, or court officer a deterministic,
reproducible way to verify a FieldSeal case package **without trusting the producing party**.
The procedure keeps the *producer* and the *verifier* strictly separated.

**Audience:** external auditors, legal counsel, court clerks, corporate compliance.
**Languages:** English only.

---

## 0. What you are verifying

A FieldSeal case package (`*.zip`) is a self-contained, hash-bound archive. Inside it you will
find, at minimum:

```
case-manifest.json        # the signed-by-hash case record (rootHash + sealHash)
evidence/                 # one or more standard evidence packages (each hash-bound)
case-report.html          # human-readable report (DISPLAY ONLY — not the trust root)
case-ledger.csv           # frozen v0.2 audit ledger (unchanged header)
case-ledger-extended.csv  # v0.5 EXTENDED ledger (operator / exhibit / jurisdiction / Aegis)
VERIFY.txt                # layout + instructions, written by the exporter
case-files.sha256         # sha256 of every exported file (covers attachments)
```

> **Trust root rule.** The trustworthy artifact is `case-manifest.json` + the `evidence/`
> packages. The HTML report and the CSV ledgers are *derived views* and must **never** be used to
> judge integrity. Always re-compute, never trust the printout.

---

## 1. Two independent verification paths (use at least one; both is best)

### Path A — Web verifier (zero install, air-gapped friendly)

1. Open `pwa/index.html` → **Verify Case** (or any FieldSeal PWA page with the verify panel).
2. Load the `*.zip` (drag-drop or file picker). The verifier runs entirely in your browser;
   **no file leaves your machine**.
3. Read the result badge:
   - `ok` — integrity intact, seals consistent.
   - `tampered` — something was altered after sealing; **reject**.
   - `invalid_spec` — the package does not conform to a known FieldSeal schema; **reject**.
4. Confirm the displayed `rootHash` and `sealHash` match the values printed on the supplied
   paper/PDF cover sheet.

_The web verifier runs entirely locally; no file leaves the device._

### Path B — CLI verifier (auditor's offline machine, no Node required if using the static binary)

```bash
# If you installed Node:
node cli/bin/audit.js case verify path/to/CASE.zip --json

# If you use the prebuilt static binary (Windows/macOS/Linux):
fieldseal-verify case verify path/to/CASE.zip --json
```

The output contains `coreResult` (`ok` / `tampered` / `invalid_spec`), `rootHash`, and
`specVersion`. Treat `tampered` and `invalid_spec` as a rejection.

### Path C — BagIt / OAIS long-term package (v0.5 additive export)

A BagIt v1.0 package is a **packaging wrapper, not a re-seal**: the case `rootHash` / `sealHash` are
copied verbatim into `bag-info.txt` and remain authoritative. Verify it in two layers:

```bash
# 1) OAIS fixity + completeness of the BagIt wrapper itself:
node cli/bagit-tool.mjs verify <bagDir>

# 2) the inner trust verdict (the authoritative one):
node cli/bin/audit.js case verify <bagDir>/data/case-manifest.json --json   # or unzip then verify
```

> The BagIt layer is non-trust (Class B): a valid BagIt fixity does NOT substitute for `case verify`.
> Always finish with Path A or B on the inner manifest.

---

## 2. Verifying the *verifier itself* (supply-chain trust)

Before trusting any production output, confirm your verifier binary/script is genuine:

1. **Golden package check.** Verify the bundled `cli/test/fixtures/golden/fieldseal-golden-v0.5-sealed.zip`
   with `node cli/test/fixtures/golden/verify-golden.cjs` (or `node cli/bin/audit.js case verify <zip> --json`).
   A correct verifier MUST return `ok` for the genuine package and `tampered` for a deliberately altered
   copy. The same verifier also validates `fieldseal-case-v0.4` (and the frozen v0.2 / v0.3) packages —
   those are covered by the regression suite, while the v0.5 golden is the downloadable, auditor-facing anchor.
2. **Checksum of the binary.** Compare the published SHA-256 of `fieldseal-verify` (in
   `releases/SHA256SUMS`) against your local copy.
3. **Reproduce from source.** The verifier is pure `cli/core` + `pwa/core` (zero dependencies);
   you can `git checkout` the tag and run the regression suite (`node cli/test/test-runner.js`)
   to confirm byte-for-byte identical sealHash behaviour.

> **Why this matters.** A compromised verifier could report `ok` on a tampered package. The golden
> package + open source + reproducible sealHash make such a compromise detectable.

---

## 3. Interpreting the result for court / tribunal

- `ok` means: the package is internally consistent; the recorded chain of custody has not been
  altered since sealing; each evidence sub-package matches its recorded `rootHash`.
- `ok` does **NOT** mean the evidence is *true* or *admissible*. Admissibility is decided by the
  relevant authority (see the per-jurisdiction notice inside `case-report.html`, selected at
  export time: US-FRE / Germany-ZPO / UK-Civil / General Audit).
- `tampered` is conclusive evidence of post-seal alteration and should be reported to the
  relying party immediately.

---

## 4. Operator identity & forensic notes (v0.5)

- `caseMeta.operatorProfile` carries the operator's local identity attestation (name / title /
  org / id). It is **hash-bound** — stripping or editing it yields `tampered`.
- `auditLog` entries of type `human_note` carry narrative forensic context (why collected, scene
  notes) with a UTC timestamp and the bound operator id; they are hash-bound and append-only.
- These are attestations by the operator, **not** a CA-strong authentication. Verify the person
  independently if identity is in dispute.

---

## 5. Quick checklist for the receiving party

- [ ] Verified with **at least one** independent path (A or B).
- [ ] Verifier itself confirmed via the **golden package** + binary checksum.
- [ ] `coreResult === ok`; `tampered`/`invalid_spec` → reject.
- [ ] `rootHash`/`sealHash` on the cover sheet match the verifier output.
- [ ] Jurisdiction notice read; local counsel consulted for admissibility.
- [ ] If Aegis anchoring was used, the anchoring receipt is retained separately as a corroborating
      record (not as the trust root).

---

## 6. Standard steps — sealing, verification, export, custody review, media handling

This section consolidates the end-to-end procedure and **separates field (on-site) actions from
laboratory (offline) review**, because the two carry different trust assumptions.

### 6.1 Field / on-site

1. **Capture & seal.** Collect media verbatim (ZIP STORE, no transcoding). Seal the case on the
   trusted PWA; the resulting `sealHash` is the sole source of trust. Until `sealed`, a case is
   **DRAFT ONLY** and has no evidentiary effect.
2. **Local backup (optional).** If encryption is enabled, the `.enc` snapshot is storage protection
   only and does **not** replace the `sealHash` check. Keep the original media physically secured.
3. **No media erasure before archive.** Do **not** sanitize the working media while the case is in
   `draft` / `pending_countersign`, or before the sealed package is verified and archived (see §6.5).
4. **Export a report (read-only).** `pwa/export/ase-export.js` produces a display-only report +
   two ledgers. It **never** recomputes or alters `sealHash`/`rootHash`. The trust baseline remains
   the native `sealHash`, verified separately with the CLI.

### 6.2 Laboratory / offline review

1. **Verify, don't trust the printout.** Re-run an independent verifier (Path A or B, §1). The HTML
   report and CSV ledgers are *derived views*; only `case-manifest.json` + `evidence/` are authoritative.
2. **Verify the verifier.** Confirm against the golden package — `cli/test/fixtures/golden/verify-golden.cjs`
   (read-only anchor: pinned `packageId` / `rootHash` / `sealHash`). A correct verifier returns `ok`.
3. **Chain-of-custody review.** Inspect `case-ledger.csv` (frozen v0.2 header) and, for audit context,
   `case-ledger-extended.csv` / the ASE `extended.csv`. Note: the extended fields — **NTP reference
   time, clock drift, device UA, capture timezone, note, encryption flag, countersign list** — appear
   **only** in the extended ledger; they are read-only display fields and are **not** part of any hash.
4. **Disposition.** Only after the sealed package is archived and the retention period is set may media
   be sanitized or destroyed, per §6.5.

### 6.3 Export step (read-only, display/transport only)

- `pwa/helpers/case-export.js` produces the standard case export (`case-manifest.json` + `case-report.html`
  + `case-ledger.csv` + `case-ledger-extended.csv` + `VERIFY.txt` + `case-files.sha256`);
  `pwa/export/ase-export.js` renders the **ASE Export Report**: a pinned EN/DE disclaimer, the
  read-only case identification, the Exhibit index (from `tools/exhibit-batch-export`), and two ledgers:
  - **base CSV** = the canonical `case-ledger.csv` (frozen header).
  - **extended.csv** = extended audit fields, read solely from the manifest (no computed fields).
- `pwa/export/print-export.css` gives print pagination, hides on-screen controls, and is black/white
  friendly. The export is a presentation artifact; it never becomes the trust root.

### 6.4 Custody review checklist

- [ ] Each `custodyLog` entry has actor, UTC (IANA), purpose, and item hash.
- [ ] No custody entry is missing; no post-seal custody edit exists (would be `tampered`).
- [ ] Exhibit IDs (`children[].exhibitId`) are present and match the Exhibit index.
- [ ] Operator identity (`caseMeta.operatorProfile`) and forensic notes are hash-bound and intact.

### 6.5 Media handling — NIST SP 800-88 aligned

Media sanitization follows graded Clear / Purge / Destroy (see **`docs/guidance/nist-800-88-erasure.md`**).
Hard rules for forensic context:

- **Never** sanitize the *original* working media while a case is `draft` / `pending_countersign`.
- **Never** sanitize media whose sealed package has **not** been verified (`case verify` → `ok`) and
  archived.
- Erasing working media **does not and must not** alter any sealed package; it is a post-archive,
  downstream activity recorded in the custody log.
- For SSD/flash, plain overwrite is insufficient (wear-leveling); prefer firmware secure-erase /
  ATA SANITIZE or physical Destroy. A "quick format" is **not** sanitization.

> Media handling is a post-archive custody event; it never touches the trust root.
