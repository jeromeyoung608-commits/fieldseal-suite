# Release Signing & Rollback Runbook

Date (UTC): 2026-11-14 · Applies to: FieldSeal Suite v0.5 delivery set · Status: **current baseline**

This runbook closes audit item **B-08 (no rollback plan)**. Every command is
zero-dependency, uses Node built-ins only and runs fully offline — no GPG, no
network, no `npm install`.

Single entry point: `node tools/release/release-tool.mjs <command> [options]`

---

## 0. Trust boundary (read first)

- **The signed manifest proves that release artefacts were not replaced**, not
  that case content is legally valid. The authoritative case verdict always comes
  from `node cli/bin/audit.js case verify <case.zip> --json` (or the equivalent
  dist binary).
- The Ed25519 **release private key never enters the repository**. `keygen`
  refuses to write a private key into the repo tree; the default is
  `~/.fieldseal/release-private-key.pem` (mode 0600), kept on an air-gapped
  release machine.
- Only the **public key** `dist/RELEASE-PUBLIC-KEY.pem`, the signature
  `dist/SHA256SUMS.sig` and a metadata-only **hash-anchor snapshot** (no binary
  bytes) are distributed in the repository.
- Full byte snapshots live outside the repo on the operations machine (default
  `~/.fieldseal/releases`), redirectable with `--store` or
  `FIELDSEAL_RELEASE_STORE`.

---

## 1. Standard release flow (run in order after every build)

```bash
# 0) Rebuild the four platform binaries (only npm step; build machine only)
cd tools/build && npm install && npm run build && cd ../..
#    Note: build creates package-lock.json / node_modules; remove before delivery (S-06 gate).
rm -rf tools/build/node_modules tools/build/package-lock.json

# 1) Create the rollback point before deployment — full byte snapshot outside the repo
node tools/release/release-tool.mjs snapshot --label v0.5-predeploy

# 2) Sign SHA256SUMS with the air-gapped release key (.sig + public key; manifest.json -> signed)
node tools/release/release-tool.mjs keygen        # first time only; key in ~/.fieldseal/
node tools/release/release-tool.mjs sign

# 3) Offline acceptance: signature + all binary hashes + startup smoke
node tools/build/verify-binaries.mjs
node tools/release/release-tool.mjs verify-signature
node tools/release/release-tool.mjs status

# 4) Full gates
node cli/test/test-runner.js --full
node cli/test/read-only-scanner.cjs all
```

Signature format (`dist/SHA256SUMS.sig`, JSON envelope):

| Field | Meaning |
| --- | --- |
| `algorithm` | fixed `Ed25519` |
| `signedFile` | fixed `SHA256SUMS` |
| `sha256OfSignedFile` | sha256 of the signed content; prevents post-sign edits |
| `publicKeyFingerprint` | sha256 of the public-key PEM; prevents key substitution |
| `signature` | base64 detached signature |

Three verification checks: public-key fingerprint matches + `SHA256SUMS`
unchanged + Ed25519 signature valid. Any mismatch is a failure.

---

## 2. Rollback / restore (when something goes wrong)

**Principle: `restore` and `rollback` are dry-run by default; only explicit
`--apply` writes files. Every `--apply` first creates a `pre-rollback` snapshot
automatically, so even a wrong rollback can itself be rolled back.**

```bash
# 2.1 List available rollback versions
node tools/release/release-tool.mjs list
node tools/release/release-tool.mjs status        # rollbackTargets lists verified snapshots only

# 2.2 Verify one snapshot (per-file sha256 + manifest self-hash + signature/manifest consistency)
node tools/release/release-tool.mjs verify <snapshot-id>

# 2.3 Dry-run (writes nothing; prints the plan)
node tools/release/release-tool.mjs restore <snapshot-id>
node tools/release/release-tool.mjs rollback

# 2.4 Execute
node tools/release/release-tool.mjs restore <snapshot-id> --apply
#   or roll back to the latest verified, non-pre-rollback snapshot:
node tools/release/release-tool.mjs rollback --apply

# 2.5 Re-verify after rollback
node tools/build/verify-binaries.mjs
node cli/test/test-runner.js --full
```

