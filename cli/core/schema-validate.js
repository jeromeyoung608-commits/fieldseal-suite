/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */
'use strict';

const { isHash, HASH_ALGORITHMS } = require('./hash');
const { validateCustody } = require('./custody');

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const OFFSET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DECIMAL_RE = /^-?\d+(?:\.\d+)?$/;

const DEFS = {
  'fieldseal-evidence-v0.1': {
    type: 'evidence',
    keys: ['spec', 'packageId', 'rootHash', 'createdAt', 'files']
  },
  'fieldseal-evidence-v0.2': {
    type: 'evidence',
    keys: ['spec', 'packageId', 'rootHash', 'createdAt', 'captureTsDevice', 'gps', 'note', 'tags', 'files', 'mp4SanityCheck']
  },
  'fieldseal-signature-v0.1': {
    type: 'signature-record',
    keys: ['spec', 'packageId', 'rootHash', 'createdAt', 'linkedEvidenceId', 'linkedEvidenceRootHash', 'parties', 'canvasSnapshotHash', 'sealNote']
  },
  'fieldseal-supplement-v0.1': {
    type: 'supplement',
    keys: ['spec', 'packageId', 'rootHash', 'createdAt', 'supplementToEvidenceId', 'note']
  },
  'fieldseal-bundle-v0.1': {
    type: 'bundle',
    keys: ['spec', 'bundleId', 'rootHash', 'createdAt', 'items']
  }
};

// Controlled, backward-compatible optional extensions (owner-authorized).
// Original required keys are frozen; these only add OPTIONAL fields so that
// historical packages without them still validate as `ok`.
const EVIDENCE_OPTIONAL_EXTRA = ['supersedesPackageId', 'revisionReason', 'tzIana', 'custody', 'hashAlgorithm'];
const SIGNATURE_OPTIONAL_EXTRA = ['tzIana', 'hashAlgorithm'];
const SUPPLEMENT_OPTIONAL_EXTRA = ['files', 'hashAlgorithm'];
const BUNDLE_OPTIONAL_EXTRA = ['hashAlgorithm'];
const PARTY_REQUIRED = ['name', 'confirm', 'signedAt'];
const PARTY_OPTIONAL = ['role', 'organization', 'referenceId', 'licenseNo', 'reservation', 'tzIana'];

const SUPPORTED_SPECS = Object.keys(DEFS);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasAllKeys(obj, keys) {
  return keys.every((key) => Object.prototype.hasOwnProperty.call(obj, key));
}

function hasExtraKeys(obj, required, optional) {
  const allowed = new Set([...(required || []), ...(optional || [])]);
  return Object.keys(obj).some((key) => !allowed.has(key));
}

function sameKeys(object, keys) {
  const actual = Object.keys(object).sort();
  const expected = keys.slice().sort();
  return actual.length === expected.length && actual.every((key, i) => key === expected[i]);
}

