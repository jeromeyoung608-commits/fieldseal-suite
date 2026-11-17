/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * NTP reference-time client (P1 #2). A read-only, simplified RFC 5905 NTP client over UDP.
 *
 * BOUNDARY (hard):
 *   - This is a REFERENCE clock only. It NEVER writes, corrects, or overrides the case / audit-log
 *     native UTC timestamps (createdAt / sealedAt / countersignAt). Its output is carried as a
 *     separate `referenceNtpTime` field for post-hoc audit comparison only.
 *   - It does NOT participate in sealHash aggregation and is NOT part of the root hash.
 *   - It never modifies the OS clock and performs no time sync.
 *   - Single query, single return; no persistent storage, no disk writes by default.
 *   - No third-party libraries — Node built-ins only (node:dgram).
 *
 * Output shape: { ntpServer, referenceNtpTime, localSystemTime, driftMs, queryAt, status }.
 */
import dgram from 'node:dgram';

// Seconds between the NTP epoch (1900-01-01) and the Unix epoch (1970-01-01).
export const NTP_EPOCH_OFFSET = 2208988800;

/** Parse the NTP transmit timestamp (bytes 40..47 of the 48-byte header). Throws on malformed. */
export function parseTransmitTimestamp(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 48) throw new Error('NTP response too short / malformed');
  const mode = buf[0] & 0x07; // response must come from a server (mode 4) or broadcast (mode 5)
  if (mode !== 4 && mode !== 5) throw new Error('NTP response not from a server (mode=' + mode + ')');
  return { sec: buf.readUInt32BE(40), frac: buf.readUInt32BE(44) };
}

/** Convert an NTP (sec, frac) timestamp to Unix milliseconds. */
export function ntpToUnixMs({ sec, frac }) {
  return (sec - NTP_EPOCH_OFFSET) * 1000 + Math.round((frac / 0x100000000) * 1000);
}

/**
 * Query one NTP server. Always resolves (never rejects) with the documented structure; network
 * failure / timeout degrade to status 'timeout' or 'invalid' and never throw to the caller.
 */
export function queryNtp({ server, port = 123, timeoutMs = 2000, version = 3 } = {}) {
  return new Promise((resolve) => {
    const queryAt = new Date().toISOString();
    let settled = false;
    const base = {
      ntpServer: server,
      referenceNtpTime: null,
      localSystemTime: null,
      driftMs: null,
      queryAt,
      status: 'ok'
    };
    const finish = (val) => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch (e) { /* ignore */ }
      resolve(val);
    };
    const socket = dgram.createSocket('udp4');
    const timer = setTimeout(() => {
      finish({ ...base, localSystemTime: new Date().toISOString(), status: 'timeout' });
    }, timeoutMs);

    socket.on('error', (err) => {
      clearTimeout(timer);
      finish({ ...base, localSystemTime: new Date().toISOString(), status: 'invalid', error: String((err && err.message) || err) });
    });

    socket.on('message', (msg) => {
      clearTimeout(timer);
      const localSystemTime = new Date().toISOString();
      let referenceNtpTime = null, driftMs = null, status = 'ok';
      try {
        const ts = parseTransmitTimestamp(msg);
        const unixMs = ntpToUnixMs(ts);
        referenceNtpTime = new Date(unixMs).toISOString();
        driftMs = Date.now() - unixMs;
      } catch (e) {
        status = 'invalid';
      }
      finish({ ...base, referenceNtpTime, localSystemTime, driftMs, status });
    });

    const req = Buffer.alloc(48);
    req[0] = (version << 3) | 0x03; // LI=0, VN=version, Mode=3 (client)
    socket.send(req, 0, req.length, port, server, (err) => {
      if (err) {
        clearTimeout(timer);
        finish({ ...base, localSystemTime: new Date().toISOString(), status: 'invalid', error: String((err && err.message) || err) });
      }
    });
  });
}

/** Batch query multiple servers; each result is independent and never throws. */
export async function queryNtpBatch(servers = [], opts = {}) {
  return Promise.all(servers.map((s) => queryNtp(typeof s === 'string' ? { ...opts, server: s } : { ...opts, ...s })));
}

/**
 * Attach the NTP reference time to an audit entry WITHOUT mutating the entry and WITHOUT overriding
 * any native time field. Returns a new object; the original createdAt / sealedAt / countersignAt are
 * preserved untouched.
 */
export function mergeReferenceTime(auditEntry, ntpResult) {
  return Object.assign({}, auditEntry, { referenceNtpTime: ntpResult });
}