`restore` returns `safetySnapshot` (the pre-rollback snapshot ID created by this
run), `skippedBinaryRestore` (binaries a metadata-only snapshot does not copy) and
`signatureOk`. If `signatureOk` is `false`, stop distribution immediately and
re-sign; do not keep deploying.

**Damage scenarios:**

| Symptom | Command | Expected |
| --- | --- | --- |
| Binary replaced / bit flip | `verify-binaries.mjs` | `MISMATCH`, exit 1 |
| `SHA256SUMS` changed | `verify-signature` | `SHA256SUMS changed since it was signed` |
| Public key swapped | `verify-signature` | `public key fingerprint mismatch` |
| Signature changed | `verify-signature` | `Ed25519 signature does not verify` |
| Snapshot payload changed | `verify <id>` | `hash mismatch: <file>` |
| Snapshot manifest changed | `verify <id>` | `backup manifest self-hash mismatch` |
| Path-traversal entry | `verify <id>` | `unsafe entry name` |

All of the above are covered by `tools/release/test-release-tool.mjs` (31 cases)
and gate `S-23`.

---

## 3. Operational rules

- **Private key leaked:** immediately `keygen` + `sign` again on the air-gapped
  machine and distribute the new public key to every recipient; revoke the old
  signature list and record it in the custody chain.
- Every `npm run build` rewrites `dist/manifest.json` to `status: unsigned` and
  generates new `SHA256SUMS`; **snapshot → sign → verify from section 1 must run
  again**. Skipping it makes `S-23` fail.
- Snapshot IDs look like `20261114T082657Z-v0-5-baseline`; `pre-rollback`
  snapshots are never chosen as rollback targets (no "rollback onto itself").
- `restore` writes only registered files and does not delete extra files in
  `dist/`; unregistered files are checked and handled manually (no implicit
  deletion).
- Metadata-only snapshots (`--metadata-only`) are the hash anchor shipped with
  the code for verification and audit evidence; they do not copy binary bytes and
  cannot perform byte-level recovery on their own. Byte-level rollback requires a
  full snapshot.
- Both gate runners share `cli/test/fixtures/.tmp`; default and `--full` **must
  run serially** (see `KNOWN_ISSUES.md`).

---

## 4. Gate anchor

`S-23` (`cli/test/test-runner.js`) asserts on every regression: the signed
manifest exists and verifies offline, `dist/manifest.json` is marked signed, the
release private key has not leaked into the repo, in-repo rollback baselines
verify item by item, and rollback/signature self-tests are green. Any failed
condition means FAIL and no delivery.

Current gate: default `143/143`, `--full` `144/144` (run 2026-11-15); historical
snapshots in `docs/RELEASE-NOTES.md`.

---

## 5. Real byte-level rollback drill (2026-11-14, executed)

Close-out evidence for audit item **RL-01 / F5 "no real byte-level rollback
drill"**. The drill ran in a separate temporary store and did not modify the
in-repo rollback baselines.

| Step | Command / action | Measured result |
| --- | --- | --- |
| 1 | Full byte snapshot `snapshot --store /tmp/fs-rehearsal-store --label rehearsal-full-bytes` | `ok:true`, `files:8`, `metadataOnly:false`, ID `20261114T111319Z-rehearsal-full-bytes` |
| 2 | `list --store …` | 1 verifiable snapshot |
| 3 | Flip 1 byte in `fieldseal-case-verify-linux-x64` at offset 4096 | written |
| 4 | `node tools/build/verify-binaries.mjs` | **exit 1 / `VERIFICATION FAILED`** (corruption detected) |
| 5 | `rollback --apply --store …` | `applied:true`, `safetySnapshot: 20261114T111342Z-pre-rollback`, `signatureOk:true`, all 8 files in the plan |
| 6 | `node tools/build/verify-binaries.mjs` | **exit 0 / `ALL BINARIES VERIFIED`** |
| 7 | Per-file `cmp` against the pre-drill copy | 8/8 byte-identical, no residual difference |

The drill proves: the signed manifest detects single-byte tampering; rollback
automatically creates a `pre-rollback` snapshot (rollback is itself reversible);
after rollback, signature consistency and all four-platform binary hashes are
restored. The temporary store and safety copy were cleaned up after the drill.
The repo keeps two metadata-only baselines (old baseline + P0 baseline), which
`S-23` verifies item by item on every regression.
