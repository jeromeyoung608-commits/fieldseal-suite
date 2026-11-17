/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
const SHA256_OID = [0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]; // 2.16.840.1.101.3.4.2.1
const ID_SIGNED_DATA = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x16, 0x01, 0x04]; // 1.2.840.113549.1.9.16.1.4

// ---- minimal DER (TLV) writer ------------------------------------------------------------
function derLen(n) {
 if (n < 0x80) return [n];
 const out = [];
 let x = n;
 while (x > 0) { out.unshift(x & 0xff); x >>= 8; }
 return [0x80 | out.length, ...out];
}
function tlv(tag, body) {
 // deep-flatten: body elements are themselves tlv arrays (seq/octet/integer), so flatten before measuring.
 const flat = [];
 const push = (x) => { if (Array.isArray(x)) x.forEach(push); else flat.push(x); };
 (Array.isArray(body) ? body : [body]).forEach(push);
 return [tag, ...derLen(flat.length), ...flat];
}
function seq(body) { return tlv(0x30, body); } // SEQUENCE
function octet(bytes) { return tlv(0x04, bytes); } // OCTET STRING
function integer(bytes) { // INTEGER (unsigned, minimal)
 let b = bytes.length ? bytes : [0];
 if (b[0] & 0x80) b = [0x00, ...b];
 return tlv(0x02, b);
}
function booleanTrue() { return tlv(0x01, [0xff]); }
function oid(arcs) { return tlv(0x06, arcs); }
function algorithmIdentifier(oidArcs) { return seq([...oid(oidArcs), ...tlv(0x05, [])]); } // + NULL params
function generalizedTime(iso) {
 // iso: 'YYYY-MM-DDTHH:mm:ssZ' -> DER GeneralizedTime 'YYYYMMDDHHMMSSZ' (bytes, not chars)
 const v = iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '');
 const bytes = [];
 for (let i = 0; i < v.length; i++) bytes.push(v.charCodeAt(i) & 0xff);
 return tlv(0x18, bytes);
}
function bytesToHex(b) { return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join(''); }
function hexToBytes(h) { const o = []; for (let i = 1; i < h.length; i += 2) o.push(parseInt(h.substr(i - 1, 2), 16)); return o; }

/** Build an RFC3161 TimeStampReq (DER) for the given hex hash. Returns Uint8Array. */
export function buildTimeStampReq(hashHex, opts = {}) {
 const algo = opts.algo || 'sha256';
 if (algo !== 'sha256') throw new Error('only sha256 supported in this minimal adapter');
 const messageImprint = seq([...algorithmIdentifier(SHA256_OID), ...octet(hexToBytes(hashHex))]);
 const nonce = integer(hexToBytes(opts.nonce || bytesToHex(crypto.getRandomValues(new Uint8Array(16)))));
 const body = seq([
 ...integer([0x01]), // version v1(1)
 ...messageImprint,
 ...nonce,
 ...booleanTrue() // certReq TRUE (ask TSA to include its cert)
 ]);
 return Uint8Array.from(seq(body));
}

// ---- minimal DER reader (enough to extract genTime + whole token) -----------------------
function readTlv(buf, off) {
 const tag = buf[off++];
 let len = buf[off++];
 let constructed = (tag & 0x20) !== 0;
 if (len & 0x80) {
 const n = len & 0x7f;
 len = 0;
 for (let i = 0; i < n; i++) len = (len << 8) | buf[off++];
 }
 const start = off;
 const end = off + len;
 return { tag, len, constructed, start, end, value: buf.slice(start, end) };
}
function findFirst(buf, tag, off = 0) {
 while (off < buf.length) {
 const t = readTlv(buf, off);
 if (t.tag === tag) return t.value;
 if (t.constructed) {
 const inner = findFirst(t.value, tag, 0);
 if (inner) return inner;
 }
 off = t.end;
 }
 return null;
}
function parseGeneralizedTime(value) {
 const s = Array.from(value).map((c) => String.fromCharCode(c)).join('');
// 'YYYYMMDDHHMMSSZ' -> ISO
 const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/);
 if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
 return s;
}

/**
 * Parse a TimeStampResp DER blob. Returns { status, genTime, rawTokenB64, algo, hashedMessageHex? }.
 * Best-effort: extracts genTime (GeneralizedTime) and the whole timeStampToken ContentInfo. Full
 * CMS/SignedData/cert-chain validation is intentionally out of scope (needs CA anchors).
 *
 */
export function parseTimeStampResp(derBytes) {
 const buf = Array.from(derBytes);
 const root = readTlv(buf, 0);
 // status PKIStatusInfo is the first SEQUENCE containing INTEGER status; we walk for the first INTEGER
 const statusTlv = findFirst(buf, 0x02, 0);
 const status = statusTlv ? statusTlv[0] : 0;
 if (status !== 0) return { status, genTime: null, rawTokenB64: null, error: 'TSA rejected (status=' + status + ')' };
 // whole timeStampToken = SECOND child SEQUENCE (ContentInfo) of the top-level TimeStampResp SEQUENCE
 let token = null;
 let seen = 0;
 let off = 0;
 const inner = root.value;
 while (off < inner.length) {
 const t = readTlv(inner, off);
 if (t.tag === 0x30) {
 seen++;
 if (seen === 2) { token = t.value; break; }
 }
 off = t.end;
 }
 const gt = findFirst(buf, 0x18, 0); // GeneralizedTime
 const genTime = gt ? parseGeneralizedTime(gt) : null;
 return {
 status,
 genTime,
 rawTokenB64: token ? btoaSafe(token) : null,
 verified: false // CA-chain signature verification is out-of-kernel
 };
}
function btoaSafe(bytes) {
 const bin = Array.from(bytes).map((c) => String.fromCharCode(c)).join('');
 if (typeof btoa === 'function') return btoa(bin);
 return Buffer.from(bytes).toString('base64');
}

/**
 * Request a timestamp for `hashHex` from `tsaUrl`. Never throws — returns a result object that can be
 * stored directly. On any failure returns { status:'pending', error }.
 *
 */
export async function requestTimestamp(tsaUrl, hashHex, opts = {}) {
 try {
 const req = buildTimeStampReq(hashHex, opts);
 const ctrl = new AbortController();
 const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || 8000);
 const resp = await fetch(tsaUrl, {
 method: 'POST',
 headers: { 'Content-Type': 'application/timestamp-query' },
 body: req,
 signal: ctrl.signal,
 cache: 'no-store'
 });
 clearTimeout(timer);
 if (!resp.ok) return { status: 'pending', error: 'TSA HTTP ' + resp.status, tsaUrl };
 const buf = new Uint8Array(await resp.arrayBuffer());
 const parsed = parseTimeStampResp(buf);
 if (parsed.status !== 0) return { status: 'pending', error: parsed.error, tsaUrl };
 return {
 status: 'fetched',
 tsaUrl,
 algo: opts.algo || 'sha256',
 hashHex,
 genTime: parsed.genTime,
 rawTokenB64: parsed.rawTokenB64,
 verified: false,
 fetchedAt: new Date().toISOString()
 };
 } catch (e) {
 return { status: 'pending', error: String(e && e.message || e), tsaUrl };
 }
}

// Exposed for tests / tooling: minimal DER building blocks + OIDs.
export { seq, integer, tlv, oid, generalizedTime, SHA256_OID, ID_SIGNED_DATA };
