# ISO/IEC 27037 Alignment — FieldSeal Suite

> EN: How FieldSeal Suite maps onto ISO/IEC 27037:2012 *"Information technology — Security techniques —
> Guidelines for identification, collection, acquisition, and preservation of digital evidence"*. This is a
> self-assessment mapping for forensic labs / legal reviewers. It is **not** a conformance certificate.
> This mapping is a self-assessment aid; it is **not a conformance certificate**.

## Scope note
FieldSeal Suite is a **local-first capture + verification toolkit** aimed at the *field acquisition* stage
(first responder / on-scene). It is not a full laboratory evidence-management system. The mapping below
covers the clauses most relevant to on-scene acquisition and the integrity / chain-of-custody guarantees.

## Clause mapping

| ISO 27037 clause | FieldSeal mechanism | Status |
| --- | --- | --- |
| **6 Identification** — unique evidence ID, labelling | `evidenceId` / `packageId` per capture; optional stable **Exhibit** numbering (`tools/exhibit-batch-export`) in export only | ✅ Covered (Exhibit is display-only, never in hash) |
| **6** — case context | `caseMeta.title` / `caseReference`, `jurisdiction` | ✅ Covered |
| **7 Integrity** — protection from alteration | Native `rootHash` (per-evidence) + case `sealHash` (one-way, irreversible seal); verification with zero-dependency CLI | ✅ Covered |
| **7** — hash algorithm | SHA-256 (canonical, reproducible); `hashAlgorithm` recorded | ✅ Covered |
| **7** — independent verification | `cli/bin/audit.js verify` / `case verify` reproduce hashes without the original tool | ✅ Covered |
| **8 Acquisition** — forensically sound, hash at acquisition | Original media bytes stored **unchanged**; hash computed at capture (`capturedUtc`, `referenceNtpTime`, `deviceClockDrift`) | ✅ Covered (by design; no in-device write-blocker — acquisition is a *trusted* capture device) |
| **8** — environment context | `caseMeta.envSnapshot` (coarse device/browser context, no camera/MAC identifiers) | ✅ Covered (additive, non-trust) |
| **9 Storage** — secure, access-controlled | Optional `case-manifest.json.enc` (Aegis envelope, RSA-OAEP) for transport; **never** a substitute for `sealHash` | ⚠️ Optional / auxiliary |
| **10 Documentation — chain of custody** | `custodyLog` + `auditLog`, rendered as a DOM timeline (`pwa/helpers/audit-timeline.js`); multi-party countersign | ✅ Covered |
| **10** — who/when/why | each custody/audit entry carries actor, UTC time, IANA tz, purpose | ✅ Covered |

## Additive, NON-trust metadata (out of the hash contract)
`operatorIdentity`, `humanNotes`, `envSnapshot`, `tsaTimestamps` are deliberately **excluded** from
`rootHash` / `sealHash`. They are corroborating / audit context only and MUST NOT be treated as a trust
root. The authoritative integrity proof is always the native `sealHash`.

## Trusted timestamp (RFC3161) — non-repudiation aid
`caseMeta.tsaTimestamps` anchors the case `rootHash` at a user-selected TSA. It is **optional, off by
default, uploads only the `rootHash` string**, and is stored additive. Full X.509 CA-chain signature
verification of the TSA token is intentionally **out-of-kernel** (requires CA trust anchors) and must be
performed with an offline PKI tool before evidentiary reliance.

## Known limitations vs. ISO 27037 / court admissibility
- **No qualified electronic signature (eIDAS QES)** — the hand-drawn signature is an *acknowledgement
  marker*, not a qualified signature. EU court "strong evidence" weight may require QES.
- **Acquisition device trust** — integrity rests on the trusted capture device + native hashing; there is
  no hardware write-blocker abstraction (appropriate for a *source* capture tool, not a triage duplicator).
- **Identity binding** — `operatorIdentity` is additive metadata; strong cryptographic binding of the
  operator to the capture (smart card / PIV / CAC) is not implemented.
- **Long-term retention** — retention timers + GDPR redaction exist (`C-07`); WORM / immutable-ledger
  anchoring is out of scope of the local toolkit.

See `docs/SECURITY.md`, `docs/disclaimer.md`, and `pwa/export/ase-export.js` disclaimer block for the
full risk posture. Use the read-only generator `cli/verify/iso27037-checklist.js` to produce a
per-package readiness summary.
