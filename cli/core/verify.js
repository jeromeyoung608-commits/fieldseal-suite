/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { computeRootHash, shaUri, normalizeAlgorithm } = require('./hash');
const zip = require('./zip-stream');
const schema = require('./schema-validate');

const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAX_NESTING_DEPTH = 8;
const SEVERITY = { ok: 0, tampered: 1, missing_linked_package: 2, invalid_spec: 3 };

function moreSevere(a, b) {
  return (SEVERITY[a] || 0) >= (SEVERITY[b] || 0) ? a : b;
}

function makeResult() {
  return { coreResult: 'ok', packageType: 'unknown', packageId: '', rootHash: '', pluginExtras: {} };
}

function isDirectory(name) {
  return name.endsWith('/');
}

function isRootEntry(name) {
  return !isDirectory(name) && name.indexOf('/') === -1;
}

function isAuxEntry(name) {
  return name.startsWith('aux/') && !isDirectory(name);
}

async function inspectPackage(filePath) {
  let handle;
  try {
    handle = await zip.readZip(filePath);
  } catch (err) {
    return null;
  }
  try {
    const entry = handle.getEntry('manifest.json') || handle.getEntry('bundle-index.json');
    if (!entry) return null;
    const text = await handle.readText(entry, MAX_MANIFEST_BYTES);
    const obj = JSON.parse(text);
    const checked = schema.validateManifest(obj);
    if (!checked.ok) return null;
    return {
      filePath,
      spec: obj.spec,
      id: checked.id,
      rootHash: obj.rootHash,
      type: checked.type
    };
  } catch (err) {
    return null;
  } finally {
    await handle.close();
  }
}

async function discoverLinkedPackages(targetPath) {
  const found = [];
  const seen = new Set([path.resolve(targetPath)]);
  const dirs = [path.dirname(path.resolve(targetPath)), process.cwd()];
  for (const dir of dirs) {
    let names;
    try {
      names = await fs.promises.readdir(dir);
    } catch (err) {
      continue;
    }
    for (const name of names) {
      if (found.length >= 64) break;
      if (!name.toLowerCase().endsWith('.zip') || name.startsWith('.')) continue;
      const candidate = path.join(dir, name);
      const resolved = path.resolve(candidate);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      found.push(candidate);
    }
  }
  return found;
}

// Streaming hash for declared files. Uses handle.hashEntry (no in-memory size cap) for the default
// sha256 algorithm, so large evidence assets (>64 MiB) verify correctly instead of tripping the
// readBytes 64 MiB cap and being misreported as `tampered`. Falls back to shaUri(readBytes) only for
// non-sha256 algorithms (rare; those are not subject to the same cap concern in practice).
async function hashEntrySafe(handle, entry, algo) {
  if (algo === 'sha256') return handle.hashEntry(entry);
  return shaUri(await handle.readBytes(entry), algo);
}

async function verifyEvidence(handle, manifest, result) {
  const extras = result.pluginExtras;
  const allowed = new Set(['manifest.json', 'bundle-index.json']);
  for (const file of manifest.files) allowed.add(file.name);
  const rootEntries = handle.entries.filter((entry) => isRootEntry(entry.name)).map((entry) => entry.name);
  const undeclared = rootEntries.filter((name) => !allowed.has(name));
  const auxEntries = handle.entries.filter((entry) => isAuxEntry(entry.name)).map((entry) => entry.name);
  extras.rootEntries = rootEntries;
  extras.auxEntries = auxEntries;
  extras.undeclaredRootEntries = undeclared;
  extras.createdAt = manifest.createdAt;
  if ('supersedesPackageId' in manifest) extras.supersedesPackageId = manifest.supersedesPackageId;
  if ('revisionReason' in manifest) extras.revisionReason = manifest.revisionReason;
  if ('tzIana' in manifest) extras.tzIana = manifest.tzIana;

  const problems = [];
  if (undeclared.length) problems.push('undeclared root entries: ' + undeclared.join(','));
  const checked = [];
  const algo = normalizeAlgorithm(manifest.hashAlgorithm);
  for (const file of manifest.files) {
    const entry = handle.getEntry(file.name);
    if (!entry) {
      problems.push('missing declared file: ' + file.name);
      checked.push({ name: file.name, ok: false, reason: 'missing' });
      continue;
    }
    try {
      const actual = await hashEntrySafe(handle, entry, algo);
      const ok = actual === file.hash;
      checked.push({ name: file.name, declared: file.hash, actual, ok });
      if (!ok) problems.push('file hash mismatch: ' + file.name);
    } catch (err) {
      problems.push('cannot read declared file: ' + file.name);
      checked.push({ name: file.name, ok: false, reason: String(err.message || err) });
    }
  }
  extras.checkedFiles = checked;
  if (problems.length) {
    result.coreResult = 'tampered';
    extras.reason = 'evidence integrity check failed';
    extras.problems = problems;
  }
}

