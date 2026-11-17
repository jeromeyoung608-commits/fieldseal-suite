# FieldSeal Suite — Case Layer Specification

Version: 0.1 (this document)
Status: Proposed — does not modify the frozen `SPEC.md` (evidence-package layer).
Relationship: this layer is a **wrapper** above `fieldseal-evidence-v0.2`. Each capture still produces a standard evidence package; a *case* collects those packages plus custody/schema metadata and computes a top-level `sealHash`. `audit.js verify` remains the verifier for individual evidence packages; `audit.js case verify` verifies the whole case.

> The zero-dependency rule (C12) applies here too: `pwa/core` and `cli/core` use platform-native APIs only. `pwa/helpers/case-store.js` is a storage layer; its logic **never participates in hashing** (deleting the file must not break verification).

---

## 1. Design axioms

- A case is the single business root unit; one capture = one `fieldseal-evidence-v0.2` package belonging to the case.
- The single top-level trust source is `sealHash`; any post-seal change (schema / media / custody / audit log) fails verification.
- Draft-stage hashes are preview hashes only and carry no evidential force (reports are marked `DRAFT ONLY`).
- All times are stored as UTC plus an IANA timezone identifier; manual time edits are flagged in the audit log.
- Field layers: `global` (case-wide) and `item` (per capture/custody). Schema editing defines which fields exist; capture/custody dialogs fill values; the two entry points are isolated.

---

## 2. Case manifest (`fieldseal-case-v0.1`)

```json
{
  "spec": "fieldseal-case-v0.1",
  "packageId": "uuid-v4",
  "rootHash": "sha256:xxx",
  "hashAlgorithm": "sha256",
  "createdAt": "2026-11-12T10:00:00Z",
  "caseCreatedUtc": "2026-11-12T10:00:00Z",
  "caseOrigin": "standard | emergency",
  "emergencyCaptureUtc": null,
  "schemaSupplementedUtc": null,
  "state": "draft | pending-configuration | sealed",
  "schemaDef": {
    "metaTemplate": "forensic-investigator | compliance-auditor | legal-counsel | devops-security | blank | custom",
    "mode": "quick | full",
    "version": 1,
    "globalFields": [ { "key": "caseReference", "label": "Case Reference", "type": "text", "required": true } ],
    "itemFields":   [ { "key": "sceneZone", "label": "Scene Zone", "type": "text", "required": false } ]
  },
  "caseMeta": { "caseReference": "CASE-2026-001", "jurisdiction": "EU-DE" },
  "children": [
    { "evidenceId": "uuid", "packageId": "uuid", "rootHash": "sha256:xxx", "spec": "fieldseal-evidence-v0.2", "capturedUtc": "2026-11-12T10:01:00Z" }
  ],
  "custodyLog": [
    {
      "eventType": "Collected",
      "utc": "2026-11-12T10:01:00Z", "ianaTz": "Europe/Berlin",
      "actorName": "Alice", "actorTitle": "Forensic Investigator",
      "evidenceId": "uuid", "itemHash": "sha256:xxx",
      "itemValues": { "sceneZone": "Room A" }, "note": "", "gps": { "lat": "52.5200", "lon": "13.4050" }, "deviceRef": "device-1"
    },
    { "eventType": "Transferred", "utc": "...", "ianaTz": "...", "actorName": "...", "actorTitle": "...", "transferPurpose": "Transport", "scope": "all", "note": "" }
  ],
  "schemaChangeLog": [
    { "utc": "...", "ianaTz": "...", "operator": "Alice", "summary": "Added field custodianBadgeId", "added": ["custodianBadgeId"], "deleted": [], "schemaVersion": 2 }
  ],
  "sealHash": "sha256:xxx",
  "sealedAt": null
}
```

### Field rules

- `spec` is the literal `fieldseal-case-v0.1`.
- `rootHash`: `hashAlgorithm(canonical(case-payload \ {rootHash, sealHash}))` (same rule as C3).
- `hashAlgorithm`: `sha256` (default) or `sha3-256` (evidence-layer extension; platform crypto on both CLI and PWA, no hand-written primitive).
- `state`: see §4 state machine.
- `schemaDef.globalFields[]` / `itemFields[]`: each `{ key, label, type, required, options? }`; `type ∈ text | datetime | boolean | select`; `key` matches `^[A-Za-z][A-Za-z0-9_]*$`.
- `caseMeta`: current global field values (data only, not schema definitions).
- `children[]`: referenced evidence packages (each a `fieldseal-evidence-v0.2`).
- `custodyLog[]`: chronological custody events (Collected / Transferred / Reviewed / Sealed / Unsealed / Archived / Destroyed).
- `schemaChangeLog[]`: schema-change audit (UTC / timezone / operator / summary / added-deleted keys / new version).
- `sealHash`: see §3; `sealedAt` is null until sealed.

---

## 3. sealHash aggregation (single top-level trust source)

```
sealInput = canonical({
  schemaDef,
  caseMeta,
  childrenRootHashes: children.map(c => c.rootHash),   // preserve capture order, never sort
  custodyLog,
  schemaChangeLog,
  state
})
sealHash = hashUri(sealInput, hashAlgorithm)
```

- Draft-stage `sealHash` may be previewed, but reports must say `DRAFT ONLY — NOT EVIDENTIARILY CERTIFIED`.
- Sealing freezes `sealHash`; any later change makes recomputation diverge → verification fails.
- `rootHash` (wrapper) and `sealHash` (aggregate trust) are computed separately. `case verify` checks both and verifies every child package.

---

## 4. State machine (strict validation)

