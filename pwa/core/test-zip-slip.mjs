/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Regression: `case verify` must NOT let a malicious archive entry write outside the temp dir (ZIP-Slip,
// delivery-audit B-03). extractCaseToTmp refuses any entry whose name contains `..`, a leading `/` or `\`,
// or an empty/dot segment (see safeEntryRel). We unit-test that helper directly — it is exactly the logic
// used when extracting a case archive, so a traversal/absolute entry is never written anywhere.
import { safeEntryRel } from '../../cli/core/case-verify.js';

let pass = 0, fail = 0;
function assert(c, m) { if (c) { pass++; console.log(' ok - ' + m); } else { fail++; console.log(' FAIL- ' + m); } }

assert(safeEntryRel('../../../../tmp/x') === null, 'traversal rejected');
assert(safeEntryRel('/abs/x') === null, 'absolute rejected');
assert(safeEntryRel('\\abs\\x') === null, 'backslash absolute rejected');
assert(safeEntryRel('') === null, 'empty rejected');
assert(safeEntryRel('.') === null, 'dotfile rejected');
assert(safeEntryRel('a/./b') === null, 'dot segment rejected');
assert(safeEntryRel('a/../b') === null, 'mid traversal rejected');
assert(safeEntryRel('a/b.txt') === 'a/b.txt', 'normal path kept');
assert(safeEntryRel('nested/dir/file.json') === 'nested/dir/file.json', 'nested kept');
assert(safeEntryRel('case-manifest.json') === 'case-manifest.json', 'top-level filename kept');

console.log((fail ? 'FIELDSEAL-TEST-FAIL' : 'FIELDSEAL-TEST-OK') + ' zip-slip (' + pass + ' pass, ' + fail + ' fail)');
process.exit(fail ? 1 : 0);
