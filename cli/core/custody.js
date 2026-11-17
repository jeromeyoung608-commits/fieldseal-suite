/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */
'use strict';

// Chain-of-custody structured metadata. All validation lives in the kernel;
// the front-end (custody.html) is only an input-collection shell and must not
// perform business validation. Every field is part of the evidence manifest's
// canonical JSON, so it is automatically bound into rootHash.

const META_TEMPLATES = [
  'forensic-investigator', 'compliance-auditor', 'legal-counsel', 'devops-security', 'custom'
];
const ACTION_TYPES = ['Collected', 'Transferred', 'Reviewed', 'Sealed', 'Unsealed', 'Archived', 'Destroyed'];
const FIELD_TYPES = ['text', 'datetime', 'boolean'];

const JURISDICTION_HINTS = ['US-CA', 'US-NY', 'EU-DE', 'EU-GB', 'SG', 'AU'];
const ROLE_HINTS = ['Forensic Investigator', 'Auditor', 'Legal Representative', 'System Admin', 'Reviewer', 'Custodian'];

const MAX = {
  evidencePurpose: 1024,
  jurisdiction: 64,
  caseReference: 128,
  evidenceIdentifier: 128,
  custodyNote: 2048,
  chainNote: 512,
  actorName: 256,
  actorOrganization: 256,
  actorContactRef: 128,
  location: 256,
  deviceRef: 256,
  signatureReference: 256,
  customLabel: 128,
  customValue: 1024
};

const UTC_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;
const FIELD_KEY_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

function isStr(v) { return typeof v === 'string'; }
function isStrLen(v, max) { return isStr(v) && v.length <= max; }

function validateCustody(c) {
  const errors = [];
  const fail = (m) => errors.push(m);
  if (!c || typeof c !== 'object' || Array.isArray(c)) { fail('custody must be an object'); return { ok: false, errors }; }

  if ('metaTemplate' in c && c.metaTemplate !== '' && !META_TEMPLATES.includes(c.metaTemplate)) {
    fail('metaTemplate must be one of: ' + META_TEMPLATES.join(', '));
  }
  if ('evidencePurpose' in c && !isStrLen(c.evidencePurpose, MAX.evidencePurpose)) fail('evidencePurpose must be a string <= ' + MAX.evidencePurpose);
  if ('jurisdiction' in c && !isStrLen(c.jurisdiction, MAX.jurisdiction)) fail('jurisdiction must be a string <= ' + MAX.jurisdiction);
  if ('caseReference' in c && !isStrLen(c.caseReference, MAX.caseReference)) fail('caseReference must be a string <= ' + MAX.caseReference);
  if ('evidenceIdentifier' in c && !isStrLen(c.evidenceIdentifier, MAX.evidenceIdentifier)) fail('evidenceIdentifier must be a string <= ' + MAX.evidenceIdentifier);
  if ('custodyStartUtc' in c && c.custodyStartUtc !== '' && !(UTC_RE.test(c.custodyStartUtc) || ISO_RE.test(c.custodyStartUtc))) {
    fail('custodyStartUtc must be "YYYY-MM-DD HH:mm:ss UTC" or ISO8601 UTC');
  }
  if ('custodyNote' in c && !isStrLen(c.custodyNote, MAX.custodyNote)) fail('custodyNote must be a string <= ' + MAX.custodyNote);

  if ('chainOfCustody' in c) {
    if (!Array.isArray(c.chainOfCustody)) fail('chainOfCustody must be an array');
    else c.chainOfCustody.forEach((entry, i) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { fail('chainOfCustody[' + i + '] must be an object'); return; }
      if (!isStrLen(entry.actorName, MAX.actorName) || entry.actorName.length === 0) fail('chainOfCustody[' + i + '].actorName required, string <= ' + MAX.actorName);
      if ('actorRole' in entry && !isStrLen(entry.actorRole, MAX.actorName)) fail('chainOfCustody[' + i + '].actorRole string <= ' + MAX.actorName);
      if ('actorOrganization' in entry && !isStrLen(entry.actorOrganization, MAX.actorOrganization)) fail('chainOfCustody[' + i + '].actorOrganization string <= ' + MAX.actorOrganization);
      if ('actorContactRef' in entry && !isStrLen(entry.actorContactRef, MAX.actorContactRef)) fail('chainOfCustody[' + i + '].actorContactRef string <= ' + MAX.actorContactRef);
      if ('actionType' in entry && entry.actionType !== '' && !ACTION_TYPES.includes(entry.actionType)) fail('chainOfCustody[' + i + '].actionType must be one of: ' + ACTION_TYPES.join(', '));
      if ('actionUtc' in entry && entry.actionUtc !== '' && !(UTC_RE.test(entry.actionUtc) || ISO_RE.test(entry.actionUtc))) fail('chainOfCustody[' + i + '].actionUtc must be "YYYY-MM-DD HH:mm:ss UTC" or ISO8601 UTC');
      if ('location' in entry && !isStrLen(entry.location, MAX.location)) fail('chainOfCustody[' + i + '].location string <= ' + MAX.location);
      if ('deviceRef' in entry && !isStrLen(entry.deviceRef, MAX.deviceRef)) fail('chainOfCustody[' + i + '].deviceRef string <= ' + MAX.deviceRef);
      if ('signatureReference' in entry && !isStrLen(entry.signatureReference, MAX.signatureReference)) fail('chainOfCustody[' + i + '].signatureReference string <= ' + MAX.signatureReference);
      if ('entryNote' in entry && !isStrLen(entry.entryNote, MAX.chainNote)) fail('chainOfCustody[' + i + '].entryNote string <= ' + MAX.chainNote);
    });
  }

  if ('customExtraFields' in c) {
    if (!Array.isArray(c.customExtraFields)) fail('customExtraFields must be an array');
    else {
      const seen = new Set();
      c.customExtraFields.forEach((field, i) => {
        if (!field || typeof field !== 'object' || Array.isArray(field)) { fail('customExtraFields[' + i + '] must be an object'); return; }
        if (!FIELD_KEY_RE.test(field.fieldKey || '')) fail('customExtraFields[' + i + '].fieldKey must match /^[A-Za-z][A-Za-z0-9_]*$/ (no spaces)');
        if (seen.has(field.fieldKey)) fail('customExtraFields[' + i + '].fieldKey duplicate: ' + field.fieldKey);
        seen.add(field.fieldKey);
        if (!isStrLen(field.fieldLabel || '', MAX.customLabel)) fail('customExtraFields[' + i + '].fieldLabel string <= ' + MAX.customLabel);
        if ('fieldValue' in field && (typeof field.fieldValue !== 'string' || field.fieldValue.length > MAX.customValue)) fail('customExtraFields[' + i + '].fieldValue string <= ' + MAX.customValue);
        if ('fieldType' in field && field.fieldType !== '' && !FIELD_TYPES.includes(field.fieldType)) fail('customExtraFields[' + i + '].fieldType must be one of: ' + FIELD_TYPES.join(', '));
      });
    }
  }

  return { ok: errors.length === 0, errors };
}

