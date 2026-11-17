# FieldSeal Suite — NTP Reference-Time Agent

> Optional add-on; never a hard dependency of the mainline. It **only provides a trusted reference clock**. It never modifies, overwrites, or replaces native UTC timestamps in a case or audit log, and it never participates in any trust-hash computation.

## Purpose

Provide a **read-only** NTP reference time source for field forensic workflows, used for **post-hoc audit comparison** and **clock-drift checks** after sealing/countersigning. Typical use: write the agent's `referenceNtpTime` as an additional audit-log field, then compare device-local time against public NTP time.

## Boundaries (iron rules)

| Constraint | Meaning |
| --- | --- |
| Reference, never overwrite | `createdAt` / `sealedAt` / `countersignAt` in a case or audit log **always** use the local browser/node native UTC time. `referenceNtpTime` is an extra comparison field and **never replaces** the original time. |
| Not in root hash | This module does not participate in `sealHash` aggregation; `referenceNtpTime` is never in the root hash and is audit-context only. |
| Read-only NTP | A simplified RFC 5905 client (UDP, reads the transmit timestamp only); it **never writes** NTP, never corrects, never changes the OS clock. |
| Zero dependency | Node built-ins only (`node:dgram`, `node:http`); no third-party library / CDN / npm package. |
| No kernel intrusion | Does not modify `case-manifest.js`, `hash.js`, or any other trust-kernel line. |
| Graceful degradation | Network failure / timeout returns `status=timeout` or `invalid`; **no uncaught exception**, never blocks sealing/countersigning. |
| Privacy | Queries public NTP pools only; collects no case content, evidence, or operator data; no disk persistence by default; one query, one return. |

## Output shape

```json
{
  "ntpServer": "pool.ntp.org",
  "referenceNtpTime": "2026-11-13T09:00:01.234Z",
  "localSystemTime": "2026-11-13T09:00:00.000Z",
  "driftMs": 1234,
  "queryAt": "2026-11-13T09:00:00.000Z",
  "status": "ok" | "timeout" | "invalid"
}
```

- `driftMs`: local system time minus NTP reference time in milliseconds; positive means the local clock is ahead.
- `status`: `ok` / `timeout` (default 2000 ms) / `invalid` (malformed response or parse failure).

## Running

### HTTP proxy (optional, for PWA intranet reference time)

```bash
node ntp-proxy.mjs
# environment: PORT(8790) NTP_SERVER(pool.ntp.org) NTP_TIMEOUT_MS(2000)

curl http://localhost:8790/health
curl "http://localhost:8790/ntp?server=pool.ntp.org"
curl "http://localhost:8790/ntp/batch?server=pool.ntp.org&server=time.cloudflare.com"
```

### As a library

```js
import { queryNtp, queryNtpBatch, mergeReferenceTime } from './ntp-client.mjs';

const ntp = await queryNtp({ server: 'pool.ntp.org', timeoutMs: 2000 });
// attach only; never overwrite:
const auditWithRef = mergeReferenceTime(auditEntry, ntp);
```

## Self-test

```bash
node test-ntp.mjs
```

> Test 1 (live NTP) requires outbound UDP; in a sandbox without network it is **SKIP** (not a failure). All other cases (timeout degradation, malformed packet rejection, merge without overwriting native time, HTTP proxy round-trip, batch) are offline deterministic and must pass.

## Important risk notice

**NTP reference time is for audit comparison only and must never be the sole basis for a forensic timestamp.** NTP alone has no strong anti-tampering or anti-MITM property (unless combined with RFC 3161 trusted timestamps / trusted time anchoring). Any judicial or compliance time determination must rely on the native UTC fields recorded in the case and audit log; `referenceNtpTime` is only for spotting obvious drift or anomalies.