| State | Meaning | Allowed operations |
| --- | --- | --- |
| `draft` | standard draft, schema configured | capture, add/remove media, edit schema, append custody, **seal** |
| `pending-configuration` | emergency capture; media frozen first, role/business fields missing | **capture (no schema dependency)**, add configuration, edit schema; **seal button disabled** |
| `sealed` | sealed | everything locked: schema / media / custody / audit log; `sealHash` fixed |

Transitions:

- Standard creation → `draft` (schema already configured).
- Emergency capture → `pending-configuration` (media first, no schema), repeatable.
- `pending-configuration` + configuration (`supplementSchema`) → `draft`, writing a `schemaChangeLog` entry with `Created via Emergency Capture, metadata supplemented at {UTC + IANA}`; **historical `itemValues` and children are preserved, never rewritten**.
- `draft` → `sealed` (`sealCase`, only when not pending).
- Any write on `sealed` throws.

> Emergency capture has an empty `schemaDef`; the dialog records media plus base metadata (UTC / IANA / operator / GPS / note) and renders no item fields. New captures after configuration use the new schema. This guarantees "freeze first, add metadata later" never loses frozen evidence.

---

## 5. Schema editing and version migration (NIST traceability)

- Every schema change appends a `schemaChangeLog` record (UTC / timezone / operator / summary / added-deleted keys / `schemaDef.version+1`).
- New global field: historical `custodyLog` entries stay empty for that field; reports mark `Field added after capture`.
- New item field: historical items stay empty; new captures work normally.
- **Deleting a field never erases historical data**; only the new-entry UI is closed; the deletion is audited; exported reports can still reconstruct historical values.
- Migration: case storage carries `schemaDef.version`; loading an older version upgrades by the migration table (only v1 today; no destructive migration).

---

## 6. Export artefacts

1. **HTML audit report**: full custody chronology, schema-change log, GPS, media thumbnails, field-addition markers, `sealHash`, hash algorithm, case-creation path id, Custodian Attestation block (draft greyed out and marked DRAFT ONLY).
2. **CSV audit ledger**: header `record_utc, record_type, actor_name, actor_title, transfer_purpose, evidence_item_id, item_hash, schema_change_note, case_reference, seal_hash`.
3. **Case export**: directory or ZIP with `case-manifest.json` at the root and child evidence packages at `evidence/<packageId>.zip`; importable into `case verify` for one-shot hash verification.

> Local persistence: each capture's evidence ZIP is stored in the `evidence-packages` object store of `pwa/helpers/case-store.js` keyed by `<packageId>` (`{ packageId, caseId, blob, size, createdAt }`). The store is **storage only** and never participates in hashing. Export writes `evidence/<packageId>.zip`, one-to-one with `children[].packageId`. Deleting a case cascades to its child packages, leaving no orphans.

---

## 7. Boundary with the frozen SPEC

- This document **does not modify** any field in `SPEC.md`; `fieldseal-evidence-v0.2` / `fieldseal-bundle-v0.1` are inherited unchanged.
- `caseMeta` / `custodyLog` / `schemaChangeLog` / `schemaDef` are case-layer keys and never enter any evidence/signature manifest.
- Each child evidence package is still verified independently by the frozen SPEC verifier; the case layer only aggregates and owns the top-level `sealHash`.

---

## 8. Verification rules (`cli case verify`)

1. Read `case-manifest.json` and check the supported `spec`.
2. Recompute `rootHash` and compare (C3).
3. Recompute `sealHash` and compare (§3).
4. For each `children[]`: locate `evidence/<packageId>.zip`, run the existing `verifyCore.verifyPackage`, require `ok`, and require the returned `rootHash` to match.
5. State consistency: if `state === 'sealed'`, `sealHash` and `sealedAt` must be non-empty.
6. Top-level output: `coreResult: ok | tampered | invalid_spec`; plus `packageType: "case"`, `sealHash`, and per-child results.
7. Priority: `invalid_spec` > `tampered` > `ok`.

---

## 9. Export implementation contract (Phase 4)

Implementation lives in `pwa/helpers/case-export.js` (presentation/packaging only; **it computes and rewrites no hashes**, only reads the fixed `rootHash` / `sealHash`; deleting the module must not break verification).

Export ZIP entries (fixed order; paths are exactly what the verifier looks up):

| Entry | Content |
| --- | --- |
| `case-manifest.json` | verbatim case wrapper (with `rootHash` / `sealHash`) |
| `evidence/<packageId>.zip` | the original frozen `fieldseal-evidence-v0.2` package per child, **byte-for-byte**, never re-hashed |
| `case-report.html` | English Custodian Attestation report (draft greyed out `DRAFT ONLY`, sealed black, emergency highlighted) |
| `case-ledger.csv` | CSV ledger with the §6 header |
| `VERIFY.txt` | self-contained `rootHash` / `sealHash` / per-child hashes / `case verify` command / trust model / EN-DE disclaimer |

Constraints:

- The layout must make `node cli/bin/audit.js case verify <case.zip> --json` return `ok` (C-22 regression).
- Any post-seal change to bound data (child bytes / `caseMeta` / `custodyLog` / `schemaDef`) must make re-verification return `tampered` (C-23).
- `preflightCaseExport` checks that every child package exists; a missing package blocks export; draft export is forcibly marked `DRAFT ONLY`.
- Front-end verification in the report and export panel reuses the `verifyCase` kernel (same source, no fork); per-child verification reads the frozen package's `manifest.json` and recomputes `rootHash`.

### 8.1 BagIt / OAIS long-term archive package (v0.5 increment, zero dependency)

