/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * Evidence RECEIPT service core (P1 #1). Issues a signed acknowledgement that a case reference
 * (rootHash / sealHash + minimal metadata) was RECEIVED by the custody service.
 *
 * CRITICAL BOUNDARY: a receipt is NOT evidence and never contains the evidence package. The
 * subject is referenced only by its trust hashes. The backend only receives, signs and indexes;
 * it does NOT recompute trust hashes (the trust root stays the locally produced case package).
 *
 * Zero runtime dependencies (Node built-ins only).
 */
import { createHmac, randomUUID } from 'node:crypto';

export const HEADER_MARK = 'FieldSeal Suite — Copyright (c) 2026';
export const RECEIPT_KIND = 'RECEIPT_NOT_EVIDENCE';

const FORBIDDEN_KEYS = ['evidencePackage', 'evidence', 'files', 'zip', 'blob', 'buffer', 'binary', 'attachment'];
const MAX_STRING_LEN = 8192;

export function isEvidencePayload(value, depth = 0) {
  if (value == null || depth > 8) return false;
  if (typeof value === 'string') return value.length > MAX_STRING_LEN;
  if (Buffer.isBuffer(value)) return true;
  if (Array.isArray(value)) return value.some((v) => isEvidencePayload(v, depth + 1));
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.includes(k)) return true;
      if (isEvidencePayload(v, depth + 1)) return true;
    }
  }
  return false;
}

function canonical(receipt) {
  // Deterministic serialization of the receipt's signed fields (signature excluded).
  const { signature, ...rest } = receipt;
  return JSON.stringify(rest);
}

export function signReceipt(receipt, secret) {
  return createHmac('sha256', secret).update(canonical(receipt), 'utf8').digest('hex');
}

export function issueReceipt(subject, { secret, redactFields = ['operatorId', 'sourceHost', 'caseId'] } = {}) {
  if (isEvidencePayload(subject)) throw new Error('evidence packages cannot be submitted to the receipt service');
  const redact = (obj, d = 0) => {
    if (Array.isArray(obj)) return obj.map((v) => redact(v, d + 1));
    if (obj && typeof obj === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(obj)) {
        out[k] = redactFields.includes(k) && v != null
          ? 'blind:' + createHmac('sha256', secret).update('redact|' + String(v), 'utf8').digest('hex').slice(0, 16)
          : redact(v, d + 1);
      }
      return out;
    }
    return obj;
  };
  const receipt = {
    receiptId: randomUUID(),
    kind: RECEIPT_KIND,
    receivedUtc: new Date().toISOString(),
    subjectHash: {
      rootHash: subject.rootHash || null,
      sealHash: subject.sealHash || null
    },
    metadata: redact(subject.metadata || {})
  };
  receipt.signature = signReceipt(receipt, secret);
  return receipt;
}

export function verifyReceipt(receipt, secret) {
  if (!receipt || receipt.kind !== RECEIPT_KIND) return false;
  const expected = signReceipt(receipt, secret);
  return expected === receipt.signature;
}
