# Privacy Notice / Datenschutzerklärung

*FieldSeal Suite v0.5 — Compliance Documentation*
*Sprache / Language: DE + EN*

---

## Privacy Notice

### Who is responsible?
FieldSeal Suite runs **entirely on your device**. There is no backend, no account and no
cloud. **You are the data controller** for any records you create. In the default off mode no
processor (Art. 28 GDPR) is involved, because no personal data leaves your device unless you
choose to export it to a file you control or enable an optional outbound mode (Aegis or
external TSA).

### What data is processed?
- **Case metadata** (titles, actors, notes, schema, chain-of-custody events, audit log) — stored locally.
- **Captured media** (photos, video, audio) — stored locally, **byte-for-byte**, never transcoded.
- **Device signals**: timestamp (UTC + IANA timezone), and GPS/location **only when you grant
  permission** and only for the capture you trigger. These signals may be inaccurate or altered.
- **Signatures** — drawn on a local canvas; the image stays on the device.
- **Camera / microphone** — used locally to capture evidence; nothing is streamed off-device.

### Where is it stored?
All data lives in the browser's **IndexedDB** (PWA) or on your local filesystem (CLI).
No analytics, no telemetry, no third-party SDKs, no cookies.

### Is anything transmitted?
**No transmission in default mode.** With everything off, FieldSeal Suite makes no network
request. If you explicitly enable one of the two optional, off-by-default outbound modes:
- **Aegis hash-anchoring** POSTs *only* the textual root hash, package id and spec version to
  a URL you provide;
- **external RFC3161 TSA** sends *only* the textual root hash to a TSA endpoint you provide
  and receives a timestamp token.
Neither mode sends the ZIP, media, signatures or notes. The external TSA endpoint may be a
third party and may be outside your jurisdiction; you select it and are responsible for the
transfer assessment. See `docs/gdpr-notes.md` and `docs/EXTERNAL-TSA-DISCLOSURE.md`.

### Your rights (GDPR Art. 15–21)
Because you control the storage, you exercise your rights directly: inspect your data in the
app, export it, or delete the case (soft-delete + manual local removal). There is no external
party holding a copy to correct or erase.

### Special category data (Art. 9)
Evidence may contain special category data. FieldSeal Suite does not assess this; the
controller must apply a lawful basis and minimise what is captured. See `docs/gdpr-notes.md`.

---

## Contact
This is a local tool with no operator. For security or compliance questions, refer to the
project repository and `docs/SPEC-case.md`.
