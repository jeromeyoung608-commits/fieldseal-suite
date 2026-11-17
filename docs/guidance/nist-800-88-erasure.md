# Media Sanitization & Erasure Guidance — FieldSeal Suite (NIST SP 800-88 Rev.1)

**Document type:** Operational guidance for field forensic personnel. **This is NOT an erasure tool.**
**Document version:** 1.0 · **Date:** 2026-11-13 · **Languages:** English

> ⚠️ **Scope boundary:** This document provides *process guidance only*. It does **not**
> implement, script, or instruct the execution of any disk-overwrite, `dd`, `shred`, firmware
> secure-erase, or physical-destruction command. No executable code is contained herein. Every
> sanitization action must be carried out by a validated tool and a qualified operator under the
> responsible organization's documented procedure.

---

## 0. Purpose, Audience & Disclaimer

This guidance helps field operators, incident responders (IR), and evidence custodians
decide *how* to sanitize working media (SD cards, SSDs, HDDs, USB drives, phone local storage,
external forensic media, and evidence backup media) once the evidentiary copy has been sealed and
archived. It is aligned with **NIST Special Publication 800-88 Revision 1, "Guidelines for Media
Sanitization."** It is written to be usable alongside the FieldSeal Suite chain-of-custody workflow,
but it is **not** a substitute for the validation performed by a forensic laboratory or for the
legal requirements of the relevant jurisdiction.

- **EN:** This guidance is a reference for forensic process only. It does not replace forensic
  laboratory compliance validation, and legal requirements differ by jurisdiction. The operator and
  their organization remain solely responsible for selecting and validating the sanitization method
  actually applied. FieldSeal Suite and its authors accept no liability for any sanitization action
  taken, or not taken, on the basis of this document.

---

## 1. Relationship to the FieldSeal Chain of Custody

FieldSeal Suite produces *hash-bound* case packages (`*.zip`) whose integrity rests on
`sealHash` / `rootHash` computed inside the trusted kernel. Sanitization of working media is a
**downstream, post-archival** activity. The trust root never depends on the working media surviving
or being erased — once a case is `sealed` and the package is archived, the original working media is
no longer the source of truth. Erasing it does **not** and **must not** alter any sealed package.

| Phase | FieldSeal state | Media handling |
| --- | --- | --- |
| Capture | `draft` | Working media is live evidence source — **do not sanitize** |
| Countersign | `pending_countersign` | Still live — **do not sanitize** |
| Sealed & archived | `sealed` (package copied to archive) | Working media may enter sanitization workflow |
| Sanitization | post-archive | Follow this guidance; record in custody log |

---

## 2. NIST SP 800-88 Graded Sanitization Definitions

NIST 800-88 defines three outcome categories. Choose the *highest* category the situation
requires; a higher category subsumes the lower ones.

- **Clear** — Logical techniques to render data on the media inaccessible to a standard read
  interface (e.g., full overwrite via a validated tool, or a validated cryptographic-erase that
  renders the data unrecoverable without the key). Effective against a *standard* (non-lab,
  non-invasive) adversary. **Not** sufficient against a determined forensic laboratory with
  specialized equipment.
- **Purge** — More rigorous techniques (e.g., firmware-based secure erase / ATA SANITIZE, block
  erasure, or cryptographic erase where the key is destroyed) that render data recovery infeasible
  even for a laboratory using state-of-the-art means. Required before media is **reused** outside
  the controlling organization or released to an untrusted party.
- **Destroy** — Physical destruction that makes the media unusable and data unrecoverable (e.g.,
  shredding, disintegration, incineration, degaussing for magnetic media). Required when media is
  **retired / discarded** or when the highest assurance is mandated.

> **Note:** For *cryptographic erase* to count as Clear or Purge, the encryption key must be
> stored separately from the media and destroyed/rendered inaccessible. If the key lives on the
> same device, the erase is **not** effective.

---

## 3. Media-Type Adaptation

Sanitization effectiveness depends on the storage technology. Use the table as a starting
point; always confirm against the device vendor's sanitize guidance and your organization's
procedure.