- `buildBagitZip(c, packages, extra)` (`helpers/case-export.js`) produces a BagIt v1.0 structure packed as one `.zip`: `bagit.txt` / `bag-info.txt` / `manifest-sha256.txt` / `tagmanifest-sha256.txt` / `data/case-manifest.json` / `data/case-report.html` / `data/case-ledger.csv` / `data/case-ledger-extended.csv` / `data/VERIFY.txt` / `data/evidence/<packageId>.zip` (when packages are supplied) / `data/attachments/*`.
- BagIt is a **packaging wrapper, not a re-seal**: the case `rootHash` / `sealHash` are written verbatim into `bag-info.txt` as `FieldSeal-Root-Hash` / `FieldSeal-Seal-Hash` and remain authoritative. Export re-verification is still decided by `node cli/bin/audit.js case verify`; BagIt only provides OAIS-style fixity (manifest + tagmanifest) and completeness.
- Offline verification: `verifyBagitFiles(fileMap)` (pure, zero dependency); Node `cli/bagit-tool.mjs pack <case.json> [outDir]` writes a real BagIt directory; `verify <bagDir>` recomputes fixity and completeness offline (tampered payload/tag or missing file fails).
- UI: a `BagIt-Archiv / long-term archive` button at the bottom of `case-detail.html` downloads a BagIt `.zip` containing metadata and evidence binaries.
- Trust stance: additive non-trust wrapper; never enters `rootHash` / `sealHash`.

---

## 10. Countersign, encryption, schema lock (v0.3 Core Baseline)

> **Release marker: v0.3 Core Baseline (Countersign + Encryption + Signature)**. This section constrains only the case wrapper layer; the frozen `fieldseal-evidence-v0.2` child packages, `SPEC.md`, and the `cli case verify` entry and decision flow are unchanged. Zero runtime dependencies, Vanilla JS, browser-native APIs only; no CDN / npm / WASM / external binaries / automatic upload.

### 10.1 State machine (one-way, irreversible)

```
draft ──────────────► pending_countersign ──────► sealed
  │                                                  ▲
  └──────────────────────────────────────────────────┘   (v0.2 single-party direct seal, retained)
draft ─► pending-configuration ─► draft                  (v0.2 emergency capture, retained)
sealed ─► any state                                      FORBIDDEN
```

- `CASE_STATES = ['draft', 'pending-configuration', 'pending_countersign', 'sealed']`; the workflow states are `WORKFLOW_STATES = ['draft', 'pending_countersign', 'sealed']`. `pending-configuration` is the v0.2 emergency state and **must be kept** for full legacy compatibility.
- Under `pending_countersign`: original media, `schemaDef`, `caseMeta`, `children`, and `custodyLog` are all read-only; only countersign records (`COUNTERSIGN_ADD`), remarks, hand-drawn signatures (`SIGNATURE_RECORDED`), and `Seal Final` are allowed. Every append recomputes `rootHash` / `sealHash` and writes an audit event.
- Under `sealed`: **all** write paths (capture, custody, schema, schema lock, encryption/decryption changes, countersign) are refused; `verifyCase` returns `tampered` for any change to bound fields.

### 10.2 New manifest fields (all enter the hash)

| Field | Type | Meaning |
| --- | --- | --- |
| `schemaLocked` | boolean | schema lock; when true `changeSchema` / `supplementSchema` are refused |
| `countersignList[]` | array | `countersignId, utc, ianaTz, actorName, actorTitle, actorOrg, decision, remark, signatureDataUrl`; `decision ∈ {Approve, Object}` |
| `caseEncryptionMeta` | object \| null | `spec, algorithm, kdf, iterations, saltB64, ivB64, authTagB64, ciphertextSha256, plaintextRootHash, plaintextSealHash, cipherFile, encryptedAtUtc, note` |
| `auditLog[]` | array | `eventId, eventType, timestampUtc, ianaTimezone, caseStateBefore, caseStateAfter, payload, operatorNote` |

- All new fields automatically enter `rootHash` (`computeRootHash` canonical-hashes the entire payload).
- `computeSealHash` uses **conditional extension**: only when the manifest declares any of the above fields does it append `v03 = {schemaLocked, countersignList, caseEncryptionMeta, auditLog}` to the aggregate input. Therefore **v0.2 export `sealHash` stays byte-identical**, and `cli case verify` keeps returning `ok` without changes.
- Tampering with any of `countersignList` (including signature PNG dataURL), `caseEncryptionMeta`, `schemaLocked`, or `auditLog` → `tampered`.
- `signatureDataUrl` must use the `data:image/png;base64,` prefix; report rendering applies a prefix allowlist.

#### 10.2.1 v0.5 controlled extension fields (additive, backward compatible)

> v0.5 adds one **version marker** `specVersion: 'fieldseal-case-v0.5'` and folds the fields below into the existing §10.2 extension mechanism. **The hash algorithm, the `invalid_spec > tampered > ok` priority, and the v0.2/v0.3/v0.4 child and sealing logic are unchanged.** v0.4 and earlier packages without these fields verify normally; deleting any field changes `rootHash` → `tampered` (C-51/C-52).

