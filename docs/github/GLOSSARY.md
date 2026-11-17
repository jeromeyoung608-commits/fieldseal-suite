# Glossary — FieldSeal Suite

> EN: Key terms for auditors and operators.

## sealHash
EN: The top-level integrity value of a **case** (`case-manifest.json`). It aggregates `schemaDef`, `caseMeta` (selected keys), child root hashes, custody log, schema-change log and state. It is the **single source of trust** for a sealed case. Tampering any bound field → verification reports `tampered`.

## rootHash
EN: The manifest-wide integrity value. It covers the entire manifest (minus the two hash fields themselves) — including items that are NOT in `sealHash` (e.g. watermark dual digests). Used for whole-package integrity.

## Exhibit
EN: A stable, display-only sequential label (`EXH-00001 …`) assigned to each evidence item in an export report. It is **never** written back into the manifest and never affects any hash.

## Aegis envelope
EN: An optional, out-of-trust-chain encryption envelope: a random data-encryption key (AES-GCM-256) wraps the manifest, and each recipient's RSA-OAEP-SHA256 public key independently wraps that key. It is storage/transport protection only and never replaces `sealHash`.

## Chain of custody
EN: The chronological record of who handled evidence, when (UTC + IANA tz), and for what purpose — `custodyLog` + `auditLog`. Surfaced in the case report and the DOM timeline. Integrity-bound where specified; auxiliary annotations are not.

## NTP reference time
EN: A network-time anchor recorded at capture to detect device clock drift. Audit context only; excluded from hashes; corroborating, not a trust root.

## Additive non-trust metadata
EN: v0.5 fields (`operatorIdentity`, `humanNotes`, `envSnapshot`) stored in `caseMeta` but deliberately excluded from `rootHash` / `sealHash`. Audit context only — never a trust root.

## DRAFT ONLY
EN: A `draft` case's `sealHash` is a preview; it is not evidentially certified until `sealed`. After `sealed`, all writes are rejected and any change fails verification.
