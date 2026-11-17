# Data Processing Agreement — Template (self-hosted / offline edition)

Version 1.0 · 2026-11-14 · FieldSeal Suite

> This is a signable template. It is provided for procurement files that require a
> DPA artefact on record. Fill in the two parties, date, and sign. Nothing here
> creates a processing relationship that does not exist in fact.

## 0. Applicability note (read first)

FieldSeal Suite is delivered as static files plus an offline CLI. It has no backend,
no account system, no telemetry and no outbound network calls. All personal data
entered by an operator stays in that operator's browser profile or in files they
export themselves. The publisher therefore **never acts as a processor** for
customer data: it has no technical means to access it. Under GDPR Art. 28 a DPA is
not required for this deployment model. This template is offered for customers
whose internal policy nevertheless requires a signed document on file.

## 1. Parties

| | Controller ("Customer") | Publisher ("Supplier") |
|---|---|---|
| Legal name | ________________________ | ________________________ |
| Address | ________________________ | ________________________ |
| Representative | ________________________ | ________________________ |
| Contact | ________________________ | ________________________ |

Effective date: ____________
EU / UK Representative (if applicable): ________________________
Data Protection Officer / privacy contact (if appointed): ________________________

> Role note: for this offline deployment the Supplier does **not** act as a processor
> (see §0); the signature blocks below record the two parties for procurement only. If a
> processor clause is contractually required, it applies solely to the offline software
> supply and not to any customer data, which the Supplier never accesses.

## 2. Subject matter and duration

Subject matter: supply of the offline software "FieldSeal Suite" (static PWA,
zero-dependency CLI, prebuilt binaries) and its documentation. Duration: from the
effective date until the Customer stops using the software. There is no hosted
service term.

## 3. Nature and purpose

Local creation, sealing, verification and export of evidence packages, case files,
multi-party signature canvases and a local operation trail. No automated decision
making, no profiling, no content moderation, no AI authenticity judgement.

## 4. Categories of data

- Categories of data subjects: field operators, witnesses/co-signers, persons named
  in case metadata or human notes.
- Categories of personal data (only what the operator chooses to enter): names,
  operator identity profiles, handwritten signature images, human notes, optional
  geolocation, optional device/timezone metadata, user-agent and origin in the
  local operation trail.
- Special categories (Art. 9): not requested by the software. The Customer is
  responsible for not entering them unless a lawful basis exists.

## 5. Processing instructions and location

All processing is performed **on the Customer's own device** by the Customer's
personnel. Data residency is the device and any storage media the Customer chooses.
In the **default off** configuration there is no transfer to the Supplier, no
third-country transfer and no sub-processor; the Supplier's instruction is: "do
not transmit data". If the Customer enables the optional external RFC3161 TSA
mode, only the textual root hash is sent to the TSA endpoint the Customer selects.
That endpoint may be a third party and may be outside the EEA/UK; the Customer is
the controller for that transmission and must complete its own Art. 44/28
assessment. The Supplier is not a party to it. See `DATA-RESIDENCY.md` and
`../../docs/EXTERNAL-TSA-DISCLOSURE.md`.

## 6. Confidentiality, security, and technical measures

- Zero runtime dependencies; no CDN, analytics or remote font/script references.
- SHA-256 / SHA3-256 (capability-gated) via platform WebCrypto or Node crypto;
  detached Ed25519 release signatures; tamper-evident hash chain on the local trail.
- Optional HTTP agents (archive / receipt / aegis) bind to `127.0.0.1` by default
  and require a Bearer secret; they fail closed when the secret is absent.
- CSV exports neutralise formula-leading `= + - @`; ZIP extraction rejects absolute
  paths and `..` segments (Zip-Slip).
- GDPR redaction masks package identifiers, redacts actor names and drops
  timezone/tool/source fields on the local trail.

See `../../SECURITY.md` and `../../KNOWN_ISSUES.md`.

## 7. Data subject rights, deletion, audit

Rights are exercised locally by the Customer (see `../privacy.html` §3). Deleting a
case removes its operation-trail entries and redacts surviving actor references.
At end of term the Customer deletes the browser profile / exported files / installed
directory; the Supplier holds no copy to return or delete. The Customer may verify
release integrity offline with the bundled public key and `verify-binaries.mjs`.

## 8. Liability and signatures

Liability follows the MIT License, under which the software is provided "AS IS"
without warranty of any kind (see `LICENSE`). This DPA does not create a hosting,
availability or qualified-signature (eIDAS) obligation, and it does not condition or
restrict any right the MIT License grants.

For the Customer: ____________________  Date: __________
For the Supplier: ____________________  Date: __________
