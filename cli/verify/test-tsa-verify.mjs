/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */
// Standalone self-test for the offline RFC3161 verifier. Builds a real CMS SignedData (RSA-SHA256) from the
// test CA/leaf fixtures, then verifies it end-to-end, plus negative cases. Run: node cli/verify/test-tsa-verify.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { seq, setOf, oidEnc, intEnc, octetStr, implicit, algId, genTimeEnc, encLen, derDecode, verifyTimestampToken, OID } from './tsa-verify.js';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const caCert = new crypto.X509Certificate(fs.readFileSync(path.join(DIR, 'fixtures', 'test-ca.pem'), 'utf8'));
const caKey = crypto.createPrivateKey(fs.readFileSync(path.join(DIR, 'fixtures', 'test-ca.key'), 'utf8'));
const leafCert = new crypto.X509Certificate(fs.readFileSync(path.join(DIR, 'fixtures', 'test-leaf.pem'), 'utf8'));
const leafKey = crypto.createPrivateKey(fs.readFileSync(path.join(DIR, 'fixtures', 'test-leaf.key'), 'utf8'));

let failures = 0;
const assert = (cond, msg) => { if (cond) console.log('  ok  - ' + msg); else { console.log('  FAIL- ' + msg); failures++; } };

// Extract issuer Name (SEQUENCE) DER + serial from the leaf cert.
const certNode = derDecode(leafCert.raw);
const tbs = certNode.children[0];
const issuerName = tbs.children[3]; // Name SEQUENCE
const issuerNameDer = leafCert.raw.subarray(issuerName.start, issuerName.end); // full Name node (tag+len+content)
const serialBytes = tbs.children[1].value; // INTEGER raw bytes

// Build TSTInfo with a known imprint (the hash being timestamped).
const hashedMessage = crypto.randomBytes(32);
const expectedHashHex = hashedMessage.toString('hex');
const tstInfo = seq(
  intEnc(1),
  oidEnc('1.2.3.4.5'), // dummy TSAPolicyId
  seq(algId(OID.sha256), octetStr(hashedMessage)), // messageImprint
  intEnc(0x1234n),
  genTimeEnc(new Date())
);
const tstInfoDer = tstInfo;

// signed attributes: contentType, messageDigest, signingTime
const contentTypeAttr = seq(oidEnc(OID.contentType), setOf(oidEnc(OID.tstInfo)));
const messageDigestAttr = seq(oidEnc(OID.messageDigest), setOf(octetStr(crypto.createHash('sha256').update(tstInfoDer).digest())));
const signingTimeAttr = seq(oidEnc(OID.signingTime), setOf(genTimeEnc(new Date())));
const signedAttrsContent = Buffer.concat([contentTypeAttr, messageDigestAttr, signingTimeAttr]);
const signedAttrsNode = implicit(0xa0, signedAttrsContent);

// Signature over the CMS [0]->SET message
const message = Buffer.concat([Buffer.from([0x31]), encLen(signedAttrsContent.length), signedAttrsContent]);
const signature = crypto.createSign('RSA-SHA256').update(message).sign(leafKey);

// SignerInfo
const signerInfo = seq(
  intEnc(1),
  seq(issuerNameDer, intEnc(serialBytes)), // IssuerAndSerialNumber
  algId(OID.sha256), // digestAlgorithm
  signedAttrsNode,
  algId(OID.rsaSha256), // signatureAlgorithm
  octetStr(signature)
);

// SignedData (version 3, certificates present)
const encapContentInfo = seq(oidEnc(OID.tstInfo), implicit(0xa0, octetStr(tstInfoDer)));
const signedData = seq(
  intEnc(3),
  setOf(algId(OID.sha256)), // digestAlgorithms
  encapContentInfo,
  implicit(0xa0, Buffer.concat([leafCert.raw, caCert.raw])), // certificates: [0] IMPLICIT CertificateSet (certs directly, no inner SET)
  setOf(signerInfo) // signerInfos
);

// ContentInfo
const contentInfo = seq(oidEnc(OID.signedData), implicit(0xa0, signedData));
const token = contentInfo.toString('base64');

// Write token to a temp file for CLI testing too.
const tokenPath = path.join(DIR, 'fixtures', 'test-token.b64');
fs.writeFileSync(tokenPath, token);

console.log('[tsa-verify]');
assert(typeof token === 'string' && token.length > 0, 'CMS SignedData token built');

const report = verifyTimestampToken(token, { caCerts: [caCert], expectedHashHex, expectedAlgo: 'sha256' });
assert(report.ok === true, 'valid token verifies PASS');
assert(report.imprintMatch === true, 'imprint matches expected hash');
assert(report.steps.find((s) => s.name === 'signature').ok === true, 'signature verifies');
assert(report.steps.find((s) => s.name === 'messageDigest').ok === true, 'messageDigest attribute matches');
assert(report.chainTrusted === true, 'chain reaches trust anchor (CA)');

// Negative: tampered signature
const badTokenBuf = Buffer.from(token, 'base64');
badTokenBuf[badTokenBuf.length - 5] ^= 0xff; // flip a bit in the signature tail region
const badReport = verifyTimestampToken(badTokenBuf.toString('base64'), { caCerts: [caCert], expectedHashHex });
assert(badReport.ok === false && badReport.steps.find((s) => s.name === 'signature').ok === false, 'tampered signature FAILs');

// Negative: no trust anchor supplied -> chain must NOT reach a trust anchor
const untrustedReport = verifyTimestampToken(token, { caCerts: [], expectedHashHex });
assert(untrustedReport.chainTrusted === false, 'no trust anchor supplied -> untrusted');

// Negative: wrong expected hash
const wrongHashReport = verifyTimestampToken(token, { caCerts: [caCert], expectedHashHex: '00'.repeat(32), expectedAlgo: 'sha256' });
assert(wrongHashReport.imprintMatch === false && wrongHashReport.ok === false, 'wrong expected hash -> imprint FAIL');

console.log(failures === 0 ? '\nALL TSA-VERIFY TESTS PASSED' : '\n' + failures + ' TSA-VERIFY TEST(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
