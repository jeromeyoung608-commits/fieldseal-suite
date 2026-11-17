/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */
// 9.0 security item S6 — ZIP path-traversal (zip-slip) safety.
// The ZIP writer must refuse entry names that could escape the target directory.
const { writeZip } = await import('../../cli/core/zip-stream.js');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok  - ' + name);
  else { console.error('  FAIL - ' + name + (detail ? ' :: ' + detail : '')); failures += 1; }
}
(async () => {
  const cases = ['../escape.txt', '../../etc/passwd', '/abs/path.txt', 'a/../../b.txt', 'normal.txt'];
  for (const name of cases) {
    if (name === 'normal.txt') {
      try { await writeZip('/tmp/fs-zip-slip-test.zip', [{ name, data: 'ok' }]); check('safe name "' + name + '" accepted', true); }
      catch (e) { check('safe name "' + name + '" accepted', false, e.message); }
      continue;
    }
    let threw = false;
    try { await writeZip('/tmp/fs-zip-slip-test.zip', [{ name, data: 'x' }]); } catch (e) { threw = true; }
    check('unsafe name "' + name + '" rejected', threw === true);
  }
  if (failures) { console.error('ZIP-SLIP: FAIL (' + failures + ')'); process.exit(1); }
  console.log('ZIP-SLIP: PASS — zip writer blocks path traversal');
})();
