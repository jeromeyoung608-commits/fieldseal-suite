/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Regression: CSV formula injection (delivery-audit P0). A ledger cell beginning with
// = + - @ is executed as a formula by Excel / LibreOffice / Google Sheets. All FOUR
// production csvCell() implementations must neutralise it with a leading apostrophe
// BEFORE RFC4180 quoting. The two CLI modules run main() on import, so we extract the
// exact function source and evaluate it rather than require()-ing those scripts.
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TARGETS = [
 'pwa/helpers/case-export.js',
 'pwa/export/ase-export.js',
 'cli/bin/audit.js',
 'cli/bin/batch-verify.js'
];

function loadCsvCell(rel) {
 const src = readFileSync(join(ROOT, rel), 'utf8');
 const match = src.match(/^function csvCell\(value\) \{[\s\S]*?^\}/m);
 assert(match, rel + ': cannot locate csvCell()');
 return new Function('return (' + match[0] + ');')();
}

const ATTACKS = [
 '=1+1',
 '+1+1',
 '-1+1',
 '@SUM(A1:A2)',
 '=HYPERLINK("http://evil.example","click")',
 '=cmd|\' /C calc\'!A0',
 ' =1+1',
 '\t+2',
 '\n=9'
];

let checks = 0;
for (const rel of TARGETS) {
 const csvCell = loadCsvCell(rel);
 for (const value of ATTACKS) {
 const out = csvCell(value);
 const logical = out.startsWith('"') ? out.slice(1) : out;
 assert.equal(logical[0], "'", rel + ': formula prefix not neutralised for ' + JSON.stringify(value) + ' -> ' + out);
 checks++;
 }
 assert.equal(csvCell('=1+1'), "'=1+1", rel + ': apostrophe marker must be the only added byte');
 assert.equal(csvCell('plain text'), 'plain text', rel + ': plain text unchanged');
 assert.equal(csvCell(42), '42', rel + ': numeric unchanged');
 assert.equal(csvCell(null), '', rel + ': null unchanged');
 assert.equal(csvCell(undefined), '', rel + ': undefined unchanged');
 assert.equal(csvCell('a,b'), '"a,b"', rel + ': RFC4180 comma quoting preserved');
 assert.equal(csvCell('say "hi"'), '"say ""hi"""', rel + ': RFC4180 quote escaping preserved');
 checks += 7;
}

process.stdout.write('FIELDSEAL-TEST-OK csv-injection (' + TARGETS.length + ' modules, ' + checks + ' checks)\n');