| Media | Recommended category | Notes |
| --- | --- | --- |
| **SD / microSD flash** (capture cards) | Purge (crypto-erase) or Destroy | Controller-based secure erase is unreliable on cheap controllers; prefer Destroy for retirement. Never trust "quick format". |
| **USB flash drive** | Purge (crypto-erase) or Destroy | Same controller risk as SD; physical Destroy preferred at end-of-life. |
| **SSD (SATA/NVMe)** | Purge via ATA/NVMe SANITIZE / firmware secure-erase | Overwrite alone is **insufficient** (wear-leveling / spare area). Crypto-erase valid only if key is external. |
| **HDD (magnetic)** | Clear (validated overwrite) acceptable for reuse; Destroy for retirement | Degaussing + Destroy for disposal. Overwrite must meet the pattern/count required by your procedure. |
| **Phone internal storage** | Purge (vendor crypto-erase / factory reset with key discard) or Destroy | Treat as sealed device; do not attempt field overwrite. Document model & OS. |
| **External forensic media** (write-once archive) | Destroy if discarded; otherwise retain as archive | Usually *not* sanitized — it is the archive of record. |
| **Evidence backup media** | Retain; Destroy only at end of lawful retention | Do not sanitize while under retention period. |

---

## 4. Forensic Scenario Taboos (Do-Not)

- **Never** sanitize the *original* working media while a case is in `draft` or
  `pending_countersign` — it is still the live evidence source.
- **Never** sanitize any media whose FieldSeal package has **not yet** been verified as `sealed`
  and archived to the designated store.
- **Never** run ad-hoc, unvalidated overwrite/destruction against media that may still hold
  un-extracted evidence.
- **Never** assume a "quick format" or "factory reset" without key destruction is a sanitization —
  it is **not**.
- **Never** let sanitization of working media block or delay the sealing/archiving of a case.
- **Never** store the cryptographic-erase key on the same media being erased.

---

## 5. Chain-of-Custody Records: Before & After Erasure

Sanitization is a custody event. Record it like any transfer or access.

**Before erasure (mandatory):**
- Case/package reference(s) already archived (package ID, `sealHash`).
- Media identifier (serial / label / photo of label).
- Media type, capacity, and where it was used (which case/capture).
- Confirmation that the sealed package was verified (`case verify` → `ok`) and archived.
- Selected sanitization category (Clear / Purge / Destroy) and the *validated* tool/method name.
- Operator identity and timestamp.

**After erasure (mandatory):**
- Outcome (e.g., "Purge completed" / "Destroyed — shred bin #").
- Tool/method evidence (tool version, or destruction certificate / photo).
- Verification statement (e.g., "verified unreadable" or "physically destroyed").
- Operator identity, witness (if required), and timestamp.

---

## 6. Audit-Log Mandatory Fields (for the sanitization event)

If the sanitization event is logged into any audit system (including FieldSeal's audit
log as a non-evidence, reference-only entry), the following fields are required:

| Field | Description |
| --- | --- |
| `event` | `"media_sanitization"` (clearly distinct from evidence events) |
| `mediaId` | Stable identifier of the sanitized media |
| `mediaType` | sd / usb / ssd / hdd / phone / external / backup |
| `category` | `clear` / `purge` / `destroy` |
| `method` | Name + version of validated tool, or destruction descriptor |
| `relatedCaseIds` | Case/package IDs already archived (for traceability) |
| `operatorId` | Operator identity (subject to GDPR redaction if archived) |
| `verified` | `true` / `false` — post-erasure verification result |
| `timestampUtc` | UTC time of the event |
| `note` | Free-text context |

> **EN:** This is a *reference/operational* log entry, **not** an evidence artifact. It must never
> be presented as part of a sealed case package, and it does not affect any `sealHash` / `rootHash`.

| --- | --- |
| `mediaType` | sd / usb / ssd / hdd / phone / external / backup |
| `category` | `clear` / `purge` / `destroy` |

> `sealHash` / `rootHash`.

---

## 7. Not-Recommended Operations

The following are explicitly **not** recommended by this guidance:
- Relying on "quick format", "empty trash", or OS "delete" as sanitization.
- Running unvalidated, ad-hoc overwrite commands found on the internet against live or unknown media.
- Assuming SSD/flash overwrite (without controller support) achieves Purge.
- Storing the crypto-erase key on the media being erased.
- Sanitizing media before the sealed package is verified and archived.
- Treating sanitization as a substitute for the forensic laboratory's validation.
- Reusing media across unrelated cases without confirmed Purge.

---

## 8. References & Versioning

- NIST Special Publication 800-88 Revision 1, *Guidelines for Media Sanitization* (2014).
- Organization-specific sanitization SOP and tool validation records (authoritative over this doc).
- FieldSeal Suite `SPEC-case.md` (case lifecycle states: `draft` / `pending_countersign` / `sealed`).
- FieldSeal Suite `Forensic-Validation-Procedure.md` (verifying a sealed package).

This document is guidance only and carries **no executable code**. It must be read together with the
responsible organization's local laws, retention policy, and validated procedures.

