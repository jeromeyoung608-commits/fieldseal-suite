/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 *
 * tsa-verify — OFFLINE RFC3161 Trusted-Timestamp token verifier (court-admissibility aid).
 *
 * Context: the PWA TSA adapter (pwa/vendor/tsa-timestamp.js) only FETCHES a timestamp token and stores it
 * additive/non-trust. It deliberately does NOT validate the TSA's CA chain (that needs CA trust anchors and
 * must stay OUT of the zero-trust kernel). This CLI closes that gap: it lets an operator verify a captured
 * token offline before relying on it as evidence.
 *
 * What it verifies (all offline, no network):
 *   1. CMS SignedData structure parses (ContentInfo -> SignedData -> SignerInfo + certificates + eContent).
 *   2. The message imprint inside the TSTInfo matches an expected hash (confirms the token timestamps the
 *      exact case rootHash you claim), and the hash algorithm matches.
 *   3. The SignerInfo signature over the signed attributes verifies against the signer certificate's public key.
 *   4. The message-digest signed attribute equals SHA-256(eContent) (confirms the signature covers the tstInfo).
 *   5. A certificate chain from the signer cert up to a USER-SUPPLIED trust anchor (--ca) builds and every
 *      cert is within its validity window.
 *
 * Out of scope (would require network / CA trust bundles, intentionally NOT done here): OCSP / CRL revocation
 * checks. Document this limitation in the verification report.
 *
 * Zero third-party dependencies: Node built-in `node:crypto` only. No remote URLs (keeps the S-04 gate clean).
 */
'use strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// ---- OID constants --------------------------------------------------------
export const OID = {
  signedData: '1.2.840.113549.1.7.2',
  tstInfo: '1.2.840.113549.1.9.16.1.4',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
  rsaSha256: '1.2.840.113549.1.1.11',
  ecdsaSha256: '1.2.840.10045.4.3.2',
  sha256: '2.16.840.1.101.3.4.2.1'
};
const OID_TO_HASH = { [OID.sha256]: 'sha256' };
const OID_TO_SIGN = { [OID.rsaSha256]: 'RSA-SHA256', [OID.ecdsaSha256]: 'sha256' };

// ---- Minimal DER codec (enough for CMS / RFC3161) -------------------------
export function encLen(n) {
  if (n < 0x80) return Buffer.from([n]);
  const out = [];
  let x = n;
  while (x > 0) { out.unshift(x & 0xff); x = Math.floor(x / 256); }
  return Buffer.from([0x80 | out.length, ...out]);
}
function tlv(tag, content) {
  content = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return Buffer.concat([Buffer.from([tag]), encLen(content.length), content]);
}
export function seq(...parts) { return tlv(0x30, Buffer.concat(parts.map((p) => Buffer.isBuffer(p) ? p : Buffer.from(p)))); }
export function setOf(...parts) { return tlv(0x31, Buffer.concat(parts.map((p) => Buffer.isBuffer(p) ? p : Buffer.from(p)))); }
export function octetStr(buf) { return tlv(0x04, buf); }
export function implicit(tag, content) { return tlv(tag, content); }
export function algId(oidStr) { return seq(oidEnc(oidStr), Buffer.from([0x05, 0x00])); }
export function intEnc(numOrBuf) {
  let bytes;
  if (typeof numOrBuf === 'number' || typeof numOrBuf === 'bigint') {
    let v = BigInt(numOrBuf);
    if (v < 0n) throw new Error('negative INTEGER not supported');
    bytes = [];
    if (v === 0n) bytes = [0];
    while (v > 0n) { bytes.unshift(Number(v & 0xffn)); v >>= 8n; }
  } else {
    bytes = [...Buffer.from(numOrBuf)];
  }
  if ((bytes[0] & 0x80) !== 0) bytes.unshift(0);
  return tlv(0x02, Buffer.from(bytes));
}
export function oidEnc(s) {
  const p = s.split('.').map(Number);
  const body = [p[0] * 40 + p[1]];
  for (let i = 2; i < p.length; i++) {
    let v = p[i];
    const out = [v & 0x7f];
    v = Math.floor(v / 128);
    while (v > 0) { out.unshift((v & 0x7f) | 0x80); v = Math.floor(v / 128); }
    body.push(...out);
  }
  return tlv(0x06, Buffer.from(body));
}
export function genTimeEnc(date) {
  const s = date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return tlv(0x18, Buffer.from(s));
}

