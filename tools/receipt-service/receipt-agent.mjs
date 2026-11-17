/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * Evidence RECEIPT HTTP agent (P1 #1). Acknowledges receipt of a case reference and returns a
 * signed receipt. It NEVER accepts or stores the evidence package. Optionally forwards a receipt
 * pointer to Aegis via a webhook (RECEIPT_ONLY — never evidence).
 *
 * Run:  node receipt-agent.mjs
 * Env:  PORT (8788), RECEIPT_SECRET (required), RECEIPT_DIR (./receipt-data),
 *       AEGIS_WEBHOOK (optional https URL), REDACT_SALT (optional)
 */
import http from 'node:http';
import { promises as fs } from 'node:fs';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { issueReceipt, verifyReceipt, isEvidencePayload, RECEIPT_KIND } from './receipt-core.mjs';

export function createServer({ secret, dir, aegisWebhook }) {
  const store = join(dir, 'receipts');
  if (!existsSync(store)) mkdirSync(store, { recursive: true });
  const bearerOk = (req) => (req.headers['authorization'] || '') === 'Bearer ' + secret;
  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, service: 'fieldseal-receipt', receiptNotEvidence: true }));
        return;
      }
      // Hard gate: any state-changing or read of receipt records requires the shared secret as a bearer
      // token. /health stays open for liveness. Bind to 127.0.0.1 by default (override via BIND_HOST).
      if (secret && !bearerOk(req)) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
        return;
      }
      if (req.method === 'POST' && req.url === '/receipt') {
        const chunks = [];
        let size = 0;
        for await (const c of req) {
          size += c.length;
          if (size > 65536) { res.writeHead(413); res.end('payload too large'); return; }
          chunks.push(c);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (isEvidencePayload(body)) {
          res.writeHead(403, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'evidence packages are not accepted by the receipt service' }));
          return;
        }
        // Only a reference (rootHash/sealHash + metadata) may be submitted.
        const subject = {
          rootHash: body.rootHash || null,
          sealHash: body.sealHash || null,
          metadata: body.metadata || body
        };
        if (!subject.rootHash && !subject.sealHash) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'submit at least one of rootHash/sealHash' }));
          return;
        }
        const receipt = issueReceipt(subject, { secret });
        await fs.writeFile(join(store, receipt.receiptId + '.json'), JSON.stringify(receipt, null, 2), 'utf8');
        if (aegisWebhook) {
          // Forward RECEIPT ONLY (never evidence). Best-effort; failures are logged, not fatal.
          try {
            await fetch(aegisWebhook, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ kind: RECEIPT_KIND, receiptId: receipt.receiptId, receivedUtc: receipt.receivedUtc, subjectHash: receipt.subjectHash })
            });
          } catch (e) { console.error('[receipt] Aegis webhook failed (non-fatal): ' + e.message); }
        }
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, receipt }));
        return;
      }
      if (req.method === 'GET' && req.url && req.url.startsWith('/receipt/')) {
        const id = req.url.split('/')[2];
        try {
          const r = JSON.parse(await fs.readFile(join(store, id + '.json'), 'utf8'));
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, verified: verifyReceipt(r, secret), receipt: r }));
        } catch (e) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'receipt not found' }));
        }
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
  const secret = process.env.RECEIPT_SECRET;
  if (!secret) { console.error('[receipt] RECEIPT_SECRET is required'); process.exit(1); }
  const dir = process.env.RECEIPT_DIR || './receipt-data';
  const aegis = process.env.AEGIS_WEBHOOK || null;
  const server = createServer({ secret, dir, aegisWebhook: aegis });
  const port = Number(process.env.PORT || 8788);
  const host = process.env.BIND_HOST || '127.0.0.1';
  server.listen(port, host, () => console.error('[receipt] listening on http://' + host + ':' + port + (aegis ? ' (Aegis webhook: ' + aegis + ')' : '')));
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
