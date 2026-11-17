# Governance — FieldSeal Suite

This document describes how the project is maintained and how decisions are made. It is
short on purpose: the project has one core promise (a small, hash-bound, dependency-free
verification kernel) and a narrow trust contract.

## 1. Maintainers

FieldSeal Suite is maintained by the **FieldSeal Suite project** (Jerome Young / Yang Jie,
Beijing, China) — see `NOTICE` for the copyright holder and `LICENSE` for the licence.

Maintainer responsibilities:

- Review and merge pull requests; keep the trusted kernel's dependency boundary intact.
- Cut releases and sign release artefacts (see `docs/RELEASE-NOTES.md`).
- Respond to security reports through the private advisory (see `SECURITY.md`).
- Maintain the legal document set (`LICENSE`, `NOTICE`, `TRADEMARK.md`, `EULA.md`,
  `PRICING.md`, `COMMERCIAL-LICENSE.md`, `SBOM.md`, `SBOM.cdx.json`) so that no document
  contradicts the MIT licence or the others — enforced by `scripts/verify-licensing.mjs`.

Contributors are listed in `CONTRIBUTING.md` and in the git history. Contributions are
accepted under the MIT License with a DCO sign-off; no CLA is required.

## 2. How decisions are made

- **Specification changes are the main decision surface.** `SPEC.md` (evidence format) and
  `docs/SPEC-case.md` (case layer) are the source of truth. A change to the hash algorithm,
  `sealHash` aggregation, verdict priority or schema is a **breaking change** and requires
  prior discussion in an issue before a pull request.
- **Additive-only by default.** New capabilities extend the manifest through the controlled
  extension mechanism (`docs/SPEC-case.md` §10.2) so that already-accepted hashes stay
  byte-identical. Golden fixtures (`cli/test/fixtures/golden/`) pin that property.
- **The dependency boundary is a hard constraint.** The trusted kernel (`cli/core`,
  `pwa/core`) must stay free of runtime dependencies. The `pwa/vendor/` directory is for
  **first-party adapters only** — third-party code keeps its own upstream licence and must
  never carry a FieldSeal copyright header.
- **Decisions are recorded.** Anything that changes observable behaviour is written down in
  `docs/CHANGELOG-v0.5.md` / `CHANGELOG.md` and, where it matters for operators, in
  `docs/RELEASE-NOTES.md`.
- **No feature is added that would require the software to phone home.** Out-of-band
  integrations (Aegis hash-anchor, external RFC3161 TSA) stay optional and default **off**.

## 3. Versions and releases

- The current release line is **v0.5**. Version numbers are not invented for marketing
  reasons; the watermark version in `pwa/helpers/attribution.js` and the released version
  always agree.
- A release ships with: the local gates green (`node cli/test/test-runner.js --full`,
  `audit-acceptance`, `doctor`, `read-only-scanner`, `verify-licensing`, `nine-oh --strict`),
  a release note in `docs/RELEASE-NOTES.md`, and signed artefacts where applicable
  (`docs/RELEASE-ROLLBACK.md`, `docs/runbook.md`).
- Score figures are **generated** by `node cli/bin/nine-oh.mjs --json` and are never edited
  by hand. If a target score is not reached, the gap is reported, not papered over.

## 4. Security reports

- Report vulnerabilities through the **private repository security advisory** described in
  `SECURITY.md` — never as a public issue. `docs/security-contact.md` is the single source
  of the reporting channel.
- Maintainers aim to acknowledge within **2 days** and to triage within the window stated in
  `SECURITY.md`. These are best-effort targets for a volunteer-maintained project.
- Supported versions are listed in `SECURITY.md` (currently v0.5 and v0.4).
- Security fixes are released as a patch version and announced in `docs/RELEASE-NOTES.md`.

## 5. Trademarks and naming

- "FieldSeal", "FieldSeal Suite", the project name and logo, and the footer mark are
  trademarks of the FieldSeal Suite project. The MIT License grants **no** trademark rights
  — see `TRADEMARK.md`.
- Nominative fair use is allowed: stating factually that a deployment is "based on FieldSeal
  Suite" is fine, provided the attribution watermarks are retained.
- MIT requires the copyright notice and permission notice to travel with copies or substantial
  portions of the Software; that is the licence condition. The footer signature and generated
  provenance fields are a project attribution convention and a trademark/nominative-use rule.
  Removing source copyright/permission notices is a licence breach; removing a runtime footer
  from your own output is a branding/trademark issue, not a MIT condition. Re-branding under
  your own name is permitted.
- Third-party names and logos in `SBOM.md`, `NOTICE` and the documentation belong to their
  respective owners and are used descriptively only.
