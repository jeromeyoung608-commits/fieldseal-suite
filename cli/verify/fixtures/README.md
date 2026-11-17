# Test-only TSA fixtures

The `*.key`, `*.pem`, `*.csr` and `*.srl` files here are a **fake, test-only** CA and leaf
used by `cli/verify/test-tsa-verify.mjs` to build an offline RFC3161 CMS self-test.

- They are **not** release-signing keys and are **not** part of the shipped runtime.
- They have no production trust and must never be used to sign real evidence.
- The release-signing private key is not in this repository; only
  `tools/build/dist/RELEASE-PUBLIC-KEY.pem` (public) is shipped.

The test runner's private-key scan excludes this directory for the reason above; all other
`.pem`/`.key` files are checked for a leaked release private key.