| Field | Location | Type | Meaning |
| --- | --- | --- | --- |
| `operatorProfile` | `caseMeta.operatorProfile` | object \| undefined | investigator identity declaration; `{ operatorName, operatorTitle, orgId, operatorId }`, all strings, optional; writable in `draft` / `pending_countersign`, read-only in `sealed` |
| `human_note` | `auditLog[].eventType` (new enum) | — | human note audit event; item `payload.noteText`(string), `payload.jurisdictionContext`(string), `payload.operatorId`(string); UTC added automatically; forbidden in `sealed` |
| `exhibitId` | `children[].exhibitId` | string \| undefined | exhibit number (e.g. `A-1` / `B-2`); optional; uniqueness not enforced inside a case (UI hint only); enters `rootHash` |
| `consentRecord` | `caseMeta.consentRecord` | object \| undefined | lawful basis / consent (GDPR Art.6(1) / US legal compulsion); `{ basis, authorityRef?, consentBy?, basisDetail?, notedAt, operatorId? }`; `basis ∈ {consent, legalCompulsion, publicInterest, contractual, vitalInterest, other}`; writable in `draft` / `pending_countersign`, read-only in `sealed`; **hash-bound** |
| `affidavit` | `caseMeta.affidavit` | object \| undefined | affidavit / statutory declaration; `{ declarant, declarantTitle?, jurisdiction?, statements[], declaredAt, operatorId? }`; `statements` is a non-empty string array; **hash-bound**; reports cite `sealHash` |
| `recipient` | `custodyLog[].recipient` | object \| undefined | transfer receipt acknowledgement; `{ name, title?, org?, acknowledged, signatureSha256?, receivedAt }`; appended as a `Transferred` custody event by `recordTransferReceipt`; **hash-bound** (custodyLog enters `sealHash`) |
| `bates` | `caseMeta.bates` | object \| undefined | Bates numbering configuration (US litigation); `{ enabled, prefix?, next? }`; **non-trust** (excluded from `rootHash`/`sealHash`), configuration only |
| `batesId` | `children[].batesId` | string \| undefined | per-item Bates number (e.g. `FS-00001`), assigned by `assignBates`; enters `rootHash` only (same as `exhibitId`, not `sealHash`) |
| `witnessStatements` | `caseMeta.witnessStatements` | object[] \| undefined | formal witness endorsement; `{ witnessName, witnessTitle?, statement, witnessedAt, operatorId? }`; **hash-bound** (`rootHash`/`sealHash`) |
| `retention` | `caseMeta.retention` | object \| undefined | retention / legal hold; `{ legalHold, policy?, holdUntil?, holdReason?, notedAt, operatorId? }`; `legalHold` is a legal state; **hash-bound** (`rootHash`/`sealHash`) |
| `mediaRedactions` | `mediaRedactions` (top level, not `caseMeta`) | object[] \| undefined | media redaction derivative record; `{ evidenceId, region{x,y,w,h}, method, originalSha256, redactedSha256, redactedAt, operatorId? }`; **`rootHash` only (outside `sealHash`)**; original evidence never changed, dual digests recorded |
| `approvalPolicy` | `approvalPolicy` (top level) | object \| undefined | multi-person / dual-control approval policy; `{ requiredK(≥2), totalN(≥requiredK), actions['seal'\|'export'\|'transfer'], setAt, operatorId? }`; **`rootHash` only**, hard gate; no-op when absent (backward compatible) |
| `approvals` | `approvals` (top level) | object[] \| undefined | approval records; `{ action, approverId, approverName?, method['operatorProfile'\|'certificate'\|'externalIdP'], proof?, approvedAt }`; **`rootHash` only**; once `requiredK` distinct approvers exist, `approvalStatus[action]='authorized'` |
| `approvalStatus` | `approvalStatus` (top level) | object \| undefined | derived authorization state; `{ [action]: 'pending' \| 'authorized' }`; not hashed (derived from `approvals`, written to freeze state) |
| `geoAttestations` | `geoAttestations` (top level) | object[] \| undefined | location attestation; `{ latitude[-90,90], longitude[-180,180], accuracyMeters(≥0), source?, method['gps'\|'network'\|'cell'\|'manual'], linkedAction?, linkedRef?, attestedAt }`; **`rootHash` only**, factual location statement, not cryptographic positioning |

- Hash binding: `operatorProfile` inside `caseMeta` enters both `rootHash` and `sealHash` (top-level `caseMeta` participates in the seal aggregate); `children[].exhibitId` enters `rootHash` (child references participate in the whole-payload hash) but not the `sealHash` aggregate (children are aggregated by `rootHash` only, preserving v0.4 bytes); `human_note` inside `auditLog` enters both; `consentRecord` / `affidavit` / `witnessStatements` / `retention` inside `caseMeta` enter both; `custodyLog[].recipient` (a `Transferred` event appended by `recordTransferReceipt`) enters both (custodyLog participates in the seal aggregate).
- `rootHash` only (outside `sealHash`, marked as derivative): `mediaRedactions` is top-level, not in the seal aggregate (same dual-digest derivative model as `watermarkConfig`); `children[].batesId` enters whole-payload `rootHash` but is excluded from `sealHash` (same as `exhibitId`); `approvalPolicy` / `approvals` / `approvalStatus` / `geoAttestations` are top-level, enter `rootHash` but not the seal aggregate — so approval and location records are **tamper-visible (`rootHash` changes) without breaking v0.4 `sealHash` byte compatibility**.
- Non-trust (excluded from both): `bates` numbering state; `operatorIdentity` / `humanNotes` / `envSnapshot` / `tsaTimestamps` display/corroboration metadata.
- The v0.5 branch of `computeSealHash` **reuses the v0.4 aggregate field set** (`V04_AGGREGATE_FIELDS`) and introduces no new seal fields, so v0.4 sealed packages keep byte-identical `sealHash`.
- State machine: `operatorProfile` / `exhibitId` / `human_note` are writable only in `draft` / `pending_countersign` (`requireMutable` + `V04_PENDING_WRITES`); all writes are refused in `sealed` (C-53).
- Format validation (`validateCaseManifest`, in `pwa/core/case-manifest.js`, the same module dynamically loaded by `cli/core/case-verify.js`): `operatorProfile.*` must be strings, `exhibitId` must be a string, `human_note` must carry a `payload.noteText` string; otherwise `invalid_spec` (C-54).
- Controlled write functions: `bindOperatorProfile(c, profile)` / `addHumanNote(c, note)` / `setExhibitId(c, evidenceId, exhibitId)` / `bindConsentRecord(c, record)` / `bindAffidavit(c, affidavit)` / `recordTransferReceipt(c, receipt)` / `configureBates(c, cfg)` / `assignBates(c, evidenceId)` / `addWitnessStatement(c, stmt)` / `setRetention(c, cfg)` / `addMediaRedaction(c, redaction)` / `setApprovalPolicy(c, cfg)` / `recordApproval(c, approval)` / `recordGeoAttestation(c, geo)`, all gated by `requireV05Action` (requires v0.4+ and not sealed). `recordTransferReceipt`'s `recipient` block is appended with the `Transferred` custody event; `addMediaRedaction` writes dual-digest derivative records to top-level `mediaRedactions`; `setApprovalPolicy` / `recordApproval` / `recordGeoAttestation` write top-level `approvalPolicy` / `approvals` (+ derived `approvalStatus`) / `geoAttestations`.
- Multi-person control is a **hard gate**, distinct from countersign (soft endorsement): `requireApproval(c, action)` is called before `sealCase('seal')` / `recordTransferReceipt('transfer')` and before export UI actions (`openBackupDialog` / `doBagitExport` `'export'`). When a policy is active and not `authorized`, it throws and blocks the action. Without a policy it is a no-op and does not break existing flows. Approver identity is **metadata** (no cryptographic signature required; eIDAS QES is explicitly out of scope); `method` records the binding mode (`operatorProfile` / `certificate` / `externalIdP`).

