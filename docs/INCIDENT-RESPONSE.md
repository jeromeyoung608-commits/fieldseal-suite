# Incident Response — FieldSeal Suite

_Last updated: 2026-11-15 · Owner: maintainers · Scope: product, release artefacts, hosted demo_

This is the operator-facing runbook for a suspected integrity, privacy or availability
incident. It does not replace the operator's own legal/regulatory process.

## 1. Report

- **Security vulnerabilities:** private repository security advisory (Security → Advisories).
  Do not open a public issue. No PGP key is published; request one inside the advisory.
- **Data-protection incident:** the operator is the controller; contact its DPO/legal team
  first. The publisher does not operate a backend and holds no customer evidence.
- **Availability / release artefact:** open a repository issue with the version, platform and
  exact command; attach the failing output, not customer data.

## 2. Triage (target: acknowledge in 2 business days)

| Severity | Example | Target |
|---|---|---|
| Critical | tampered package verifies `ok`; sealed package mutates silently | contain + fix target 14 days |
| High | verifier bypass on a configured path; key handling flaw | 30 days |
| Medium | degraded export, misleading report section | 60 days |
| Low | cosmetic, docs, non-security | next release |

## 3. Containment

1. Preserve the first failing artefact and its hash; do not re-seal or “fix” evidence.
2. Pin the affected version; stop publishing that artefact.
3. If a release signature/key is involved, publish an advisory and rotate the release key
   outside the repository; never commit a private key.
4. If a TSA/Aegis endpoint is suspected, disable the optional mode and record the
   `tsaDegraded`/anchor state; do not silently fall back to local time.

## 4. Eradication and recovery

- Reproduce with a minimal package in `cli/test/fixtures/`; add a regression case before the fix.
- Re-run `test-runner`, `--full`, `audit-acceptance`, `doctor`, `read-only-scanner`,
  `verify-licensing`, `ui-browser-check`, `nine-oh --strict`.
- Rebuild the release artefact and verify the detached Ed25519 signature + SHA256SUMS.
- Publish the advisory with affected/fixed versions and the verification steps.

## 5. Post-incident

- Record timeline (UTC), impact, root cause, detection gap and the regression case.
- Update `KNOWN_ISSUES.md` and the release checklist; no “silent” closure.
- Notify the operator only through the channel it configured; do not email evidence.

## 6. What the publisher cannot do

The publisher cannot recover a customer's local evidence, decrypt a customer passphrase, or
delete a customer's local files. Those remain with the operator/controller.
