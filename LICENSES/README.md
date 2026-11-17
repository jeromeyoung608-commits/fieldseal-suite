# LICENSES

This repository has **no third-party runtime license texts**, because FieldSeal Suite has
zero third-party runtime dependencies. The trusted kernel uses only Node.js built-in
modules and Web-native APIs; the browser-facing files under `pwa/vendor/` are
first-party adapters written by the project, not vendored third-party libraries.

The project's own license is the **MIT License**, in the repository-root `LICENSE`.
Build-only tooling under `tools/build/` may be present in a source checkout for
reproducible builds, but it is not executed by the product or Docker image and its
npm dependency is never installed. Test-only tooling (Playwright/Chrome) is not
shipped either. See `THIRD-PARTY.md` for exact packages, versions and licenses. Optional
external services (the "Aegis" hash-anchor toggle and an external RFC3161 TSA) are
out-of-band integrations the operator explicitly enables; no third-party code is
embedded or redistributed. See `NOTICE`, `SBOM.md` and
`docs/EXTERNAL-TSA-DISCLOSURE.md`.
