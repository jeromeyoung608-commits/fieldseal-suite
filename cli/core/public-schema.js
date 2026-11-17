/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */
'use strict';

// Public, machine-readable evidence-package specification, including the
// chain-of-custody block. Fixed fields are strongly validated by the kernel;
// user-defined fields live under `customExtraFields`. This file is mirrored to
// docs/schema.json and printed by `audit.js schema`.

const schema = {
  $id: 'https://fieldseal.example/schema/evidence-package-v0.2',
  title: 'FieldSeal Evidence Package Specification',
  version: 'v0.2',
  hashAlgorithms: ['sha256', 'sha3-256'],
  manifest: {
    spec: { const: 'fieldseal-evidence-v0.2' },
    packageId: { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' },
    createdAt: { type: 'string', format: 'iso8601-utc' },
    rootHash: { type: 'string', pattern: '^(sha256|sha3-256):[0-9a-f]{64}$' },
    hashAlgorithm: { type: 'string', enum: ['sha256', 'sha3-256'], optional: true },
    captureTsDevice: { type: 'string', format: 'iso8601-offset', optional: true },
    gps: { type: 'object', properties: { lat: { type: 'string' }, lon: { type: 'string' } }, optional: true },
    note: { type: 'string', maxLength: 65536, optional: true },
    tags: { type: 'array', items: { type: 'string' }, optional: true },
    mp4SanityCheck: {
      type: 'object',
      properties: { status: { enum: ['ok', 'failed', 'skipped'] }, note: { type: 'string' } },
      optional: true
    },
    supersedesPackageId: { type: 'string', pattern: '^[0-9a-f-]{36}$', optional: true },
    revisionReason: { type: 'string', optional: true },
    tzIana: { type: 'string', optional: true },
    custody: { $ref: '#/definitions/custody', optional: true },
    files: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' },
          hash: { type: 'string', pattern: '^(sha256|sha3-256):[0-9a-f]{64}$' },
          type: { enum: ['image', 'video'] }
        }
      }
    }
  },
  definitions: {
    custody: {
      type: 'object',
      description: 'Structured chain-of-custody metadata. Every field is part of the manifest canonical JSON and therefore bound into rootHash.',
      properties: {
        metaTemplate: { type: 'string', enum: ['forensic-investigator', 'compliance-auditor', 'legal-counsel', 'devops-security', 'custom'], optional: true },
        evidencePurpose: { type: 'string', maxLength: 1024, optional: true },
        jurisdiction: { type: 'string', maxLength: 64, optional: true },
        caseReference: { type: 'string', maxLength: 128, optional: true },
        evidenceIdentifier: { type: 'string', maxLength: 128, optional: true },
        custodyStartUtc: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2} UTC$', optional: true },
        custodyNote: { type: 'string', maxLength: 2048, optional: true },
        chainOfCustody: {
          type: 'array',
          optional: true,
          items: {
            type: 'object',
            properties: {
              actorName: { type: 'string', minLength: 1, maxLength: 256 },
              actorRole: { type: 'string', maxLength: 256, optional: true },
              actorOrganization: { type: 'string', maxLength: 256, optional: true },
              actorContactRef: { type: 'string', maxLength: 128, optional: true },
              actionType: { type: 'string', enum: ['Collected', 'Transferred', 'Reviewed', 'Sealed', 'Unsealed', 'Archived', 'Destroyed'], optional: true },
              actionUtc: { type: 'string', pattern: '^(\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2} UTC)|(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:Z|[+-]\\d{2}:\\d{2}))$', optional: true },
              location: { type: 'string', maxLength: 256, optional: true },
              deviceRef: { type: 'string', maxLength: 256, optional: true },
              signatureReference: { type: 'string', maxLength: 256, optional: true },
              entryNote: { type: 'string', maxLength: 512, optional: true }
            }
          }
        },
        customExtraFields: {
          type: 'array',
          optional: true,
          items: {
            type: 'object',
            properties: {
              fieldKey: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_]*$' },
              fieldLabel: { type: 'string', maxLength: 128 },
              fieldValue: { type: 'string', maxLength: 1024, optional: true },
              fieldType: { type: 'string', enum: ['text', 'datetime', 'boolean'], optional: true }
            }
          }
        }
      }
    }
  },
  notes: [
    'Chain-of-custody (`custody`) is additive and optional; packages without it still validate as `ok`.',
    'All custody fields are included in the manifest canonical JSON, so any change is detected via rootHash.',
    'customExtraFields holds user-defined key/value pairs; keys must be unique and match /^[A-Za-z][A-Za-z0-9_]*$/.'
  ]
};

module.exports = schema;