### 10.3 Unified audit log

`AUDIT_EVENT_TYPES = SCHEMA_LOCK | SCHEMA_UNLOCK | CASE_ENCRYPT | CASE_DECRYPT | COUNTERSIGN_ADD | SIGNATURE_RECORDED | COUNTERSIGN_SENT | CASE_SEALED` (eight types fixed in v0.3; **v0.5 adds `HUMAN_NOTE`**). UTC + IANA timezone; `caseStateBefore/After` records state transitions. Audit events also go into `case-ledger.csv` using the existing header (`record_type = eventType`), **without adding CSV columns**, preserving the v0.2 ledger contract. Events are written only when the manifest already declares an `auditLog` array, so pure v0.2 objects get no structural change.

### 10.4 Schema lock

`setSchemaLocked(c, locked)` is available only in `draft` / `pending-configuration`; in `pending_countersign` / `sealed` the UI is greyed out with a uniform tooltip (DOM nodes are never removed). Lock/unlock writes an audit event and recomputes hashes. The report header and `VERIFY.txt` show the lock state.

### 10.5 Storage encryption (AES-GCM-256 + PBKDF2-SHA256)

- `pwa/helpers/case-crypto.js`: PBKDF2-SHA256 **100000** iterations, 16-byte salt, 12-byte IV, 128-bit authTag stored separately (`authTagB64`); ciphertext is byte-level encryption of `JSON.stringify(case-manifest snapshot)`.
- **Encryption ≠ sealing**: it protects a stored copy only; it **does not replace or strengthen** `sealHash` integrity verification and is **not** a qualified eIDAS signature. Exported packages still carry plaintext `case-manifest.json` so `case verify` is unchanged.
- The passphrase is never written to manifest / IndexedDB / localStorage; the password dialog supports confirmation and rejects empty passwords. Decryption failure returns one generic error without leaking the cause.
- Web Crypto requires a secure context: when `secureContextAvailable() === false`, the UI **hides** the encryption button and shows a fixed EN/DE hint; no exception, no blocking of the main flow.
- Ciphertext lives in the IndexedDB `case-ciphers` store (`DB_VERSION = 3`, cascaded deletion) as `case-manifest.json.enc` and is an **optional** export entry; `ciphertextSha256` (with `sha256:` prefix) can be cross-checked against `case-files.sha256`.

### 10.6 Standard checksum manifest `case-files.sha256`

- Generated by `pwa/helpers/case-checksums.js`; the hash computation delegates to `pwa/core/hash.js::sha256Hex` (S-14 requires `case-export.js` to stay a hash-free presentation layer).
- Format `<64 lowercase hex>  <relative/path>`; after unpacking it runs directly with `sha256sum -c case-files.sha256`; it covers the manifest, report, CSV, VERIFY.txt, every child package, and the optional cipher copy.
- `VERIFY.txt` adds a v0.3 status block (schema lock / countersign count / encryption state / audit event count) and the `sha256sum -c` command.

### 10.7 Hand-drawn signature and native print

- `<fieldseal-signature-pad>` is a pure browser Web Component (Canvas + Pointer Events, black on white, `touch-action:none`), with clear, one-step undo, preview, and `toDataURL('image/png')`; the component itself computes no hashes.
- `Print / Save as PDF` **uses the browser-native print flow only**: `@media print` hides all action buttons and page chrome, keeping the full English attestation, custody chain, countersigns (with signature images), and hashes. Exact typography, custom fonts, and advanced PDF features are out of core scope; use an extension hook (pdf-lib / jsPDF) later if needed.
- The EN/DE risk notice must remain: not a qualified eIDAS signature, no guarantee of court admissibility, device time and GPS can be altered, participant identity must be independently verified.

### 10.8 Boundaries (untouchable)

