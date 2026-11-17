/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */
/**
 * Aegis crypto HTTP agent (P2-b) — optional thin service exposing aegis-core over node:http for an
 * intranet. All secrets (passphrases / private keys) arrive in the request body, are used in memory
 * only, and are NEVER written to disk or logged. No persistence, no third-party deps.
 *
 * Endpoints:
 *   GET  /health                 (open, liveness only)
 *   POST /aegis/wrap            { manifest, recipients:[{memberId,publicKeyPem}] }
 *   POST /aegis/open            { envelope, memberId, privateKeyPem }
 *   POST /aegis/decrypt-storage { cipherB64, meta, passphrase }
 *
 * Security (delivery-audit RB-01): EVERY non-health request requires
 * `Authorization: Bearer <AEGIS_SECRET>`. Without a configured secret the agent
 * refuses ALL such requests with 401 (fail-closed). `main()` binds to 127.0.0.1
 * by default; override with BIND_HOST only for an intentionally exposed, firewalled
 * interface. This mirrors tools/archive-agent and tools/receipt-service.
 */
import { createServer as httpCreateServer } from 'node:http';
import {
  wrapAegis, openAegis, decryptStorageCipher
} from './aegis-core.mjs';

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => { chunks.push(c); if (Buffer.concat(chunks).length > 32 * 1024 * 1024) reject(new Error('payload too large')); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

export function createServer({ secret = '' } = {}) {
  const bearerOk = (req) => !!secret && (req.headers['authorization'] || '') === 'Bearer ' + secret;
  return httpCreateServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') return sendJson(res, 200, { ok: true, service: 'aegis-crypto' });
      // Fail-closed gate: no secret configured => nothing but /health is reachable.
      if (!bearerOk(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      const body = await readBody(req);
      if (req.url === '/aegis/wrap') {
        const envelope = wrapAegis(body.manifest, body.recipients || []);
        return sendJson(res, 200, { envelopeSpec: envelope.envelopeSpec, envelope });
      }
      if (req.url === '/aegis/open') {
        const plain = openAegis(body.envelope, body.memberId, body.privateKeyPem);
        return sendJson(res, 200, { plain });
      }
      if (req.url === '/aegis/decrypt-storage') {
        const cipherBytes = Buffer.from(body.cipherB64 || '', 'base64');
        const res2 = decryptStorageCipher(cipherBytes, body.meta, body.passphrase);
        return sendJson(res, res2.status === 'ok' ? 200 : 400, res2);
      }
      return sendJson(res, 404, { error: 'not found' });
    } catch (e) {
      sendJson(res, 400, { error: String((e && e.message) || e) });
    }
  });
}

export async function main() {
  const secret = process.env.AEGIS_SECRET;
  if (!secret) {
    process.stderr.write('[aegis] AEGIS_SECRET is required (refusing to start an unauthenticated agent)\n');
    process.exit(1);
  }
  const port = Number(process.env.AEGIS_PORT || 8771);
  const host = process.env.BIND_HOST || '127.0.0.1';
  const server = createServer({ secret });
  server.listen(port, host, () => process.stdout.write('[aegis] listening on http://' + host + ':' + port + '\n'));
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