function decodeLen(buf, i) {
  const b = buf[i++];
  if (b < 0x80) return { len: b, next: i };
  const n = b & 0x7f;
  let len = 0;
  for (let k = 0; k < n; k++) { len = (len << 8) | buf[i++]; }
  return { len, next: i };
}
function parseNode(buf, i) {
  const start = i;
  const tag = buf[i++];
  const { len, next } = decodeLen(buf, i);
  const contentStart = next;
  const contentEnd = next + len;
  const node = { tag, start, contentStart, contentEnd };
  if ((tag & 0x20) !== 0) {
    node.children = [];
    let c = contentStart;
    while (c < contentEnd) {
      const child = parseNode(buf, c);
      node.children.push(child);
      c = child.contentEnd;
    }
  } else {
    node.value = buf.subarray(contentStart, contentEnd);
  }
  return node;
}
export function derDecode(buf, start = 0) { return parseNode(Buffer.from(buf), start); }
function childByTag(node, tag) { return (node.children || []).find((c) => c.tag === tag); }
function oidToString(buf) {
  const b = [...buf];
  const result = [Math.floor(b[0] / 40), b[0] % 40];
  let big = 0n;
  for (let i = 1; i < b.length; i++) {
    big = (big << 7n) | BigInt(b[i] & 0x7f);
    if ((b[i] & 0x80) === 0) { result.push(Number(big)); big = 0n; }
  }
  return result.join('.');
}
function nodeText(node) { return node.value.toString('utf8'); }

// ---- RFC3161 / CMS parsing ------------------------------------------------
/**
 * Parse a base64 (or raw) RFC3161 TimeStampToken. Returns a structured object.
 * @param {string|Buffer} input base64 string or raw DER Buffer
 */
export function parseTimeStampToken(input) {
  const buf = typeof input === 'string' ? Buffer.from(input, 'base64') : Buffer.from(input);
  const root = derDecode(buf); // ContentInfo SEQUENCE
  if (root.tag !== 0x30) throw new Error('expected ContentInfo SEQUENCE');
  const contentTypeOid = oidToString(childByTag(root, 0x06).value);
  if (contentTypeOid !== OID.signedData) throw new Error('ContentInfo is not id-signedData: ' + contentTypeOid);
  const explicit = childByTag(root, 0xa0); // [0] EXPLICIT SignedData
  const signedData = derDecode(buf, explicit.contentStart); // SignedData SEQUENCE (absolute offsets)
  const sdChildren = signedData.children;
  const version = childByTag(signedData, 0x02) && parseInt(childByTag(signedData, 0x02).value.toString('hex'), 16);
  const encap = sdChildren[2]; // EncapsulatedContentInfo SEQUENCE
  const eContentType = oidToString(childByTag(encap, 0x06).value);
  const eContentExplicit = childByTag(encap, 0xa0); // [0] EXPLICIT OCTET STRING
  const eContentOctet = eContentExplicit ? derDecode(buf, eContentExplicit.contentStart).value : null; // TSTInfo DER bytes
  const certsNode = childByTag(signedData, 0xa0); // [0] IMPLICIT CertificateSet (at SignedData level)
  const certs = [];
  if (certsNode) {
    for (const c of certsNode.children) {
      const der = c.tag === 0x30 ? buf.subarray(c.start, c.end) : null;
      if (der) { try { certs.push(new crypto.X509Certificate(der)); } catch { /* skip undecodable */ } }
    }
  }
  const signerInfosNode = sdChildren[sdChildren.length - 1]; // SET OF SignerInfo
  const signerInfo = [];
  for (const si of signerInfosNode.children) {
    const siChildren = si.children;
    const sidNode = siChildren[1]; // IssuerAndSerialNumber SEQUENCE
    let serial = null;
    if (sidNode && sidNode.tag === 0x30 && sidNode.children[1]) serial = sidNode.children[1].value; // INTEGER
    const digestAlgoNode = siChildren.find((c) => c.tag === 0x30 && childByTag(c, 0x06) && oidToString(childByTag(c, 0x06).value) in OID_TO_HASH);
    const signedAttrsNode = childByTag(si, 0xa0); // [0] IMPLICIT SET OF Attribute
    const sigAlgoNode = siChildren.find((c) => c.tag === 0x30 && childByTag(c, 0x06) && (oidToString(childByTag(c, 0x06).value) === OID.rsaSha256 || oidToString(childByTag(c, 0x06).value) === OID.ecdsaSha256));
    const sigNode = childByTag(si, 0x04); // signature OCTET STRING
    let signedAttrsInner = null;
    const attrs = {};
    if (signedAttrsNode) {
      signedAttrsInner = buf.subarray(signedAttrsNode.contentStart, signedAttrsNode.contentEnd);
      for (const a of signedAttrsNode.children) {
        const type = oidToString(childByTag(a, 0x06).value);
        const valSet = childByTag(a, 0x31);
        attrs[type] = valSet ? valSet.children[0] : null;
      }
    }
    signerInfo.push({
      version: siChildren[0] && parseInt(siChildren[0].value.toString('hex'), 16),
      serial,
      digestAlgorithm: digestAlgoNode ? oidToString(childByTag(digestAlgoNode, 0x06).value) : null,
      signedAttrs: attrs,
      signedAttrsInner,
      signatureAlgorithm: sigAlgoNode ? oidToString(childByTag(sigAlgoNode, 0x06).value) : null,
      signature: sigNode ? sigNode.value : null
    });
  }
  // Parse TSTInfo
  let tstInfo = null;
  if (eContentOctet) {
    const ti = derDecode(eContentOctet);
    const mi = ti.children[2]; // messageImprint SEQUENCE { algorithm Identifier, OCTET STRING }
    const algIdNode = mi && childByTag(mi, 0x30); // AlgorithmIdentifier SEQUENCE
    const hashAlgo = algIdNode ? oidToString(childByTag(algIdNode, 0x06).value) : null;
    const hashedMessage = mi ? childByTag(mi, 0x04).value : null;
    tstInfo = {
      version: parseInt(ti.children[0].value.toString('hex'), 16),
      policy: oidToString(ti.children[1].value),
      hashAlgorithm: hashAlgo,
      hashedMessage: hashedMessage ? hashedMessage.toString('hex') : null,
      serialNumber: ti.children[3] ? ti.children[3].value.toString('hex') : null,
      genTime: ti.children[4] ? nodeText(ti.children[4]) : null
    };
  }
  return {
    contentType: contentTypeOid,
    signedDataVersion: version,
    eContentType,
    eContentDer: eContentOctet,
    certs,
    signerInfo,
    tstInfo
  };
}

