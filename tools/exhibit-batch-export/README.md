# FieldSeal Suite — Batch Exhibit Index Exporter

> Optional add-on; never a hard dependency of the mainline. It **reads sealed case packages only** to build an index, never modifies a case, never recomputes `sealHash`, and never participates in any trust hash.

## Purpose

Walk a batch of FieldSeal CASE packages (`.zip`), assign **Exhibit numbers** to their evidence items, and produce an audit ledger (CSV + JSON). Use it to catalogue evidence across cases, print an Exhibit list, and hand it to a court or auditor.

## Running

```bash
node exhibit-batch.mjs --cases <dir-or-file> [<dir-or-file> ...] [--out <dir>]
                        [--prefix EXH] [--copy] [--no-csv] [--no-json]

# index every case under fixtures, output to ./out
node exhibit-batch.mjs --cases ./fixtures --out ./out

# custom prefix + hard-copy the original packages into the output directory
node exhibit-batch.mjs --cases /evidence/2026 --out ./ledger --prefix EVID --copy
```

## Exhibit numbering

- Format `EXH-00001` (default prefix `EXH`, five digits, auto-increment). `--prefix` changes the prefix, e.g. `EVID-00001`.
- **Unique and increasing within one batch**; a new batch may reset to 1.
- Numbers exist **only in the index ledger** and are never written back into any case manifest.

## Scope and status

- Indexes only `state === "sealed"` cases.
- `draft` / `pending_countersign` cases are **skipped** and marked `status=skipped` with a reason.
- Corrupt / non-ZIP packages are marked `status=error`; **no uncaught exception**, other packages continue.

## Index fields (CSV header / JSON columns)

`caseId, caseTitle, sealHash, sealedAt, exhibitNo, evidencePackageId, evidenceType, collectedAt, ntpReferenceTime, hashDigest, fileSize, status, note`

- `sealHash` / `hashDigest` (child `rootHash`) are **copied verbatim from the manifest**, never recomputed or re-aggregated.
- `ntpReferenceTime`: included when the case carries NTP reference time, otherwise empty; **never written into the case**.
- `fileSize`: stored bytes of the evidence child inside the case package (read-only, not recomputed).

## Outputs

- `exhibit-index.json`: machine-readable for external audit systems / import tools.
- `exhibit-index.csv`: directly readable by auditors (RFC 4180 quoting).
- `--copy`: hard-copies every selected case ZIP into the output directory; the original evidence package is never modified.

## Forensic risk notice

**This index is an audit-ledger aid only; the trust source remains each case's native `sealHash` / `rootHash`.** The tool does not verify case integrity, does not recompute hashes, and does not replace kernel verification (`cli/core/case-verify.js` is the trust entry). Every hash in the index comes from the case manifest; if the case itself is tampered, the index copies it faithfully. Any judicial or compliance reliance must be based on the native `sealHash` passing kernel `case verify`; the index is never an independent trust basis.
