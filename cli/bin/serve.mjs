#!/usr/bin/env node
/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */
// Zero-dependency static server for the offline PWA. Loopback only by default.
// No directory listing, no path traversal, no remote fetch, no telemetry.
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.zip': 'application/zip', '.pem': 'application/x-pem-file', '.sig': 'application/octet-stream',
  '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm'
};

function parseArgs(argv) {
  const out = { root: DEFAULT_ROOT, host: '127.0.0.1', port: 8123 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') out.root = path.resolve(argv[++i] || DEFAULT_ROOT);
    else if (a === '--host') out.host = argv[++i] || out.host;
    else if (a === '--port') out.port = Number(argv[++i]) || out.port;
    else if (a === '--help' || a === '-h') {
      process.stdout.write('Usage: node cli/bin/serve.mjs [--root DIR] [--host HOST] [--port N]\n');
      process.exit(0);
    }
  }
  return out;
}

const opts = parseArgs(process.argv.slice(2));
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname);
    if (rel.indexOf('\0') !== -1) { res.writeHead(400).end('bad path'); return; }
    if (rel === '/') rel = '/pwa/index.html';
    // Reject traversal and empty segments outright (same policy as ZIP extraction).
    // Skip the leading empty segment produced by the initial '/'.
    const parts = rel.split('/').slice(1);
    if (parts.some((p) => p === '..' || p === '.' || p === '')) { res.writeHead(403).end('forbidden path'); return; }
    const file = path.resolve(opts.root, '.' + rel);
    if (!file.startsWith(opts.root + path.sep) && file !== opts.root) { res.writeHead(403).end('forbidden path'); return; }
    const info = await stat(file);
    if (!info.isFile()) { res.writeHead(404).end('not found'); return; }
    const ext = path.extname(file).toLowerCase();
    const headers = {
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': info.size,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'cache-control': ext === '.html' || file.endsWith('sw.js') ? 'no-store' : 'public, max-age=300'
    };
    res.writeHead(200, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(file).pipe(res);
  } catch (e) {
    res.writeHead(e && e.code === 'ENOENT' ? 404 : 400).end('not found');
  }
});

server.listen(opts.port, opts.host, () => {
  process.stdout.write('FIELDSEAL-SERVE http://' + opts.host + ':' + opts.port + '/pwa/index.html\n');
  process.stdout.write('root=' + opts.root + '  (loopback only; Ctrl+C to stop)\n');
});
server.on('error', (e) => {
  process.stderr.write('FIELDSEAL-SERVE-FAILED ' + e.message + '\n');
  process.exit(1);
});
