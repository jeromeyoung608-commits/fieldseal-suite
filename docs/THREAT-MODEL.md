# Threat Model — FieldSeal Suite

Version 1.0 · 2026-11-15 · FieldSeal Suite
Reference: 9.0 security item S1. Covers assets, entry points, trust boundaries, abuse cases
(including audit-log forgery, which is the historically weakest area).

## 1. Assets

- **A1 Evidence packages** — photos, signatures, notes, derived `rootHash`/`sealHash`.
  Confidentiality + integrity + admissibility are the value.
- **A2 Local operation trail (audit log)** — proves the tool behaved correctly. Integrity is
  the value; confidentiality is low (operator-local).
- **A3 Signing / anchor keys** — device signing key + TSA timestamp key. Integrity of the
  whole product depends on these never leaving the device.
- **A4 Exported handover packages** — the artefact handed to counsel / authority. Integrity
  + authenticity are the value.

## 2. Entry points

- Browser UI (`sign.html`, `backup.html`, `index.html`) — operator input.
- CLI (`cli/bin/*.mjs`) — operator + release engineer.
- Local agents (`serve.mjs`, optional NTP/scan agents) — bind `127.0.0.1` only.

## 3. Trust boundaries

- **T1 Device ↔ Publisher**: the publisher ships static files + offline binaries. There is
  **no publisher runtime**; the publisher cannot read customer data. This is enforced by
  architecture, not policy (no network egress in the trusted kernel — see SBOM).
- **T2 Operator ↔ Audit log**: the operator controls the device, so the log is trusted only
  up to "tamper-evident", not "attacker-proof". The anchor + TSA timestamp raise the bar.
- **T3 Verifier ↔ Export file**: a third party verifies a handover package. They must use a
  **trusted device/TSA public key supplied out-of-band**, never a key embedded in the file.

## 4. Abuse cases (and controls)

| # | Abuse case | Control | Residual |
|---|---|---|---|
| AB1 | Forge a signature with a private key stolen from the package | No private key ships; keys are device-bound, non-extractable (`audit-device-key.js`) | None — key never present |
| AB2 | Re-sign the audit log with a different key and pass verification | Verification uses a trusted spki, ignores the file's own key (`verifySignedExport`) | None |
| AB3 | Tamper the log and silently re-commit the anchor | Anchor is in a **separate IndexedDB store**; `checkChainOnBoot` verifies it; boot banner on mismatch | Device fully controlled → can rewrite both stores; mitigated by TSA (AB5) |
| AB4 | Ship an unsigned log and have tooling call it valid | `doctor --audit-log` reports `signature missing → fail` | None |
| AB5 | Tamper + re-anchor on a fully controlled device | TSA timestamp from a **separate key/store** (local) or **external RFC3161** (EP-001). Re-anchoring needs a fresh valid timestamp the attacker cannot mint | Local TSA: two non-extractable keys must both be compromised; external TSA: key not on device |
| AB6 | Supply-chain substitution of the release binary | Ed25519-signed `SHA256SUMS` + `verify-binaries.mjs` + reproducible build (`repro-build.mjs`) | Relies on protecting the release private key |
| AB7 | CSV/formula injection in exported logs | `core/format-csv.js` neutralises `= + - @` leading characters (`test-csv-injection.mjs`) | None |
| AB8 | ZIP path traversal on extract | `zip-stream.js` rejects `..`/absolute/unsafe entry names (`test-zip-slip.mjs`) | None |
| AB9 | XSS / `eval` in the PWA | No `eval`; strict CSP via `serve.mjs`; all dynamic content via text nodes | None |
| AB10 | Local agent bound to a public interface | `serve.mjs`/agents default to `127.0.0.1`; `doctor` warns on non-loopback `BIND_HOST` | Operator misconfiguration |
| AB11 | **Same-device re-sign** — attacker controls the device, re-signs log + anchor with the SAME device/TSA keys | Device signing key + TSA key are **two independent non-extractable keys in two separate IndexedDB stores**; `verifySignedExport`/`verifyAnchorStore` require BOTH; a fresh valid timestamp must be minted for any new anchor | Local TSA: two keys must both be compromised; reduced to "re-anchoring is detected as a new timestamp" — fully controlled device remains accepted residual (see §5) |
| AB12 | **TSA degradation / downgrade** — force the product into `off`/`local` to drop external anchoring | `externalTimestamp` failure THROWS (no silent fallback to a local token); a degraded export is recorded with `tsaDegraded:true` and `verifySignedExport` REJECTS it; `mode:'off'` is explicit and reported as "off", never "TSA ok" | Operator who controls config can choose `off`; detection = the export/anchor says "off", recipient sees no external anchoring |
| AB13 | **Anchor deletion** — delete the audit anchor store to hide tampering | `verifyAnchorStore` returns `no anchor committed`; `checkChainOnBoot` emits a warning banner; `doctor` flags it; a missing anchor during verification is itself a failure, not a pass | Attacker who deletes the anchor also removes the evidence — accepted residual for offline model; mitigated by exporting the signed log out-of-band (doctor verifies the export, not the live store) |
| AB14 | **Replay / stale export** — re-submit an old signed export as the current state | `verifySignedExport` accepts an optional `currentHead`; a stale export (head ≠ current live head) is flagged `stale/replayed`; the live anchor head is also compared | Requires the verifier to pass the current live head; for stored exports the chain is self-consistent by design (a historical snapshot) |

