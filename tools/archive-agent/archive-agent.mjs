/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * Read-only audit-log archive agent (P0 #3). A lightweight Node backend that receives audit-log
 * entries + the case rootHash and appends them to a tamper-evident, append-only store. It NEVER
 * accepts the original evidence package. The backend only receives, stores and indexes — it does
 * NOT recompute trust hashes; the trust root stays the locally produced case package.
 *
 * Run:  node archive-agent.mjs            (local filesystem backend, ./archive-data)
 *       S3_BUCKET=... S3_ENDPOINT=... node archive-agent.mjs   (S3/R2 backend)
 *
 * Env:  PORT (8787), ARCHIVE_DIR (./archive-data), REDACT_SALT, MAX_BODY_BYTES (65536),
 *       S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY,
 *       S3_SESSION_TOKEN, S3_PREFIX (audit).
 */
import http from 'node:http';
import { AppendLog } from './archive-core.mjs';
import { LocalBackend, } from './local-backend.mjs';
import { S3R2Backend, selfTestSigV4 } from './s3r2.mjs';

// Keys that must never appear in an archive payload — they signal an evidence-package upload,
// which this agent is explicitly forbidden from storing.
const FORBIDDEN_KEYS = ['evidencePackage', 'evidence', 'files', 'zip', 'blob', 'buffer', 'binary', 'attachment'];
const MAX_STRING_LEN = 8192; // an audit record field is short; larger values smell like blobs.

/** Pure guard: returns true if the payload looks like an evidence upload (must be rejected). */
export function isEvidencePayload(value, _depth = 0) {
  if (value == null || _depth > 8) return false;
  if (typeof value === 'string') return value.length > MAX_STRING_LEN;
  if (Buffer.isBuffer(value)) return true;
  if (Array.isArray(value)) return value.some((v) => isEvidencePayload(v, _depth + 1));
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.includes(k)) return true;
      if (isEvidencePayload(v, _depth + 1)) return true;
    }
  }
  return false;
}

function normalizePayload(body) {
  // Accept either a single record { rootHash, auditEntry } or { entries: [...] }.
  if (Array.isArray(body.entries)) return body.entries;
  if (body.auditEntry || body.rootHash !== undefined) return [body];
  if (body.event || body.auditLog) return [body];
  return [body];
}

export function createServer({ log, redactSalt = '', maxBodyBytes = 65536, secret = '' } = {}) {
  const bearerOk = (req) => (req.headers['authorization'] || '') === 'Bearer ' + secret;
  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, service: 'fieldseal-archive', readOnly: true }));
        return;
      }
      // Hard gate: posting records or reading the archive requires the shared secret as a bearer token.
      // /health stays open for liveness. Bind to 127.0.0.1 by default (override via BIND_HOST).
      if (secret && !bearerOk(req)) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
        return;
      }
      if (req.method === 'GET' && req.url === '/archive') {
        const records = await log.readVerified();
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, count: records.length, records }));
        return;
      }
      if (req.method === 'POST' && (req.url === '/archive' || req.url === '/entries')) {
        const chunks = [];
        let size = 0;
        for await (const c of req) {
          size += c.length;
          if (size > maxBodyBytes) { res.writeHead(413); res.end('payload too large'); return; }
          chunks.push(c);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (isEvidencePayload(body)) {
          res.writeHead(403, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'evidence packages are not accepted by the archive agent' }));
          return;
        }
        const records = normalizePayload(body);
        const ids = [];
        for (const r of records) ids.push(await log.append(r));
        await log.backend.updateIndexSafe?.();
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, accepted: ids.length, recordIds: ids }));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
    } catch (e) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }));
    }
  });
}

export async function main() {
  const s3Bucket = process.env.S3_BUCKET;
  let backend;
  if (s3Bucket) {
    selfTestSigV4();
    backend = new S3R2Backend({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION || 'auto',
      bucket: s3Bucket,
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      sessionToken: process.env.S3_SESSION_TOKEN,
      prefix: process.env.S3_PREFIX || 'audit'
    });
    console.error('[archive] S3/R2 backend enabled (bucket=' + s3Bucket + ')');
  } else {
    const dir = process.env.ARCHIVE_DIR || './archive-data';
    backend = new LocalBackend(dir);
    console.error('[archive] local backend enabled (dir=' + dir + ')');
  }
  const log = new AppendLog(backend, { salt: process.env.REDACT_SALT || '' });
  // After appends, refresh the derived index if the backend supports it.
  log.backend.updateIndexSafe = async () => {
    if (typeof backend.updateIndex === 'function') {
      const recs = await log.readVerified().catch(() => []);
      await backend.updateIndex(recs);
    }
  };
  const port = Number(process.env.PORT || 8787);
  const secret = process.env.ARCHIVE_SECRET;
  if (!secret) { console.error('[archive] ARCHIVE_SECRET is required'); process.exit(1); }
  const host = process.env.BIND_HOST || '127.0.0.1';
  const server = createServer({ log, redactSalt: process.env.REDACT_SALT || '', maxBodyBytes: Number(process.env.MAX_BODY_BYTES || 65536), secret });
  server.listen(port, host, () => console.error('[archive] listening on http://' + host + ':' + port));
  return server;
}

// updateIndexSafe shim name used above; ensure LocalBackend has updateIndex (it does).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
