/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */
// One-time authoring script: build a representative v0.5 SEALED case package (golden anchor) and write it
// to this directory as `fieldseal-golden-v0.5-sealed.zip`. The verifier self-check (`verify-golden.cjs`)
// and external auditors use this fixed artifact to prove the verifier behaves correctly (ok on genuine,
// tampered on altered). Run: node cli/test/fixtures/golden/generate-golden.mjs
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import { createCase, bindOperatorProfile, setRetention, addWitnessStatement, sealCase } from '../../../../pwa/core/case-manifest.js';
import { buildCaseExportZip } from '../../../../pwa/helpers/case-export.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', '..');
const OUT = path.join(ROOT, 'cli', 'test', 'fixtures', 'golden', 'fieldseal-golden-v0.5-sealed.zip');

async function main() {
  let c = await createCase({
    metaTemplate: 'forensic-investigator',
    caseMeta: {
      caseReference: 'GOLDEN-2026-001',
      jurisdiction: 'DE-ZPO',
      evidencePurpose: 'Verifier anchor demonstration',
      custodianName: 'Forensic Custodian',
      custodianTitle: 'Evidence Custodian',
      custodianBadgeId: 'FC-0001'
    }
  });
  c = await bindOperatorProfile(c, { name: 'Demo Operator', title: 'Forensic Investigator', org: 'FieldSeal Demo', id: 'OP-DEMO-001' });
  c = await setRetention(c, { legalHold: true, policy: 'Hold', holdReason: 'Litigation hold (demo golden)', operatorId: 'OP-DEMO-001' });
  c = await addWitnessStatement(c, { witnessName: 'Demo Witness', statement: 'Witness attestation for golden anchor (demo only).' });
  c = await sealCase(c, {});

  const blob = await buildCaseExportZip(c, [], {});
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, Buffer.from(await blob.arrayBuffer()));
  console.log('wrote ' + OUT);
  console.log('packageId=' + c.packageId);
  console.log('sealHash=' + c.sealHash);
  console.log('rootHash=' + c.rootHash);
}

main().catch((e) => { console.error(e); process.exit(1); });
