# Business Continuity & Recovery — FieldSeal Suite

_Last updated: 2026-11-15 · Scope: local evidence, case database, release artefacts_

FieldSeal Suite has no backend. Continuity therefore means: the operator can restore local
cases and the publisher can reproduce/rollback a release. It does **not** mean a cloud
failover.

## 1. Recovery objectives (measured, not aspirational)

| Object | Method | Target | Evidence |
|---|---|---|---|
| Case database (JSON backup) | `backup.mjs export` → `verify` → `restore` | RTO < 5 min for 200 cases | D3 round-trip test; see `Module-Acceptance-Report.md` |
| Evidence packages | immutable ZIP + SHA256SUMS; restore by copy | RPO = last export | package verify `coreResult: ok` |
| Release artefact | signed `SHA256SUMS` + rollback rehearsal | rollback < 10 min | `docs/RELEASE-ROLLBACK.md` |
| Local audit trail | 365-day retention + hash chain | loss detectable on boot | A6 retention/tamper test |

The 200-case figure is a measured test, not a claim for every data size. Larger datasets must
be timed by the operator.

## 2. Backup procedure

```bash
# 1. export the local database to JSON (operator UI or CLI)
node cli/bin/backup.mjs export --input fieldseal-backup.json --out fieldseal-backup.zip
# 2. verify the ZIP before trusting it
node cli/bin/backup.mjs verify --input fieldseal-backup.zip
# 3. restore only after verify passes
node cli/bin/backup.mjs restore --input fieldseal-backup.zip --out restored.json
```

Keep the ZIP and a separate copy of the passphrase (if encrypted) outside the same device.
A sealed case is intentionally immutable: correct by creating a new case, not by rewriting.

## 3. Release rollback

1. Identify the last known-good signed artefact and its SHA256SUMS.
2. Verify the detached Ed25519 signature and the binary digests.
3. Stop the current release, restore the previous artefact, and re-run `doctor` +
   `audit.js verify` on a golden package.
4. Record the rollback in `docs/RELEASE-ROLLBACK.md` and the release notes.

## 4. Degraded modes

- **External TSA unavailable:** export continues with `tsaDegraded`; no silent local-time
  substitution. The operator decides whether to accept or retry.
- **Aegis unavailable:** the anchor is marked failed; the local `sealHash` is unchanged and
  remains the trust root.
- **Browser storage quota:** chunked write + quota warning; the operator must export and free
  space. Do not delete a sealed case to “fix” quota.

## 5. What is not covered

No cloud SLA, no multi-region failover, no publisher-held backup of customer evidence, and no
recovery of a lost operator passphrase. On-prem / air-gapped deployment guidance is available
as an optional paid service (`PRICING.md`) — it is not required to run the software.
