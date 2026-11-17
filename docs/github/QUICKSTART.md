# Quick Start — FieldSeal Suite

> EN: This guide is for field operators and first-time auditors. It is intentionally minimal.

## 1. What this is
FieldSeal Suite is a **local-first** forensic toolkit: capture evidence, get multi-party sign-off, and verify integrity — all offline, no cloud.

## 2. Three things to remember
1. **Never edit an exported package.** Integrity = the native `sealHash`. Any edit makes verification fail (`tampered`).
2. **Encryption ≠ proof.** A password or Aegis envelope protects storage, not the legal proof. The proof is `sealHash`.
3. **Metadata is context, not trust.** Operator identity, notes and device snapshot are audit context only — they are NOT part of any hash.

## 3. Capture in 5 steps
1. Serve locally and open the PWA: `cd pwa && python3 -m http.server 8123` → `index.html`.
2. Tap **Evidence Capture** (`capture.html`) → choose a case → capture photo/video/file.
3. Fill GPS, note, tags, operator identity (optional) and any human note.
4. Download `evidence.zip` — original bytes are stored **unchanged**.
5. Keep the file offline / on approved media.

## 4. Sign-off
Open `sign.html`, import `evidence.zip`, draw each party's signature, optionally sync offline, then **SEAL**. After SEAL the package is locked.

## 5. Verify anywhere
```
node cli/bin/audit.js verify ./evidence.zip            # evidence only
node cli/bin/audit.js verify ./signature-record.zip --linked ./evidence.zip
node cli/bin/audit.js case verify ./case.zip --json    # case package
```
`coreResult: ok` = intact. `tampered` = something changed. `needs_password` = encrypted container without a plaintext manifest.

## 6. Audit
Open `case-detail.html?id=<packageId>` → custody **DOM timeline** (click a node for details) → export report / `case-ledger.csv` / `extended.csv` / `VERIFY.txt`.

## 7. Disposal
Media sanitization follows NIST SP 800-88 (Clear / Purge / Destroy) — see `docs/guidance/nist-800-88-erasure.md`. Never sanitize the original working media while the case is draft or before the sealed package is verified and archived.

## 8. Need help
- FAQ: `docs/github/FAQ.md`
- Glossary: `docs/github/GLOSSARY.md`
- Security model: `docs/SECURITY.md`
