# Applicability Assessment — GDPR / UK GDPR / CCPA-CPRA / eIDAS

Version 1.0 · 2026-11-16 · FieldSeal Suite v0.5 · Status: internal assessment (not legal advice)

## 1. Product posture

FieldSeal Suite is MIT-licensed, offline-first software. In default mode it has **no
publisher-operated service, no account, no telemetry and no cloud storage**. The person or
organisation that deploys it is the **controller** of the evidence it records. The publisher
does not receive personal data and therefore does not act as a processor for the default mode.

Optional outbound modes are **off by default** and send only the textual root hash:
Aegis hash-anchoring (operator-supplied URL) and external RFC3161 TSA (operator-supplied
endpoint). See `docs/privacy-notice.md`, `docs/gdpr-notes.md` and
`docs/EXTERNAL-TSA-DISCLOSURE.md`.

## 2. GDPR (EU 2016/679)

| Question | Assessment | Evidence |
|---|---|---|
| Is personal data processed? | Yes, if the operator records identifiable people, GPS, signatures or free-text notes | Privacy notice §"What data is processed" |
| Who is controller? | The deploying operator, not the publisher | Privacy notice §"Who is responsible" |
| Is there an Art. 28 processor? | Not in default mode; optional outbound endpoint is selected by the operator | DPA template; data-residency note |
| Lawful basis | Operator's responsibility (legal obligation, contract, legitimate interest, consent as applicable) | `docs/gdpr-notes.md`; ROPA/DPIA |
| Data subject rights | Inspect/export/delete locally; one-month internal target for operator response | `cli/bin/rights.mjs`; ROPA/DPIA |
| International transfer | Default none; optional external TSA may transfer only a hash, operator assesses | External TSA disclosure |
| Security | Local-only storage, device-bound non-extractable keys, signed audit trail | Threat model; security policy |

## 3. UK GDPR / Swiss FADP

The same controller/processor analysis applies. The product does not transfer data to the
publisher. Operators in the UK or Switzerland must make their own transfer assessment if they
enable an external TSA endpoint outside their jurisdiction.

## 4. CCPA / CPRA (California)

| Question | Assessment | Evidence |
|---|---|---|
| Is the publisher a "business" collecting personal information? | No: the publisher receives no consumer data from default use | Privacy notice; no telemetry test |
| Sale/share of personal information | None by the publisher; no analytics, cookies or third-party SDKs | `cli/test/test-no-telemetry.mjs` |
| Consumer rights (know/delete/opt-out) | Operator-controlled local data; the product provides inspect/export/delete | Privacy notice; rights CLI |
| Service provider / contractor | Not applicable to the publisher in default mode | This assessment |

Operators that qualify as a business under CCPA/CPRA remain responsible for their own notices,
verification and record-keeping. The product supplies the local controls; it does not sell or
share data.

## 5. eIDAS (EU 910/2014)

FieldSeal Suite creates a **local, device-bound signature and a SHA-256 sealHash**. It is
**not** a qualified electronic signature (QES), not a qualified trust service, and not a
qualified timestamp. The optional RFC3161 token is a transport timestamp from an
operator-selected TSA; whether it is qualified depends on that provider's status. The product
does not claim court admissibility. The UI risk notice and `docs/disclaimer.md` state this.

## 6. Conclusion

- **GDPR/UK GDPR/Swiss FADP:** operator is controller; no publisher processor in default mode;
  optional outbound hash-only modes are disclosed and off by default.
- **CCPA/CPRA:** publisher is not a business collecting consumer personal information in
  default mode; no sale/share; local rights controls exist.
- **eIDAS:** no QES/qualified timestamp claim; local signature is evidence-binding, not a
  qualified signature.

Legal counsel must confirm the operator's own role, lawful basis and any sector-specific rules.
This document is an engineering applicability assessment, not a legal opinion.