1. Do not change the `cli/core/case-verify.js` / `cli/bin/audit.js case verify` entry or decision flow; do not change `verifyCase`'s `invalid_spec > tampered > ok` priority.
2. Do not add any field to the frozen `fieldseal-evidence-v0.2` child manifest (`additionalProperties:false` allowlist).
3. Do not change the v0.2 CSV header, existing VERIFY.txt hash lines, or the five existing export layout items; all additions are incremental.
4. Do not implement any mid/low-priority mainline work, add extension hooks or feature flags, or perform any network upload.

### 10.9 Closing decisions (P0 / P1 code-level answers)

> This section is the v0.3 **closing contract**, frozen by C-30..C-36. The second round (mid-priority mainline + extension hooks) is out of scope here.

#### 10.9.1 P0-1: version dispatch reads `specVersion` only

- A new manifest declares at the top level `specVersion: 'fieldseal-case-v0.3'`; the field enters canonical form, `rootHash`, and the `v03` aggregate block as its first field. Allowlist `CASE_SPEC_VERSIONS = ['fieldseal-case-v0.2', 'fieldseal-case-v0.3']`; **unknown value → `invalid_spec`**.
- **Conflict with the v0.2 compatibility rule**: literally "reject undeclared versions" would turn every historical v0.2 export into `invalid_spec`, violating "the legacy path stays fully usable". Therefore **"undeclared" is bound, not inferred**: `resolveSpecVersion()` reads only `specVersion`; when absent it maps to the frozen legacy contract `SPEC_VERSION_V02`, and that path carries no v0.3 semantics. **Path selection never reads field shape**. Stripping `specVersion` or any v0.3 field changes `rootHash` → `tampered` (C-31). Auditors can see the resolved path in `verifyCase().specVersion`.
- **Canonical ambiguity is eliminated**: `false` / `"false"` / `0` / `null` / `[]` / missing key serialize as `false` / `"\"false\""` / `0` / `null` / `[]` / absent — **six distinct forms**. `undefined`, `NaN`, `Infinity`, functions, symbols, and bigint make `canonicalize` throw `TypeError` (converted to `invalid_spec` by `verifyCase`) instead of being silently dropped by `JSON.stringify`. The `v03` block of `computeSealHash` no longer uses `||` / `=== true` normalization; missing fields use the `FIELD_ABSENT` sentinel, so "stripping a field leaves the hash unchanged" is impossible (C-30).
- **Exact golden**: `cli/test/fixtures/golden-case-v0.2.json` is a fixed, readable v0.2 fixture without `specVersion`; C-30 hard-asserts `rootHash = sha256:4614bff2004cdbd0b0ffa53b034e20a77dbe1b90495d62c314ef9172553b504b` and `sealHash = sha256:8f0b344ddf2aaf87b654da62f285601abfb2eb367570c94700c1138e0cc4abba`. Any canonical/aggregation change must fail that assertion.

#### 10.9.2 P0-2: plaintext manifest contract (selected recommendation)

**Explicit choice: `case-manifest.json` stays PLAINTEXT and self-contained at the top level.**

- The whole manifest, including `countersignList`, `caseEncryptionMeta`, `rootHash`, and `sealHash`, is unencrypted. A third party **without a password** can run `node cli/bin/audit.js case verify <case.zip> --json` and get `ok` / `tampered` / `invalid_spec`.
- `case-manifest.json.enc` is only an **optional encrypted snapshot** (storage protection), not a trust source. Its ciphertext digest is fixed in `caseEncryptionMeta.ciphertextSha256` (protected by `sealHash`) and in `case-files.sha256`, so ciphertext tampering is detectable **without a password**.
- **Corrected public wording**: the Phase-4 claim "unpack the ZIP and run `case verify`" **only holds for standard exports with a plaintext manifest**, not for encrypted containers in general. If a container lacks `case-manifest.json` and has only `.enc`, the contract degrades: the CLI returns the new status **`coreResult: needs_password`**, with empty `sealHash`/`rootHash` and empty `children`, and **never `ok`** (C-34). This branch is an incremental pre-check in the CLI and does not change the `invalid_spec > tampered > ok` priority. The `ENCRYPTION CONTRACT` section of VERIFY.txt and the README follow this wording.

#### 10.9.3 P0-3: selected option A (no encryption after sealing)

**Explicit choice: option A** — encryption metadata may be written only in `draft` (including `pending-configuration` before configuration). `pending_countersign` and `sealed` refuse `setCaseEncryption` / `clearCaseEncryption` / `appendAuditEvent` / schema lock / countersign writes.

Rationale: `caseEncryptionMeta` participates in `rootHash` and `sealHash`; writing it after sealing would recompute the sealed state, contradicting "sealHash fixed, sealed globally locked". Option B (outer container hashes independently while inner sealHash stays unchanged) is **not adopted**: it introduces a second trust source and splits the kernel/CLI decision path, with more risk than benefit. C-33 verifies that five write classes are refused after sealing and `rootHash`/`sealHash` stay byte-identical.

#### 10.9.4 P1 decision table