## 5. Out-of-scope / accepted risk

- **AB3/AB5 on a fully controlled device** is an accepted residual for the offline model:
  a tool with no backend cannot defend against an attacker who controls the whole device.
  The control is to make undetected tampering *hard* (dual-key anchor + external TSA option)
  and to make verification *independent* (out-of-band trusted keys). True non-repudiation
  for high-stakes matters should pair the export with an external TSA stamp (EP-001).
- State-sponsored endpoint compromise, physical coercion, and OS-level malware are outside
  the product's threat envelope.

## 6. STRIDE coverage (S1.1)

| STRIDE class | Concrete threat | Control | Test evidence |
|---|---|---|---|
| Spoofing | A different key signs an export as the device | Verifier supplies trusted SPKI out-of-band; file-embedded key ignored | `audit-acceptance.mjs` case ⑤; `key-distribution` tamper case |
| Tampering | Evidence file or audit entry changed after sealing | `sealHash` aggregation + per-entry hash chain; `case verify`/`doctor` fail | `ui-failure-matrix.mjs` E/H/I; `test-determinism.mjs` |
| Repudiation | Operator denies a sealed action | Append-only audit chain + local/external TSA anchor | `audit-retention.mjs`; `audit-acceptance.mjs` |
| Information disclosure | Case data leaves the device | No runtime egress; external TSA sends only the textual root hash, opt-in | `test-no-telemetry.mjs` static + 13-page browser zero external request |
| Denial of service | Huge ZIP / 10k entries / quota exhaustion | Size/count limits, ZIP64 bounded read, explicit quota errors | `test-scale.mjs`, `test-zip-slip.mjs`, `test-failure-paths.mjs` |
| Elevation of privilege | Web page reaches native files/keys | Browser sandbox; no private key export; CSP; no `eval` | `test-runner` S-07/S-08; browser flow |

## 7. LINDDUN privacy coverage (S1.1)

| LINDDUN class | Assessment | Control |
|---|---|---|
| Linking | Case and operator identifiers are local; no cross-session analytics ID | No telemetry; operator identity is optional |
| Identifying | Names, badge IDs, GPS and signatures are personal data | Stored locally; redaction and `redactPii` export option |
| Non-repudiation | Audit and signatures intentionally attribute actions | Purpose limitation documented in ROPA/DPIA |
| Detecting | Local observers can see that a case exists | OS-level access control; no publisher-side service |
| Data disclosure | Export is the disclosure boundary | Operator-controlled; DPA/data-residency docs |
| Unawareness | Operators may not know external TSA sends root hash | Explicit mode, UI notice, privacy statement |
| Non-compliance | GDPR rights / retention | `rights.mjs`, ROPA/DPIA, retention hold |

## 8. Attack tree (goal: alter sealed evidence without detection)

```text
Alter sealed evidence undetected
├─ Change a case file after sealing
│  ├─ rootHash/sealHash mismatch ............ blocked by case verify
│  └─ Recompute all hashes and re-sign ....... requires device key
├─ Change the audit log
│  ├─ Break chain ........................... blocked by hash chain
│  ├─ Re-sign with attacker key ............. blocked by out-of-band SPKI
│  └─ Re-commit anchor with same keys ....... needs separate TSA key + fresh token
├─ Delete the anchor
│  └─ Boot/doctor warning + export missing anchor = fail
├─ Replay an older valid export
│  └─ currentHead comparison flags stale/replayed
└─ Subvert the release
   ├─ Replace binary ........................ signed SHA256SUMS + reproducible build
   └─ Steal release private key .............. air-gapped key, out of repo
```

## 9. Side channels and supply chain (S1.1)

- Timing: hash comparison is not a secret-dependent branch; no password-oracle endpoint.
- Memory: private keys are non-extractable WebCrypto handles; no plaintext key in storage.
- Build: runtime has zero third-party dependencies; build-only tools are declared in
  `tools/build/BUILD-DEPENDENCIES.md` and excluded from the runtime SBOM.
- Distribution: Ed25519-signed `SHA256SUMS`, public key in `dist/`, private key never in repo.
