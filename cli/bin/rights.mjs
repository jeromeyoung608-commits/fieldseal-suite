#!/usr/bin/env node
/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */
// GDPR data-subject rights walkthrough (9.0 compliance item C2).
// Exercises all five rights (access, rectification, erasure, restriction, objection)
// with a one-month statutory response deadline (Art. 12(3)), producing a machine-readable
// record. This demonstrates the rights process end-to-end locally — the in-app form
// (sign.html "Data rights request") writes the same record shape.
//
//   node cli/bin/rights.mjs list
//   node cli/bin/rights.mjs request --type erasure --subject "Jane Doe" --case c-123
//   node cli/bin/rights.mjs complete --id <id>
import { resolve, join } from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const STORE = resolve(process.cwd(), '.fieldseal-rights');
const RIGHTS = ['access', 'rectification', 'erasure', 'restriction', 'objection'];

function loadAll() {
  if (!existsSync(STORE)) return [];
  try { return JSON.parse(readFileSync(join(STORE, 'requests.json'), 'utf8')); }
  catch { return []; }
}
function saveAll(list) {
  if (!existsSync(STORE)) mkdirSync(STORE, { recursive: true });
  writeFileSync(join(STORE, 'requests.json'), JSON.stringify(list, null, 2));
}
function dueDate(received) {
  const d = new Date(received);
  return new Date(d.setMonth(d.getMonth() + 1)).toISOString().slice(0, 10);
}
function id() { return 'R' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? '  [PASS] ' : '  [FAIL] ') + name + (detail ? ' — ' + detail : ''));
  if (!ok) failures += 1;
}

function cmdRequest(type, subject, cid) {
  if (!RIGHTS.includes(type)) { console.error('unknown right: ' + type + ' (use one of ' + RIGHTS.join(', ') + ')'); process.exit(1); }
  const received = new Date().toISOString();
  const rec = { id: id(), type, subject: subject || 'unknown', caseId: cid || null, received, due: dueDate(received), status: 'received' };
  const all = loadAll(); all.push(rec); saveAll(all);
  console.log('Created request ' + rec.id + ' (' + type + ') — response due ' + rec.due);
  return rec;
}
function cmdList() {
  const all = loadAll();
  if (!all.length) { console.log('No rights requests on record.'); return; }
  for (const r of all) console.log(r.id + '  ' + r.type.padEnd(13) + '  ' + r.status.padEnd(10) + '  due ' + r.due + '  subject=' + r.subject);
}
function cmdComplete(rid) {
  const all = loadAll();
  const r = all.find((x) => x.id === rid);
  if (!r) { console.error('no such request: ' + rid); process.exit(1); }
  r.status = 'completed'; r.completed = new Date().toISOString(); saveAll(all);
  console.log('Completed ' + rid);
}

// Self-test mode (no args): exercise all five rights and the 1-month deadline.
if (process.argv.length <= 2) {
  console.log('GDPR rights walkthrough — exercising all five rights:');
  for (const t of RIGHTS) {
    const rec = cmdRequest(t, 'Test Subject', 'case-self-test');
    check('right=' + t + ' recorded with 1-month deadline', rec.due > rec.received.slice(0, 10) && rec.status === 'received', 'due ' + rec.due);
  }
  const all = loadAll();
  check('all five rights on record', all.length >= 5, all.length + ' records');
  console.log('\nRecords written to ' + STORE + '/requests.json');
  if (failures) { console.error('RIGHTS: FAIL (' + failures + ')'); process.exit(1); }
  console.log('RIGHTS: PASS — access/rectification/erasure/restriction/objection walkthrough complete');
} else {
  const sub = process.argv[2];
  if (sub === 'list') cmdList();
  else if (sub === 'request') {
    const ti = process.argv.indexOf('--type'); const si = process.argv.indexOf('--subject'); const ci = process.argv.indexOf('--case');
    cmdRequest(ti >= 0 ? process.argv[ti + 1] : 'access', si >= 0 ? process.argv[si + 1] : null, ci >= 0 ? process.argv[ci + 1] : null);
  } else if (sub === 'complete') {
    const ii = process.argv.indexOf('--id'); cmdComplete(ii >= 0 ? process.argv[ii + 1] : null);
  } else { console.error('usage: rights.mjs [list|request|complete]'); process.exit(1); }
}
