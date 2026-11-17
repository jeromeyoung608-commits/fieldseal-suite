# Test Cases — FieldSeal Suite

Auto-generated index of the executable suite in `cli/test/test-runner.js`. The runner is the source of truth; descriptions here summarize the assertion group.

Total listed cases: 144

| ID | Assertion group |
| --- | --- |
| N-01 | minimal evidence v0.1 verifies ok |
| N-02 | full evidence v0.2 with aux preview verifies ok |
| N-03 | UTF-8 note and tags survive canonical serialization |
| N-04 | signature v0.1 with linked evidence verifies ok |
| N-05 | super-bundle recursively verifies both children ok |
| N-06 | report-html emits a standalone static HTML report |
| N-07a | 16 MiB media file verified through streaming path |
| N-07b | ZIP64 EOCD/locator byte layout is correct |
| T-01 | flipping one media byte is detected |
| T-02 | appending one byte to video is detected |
| T-03 | editing manifest note without rehashing is detected |
| T-04 | replacing rootHash with another valid hash is detected |
| T-05 | removing a declared file is detected |
| T-06 | an undeclared root entry is rejected |
| T-07 | unknown spec version is invalid_spec |
| T-08 | malformed manifest JSON is invalid_spec |
| T-09 | missing createdAt is invalid_spec |
| T-10 | privately added manifest field is invalid_spec |
| T-11 | wrong field type is invalid_spec |
| T-12 | non-canonical JSON text still verifies via C2 recomputation |
| T-13 | tampering an aux preview does not break an evidence package |
| T-14 | illegal file name in files[] is invalid_spec |
| X-01 | linkedEvidenceRootHash mismatch is tampered |
| X-02 | substituting the evidence package is tampered |
| X-03 | signature without its evidence package is missing_linked_package |
| X-04 | linkedEvidenceId pointing to an unknown package is missing_linked_package |
| X-05 | replacing a bundle child without updating items[].hash is rejected |
| X-06 | tampering media inside a bundle child is caught by recursion |
| X-07 | items[].packageId not matching the child is tampered |
| X-08 | a bundle missing one declared child is tampered |
| X-09 | bundle holding only a signature child is missing_linked_package |
| X-10 | editing a sealed signature manifest is tampered |
| CL-01 | CLI verify --json returns ok with the fixed top-level fields |
| CL-02 | CLI exits 1 on a tampered package |
| CL-03 | CLI bundle command produces a verifiable super-bundle |
| S-01 | no package.json / lockfile / node_modules in trusted core or repo root |
| S-02 | cli JS only requires Node built-ins or local handwritten files |
| S-03 | pwa JS imports only local handwritten files; no external importmap |
| S-04 | no CDN, remote script, remote stylesheet or remote font |
| S-05 | no vendored source, minified bundles or oversized generated JS |
| S-06 | no generator / bundler scaffolding artifacts |
| S-07 | SHA256 and ZIP use platform built-ins, no handwritten crypto primitive |
| S-08 | static self-check runs as one zero-dependency read-only command |
| S-09 | PWA trusted core is dependency-free, WebCrypto-based and locally imported |
| S-10 | front-end self-check: dual signing mode UI boundaries |
| S-11 | custody features: CLI entry / schema / modes / independent popup |
| S-12 | case-layer wrapper spec does not fork the frozen evidence contract |
| S-13 | Phase 3 capture/custody UI + evidence storage stay on the shared kernel |
| S-14 | Phase 4 export is hash-free presentation and stays case-verify compatible |
| S-15 | v0.3 Core Baseline full self-check (Countersign + Encryption + Signature) |
| S-16 | v0.4 second-round full self-check (11 items) |
| P-01 | PWA and CLI canonical JSON / root hash agree byte for byte |
| P-02 | PWA core evidence v0.2 package verifies ok in the CLI |
| P-03 | PWA core evidence v0.1 package verifies ok in the CLI |
| P-04 | a PWA package with swapped media bytes is rejected by the CLI |
| P-05 | PWA helpers honour C5 names, decimal strings and container checks |
| P-06 | PWA core reads and validates a PWA-produced evidence package |
| P-07 | Seal produces a signature package that CLI verifies with linked evidence |
| P-08 | Seal locks the session: a second seal is rejected |
| P-09 | substituting the evidence package breaks the signature binding |
| P-10 | a signature package without its evidence is missing_linked_package |
| P-11 | canvasSnapshotHash equals the sealed snapshot bytes and is bound by rootHash |
| E-01 | full chain: PWA capture -> Seal -> CLI verify -> bundle -> verify (x3) |
| E-02 | tampering a captured photo is detected by the CLI |
| E-03 | editing the manifest note without rehashing is detected |
| E-04 | replacing the evidence package inside the bundle is detected |
| N-07c | ZIP64 archive with 66000 entries round-trips (optional --full) |
| I-01 | Joint mode: PWA seal -> CLI verify --linked ok, pluginExtras.signMode=joint |
| I-04 | Independent mode: two independent signers on same evidence both verify |
| I-05 | Independent isolation: tampering signer A does not affect signer B |
| I-07 | Mixed bundle: evidence + joint + independent signatures archive and verify |
| I-10 | Audit HTML report distinguishes signMode |
| K-01 | Recipient local audit log: opt-in, fields, timezone, JSON/TXT export |
| K-03 | Recipient log in bundle aux: tamper/delete aux does not affect rootHash |
| K-04 | Batch verify classifies mixed evidence/signature/bundle/supplement |
| K-05 | Batch flags tampered / missing-linked / legacy packages correctly |
| K-06 | Large bundle with many children verifies stably via batch |
| K-07 | Legacy packages without extension fields verify via batch |
| D-01 | Tamper any manifest hash-binding field -> coreResult tampered |
| D-02 | Tamper aux/log/report files does not affect main package |
| D-03 | Wrong cross-package binding (evidenceId) is intercepted |
| D-04 | Circular supersedes chain is reported, not crashed |
| D-05 | Oversized media + long/special-char fields: ok and report renders |
| D-06 | Offline / Service Worker presence (static; full offline needs browser) |
| D-07 | Mixed bundle (evidence+joint+independent+supplement+revision) verifies recursively |
| D-08 | Repeated export/import + log append stability |
| C-01 | CLI custody injects metadata, hash-bound, verifies ok |
| C-02 | Invalid custody rejected by kernel |
| C-03 | Tampering custody metadata breaks rootHash |
| C-04 | SHA3-256 manifest binding via CLI |
| C-05 | verify --strict / --audit-only modes |
| C-06 | audit schema emits custody spec |
| C-07 | aux GDPR redaction + retention timer |
| C-08 | CSV report maps SOC2 columns + custom field columns |
| C-09 | standard case creates draft with schema + hashes |
| C-10 | emergency path: pending-configuration blocks seal, supplement unlocks |
| C-11 | captures append child + Collected event; sealHash binds children |
| C-12 | schema change logs + version bump; deletion does not purge history |
| C-13 | seal fixes sealHash; tampering any bound data fails verify |
| C-14 | CLI case verify round-trip (dir + zip) and child tamper |
| C-15 | case hash-algorithm binding follows real WebCrypto capability |
| C-16 | standard capture: frozen v0.2 package -> Collected event -> case verifies ok |
| C-17 | tampering child / caseMeta / custody note all break case integrity |
| C-18 | emergency: capture while pending -> supplement -> history preserved |
| C-19 | custody events: enum validation, sealHash binding, sealed lock |
| C-20 | case-store persists evidence ZIPs and cascades deletion |
| C-21 | sealCase locks everything; any post-seal mutation fails verification |
| C-22 | export ZIP layout is directly verifiable by CLI case verify |
| C-23 | tampered child package / case metadata fail CLI case verify |
| C-24 | HTML Attestation / CSV ledger / export preflight |
| C-25 | explicit specVersion selects the path; legacy v0.2 aggregate stays frozen |
| C-30 | v0.2 golden fixture -> exact rootHash/sealHash strings + canonical injectivity |
| C-31 | stripping v0.3 fields / specVersion => tampered; unknown version => invalid_spec |
| C-26 | Schema Lock gates schema edits, is audited and hash-bound |
| C-27 | pending_countersign is read-only except countersigns; Seal Final locks |
| C-28 | AES-GCM/PBKDF2 round trip, generic decrypt error, metadata hash binding |
| C-29 | v0.3 export carries sha256sum manifest, cipher copy and full attestation |
| C-33 | contract A: encryption is forbidden after sealing; sealHash stays byte-fixed |
| C-34 | plaintext manifest verifies with no password; encrypted-only => needs_password |
| C-32 | wrong passphrase != cipher tampering; IV/tag tampering is hash-bound |
| C-35 | duplicate signer is explicitly rejected; earlier decision never overwritten |
| C-36 | DB v2 -> v4 upgrade keeps cases; deleteCase cascades all blobs; stale writes refused |
| C-37 | v0.2 + v0.3 golden fixtures keep their exact sealHash strings |
| C-38 | tampering / stripping schemaDictionaries -> tampered, no shape inference |
| C-39 | batch field update: one audit event with affectedCaptureIds, rootHash changes |
| C-40 | watermark dual digests in manifest; tampering either one -> tampered |
| C-41 | snapshot is an independent archive package; generation never mutates the main case |
| C-42 | third-party notes are hash-bound, independent of countersignList, sealed append refused |
| C-43 | soft delete is hash-bound, restore is consistent, sealed forbids it |
| C-44 | migration: draft -> v0.4 with data intact; pending/sealed refused and stay read-only |
| C-45 | hooks: flag off hides, on-without-library degrades, products in /attachments and sha256 only |
| C-46 | attachment byte tampering and signature digest mismatch both -> tampered |
| C-50 | v0.4 legacy package verifies under the v0.5 verifier (backward compat) |
| C-51 | v0.5 operatorProfile + exhibitId are hash-bound; stripping -> tampered |
| C-52 | v0.5 human_note is hash-bound; sealed write refused |
| C-53 | v0.5 identity/note/exhibit writes are sealed-locked |
| C-54 | v0.5 malformed fields rejected by schema validation |
| E2E-01 | real create->seal->export->CLI verify returns coreResult ok |
| E2E-02 | failure-injection matrix rejects bad input / tampered artifact |
| LIC-01 | licensing + bilingual gate: MIT headers, legal set, every doc has EN/DE coverage |
| S-20 | P0/P1/P2 core self-tests pass (consent, affidavit, transfer-receipt, bates, witness, retention, media-redaction, bagit, dual-control, geo, operator-identity, zip-slip, large-evidence, csv-injection, sha3-capability, sw-precache, audit-chain, audit-anchor, fuzz-inputs, delivery-tools) |
| S-21 | golden case package: verifier anchor (ok on genuine, tampered on altered) |
| S-22 | dist binary agrees with source verdict on golden (if built) |
| S-23 | signed release manifest + backup/restore/rollback (B-08) |

Run: `node cli/test/test-runner.js` (fast) or `node cli/test/test-runner.js --full` (full regression).
