/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 *
 * Read-only ISO/IEC 27037 readiness checklist generator (NO crypto, NO hash verification — the trusted
 * `case verify` does that). Produces a per-manifest summary of which digital-evidence handling principles
 * are evidenced, to help forensic labs / legal reviewers self-assess. It is not a conformance certificate.
 */
'use strict';
const fs = require('fs');

function iso27037Checklist(c) {
  c = c || {};
  const cm = c.caseMeta || {};
  const children = Array.isArray(c.children) ? c.children : [];
  const custody = Array.isArray(c.custodyLog) ? c.custodyLog : [];
  const audit = Array.isArray(c.auditLog) ? c.auditLog : [];
  const items = [];
  const add = (clause, label, ok, detail) => items.push({ clause, label, satisfied: !!ok, detail: detail || '' });
  const kidsOk = (pred) => children.length > 0 && children.every(pred);

  add('6 Identification', 'Case context (title/reference)', !!(cm.title || cm.caseReference), '');
  add('6 Identification', 'Per-evidence IDs', kidsOk((x) => x.evidenceId || x.packageId), children.length + ' children');
  add('7 Integrity', 'rootHash present', !!c.rootHash, 'verify separately');
  add('7 Integrity', 'sealHash present', !!c.sealHash, 'verify separately');
  add('7 Integrity', 'hashAlgorithm recorded', !!c.hashAlgorithm, '');
  add('8 Acquisition', 'Child hash + capture time', kidsOk((x) => x.rootHash && x.capturedUtc), '');
  add('8 Acquisition', 'Env snapshot (context)', !!(cm.envSnapshot), 'additive, non-trust');
  add('9 Storage', 'Optional encryption envelope', !!(c.caseEncryptionMeta), 'auxiliary only');
  add('10 Chain of custody', 'custody/audit log present', (custody.length + audit.length) > 0, '');
  add('10 Chain of custody', 'Countersign on seal', c.state !== 'sealed' || (c.countersignList || []).length > 0, 'state=' + c.state);
  return items;
}

function runCli(argv) {
  const path = argv[0];
  if (!path) { console.error('usage: node iso27037-checklist.js <case-manifest.json>'); return 2; }
  const c = JSON.parse(fs.readFileSync(path, 'utf8'));
  const items = iso27037Checklist(c);
  const mark = (b) => (b ? 'YES ' : 'NO  ');
  let yes = 0;
  for (const it of items) { if (it.satisfied) yes++; console.log(mark(it.satisfied) + ' ' + it.clause + ' — ' + it.label + (it.detail ? '  (' + it.detail + ')' : '')); }
  console.log('\n' + yes + '/' + items.length + ' principles evidenced (read-only; run `case verify` for cryptographic integrity).');
  return 0;
}

function selfTest() {
  let fails = 0;
  const assert = (cond, m) => { console.log((cond ? '  ok  - ' : '  FAIL- ') + m); if (!cond) fails++; };
  const full = { caseMeta: { title: 'T', envSnapshot: {} }, rootHash: 'sha256:a', sealHash: 'sha256:b', hashAlgorithm: 'sha256', state: 'sealed', children: [{ evidenceId: 'e1', rootHash: 'sha256:c', capturedUtc: '2026-01-01T00:00:00Z' }], custodyLog: [{ actor: 'OP-1' }], countersignList: [{ actorName: 'X' }] };
  let r = iso27037Checklist(full);
  assert(r.length === 10, '10 checklist items');
  // fully-evidenced case satisfies all EXCEPT the optional encryption envelope (9 Storage), which is absent
  assert(r.filter((x) => x.satisfied).length === 9, 'fully-evidenced case → 9/10 (storage optional & absent)');
  assert(r.find((x) => x.clause.startsWith('9')).satisfied === false, 'optional storage correctly NO when absent');
  const empty = iso27037Checklist({});
  assert(empty.find((x) => x.clause.startsWith('6')).satisfied === false, 'empty manifest → identification NO');
  assert(empty.find((x) => x.clause.startsWith('7') && x.label.includes('rootHash')).satisfied === false, 'empty manifest → integrity NO');
  console.log(fails === 0 ? 'ISO-27037-CHECKLIST SELFTEST OK' : fails + ' ISO-27037-CHECKLIST SELFTEST FAILED');
  process.exit(fails === 0 ? 0 : 1);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--selftest') selfTest();
  else process.exit(runCli(args));
}
module.exports = { iso27037Checklist, runCli, selfTest };
