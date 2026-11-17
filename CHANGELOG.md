# Changelog — FieldSeal Suite

The detailed, evidence-bearing release record is `docs/CHANGELOG-v0.5.md`; gate logs are under
`reports/`. This root file is the short index.

## v0.5 — 2026-11-15

- Controlled extension (additive only): operator identity, forensic notes, witness statements,
  retention hold, Bates numbering, media redaction, k-of-n approvals, geo attestation, BagIt
  export. v0.2–v0.4 `sealHash` remains byte-identical.
- **Open-source relicense:** the project is now MIT-licensed (`LICENSE` + commercial notice).
  No commercial license is required to use, modify, deploy, redistribute or sell the code.
  `COMMERCIAL-LICENSE.md` / `PRICING.md` now describe **optional** support, integration,
  training and assurance services; they no longer grant or restrict any code right.
  `scripts/verify-licensing.mjs` now enforces four layers: MIT SPDX headers on every
  first-party source (including `pwa/vendor`), a MIT root `LICENSE`, a consistent
  seven-document legal set, and zero surviving references to the retired licence terms.
- Watermark unified at `FieldSeal Suite v0.5`; 14/14 footers include `License: MIT` + Ownership.
- Historical note: earlier drafts of this release used a restricted-use licence with
  commercial-use conditions. That model is **superseded** — the current licence is MIT.
- External RFC3161 TSA disclosed across licence, privacy, GDPR, DPA, ROPA and residency.
- Gates: 143/143 default, 144/144 full, audit-acceptance 16/16, doctor OK, licensing PASS,
  attribution 14/14, UI browser PASS.

## v0.4 — 2026-11-12

Dictionaries, batch edit, dual-hash watermark, snapshots, notes, recycle bin, four-layer
attribution. Additive; v0.2/v0.3 hashes preserved.

## v0.3 — 2026-11-12

Countersign, encryption, signature baseline, schema lock, contract A. See
`docs/RELEASE-NOTES.md` for the dated gate figures.

## Earlier

v0.2 case layer and v0.1 field evidence format; historical counts are preserved in
`docs/RELEASE-NOTES.md` and `reports/` and are not current status.