async function verifySignature(handle, manifest, result, targetPath, opts) {
  const extras = result.pluginExtras;
  const rootEntries = handle.entries.filter((entry) => isRootEntry(entry.name)).map((entry) => entry.name);
  const undeclared = rootEntries.filter((name) => name !== 'manifest.json');
  const auxEntries = handle.entries.filter((entry) => isAuxEntry(entry.name));
  extras.rootEntries = rootEntries;
  extras.auxEntries = auxEntries.map((entry) => entry.name);
  extras.undeclaredRootEntries = undeclared;
  extras.createdAt = manifest.createdAt;
  extras.parties = manifest.parties;
  if ('tzIana' in manifest) extras.tzIana = manifest.tzIana;

  const modeEntry = handle.getEntry('aux/sign-mode.json');
  if (modeEntry) {
    try {
      const parsed = JSON.parse(await handle.readText(modeEntry));
      if (parsed && (parsed.signMode === 'joint' || parsed.signMode === 'independent')) {
        extras.signMode = parsed.signMode;
        if (typeof parsed.modeNote === 'string') extras.modeNote = parsed.modeNote;
      }
    } catch (err) {
      /* informational only: malformed sign-mode attachment does not affect verification */
    }
  }

  if (undeclared.length) {
    result.coreResult = 'tampered';
    extras.reason = 'undeclared root entries in signature package';
    extras.problems = undeclared;
    return;
  }

  let snapshotMatch = 'none';
  for (const entry of auxEntries) {
    try {
      if (await handle.hashEntry(entry) === manifest.canvasSnapshotHash) { snapshotMatch = entry.name; break; }
    } catch (err) {
      /* informational only */
    }
  }
  extras.canvasSnapshotMatch = snapshotMatch;

  if (!opts.allowLinkCheck || opts.noLink) {
    extras.linkCheck = 'deferred';
    return;
  }

  const candidates = [];
  const seen = new Set([path.resolve(targetPath)]);
  const add = (candidate) => {
    const resolved = path.resolve(candidate);
    if (!seen.has(resolved)) { seen.add(resolved); candidates.push(candidate); }
  };
  for (const candidate of opts.linkedPaths) add(candidate);
  for (const candidate of opts.bundleSiblings) add(candidate);
  if (opts.autoDiscover) for (const candidate of await discoverLinkedPackages(targetPath)) add(candidate);

  const infos = [];
  for (const candidate of candidates) {
    const info = await inspectPackage(candidate);
    if (info) infos.push(info);
  }
  extras.linkCandidates = infos.map((info) => ({ file: path.basename(info.filePath), spec: info.spec, id: info.id }));

  const linked = infos.find((info) => info.type === 'evidence' && info.id === manifest.linkedEvidenceId);
  if (!linked) {
    result.coreResult = 'missing_linked_package';
    extras.reason = 'linked evidence package not found';
    extras.linkedEvidenceId = manifest.linkedEvidenceId;
    return;
  }
  extras.linkResolution = opts.linkedPaths.some((p) => path.resolve(p) === path.resolve(linked.filePath))
    ? 'explicit'
    : (opts.bundleSiblings.some((p) => path.resolve(p) === path.resolve(linked.filePath)) ? 'bundle-sibling' : 'auto-discovered');

  if (linked.rootHash !== manifest.linkedEvidenceRootHash) {
    result.coreResult = 'tampered';
    extras.reason = 'linkedEvidenceRootHash mismatch';
    extras.linkedEvidenceRootHash = { declared: manifest.linkedEvidenceRootHash, actual: linked.rootHash };
    return;
  }
  const child = await verifyPackage(linked.filePath, {
    linkedPaths: [],
    bundleSiblings: [],
    autoDiscover: false,
    allowLinkCheck: false,
    depth: opts.depth + 1
  });
  extras.linkedEvidenceVerification = child;
  if (child.coreResult !== 'ok') {
    result.coreResult = moreSevere(result.coreResult, child.coreResult);
    extras.reason = 'linked evidence package failed verification';
  }
}

