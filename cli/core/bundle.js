/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const { canonicalJson, computeRootHash, isoUtcNow, uuidV4 } = require('./hash');
const zip = require('./zip-stream');
const schema = require('./schema-validate');

const BUNDLE_SPEC = 'fieldseal-bundle-v0.1';
const MAX_CHILD_MANIFEST_BYTES = 8 * 1024 * 1024;

async function readChildInfo(filePath) {
  const handle = await zip.readZip(filePath);
  try {
    const entry = handle.getEntry('manifest.json') || handle.getEntry('bundle-index.json');
    if (!entry) throw new Error('child package has no root manifest');
    const obj = JSON.parse(await handle.readText(entry, MAX_CHILD_MANIFEST_BYTES));
    const checked = schema.validateManifest(obj);
    if (!checked.ok) throw new Error('child package invalid: ' + checked.errors.join('; '));
    if (checked.type === 'bundle') throw new Error('nested bundles are not allowed as items');
    return { id: checked.id, type: checked.type, spec: checked.spec };
  } finally {
    await handle.close();
  }
}

function safeChildName(inputPath, used) {
  let base = path.basename(inputPath);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(base) || !base.toLowerCase().endsWith('.zip')) base = 'child.zip';
  let name = base;
  let n = 1;
  while (used.has(name)) {
    name = base.replace(/\.zip$/i, '') + '-' + n + '.zip';
    n++;
  }
  used.add(name);
  return name;
}

async function buildBundle(inputPaths, outputPath, auxFiles) {
  if (!Array.isArray(inputPaths) || inputPaths.length < 1) throw new Error('bundle needs at least one input package');
  const output = path.resolve(outputPath);
  for (const input of inputPaths) {
    if (path.resolve(input) === output) throw new Error('bundle output must differ from every input package');
  }

  const items = [];
  const sources = [];
  const used = new Set(['bundle-index.json']);
  for (const input of inputPaths) {
    await fs.promises.access(input, fs.constants.R_OK);
    const info = await readChildInfo(input);
    const scan = await zip.scanFile(input);
    items.push({ packageId: info.id, type: info.type, hash: scan.sha256 });
    sources.push({ name: safeChildName(input, used), sourcePath: input });
  }

  const index = {
    spec: BUNDLE_SPEC,
    bundleId: uuidV4(),
    createdAt: isoUtcNow(),
    items
  };
  index.rootHash = computeRootHash(index);
  const indexText = canonicalJson(index);

  const auxEntries = (Array.isArray(auxFiles) ? auxFiles : []).map((aux) => {
    const name = 'aux/' + String(aux.name).replace(/^aux\//, '');
    return aux.sourcePath ? { name, sourcePath: aux.sourcePath } : { name, data: aux.data };
  });
  const entries = [{ name: 'bundle-index.json', data: Buffer.from(indexText, 'utf8') }]
    .concat(auxEntries)
    .concat(sources.map((source) => ({ name: source.name, sourcePath: source.sourcePath })));
  await fs.promises.mkdir(path.dirname(output), { recursive: true });
  await zip.writeZip(output, entries);

  return {
    outputPath: output,
    bundleId: index.bundleId,
    rootHash: index.rootHash,
    items,
    childNames: sources.map((source) => source.name),
    indexText
  };
}

module.exports = { buildBundle, BUNDLE_SPEC };