// ---- Verification ---------------------------------------------------------
function buildChain(signerCert, allCerts, trustCerts) {
  const chain = [signerCert];
  let current = signerCert;
  let trusted = false;
  for (let i = 0; i < 16; i++) {
    const issuerName = current.issuer;
    if (trustCerts.some((t) => t.fingerprint === current.fingerprint)) { trusted = true; break; }
    const issuer = allCerts.find((c) => c.subject === issuerName && c.fingerprint !== current.fingerprint);
    if (!issuer) break;
    chain.push(issuer);
    current = issuer;
    if (trustCerts.some((t) => t.fingerprint === current.fingerprint)) { trusted = true; break; }
  }
  return { chain, trusted };
}

/**
 * Verify an RFC3161 token offline.
 * @param {string|Buffer} input base64 token
 * @param {object} opts { caCerts: X509Certificate[], expectedHashHex?, expectedAlgo? }
 * @returns {object} report { ok, steps[], signer, chain, chainTrusted, imprintMatch, ... }
 */
export function verifyTimestampToken(input, opts = {}) {
  const steps = [];
  const add = (name, ok, detail) => { steps.push({ name, ok, detail }); return ok; };
  let parsed;
  try {
    parsed = parseTimeStampToken(input);
    add('parse', true, 'CMS SignedData parsed');
  } catch (e) {
    return { ok: false, steps: [{ name: 'parse', ok: false, detail: e.message }] };
  }
  const { tstInfo, signerInfo, certs, eContentDer } = parsed;
  if (!tstInfo) return { ok: false, steps: [...steps, { name: 'tstInfo', ok: false, detail: 'no TSTInfo / eContent' }] };

  // Imprint / algorithm match
  let imprintMatch = null;
  if (opts.expectedHashHex) {
    imprintMatch = tstInfo.hashedMessage && tstInfo.hashedMessage.toLowerCase() === String(opts.expectedHashHex).toLowerCase();
    add('imprint', imprintMatch, imprintMatch ? 'message imprint matches expected hash' : 'message imprint mismatch (' + tstInfo.hashedMessage + ' vs ' + opts.expectedHashHex + ')');
  } else {
    add('imprint', true, 'no expected hash supplied; imprint not compared');
  }
  if (opts.expectedAlgo) {
    const algoOk = (OID_TO_HASH[tstInfo.hashAlgorithm] || tstInfo.hashAlgorithm) === opts.expectedAlgo;
    add('algo', algoOk, algoOk ? tstInfo.hashAlgorithm : 'hash algorithm mismatch');
  }

  // Find signer cert by serial
  const si = signerInfo[0];
  const signerCert = certs.find((c) => si.serial && Buffer.compare(Buffer.from(si.serial), Buffer.from(c.serialNumber, 'hex')) === 0)
    || certs[0];
  if (!signerCert) { return { ok: false, steps: [...steps, { name: 'signerCert', ok: false, detail: 'no certificate in token' }] }; }

  // messageDigest attribute == SHA-256(eContent)
  let mdOk = false;
  if (si.signedAttrs && si.signedAttrs[OID.messageDigest]) {
    const claimed = si.signedAttrs[OID.messageDigest].value;
    const actual = crypto.createHash('sha256').update(eContentDer).digest();
    mdOk = Buffer.compare(claimed, actual) === 0;
    add('messageDigest', mdOk, mdOk ? 'signed messageDigest == SHA-256(eContent)' : 'messageDigest attribute mismatch');
  } else {
    add('messageDigest', false, 'no messageDigest signed attribute');
  }

  // Signature over signed attributes (CMS [0] -> SET tag trick)
  let sigOk = false;
  if (si.signedAttrsInner && si.signature && si.signatureAlgorithm) {
    const message = Buffer.concat([Buffer.from([0x31]), encLen(si.signedAttrsInner.length), si.signedAttrsInner]);
    try {
      const verifyAlgo = OID_TO_SIGN[si.signatureAlgorithm];
      sigOk = crypto.verify(verifyAlgo, message, signerCert.publicKey, si.signature);
      add('signature', sigOk, sigOk ? 'SignerInfo signature verifies' : 'signature verification failed');
    } catch (e) { add('signature', false, e.message); }
  } else {
    add('signature', false, 'missing signed attrs / signature / algorithm');
  }

  // Certificate chain to trust anchor
  const trustCerts = opts.caCerts || [];
  const { chain, trusted } = buildChain(signerCert, certs, trustCerts);
  const withinValidity = chain.every((c) => {
    const now = Date.now();
    const from = new Date(c.validFrom).getTime();
    const to = new Date(c.validTo).getTime();
    return from <= now && now <= to;
  });
  add('chain', trusted, trusted ? 'chain reaches trust anchor' : 'chain does NOT reach supplied trust anchor');
  add('validity', withinValidity, withinValidity ? 'all chain certs within validity' : 'a chain cert is outside its validity window');

  const ok = imprintMatch !== false && mdOk && sigOk && trusted && withinValidity;
  return {
    ok,
    steps,
    signer: { subject: signerCert.subject, issuer: signerCert.issuer, serial: signerCert.serialNumber, notBefore: signerCert.validFrom, notAfter: signerCert.validTo },
    chain: chain.map((c) => ({ subject: c.subject, issuer: c.issuer, fingerprint: c.fingerprint, validFrom: c.validFrom, validTo: c.validTo })),
    chainTrusted: trusted,
    imprintMatch,
    tstInfo: { policy: tstInfo.policy, genTime: tstInfo.genTime, serialNumber: tstInfo.serialNumber, hashAlgorithm: tstInfo.hashAlgorithm }
  };
}

