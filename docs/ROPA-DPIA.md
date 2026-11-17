# Record of Processing Activities (ROPA) & DPIA — FieldSeal Suite

Version 1.0 · 2026-11-15 · FieldSeal Suite
Reference: GDPR Art. 30 (ROPA), Art. 35 (DPIA), Art. 5(1)(e) storage limitation.

> This document is the processing-activities record and a lightweight DPIA for the
> offline / self-hosted deployment model. It is deliberately conservative: where the
> publisher has **no technical means** to access customer data, that fact is stated as
> the primary risk control rather than a hypothetical one.

## 1. Processing activities (Art. 30)

| # | Activity | Purpose | Categories of data | Subjects | Recipients | Transfers |
|---|---|---|---|---|---|---|
| P1 | Capture of field evidence (photo/signature/notes) | Build a tamper-evident custody record for an incident | Audio/visual evidence, geolocation (optional), free-text notes, operator name | Data subject depicted in evidence; the operator themselves | None (local only) | None |
| P2 | Local operation trail (audit log) | Demonstrate integrity of the tool's own actions | Operator actions, timestamps, case ids | The operator | None (local only) | None |
| P3 | Export / handover packages (ZIP/PDF/CSV) | Transfer evidence to counsel / authority | Same as P1 + derived hashes | As P1 | Whoever the operator chooses to hand the file to | None by the software (operator-controlled) |
| P4 | UI preferences / flags | Local UX state | Theme, language, toggles | The operator | None | None |

**Legal basis** (Art. 6): the publisher does not determine purposes of P1–P3 — the
operator/customer does. The software is a tool; the publisher's own processing is limited
to P4 (consent / legitimate interest for local UX) and, if a support ticket is opened,
the correspondence the operator voluntarily sends. No special-category data is required
by the software; where evidence contains it, the operator is the controller.

## 2. Data minimisation & storage limitation (Art. 5)

- All data is created and stored **on the operator's device** (IndexedDB / localStorage /
  exported files). There is no publisher database.
- Default retention of the local operation trail: **365 days** (configurable), after which
  entries are pruned by `local-audit-log.js runRetentionSweep()` (see SPEC §2.3).
- No telemetry, no analytics, no crash reporting — there is nothing collected to retain.

## 3. DPIA (Art. 35) — screening

- **Use of new technology?** No — standard browser storage + offline crypto.
- **Large-scale special-category data?** Only if the operator chooses to record it; the
  software does not solicit it.
- **Systematic monitoring?** No continuous monitoring; capture is operator-initiated.
- **High-risk indicator?** The product *increases* data-subject protection by producing
  court-admissible, tamper-evident evidence; residual risk is the operator's handling of
  exported files (addressed by the handover guidance in `docs/OFFLINE-OPERATION.md`).
- **Conclusion:** a full DPIA is **not mandatory** for the software itself. If a customer
  deploys it for large-scale special-category processing, they should complete their own
  DPIA referencing this ROPA. Record retained for 5 years from last processing (Art. 30(5)).

## 4. Sub-processors (Art. 28(2))

**None by default.** The publisher operates no data-processing infrastructure for this
product, so it uses no sub-processor that touches customer data. If a customer enables the
optional external RFC3161 TSA mode, the TSA endpoint the customer selects may be a third-party
recipient or sub-processor depending on the configuration; the customer is the controller for
that transmission and must complete its own Art. 28/44 assessment. The publisher is not a
party to it. See `pwa/legal/DATA-RESIDENCY.md`, `pwa/legal/DPA-TEMPLATE.md` and
`docs/EXTERNAL-TSA-DISCLOSURE.md`.

## 5. Data-subject rights (Art. 12–22) — operational path

Implemented and demonstrable locally via `cli/bin/rights.mjs` and the in-app
"Data rights request" form (`sign.html`): access, rectification, erasure, restriction,
objection. Each request is logged with a received date and a **one-month** statutory
response deadline (Art. 12(3)); see `docs/RELEASE-CHECKLIST-9.5.md` item C2.
