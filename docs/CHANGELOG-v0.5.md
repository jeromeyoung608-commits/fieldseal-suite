# Changelog — FieldSeal Suite v0.5 (controlled extension release)

All changes are additive. The frozen v0.2/v0.3 manifest schemas are unchanged; new fields are whitelisted by explicit `specVersion` and bound into `rootHash` / `sealHash` where they are trust-relevant.

## A. Trusted core and schema

- Added controlled v0.4/v0.5 fields to `pwa/core/case-manifest.js` (single source of truth; `cli/core/case-verify.js` imports it).
- `SPEC-case.md` §10.2.1 documents the new fields; unknown versions are rejected as `invalid_spec`, never guessed by field shape.
- Backward compatibility: v0.2 and v0.3 packages verify byte-for-byte; golden fixtures are frozen.

## B. UI and export layer

- Case detail: schema lock, encryption, countersign workflow, signature pad, sealed-state gating.
- Case export: preflight, ZIP builder, `case-files.sha256`, plaintext `case-manifest.json`, optional encrypted snapshot, attestation HTML/CSV.
- Service Worker precaches English legal documents and updated modules; cache version bumped.
- No hashing logic is added in the display/transport layer.

## C. Tests and gates

- Added case-layer v0.4/v0.5 regressions (C-37–C-53), export layout, tamper and CLI interop checks.
- Added browser harness checks for sealing, failure injection, keyboard access, zoom and contrast.
- Added `nine-oh.mjs` evidence ledger with artifact hashes.

## D. Documentation

- Repository documentation is English-only.
- Product UI ships in English only; German UI, German legal blocks and the language switch were removed on 2026-11-16.
- Legal set: `LICENSE`, `LICENSES/`, `NOTICE`, `EULA`, `PRICING`, `TRADEMARK`, `COMMERCIAL-LICENSE`.
- Language policy gate: `scripts/verify-bilingual.mjs` (prints `LANGUAGE-POLICY-OK`).

## E. Regression status at release

`test-runner` 143/143, `--full` 144/144, `audit-acceptance` 16/16, `pwa-tests` 28/28, `doctor` 16 checks (1 warning), `read-only-scanner` AUDIT-OK, `verify-licensing` PASS, `ui-browser-check` PASS. The 9.5 score remains blocked by external items, not by local gates.

## F. Presentation and packaging additions

- `pwa/export/ase-export.js` — print/PDF-ready AEGIS-style exhibit export (presentation only; excluded from hashes).
- `pwa/export/print-export.css` — print styles.
- `docs/guidance/nist-800-88-erasure.md`, `docs/SECURITY.md`, `fixtures/golden/`.
- `tools/pkg/` — packaging and unified entry point; does not re-implement core logic.

## G. v0.5 additive metadata (display-only, excluded from hashes)

- `caseMeta.operatorIdentity`, `caseMeta.humanNotes`, `caseMeta.envSnapshot`.
- Custody/audit timeline rendered as DOM, not canvas.
- GitHub companion docs: FAQ, quickstart, glossary.

## H. Court-admissibility aids

- RFC3161 TSA adapter (`pwa/vendor/tsa-timestamp.js`) with explicit offline CA-chain verification (`cli/verify/tsa-verify.js`); no hand-rolled ASN.1.
- ISO/IEC 27037 alignment and read-only checklist.
- GDPR PII redaction in export (presentation control; source case unchanged).

## I. Internationalisation

- Zero-dependency kernel `pwa/core/i18n.js`; product languages are EN and DE only.
- Static `[data-i18n]` markup is translated by the kernel; every dictionary key has both languages.

## J. Legal and responsibility handover

- TSA offline CA verification tool with honest boundaries: external RFC3161 is delegated to `openssl`, not reimplemented.
- P0 legality proof and responsibility handover set: controlled writes gated by `requireV05Action`; `draft` / `pending_countersign` writable, `sealed` refused.

## Archive note

The earlier bilingual and Chinese-language document sets were moved outside the repository on 2026-11-15. They are historical evidence, not part of the current release.
