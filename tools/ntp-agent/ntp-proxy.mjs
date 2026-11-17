/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * NTP reference-time HTTP proxy (P1 #2). A thin, optional local service so the PWA / intranet can
 * pull a reference clock without running its own UDP socket. It only forwards to ntp-client; it
 * inherits every boundary of that client: reference-only, never overrides native time, no disk,
 * no third-party deps (node:http only).
 *
 * Run:  node ntp-proxy.mjs
 * Env:  PORT (8790), NTP_SERVER (pool.ntp.org), NTP_TIMEOUT_MS (2000)
 */
import http from 'node:http';
import { queryNtp, queryNtpBatch } from './ntp-client.mjs';

export function createServer({ defaultServer = 'pool.ntp.org', timeoutMs = 2000 } = {}) {
  return http.createServer(async (req, res) => {
    const send = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') {
        send(200, { ok: true, service: 'fieldseal-ntp', referenceOnly: true, note: 'NTP reference time is advisory; it never overrides native case/audit timestamps.' });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/ntp') {
        const server = url.searchParams.get('server') || defaultServer;
        const t = Number(url.searchParams.get('timeout'));
        const result = await queryNtp({ server, timeoutMs: Number.isFinite(t) && t > 0 ? t : timeoutMs });
        send(200, result);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/ntp/batch') {
        const servers = url.searchParams.getAll('server');
        const list = servers.length ? servers : [defaultServer];
        const results = await queryNtpBatch(list, { timeoutMs });
        send(200, { ok: true, results });
        return;
      }
      send(404, { ok: false, error: 'not found' });
    } catch (e) {
      send(400, { ok: false, error: String((e && e.message) || e) });
    }
  });
}

export async function main() {
  const server = createServer({
    defaultServer: process.env.NTP_SERVER || 'pool.ntp.org',
    timeoutMs: Number(process.env.NTP_TIMEOUT_MS) || 2000
  });
  const port = Number(process.env.PORT || 8790);
  server.listen(port, () => console.error('[ntp] reference-time proxy listening on http://localhost:' + port));
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
