# FieldSeal Suite — `tools/pkg/` packaging layer (P2)

> This directory is a **packaging/distribution and unified-entry** layer. It **reimplements no logic, adds no dependency, and never touches kernel hashes**.

## Relationship to existing tools (important)

The backend scripts in the P2 requirement list (media-verify / batch verification / read-only archive agent / receipt service / NTP agent) were **already delivered under `tools/` with their own tests**:

| Capability | Existing implementation | Self-test |
| --- | --- | --- |
| Media hash verification + media inventory | `tools/media-verify.mjs` | P0#2 |
| Batch-read case ZIPs, parallel kernel verify, aggregate report | `tools/batch-verify.mjs` | P0#4 |
| Read-only fetch of case packages/index (local + S3/R2) | `tools/archive-agent/` | P0#3 |
| Forensic receipt (carrying a sealHash digest) | `tools/receipt-service/` | P1#1 |
| Reference NTP time agent | `tools/ntp-agent/` | P1#2 (dependencies documented in `ntp-agent/README.md`) |

Therefore `tools/pkg/` **does not copy** that code; it only provides:

- `pkg-launch.mjs` — one entry that forwards argv to the existing modules by subcommand (read-only proxy, zero logic duplication).
- `build-nexe.mjs` — **optional** static-binary packaging script; see the boundary note below.

## Boundary: nexe is a third-party tool

`build-nexe.mjs` packages the zero-dependency CLI verifier (`cli/bin/audit.js`) into a single executable for field machines without Node.
**nexe is a third-party packager, not a delivered product**: the repository root has no `package.json`/lockfile, nexe is never added to the repository and never imported at runtime; the output binary is a **distribution artifact**, not a code change. If nexe is not installed, the script prints a clear message and exits non-fatally.

## Usage

```bash
# forward to existing backend scripts (arguments passed through)
node tools/pkg/pkg-launch.mjs media-verify   <args...>
node tools/pkg/pkg-launch.mjs batch-verify   <casesDir>
node tools/pkg/pkg-launch.mjs archive-agent  [--port 8080]
node tools/pkg/pkg-launch.mjs receipt-service[--port 8082]
node tools/pkg/pkg-launch.mjs ntp-agent      [--port 8083]

# optional: build a static binary after installing nexe in an isolated workspace (outside this repository)
node tools/pkg/build-nexe.mjs
```

## Constraints

- `node:xxx` built-ins only; zero third-party runtime dependencies.
- Read-only consumption of cases/indexes; never recompute, modify, or overwrite `sealHash`/`rootHash`.
- No automatic upload, no outbound case data.
- Never modify `pwa/core` or `cli/core` kernel source.
