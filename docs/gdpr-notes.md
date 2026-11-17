# GDPR Notes / DSGVO-Hinweise

*FieldSeal Suite v0.5 — Compliance Documentation*
*Sprache / Language: DE + EN*

> This document supports `docs/privacy-notice.md`. It explains, in plain terms, how the
> local-first architecture of FieldSeal Suite maps onto the GDPR. It is **not** legal advice.

---

## GDPR Notes

### Local-first by design
FieldSeal Suite has **no server, no account, no cloud and no third-party SDK**. Every record
is created and stored on the device (browser IndexedDB / local CLI). This single architectural
fact resolves most GDPR transfer and processor questions in the **default off** mode: **no
personal data is transmitted to any controller or processor** unless the user explicitly
exports a file they control or enables an optional outbound mode (Aegis or external TSA).

### Roles
- **You are the controller** (Art. 4(7), Art. 24 GDPR) for the records you create.
- There is **no processor** (Art. 28) in the default off mode — nothing leaves the device
  automatically.
- The optional, **off-by-default Aegis toggle** sends *only* a textual root hash, package id
  and spec version to a URL you configure. The optional, **off-by-default external RFC3161
  TSA** sends *only* the textual root hash to a TSA endpoint you configure. Neither sends
  media, signatures, notes or the package ZIP. Both are strictly opt-in. The TSA endpoint may
  be a third party and may be outside your jurisdiction; you select it and are responsible for
  the transfer/processor assessment. See `docs/EXTERNAL-TSA-DISCLOSURE.md`.

### Lawful basis (Art. 6)
A common basis is **legitimate interests** (Art. 6(1)(f)) for evidentiary preservation,
balanced against the data subjects' interests. Because the tool stores data locally and does
not share it, the impact on data subjects is limited. **Special category data** (Art. 9 —
e.g. health, biometric, relational) may appear in evidence; the controller must identify a
condition under Art. 9(2) and apply data minimisation. The tool does not classify data for you.

### Data minimisation & accuracy (Art. 5)
- Capture only what the case requires; schema fields are explicit and editable in draft.
- Timestamps and GPS are device-provided and may be inaccurate or altered — do not treat them
  as authoritative proof of time or place (see `docs/disclaimer.md`).

### Storage limitation & erasure (Art. 5(1)(e), Art. 17)
- The case lives in local IndexedDB. Deleting a case cascades to its child evidence packages.
- Export is a local download; retaining or deleting exported files is the controller's choice.
- There is no external copy held by the vendor to erase.

### International transfers (Art. 44–49)
None in the default off mode. If you enable Aegis, the only transfer is the hash metadata you
direct to your own endpoint. If you enable an external RFC3161 TSA, the only transfer is the
textual root hash to the TSA endpoint you select; that endpoint may be outside the EEA/UK and
may be a third-party recipient or sub-processor depending on your configuration. You are
responsible for the Art. 44 assessment (adequacy decision, SCCs or derogation).

### Accountability (Art. 5(2), Art. 30)
The tamper-evident chain of custody and audit log provide a verifiable record of who added
what, when (UTC+IANA) and under which schema — strengthening accountability without any cloud.

---

## Auditor checklist
- [ ] Confirm `cli/core` and `pwa/core` contain **zero** `require()` / `import` of npm or CDN packages (see `SBOM.md`).
- [ ] Confirm no telemetry, analytics or remote fetch in `pwa/` except the user-configured Aegis toggle and the optional external RFC3161 TSA call.
- [ ] Confirm neither outbound mode uploads media, signatures, notes or the ZIP.
- [ ] Confirm the offline Service Worker precaches only first-party assets.
