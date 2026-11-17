# Contributing — FieldSeal Suite

FieldSeal Suite is an **open-source project under the MIT License**. Contributions are welcome.
The trusted core is intentionally small and hash-bound; unsolicited refactors of
`cli/core` / `pwa/core` are not accepted because they can change the evidentiary contract.

## What is welcome

- **Bug reports** with a minimal reproduction, version, platform and the exact command/output.
- **Security reports** through the private advisory in `SECURITY.md` — never a public issue.
- **Documentation corrections** (typos, broken links, stale counts) via an issue; do not send
  a patch that changes legal terms.
- **Accessibility feedback** with the page, assistive technology and steps.

## What is not accepted without a prior agreement

- Changes to the hash algorithm, `sealHash` aggregation, verdict priority or schema.
- Removal/obfuscation of copyright headers, the `FieldSeal Suite v0.5` footer, the MIT
  notices or provenance fields.
- New runtime dependencies, CDN imports, frameworks, telemetry or analytics.
- Third-party code in `pwa/vendor/` (that directory is for first-party adapters only).
- Legal, pricing or trademark text changes.

## Local checks

```bash
node cli/test/test-runner.js
node cli/test/test-runner.js --full
node cli/test/read-only-scanner.cjs all
node scripts/verify-licensing.mjs
node cli/bin/doctor.mjs
```

A change that touches `pwa/core` or `cli/core` must also run `--full` and the golden anchor;
a change that touches a page must keep the 14/14 footer scan green.

## Licensing of contributions

By submitting a contribution you confirm that you have the right to license it under the
**MIT License**, and you agree that the contribution is accepted under those terms.
**No CLA is required** — a sign-off is sufficient.

Sign-off (trailer in your commit message):

```
Signed-off-by: Your Name <your@email>
```

`git commit -s` adds it automatically. This is a Developer Certificate of Origin (DCO)
sign-off, **not** a copyright assignment — you keep your copyright; you grant the project
permission to use and redistribute the contribution under MIT.

Do not submit code you cannot license under MIT.

## Third-party dependencies

The project ships **zero third-party runtime dependencies** by design. Pull requests that
add an npm package, a CDN script, a framework, telemetry or analytics to the runtime are
not accepted. If a contribution genuinely needs one, open an issue first and discuss the
dependency boundary — the trusted kernel (`cli/core`, `pwa/core`) must stay dependency-free.
