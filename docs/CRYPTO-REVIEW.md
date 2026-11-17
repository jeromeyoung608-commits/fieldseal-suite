# Cryptography Review — FieldSeal Suite

Version 1.0 · 2026-11-15 · FieldSeal Suite
Reference: 9.0 security item S3.

## 1. Principles

- **No hand-rolled cryptography.** Every primitive is the platform's: WebCrypto `SHA-256`,
  `Ed25519` (subtle), and Node `crypto` for release signing. No custom hash, cipher, or MAC.
- **Zero third-party crypto/zip/pdf libraries** in the trusted kernel (enforced by SBOM and
  the no-CDN gate; see `SBOM.md`, `doctor` static checks).
- **Domain separation** between hashes: `rootHash` (evidence payload) and `sealHash` (case
  manifest) are distinct canonicalisations; the audit chain uses a separate `prevHash`
  linkage. Keys are scoped: device signing key ≠ TSA timestamp key ≠ release signing key.

## 2. Hash chain

- Each audit entry: `hash = SHA256(canonical(body))`, `prevHash = previous.hash`, genesis
  `64×'0'`. `verifyChain()` recomputes every entry and checks linkage; any byte change
  breaks the chain. (`test-audit-chain.mjs`, `test-audit-anchor.mjs`.)
- Determinism: identical input + identical canonicalisation ⇒ identical `rootHash`/`sealHash`
  (`cli/test/test-determinism.mjs`).

## 3. Signing & anchoring

- **Device signing key**: generated on-device as `extractable:false` (WebCrypto non-
  exportable). The product ships **no private key**; possession of the installer grants no
  signing ability. (`audit-device-key.js`, `grep -R PRIVKEY pwa/` is empty — 9.0 A1.)
- **Verification**: `verifySignedExport(exported, trustedSpki)` verifies **only** against a
  trusted spki supplied out-of-band; the file's embedded `devicePubKey` is ignored. A
  swapped-key re-sign is rejected. (`audit-anchor.js`, `audit-acceptance.mjs`.)
- **TSA timestamp anchor**: a separate non-extractable key in its own IndexedDB store
  (`fieldseal-audit-tsa`) issues a timestamp token over the chain head; the anchor and
  export both carry it and verification requires the trusted TSA spki (`audit-tsa.js`).
  An external RFC3161 endpoint can replace the local TSA (`mode: 'external'`) for true
  third-party anchoring (EP-001).
- **Release signing**: Ed25519 detached signature over `dist/SHA256SUMS`, verified by
  `verify-binaries.mjs` + `release-tool.mjs verify-signature`. The release private key lives
  on the build machine, not in the product.

## 4. Attacks considered

- **Replay**: signatures cover the full head/hash, not a nonce, but the audit chain is
  append-only and the TSA token carries `genTime`; a replay of an old export verifies as
  authentic for that historical state (by design — it is evidence of a past state).
- **Substitution / swap key**: rejected (§3). 
- **Tamper + re-anchor**: detected unless the attacker controls both independent keys / the
  external TSA (§3, threat-model AB5).
- **Rollback of the manifest**: `sealHash` is itself committed into the audit chain, so a
  manifest edit is caught by the chain.

## 5. Key lifecycle

| Key | Generation | Extraction | Storage | Rotation |
|---|---|---|---|---|
| Device signing | on-device, first run | never (`extractable:false`) | IndexedDB `fieldseal-audit-devicekey` | re-enrol device |
| TSA timestamp | on-device, first run | never | IndexedDB `fieldseal-audit-tsa` | re-enrol device |
| Release signing | build machine | private on build machine only | HSM/release host | per release policy |

## 6. Review status

- Internal crypto review: **complete** (this document).
- Independent cryptographic review: **external dependency** (9.0 S2/S3 sign-off) — owner:
  external cryptographer, see `docs/RELEASE-CHECKLIST-9.5.md`. Not required for the
  software to function; required for 9.0 sign-off.
