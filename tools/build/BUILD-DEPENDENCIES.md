# Build Dependency Lock (reproducible offline builds)

Version 1.0 · 2026-11-14 · `tools/build/`

## Why there is no `package-lock.json` in the delivery

The shipped product is **zero-dependency**: delivery gates `S-01`, `S-06` and
`cli/test/read-only-scanner.cjs` reject any `package.json` / `package-lock.json` /
`node_modules` inside the trusted core and any lockfile anywhere in the repository.
That is a deliberate product property, not an oversight. `tools/build/package.json`
is exempt because it is build scaffolding only: it is not executed by the product or
Docker runtime, and no npm dependency is installed at runtime. A lockfile next to it
would still trip `S-06`, so none is shipped. The source may be present in a checkout for
reproducible builds.

Therefore the build input is locked by **exact version + registry integrity hash**
instead of by a lockfile in the repository. A full `package-lock.json` may be kept
on the (non-delivery) build machine; it must never be copied into the release tree.
`doctor.mjs` enforces the exact-pin rule on every run.

## Pinned build input

| Package | Exact version | `dist.integrity` (sha512) | Purpose |
|---|---|---|---|
| `pkg` (`@yao-pkg/pkg`) | `5.8.1` | `sha512-CjBWtFStCfIiT4Bde9QpJy0KeH19jCfwZRJqHFDFXfhUklCx8JoFmMj3wgnEYIwGmZVNkhsStPHEOnrtrQhEXA==` | Bundles the Node CLI into four standalone binaries |

Verify the pin without installing anything:

```sh
npm view pkg@5.8.1 dist.integrity
node -e "const p=require('./tools/build/package.json'); console.log(p.devDependencies)"
node cli/bin/doctor.mjs --json       # check "build.pins"
```

`pkg` additionally downloads a Node runtime base image per target at build time.
Those images are cached under `~/.pkg-cache` on the build machine. For an
air-gapped build, pre-populate that cache from a trusted offline medium; the build
script itself never contacts a customer environment.

## Reproducing the release binaries

```sh
cd tools/build
npm install --no-audit --no-fund       # resolves ONLY the exact pin above
npm run build                          # writes dist/* + SHA256SUMS + manifest.json
cd ../..
node tools/release/release-tool.mjs sign
node tools/build/verify-binaries.mjs
node cli/test/test-runner.js --full     # S-22 source/binary verdict parity
rm -rf tools/build/node_modules tools/build/package-lock.json
```

The last line is mandatory: build scaffolding must not leak into the delivery tree
(gate `S-06`).

## Trust boundary

- Build scaffolding runs only on the publisher's build machine; it never sees
  customer evidence or personal data.
- The delivered binaries are verified offline with the bundled Ed25519 public key.
- The product's runtime dependency count remains **0** at all times.