| Item | Decision | Regression |
| --- | --- | --- |
| Wrong password vs ciphertext tampering | `classifyCipherResult()` is strictly three-way: `tampered` (manifest/meta salt/IV/authTag changed, or ciphertext digest mismatch) / `invalid_passphrase` (one generic message, **does not change the sealHash verdict**) / `ok`. Ciphertext byte integrity is checked with `ciphertextSha256` **before decryption and without a password**, so a 1-bit flip is never misreported as a wrong password | C-32 |
| v0.2 byte compatibility | From "not broken" to "proved": fixed golden fixture + exact string assertions + six-value canonical injectivity probe | C-30 |
| Signature size | **Full attachment model**. `countersignList[]` no longer contains `signatureDataUrl` (the kernel explicitly refuses it), only `signatureSha256` (`sha256:<64hex>`, in both hashes) + `signatureFile`. PNG ≤ `MAX_SIGNATURE_BYTES = 64 KiB` stored in the IndexedDB `signature-images` store, exported as `signatures/<countersignId>.png`; the CLI verifies each attachment byte digest; missing/tampered → `tampered`; `case-files.sha256` covers every attachment | C-29 |
| Duplicate / concurrent countersign | The same signer (`actorName` + `actorOrg`, case/whitespace normalized) submitting twice is **explicitly rejected** (append-only, never overwritten); `putCaseIfUnchanged()` compares `expectedRootHash` in one readwrite transaction; stale → `STALE_CASE`, so two tabs never silently overwrite | C-35 / C-36 |
| DB v2→v4 | `DB_VERSION = 4`. `onupgradeneeded` only does `if (!contains) createObjectStore`; v2→v3 (`case-ciphers`)→v4 (`signature-images`) are all **incremental**, never deleting or rewriting old data; interrupted upgrades lose no case. `deleteCase()` cascades `evidence-packages` + `case-ciphers` + `signature-images`; `deleteCasePackages()` touches only evidence packages, not cipher/signature stores | C-36 |

#### 10.9.5 Closing regression

`C-30` exact golden strings / `C-31` stripping and version downgrade / `C-32` wrong password separated from tampering / `C-33` option-A seal lock / `C-34` plaintext verification + `needs_password` / `C-35` duplicate countersign / `C-36` DB migration and concurrency; run together with `C-21..C-29`, `S-14`, `S-15`, and the full static self-check.

## 11. v0.4 second-round increment contract (mid/low priority, hook reservation, attribution watermark)

> This chapter is the single contract source for v0.4. **Add only, never change**: the §10 closing version dispatch, canonical injectivity, plaintext manifest, cipher-only `needs_password`, three-way failure classification, option-A seal lock, signature attachment model, duplicate/concurrent countersign, eight-field audit, S-14 hash-free export layer, DB v4 migration, and every frozen artefact (`fieldseal-evidence-v0.2` / `cli case verify` decision flow / v0.2 export layout / CSV header) stay exactly as they are.

### 11.1 Version dispatch (single decision)

- `SPEC_VERSION_V04 = 'fieldseal-case-v0.4'`; `CASE_SPEC_VERSIONS = [v0.2, v0.3, v0.4]`; `CURRENT_SPEC_VERSION = v0.4`.
- Dispatch **only** by explicit `specVersion`; `undefined` still binds legacy v0.2 (not shape inference); unknown value → `invalid_spec`. `resolveSpecVersion()` ordering and the `FIELD_ABSENT` sentinel are frozen and unchanged.
- `computeSealHash` adds an **independent** `sealInput.v04` aggregate key containing `{ specVersion }` + `V04_AGGREGATE_FIELDS` (the four v0.3 fields + four new hash fields); missing fields use the same `FIELD_ABSENT` sentinel; `||` / `=== true` normalization is forbidden. The v0.2 six-key path and the v0.3 `sealInput.v03` branch are byte-identical.
- `rootHash` still covers the whole manifest except `rootHash`/`sealHash`: stripping any v0.4 field, downgrading `specVersion`, or tampering with branding/watermark records all yield `tampered`.

### 11.2 New fields and hash decisions (fixed once)

| Field | Structure | In sealHash | Note |
| --- | --- | --- | --- |
| `schemaDictionaries` | `{ [fieldId]: string[] }` | **yes** | front-end dropdown options; locked with schema lock |
| `snapshots` | `SnapshotRecord[]` (id / createdAtUtc / rootHash / specVersion only) | **yes** | registers **exported** snapshot metadata only, no binaries |
| `thirdPartyNotes` | `NoteRecord[]` (noteId / noteBy / noteOrg / noteText / decision / timestampUtc / ianaTimezone) | **yes** | independent of `countersignList`; decision = Concur or Dissent |
| `isDeleted` | `boolean` | **yes** | soft delete, never physically deletes IndexedDB data |
| `reportBranding` | `{ headerText, footerText, logoDataUrl? }` | **no** | local display config, `rootHash` only |
| `watermarkConfig` | `{ enabled, text, appliedAtUtc, records: WatermarkRecord[] }` | **no** | `records` carry **original + watermarked dual hashes**, both in the manifest (`rootHash`) |
| `attachments` | export-package directory, **not a manifest field** | **no** | extension-hook products; must be covered by `case-files.sha256` |

Dual-hash semantics: the visible watermark is redrawn on Canvas (`CaseID + UTC + IANA`); original bytes are preserved; `recordWatermark()` writes `originalSha256` / `watermarkedSha256` into `watermarkConfig.records`. Tampering with either digest → `tampered` (C-40), but `computeSealHash` is unchanged because the field is outside the versioned aggregate.

### 11.3 Migration rules (critical)

- **Only `draft` may migrate to v0.4**. `pending_countersign` / `sealed` are refused and open read-only at the original `specVersion`; the UI says "this case version does not support v0.4 features" and hides all v0.4 entry points. Rationale: migration changes `rootHash` and would break countersigned objects and sealing conclusions.
- `migrateCaseToV04()`: backfills the four v0.3 fields (if from legacy v0.2) and v0.4 defaults (`schemaDictionaries: {}`, `snapshots: []`, `thirdPartyNotes: []`, `isDeleted: false`, `reportBranding`, `watermarkConfig`), writes audit `CASE_MIGRATED_V04` (eight fields, `payload.previousRootHash` retained), and recomputes `rootHash` / `sealHash`.
- **Migration is an explicit legal change and produces a new `rootHash`; packages exported before migration still verify at their original `specVersion`** (C-44 opens a v0.3 plaintext export with the frozen CLI, gets `ok`, and `specVersion = fieldseal-case-v0.3`).