// Lightweight, user-facing preset (front-end only reads recommended values).
function preset(name) {
  const base = {
    metaTemplate: name === 'custom' ? '' : (name || ''),
    chainOfCustody: [{ actorName: '', actionType: 'Collected', actionUtc: '' }]
  };
  switch (name) {
    case 'forensic-investigator':
      return Object.assign({}, base, { evidencePurpose: 'Forensic acquisition and investigation', jurisdiction: 'EU-DE', chainOfCustody: [{ actorName: '', actorRole: 'Forensic Investigator', actionType: 'Collected' }] });
    case 'compliance-auditor':
      return Object.assign({}, base, { evidencePurpose: 'Periodic compliance audit', jurisdiction: 'EU-DE', chainOfCustody: [{ actorName: '', actorRole: 'Auditor', actionType: 'Reviewed' }] });
    case 'legal-counsel':
      return Object.assign({}, base, { evidencePurpose: 'Legal hold / litigation support', jurisdiction: 'US-NY', chainOfCustody: [{ actorName: '', actorRole: 'Legal Representative', actionType: 'Transferred' }] });
    case 'devops-security':
      return Object.assign({}, base, { evidencePurpose: 'Security incident evidence', jurisdiction: 'US-CA', chainOfCustody: [{ actorName: '', actorRole: 'System Admin', actionType: 'Collected' }] });
    default:
      return { metaTemplate: '', evidencePurpose: '', jurisdiction: '', caseReference: '', evidenceIdentifier: '', custodyStartUtc: '', custodyNote: '', chainOfCustody: [], customExtraFields: [] };
  }
}

module.exports = {
  META_TEMPLATES, ACTION_TYPES, FIELD_TYPES, JURISDICTION_HINTS, ROLE_HINTS, MAX,
  validateCustody, preset, UTC_RE, ISO_RE, FIELD_KEY_RE
};