async function verifySupplement(handle, manifest, result, targetPath, opts) {
  const extras = result.pluginExtras;
  const rootEntries = handle.entries.filter((entry) => isRootEntry(entry.name)).map((entry) => entry.name);
  const allowed = new Set(['manifest.json']);
  for (const file of (manifest.files || [])) allowed.add(file.name);
  const undeclared = rootEntries.filter((name) => !allowed.has(name) && !name.toLowerCase().endsWith('.zip') && !name.startsWith('aux/'));
  const auxEntries = handle.entries.filter((entry) => isAuxEntry(entry.name));
  extras.rootEntries = rootEntries;
  extras.auxEntries = auxEntries.map((entry) => entry.name);
  extras.undeclaredRootEntries = undeclared;
  extras.createdAt = manifest.createdAt;
  extras.supplementToEvidenceId = manifest.supplementToEvidenceId;
  extras.note = manifest.note;
  if ('tzIana' in manifest) extras.tzIana = manifest.tzIana;
  if (manifest.files) extras.files = manifest.files;
  if (undeclared.length) {
    result.coreResult = 'tampered';
    extras.reason = 'undeclared root entries in supplement package';
    extras.problems = undeclared;
    return;
  }

  const problems = [];
  const algo = normalizeAlgorithm(manifest.hashAlgorithm);
  for (const file of (manifest.files || [])) {
    const entry = handle.getEntry(file.name);
    if (!entry) { problems.push('missing declared file: ' + file.name); continue; }
    try {
      if (await hashEntrySafe(handle, entry, algo) !== file.hash) problems.push('file hash mismatch: ' + file.name);
    } catch (err) {
      problems.push('cannot read declared file: ' + file.name);
    }
  }
  if (problems.length) {
    result.coreResult = 'tampered';
    extras.reason = 'supplement file integrity check failed';
    extras.problems = problems;
    return;
  }

  if (!opts.allowLinkCheck || opts.noLink) {
    extras.linkCheck = 'deferred';
    return;
  }

  const candidates = [];
  const seen = new Set([path.resolve(targetPath)]);
  const add = (candidate) => {
    const resolved = path.resolve(candidate);
    if (!seen.has(resolved)) { seen.add(resolved); candidates.push(candidate); }
  };
  for (const candidate of opts.linkedPaths) add(candidate);
  for (const candidate of opts.bundleSiblings) add(candidate);
  if (opts.autoDiscover) for (const candidate of await discoverLinkedPackages(targetPath)) add(candidate);

  const infos = [];
  for (const candidate of candidates) {
    const info = await inspectPackage(candidate);
    if (info) infos.push(info);
  }
  extras.linkCandidates = infos.map((info) => ({ file: path.basename(info.filePath), spec: info.spec, id: info.id }));

  const linked = infos.find((info) => info.type === 'evidence' && info.id === manifest.supplementToEvidenceId);
  if (!linked) {
    result.coreResult = 'missing_linked_package';
    extras.reason = 'bound evidence package not found';
    extras.supplementToEvidenceId = manifest.supplementToEvidenceId;
    return;
  }
  extras.linkResolution = opts.linkedPaths.some((p) => path.resolve(p) === path.resolve(linked.filePath))
    ? 'explicit'
    : (opts.bundleSiblings.some((p) => path.resolve(p) === path.resolve(linked.filePath)) ? 'bundle-sibling' : 'auto-discovered');

  const child = await verifyPackage(linked.filePath, {
    linkedPaths: [],
    bundleSiblings: [],
    autoDiscover: false,
    allowLinkCheck: false,
    depth: opts.depth + 1
  });
  extras.boundEvidenceVerification = child;
  if (child.coreResult !== 'ok') {
    result.coreResult = moreSevere(result.coreResult, child.coreResult);
    extras.reason = 'bound evidence package failed verification';
  }
}