### 11.4 Write-permission matrix (single source `V04_PERMISSION_MATRIX`)

| Action | draft | pending_countersign | sealed |
| --- | --- | --- | --- |
| migrate v0.4 | yes | no | no |
| add/edit/remove dictionary | yes | no | no |
| batch edit item fields | yes | no | no |
| apply watermark / regenerate watermarked version | yes | no | no |
| create snapshot | yes | yes (read-only export) | yes (read-only export) |
| append third-party note | yes | yes | no |
| soft delete / restore | yes | no | no |
| extension-hook read (read-only) | yes | yes | yes |

All v0.4 writes pass through `requireV04Action()`; the `requireMutable()` `sealed` hard lock and the `pending_countersign` allowlist remain; `V04_PENDING_WRITES` only adds `thirdPartyNoteAdd`. S-16 verifies the matrix cell by cell against `v04ActionAllowed()`.

**Snapshots**: `buildSnapshotZip()` is a **pure read-only** helper that produces an independent export package (`snapshot-manifest.json` with a manifest copy + its own hash, `VERIFY.txt`, `snapshot-files.sha256`); **generation must not modify any field of the main case**; draft/pending/sealed generation never changes `rootHash`. Only explicit `recordSnapshot()` (draft-only) registers metadata and writes `SNAPSHOT_CREATED`; pending/sealed are read-only export and write no audit. **VERIFY.txt and the report must state: snapshots are archival only, not an authoritative trust source, and never replace the main case `case verify`.**

### 11.5 Extension hooks (reserve only; no implementation, no libraries)

`window.EXT_HOOKS = {}`; five feature flags default to `false`: `EXTENSION_ZXING_BARCODE_SCAN` / `EXTENSION_ENCRYPTED_ZIP` / `EXTENSION_PDF_LIB` / `EXTENSION_QR_GENERATE` / `EXTENSION_CLOUD_SYNC`. Symbol isolation has four parts: lazy resolution at call time (no global capture at module load), `isAvailable()`, a normalized `{ ok, data, message }` interface (never re-export the library object), and `setHookOverride()` as the replacement seam. `window.*` third-party globals may be read **only** in `pwa/vendor/ext-hooks.js`; first-party code reads only the normalized interface in `helpers/ext-hooks.js`.

`flag=false`: UI fully hidden, branch never executed. `flag=true` without the library: friendly degradation, no throw, no mainline block. Hook products go into `/attachments`, **never into `sealHash`**, and **must enter `case-files.sha256`**; the CLI verifies each file digest; changed bytes or undeclared attachments → `tampered` (C-45 / C-46). The fixed English notice stays verbatim at the top of `helpers/ext-hooks.js`. The mainline performs no network push; the barcode callback `(scanText)` and QR callback receiving `dataUrl` are reservation only.

### 11.6 Four-layer attribution watermark (never in manifest / sealHash; no variable timestamps)

1. Every `.js` / `.cjs` / `.html` / `.css` source carries the unified copyright header at the top (project / 2026 / license / ownership); the two CLI entries with a shebang put the header **after** the shebang (otherwise the shebang breaks).
2. `index.html` prints a startup console banner (project + version + license).
3. All 12 HTML pages carry a fixed attribution in the status bar / footer.
4. Exported artefacts: HTML report footer, CSV trailing `#` metadata comment line (the v0.2 frozen header is kept), and the PDF print footer.

Verification uses `cli/test/read-only-scanner.cjs attribution` **read first, report after**; `audit` mode also reports dependency 0 / external imports 0 / external links 0 / illegal vendor globals 0. Third-party files keep their original license headers (this repository contains no third-party source files).

### 11.7 Audit event type expansion (all eight fields)

On top of the v0.3 eight, add ten types to the `AUDIT_EVENT_TYPES` allowlist: `DICTIONARY_ADD` / `DICTIONARY_EDIT` / `DICTIONARY_REMOVE` / `BATCH_FIELD_UPDATE` / `WATERMARK_APPLIED` / `SNAPSHOT_CREATED` / `NOTE_ADDED` / `CASE_SOFT_DELETED` / `CASE_RESTORED` / `CASE_MIGRATED_V04`. `BATCH_FIELD_UPDATE`'s `payload` must carry `affectedCaptureIds`.

### 11.8 Export and report additions

The HTML report adds sections 11 Schema Dictionaries / 12 Case Snapshots (metadata only) / 13 Third-party Notes / 14 Deleted Items + dual-hash records; `SOFT-DELETED` is explicitly marked. VERIFY.txt adds a v0.4 block (`specVersion`, snapshot declaration, `/attachments` contract, watermark state). CSV keeps the frozen header and only appends new event rows plus the trailing attribution comment. `case-files.sha256` covers `attachments/*` and `signatures/*`. The export layer `case-export.js` still **computes no hashes** (S-14 / S-16 static assertions).

### 11.9 Regression and delivery

`S-16` 11-item self-check + `C-37..C-46` ten regressions; the two golden fixtures live in `cli/test/fixtures/golden-case-v0.2.json` and `golden-case-v0.3.json`, with exact string assertions proving historical `sealHash` bytes are unchanged. Phase-0 closing artefacts are in `reports/closing/CLOSING-REPORT.md`; v0.4 artefacts are archived under `reports/v04/` outside the repository.