function validateManifest(manifest) {
  if (!isPlainObject(manifest)) {
    return { ok: false, errors: ['manifest must be a JSON object'], spec: '', type: '', id: '' };
  }
  const spec = manifest.spec;
  if (typeof spec !== 'string' || !DEFS[spec]) {
    return { ok: false, errors: ['unsupported or missing spec'], spec: String(spec || ''), type: '', id: '' };
  }
  const def = DEFS[spec];
  const errors = [];
  const fail = (message) => errors.push(message);

  const optionalTop = def.type === 'evidence' ? EVIDENCE_OPTIONAL_EXTRA
    : (def.type === 'signature-record' ? SIGNATURE_OPTIONAL_EXTRA
    : (def.type === 'supplement' ? SUPPLEMENT_OPTIONAL_EXTRA : []));
  if (!hasAllKeys(manifest, def.keys)) fail('manifest missing required keys: ' + def.keys.filter((k) => !(k in manifest)).join(','));
  else if (hasExtraKeys(manifest, def.keys, optionalTop)) fail('manifest key set must be subset of: ' + [...def.keys, ...optionalTop].slice().sort().join(','));
  if (!isHash(manifest.rootHash)) fail('rootHash must be sha256|sha3-256:<64 lowercase hex>');
  if (typeof manifest.createdAt !== 'string' || !UTC_RE.test(manifest.createdAt)) fail('createdAt must be ISO8601 UTC seconds precision');
  if ('hashAlgorithm' in manifest && !HASH_ALGORITHMS.includes(manifest.hashAlgorithm)) fail('hashAlgorithm must be one of: ' + HASH_ALGORITHMS.join(', '));

  const idField = def.type === 'bundle' ? 'bundleId' : 'packageId';
  const idValue = manifest[idField];
  if (typeof idValue !== 'string' || !UUID_V4_RE.test(idValue)) fail(idField + ' must be a UUID v4 string');

  if (def.type === 'evidence') {
    if (!Array.isArray(manifest.files)) fail('files must be an array');
    else manifest.files.forEach((file, i) => {
      if (!isPlainObject(file) || !sameKeys(file, ['name', 'hash', 'type'])) {
        fail('files[' + i + '] key set must be name,hash,type');
        return;
      }
      if (typeof file.name !== 'string' || !NAME_RE.test(file.name) || file.name.indexOf('/') !== -1) fail('files[' + i + '].name violates C5');
      if (!isHash(file.hash)) fail('files[' + i + '].hash must be sha256:<64 lowercase hex>');
      if (file.type !== 'image' && file.type !== 'video') fail('files[' + i + '].type must be image or video');
    });
    if ('supersedesPackageId' in manifest && manifest.supersedesPackageId !== '' && !UUID_V4_RE.test(manifest.supersedesPackageId)) fail('supersedesPackageId must be a UUID v4 string or empty');
    if ('revisionReason' in manifest && typeof manifest.revisionReason !== 'string') fail('revisionReason must be a string');
    if ('tzIana' in manifest && typeof manifest.tzIana !== 'string') fail('tzIana must be a string');
    if ('custody' in manifest) {
      const result = validateCustody(manifest.custody);
      if (!result.ok) result.errors.forEach((e) => fail('custody.' + e));
    }
  }

  if (spec === 'fieldseal-evidence-v0.2') {
    if (typeof manifest.captureTsDevice !== 'string' || !OFFSET_RE.test(manifest.captureTsDevice)) fail('captureTsDevice must be ISO8601 with optional offset');
    if (!isPlainObject(manifest.gps) || !sameKeys(manifest.gps, ['lat', 'lon'])) fail('gps key set must be lat,lon');
    else {
      if (typeof manifest.gps.lat !== 'string' || !DECIMAL_RE.test(manifest.gps.lat)) fail('gps.lat must be a decimal string');
      if (typeof manifest.gps.lon !== 'string' || !DECIMAL_RE.test(manifest.gps.lon)) fail('gps.lon must be a decimal string');
    }
    if (typeof manifest.note !== 'string') fail('note must be a string');
    if (!Array.isArray(manifest.tags) || !manifest.tags.every((tag) => typeof tag === 'string')) fail('tags must be an array of strings');
    const check = manifest.mp4SanityCheck;
    if (!isPlainObject(check) || !sameKeys(check, ['status', 'note'])) fail('mp4SanityCheck key set must be status,note');
    else {
      if (check.status !== 'ok' && check.status !== 'failed' && check.status !== 'skipped') fail('mp4SanityCheck.status must be ok, failed or skipped');
      if (typeof check.note !== 'string') fail('mp4SanityCheck.note must be a string');
    }
  }

  if (def.type === 'signature-record') {
    if (typeof manifest.linkedEvidenceId !== 'string' || !UUID_V4_RE.test(manifest.linkedEvidenceId)) fail('linkedEvidenceId must be a UUID v4 string');
    if (!isHash(manifest.linkedEvidenceRootHash)) fail('linkedEvidenceRootHash must be sha256:<64 lowercase hex>');
    if (!Array.isArray(manifest.parties)) fail('parties must be an array');
    else manifest.parties.forEach((party, i) => {
      if (!isPlainObject(party)) { fail('parties[' + i + '] must be an object'); return; }
      const allowed = new Set([...PARTY_REQUIRED, ...PARTY_OPTIONAL]);
      const actual = Object.keys(party);
      if (!PARTY_REQUIRED.every((k) => k in party)) fail('parties[' + i + '] missing required keys');
      if (actual.some((k) => !allowed.has(k))) fail('parties[' + i + '] unknown keys: ' + actual.filter((k) => !allowed.has(k)).join(','));
      if (typeof party.name !== 'string' || party.name.length === 0) fail('parties[' + i + '].name must be a non-empty string');
      if (typeof party.confirm !== 'boolean') fail('parties[' + i + '].confirm must be a boolean');
      if (typeof party.signedAt !== 'string' || !UTC_RE.test(party.signedAt)) fail('parties[' + i + '].signedAt must be ISO8601 UTC');
      if ('role' in party && typeof party.role !== 'string') fail('parties[' + i + '].role must be a string');
      if ('organization' in party && typeof party.organization !== 'string') fail('parties[' + i + '].organization must be a string');
      if ('referenceId' in party && typeof party.referenceId !== 'string') fail('parties[' + i + '].referenceId must be a string');
      if ('licenseNo' in party && typeof party.licenseNo !== 'string') fail('parties[' + i + '].licenseNo must be a string');
      if ('reservation' in party && typeof party.reservation !== 'string') fail('parties[' + i + '].reservation must be a string');
      if ('tzIana' in party && typeof party.tzIana !== 'string') fail('parties[' + i + '].tzIana must be a string');
    });
    if (!isHash(manifest.canvasSnapshotHash)) fail('canvasSnapshotHash must be sha256:<64 lowercase hex>');
    if (typeof manifest.sealNote !== 'string') fail('sealNote must be a string');
    if ('tzIana' in manifest && typeof manifest.tzIana !== 'string') fail('tzIana must be a string');
  }

  if (def.type === 'supplement') {
    if (!UUID_V4_RE.test(manifest.supplementToEvidenceId)) fail('supplementToEvidenceId must be a UUID v4 string');
    if (typeof manifest.note !== 'string') fail('note must be a string');
    if ('tzIana' in manifest && typeof manifest.tzIana !== 'string') fail('tzIana must be a string');
    if ('files' in manifest) {
      if (!Array.isArray(manifest.files)) fail('files must be an array');
      else manifest.files.forEach((file, i) => {
        if (!isPlainObject(file) || !sameKeys(file, ['name', 'hash', 'type'])) {
          fail('files[' + i + '] key set must be name,hash,type');
          return;
        }
        if (typeof file.name !== 'string' || !NAME_RE.test(file.name) || file.name.indexOf('/') !== -1) fail('files[' + i + '].name violates C5');
        if (!isHash(file.hash)) fail('files[' + i + '].hash must be sha256:<64 lowercase hex>');
        if (file.type !== 'image' && file.type !== 'video') fail('files[' + i + '].type must be image or video');
      });
    }
  }

  if (def.type === 'bundle') {
    if (!Array.isArray(manifest.items)) fail('items must be an array');
    else manifest.items.forEach((item, i) => {
      if (!isPlainObject(item) || !sameKeys(item, ['packageId', 'type', 'hash'])) {
        fail('items[' + i + '] key set must be packageId,type,hash');
        return;
      }
      if (typeof item.packageId !== 'string' || !UUID_V4_RE.test(item.packageId)) fail('items[' + i + '].packageId must be a UUID v4 string');
      if (item.type !== 'evidence' && item.type !== 'signature-record' && item.type !== 'supplement') fail('items[' + i + '].type must be evidence, signature-record or supplement');
      if (!isHash(item.hash)) fail('items[' + i + '].hash must be sha256:<64 lowercase hex>');
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    spec,
    type: def.type,
    id: typeof idValue === 'string' ? idValue : ''
  };
}

function packageTypeOf(spec) {
  return DEFS[spec] ? DEFS[spec].type : 'unknown';
}

function idOf(manifest) {
  if (!manifest || typeof manifest !== 'object') return '';
  return manifest.bundleId || manifest.packageId || '';
}

module.exports = {
  SUPPORTED_SPECS, UUID_V4_RE, UTC_RE, NAME_RE,
  validateManifest, packageTypeOf, idOf, sameKeys
};