async function verifyBundle(handle, index, result, opts) {
  const extras = result.pluginExtras;
  const rootEntries = handle.entries.filter((entry) => isRootEntry(entry.name)).map((entry) => entry.name);
  const childEntries = handle.entries.filter((entry) => isRootEntry(entry.name) && entry.name.toLowerCase().endsWith('.zip'));
  const undeclared = rootEntries.filter((name) => name !== 'bundle-index.json' && !name.toLowerCase().endsWith('.zip'));
  extras.rootEntries = rootEntries;
  extras.childArchives = childEntries.map((entry) => entry.name);
  extras.undeclaredRootEntries = undeclared;
  if (undeclared.length) {
    result.coreResult = 'tampered';
    extras.reason = 'undeclared root entries in bundle';
    extras.problems = undeclared;
    return;
  }

  let tempDir = null;
  try {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fieldseal-verify-'));
    const children = [];
    for (let i = 0; i < childEntries.length; i++) {
      const entry = childEntries[i];
      const hash = await handle.hashEntry(entry);
      const outPath = path.join(tempDir, 'child-' + i + '.zip');
      await handle.extractToFile(entry, outPath);
      children.push({ name: entry.name, hash, path: outPath });
    }

    const problems = [];
    const pairs = [];
    for (let i = 0; i < index.items.length; i++) {
      const item = index.items[i];
      const match = children.find((child) => child.hash === item.hash);
      if (!match) {
        problems.push('no child archive matches items[' + i + '].hash for ' + item.packageId);
        continue;
      }
      pairs.push({ item, child: match, itemIndex: i });
    }
    for (const child of children) {
      if (!index.items.some((item) => item.hash === child.hash)) problems.push('child archive not declared in items: ' + child.name);
    }

    const siblings = children.map((child) => child.path);
    const reports = [];
    let overall = 'ok';
    for (const pair of pairs) {
      const report = {
        itemIndex: pair.itemIndex,
        packageId: pair.item.packageId,
        type: pair.item.type,
        hash: pair.item.hash,
        file: pair.child.name
      };
      const info = await inspectPackage(pair.child.path);
      if (!info) {
        report.result = 'invalid_spec';
        problems.push('child archive cannot be read: ' + pair.child.name);
        overall = moreSevere(overall, 'invalid_spec');
        reports.push(report);
        continue;
      }
      report.filePackageId = info.id;
      report.fileType = info.type;
      if (info.id !== pair.item.packageId) {
        problems.push('items[' + pair.itemIndex + '].packageId does not match child package');
        overall = moreSevere(overall, 'tampered');
      }
      if (info.type !== pair.item.type) {
        problems.push('items[' + pair.itemIndex + '].type does not match child package');
        overall = moreSevere(overall, 'tampered');
      }
      const childResult = await verifyPackage(pair.child.path, {
        linkedPaths: opts.linkedPaths,
        bundleSiblings: siblings,
        autoDiscover: false,
        allowLinkCheck: true,
        noLink: opts.noLink,
        depth: opts.depth + 1
      });
      report.result = childResult.coreResult;
      report.packageType = childResult.packageType;
      report.rootHash = childResult.rootHash;
      if (childResult.coreResult !== 'ok') overall = moreSevere(overall, childResult.coreResult);
      reports.push(report);
    }
    extras.items = reports;
    if (problems.length) {
      extras.problems = problems;
      overall = moreSevere(overall, 'tampered');
      extras.reason = 'bundle structure check failed';
    }
    if (overall !== 'ok') {
      result.coreResult = overall;
      if (!extras.reason) extras.reason = 'bundle child verification failed';
    }
  } catch (err) {
    result.coreResult = 'tampered';
    extras.reason = 'bundle extraction failed';
    extras.problems = [String(err.message || err)];
  } finally {
    if (tempDir) await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function verifyPackage(targetPath, options = {}) {
  const opts = {
    linkedPaths: options.linkedPaths || [],
    bundleSiblings: options.bundleSiblings || [],
    autoDiscover: options.autoDiscover !== false,
    allowLinkCheck: options.allowLinkCheck !== false,
    noLink: options.noLink === true,
    depth: options.depth || 0
  };
  const result = makeResult();
  if (opts.depth > MAX_NESTING_DEPTH) {
    result.coreResult = 'tampered';
    result.pluginExtras = { reason: 'maximum bundle nesting depth exceeded' };
    return result;
  }

  let handle;
  try {
    handle = await zip.readZip(targetPath);
  } catch (err) {
    result.coreResult = 'tampered';
    result.pluginExtras = { reason: 'ZIP container unreadable', zipError: String(err.message || err) };
    return result;
  }

  try {
    const manifestEntry = handle.getEntry('manifest.json') || handle.getEntry('bundle-index.json');
    if (!manifestEntry) {
      result.coreResult = 'invalid_spec';
      result.pluginExtras = { reason: 'root manifest not found' };
      return result;
    }
    let obj;
    try {
      obj = JSON.parse(await handle.readText(manifestEntry, MAX_MANIFEST_BYTES));
    } catch (err) {
      result.coreResult = 'invalid_spec';
      result.pluginExtras = { reason: 'root manifest is not readable JSON', detail: String(err.message || err) };
      return result;
    }
    const checked = schema.validateManifest(obj);
    if (!checked.ok) {
      result.coreResult = 'invalid_spec';
      result.pluginExtras = { reason: 'schema validation failed', spec: checked.spec, errors: checked.errors };
      return result;
    }
    result.packageType = checked.type;
    result.packageId = checked.id;
    result.rootHash = obj.rootHash;
    result.pluginExtras.spec = obj.spec;
    if ('hashAlgorithm' in obj) result.pluginExtras.hashAlgorithm = obj.hashAlgorithm;
    if (obj.custody) result.pluginExtras.custody = obj.custody;

    const computed = computeRootHash(obj);
    if (computed !== obj.rootHash) {
      result.coreResult = 'tampered';
      result.pluginExtras.reason = 'rootHash mismatch';
      result.pluginExtras.computedRootHash = computed;
      result.pluginExtras.declaredRootHash = obj.rootHash;
      return result;
    }

    if (checked.type === 'evidence') await verifyEvidence(handle, obj, result);
    else if (checked.type === 'signature-record') await verifySignature(handle, obj, result, targetPath, opts);
    else if (checked.type === 'supplement') await verifySupplement(handle, obj, result, targetPath, opts);
    else await verifyBundle(handle, obj, result, opts);
  } finally {
    await handle.close();
  }
  return result;
}

async function verifyMany(targetPaths, options = {}) {
  const results = [];
  for (const target of targetPaths) results.push(await verifyPackage(target, options));
  return results;
}

module.exports = { verifyPackage, verifyMany, inspectPackage, moreSevere, MAX_MANIFEST_BYTES };