// ---- CLI ------------------------------------------------------------------
export function runCli(argv) {
  const args = argv.slice(2);
  const pos = args.filter((a) => !a.startsWith('--'));
  const get = (name) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
  const tokenArg = pos[0];
  const caPath = get('ca');
  const hashHex = get('hash');
  const algo = get('algo') || OID_TO_HASH[OID.sha256];
  const asJson = args.includes('--json');
  if (!tokenArg || !caPath) {
    console.error('Usage: node cli/verify/tsa-verify.js <token.b64> --ca <ca.pem> [--hash <hex>] [--algo sha256] [--json]');
    return 2;
  }
  const token = fs.readFileSync(tokenArg, 'utf8').trim();
  const caPem = fs.readFileSync(caPath, 'utf8');
  const caCerts = caPem.split(/-----END CERTIFICATE-----/).filter((b) => b.includes('BEGIN CERTIFICATE')).map((b) => new crypto.X509Certificate(b + '-----END CERTIFICATE-----'));
  const report = verifyTimestampToken(token, { caCerts, expectedHashHex: hashHex, expectedAlgo: algo });
  if (asJson) {
    console.log(JSON.stringify(report, (k, v) => (v instanceof Date ? v.toISOString() : v), 2));
  } else {
    console.log('RFC3161 offline verification' + (report.ok ? '  [PASS]' : '  [FAIL]'));
    for (const s of report.steps) console.log('  - ' + (s.ok ? 'ok  ' : 'FAIL') + ' ' + s.name + ': ' + s.detail);
    if (report.signer) console.log('  signer : ' + report.signer.subject + ' (serial ' + report.signer.serial + ')');
    if (report.tstInfo) console.log('  genTime: ' + report.tstInfo.genTime + '  policy: ' + report.tstInfo.policy);
    console.log('  revocation (OCSP/CRL): NOT checked — offline tool; verify revocation separately per your PKI policy.');
  }
  return report.ok ? 0 : 1;
}

// Run when invoked directly (node cli/verify/tsa-verify.js ...)
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  process.exit(runCli(process.argv));
}
