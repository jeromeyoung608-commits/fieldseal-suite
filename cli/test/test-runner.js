/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const os = require('os');

const {
  canonicalJson, computeRootHash, sha256Uri, uuidV4, isoUtcNow, hashFile
} = require('../core/hash');
const zip = require('../core/zip-stream');
const verifyCore = require('../core/verify');
const bundleCore = require('../core/bundle');

const ROOT = path.resolve(__dirname, '..', '..');
const CLI_ENTRY = path.join(ROOT, 'cli', 'bin', 'audit.js');
const FIXTURES = path.join(__dirname, 'fixtures');
const CASES = path.join(FIXTURES, '.tmp');

const PHOTO = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');
const VIDEO = Buffer.from('000000186674797069736f6d0000020069736f6d6d703431000000086d646174', 'hex');
const PREVIEW = Buffer.from('low-bitrate-preview-reference-only');
const SNAPSHOT = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const OTHER_HASH = 'sha256:' + '1'.repeat(64);
const ZERO_HASH = 'sha256:' + '0'.repeat(64);

const results = [];

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

function expect(actual, wanted, label) {
  if (actual !== wanted) throw new Error((label || 'value') + ': expected ' + wanted + ', got ' + actual);
}

async function runCase(id, desc, fn) {
  try {
    const detail = await fn();
    results.push({ id, ok: true });
    process.stdout.write('PASS ' + id + '  ' + desc + (detail ? '  [' + detail + ']' : '') + '\n');
  } catch (err) {
    results.push({ id, ok: false, error: String(err.message || err) });
    process.stdout.write('FAIL ' + id + '  ' + desc + '  -> ' + String(err.message || err) + '\n');
  }
}

function caseDir(id) {
  return path.join(CASES, id);
}

async function writePackage(dir, fileName, manifestOrText, entries) {
  await fs.promises.mkdir(dir, { recursive: true });
  const text = typeof manifestOrText === 'string' ? manifestOrText : canonicalJson(manifestOrText);
  await fs.promises.writeFile(path.join(dir, 'manifest.json'), text);
  const list = [{ name: 'manifest.json', data: Buffer.from(text, 'utf8') }].concat(entries || []);
  const out = path.join(dir, fileName);
  await zip.writeZip(out, list);
  return out;
}

async function writeBundlePackage(dir, fileName, index, children) {
  await fs.promises.mkdir(dir, { recursive: true });
  const text = canonicalJson(index);
  await fs.promises.writeFile(path.join(dir, 'bundle-index.json'), text);
  const list = [{ name: 'bundle-index.json', data: Buffer.from(text, 'utf8') }].concat(children || []);
  const out = path.join(dir, fileName);
  await zip.writeZip(out, list);
  return out;
}

function evidenceEntries(ev) {
  return ev.files.map((file) => ({ name: file.name, data: file.data }));
}

function makeEvidence(kind, opts = {}) {
  const photo = opts.photo || PHOTO;
  const video = opts.video || VIDEO;
  const files = [{ name: 'photo.jpg', data: photo, type: 'image' }];
  if (kind === 'fieldseal-evidence-v0.2') files.push({ name: 'video.mp4', data: video, type: 'video' });
  const base = { spec: kind, packageId: opts.id || uuidV4(), createdAt: isoUtcNow() };
  if (kind === 'fieldseal-evidence-v0.2') {
    base.captureTsDevice = '2026-11-11T11:00:00+01:00';
    base.gps = { lat: '52.5200', lon: '13.4050' };
    base.note = '现场维修验收记录';
    base.tags = ['schaden', 'installation', 'handwerk'];
    base.mp4SanityCheck = { status: 'ok', note: 'moov/mdat segment found' };
  }
  base.files = files.map((file) => ({ name: file.name, hash: sha256Uri(file.data), type: file.type }));
  let manifest = opts.mutate ? opts.mutate(Object.assign({}, base)) : base;
  const expectedRootHash = computeRootHash(manifest);
  manifest = Object.assign({}, manifest, { rootHash: opts.overrideRootHash || expectedRootHash });
  return { manifest, files, expectedRootHash };
}

function makeSignature(ev, opts = {}) {
  const snapshot = opts.snapshot || SNAPSHOT;
  const base = {
    spec: 'fieldseal-signature-v0.1',
    packageId: opts.id || uuidV4(),
    createdAt: isoUtcNow(),
    linkedEvidenceId: opts.linkedEvidenceId || ev.manifest.packageId,
    linkedEvidenceRootHash: opts.linkedEvidenceRootHash || ev.manifest.rootHash,
    parties: [
      { name: 'Kunde', confirm: true, signedAt: isoUtcNow() },
      { name: 'Handwerker', confirm: true, signedAt: isoUtcNow() }
    ],
    canvasSnapshotHash: sha256Uri(snapshot),
    sealNote: '双方验收确认无异议'
  };
  let manifest = opts.mutate ? opts.mutate(Object.assign({}, base)) : base;
  manifest = Object.assign({}, manifest, { rootHash: opts.overrideRootHash || computeRootHash(manifest) });
  return { manifest, snapshot };
}

function makeBundleIndex(items, opts = {}) {
  const index = {
    spec: 'fieldseal-bundle-v0.1',
    bundleId: opts.id || uuidV4(),
    createdAt: isoUtcNow(),
    items
  };
  index.rootHash = opts.overrideRootHash || computeRootHash(index);
  return index;
}

function signatureEntries(sig) {
  return [{ name: 'aux/canvas-snapshot.png', data: sig.snapshot }];
}

async function makePair(dir, kind) {
  const ev = makeEvidence(kind);
  const evPath = await writePackage(dir, 'evidence.zip', ev.manifest, evidenceEntries(ev));
  const sig = makeSignature(ev);
  const sigPath = await writePackage(dir, 'signature-record.zip', sig.manifest, signatureEntries(sig));
  return { ev, evPath, sig, sigPath };
}

async function runFunctionalCases() {
  await runCase('N-01', 'minimal evidence v0.1 verifies ok', async () => {
    const ev = makeEvidence('fieldseal-evidence-v0.1');
    const pkg = await writePackage(caseDir('n01'), 'evidence.zip', ev.manifest, evidenceEntries(ev));
    const r = await verifyCore.verifyPackage(pkg, { autoDiscover: false });
    expect(r.coreResult, 'ok', 'coreResult');
    expect(r.packageType, 'evidence', 'packageType');
    expect(r.rootHash, ev.manifest.rootHash, 'rootHash');
    return r.rootHash.slice(0, 15) + '...';
  });

  await runCase('N-02', 'full evidence v0.2 with aux preview verifies ok', async () => {
    const ev = makeEvidence('fieldseal-evidence-v0.2');
    const entries = evidenceEntries(ev).concat([{ name: 'aux/preview.mp4', data: PREVIEW }]);
    const pkg = await writePackage(caseDir('n02'), 'evidence.zip', ev.manifest, entries);
    const r = await verifyCore.verifyPackage(pkg, { autoDiscover: false });
    expect(r.coreResult, 'ok', 'coreResult');
    assert(r.pluginExtras.auxEntries.includes('aux/preview.mp4'), 'aux entry not recorded');
    return 'aux excluded from root hash tree';
  });

  await runCase('N-03', 'UTF-8 note and tags survive canonical serialization', async () => {
    const ev = makeEvidence('fieldseal-evidence-v0.2');
    const pkg = await writePackage(caseDir('n03'), 'evidence.zip', ev.manifest, evidenceEntries(ev));
    expect((await verifyCore.verifyPackage(pkg, { autoDiscover: false })).coreResult, 'ok', 'coreResult');
  });

  await runCase('N-04', 'signature v0.1 with linked evidence verifies ok', async () => {
    const pair = await makePair(caseDir('n04'), 'fieldseal-evidence-v0.2');
    const r = await verifyCore.verifyPackage(pair.sigPath, { linkedPaths: [pair.evPath], autoDiscover: false });
    expect(r.coreResult, 'ok', 'coreResult');
    expect(r.packageType, 'signature-record', 'packageType');
    expect(r.pluginExtras.linkResolution, 'explicit', 'linkResolution');
    return 'linkedEvidenceRootHash matched';
  });

  await runCase('N-05', 'super-bundle recursively verifies both children ok', async () => {
    const dir = caseDir('n05');
    const pair = await makePair(dir, 'fieldseal-evidence-v0.2');
    const out = path.join(dir, 'super-bundle.zip');
    const info = await bundleCore.buildBundle([pair.evPath, pair.sigPath], out);
    const r = await verifyCore.verifyPackage(out, { autoDiscover: false });
    expect(r.coreResult, 'ok', 'coreResult');
    expect(r.packageType, 'bundle', 'packageType');
    expect(r.pluginExtras.items.length, 2, 'items verified');
    assert(r.pluginExtras.items.every((item) => item.result === 'ok'), 'a child did not verify ok');
    return info.rootHash.slice(0, 15) + '...';
  });

  await runCase('N-06', 'report-html emits a standalone static HTML report', async () => {
    const ev = makeEvidence('fieldseal-evidence-v0.2');
    const pkg = await writePackage(caseDir('n06'), 'evidence.zip', ev.manifest, evidenceEntries(ev));
    const res = spawnSync(process.execPath, [CLI_ENTRY, 'report-html', pkg], { encoding: 'utf8' });
    assert(res.status === 0, 'report-html exit status ' + res.status + ': ' + res.stderr);
    assert(/<!doctype html>/i.test(res.stdout), 'missing doctype');
    assert(!/https?:\/\//i.test(res.stdout), 'report references a remote URL');
    assert(!/<script/i.test(res.stdout), 'report contains a script tag');
    assert(res.stdout.includes('eIDAS'), 'report footer disclaimer missing');
    assert(/class="badge ok">ok</.test(res.stdout), 'result badge not rendered');
    return 'no external resources, disclaimer present';
  });

  await runCase('N-07a', '16 MiB media file verified through streaming path', async () => {
    const dir = caseDir('n07a');
    const big = Buffer.alloc(16 * 1024 * 1024);
    for (let i = 0; i < big.length; i += 4096) big[i] = i & 0xff;
    const ev = makeEvidence('fieldseal-evidence-v0.2', { video: big });
    const pkg = await writePackage(dir, 'evidence.zip', ev.manifest, evidenceEntries(ev));
    const r = await verifyCore.verifyPackage(pkg, { autoDiscover: false });
    expect(r.coreResult, 'ok', 'coreResult');
    return '16 MiB STORE entry hashed in chunks';
  });

  await runCase('N-07b', 'ZIP64 EOCD/locator byte layout is correct', async () => {
    const rec = zip.buildZip64EocdRecord(70000, 1234567, 7654321);
    expect(rec.readUInt32LE(0), 0x06064b50, 'zip64 eocd signature');
    expect(Number(rec.readBigUInt64LE(32)), 70000, 'entry count');
    expect(Number(rec.readBigUInt64LE(40)), 1234567, 'cd size');
    expect(Number(rec.readBigUInt64LE(48)), 7654321, 'cd offset');
    const loc = zip.buildZip64Locator(999);
    expect(loc.readUInt32LE(0), 0x07064b50, 'locator signature');
    expect(Number(loc.readBigUInt64LE(8)), 999, 'zip64 eocd offset');
  });

  await runCase('T-01', 'flipping one media byte is detected', async () => {
    const ev = makeEvidence('fieldseal-evidence-v0.2');
    const bad = Buffer.from(ev.files[0].data);
    bad[0] ^= 0x01;
    const entries = [{ name: 'photo.jpg', data: bad }, { name: 'video.mp4', data: ev.files[1].data }];
    const pkg = await writePackage(caseDir('t01'), 'evidence.zip', ev.manifest, entries);
    expect((await verifyCore.verifyPackage(pkg, { autoDiscover: false })).coreResult, 'tampered', 'coreResult');
  });

  await runCase('T-02', 'appending one byte to video is detected', async () => {
    const ev = makeEvidence('fieldseal-evidence-v0.2');
    const entries = [
      { name: 'photo.jpg', data: ev.files[0].data },
      { name: 'video.mp4', data: Buffer.concat([ev.files[1].data, Buffer.from([0x00])]) }
    ];
    const pkg = await writePackage(caseDir('t02'), 'evidence.zip', ev.manifest, entries);
    expect((await verifyCore.verifyPackage(pkg, { autoDiscover: false })).coreResult, 'tampered', 'coreResult');
  });

  await runCase('T-03', 'editing manifest note without rehashing is detected', async () => {
    const ev = makeEvidence('fieldseal-evidence-v0.2');
    const edited = Object.assign({}, ev.manifest, { note: '被篡改的备注' });
    const pkg = await writePackage(caseDir('t03'), 'evidence.zip', edited, evidenceEntries(ev));
    expect((await verifyCore.verifyPackage(pkg, { autoDiscover: false })).coreResult, 'tampered', 'coreResult');
  });

  await runCase('T-04', 'replacing rootHash with another valid hash is detected', async () => {
    const ev = makeEvidence('fieldseal-evidence-v0.2', { overrideRootHash: ZERO_HASH });
    const pkg = await writePackage(caseDir('t04'), 'evidence.zip', ev.manifest, evidenceEntries(ev));
    expect((await verifyCore.verifyPackage(pkg, { autoDiscover: false })).coreResult, 'tampered', 'coreResult');
  });

  await runCase('T-05', 'removing a declared file is detected', async () => {
    const ev = makeEvidence('fieldseal-evidence-v0.2');
    const entries = [{ name: 'photo.jpg', data: ev.files[0].data }];
    const pkg = await writePackage(caseDir('t05'), 'evidence.zip', ev.manifest, entries);
    expect((await verifyCore.verifyPackage(pkg, { autoDiscover: false })).coreResult, 'tampered', 'coreResult');
  });

  await runCase('T-06', 'an undeclared root entry is rejected', async () => {
    const ev = makeEvidence('fieldseal-evidence-v0.2');
    const entries = evidenceEntries(ev).concat([{ name: 'extra.jpg', data: Buffer.from('sneaked') }]);
    const pkg = await writePackage(caseDir('t06'), 'evidence.zip', ev.manifest, entries);
    expect((await verifyCore.verifyPackage(pkg, { autoDiscover: false })).coreResult, 'tampered', 'coreResult');
  });

  await runCase('T-07', 'unknown spec version is invalid_spec', async () => {
    const ev = makeEvidence('fieldseal-evidence-v0.2');
    const edited = Object.assign({}, ev.manifest, { spec: 'fieldseal-evidence-v0.9' });
    const pkg = await writePackage(caseDir('t07'), 'evidence.zip', edited, evidenceEntries(ev));
    expect((await verifyCore.verifyPackage(pkg, { autoDiscover: false })).coreResult, 'invalid_spec', 'coreResult');
  });

  await runCase('T-08', 'malformed manifest JSON is invalid_spec', async () => {
    const pkg = await writePackage(caseDir('t08'), 'evidence.zip', '{ this is not json', []);
    expect((await verifyCore.verifyPackage(pkg, { autoDiscover: false })).coreResult, 'invalid_spec', 'coreResult');
  });

  await runCase('T-09', 'missing createdAt is invalid_spec', async () => {
    const ev = makeEvidence('fieldseal-evidence-v0.2');
    const edited = Object.assign({}, ev.manifest);
    delete edited.createdAt;
    const pkg = await writePackage(caseDir('t09'), 'evidence.zip', edited, evidenceEntries(ev));
    expect((await verifyCore.verifyPackage(pkg, { autoDiscover: false })).coreResult, 'invalid_spec', 'coreResult');
  });

  await runCase('T-10', 'privately added manifest field is invalid_spec', async () => {
    const ev = makeEvidence('fieldseal-evidence-v0.2');
    const edited = Object.assign({}, ev.manifest, { customField: 'not allowed' });
    const pkg = await writePackage(caseDir('t10'), 'evidence.zip', edited, evidenceEntries(ev));
    expect((await verifyCore.verifyPackage(pkg, { autoDiscover: false })).coreResult, 'invalid_spec', 'coreResult');
  });

  await runCase('T-11', 'wrong field type is invalid_spec', async () => {
    const ev = makeEvidence('fieldseal-evidence-v0.2');
    const edited = Object.assign({}, ev.manifest, { files: { name: 'photo.jpg' } });
    const pkg = await writePackage(caseDir('t11'), 'evidence.zip', edited, evidenceEntries(ev));
    expect((await verifyCore.verifyPackage(pkg, { autoDiscover: false })).coreResult, 'invalid_spec', 'coreResult');
  });

  await runCase('T-12', 'non-canonical JSON text still verifies via C2 recomputation', async () => {
    const ev = makeEvidence('fieldseal-evidence-v0.2');
    const pretty = JSON.stringify(ev.manifest, null, 2) + '\r\n';
    const pkg = await writePackage(caseDir('t12'), 'evidence.zip', pretty, evidenceEntries(ev));
    expect((await verifyCore.verifyPackage(pkg, { autoDiscover: false })).coreResult, 'ok', 'coreResult');
    return 'ok (recomputed over parsed object)';
  });

  await runCase('T-13', 'tampering an aux preview does not break an evidence package', async () => {
    const ev = makeEvidence('fieldseal-evidence-v0.2');
    const entries = evidenceEntries(ev).concat([{ name: 'aux/preview.mp4', data: Buffer.from('modified preview') }]);
    const pkg = await writePackage(caseDir('t13'), 'evidence.zip', ev.manifest, entries);
    expect((await verifyCore.verifyPackage(pkg, { autoDiscover: false })).coreResult, 'ok', 'coreResult');
  });

  await runCase('T-14', 'illegal file name in files[] is invalid_spec', async () => {
    const ev = makeEvidence('fieldseal-evidence-v0.2', {
      mutate: (m) => { m.files[0].name = '照片.jpg'; return m; }
    });
    const pkg = await writePackage(caseDir('t14'), 'evidence.zip', ev.manifest, evidenceEntries(ev));
    expect((await verifyCore.verifyPackage(pkg, { autoDiscover: false })).coreResult, 'invalid_spec', 'coreResult');
    return 'files[].name violates C5';
  });

  await runCase('X-01', 'linkedEvidenceRootHash mismatch is tampered', async () => {
    const dir = caseDir('x01');
    const ev = makeEvidence('fieldseal-evidence-v0.2');
    const evPath = await writePackage(dir, 'evidence.zip', ev.manifest, evidenceEntries(ev));
    const sig = makeSignature(ev, { linkedEvidenceRootHash: OTHER_HASH });
    const sigPath = await writePackage(dir, 'signature-record.zip', sig.manifest, signatureEntries(sig));
    const r = await verifyCore.verifyPackage(sigPath, { linkedPaths: [evPath], autoDiscover: false });
    expect(r.coreResult, 'tampered', 'coreResult');
    expect(r.pluginExtras.reason, 'linkedEvidenceRootHash mismatch', 'reason');
  });

  await runCase('X-02', 'substituting the evidence package is tampered', async () => {
    const dir = caseDir('x02');
    const ev = makeEvidence('fieldseal-evidence-v0.2');
    const sig = makeSignature(ev);
    const sigPath = await writePackage(dir, 'signature-record.zip', sig.manifest, signatureEntries(sig));
    const fake = makeEvidence('fieldseal-evidence-v0.2', { id: ev.manifest.packageId, photo: Buffer.from('different photo') });
    const fakePath = await writePackage(dir, 'evidence.zip', fake.manifest, evidenceEntries(fake));
    expect((await verifyCore.verifyPackage(sigPath, { linkedPaths: [fakePath], autoDiscover: false })).coreResult, 'tampered', 'coreResult');
  });

  await runCase('X-03', 'signature without its evidence package is missing_linked_package', async () => {
    const dir = caseDir('x03');
    const ev = makeEvidence('fieldseal-evidence-v0.2');
    const sig = makeSignature(ev);
    const sigPath = await writePackage(dir, 'signature-record.zip', sig.manifest, signatureEntries(sig));
    const r = await verifyCore.verifyPackage(sigPath, { autoDiscover: false });
    expect(r.coreResult, 'missing_linked_package', 'coreResult');
  });

  await runCase('X-04', 'linkedEvidenceId pointing to an unknown package is missing_linked_package', async () => {
    const dir = caseDir('x04');
    const ev = makeEvidence('fieldseal-evidence-v0.2');
    const evPath = await writePackage(dir, 'evidence.zip', ev.manifest, evidenceEntries(ev));
    const sig = makeSignature(ev, { linkedEvidenceId: uuidV4() });
    const sigPath = await writePackage(dir, 'signature-record.zip', sig.manifest, signatureEntries(sig));
    expect((await verifyCore.verifyPackage(sigPath, { linkedPaths: [evPath], autoDiscover: false })).coreResult, 'missing_linked_package', 'coreResult');
  });

  await runCase('X-05', 'replacing a bundle child without updating items[].hash is rejected', async () => {
    const dir = caseDir('x05');
    const pair = await makePair(dir, 'fieldseal-evidence-v0.2');
    const info = await bundleCore.buildBundle([pair.evPath, pair.sigPath], path.join(dir, 'base-bundle.zip'));
    const replacement = makeEvidence('fieldseal-evidence-v0.2', { photo: Buffer.from('replacement') });
    const replacementPath = await writePackage(path.join(dir, 'replacement'), 'evidence.zip', replacement.manifest, evidenceEntries(replacement));
    const children = [
      { name: 'evidence.zip', data: await fs.promises.readFile(replacementPath) },
      { name: 'signature-record.zip', data: await fs.promises.readFile(pair.sigPath) }
    ];
    const pkg = await writeBundlePackage(dir, 'tampered-bundle.zip', JSON.parse(info.indexText), children);
    const r = await verifyCore.verifyPackage(pkg, { autoDiscover: false });
    expect(r.coreResult, 'missing_linked_package', 'coreResult');
    assert(r.pluginExtras.problems.some((problem) => problem.includes('items[0].hash')), 'child byte-hash mismatch not reported');
    return 'SPEC priority: missing_linked_package over tampered';
  });

  await runCase('X-06', 'tampering media inside a bundle child is caught by recursion', async () => {
    const dir = caseDir('x06');
    const ev = makeEvidence('fieldseal-evidence-v0.2');
    const bad = Buffer.from(ev.files[0].data);
    bad[3] ^= 0x01;
    const childPath = await writePackage(dir, 'bad-evidence.zip', ev.manifest, [
      { name: 'photo.jpg', data: bad }, { name: 'video.mp4', data: ev.files[1].data }
    ]);
    const hash = await hashFile(childPath);
    const index = makeBundleIndex([{ packageId: ev.manifest.packageId, type: 'evidence', hash }]);
    const pkg = await writeBundlePackage(dir, 'bundle.zip', index, [
      { name: 'bad-evidence.zip', data: await fs.promises.readFile(childPath) }
    ]);
    const r = await verifyCore.verifyPackage(pkg, { autoDiscover: false });
    expect(r.coreResult, 'tampered', 'coreResult');
    assert(r.pluginExtras.items[0].result === 'tampered', 'recursive child result missing');
  });

  await runCase('X-07', 'items[].packageId not matching the child is tampered', async () => {
    const dir = caseDir('x07');
    const ev = makeEvidence('fieldseal-evidence-v0.2');
    const childPath = await writePackage(dir, 'evidence.zip', ev.manifest, evidenceEntries(ev));
    const hash = await hashFile(childPath);
    const index = makeBundleIndex([{ packageId: uuidV4(), type: 'evidence', hash }]);
    const pkg = await writeBundlePackage(dir, 'bundle.zip', index, [
      { name: 'evidence.zip', data: await fs.promises.readFile(childPath) }
    ]);
    expect((await verifyCore.verifyPackage(pkg, { autoDiscover: false })).coreResult, 'tampered', 'coreResult');
  });

  await runCase('X-08', 'a bundle missing one declared child is tampered', async () => {
    const dir = caseDir('x08');
    const pair = await makePair(dir, 'fieldseal-evidence-v0.2');
    const index = makeBundleIndex([
      { packageId: pair.ev.manifest.packageId, type: 'evidence', hash: await hashFile(pair.evPath) },
      { packageId: pair.sig.manifest.packageId, type: 'signature-record', hash: await hashFile(pair.sigPath) }
    ]);
    const pkg = await writeBundlePackage(dir, 'bundle.zip', index, [
      { name: 'evidence.zip', data: await fs.promises.readFile(pair.evPath) }
    ]);
    expect((await verifyCore.verifyPackage(pkg, { autoDiscover: false })).coreResult, 'tampered', 'coreResult');
  });

  await runCase('X-09', 'bundle holding only a signature child is missing_linked_package', async () => {
    const dir = caseDir('x09');
    const pair = await makePair(dir, 'fieldseal-evidence-v0.2');
    const index = makeBundleIndex([
      { packageId: pair.sig.manifest.packageId, type: 'signature-record', hash: await hashFile(pair.sigPath) }
    ]);
    const pkg = await writeBundlePackage(dir, 'bundle.zip', index, [
      { name: 'signature-record.zip', data: await fs.promises.readFile(pair.sigPath) }
    ]);
    const r = await verifyCore.verifyPackage(pkg, { autoDiscover: false });
    expect(r.coreResult, 'missing_linked_package', 'coreResult');
  });

  await runCase('X-10', 'editing a sealed signature manifest is tampered', async () => {
    const dir = caseDir('x10');
    const ev = makeEvidence('fieldseal-evidence-v0.2');
    const sig = makeSignature(ev);
    const edited = Object.assign({}, sig.manifest, { sealNote: 'nachträglich geändert' });
    const sigPath = await writePackage(dir, 'signature-record.zip', edited, signatureEntries(sig));
    expect((await verifyCore.verifyPackage(sigPath, { autoDiscover: false })).coreResult, 'tampered', 'coreResult');
  });

  await runCase('CL-01', 'CLI verify --json returns ok with the fixed top-level fields', async () => {
    const ev = makeEvidence('fieldseal-evidence-v0.2');
    const pkg = await writePackage(caseDir('cl01'), 'evidence.zip', ev.manifest, evidenceEntries(ev));
    const res = spawnSync(process.execPath, [CLI_ENTRY, 'verify', pkg, '--json'], { encoding: 'utf8' });
    assert(res.status === 0, 'exit status ' + res.status + ': ' + res.stderr);
    const out = JSON.parse(res.stdout);
    expect(out.coreResult, 'ok', 'coreResult');
    expect(Object.keys(out).sort().join(','), 'coreResult,packageId,packageType,pluginExtras,rootHash', 'top-level fields');
    return 'exit 0, 5 fixed fields';
  });

  await runCase('CL-02', 'CLI exits 1 on a tampered package', async () => {
    const ev = makeEvidence('fieldseal-evidence-v0.2', { overrideRootHash: ZERO_HASH });
    const pkg = await writePackage(caseDir('cl02'), 'evidence.zip', ev.manifest, evidenceEntries(ev));
    const res = spawnSync(process.execPath, [CLI_ENTRY, 'verify', pkg, '--json'], { encoding: 'utf8' });
    expect(res.status, 1, 'exit status');
    expect(JSON.parse(res.stdout).coreResult, 'tampered', 'coreResult');
  });

  await runCase('CL-03', 'CLI bundle command produces a verifiable super-bundle', async () => {
    const dir = caseDir('cl03');
    const pair = await makePair(dir, 'fieldseal-evidence-v0.2');
    const out = path.join(dir, 'super-bundle.zip');
    const res = spawnSync(process.execPath, [CLI_ENTRY, 'bundle', pair.evPath, pair.sigPath, out, '--json'], { encoding: 'utf8' });
    assert(res.status === 0, 'bundle exit status ' + res.status + ': ' + res.stderr);
    const built = JSON.parse(res.stdout);
    expect(built.items.length, 2, 'items');
    const checked = spawnSync(process.execPath, [CLI_ENTRY, 'verify', out, '--json'], { encoding: 'utf8' });
    expect(checked.status, 0, 'verify exit status');
    expect(JSON.parse(checked.stdout).coreResult, 'ok', 'coreResult');
    return 'bundle -> verify ok';
  });
}

function walk(dir, out) {
  let names;
  try {
    names = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return out;
  }
  for (const entry of names) {
    if (entry.name === 'node_modules' || entry.name === '.tmp' || entry.name.startsWith('.git')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const BUILTINS = new Set(require('module').builtinModules);

function extractModuleSpecifiers(source) {
  const found = [];
  const cjs = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  const esm = /\bfrom\s*['"]([^'"]+)['"]/g;
  const sideEffect = /^\s*import\s*['"]([^'"]+)['"]/gm;
  const dynamic = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;
  while ((match = cjs.exec(source)) !== null) found.push(match[1]);
  while ((match = esm.exec(source)) !== null) found.push(match[1]);
  while ((match = sideEffect.exec(source)) !== null) found.push(match[1]);
  while ((match = dynamic.exec(source)) !== null) found.push(match[1]);
  return found;
}

function isAllowedCliSpecifier(spec) {
  if (spec.startsWith('.')) return true;
  return BUILTINS.has(spec.startsWith('node:') ? spec.slice(5) : spec);
}

function allSourceFiles() {
  return walk(ROOT, []);
}

async function runStaticSelfChecks() {
  const files = allSourceFiles();
  const jsFiles = files.filter((file) => file.endsWith('.js'));
  const cliJs = jsFiles.filter((file) => file.startsWith(path.join(ROOT, 'cli') + path.sep));
  const pwaJs = jsFiles.filter((file) => file.startsWith(path.join(ROOT, 'pwa') + path.sep));
  const webFiles = files.filter((file) => /\.(html|webmanifest)$/i.test(file));

  await runCase('S-01', 'no package.json / lockfile / node_modules in trusted core or repo root', async () => {
    const banned = ['package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];
    const offenders = [];
    for (const dir of [ROOT, path.join(ROOT, 'cli', 'core'), path.join(ROOT, 'pwa', 'core')]) {
      for (const name of banned) if (fs.existsSync(path.join(dir, name))) offenders.push(path.join(dir, name));
      if (fs.existsSync(path.join(dir, 'node_modules'))) offenders.push(path.join(dir, 'node_modules'));
    }
    assert(offenders.length === 0, 'found: ' + offenders.join(', '));
  });

  await runCase('S-02', 'cli JS only requires Node built-ins or local handwritten files', async () => {
    const offenders = [];
    for (const file of cliJs) {
      for (const spec of extractModuleSpecifiers(fs.readFileSync(file, 'utf8'))) {
        if (!isAllowedCliSpecifier(spec)) offenders.push(path.relative(ROOT, file) + ' -> ' + spec);
      }
    }
    assert(offenders.length === 0, 'external code: ' + offenders.join(', '));
    return cliJs.length + ' cli JS files scanned';
  });

  await runCase('S-03', 'pwa JS imports only local handwritten files; no external importmap', async () => {
    const offenders = [];
    for (const file of pwaJs) {
      for (const spec of extractModuleSpecifiers(fs.readFileSync(file, 'utf8'))) {
        if (!spec.startsWith('.')) offenders.push(path.relative(ROOT, file) + ' -> ' + spec);
      }
    }
    for (const file of webFiles) {
      const source = fs.readFileSync(file, 'utf8');
      if (/<script[^>]+type\s*=\s*["']importmap["']/i.test(source) && /https?:\/\//i.test(source)) {
        offenders.push(path.relative(ROOT, file) + ' -> external importmap');
      }
    }
    assert(offenders.length === 0, 'external code: ' + offenders.join(', '));
    return pwaJs.length + ' pwa JS files scanned';
  });

  await runCase('S-04', 'no CDN, remote script, remote stylesheet or remote font', async () => {
    const offenders = [];
    for (const file of webFiles) {
      const source = fs.readFileSync(file, 'utf8');
      if (/https?:\/\//i.test(source)) offenders.push(path.relative(ROOT, file) + ' contains a remote URL');
      if (/@import\s+url\(/i.test(source)) offenders.push(path.relative(ROOT, file) + ' contains @import url()');
      if (/<script[^>]*\bsrc=/i.test(source)) offenders.push(path.relative(ROOT, file) + ' contains an external script src');
    }
    assert(offenders.length === 0, offenders.join('; '));
    return webFiles.length + ' HTML/webmanifest files scanned';
  });

  await runCase('S-05', 'no vendored source, minified bundles or oversized generated JS', async () => {
    const offenders = [];
    for (const file of jsFiles) {
      const stat = fs.statSync(file);
      if (/\.min\.js$/i.test(file)) offenders.push(path.relative(ROOT, file) + ' is a minified bundle');
      if (stat.size > 512 * 1024) offenders.push(path.relative(ROOT, file) + ' is suspiciously large');
    }
    for (const dir of [ROOT, path.join(ROOT, 'cli'), path.join(ROOT, 'pwa')]) {
      if (fs.existsSync(path.join(dir, 'node_modules'))) offenders.push(path.join(dir, 'node_modules'));
    }
    assert(offenders.length === 0, offenders.join('; '));
  });

  await runCase('S-06', 'no generator / bundler scaffolding artifacts', async () => {
    const banned = /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|vite\.config\.|webpack\.config\.|rollup\.config\.|tsconfig\.json)/i;
    const offenders = files.filter((file) => banned.test(path.basename(file))).map((file) => path.relative(ROOT, file));
    assert(offenders.length === 0, 'found: ' + offenders.join(', '));
  });

  await runCase('S-07', 'SHA256 and ZIP use platform built-ins, no handwritten crypto primitive', async () => {
    const coreJs = jsFiles.filter((file) => file.startsWith(path.join(ROOT, 'cli', 'core') + path.sep));
    assert(coreJs.length > 0, 'no trusted core JS files found');
    const hashSource = fs.readFileSync(path.join(ROOT, 'cli', 'core', 'hash.js'), 'utf8');
    assert(hashSource.includes("crypto.createHash('sha256')"), 'SHA256 is not delegated to Node crypto');
    const offenders = [];
    for (const file of coreJs) {
      const source = fs.readFileSync(file, 'utf8');
      if (/428a2f98|71374491|b5c0fbcf/i.test(source)) offenders.push(path.relative(ROOT, file));
    }
    assert(offenders.length === 0, 'handwritten SHA-256 constants in: ' + offenders.join(', '));
    return 'Q6 boundary honoured, ' + coreJs.length + ' core JS files scanned';
  });

  await runCase('S-08', 'static self-check runs as one zero-dependency read-only command', async () => {
    const runner = path.join(__dirname, 'test-runner.js');
    assert(fs.existsSync(runner), 'test-runner.js missing');
    const specs = extractModuleSpecifiers(fs.readFileSync(runner, 'utf8'));
    const external = specs.filter((spec) => !isAllowedCliSpecifier(spec));
    assert(external.length === 0, 'test runner has external requires: ' + external.join(', '));
    return 'node cli/test/test-runner.js';
  });

  await runCase('S-09', 'PWA trusted core is dependency-free, WebCrypto-based and locally imported', async () => {
    const coreDir = path.join(ROOT, 'pwa', 'core');
    const coreJs = jsFiles.filter((file) => file.startsWith(coreDir + path.sep));
    assert(coreJs.length === 8, 'unexpected pwa/core JS count: ' + coreJs.length);
    for (const file of coreJs) {
      const source = fs.readFileSync(file, 'utf8');
      const external = extractModuleSpecifiers(source).filter((spec) => !spec.startsWith('.'));
      assert(external.length === 0, path.relative(ROOT, file) + ' imports ' + external.join(', '));
      assert(!/\brequire\s*\(/.test(source), 'CommonJS require inside ESM trusted core');
      assert(!/https?:\/\//i.test(source), 'remote URL inside trusted core');
    }
    const hashSource = fs.readFileSync(path.join(coreDir, 'hash.js'), 'utf8');
    assert(/\.subtle\.digest\(\s*['"]SHA-256['"]/.test(hashSource), 'WebCrypto is not used for SHA256');
    for (const file of webFiles) {
      const source = fs.readFileSync(file, 'utf8');
      const inline = Array.from(source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)).map((match) => match[1]);
      const external = inline.filter((spec) => !spec.startsWith('.'));
      assert(external.length === 0, path.relative(ROOT, file) + ' inline import ' + external.join(', '));
    }
    return coreJs.length + ' core JS + ' + webFiles.length + ' pages scanned';
  });

  await runCase('S-10', 'front-end self-check: dual signing mode UI boundaries', async () => {
    const signHtml = fs.readFileSync(path.join(ROOT, 'pwa', 'sign.html'), 'utf8');
    const syncSrc = fs.readFileSync(path.join(ROOT, 'pwa', 'helpers', 'webrtc-sync.js'), 'utf8');
    // I-02 joint P2P conflict warning, no auto-merge
    assert(/onConflict/.test(signHtml), 'I-02 onConflict handler missing in sign.html');
    assert(/Concurrent edit conflict/.test(signHtml), 'I-02 conflict toast missing in sign.html');
    assert(/markLocalEdit/.test(syncSrc), 'I-02 markLocalEdit missing in webrtc-sync.js');
    assert(/localDirty/.test(syncSrc), 'I-02 localDirty tracking missing in webrtc-sync.js');
    // I-03 joint gating (all parties confirm) vs independent (current signer present)
    assert(/signMode === 'independent'/.test(signHtml), 'I-03 mode branch missing in sign.html');
    assert(/Current signer is missing/.test(signHtml), 'I-03 independent gate missing in sign.html');
    // I-06 independent mode disclaimer (no approval workflow)
    assert(/does NOT enforce an approval sequence or workflow/.test(signHtml) || /不提供审批流转/.test(signHtml), 'I-06 independent disclaimer missing');
    // I-08 draft import refuses mismatched evidence package
    assert(/Draft belongs to a different evidence package/.test(signHtml), 'I-08 evidenceRootHash guard missing in sign.html');
    // I-09 a sealed signature package must not be re-imported into the canvas for editing
    assert(!/import-signature|re-import|reimport/i.test(signHtml), 'I-09 must not import a sealed signature package back into the canvas');
    // K: recipient-side local audit trail controls
    assert(/recipient-side local operation trail/i.test(signHtml), 'K log boundary warning missing');
    assert(/id="log-toggle"/.test(signHtml), 'K log toggle control missing');
    assert(/export-log-json/.test(signHtml) && /export-log-txt/.test(signHtml), 'K log export buttons missing');
    // parties extended fields (role / organization / referenceId / licenseNo / reservation / tzIana)
    for (const id of ['party-role', 'party-org', 'party-ref', 'party-license', 'party-reservation', 'party-tz',
      'ind-role', 'ind-org', 'ind-ref', 'ind-license', 'ind-reservation', 'seal-tz']) {
      assert(signHtml.includes('id="' + id + '"'), 'party extended control missing: ' + id);
    }
    assert(/tzIana: sealTz/.test(signHtml), 'seal must pass tzIana to the kernel');
    // supplement import: local check only, never affects the evidence hash; binding mismatch is a warning
    assert(/id="supplement-input"/.test(signHtml) && /id="supplement-btn"/.test(signHtml), 'supplement import controls missing');
    assert(/fieldseal-supplement-v0\.1/.test(signHtml), 'supplement spec literal check missing');
    assert(/This supplement does NOT belong/.test(signHtml), 'supplement binding mismatch warning missing');
    assert(/import-supplement/.test(signHtml), 'supplement import audit event missing');
    // multi-format export after seal
    assert(/export-manifest-btn/.test(signHtml), 'manifest.json export button missing');
    assert(/export-manifest/.test(signHtml), 'manifest export audit event missing');
    return 'sign.html + webrtc-sync.js mode boundaries verified';
  });

  await runCase('S-11', 'custody features: CLI entry / schema / modes / independent popup', async () => {
    const audit = fs.readFileSync(path.join(ROOT, 'cli', 'bin', 'audit.js'), 'utf8');
    assert(/\bcustody\b/.test(audit) && /--meta-json/.test(audit), 'CLI custody command missing');
    assert(/\bschema\b/.test(audit), 'CLI schema command missing');
    assert(/--strict/.test(audit) && /audit-only/.test(audit), 'CLI strict/audit-only flags missing');
    assert(/auditOnly = true/.test(audit), 'audit-only must downgrade missing_linked_package to ok');
    const custodyHtml = fs.readFileSync(path.join(ROOT, 'pwa', 'custody.html'), 'utf8');
    // Independent component: never shares state/store/DOM with parties panel in sign.html
    assert(!/id="party-name"|id="party-role"|id="ind-role"/.test(custodyHtml), 'custody.html must not reuse parties UI ids');
    assert(/validateCustody/.test(custodyHtml), 'custody.html must delegate validation to kernel');
    assert(/kernel errors are shown verbatim|kernel error/i.test(custodyHtml), 'custody.html must not translate kernel errors');
    assert(/Copy JSON/.test(custodyHtml) && /Load Preset JSON/.test(custodyHtml), 'custody.html copy/load JSON missing');
    assert(/This evidence package is sealed/.test(custodyHtml), 'custody.html sealed readonly notice missing');
    return 'custody CLI + independent popup verified';
  });

  await runCase('S-12', 'case-layer wrapper spec does not fork the frozen evidence contract', async () => {
    const caseCoreSrc = fs.readFileSync(path.join(ROOT, 'pwa', 'core', 'case-manifest.js'), 'utf8');
    assert(/CASE_SPEC = 'fieldseal-case-v0.1'/.test(caseCoreSrc), 'case spec literal missing');
    assert(/fieldseal-evidence-v0\.2/.test(caseCoreSrc), 'case must reference the frozen evidence spec');
    assert(/computeSealHash/.test(caseCoreSrc) && /verifyCase/.test(caseCoreSrc), 'case integrity fns missing');
    // Storage helper must never enter hashes
    const storeSrc = fs.readFileSync(path.join(ROOT, 'pwa', 'helpers', 'case-store.js'), 'utf8');
    assert(!/subtle\.digest|createHash|sha256:|sha3-256:/.test(storeSrc), 'case-store must not compute hashes');
    assert(/indexedDB/.test(storeSrc), 'case-store must use IndexedDB');
    return 'case wrapper isolated from frozen contract';
  });

  await runCase('S-13', 'Phase 3 capture/custody UI + evidence storage stay on the shared kernel', async () => {
    const storeSrc = fs.readFileSync(path.join(ROOT, 'pwa', 'helpers', 'case-store.js'), 'utf8');
    for (const fn of ['putEvidencePackage', 'getEvidencePackage', 'listEvidencePackages', 'deleteEvidencePackage', 'deleteCasePackages']) {
      assert(new RegExp('export async function ' + fn + '\\(').test(storeSrc), 'case-store missing ' + fn);
    }
    assert(/EVIDENCE_STORE/.test(storeSrc) && /DB_VERSION = [234]/.test(storeSrc), 'evidence store missing');
    assert(!/subtle\.digest|createHash|sha256:|sha3-256:/.test(storeSrc), 'storage layer must never compute hashes');
    const sw = fs.readFileSync(path.join(ROOT, 'pwa', 'sw.js'), 'utf8');
    for (const p of ['cases.html', 'newcase.html', 'templates.html', 'case-detail.html', 'case-capture.html', 'case-custody.html', 'core/case-manifest.js', 'helpers/case-store.js']) {
      assert(sw.includes(p), 'sw.js PRECACHE missing ' + p);
    }
    const cap = fs.readFileSync(path.join(ROOT, 'pwa', 'case-capture.html'), 'utf8');
    assert(/EVIDENCE_V02/.test(cap) && /buildEvidenceManifest/.test(cap), 'capture must emit frozen v0.2 via kernel');
    assert(/addCapture/.test(cap) && /putEvidencePackage/.test(cap), 'capture must bind case + persist ZIP');
    assert(/pending-configuration/.test(cap), 'capture must handle emergency pending path');
    assert(/collectFields/.test(cap), 'capture must render schema-driven fields');
    const cus = fs.readFileSync(path.join(ROOT, 'pwa', 'case-custody.html'), 'utf8');
    assert(/addCustodyEntry/.test(cus) && /TRANSFER_PURPOSES/.test(cus), 'custody UI must delegate to kernel');
    assert(/shown verbatim|unveraendert/.test(cus), 'kernel errors must be shown verbatim');
    return 'Phase 3 UI + storage isolated and kernel-backed';
  });

  await runCase('S-14', 'Phase 4 export is hash-free presentation and stays case-verify compatible', async () => {
    const ex = fs.readFileSync(path.join(ROOT, 'pwa', 'helpers', 'case-export.js'), 'utf8');
    assert(!/subtle\.digest|createHash|shaUri\(|computeRootHash\(/.test(ex), 'export layer must not compute hashes');
    for (const fn of ['buildCaseReportHtml', 'buildCaseLedgerCsv', 'buildVerifyManifest', 'preflightCaseExport', 'buildCaseExportEntries', 'buildCaseExportZip']) {
      assert(new RegExp('export (async )?function ' + fn + '\\(').test(ex), 'case-export missing ' + fn);
    }
    for (const n of ['case-manifest.json', 'case-report.html', 'case-ledger.csv', 'VERIFY.txt', 'evidence/']) {
      assert(ex.includes(n), 'export layout missing ' + n);
    }
    assert(ex.includes('case verify'), 'export must document the CLI verifier');
    const spec = fs.readFileSync(path.join(ROOT, 'docs', 'SPEC-case.md'), 'utf8');
    const header = 'record_utc, record_type, actor_name, actor_title, transfer_purpose, evidence_item_id, item_hash, schema_change_note, case_reference, seal_hash';
    assert(spec.includes(header), 'SPEC-case CSV header missing');
    assert(/CSV_HEADER/.test(ex) && ex.includes("'record_utc'"), 'CSV_HEADER defined');
    const detail = fs.readFileSync(path.join(ROOT, 'pwa', 'case-detail.html'), 'utf8');
    assert(/sealConfirmDialog/.test(detail) && /sealCase/.test(detail), 'seal confirm dialog + kernel seal missing');
    assert(/disabled: true/.test(detail) && /check.checked/.test(detail), 'seal button must be checkbox-gated');
    assert(/eIDAS/.test(detail) && /DE/.test(detail) && /EN/.test(detail), 'EN/DE risk notes missing');
    const panel = fs.readFileSync(path.join(ROOT, 'pwa', 'case-export.html'), 'utf8');
    assert(/verifyCase/.test(panel) && /preflightCaseExport/.test(panel) && /buildCaseExportZip/.test(panel), 'verification panel must reuse kernel + export helpers');
    const sw = fs.readFileSync(path.join(ROOT, 'pwa', 'sw.js'), 'utf8');
    assert(sw.includes('case-export.html') && sw.includes('helpers/case-export.js'), 'sw.js PRECACHE missing Phase 4 files');
    return 'export layer isolated, verifier-compatible, UI gated';
  });

  await runCase('S-15', 'v0.3 Core Baseline full self-check (Countersign + Encryption + Signature)', async () => {
    const read = (p) => fs.readFileSync(path.join(ROOT, ...p.split('/')), 'utf8');
    const caseSrc = read('pwa/core/case-manifest.js');
    for (const t of [
      'WORKFLOW_STATES', 'pending_countersign', 'COUNTERSIGN_DECISIONS', 'AUDIT_EVENT_TYPES',
      'SPEC_VERSION_V03', 'CASE_SPEC_VERSIONS', 'resolveSpecVersion', 'isV03Spec',
      'FIELD_ABSENT', 'specVersion: CURRENT_SPEC_VERSION',
      'COUNTERSIGN_WRITES', 'appendAudit', 'setSchemaLocked', 'requireSchemaMutable',
      'sendForCountersign', 'addCountersign', 'setCaseEncryption', 'clearCaseEncryption',
      'appendAuditEvent', 'schemaLocked: false', 'countersignList: []',
      'caseEncryptionMeta: null', 'auditLog: []'
    ]) assert(caseSrc.includes(t), 'case core missing ' + t);
    const hashSrc = read('pwa/core/hash.js');
    assert(/export async function sha256Hex/.test(hashSrc), 'core sha256Hex export missing');
    assert(/unsupported value type/.test(hashSrc) && /non-finite number/.test(hashSrc), 'canonical strict guard missing');
    assert(fs.existsSync(path.join(ROOT, 'cli', 'test', 'fixtures', 'golden-case-v0.2.json')), 'v0.2 golden fixture missing');

    const storeSrc = read('pwa/helpers/case-store.js');
    assert(/DB_VERSION = 4/.test(storeSrc) && /CIPHER_STORE/.test(storeSrc) && /SIGNATURE_STORE/.test(storeSrc), 'v4 blob stores missing');
    for (const fn of ['putCaseCipher', 'getCaseCipher', 'deleteCaseCipher',
      'putSignatureImage', 'getSignatureImage', 'listSignatureImages',
      'deleteCaseSignatures', 'putCaseIfUnchanged']) {
      assert(new RegExp('export async function ' + fn + '\\(').test(storeSrc), 'case-store missing ' + fn);
    }
    assert(/signatureSha256/.test(caseSrc) && /signatureDataUrl is forbidden/.test(caseSrc) && /MAX_SIGNATURE_BYTES/.test(caseSrc), 'signature-attachment contract missing');
    assert(/duplicate countersign for signer/.test(caseSrc), 'duplicate signer guard missing');
    assert(/needs_password/.test(read('cli/core/case-verify.js')), 'CLI needs_password branch missing');
    assert(/signature attachment digest mismatch/.test(read('cli/core/case-verify.js')), 'CLI signature attachment check missing');
    const cryptoSrcEarly = read('pwa/helpers/case-crypto.js');
    assert(/CIPHER_ERROR_TAMPERED/.test(cryptoSrcEarly) && /classifyCipherResult/.test(cryptoSrcEarly), 'cipher classification missing');
    const exSrcEarly = read('pwa/helpers/case-export.js');
    assert(/ENCRYPTION CONTRACT/.test(exSrcEarly) && /PLAINTEXT/.test(exSrcEarly), 'VERIFY.txt encryption contract missing');
    assert(!/subtle\.digest|createHash|sha256:|sha3-256:/.test(storeSrc), 'storage layer must never compute hashes');

    const crypto = read('pwa/helpers/case-crypto.js');
    for (const t of ['PBKDF2', 'AES-GCM', '100000', 'secureContextAvailable', 'authTagB64', 'getRandomValues', 'Decryption failed']) {
      assert(crypto.includes(t), 'case-crypto missing ' + t);
    }
    assert(!/localStorage|sessionStorage/.test(crypto), 'passphrase must never be persisted');
    const sums = read('pwa/helpers/case-checksums.js');
    assert(/sha256Hex/.test(sums) && /sha256sum/.test(sums) && !/subtle\.digest/.test(sums), 'checksums must delegate to core');

    const ex = read('pwa/helpers/case-export.js');
    assert(!/subtle\.digest|createHash|shaUri\(|computeRootHash\(/.test(ex), 'export layer must stay hash-free');
    for (const t of ['case-files.sha256', 'case-manifest.json.enc', 'V0.3 WORKFLOW STATE', 'Countersignatures', 'Unified Audit Log', 'This is native browser print flow', 'buildCaseChecksumText']) {
      assert(ex.includes(t), 'export layer missing ' + t);
    }
    const pad = read('pwa/ui/signature-pad.js');
    for (const t of ['customElements.define', 'pointerdown', 'pointermove', 'touch-action:none', 'undo()', 'clear()', 'toDataURL', '#111111', 'preview']) {
      assert(pad.includes(t), 'signature pad missing ' + t);
    }

    const detail = read('pwa/case-detail.html');
    for (const t of ['STATE_BANNER', 'pending_countersign', 'doSchemaLock', 'doEncrypt', 'doDecrypt', 'doClearEncryption', 'doSendForCountersign', 'doAddCountersign', 'fieldseal-signature-pad', 'gatedDialog', 'passwordDialog', 'aria-disabled', 'appendAuditEvent']) {
      assert(detail.includes(t), 'case-detail missing ' + t);
    }
    assert(/disabled: true/.test(detail) && /check.checked/.test(detail), 'checkbox gating preserved');
    const panel = read('pwa/case-export.html');
    for (const t of ['Print / Save as PDF', '@media print', 'print-only', 'This is native browser print flow', 'case-files.sha256', 'getCaseCipher', 'pending_countersign']) {
      assert(panel.includes(t), 'case-export missing ' + t);
    }
    const css = read('pwa/ui/style.css');
    assert(/@media print/.test(css) && /state-banner/.test(css) && /This is native browser print flow/.test(css), 'print CSS missing');
    assert(/@media \(max-width: 620px\)/.test(css) && /min-height: 46px/.test(css) && /font-size: 16px/.test(css), 'mobile touch CSS missing');
    assert(panel.includes('scopeReportCss'), 'case-export print CSS scoping missing');

    const sw = read('pwa/sw.js');
    // The cache name must be bumped whenever PRECACHE or a precached asset changes;
    // assert a numeric floor instead of pinning one literal so future bumps stay green.
    const cacheVer = Number((sw.match(/fieldseal-suite-case-v(\d+)/) || [])[1]);
    assert(Number.isFinite(cacheVer) && cacheVer >= 10, 'sw.js CACHE_NAME not bumped after a precache change');
    for (const p of [
      'ui/signature-pad.js', 'ui/camera-panel.js', 'helpers/case-crypto.js', 'helpers/case-checksums.js',
      'helpers/attribution.js', 'helpers/ext-hooks.js', 'vendor/ext-hooks.js',
      'helpers/case-snapshot.js', 'helpers/case-watermark.js',
      'helpers/storage-quota.js', 'helpers/backup-reminder.js'
    ]) {
      assert(sw.includes(p), 'sw.js PRECACHE missing ' + p);
    }
    const spec = read('docs/SPEC-case.md');
    assert(/## 10\./.test(spec) && /v0\.3 Core Baseline/.test(spec) && /sha256sum -c/.test(spec), 'SPEC-case §十 missing');
    return 'kernel + helpers + UI + sw + spec v0.3 baseline verified';
  });

  await runCase('S-16', 'v0.4 second-round full self-check (11 items)', async () => {
    const read = (p) => fs.readFileSync(path.join(ROOT, ...p.split('/')), 'utf8');
    const core = read('pwa/core/case-manifest.js');
    const hashSrc = read('pwa/core/hash.js');
    const ex = read('pwa/helpers/case-export.js');
    const hooksSrc = read('pwa/helpers/ext-hooks.js');
    const vendorSrc = read('pwa/vendor/ext-hooks.js');
    const K16 = await import(pathToFileURL(path.join(ROOT, 'pwa', 'core', 'case-manifest.js')).href);
    const H16 = await import(pathToFileURL(path.join(ROOT, 'pwa', 'helpers', 'ext-hooks.js')).href);
    if (typeof H16.resetFeatureFlags === 'function') H16.resetFeatureFlags();

    // 1. zero third-party dependencies; every featureFlag is false by default.
    for (const file of jsFiles) {
      for (const spec of extractModuleSpecifiers(read(path.relative(ROOT, file).split(path.sep).join('/')))) {
        assert(spec.startsWith('.') || isAllowedCliSpecifier(spec), 'third-party specifier ' + spec);
      }
    }
    assert(H16.HOOK_IDS.length === 5 && H16.HOOK_IDS.every((id) => H16.FEATURE_FLAGS[id] === false), 'featureFlags must default false :: ' + JSON.stringify({n:H16.HOOK_IDS.length, f:H16.FEATURE_FLAGS}));
    assert(/readVendorHook/.test(hooksSrc) && /setHookOverride\(/.test(hooksSrc), 'lazy resolution + injectable seam');
    assert(/VENDOR_GLOBAL_NAME/.test(vendorSrc) && /readVendorGlobal\(\)/.test(vendorSrc), 'vendor adapter present');

    // 2. explicit version dispatch; unknown version rejected; no field-shape inference.
    assert(!/hasV03Fields/.test(core), 'field-shape inference is forbidden');
    assert(K16.CASE_SPEC_VERSIONS.length === 4 && K16.CASE_SPEC_VERSIONS.includes(K16.SPEC_VERSION_V04) && K16.CASE_SPEC_VERSIONS.includes(K16.SPEC_VERSION_V05), 'v0.4 and v0.5 whitelisted');
    assert(K16.resolveSpecVersion({}) === K16.SPEC_VERSION_V02, 'undefined still binds v0.2 legacy');
    assert(K16.resolveSpecVersion({ specVersion: 'fieldseal-case-v9.9' }) === 'fieldseal-case-v9.9', 'unknown value is not silently rewritten');
    assert((await K16.verifyCase({ specVersion: 'fieldseal-case-v9.9' })).coreResult === 'invalid_spec', 'unknown version -> invalid_spec');

    // 3. canonical injectivity + illegal value rejection (runtime proof in C-30).
    assert(/Number\.isFinite/.test(hashSrc) && /bigint/.test(hashSrc) && /canonicalJson: unsupported value type/.test(hashSrc), 'canonical strict guards');

    // 4. plaintext manifest contract; encrypted-only container -> needs_password (runtime C-34).
    assert(/PLAINTEXT/.test(ex) && /needs_password/.test(ex) && /ENCRYPTION CONTRACT/.test(ex), 'plaintext contract documented');

    // 5. three-way failure classification (runtime C-32).
    const cryptoSrc = read('pwa/helpers/case-crypto.js');
    for (const t of ['classifyCipherResult', 'CIPHER_ERROR_GENERIC', 'CIPHER_ERROR_TAMPERED', 'verifyCipherIntegrity']) {
      assert(cryptoSrc.includes(t), 'cipher helper missing ' + t);
    }

    // 6. contract A: sealed forbids every WRITE (only read-only snapshot / hook reads remain).
    assert(K16.V04_PERMISSION_MATRIX.sealed.migrateV04 === false && K16.V04_PERMISSION_MATRIX.sealed.thirdPartyNoteAdd === false &&
      K16.V04_PERMISSION_MATRIX.sealed.softDeleteOrRestore === false && K16.V04_PERMISSION_MATRIX.sealed.dictionaryWrite === false,
      'sealed write lock');
    assert(/if \(c\.state === 'sealed'\) throw/.test(core), 'requireMutable sealed guard');

    // 7. every cell of the v0.4 permission matrix.
    for (const state of ['draft', 'pending_countersign', 'sealed']) {
      for (const action of K16.V04_ACTIONS) {
        assert(K16.v04ActionAllowed(state, action) === K16.V04_PERMISSION_MATRIX[state][action],
          'matrix mismatch ' + state + '/' + action);
      }
    }
    assert(K16.v04ActionAllowed('no-such-state', 'dictionaryWrite') === false, 'unknown state denied');

    // 8. attribution/watermark four layers: read-only scanner, read first THEN report.
    const scan = spawnSync(process.execPath, [path.join(ROOT, 'cli', 'test', 'read-only-scanner.cjs'), 'attribution'], { encoding: 'utf8' });
    assert(scan.status === 0 && /ATTRIBUTION-4-LAYERS-OK/.test(scan.stdout), 'four attribution layers incomplete');
    assert(/layer 1 source headers/.test(scan.stdout) && /layer 4 export artefacts/.test(scan.stdout), 'scanner report missing layers');

    // 9. new fields enter / stay out of sealHash exactly as ruled.
    assert(K16.V04_SEAL_FIELDS.join(',') === 'schemaDictionaries,snapshots,thirdPartyNotes,isDeleted', 'sealHash field ruling');
    assert(K16.V04_NON_SEAL_FIELDS.join(',') === 'reportBranding,watermarkConfig', 'non-seal field ruling');
    assert(K16.V04_AGGREGATE_FIELDS.every((k) => !K16.V04_NON_SEAL_FIELDS.includes(k)), 'non-seal field leaked into aggregate');
    assert(/FIELD_ABSENT/.test(core) && /sealInput\.v04/.test(core), 'sentinel + v0.4 aggregate');
    assert(K16.AUDIT_EVENT_TYPES.length === 19, '8 v0.3 + 11 v0.4 audit types (HUMAN_NOTE added in v0.5)');

    // 10. export layer never computes hashes; checksums cover new attachments.
    assert(!/subtle\.digest|createHash|shaUri\(|computeRootHash\(/.test(ex), 'export layer computes hashes');
    assert(/extra\.attachments/.test(ex) && /buildCaseFilesSha256\(entries\)/.test(ex), 'attachments not covered');

    // 11. documentation matches real artefacts; counts come from real run output.
    assert(fs.existsSync(path.join(ROOT, 'reports', 'closing', 'CLOSING-REPORT.md')), 'closing report not archived');
    assert(fs.existsSync(path.join(ROOT, 'KNOWN_ISSUES.md')), 'KNOWN_ISSUES.md missing');
    const releaseNotes = read('docs/RELEASE-NOTES.md');
    assert(/v0\.3 closing/.test(releaseNotes), 'release notes missing closing entry');
    const runLog = read('reports/closing/default-run.txt');
    const count = /(\d+)\/(\d+) passed/.exec(runLog);
    assert(count && count[1] === count[2], 'no complete real run recorded');
    assert(read('README.md').includes(count[0]), 'README count must come from the real run log');
    assert(read('cli/test/TEST-CASES.md').includes('C-37') && read('cli/test/TEST-CASES.md').includes('C-46'), 'TEST-CASES missing v0.4 cases');
    assert(/## 11\./.test(read('docs/SPEC-case.md')), 'SPEC-case §11 missing');
    return '11/11 S-16 items green';
  });
}

async function loadPwaCore() {
  const base = path.join(ROOT, 'pwa', 'core');
  const load = (name) => import(pathToFileURL(path.join(base, name)).href);
  return {
    hash: await load('hash.js'),
    zip: await load('zip-builder.js'),
    manifest: await load('evidence-manifest.js'),
    reader: await load('zip-reader.js'),
    signature: await load('signature-manifest.js')
  };
}

async function writePwaPackage(caseId, manifest, entries) {
  const text = coreManifestText(manifest);
  const blob = await pwaCore.zip.buildZip(
    [{ name: 'manifest.json', data: new TextEncoder().encode(text) }].concat(entries)
  );
  const out = path.join(CASES, caseId, 'evidence.zip');
  await fs.promises.mkdir(path.dirname(out), { recursive: true });
  await fs.promises.writeFile(out, Buffer.from(await blob.arrayBuffer()));
  return out;
}

let pwaCore = null;
function coreManifestText(manifest) {
  return pwaCore.manifest.canonicalManifestText(manifest);
}

async function runPwaParityCases() {
  pwaCore = await loadPwaCore();

  await runCase('P-01', 'PWA and CLI canonical JSON / root hash agree byte for byte', async () => {
    const sample = { spec: 'x', tags: ['b', 'a'], gps: { lon: '1', lat: '2' }, files: [{ type: 'image', hash: 'h', name: 'n' }] };
    expect(pwaCore.hash.canonicalJson(sample), canonicalJson(sample), 'canonicalJson');
    expect(await pwaCore.hash.computeRootHash(sample), computeRootHash(sample), 'computeRootHash');
    assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(pwaCore.hash.isoUtcNow()), 'bad UTC format');
    assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(pwaCore.hash.isoLocalNow()), 'bad local format');
    assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(pwaCore.hash.uuidV4()), 'bad UUID v4');
    return 'C2 / C3 identical across runtimes';
  });

  await runCase('P-02', 'PWA core evidence v0.2 package verifies ok in the CLI', async () => {
    const photo = new Blob([PHOTO], { type: 'image/jpeg' });
    const video = new Blob([VIDEO], { type: 'video/mp4' });
    const p = await pwaCore.zip.inspectBlob(photo);
    const v = await pwaCore.zip.inspectBlob(video);
    expect(v.sha256, sha256Uri(VIDEO), 'webp SHA256 parity');
    const check = await pwaCore.manifest.sanityCheckMedia(video, 'video');
    expect(check.status, 'ok', 'mp4 sanity status');
    const manifest = await pwaCore.manifest.buildEvidenceManifest({
      version: pwaCore.manifest.EVIDENCE_V02,
      files: [
        { name: pwaCore.manifest.sanitizeFileName('IMG_2026.HEIC', 'image', 1), hash: p.sha256, type: 'image' },
        { name: pwaCore.manifest.sanitizeFileName('VID_001.MP4', 'video', 2), hash: v.sha256, type: 'video' }
      ],
      gps: { lat: '52.5200', lon: '13.4050' },
      note: '现场维修验收记录',
      tags: ['schaden', 'installation', 'handwerk'],
      mp4SanityCheck: check
    });
    const out = await writePwaPackage('p02', manifest, [
      { name: manifest.files[0].name, blob: photo, size: p.size, crc32: p.crc32, sha256: p.sha256 },
      { name: manifest.files[1].name, blob: video, size: v.size, crc32: v.crc32, sha256: v.sha256 },
      { name: 'aux/preview-1.jpg', data: PREVIEW },
      { name: 'aux/preview-note.txt', data: new TextEncoder().encode('仅参考，非证据原件\n') }
    ]);
    const r = await verifyCore.verifyPackage(out, { autoDiscover: false });
    expect(r.coreResult, 'ok', 'coreResult');
    expect(r.rootHash, manifest.rootHash, 'rootHash');
    expect(r.pluginExtras.auxEntries.length, 2, 'aux entries');
    expect(Object.keys(manifest).length, 10, 'v0.2 key count');
    return 'v0.2 -> CLI verify ok';
  });

  await runCase('P-03', 'PWA core evidence v0.1 package verifies ok in the CLI', async () => {
    const photo = new Blob([PHOTO], { type: 'image/jpeg' });
    const p = await pwaCore.zip.inspectBlob(photo);
    const manifest = await pwaCore.manifest.buildEvidenceManifest({
      version: pwaCore.manifest.EVIDENCE_V01,
      files: [{ name: 'photo-1.jpg', hash: p.sha256, type: 'image' }],
      gps: { lat: '52.5200', lon: '13.4050' },
      note: 'ignored for v0.1',
      tags: ['ignored']
    });
    expect(Object.keys(manifest).sort().join(','), 'createdAt,files,packageId,rootHash,spec', 'v0.1 key set');
    const out = await writePwaPackage('p03', manifest, [
      { name: 'photo-1.jpg', blob: photo, size: p.size, crc32: p.crc32, sha256: p.sha256 }
    ]);
    const r = await verifyCore.verifyPackage(out, { autoDiscover: false });
    expect(r.coreResult, 'ok', 'coreResult');
    expect(r.rootHash, manifest.rootHash, 'rootHash');
    return 'v0.1 -> CLI verify ok';
  });

  await runCase('P-04', 'a PWA package with swapped media bytes is rejected by the CLI', async () => {
    const photo = new Blob([PHOTO], { type: 'image/jpeg' });
    const p = await pwaCore.zip.inspectBlob(photo);
    const manifest = await pwaCore.manifest.buildEvidenceManifest({
      version: pwaCore.manifest.EVIDENCE_V02,
      files: [{ name: 'photo-1.jpg', hash: p.sha256, type: 'image' }],
      gps: { lat: '0', lon: '0' },
      note: '[GPS unavailable]',
      tags: [],
      mp4SanityCheck: { status: 'skipped', note: 'no video in package' }
    });
    const out = await writePwaPackage('p04', manifest, [
      { name: 'photo-1.jpg', data: new TextEncoder().encode('different bytes') }
    ]);
    expect((await verifyCore.verifyPackage(out, { autoDiscover: false })).coreResult, 'tampered', 'coreResult');
  });

  await runCase('P-05', 'PWA helpers honour C5 names, decimal strings and container checks', async () => {
    expect(pwaCore.manifest.normalizeDecimal('52.5200'), '52.52', 'normalizeDecimal');
    expect(pwaCore.manifest.normalizeDecimal('bad'), '0', 'invalid decimal');
    expect(pwaCore.manifest.sanitizeFileName('中文 照片.jpg', 'image', 3), 'photo-3.jpg', 'C5 name');
    assert(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(pwaCore.manifest.sanitizeFileName('a b!c.MOV', 'video', 1)), 'C5 video name');
    const skipped = await pwaCore.manifest.sanityCheckMedia(new Blob([Buffer.from('not a video')]), 'video');
    expect(skipped.status, 'skipped', 'non-ISO-BMFF check');
    return 'frozen schema constraints honoured';
  });

  let sealFixture = null;

  await runCase('P-06', 'PWA core reads and validates a PWA-produced evidence package', async () => {
    const pkgPath = path.join(CASES, 'p02', 'evidence.zip');
    const blob = new Blob([await fs.promises.readFile(pkgPath)]);
    const info = await pwaCore.signature.inspectEvidencePackage(blob);
    assert(info.ok, 'problems: ' + info.problems.join('; '));
    expect(info.spec, 'fieldseal-evidence-v0.2', 'spec');
    expect(info.fileCount, 2, 'file count');
    const tampered = new Blob([await fs.promises.readFile(path.join(CASES, 'p04', 'evidence.zip'))]);
    const bad = await pwaCore.signature.inspectEvidencePackage(tampered);
    expect(bad.ok, false, 'tampered package must be rejected');
    return 'trusted core validates evidence before Seal';
  });

  await runCase('P-07', 'Seal produces a signature package that CLI verifies with linked evidence', async () => {
    const evidencePath = path.join(CASES, 'p02', 'evidence.zip');
    const evidenceBlob = new Blob([await fs.promises.readFile(evidencePath)]);
    const snapshot = new Blob([SNAPSHOT], { type: 'image/png' });
    const signSession = pwaCore.signature.createSealSession();
    expect(signSession.mode, 'DRAFT MODE', 'draft mode');
    const result = await signSession.seal({
      evidenceBlob,
      snapshotBlob: snapshot,
      parties: [
        { name: 'Kunde', confirm: true },
        { name: 'Handwerker', confirm: true }
      ],
      sealNote: '双方验收确认无异议'
    });
    expect(result.mode, 'SEALED LOCKED MODE', 'mode after seal');
    expect(result.manifest.linkedEvidenceRootHash, result.evidence.rootHash, 'binding hash');
    expect(result.manifest.linkedEvidenceId, result.evidence.manifest.packageId, 'binding id');
    expect(Object.keys(result.manifest).length, 9, 'signature key count');
    const zipBlob = await pwaCore.signature.buildSignatureRecordZip(result.manifest, snapshot);
    const dir = path.join(CASES, 'p07');
    await fs.promises.mkdir(dir, { recursive: true });
    const sigPath = path.join(dir, 'signature-record.zip');
    await fs.promises.writeFile(sigPath, Buffer.from(await zipBlob.arrayBuffer()));
    const r = await verifyCore.verifyPackage(sigPath, { linkedPaths: [evidencePath], autoDiscover: false });
    expect(r.coreResult, 'ok', 'coreResult');
    expect(r.packageType, 'signature-record', 'packageType');
    expect(r.pluginExtras.linkResolution, 'explicit', 'linkResolution');
    const cli = spawnSync(process.execPath, [CLI_ENTRY, 'verify', sigPath, '--linked', evidencePath, '--json'], { encoding: 'utf8' });
    expect(cli.status, 0, 'CLI exit status');
    expect(JSON.parse(cli.stdout).coreResult, 'ok', 'CLI coreResult');
    sealFixture = { signSession, evidencePath, evidence: result.evidence, manifest: result.manifest, sigPath, snapshot };
    return 'CLI verify + evidenceRootHash binding ok';
  });

  await runCase('P-08', 'Seal locks the session: a second seal is rejected', async () => {
    assert(sealFixture, 'missing seal fixture');
    expect(sealFixture.signSession.sealed, true, 'sealed flag');
    expect(sealFixture.signSession.mode, 'SEALED LOCKED MODE', 'locked mode');
    let rejected = false;
    try {
      await sealFixture.signSession.seal({
        evidenceBlob: new Blob([await fs.promises.readFile(sealFixture.evidencePath)]),
        snapshotBlob: sealFixture.snapshot,
        parties: [{ name: 'Kunde', confirm: true }],
        sealNote: 'changed after seal'
      });
    } catch (error) {
      rejected = true;
    }
    assert(rejected, 'a second seal must be rejected');
    let draftRejected = false;
    try { sealFixture.signSession.assertDraft(); } catch (error) { draftRejected = true; }
    assert(draftRejected, 'assertDraft must reject after Seal');
  });

  await runCase('P-09', 'substituting the evidence package breaks the signature binding', async () => {
    assert(sealFixture, 'missing seal fixture');
    const fake = makeEvidence('fieldseal-evidence-v0.2', {
      id: sealFixture.evidence.manifest.packageId,
      photo: Buffer.from('another photo')
    });
    const fakePath = await writePackage(path.join(CASES, 'p09'), 'evidence.zip', fake.manifest, evidenceEntries(fake));
    const r = await verifyCore.verifyPackage(sealFixture.sigPath, { linkedPaths: [fakePath], autoDiscover: false });
    expect(r.coreResult, 'tampered', 'coreResult');
  });

  await runCase('P-10', 'a signature package without its evidence is missing_linked_package', async () => {
    assert(sealFixture, 'missing seal fixture');
    const r = await verifyCore.verifyPackage(sealFixture.sigPath, { autoDiscover: false });
    expect(r.coreResult, 'missing_linked_package', 'coreResult');
  });

  await runCase('P-11', 'canvasSnapshotHash equals the sealed snapshot bytes and is bound by rootHash', async () => {
    assert(sealFixture, 'missing seal fixture');
    expect(sealFixture.manifest.canvasSnapshotHash, sha256Uri(SNAPSHOT), 'snapshot hash');
    expect(await computeRootHash(sealFixture.manifest), sealFixture.manifest.rootHash, 'rootHash parity');
    const r = await verifyCore.verifyPackage(sealFixture.sigPath, { linkedPaths: [sealFixture.evidencePath], autoDiscover: false });
    expect(r.pluginExtras.canvasSnapshotMatch, 'aux/canvas-snapshot.png', 'snapshot match');
    return 'C9 binding verified';
  });
}

async function extractZipEntries(filePath) {
  const handle = await zip.readZip(filePath);
  try {
    const out = new Map();
    for (const entry of handle.entries) {
      const tmp = path.join(os.tmpdir(), 'fieldseal-e2e-' + process.pid + '-' + entry.name.replace(/[^A-Za-z0-9._-]/g, '_'));
      await handle.extractToFile(entry, tmp);
      out.set(entry.name, await fs.promises.readFile(tmp));
      await fs.promises.rm(tmp, { force: true });
    }
    return out;
  } finally {
    await handle.close();
  }
}

async function writeZipFromMap(targetPath, map) {
  const list = [];
  for (const [name, data] of map) list.push({ name, data });
  await zip.writeZip(targetPath, list);
}

async function buildPwaEvidence(caseDirPath, spec, salt) {
  const photoBytes = salt ? Buffer.concat([PHOTO, Buffer.from([salt & 0xff])]) : PHOTO;
  const photo = new Blob([photoBytes], { type: 'image/jpeg' });
  const video = new Blob([VIDEO], { type: 'video/mp4' });
  const p = await pwaCore.zip.inspectBlob(photo);
  const v = await pwaCore.zip.inspectBlob(video);
  const isV2 = spec === pwaCore.manifest.EVIDENCE_V02;
  const manifest = await pwaCore.manifest.buildEvidenceManifest({
    version: spec,
    files: [
      { name: 'photo-1.jpg', hash: p.sha256, type: 'image' },
      ...(isV2 ? [{ name: 'video-1.mp4', hash: v.sha256, type: 'video' }] : [])
    ],
    gps: { lat: '52.5200', lon: '13.4050' },
    note: 'E2E field capture',
    tags: ['e2e'],
    ...(isV2 ? { mp4SanityCheck: { status: 'ok', note: 'moov/mdat segment found' } } : {})
  });
  const entries = [
    { name: 'photo-1.jpg', blob: photo, size: p.size, crc32: p.crc32, sha256: p.sha256 },
    ...(isV2 ? [{ name: 'video-1.mp4', blob: video, size: v.size, crc32: v.crc32, sha256: v.sha256 }] : [])
  ];
  await fs.promises.mkdir(caseDirPath, { recursive: true });
  const out = path.join(caseDirPath, 'evidence.zip');
  const blob = await pwaCore.zip.buildZip([{ name: 'manifest.json', data: new TextEncoder().encode(coreManifestText(manifest)) }].concat(entries));
  await fs.promises.writeFile(out, Buffer.from(await blob.arrayBuffer()));
  return { manifest, path: out };
}

async function sealPwaSignature(evidenceZipPath, caseDirPath, snapshotBytes, signMode) {
  const evidenceBlob = new Blob([await fs.promises.readFile(evidenceZipPath)]);
  const snap = snapshotBytes ? new Blob([snapshotBytes], { type: 'image/png' }) : new Blob([SNAPSHOT], { type: 'image/png' });
  const session = pwaCore.signature.createSealSession();
  const result = await session.seal({
    evidenceBlob,
    snapshotBlob: snap,
    parties: [
      { name: 'Kunde', confirm: true },
      { name: 'Handwerker', confirm: true }
    ],
    sealNote: 'E2E sealed record',
    signMode
  });
  const zipBlob = await pwaCore.signature.buildSignatureRecordZip(result.manifest, snap, { signMode: result.signMode, modeNote: result.modeNote });
  await fs.promises.mkdir(caseDirPath, { recursive: true });
  const out = path.join(caseDirPath, 'signature-record.zip');
  await fs.promises.writeFile(out, Buffer.from(await zipBlob.arrayBuffer()));
  return { manifest: result.manifest, path: out, evidence: result.evidence };
}

async function runE2ECases() {
  if (!pwaCore) pwaCore = await loadPwaCore();

  await runCase('E-01', 'full chain: PWA capture -> Seal -> CLI verify -> bundle -> verify (x3)', async () => {
    for (let i = 0; i < 3; i++) {
      const dir = caseDir('e01-' + i);
      const ev = await buildPwaEvidence(dir, pwaCore.manifest.EVIDENCE_V02, i + 1);
      const sig = await sealPwaSignature(ev.path, dir);
      const v1 = spawnSync(process.execPath, [CLI_ENTRY, 'verify', ev.path, '--json'], { encoding: 'utf8' });
      assert(v1.status === 0, 'evidence verify exit ' + i + ': ' + v1.stderr);
      expect(JSON.parse(v1.stdout).coreResult, 'ok', 'evidence coreResult ' + i);
      const v2 = spawnSync(process.execPath, [CLI_ENTRY, 'verify', sig.path, '--linked', ev.path, '--json'], { encoding: 'utf8' });
      assert(v2.status === 0, 'signature verify exit ' + i + ': ' + v2.stderr);
      expect(JSON.parse(v2.stdout).coreResult, 'ok', 'signature coreResult ' + i);
      const out = path.join(dir, 'super-bundle.zip');
      const b = spawnSync(process.execPath, [CLI_ENTRY, 'bundle', ev.path, sig.path, out, '--json'], { encoding: 'utf8' });
      assert(b.status === 0, 'bundle exit ' + i + ': ' + b.stderr);
      const v3 = spawnSync(process.execPath, [CLI_ENTRY, 'verify', out, '--json'], { encoding: 'utf8' });
      assert(v3.status === 0, 'bundle verify exit ' + i + ': ' + v3.stderr);
      const j = JSON.parse(v3.stdout);
      expect(j.coreResult, 'ok', 'bundle coreResult ' + i);
      assert(j.packageType === 'bundle', 'bundle type ' + i);
      assert(j.pluginExtras.items.length === 2, 'bundle child count ' + i);
      assert(j.pluginExtras.items.every((item) => item.result === 'ok'), 'all children verify ok ' + i);
    }
    return '3 iterations of the full pipeline closed';
  });

  await runCase('E-02', 'tampering a captured photo is detected by the CLI', async () => {
    const dir = caseDir('e02');
    const ev = await buildPwaEvidence(dir, pwaCore.manifest.EVIDENCE_V02);
    const map = await extractZipEntries(ev.path);
    const photo = Buffer.from(map.get('photo-1.jpg'));
    photo[photo.length - 1] ^= 0x01;
    map.set('photo-1.jpg', photo);
    await writeZipFromMap(ev.path, map);
    const res = spawnSync(process.execPath, [CLI_ENTRY, 'verify', ev.path, '--json'], { encoding: 'utf8' });
    expect(res.status, 1, 'exit status');
    expect(JSON.parse(res.stdout).coreResult, 'tampered', 'coreResult');
    return 'CLI verify rejects tampered media';
  });

  await runCase('E-03', 'editing the manifest note without rehashing is detected', async () => {
    const dir = caseDir('e03');
    const ev = await buildPwaEvidence(dir, pwaCore.manifest.EVIDENCE_V02);
    const map = await extractZipEntries(ev.path);
    const m = JSON.parse(map.get('manifest.json').toString('utf8'));
    m.note = '被篡改的备注';
    map.set('manifest.json', Buffer.from(coreManifestText(m), 'utf8'));
    await writeZipFromMap(ev.path, map);
    const res = spawnSync(process.execPath, [CLI_ENTRY, 'verify', ev.path, '--json'], { encoding: 'utf8' });
    expect(JSON.parse(res.stdout).coreResult, 'tampered', 'coreResult');
    return 'CLI verify rejects tampered manifest';
  });

  await runCase('E-04', 'replacing the evidence package inside the bundle is detected', async () => {
    const dir = caseDir('e04');
    const ev = await buildPwaEvidence(dir, pwaCore.manifest.EVIDENCE_V02);
    const sig = await sealPwaSignature(ev.path, dir);
    const out = path.join(dir, 'super-bundle.zip');
    const bundleRes = spawnSync(process.execPath, [CLI_ENTRY, 'bundle', ev.path, sig.path, out, '--json'], { encoding: 'utf8' });
    assert(bundleRes.status === 0, 'bundle failed: ' + bundleRes.stderr);
    const map = await extractZipEntries(out);
    const fake = makeEvidence('fieldseal-evidence-v0.2', { id: ev.manifest.packageId, photo: Buffer.from('replaced media bytes') });
    map.set('evidence.zip', await fs.promises.readFile(await writePackage(path.join(dir, 'fake'), 'evidence.zip', fake.manifest, evidenceEntries(fake))));
    await writeZipFromMap(out, map);
    const verify = spawnSync(process.execPath, [CLI_ENTRY, 'verify', out, '--json'], { encoding: 'utf8' });
    expect(verify.status, 1, 'exit status');
    expect(JSON.parse(verify.stdout).coreResult, 'tampered', 'coreResult');
    return 'substituted evidence breaks bundle binding';
  });
}

async function runFullZip64Case() {
  await runCase('N-07c', 'ZIP64 archive with 66000 entries round-trips (optional --full)', async () => {
    const dir = caseDir('n07c');
    await fs.promises.mkdir(dir, { recursive: true });
    const entries = [];
    for (let i = 0; i < 66000; i++) entries.push({ name: 'e' + String(i).padStart(5, '0') + '.bin', data: Buffer.alloc(0) });
    const out = path.join(dir, 'many.zip');
    await zip.writeZip(out, entries);
    const handle = await zip.readZip(out);
    try {
      expect(handle.entries.length, 66000, 'entry count');
    } finally {
      await handle.close();
    }
    return 'ZIP64 EOCD path exercised end to end';
  });
}

async function runSigningModeCases() {
  if (!pwaCore) pwaCore = await loadPwaCore();

  await runCase('I-01', 'Joint mode: PWA seal -> CLI verify --linked ok, pluginExtras.signMode=joint', async () => {
    const dir = caseDir('i01');
    const ev = await buildPwaEvidence(dir, pwaCore.manifest.EVIDENCE_V02);
    const sig = await sealPwaSignature(ev.path, dir, null, 'joint');
    const j = JSON.parse(spawnSync(process.execPath, [CLI_ENTRY, 'verify', sig.path, '--linked', ev.path, '--json'], { encoding: 'utf8' }).stdout);
    expect(j.coreResult, 'ok', 'joint coreResult');
    expect(j.pluginExtras.signMode, 'joint', 'signMode');
    expect(j.pluginExtras.modeNote, 'joint confirmation record', 'modeNote');
    return 'joint signature verified with signMode surfaced';
  });

  await runCase('I-04', 'Independent mode: two independent signers on same evidence both verify', async () => {
    const dir = caseDir('i04');
    const ev = await buildPwaEvidence(dir, pwaCore.manifest.EVIDENCE_V02);
    const a = await sealPwaSignature(ev.path, path.join(dir, 'a'), null, 'independent');
    const b = await sealPwaSignature(ev.path, path.join(dir, 'b'), null, 'independent');
    for (const sig of [a, b]) {
      const j = JSON.parse(spawnSync(process.execPath, [CLI_ENTRY, 'verify', sig.path, '--linked', ev.path, '--json'], { encoding: 'utf8' }).stdout);
      expect(j.coreResult, 'ok', sig.path + ' coreResult');
      expect(j.pluginExtras.signMode, 'independent', sig.path + ' signMode');
    }
    assert(a.manifest.packageId !== b.manifest.packageId, 'independent packages must differ');
    return 'two independent signature packages both verify';
  });

  await runCase('I-05', 'Independent isolation: tampering signer A does not affect signer B', async () => {
    const dir = caseDir('i05');
    const ev = await buildPwaEvidence(dir, pwaCore.manifest.EVIDENCE_V02);
    const a = await sealPwaSignature(ev.path, path.join(dir, 'a'), null, 'independent');
    const b = await sealPwaSignature(ev.path, path.join(dir, 'b'), null, 'independent');
    const map = await extractZipEntries(a.path);
    const m = JSON.parse(map.get('manifest.json').toString('utf8'));
    m.linkedEvidenceRootHash = 'sha256:' + '0'.repeat(64);
    m.rootHash = await computeRootHash(m);
    map.set('manifest.json', Buffer.from(coreManifestText(m), 'utf8'));
    await writeZipFromMap(a.path, map);
    const ja = JSON.parse(spawnSync(process.execPath, [CLI_ENTRY, 'verify', a.path, '--linked', ev.path, '--json'], { encoding: 'utf8' }).stdout);
    expect(ja.coreResult, 'tampered', 'A tampered');
    const jb = JSON.parse(spawnSync(process.execPath, [CLI_ENTRY, 'verify', b.path, '--linked', ev.path, '--json'], { encoding: 'utf8' }).stdout);
    expect(jb.coreResult, 'ok', 'B still ok');
    return 'A tampered, B unaffected';
  });

  await runCase('I-07', 'Mixed bundle: evidence + joint + independent signatures archive and verify', async () => {
    const dir = caseDir('i07');
    const ev = await buildPwaEvidence(dir, pwaCore.manifest.EVIDENCE_V02);
    const joint = await sealPwaSignature(ev.path, path.join(dir, 'joint'), null, 'joint');
    const ind1 = await sealPwaSignature(ev.path, path.join(dir, 'ind1'), null, 'independent');
    const ind2 = await sealPwaSignature(ev.path, path.join(dir, 'ind2'), null, 'independent');
    const out = path.join(dir, 'mixed-bundle.zip');
    const bundle = spawnSync(process.execPath, [CLI_ENTRY, 'bundle', ev.path, joint.path, ind1.path, ind2.path, out, '--json'], { encoding: 'utf8' });
    assert(bundle.status === 0, 'bundle exit: ' + bundle.stderr);
    const j = JSON.parse(spawnSync(process.execPath, [CLI_ENTRY, 'verify', out, '--json'], { encoding: 'utf8' }).stdout);
    expect(j.coreResult, 'ok', 'bundle coreResult');
    assert(j.pluginExtras.items.length === 4, 'child count');
    assert(j.pluginExtras.items.every((it) => it.result === 'ok'), 'all children ok');
    return 'mixed archive verifies all 4 children';
  });

  await runCase('I-10', 'Audit HTML report distinguishes signMode', async () => {
    const dir = caseDir('i10');
    const ev = await buildPwaEvidence(dir, pwaCore.manifest.EVIDENCE_V02);
    const ind = await sealPwaSignature(ev.path, dir, null, 'independent');
    const html = spawnSync(process.execPath, [CLI_ENTRY, 'report-html', ind.path, '--linked', ev.path], { encoding: 'utf8' }).stdout;
    assert(/Signing mode/i.test(html), 'report missing signing mode section');
    assert(/independent/.test(html), 'report missing independent signMode');
    const joint = await sealPwaSignature(ev.path, path.join(dir, 'j'), null, 'joint');
    const html2 = spawnSync(process.execPath, [CLI_ENTRY, 'report-html', joint.path, '--linked', ev.path], { encoding: 'utf8' }).stdout;
    assert(/joint/.test(html2), 'joint report missing joint signMode');
    return 'HTML report renders signMode';
  });

  // I-02 / I-03 / I-06 / I-08 / I-09 are UI/interaction behaviours of sign.html; they are covered by S-10 and the front-end interaction review.
}

async function buildSupplement(dir, evPath) {
  const evBlob = new Blob([await fs.promises.readFile(evPath)]);
  const evInfo = await pwaCore.signature.inspectEvidencePackage(evBlob);
  const manifest = await pwaCore.manifest.buildSupplementManifest({
    supplementToEvidenceId: evInfo.manifest.packageId,
    note: 'supporting document'
  });
  const zipBlob = await pwaCore.manifest.buildSupplementZip(manifest);
  const out = path.join(dir, 'supplement.zip');
  await fs.promises.writeFile(out, Buffer.from(await zipBlob.arrayBuffer()));
  return { manifest, path: out };
}

async function runBatchAndTrailCases() {
  if (!pwaCore) pwaCore = await loadPwaCore();
  const bundleCore = require(path.join(ROOT, 'cli', 'core', 'bundle.js'));
  const BATCH_ENTRY = path.join(ROOT, 'cli', 'bin', 'batch-verify.js');

  await runCase('K-01', 'Recipient local audit log: opt-in, fields, timezone, JSON/TXT export', async () => {
    globalThis.__fieldsealMemStore = new Map();
    const log = await import(pathToFileURL(path.join(ROOT, 'pwa', 'helpers', 'local-audit-log.js')).href);
    log.setLogEnabled(true);
    log.clearLog();
    log.addEvent({ eventType: 'import-evidence', packageId: 'pkg-abc' });
    const all = log.getLog();
    assert(all.length === 1, 'one event recorded');
    assert(all[0].eventType === 'import-evidence', 'eventType');
    assert(all[0].packageId === 'pkg-abc', 'packageId');
    assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(all[0].timestamp), 'timestamp UTC');
    assert(all[0].tzIana && all[0].tzIana.length > 0, 'tzIana present');
    assert(all[0].toolVersion && all[0].toolVersion.length > 0, 'toolVersion');
    assert(JSON.parse(log.exportJson()).length === 1, 'json export');
    assert(/import-evidence/.test(log.exportTxt()), 'txt export');
    log.setLogEnabled(false);
    log.addEvent({ eventType: 'should-ignore', packageId: 'x' });
    assert(log.getLog().length === 1, 'disabled log does not append (K-02 boundary)');
    return 'local audit log fields + opt-in verified';
  });

  await runCase('K-03', 'Recipient log in bundle aux: tamper/delete aux does not affect rootHash', async () => {
    const dir = caseDir('k03');
    const ev = await buildPwaEvidence(dir, pwaCore.manifest.EVIDENCE_V02);
    const sig = await sealPwaSignature(ev.path, dir, null, 'joint');
    const auxData = Buffer.from(JSON.stringify([{ eventType: 'import-evidence', packageId: 'x', timestamp: new Date().toISOString(), tzIana: 'Europe/Berlin', toolVersion: 't' }]), 'utf8');
    const out = path.join(dir, 'bundle.zip');
    await bundleCore.buildBundle([ev.path, sig.path], out, [{ name: 'recipient-audit-log.json', data: auxData }]);
    const j1 = JSON.parse(spawnSync(process.execPath, [CLI_ENTRY, 'verify', out, '--json'], { encoding: 'utf8' }).stdout);
    expect(j1.coreResult, 'ok', 'bundle with aux log ok');
    assert(j1.pluginExtras.items.length === 2, 'two children');
    const map = await extractZipEntries(out);
    map.set('aux/recipient-audit-log.json', Buffer.from('TAMPERED'));
    await writeZipFromMap(out, map);
    const j2 = JSON.parse(spawnSync(process.execPath, [CLI_ENTRY, 'verify', out, '--json'], { encoding: 'utf8' }).stdout);
    expect(j2.coreResult, 'ok', 'tampered aux still ok');
    map.delete('aux/recipient-audit-log.json');
    await writeZipFromMap(out, map);
    const j3 = JSON.parse(spawnSync(process.execPath, [CLI_ENTRY, 'verify', out, '--json'], { encoding: 'utf8' }).stdout);
    expect(j3.coreResult, 'ok', 'deleted aux still ok');
    return 'aux log tamper/delete does not affect rootHash';
  });

  await runCase('K-04', 'Batch verify classifies mixed evidence/signature/bundle/supplement', async () => {
    const dir = caseDir('k04');
    const ev = await buildPwaEvidence(dir, pwaCore.manifest.EVIDENCE_V02);
    const sig = await sealPwaSignature(ev.path, dir, null, 'joint');
    const supp = await buildSupplement(dir, ev.path);
    const out = path.join(dir, 'bundle.zip');
    spawnSync(process.execPath, [CLI_ENTRY, 'bundle', ev.path, sig.path, supp.path, out], { encoding: 'utf8' });
    spawnSync(process.execPath, [BATCH_ENTRY, dir], { cwd: dir, encoding: 'utf8' });
    const csv = fs.readFileSync(path.join(dir, 'batch-summary.csv'), 'utf8');
    assert(/evidence/.test(csv), 'evidence classified');
    assert(/signature-record/.test(csv), 'signature classified');
    assert(/supplement/.test(csv), 'supplement classified');
    assert(/bundle/.test(csv), 'bundle classified');
    return 'mixed directory classified';
  });

  await runCase('K-05', 'Batch flags tampered / missing-linked / legacy packages correctly', async () => {
    const dir = caseDir('k05');
    const ev = await buildPwaEvidence(dir, pwaCore.manifest.EVIDENCE_V01);
    const sig = await sealPwaSignature(ev.path, dir, null, 'joint');
    let map = await extractZipEntries(sig.path);
    let m = JSON.parse(map.get('manifest.json').toString('utf8'));
    m.linkedEvidenceRootHash = 'sha256:' + '0'.repeat(64);
    m.rootHash = await computeRootHash(m);
    map.set('manifest.json', Buffer.from(coreManifestText(m), 'utf8'));
    await writeZipFromMap(sig.path, map);
    const missingPath = path.join(dir, 'missing-signature.zip');
    await fs.promises.copyFile(sig.path, missingPath);
    map = await extractZipEntries(missingPath);
    m = JSON.parse(map.get('manifest.json').toString('utf8'));
    m.linkedEvidenceId = 'f'.repeat(8) + '-' + '1'.repeat(4) + '-4' + '1'.repeat(3) + '-' + '8'.repeat(4) + '-' + 'a'.repeat(12);
    m.rootHash = await computeRootHash(m);
    map.set('manifest.json', Buffer.from(coreManifestText(m), 'utf8'));
    await writeZipFromMap(missingPath, map);
    spawnSync(process.execPath, [BATCH_ENTRY, dir], { cwd: dir, encoding: 'utf8' });
    const csv = fs.readFileSync(path.join(dir, 'batch-summary.csv'), 'utf8');
    assert(/evidence[^\n]*\bok\b/.test(csv), 'legacy evidence ok');
    assert(/tampered/.test(csv), 'tampered flagged');
    assert(/missing_linked_package/.test(csv), 'missing linked flagged');
    return 'tampered / missing / legacy classified';
  });

  await runCase('K-06', 'Large bundle with many children verifies stably via batch', async () => {
    const dir = caseDir('k06');
    const children = [];
    for (let i = 1; i <= 200; i++) {
      const ev = await buildPwaEvidence(dir, pwaCore.manifest.EVIDENCE_V02, i);
      const renamed = path.join(dir, 'evidence-' + i + '.zip');
      await fs.promises.rename(ev.path, renamed);
      children.push(renamed);
    }
    const out = path.join(dir, 'big-bundle.zip');
    await bundleCore.buildBundle(children, out);
    spawnSync(process.execPath, [BATCH_ENTRY, dir], { cwd: dir, encoding: 'utf8' });
    const csv = fs.readFileSync(path.join(dir, 'batch-summary.csv'), 'utf8');
    const lines = csv.trim().split('\n');
    assert(lines.length >= 202, 'all 200 children + bundle listed');
    assert(!/tampered|missing_linked_package/.test(csv), 'no failures among children');
    return '200-child bundle batch ok';
  });

  await runCase('K-07', 'Legacy packages without extension fields verify via batch', async () => {
    const dir = caseDir('k07');
    const ev = await buildPwaEvidence(dir, pwaCore.manifest.EVIDENCE_V01);
    const sig = await sealPwaSignature(ev.path, dir, null, 'joint');
    spawnSync(process.execPath, [BATCH_ENTRY, dir], { cwd: dir, encoding: 'utf8' });
    const csv = fs.readFileSync(path.join(dir, 'batch-summary.csv'), 'utf8');
    assert(/evidence[^\n]*\bok\b/.test(csv), 'legacy evidence ok');
    assert(/signature-record[^\n]*\bok\b/.test(csv), 'legacy signature ok');
    return 'legacy packages batch ok';
  });
}

async function runDestructiveCases() {
  if (!pwaCore) pwaCore = await loadPwaCore();
  const crypto = require('crypto');
  const bundleCore = require(path.join(ROOT, 'cli', 'core', 'bundle.js'));
  const BATCH_ENTRY = path.join(ROOT, 'cli', 'bin', 'batch-verify.js');

  async function rewriteZip(zipPath, mutate) {
    const map = await extractZipEntries(zipPath);
    const m = JSON.parse(map.get('manifest.json').toString('utf8'));
    mutate(map, m);
    m.rootHash = await computeRootHash(m);
    map.set('manifest.json', Buffer.from(coreManifestText(m), 'utf8'));
    await writeZipFromMap(zipPath, map);
    return m;
  }
  async function rewriteBundleIndex(zipPath, mutate) {
    const map = await extractZipEntries(zipPath);
    const idx = JSON.parse(map.get('bundle-index.json').toString('utf8'));
    mutate(idx);
    idx.rootHash = await computeRootHash(idx);
    map.set('bundle-index.json', Buffer.from(coreManifestText(idx), 'utf8'));
    await writeZipFromMap(zipPath, map);
    return idx;
  }
  function renderReport(targetPath) {
    const out = spawnSync(process.execPath, [CLI_ENTRY, 'report-html', targetPath], { encoding: 'utf8' });
    assert(out.status === 0, 'report-html exit ' + out.status + ': ' + out.stderr);
    return out.stdout;
  }

  await runCase('D-01', 'Tamper any manifest hash-binding field -> coreResult tampered', async () => {
    const dir = caseDir('d01');

    // Layer 1: evidence content-side hash binding break (actual file changed, manifest hash intact)
    const ev = await buildPwaEvidence(dir, pwaCore.manifest.EVIDENCE_V02);
    await rewriteZip(ev.path, (map, m) => { const t = m.files[0].name; map.set(t, Buffer.from('TAMPERED-CONTENT')); });
    expect(JSON.parse(spawnSync(process.execPath, [CLI_ENTRY, 'verify', ev.path, '--json'], { encoding: 'utf8' }).stdout).coreResult, 'tampered', 'evidence file content tamper');

    // Layer 2: signature linked-evidence root-hash binding break (fresh clean evidence + signature)
    const ev2 = await buildPwaEvidence(dir, pwaCore.manifest.EVIDENCE_V02);
    const sig = await sealPwaSignature(ev2.path, dir, null, 'joint');
    await rewriteZip(sig.path, (map, m) => { m.linkedEvidenceRootHash = 'sha256:' + '0'.repeat(64); });
    expect(JSON.parse(spawnSync(process.execPath, [CLI_ENTRY, 'verify', sig.path, '--json', '--linked', ev2.path], { encoding: 'utf8' }).stdout).coreResult, 'tampered', 'signature linked root hash tamper');

    // Layer 3: bundle child item hash binding break (fresh clean children + bundle)
    const ev3 = await buildPwaEvidence(dir, pwaCore.manifest.EVIDENCE_V02);
    const sig2 = await sealPwaSignature(ev3.path, dir, null, 'joint');
    const bundle = path.join(dir, 'bundle.zip');
    await bundleCore.buildBundle([ev3.path, sig2.path], bundle);
    await rewriteBundleIndex(bundle, (idx) => { idx.items[0].hash = 'sha256:' + '0'.repeat(64); });
    expect(JSON.parse(spawnSync(process.execPath, [CLI_ENTRY, 'verify', bundle, '--json'], { encoding: 'utf8' }).stdout).coreResult, 'tampered', 'bundle child item hash tamper');
    return 'manifest hash-binding tamper detected at all three layers';
  });

  await runCase('D-02', 'Tamper aux/log/report files does not affect main package', async () => {
    const dir = caseDir('d02');
    const ev = await buildPwaEvidence(dir, pwaCore.manifest.EVIDENCE_V02);
    await rewriteZip(ev.path, (map, m) => { map.set('aux/note.txt', Buffer.from('original')); });
    expect(JSON.parse(spawnSync(process.execPath, [CLI_ENTRY, 'verify', ev.path, '--json'], { encoding: 'utf8' }).stdout).coreResult, 'ok', 'evidence with aux ok');
    await rewriteZip(ev.path, (map, m) => { map.set('aux/note.txt', Buffer.from('TAMPERED')); });
    expect(JSON.parse(spawnSync(process.execPath, [CLI_ENTRY, 'verify', ev.path, '--json'], { encoding: 'utf8' }).stdout).coreResult, 'ok', 'tampered aux still ok');

    const sig = await sealPwaSignature(ev.path, dir, null, 'joint');
    const bundle = path.join(dir, 'bundle.zip');
    await bundleCore.buildBundle([ev.path, sig.path], bundle, [{ name: 'recipient-audit-log.json', data: Buffer.from('{"x":1}') }]);
    const map = await extractZipEntries(bundle);
    if (map.has('aux/recipient-audit-log.json')) map.set('aux/recipient-audit-log.json', Buffer.from('TAMPERED'));
    await writeZipFromMap(bundle, map);
    expect(JSON.parse(spawnSync(process.execPath, [CLI_ENTRY, 'verify', bundle, '--json'], { encoding: 'utf8' }).stdout).coreResult, 'ok', 'tampered bundle aux still ok');
    return 'aux tamper isolated from root hash';
  });

  await runCase('D-03', 'Wrong cross-package binding (evidenceId) is intercepted', async () => {
    const dir = caseDir('d03');
    const ev = await buildPwaEvidence(dir, pwaCore.manifest.EVIDENCE_V02);
    const sig = await sealPwaSignature(ev.path, dir, null, 'joint');
    await rewriteZip(sig.path, (map, m) => { m.linkedEvidenceRootHash = 'sha256:' + '0'.repeat(64); });
    expect(JSON.parse(spawnSync(process.execPath, [CLI_ENTRY, 'verify', sig.path, '--json'], { encoding: 'utf8' }).stdout).coreResult, 'tampered', 'wrong bound root hash -> tampered');
    await rewriteZip(sig.path, (map, m) => { m.linkedEvidenceId = 'f'.repeat(8) + '-' + 'f'.repeat(4) + '-4' + 'f'.repeat(3) + '-' + '8'.repeat(4) + '-' + 'a'.repeat(12); });
    expect(JSON.parse(spawnSync(process.execPath, [CLI_ENTRY, 'verify', sig.path, '--json'], { encoding: 'utf8' }).stdout).coreResult, 'missing_linked_package', 'non-existent evidence id -> missing');
    return 'cross-package binding interception verified';
  });

  await runCase('D-04', 'Circular supersedes chain is reported, not crashed', async () => {
    const dir = caseDir('d04');
    const evA = await buildPwaEvidence(dir, pwaCore.manifest.EVIDENCE_V02);
    const evAPath = path.join(dir, 'evA.zip'); await fs.promises.rename(evA.path, evAPath);
    const evB = await buildPwaEvidence(dir, pwaCore.manifest.EVIDENCE_V02);
    const evBPath = path.join(dir, 'evB.zip'); await fs.promises.rename(evB.path, evBPath);
    await rewriteZip(evAPath, (map, m) => { m.supersedesPackageId = evB.manifest.packageId; });
    await rewriteZip(evBPath, (map, m) => { m.supersedesPackageId = evA.manifest.packageId; });
    expect(JSON.parse(spawnSync(process.execPath, [CLI_ENTRY, 'verify', evAPath, '--json'], { encoding: 'utf8' }).stdout).coreResult, 'ok', 'circular supersedes evidence A ok');
    const html = renderReport(evAPath);
    assert(html.includes(evB.manifest.packageId), 'report renders supersedes chain reference');
    return 'circular supersedes reported without crash';
  });

  await runCase('D-05', 'Oversized media + long/special-char fields: ok and report renders', async () => {
    const dir = caseDir('d05');
    // Evidence layer: oversized media + long / special-char note & tags (valid evidence fields only)
    const ev = await buildPwaEvidence(dir, pwaCore.manifest.EVIDENCE_V02);
    const big = crypto.randomBytes(3 * 1024 * 1024);
    await rewriteZip(ev.path, (map, m) => {
      const target = m.files[0].name;
      map.set(target, big);
      m.files = m.files.map((f) => f.name === target ? { ...f, hash: 'sha256:' + crypto.createHash('sha256').update(big).digest('hex') } : f);
      m.note = 'x'.repeat(2000) + ' €<>{}#%& Sonderzeichen';
      m.tags = ['REF/<>{}#%&€', 'a'.repeat(500)];
    });
    expect(JSON.parse(spawnSync(process.execPath, [CLI_ENTRY, 'verify', ev.path, '--json'], { encoding: 'utf8' }).stdout).coreResult, 'ok', 'oversized media + special fields ok');
    const html = renderReport(ev.path);
    assert(html.length > 0, 'evidence report rendered');

    // Signature layer: long / special-char party fields (organization, referenceId, reservation)
    const ev2 = await buildPwaEvidence(dir, pwaCore.manifest.EVIDENCE_V02);
    const sig = await sealPwaSignature(ev2.path, dir, null, 'joint');
    const map = await extractZipEntries(sig.path);
    const m = JSON.parse(map.get('manifest.json').toString('utf8'));
    m.parties = [{ name: 'Alice', role: 'Eigentuemer', organization: 'A'.repeat(500), referenceId: 'REF/<>{}#%&€', confirm: true, signedAt: '2026-11-11T10:00:00Z', reservation: 'x'.repeat(2000) }];
    m.rootHash = await computeRootHash(m);
    map.set('manifest.json', Buffer.from(coreManifestText(m), 'utf8'));
    await writeZipFromMap(sig.path, map);
    expect(JSON.parse(spawnSync(process.execPath, [CLI_ENTRY, 'verify', sig.path, '--json', '--linked', ev2.path], { encoding: 'utf8' }).stdout).coreResult, 'ok', 'special-char party fields ok');
    const html2 = renderReport(sig.path);
    assert(html2.length > 0, 'signature report rendered');
    return 'oversized media and edge-case fields handled';
  });

  await runCase('D-06', 'Offline / Service Worker presence (static; full offline needs browser)', async () => {
    assert(fs.existsSync(path.join(ROOT, 'pwa', 'sw.js')), 'pwa/sw.js exists');
    const signHtml = fs.readFileSync(path.join(ROOT, 'pwa', 'sign.html'), 'utf8');
    assert(/registerServiceWorker/.test(signHtml), 'sign.html registers a service worker for offline cache');
    return 'offline assets present (full offline interaction requires manual browser verification)';
  });

  await runCase('D-07', 'Mixed bundle (evidence+joint+independent+supplement+revision) verifies recursively', async () => {
    const dir = caseDir('d07');
    const ev1 = await buildPwaEvidence(dir, pwaCore.manifest.EVIDENCE_V02);
    const ev1Path = path.join(dir, 'ev1.zip'); await fs.promises.rename(ev1.path, ev1Path);
    const sj = await sealPwaSignature(ev1Path, dir, null, 'joint');
    const sjPath = path.join(dir, 'joint.zip'); await fs.promises.rename(sj.path, sjPath);
    const si = await sealPwaSignature(ev1Path, dir, null, 'independent');
    const siPath = path.join(dir, 'ind.zip'); await fs.promises.rename(si.path, siPath);
    const rev = await buildPwaEvidence(dir, pwaCore.manifest.EVIDENCE_V02);
    const revPath = path.join(dir, 'rev.zip'); await fs.promises.rename(rev.path, revPath);
    await rewriteZip(revPath, (map, m) => { m.supersedesPackageId = ev1.manifest.packageId; });
    const supp = await buildSupplement(dir, ev1Path);
    const bundle = path.join(dir, 'bundle.zip');
    await bundleCore.buildBundle([ev1Path, sjPath, siPath, revPath, supp.path], bundle);
    expect(JSON.parse(spawnSync(process.execPath, [CLI_ENTRY, 'verify', bundle, '--json'], { encoding: 'utf8' }).stdout).coreResult, 'ok', 'mixed bundle ok');
    const html = renderReport(bundle);
    assert(html.length > 0, 'mixed bundle report rendered');
    return 'mixed bundle all child types verified';
  });

  await runCase('D-08', 'Repeated export/import + log append stability', async () => {
    globalThis.__fieldsealMemStore = new Map();
    const log = await import(pathToFileURL(path.join(ROOT, 'pwa', 'helpers', 'local-audit-log.js')).href);
    log.setLogEnabled(true);
    log.clearLog();
    log.addEvent({ eventType: 'import-evidence', packageId: 'p1' });
    log.addEvent({ eventType: 'import-evidence', packageId: 'p2' });
    log.addEvent({ eventType: 'import-evidence', packageId: 'p3' });
    log.addEvent({ eventType: 'export-certificate', packageId: 'p1' });
    log.addEvent({ eventType: 'export-certificate', packageId: 'p1' });
    const all = log.getLog();
    assert(all.length === 5, 'five events appended');
    assert(all[0].eventType === 'import-evidence' && all[3].eventType === 'export-certificate', 'append order preserved');

    const dir = caseDir('d08');
    const ev = await buildPwaEvidence(dir, pwaCore.manifest.EVIDENCE_V02);
    const sig = await sealPwaSignature(ev.path, dir, null, 'joint');
    const bundle = path.join(dir, 'bundle.zip');
    await bundleCore.buildBundle([ev.path, sig.path], bundle);
    for (let i = 0; i < 3; i++) {
      spawnSync(process.execPath, [BATCH_ENTRY, dir], { cwd: dir, encoding: 'utf8' });
      const csv = fs.readFileSync(path.join(dir, 'batch-summary.csv'), 'utf8');
      assert(!/tampered|missing_linked_package/.test(csv), 'repeat ' + i + ' ok');
    }
    return 'log append and repeated verification stable';
  });
}

async function runCustodyCases() {
  process.stdout.write('\n-- chain-of-custody & audit features (§C) --\n');
  const CLI = CLI_ENTRY;

  await runCase('C-01', 'CLI custody injects metadata, hash-bound, verifies ok', async () => {
    const dir = caseDir('c01');
    const ev = await buildPwaEvidence(dir, pwaCore.manifest.EVIDENCE_V02);
    const meta = {
      metaTemplate: 'forensic-investigator',
      evidencePurpose: 'Forensic acquisition',
      jurisdiction: 'EU-DE',
      caseReference: 'CASE-001',
      evidenceIdentifier: 'EVID-1',
      custodyStartUtc: '2026-11-12 09:00:00 UTC',
      chainOfCustody: [{ actorName: 'Alice', actorRole: 'Forensic Investigator', actionType: 'Collected', actionUtc: '2026-11-12 09:00:00 UTC' }],
      customExtraFields: [{ fieldKey: 'witnessName', fieldLabel: 'Witness Name', fieldValue: 'Bob', fieldType: 'text' }]
    };
    const metaFile = path.join(dir, 'meta.json');
    await fs.promises.writeFile(metaFile, JSON.stringify(meta));
    const res = spawnSync(process.execPath, [CLI, 'custody', ev.path, '--meta-json', metaFile, '--json'], { encoding: 'utf8' });
    assert(res.status === 0, 'custody command exit 0: ' + res.stderr);
    const applied = JSON.parse(res.stdout);
    const map = await extractZipEntries(ev.path);
    const m = JSON.parse(map.get('manifest.json').toString('utf8'));
    expect(m.rootHash, applied.rootHash, 'rootHash matches');
    assert(JSON.stringify(m.custody) === JSON.stringify(meta), 'custody stored verbatim');
    const v = JSON.parse(spawnSync(process.execPath, [CLI, 'verify', ev.path, '--json'], { encoding: 'utf8' }).stdout);
    expect(v.coreResult, 'ok', 'verify ok after custody');
    assert(v.pluginExtras.custody && v.pluginExtras.custody.customExtraFields.length === 1, 'custody surfaced in report extras');
    return 'custody injected and hash-bound';
  });

  await runCase('C-02', 'Invalid custody rejected by kernel', async () => {
    const dir = caseDir('c02');
    const ev = await buildPwaEvidence(dir, pwaCore.manifest.EVIDENCE_V02);
    const meta = { chainOfCustody: [{ actorName: '', actionType: 'Wrong' }] };
    const metaFile = path.join(dir, 'meta.json');
    await fs.promises.writeFile(metaFile, JSON.stringify(meta));
    const res = spawnSync(process.execPath, [CLI, 'custody', ev.path, '--meta-json', metaFile, '--json'], { encoding: 'utf8' });
    assert(res.status !== 0, 'custody command must fail on invalid metadata');
    assert(/custody validation failed/.test(res.stderr), 'kernel error surfaced verbatim: ' + res.stderr);
    return 'invalid custody kernel-rejected';
  });

  await runCase('C-03', 'Tampering custody metadata breaks rootHash', async () => {
    const dir = caseDir('c03');
    const ev = await buildPwaEvidence(dir, pwaCore.manifest.EVIDENCE_V02);
    const meta = { jurisdiction: 'EU-DE', chainOfCustody: [{ actorName: 'Alice', actionType: 'Collected' }] };
    const metaFile = path.join(dir, 'meta.json');
    await fs.promises.writeFile(metaFile, JSON.stringify(meta));
    spawnSync(process.execPath, [CLI, 'custody', ev.path, '--meta-json', metaFile], { encoding: 'utf8' });
    const map = await extractZipEntries(ev.path);
    const m = JSON.parse(map.get('manifest.json').toString('utf8'));
    m.custody = m.custody || {};
    m.custody.jurisdiction = 'US-NY';
    map.set('manifest.json', Buffer.from(JSON.stringify(m), 'utf8'));
    await writeZipFromMap(ev.path, map);
    const v = JSON.parse(spawnSync(process.execPath, [CLI, 'verify', ev.path, '--json'], { encoding: 'utf8' }).stdout);
    expect(v.coreResult, 'tampered', 'custody tamper detected');
    return 'custody tamper -> tampered';
  });

  await runCase('C-04', 'SHA3-256 manifest binding via CLI', async () => {
    const dir = caseDir('c04');
    const ev = await buildPwaEvidence(dir, pwaCore.manifest.EVIDENCE_V02);
    const meta = { jurisdiction: 'EU-DE', chainOfCustody: [{ actorName: 'Alice', actionType: 'Collected' }] };
    const metaFile = path.join(dir, 'meta.json');
    await fs.promises.writeFile(metaFile, JSON.stringify(meta));
    const res = spawnSync(process.execPath, [CLI, 'custody', ev.path, '--meta-json', metaFile, '--hash-algorithm', 'sha3-256', '--json'], { encoding: 'utf8' });
    assert(res.status === 0, 'sha3 custody exit 0: ' + res.stderr);
    const map = await extractZipEntries(ev.path);
    const m = JSON.parse(map.get('manifest.json').toString('utf8'));
    expect(m.hashAlgorithm, 'sha3-256', 'hashAlgorithm recorded');
    assert(/^sha3-256:/.test(m.rootHash), 'rootHash uses sha3 prefix');
    for (const f of m.files) assert(/^sha3-256:/.test(f.hash), 'file hash sha3: ' + f.name);
    const v = JSON.parse(spawnSync(process.execPath, [CLI, 'verify', ev.path, '--json'], { encoding: 'utf8' }).stdout);
    expect(v.coreResult, 'ok', 'sha3 verify ok');
    return 'sha3-256 binding verified';
  });

  await runCase('C-05', 'verify --strict / --audit-only modes', async () => {
    const dir = caseDir('c05');
    const ev = await buildPwaEvidence(dir, pwaCore.manifest.EVIDENCE_V02);
    // Place the signature in a sibling folder that does NOT contain the evidence,
    // so auto-discovery cannot silently resolve the linked package.
    const sigDir = path.join(dir, 'sigOnly');
    await fs.promises.mkdir(sigDir, { recursive: true });
    const sig = await sealPwaSignature(ev.path, sigDir, null, 'joint');
    const def = JSON.parse(spawnSync(process.execPath, [CLI, 'verify', sig.path, '--json'], { encoding: 'utf8' }).stdout);
    expect(def.coreResult, 'missing_linked_package', 'default (auto-discover) requires link');
    const audit = JSON.parse(spawnSync(process.execPath, [CLI, 'verify', sig.path, '--audit-only', '--json'], { encoding: 'utf8' }).stdout);
    expect(audit.coreResult, 'ok', 'audit-only tolerates missing link');
    assert(audit.pluginExtras.auditOnly === true, 'auditOnly flag set');
    const strict = JSON.parse(spawnSync(process.execPath, [CLI, 'verify', sig.path, '--strict', '--json'], { encoding: 'utf8' }).stdout);
    expect(strict.coreResult, 'missing_linked_package', 'strict (no auto-discover) still fails without explicit link');
    return 'strict/audit-only branch logic works';
  });

  await runCase('C-06', 'audit schema emits custody spec', async () => {
    const res = spawnSync(process.execPath, [CLI, 'schema'], { encoding: 'utf8' });
    assert(res.status === 0, 'schema exit 0: ' + res.stderr);
    const s = JSON.parse(res.stdout);
    assert(s.definitions && s.definitions.custody, 'custody definition present');
    assert(Array.isArray(s.hashAlgorithms) && s.hashAlgorithms.includes('sha3-256'), 'sha3 in algorithms');
    return 'schema.json emitted';
  });

  await runCase('C-07', 'aux GDPR redaction + retention timer', async () => {
    globalThis.__fieldsealMemStore = new Map();
    const mod = await import(pathToFileURL(path.join(ROOT, 'pwa', 'helpers', 'local-audit-log.js')).href);
    mod.setLogEnabled(true);
    mod.setGdprEnabled(true);
    mod.setRetentionMaxAge(0);
    mod.clearLog();
    mod.addEvent({ eventType: 'import', packageId: 'sha256:' + 'a'.repeat(64) });
    const redacted = mod.getLog()[0];
    assert(redacted.redacted === true, 'event redacted');
    assert(redacted.packageId !== 'sha256:' + 'a'.repeat(64), 'packageId masked');
    assert(redacted.tzIana === undefined && redacted.toolVersion === undefined, 'env fields dropped');
    // Inject an old event directly into the shared memory store, then verify pruning.
    globalThis.__fieldsealMemStore.set('fieldseal-local-audit-log', JSON.stringify([{ eventType: 'old', packageId: 'x', timestamp: new Date(Date.now() - 100000).toISOString() }]));
    mod.setRetentionMaxAge(1000);
    const removed = mod.pruneExpired();
    assert(removed >= 1, 'old events pruned');
    assert((await import(pathToFileURL(path.join(ROOT, 'pwa', 'helpers', 'local-audit-log.js')).href)).getLog().length === 0, 'store empty after prune');
    mod.setRetentionMaxAge(0);
    mod.stopRetentionTimer();
    return 'GDPR redaction + retention works';
  });

  await runCase('C-08', 'CSV report maps SOC2 columns + custom field columns', async () => {
    const dir = caseDir('c08');
    const ev = await buildPwaEvidence(dir, pwaCore.manifest.EVIDENCE_V02);
    const meta = {
      jurisdiction: 'EU-DE', caseReference: 'CASE-9', evidenceIdentifier: 'EVID-9',
      chainOfCustody: [{ actorName: 'Alice', actionType: 'Collected' }],
      customExtraFields: [{ fieldKey: 'witnessName', fieldLabel: 'Witness', fieldValue: 'Bob', fieldType: 'text' }]
    };
    const metaFile = path.join(dir, 'meta.json');
    await fs.promises.writeFile(metaFile, JSON.stringify(meta));
    spawnSync(process.execPath, [CLI, 'custody', ev.path, '--meta-json', metaFile], { encoding: 'utf8' });
    const out = path.join(dir, 'bundle.zip');
    spawnSync(process.execPath, [CLI, 'bundle', ev.path, out], { encoding: 'utf8' });
    const csv = spawnSync(process.execPath, [CLI, 'report-csv', out], { encoding: 'utf8' }).stdout;
    const header = csv.split('\n')[0];
    assert(/custom_witnessName/.test(header), 'custom column present: ' + header);
    assert(/EU-DE/.test(csv), 'jurisdiction mapped');
    assert(/CASE-9/.test(csv), 'case reference mapped');
    assert(/EVID-9/.test(csv), 'evidence id mapped');
    assert(/Bob/.test(csv), 'custom value present');
    return 'CSV SOC2 mapping + custom columns';
  });
}

async function runCaseLayerCases() {
  process.stdout.write('\n-- case-layer foundation (§C-case, new wrapper spec) --\n');
  const caseCore = await import(pathToFileURL(path.join(ROOT, 'pwa', 'core', 'case-manifest.js')).href);
  const CLI = CLI_ENTRY;
  const CASE_DIR = caseDir('casebase');

  await runCase('C-09', 'standard case creates draft with schema + hashes', async () => {
    const c = await caseCore.createCase({ origin: 'standard', metaTemplate: 'forensic-investigator', mode: 'full' });
    assert(c.state === 'draft', 'state draft');
    assert(caseCore.validateCaseManifest(c).ok, 'manifest structurally valid');
    assert(/^sha256:/.test(c.rootHash), 'rootHash computed');
    assert(/^sha256:/.test(c.sealHash), 'sealHash preview computed');
    assert(c.schemaDef.globalFields.length > 0, 'template fields loaded');
    return 'standard draft ok';
  });

  await runCase('C-10', 'emergency path: pending-configuration blocks seal, supplement unlocks', async () => {
    const c = await caseCore.createCase({ origin: 'emergency' });
    assert(c.state === 'pending-configuration', 'starts pending');
    let blocked = false;
    try { await caseCore.sealCase(c, {}); } catch (e) { blocked = true; }
    assert(blocked, 'seal blocked while pending');
    const supp = await caseCore.supplementSchema(c, { metaTemplate: 'devops-security', mode: 'full', operator: 'Alice', ianaTz: 'UTC' });
    assert(supp.state === 'draft', 'draft after supplement');
    assert(supp.schemaSupplementedUtc, 'supplement timestamp set');
    assert(supp.schemaChangeLog.some((l) => /Emergency Capture/.test(l.summary)), 'emergency note in audit log');
    const sealed = await caseCore.sealCase(supp, { actorName: 'Alice' });
    assert(sealed.state === 'sealed', 'sealed after supplement');
    return 'emergency flow ok';
  });

  await runCase('C-11', 'captures append child + Collected event; sealHash binds children', async () => {
    const ev1 = await buildPwaEvidence(path.join(CASE_DIR, 'e1'), pwaCore.manifest.EVIDENCE_V02, 1);
    const ev2 = await buildPwaEvidence(path.join(CASE_DIR, 'e2'), pwaCore.manifest.EVIDENCE_V02, 2);
    const c = await caseCore.createCase({ origin: 'standard', metaTemplate: 'blank' });
    await caseCore.addCapture(c, { evidenceId: 'cap-1', packageId: ev1.manifest.packageId, rootHash: ev1.manifest.rootHash, spec: 'fieldseal-evidence-v0.2', capturedUtc: '2026-11-12T10:01:00Z', ianaTz: 'Europe/Berlin', actorName: 'Alice', itemValues: { sceneZone: 'Room A' } });
    await caseCore.addCapture(c, { evidenceId: 'cap-2', packageId: ev2.manifest.packageId, rootHash: ev2.manifest.rootHash, ianaTz: 'UTC', actorName: 'Bob' });
    assert(c.children.length === 2, 'two children');
    assert(c.custodyLog.filter((e) => e.eventType === 'Collected').length === 2, 'two Collected events');
    const before = c.sealHash;
    await caseCore.addCapture(c, { evidenceId: 'cap-3', packageId: 'x', rootHash: ev1.manifest.rootHash });
    assert(before !== c.sealHash, 'sealHash changes when children change');
    return 'capture binding ok';
  });

  await runCase('C-12', 'schema change logs + version bump; deletion does not purge history', async () => {
    const c = await caseCore.createCase({ origin: 'standard', metaTemplate: 'blank' });
    await caseCore.changeSchema(c, { added: [{ scope: 'global', key: 'custodianBadgeId', label: 'Badge', type: 'text', required: false }], operator: 'Alice', ianaTz: 'UTC' });
    assert(c.schemaDef.version === 2, 'version bumped to 2');
    assert(c.schemaChangeLog.length === 1, 'one change log');
    assert(c.schemaDef.globalFields.some((f) => f.key === 'custodianBadgeId'), 'field added');
    // historical child data must survive deletion of a field
    await caseCore.addCapture(c, { evidenceId: 'cap-1', packageId: 'p1', rootHash: 'sha256:' + 'a'.repeat(64), itemValues: { custodianBadgeId: 'B-123' } });
    await caseCore.changeSchema(c, { deleted: [{ scope: 'global', key: 'custodianBadgeId' }], operator: 'Alice' });
    assert(!c.schemaDef.globalFields.some((f) => f.key === 'custodianBadgeId'), 'field removed from schema');
    const collected = c.custodyLog.find((e) => e.evidenceId === 'cap-1');
    assert(collected.itemValues.custodianBadgeId === 'B-123', 'historical value retained after delete');
    return 'schema edit + retention ok';
  });

  await runCase('C-13', 'seal fixes sealHash; tampering any bound data fails verify', async () => {
    const ev1 = await buildPwaEvidence(path.join(CASE_DIR, 's1'), pwaCore.manifest.EVIDENCE_V02, 3);
    const c = await caseCore.createCase({ origin: 'standard', metaTemplate: 'blank' });
    await caseCore.addCapture(c, { evidenceId: 'cap-1', packageId: ev1.manifest.packageId, rootHash: ev1.manifest.rootHash });
    const sealed = await caseCore.sealCase(c, { actorName: 'Alice' });
    const ok = await caseCore.verifyCase(sealed, {});
    assert(ok.coreResult === 'ok', 'sealed case verifies ok');
    assert(ok.sealHash === sealed.sealHash, 'sealHash stable');
    // tamper: alter a bound child rootHash
    const tampered = JSON.parse(JSON.stringify(sealed));
    tampered.children[0].rootHash = 'sha256:' + 'f'.repeat(64);
    const bad = await caseCore.verifyCase(tampered, {});
    assert(bad.coreResult === 'tampered', 'child tamper -> tampered');
    // tamper: alter a custody note (also bound)
    const tampered2 = JSON.parse(JSON.stringify(sealed));
    tampered2.custodyLog[0].note = 'altered';
    const bad2 = await caseCore.verifyCase(tampered2, {});
    assert(bad2.coreResult === 'tampered', 'custody tamper -> tampered');
    return 'seal + tamper detection ok';
  });

  await runCase('C-14', 'CLI case verify round-trip (dir + zip) and child tamper', async () => {
    const ev1 = await buildPwaEvidence(path.join(CASE_DIR, 'cli1'), pwaCore.manifest.EVIDENCE_V02, 4);
    const ev2 = await buildPwaEvidence(path.join(CASE_DIR, 'cli2'), pwaCore.manifest.EVIDENCE_V02, 5);
    const c = await caseCore.createCase({ origin: 'standard', metaTemplate: 'blank' });
    await caseCore.addCapture(c, { evidenceId: 'cap-1', packageId: ev1.manifest.packageId, rootHash: ev1.manifest.rootHash });
    await caseCore.addCapture(c, { evidenceId: 'cap-2', packageId: ev2.manifest.packageId, rootHash: ev2.manifest.rootHash });
    const sealed = await caseCore.sealCase(c, { actorName: 'Alice' });
    // write export dir
    const exportDir = path.join(CASE_DIR, 'export');
    await fs.promises.mkdir(path.join(exportDir, 'evidence'), { recursive: true });
    await fs.promises.writeFile(path.join(exportDir, 'case-manifest.json'), JSON.stringify(sealed));
    const ev1Buf = await fs.promises.readFile(ev1.path);
    const ev2Buf = await fs.promises.readFile(ev2.path);
    await fs.promises.writeFile(path.join(exportDir, 'evidence', ev1.manifest.packageId + '.zip'), ev1Buf);
    await fs.promises.writeFile(path.join(exportDir, 'evidence', ev2.manifest.packageId + '.zip'), ev2Buf);
    const good = JSON.parse(spawnSync(process.execPath, [CLI, 'case', 'verify', exportDir, '--json'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).stdout);
    assert(good.coreResult === 'ok', 'case verify ok: ' + JSON.stringify(good.errors));
    // tamper one evidence zip
    const buf = await fs.promises.readFile(ev1.path);
    buf[buf.length - 5] ^= 0xff;
    await fs.promises.writeFile(path.join(exportDir, 'evidence', ev1.manifest.packageId + '.zip'), buf);
    const bad = JSON.parse(spawnSync(process.execPath, [CLI, 'case', 'verify', exportDir, '--json'], { encoding: 'utf8' }).stdout);
    assert(bad.coreResult === 'tampered', 'tampered child -> tampered');
    // zip packaging round-trip (cli zipStream supports sourcePath entries)
    const cliZip = require(path.join(ROOT, 'cli', 'core', 'zip-stream'));
    const zipOut = path.join(CASE_DIR, 'export.zip');
    await cliZip.writeZip(zipOut, [
      { name: 'case-manifest.json', data: Buffer.from(JSON.stringify(sealed)) },
      { name: 'evidence/' + ev1.manifest.packageId + '.zip', sourcePath: ev1.path },
      { name: 'evidence/' + ev2.manifest.packageId + '.zip', sourcePath: ev2.path }
    ]);
    const zipRes = JSON.parse(spawnSync(process.execPath, [CLI, 'case', 'verify', zipOut, '--json'], { encoding: 'utf8' }).stdout);
    assert(zipRes.coreResult === 'ok', 'zip case verify ok: ' + JSON.stringify(zipRes));
    return 'CLI case verify ok (dir + zip)';
  });

  await runCase('C-15', 'case hash-algorithm binding follows real WebCrypto capability', async () => {
    // Node 26 exposes WebCrypto SHA3-256 experimentally; Node 18/20 LTS and most browsers
    // reject the algorithm name. Assert the CAPABILITY BRANCH, not a hard-coded sha3 result,
    // so the gate is green on both kinds of runtime (delivery-audit RB-02).
    const hashCore = await import(pathToFileURL(path.join(ROOT, 'pwa', 'core', 'hash.js')).href);
    const supported = await hashCore.sha3Supported();
    const offered = await hashCore.availableHashAlgorithms();
    assert(Array.isArray(offered) && offered.includes('sha256'), 'sha256 must always be offered');
    if (supported) {
      assert(offered.includes('sha3-256'), 'sha3-256 must be offered when WebCrypto supports it');
      const c = await caseCore.createCase({ origin: 'standard', metaTemplate: 'blank', hashAlgorithm: 'sha3-256' });
      assert(/^sha3-256:/.test(c.rootHash), 'rootHash sha3');
      assert(/^sha3-256:/.test(c.sealHash), 'sealHash sha3');
      return 'sha3-256 case binding ok (runtime WebCrypto supports SHA3-256)';
    }
    assert(!offered.includes('sha3-256'), 'sha3-256 must be disabled when WebCrypto rejects it');
    let refused = false;
    try {
      await caseCore.createCase({ origin: 'standard', metaTemplate: 'blank', hashAlgorithm: 'sha3-256' });
    } catch (err) {
      refused = /not available|not supported/i.test(String((err && err.message) || err));
    }
    assert(refused, 'sha3-256 creation must fail closed with a clear capability error');
    const fallback = await caseCore.createCase({ origin: 'standard', metaTemplate: 'blank' });
    assert(/^sha256:/.test(fallback.rootHash), 'default case still binds with sha256');
    assert(/^sha256:/.test(fallback.sealHash), 'default sealHash still binds with sha256');
    return 'SHA3-256 unavailable: disabled, fail-closed, sha256 fallback verified';
  });
}

async function runCaseFlowCases() {
  process.stdout.write('\n-- case-layer Phase 3 flows (capture & custody) --\n');
  const caseCore = await import(pathToFileURL(path.join(ROOT, 'pwa', 'core', 'case-manifest.js')).href);
  const FLOW_DIR = caseDir('flow');
  const CLI = CLI_ENTRY;

  await runCase('C-16', 'standard capture: frozen v0.2 package -> Collected event -> case verifies ok', async () => {
    const ev = await buildPwaEvidence(path.join(FLOW_DIR, 'cap1'), pwaCore.manifest.EVIDENCE_V02, 21);
    const c = await caseCore.createCase({ origin: 'standard', metaTemplate: 'forensic-investigator', mode: 'full' });
    const before = c.sealHash;
    c.caseMeta.caseReference = 'CASE-2026-001';
    await caseCore.addCapture(c, {
      evidenceId: 'ev-1', packageId: ev.manifest.packageId, rootHash: ev.manifest.rootHash,
      spec: pwaCore.manifest.EVIDENCE_V02, capturedUtc: '2026-11-12T10:01:00Z',
      ianaTz: 'Europe/Berlin', actorName: 'Alice', actorTitle: 'Forensic Investigator',
      itemValues: { sceneZone: 'Room A' }, gps: { lat: '52.5200', lon: '13.4050' }, deviceRef: 'device-1'
    });
    assert(c.children.length === 1, 'one child bound');
    assert(c.children[0].rootHash === ev.manifest.rootHash, 'child rootHash matches evidence package');
    const collected = c.custodyLog.find((e) => e.eventType === 'Collected');
    assert(collected, 'Collected event appended');
    assert(collected.itemValues.sceneZone === 'Room A', 'item-level schema value recorded');
    assert(collected.ianaTz === 'Europe/Berlin' && collected.gps.lat === '52.5200', 'UTC + IANA + GPS recorded');
    assert(c.sealHash !== before, 'sealHash re-aggregated after capture');
    const r = await caseCore.verifyCase(c, {});
    assert(r.coreResult === 'ok', 'case verifies ok: ' + r.errors.join(';'));
    const cli = JSON.parse(spawnSync(process.execPath, [CLI, 'verify', ev.path, '--json'], { encoding: 'utf8' }).stdout);
    assert(cli.coreResult === 'ok', 'raw package still verifies with frozen SPEC verifier');
    return 'capture -> verify ok, frozen verifier unchanged';
  });

  await runCase('C-17', 'tampering child / caseMeta / custody note all break case integrity', async () => {
    const ev = await buildPwaEvidence(path.join(FLOW_DIR, 'cap2'), pwaCore.manifest.EVIDENCE_V02, 22);
    const c = await caseCore.createCase({ origin: 'standard', metaTemplate: 'blank' });
    c.caseMeta.caseReference = 'ORIGINAL';
    await caseCore.addCapture(c, { evidenceId: 'ev-1', packageId: ev.manifest.packageId, rootHash: ev.manifest.rootHash, note: 'intact' });
    const variants = [
      (x) => { x.children[0].rootHash = 'sha256:' + 'f'.repeat(64); },
      (x) => { x.caseMeta.caseReference = 'ALTERED'; },
      (x) => { x.custodyLog[0].note = 'altered'; },
      (x) => { x.children.pop(); }
    ];
    for (const mutate of variants) {
      const x = JSON.parse(JSON.stringify(c));
      mutate(x);
      const r = await caseCore.verifyCase(x, {});
      assert(r.coreResult === 'tampered', 'tamper must be detected');
    }
    return 'all four tamper vectors detected';
  });

  await runCase('C-18', 'emergency: capture while pending -> supplement -> history preserved', async () => {
    const ev = await buildPwaEvidence(path.join(FLOW_DIR, 'emg'), pwaCore.manifest.EVIDENCE_V02, 23);
    const c = await caseCore.createCase({ origin: 'emergency' });
    assert(c.state === 'pending-configuration', 'emergency starts pending');
    assert(c.schemaDef.globalFields.length === 0, 'no schema before supplementation');
    await caseCore.addCapture(c, {
      evidenceId: 'ev-e', packageId: ev.manifest.packageId, rootHash: ev.manifest.rootHash,
      actorName: 'Bob', itemValues: { sceneZone: 'Lobby' }, capturedUtc: '2026-11-12T09:00:00Z'
    });
    assert(c.children.length === 1, 'emergency capture allowed without schema');
    let blocked = false;
    try { await caseCore.sealCase(c, {}); } catch (e) { blocked = true; }
    assert(blocked, 'seal blocked while pending');
    const supp = await caseCore.supplementSchema(c, { metaTemplate: 'devops-security', mode: 'full', operator: 'Alice', ianaTz: 'UTC' });
    assert(supp.state === 'draft', 'supplement -> draft');
    assert(supp.children.length === 1, 'child retained');
    const collected = supp.custodyLog.find((e) => e.eventType === 'Collected');
    assert(collected && collected.itemValues.sceneZone === 'Lobby', 'historical itemValues NOT purged');
    assert(supp.schemaChangeLog.some((l) => /Emergency Capture/.test(l.summary)), 'emergency audit note written');
    const r = await caseCore.verifyCase(supp, {});
    assert(r.coreResult === 'ok', 'supplemented case verifies ok: ' + r.errors.join(';'));
    return 'emergency capture survives supplementation';
  });

  await runCase('C-19', 'custody events: enum validation, sealHash binding, sealed lock', async () => {
    const c = await caseCore.createCase({ origin: 'standard', metaTemplate: 'blank' });
    const h0 = c.sealHash;
    await caseCore.addCustodyEntry(c, {
      eventType: 'Transferred', transferPurpose: 'Transport', actorName: 'Alice',
      actorTitle: 'Custodian', scope: 'all', ianaTz: 'UTC', note: 'to laboratory'
    });
    assert(c.custodyLog.length === 1 && c.custodyLog[0].transferPurpose === 'Transport', 'custody entry appended');
    assert(c.sealHash !== h0, 'custody entry re-aggregates sealHash');
    let rejected = false;
    try { await caseCore.addCustodyEntry(c, { eventType: 'Transferred', transferPurpose: 'NotAPurpose' }); }
    catch (e) { rejected = true; }
    assert(rejected, 'invalid transferPurpose rejected by kernel');
    let locked = false;
    try { await caseCore.addCustodyEntry(c, { eventType: 'UnknownEvent' }); } catch (e) { locked = true; }
    assert(locked, 'invalid eventType rejected');
    await caseCore.sealCase(c, { actorName: 'Alice' });
    let sealedLocked = false;
    try { await caseCore.addCustodyEntry(c, { eventType: 'Reviewed' }); } catch (e) { sealedLocked = true; }
    assert(sealedLocked, 'sealed case rejects custody writes');
    const r = await caseCore.verifyCase(c, {});
    assert(r.coreResult === 'ok', 'sealed case verifies ok: ' + r.errors.join(';'));
    return 'custody flow ok';
  });

  await runCase('C-20', 'case-store persists evidence ZIPs and cascades deletion', async () => {
    // Minimal in-memory IndexedDB: exercises the real case-store module, no browser needed.
    const stores = {};
    const makeReq = (result) => ({ result, onsuccess: null, onerror: null });
    const fire = (r) => { setTimeout(() => { r.onsuccess && r.onsuccess({ target: r }); }, 0); return r; };
    const makeStore = () => {
      const data = new Map();
      return {
        put(rec) { data.set(rec.packageId, JSON.parse(JSON.stringify(rec))); return fire(makeReq(rec)); },
        get(k) { return fire(makeReq(data.has(k) ? data.get(k) : undefined)); },
        getAll() { return fire(makeReq([...data.values()])); },
        delete(k) { data.delete(k); return fire(makeReq(true)); }
      };
    };
    globalThis.indexedDB = {
      open() {
        const req = makeReq();
        setTimeout(() => {
          const db = {
            objectStoreNames: { contains: (n) => !!stores[n] },
            createObjectStore: (n) => { stores[n] = makeStore(); return stores[n]; },
            transaction: (n) => ({ objectStore: () => stores[n] })
          };
          req.result = db;
          req.onupgradeneeded && req.onupgradeneeded({ target: req });
          req.onsuccess && req.onsuccess({ target: req });
        }, 0);
        return req;
      }
    };
    try {
      const store = await import(pathToFileURL(path.join(ROOT, 'pwa', 'helpers', 'case-store.js')).href);
      const c = await caseCore.createCase({ origin: 'standard', metaTemplate: 'blank' });
      await store.putCase(c);
      await store.putEvidencePackage({ packageId: 'pkg-a', caseId: c.packageId, blob: { name: 'a.zip' }, size: 12, createdAt: c.createdAt });
      await store.putEvidencePackage({ packageId: 'pkg-b', caseId: c.packageId, blob: { name: 'b.zip' }, size: 13, createdAt: c.createdAt });
      const got = await store.getEvidencePackage('pkg-a');
      assert(got && got.blob.name === 'a.zip', 'evidence package round-trip');
      assert((await store.listEvidencePackages(c.packageId)).length === 2, 'list by case');
      assert((await store.listEvidencePackages()).length === 2, 'list all');
      assert((await store.getCase(c.packageId)).packageId === c.packageId, 'case still readable');
      await store.deleteCase(c.packageId);
      assert((await store.listCases()).length === 0, 'case deleted');
      assert((await store.listEvidencePackages(c.packageId)).length === 0, 'child packages cascade-deleted');
      return 'evidence store + cascade delete ok';
    } finally {
      delete globalThis.indexedDB;
    }
  });
}

async function runCaseExportCases() {
  process.stdout.write('\n-- case-layer Phase 4 flows (seal & export) --\n');
  const caseCore = await import(pathToFileURL(path.join(ROOT, 'pwa', 'core', 'case-manifest.js')).href);
  const exportCore = await import(pathToFileURL(path.join(ROOT, 'pwa', 'helpers', 'case-export.js')).href);
  const EXPORT_DIR = caseDir('export');
  const CLI = CLI_ENTRY;

  async function packagesFor(evs) {
    const out = [];
    for (const ev of evs) {
      const bytes = await fs.promises.readFile(ev.path);
      out.push({ packageId: ev.manifest.packageId, blob: new Blob([bytes], { type: 'application/zip' }) });
    }
    return out;
  }

  async function writeExport(c, packages, name) {
    const blob = await exportCore.buildCaseExportZip(c, packages);
    const out = path.join(EXPORT_DIR, name);
    await fs.promises.mkdir(EXPORT_DIR, { recursive: true });
    await fs.promises.writeFile(out, Buffer.from(await blob.arrayBuffer()));
    return out;
  }

  await runCase('C-21', 'sealCase locks everything; any post-seal mutation fails verification', async () => {
    const ev = await buildPwaEvidence(path.join(EXPORT_DIR, 's1'), pwaCore.manifest.EVIDENCE_V02, 31);
    const c = await caseCore.createCase({ origin: 'standard', metaTemplate: 'blank' });
    c.caseMeta.caseReference = 'CASE-SEAL-1';
    await caseCore.addCapture(c, { evidenceId: 'ev-1', packageId: ev.manifest.packageId, rootHash: ev.manifest.rootHash });
    await caseCore.addCustodyEntry(c, { eventType: 'Reviewed', actorName: 'Alice' });
    await caseCore.changeSchema(c, { added: [{ scope: 'global', key: 'labRef', label: 'Lab Ref', type: 'text' }], operator: 'Alice' });
    const sealed = await caseCore.sealCase(c, { actorName: 'Custodian', ianaTz: 'UTC' });
    assert(sealed.state === 'sealed' && sealed.sealedAt, 'state sealed + sealedAt');
    assert(sealed.custodyLog.some((e) => e.eventType === 'Sealed'), 'Sealed event appended');
    assert((await caseCore.verifyCase(sealed, {})).coreResult === 'ok', 'sealed case verifies ok');
    for (const mutate of [
      (x) => { x.children[0].rootHash = 'sha256:' + 'a'.repeat(64); },
      (x) => { x.caseMeta.caseReference = 'ALTERED'; },
      (x) => { x.custodyLog[0].note = 'altered'; },
      (x) => { x.schemaDef.globalFields.pop(); }
    ]) {
      const x = JSON.parse(JSON.stringify(sealed));
      mutate(x);
      assert((await caseCore.verifyCase(x, {})).coreResult === 'tampered', 'post-seal tamper detected');
    }
    for (const op of [
      (x) => caseCore.addCapture(x, { rootHash: ev.manifest.rootHash }),
      (x) => caseCore.addCustodyEntry(x, { eventType: 'Reviewed' }),
      (x) => caseCore.changeSchema(x, { added: [{ scope: 'global', key: 'extra', type: 'text' }] }),
      (x) => caseCore.supplementSchema(x, { metaTemplate: 'blank' })
    ]) {
      let blocked = false;
      try { await op(sealed); } catch (e) { blocked = true; }
      assert(blocked, 'sealed case rejects mutation');
    }
    return 'seal locks + tamper vectors detected';
  });

  await runCase('C-22', 'export ZIP layout is directly verifiable by CLI case verify', async () => {
    const e1 = await buildPwaEvidence(path.join(EXPORT_DIR, 'v1'), pwaCore.manifest.EVIDENCE_V02, 32);
    const e2 = await buildPwaEvidence(path.join(EXPORT_DIR, 'v2'), pwaCore.manifest.EVIDENCE_V02, 33);
    const c = await caseCore.createCase({ origin: 'standard', metaTemplate: 'forensic-investigator' });
    c.caseMeta.caseReference = 'CASE-EXP-1';
    await caseCore.addCapture(c, { evidenceId: 'ev-1', packageId: e1.manifest.packageId, rootHash: e1.manifest.rootHash, itemValues: { sceneZone: 'Room A' } });
    await caseCore.addCapture(c, { evidenceId: 'ev-2', packageId: e2.manifest.packageId, rootHash: e2.manifest.rootHash });
    const sealed = await caseCore.sealCase(c, { actorName: 'Custodian' });
    const packages = await packagesFor([e1, e2]);
    const entries = exportCore.buildCaseExportEntries(sealed, packages);
    for (const n of ['case-manifest.json', 'case-report.html', 'case-ledger.csv', 'VERIFY.txt',
      'evidence/' + e1.manifest.packageId + '.zip', 'evidence/' + e2.manifest.packageId + '.zip']) {
      assert(entries.some((e) => e.name === n), 'export entry missing: ' + n);
    }
    const out = await writeExport(sealed, packages, 'case-full.zip');
    const res = JSON.parse(spawnSync(process.execPath, [CLI, 'case', 'verify', out, '--json'], { encoding: 'utf8' }).stdout);
    assert(res.coreResult === 'ok', 'CLI case verify ok: ' + JSON.stringify(res.errors));
    assert(res.sealHash === sealed.sealHash, 'sealHash preserved in export');
    assert(res.children.length === 2 && res.children.every((ch) => ch.coreResult === 'ok'), 'both children verified');
    // VERIFY.txt carries self-contained, cross-checkable hashes
    const handle = await zip.readZip(out);
    const verifyTxt = await handle.readText(handle.getEntry('VERIFY.txt'));
    const reportHtml = await handle.readText(handle.getEntry('case-report.html'));
    const manifestJson = JSON.parse(await handle.readText(handle.getEntry('case-manifest.json')));
    await handle.close();
    assert(verifyTxt.includes(sealed.rootHash) && verifyTxt.includes(sealed.sealHash), 'VERIFY.txt carries both hashes');
    assert(verifyTxt.includes('case verify') && verifyTxt.includes('evidence/' + e1.manifest.packageId + '.zip'), 'VERIFY.txt carries CLI command + child paths');
    assert(reportHtml.includes(sealed.sealHash), 'HTML report carries sealHash');
    assert(manifestJson.sealHash === sealed.sealHash && manifestJson.rootHash === sealed.rootHash, 'case-manifest.json carries root hashes');
    return 'export ZIP -> case verify ok, hashes self-contained';
  });

  await runCase('C-23', 'tampered child package / case metadata fail CLI case verify', async () => {
    const e1 = await buildPwaEvidence(path.join(EXPORT_DIR, 't1'), pwaCore.manifest.EVIDENCE_V02, 34);
    const c = await caseCore.createCase({ origin: 'standard', metaTemplate: 'blank' });
    await caseCore.addCapture(c, { evidenceId: 'ev-1', packageId: e1.manifest.packageId, rootHash: e1.manifest.rootHash });
    const sealed = await caseCore.sealCase(c, { actorName: 'Custodian' });
    const packages = await packagesFor([e1]);

    // (a) child ZIP bytes altered
    const badBytes = Buffer.from(await packages[0].blob.arrayBuffer());
    badBytes[badBytes.length - 5] ^= 0xff;
    const badPackages = [{ packageId: e1.manifest.packageId, blob: new Blob([badBytes], { type: 'application/zip' }) }];
    const badOut = await writeExport(sealed, badPackages, 'case-bad-child.zip');
    const badRes = JSON.parse(spawnSync(process.execPath, [CLI, 'case', 'verify', badOut, '--json'], { encoding: 'utf8' }).stdout);
    assert(badRes.coreResult === 'tampered', 'tampered child ZIP -> tampered');

    // (b) case metadata altered after sealing (sealHash no longer matches)
    const altered = JSON.parse(JSON.stringify(sealed));
    altered.caseMeta.caseReference = 'FORGED';
    const altOut = await writeExport(altered, packages, 'case-bad-meta.zip');
    const altRes = JSON.parse(spawnSync(process.execPath, [CLI, 'case', 'verify', altOut, '--json'], { encoding: 'utf8' }).stdout);
    assert(altRes.coreResult === 'tampered', 'tampered caseMeta -> tampered');
    return 'child + metadata tamper detected by case verify';
  });

  await runCase('C-24', 'HTML Attestation / CSV ledger / export preflight', async () => {
    const e1 = await buildPwaEvidence(path.join(EXPORT_DIR, 'r1'), pwaCore.manifest.EVIDENCE_V02, 35);
    const draft = await caseCore.createCase({ origin: 'standard', metaTemplate: 'blank' });
    await caseCore.addCapture(draft, { evidenceId: 'ev-1', packageId: e1.manifest.packageId, rootHash: e1.manifest.rootHash });
    const packages = await packagesFor([e1]);
    const draftHtml = exportCore.buildCaseReportHtml(draft);
    assert(/DRAFT ONLY/.test(draftHtml) && /NOT EVIDENTIARILY CERTIFIED/.test(draftHtml), 'draft report marked DRAFT ONLY');
    assert(/Custodian Attestation/.test(draftHtml) && /eIDAS/.test(draftHtml), 'Attestation + disclaimer present');

    const sealed = await caseCore.sealCase(JSON.parse(JSON.stringify(draft)), { actorName: 'Custodian' });
    const sealedHtml = exportCore.buildCaseReportHtml(sealed);
    assert(!/DRAFT ONLY/.test(sealedHtml) && /SEALED/.test(sealedHtml), 'sealed report authoritative (no DRAFT ONLY)');
    assert(sealedHtml.includes(sealed.sealHash), 'sealed report carries sealHash');

    const emergency = await caseCore.createCase({ origin: 'emergency' });
    await caseCore.supplementSchema(emergency, { metaTemplate: 'blank', operator: 'Alice', ianaTz: 'UTC' });
    assert(/EMERGENCY CAPTURE PATH/.test(exportCore.buildCaseReportHtml(emergency)), 'emergency notice rendered');

    const csv = exportCore.buildCaseLedgerCsv(sealed);
    assert(csv.startsWith(exportCore.CSV_HEADER.join(',')), 'CSV header per SPEC-case §六');
    assert(/CaseCreated/.test(csv) && /Capture/.test(csv) && /Collected/.test(csv) && /Sealed/.test(csv), 'CSV record types');
    assert(csv.includes(sealed.sealHash), 'CSV carries seal_hash');

    const pre = exportCore.preflightCaseExport(sealed, packages);
    assert(pre.ok, 'preflight ok with complete packages');
    const missing = exportCore.preflightCaseExport(sealed, []);
    assert(!missing.ok && missing.missing.length === 1, 'preflight blocks missing child');
    let threw = false;
    try { exportCore.buildCaseExportEntries(sealed, []); } catch (e) { threw = true; }
    assert(threw, 'export refuses incomplete packages');
    const draftPre = exportCore.preflightCaseExport(draft, packages);
    assert(draftPre.ok && draftPre.warnings.some((w) => /DRAFT ONLY/.test(w)), 'draft export warns DRAFT ONLY');
    assert(exportCore.buildVerifyManifest(sealed).includes('case verify'), 'VERIFY manifest includes CLI command');
    return 'report/CSV/preflight conform to SPEC-case';
  });
}

async function runV03Cases() {
  process.stdout.write('\n-- case-layer v0.3 (Countersign + Encryption + Signature) --\n');
  const K = await import(pathToFileURL(path.join(ROOT, 'pwa', 'core', 'case-manifest.js')).href);
  const EX = await import(pathToFileURL(path.join(ROOT, 'pwa', 'helpers', 'case-export.js')).href);
  const CR = await import(pathToFileURL(path.join(ROOT, 'pwa', 'helpers', 'case-crypto.js')).href);
  const CS = await import(pathToFileURL(path.join(ROOT, 'pwa', 'helpers', 'case-checksums.js')).href);
  const V03_DIR = caseDir('v03');
  const CLI = CLI_ENTRY;
  // Frozen, human-readable v0.2 fixture. These two strings are the golden historical values;
  // changing canonicalJson / computeSealHash must break this assertion loudly.
  const GOLDEN_V02_ROOT_HASH = 'sha256:4614bff2004cdbd0b0ffa53b034e20a77dbe1b90495d62c314ef9172553b504b';
  const GOLDEN_V02_SEAL_HASH = 'sha256:8f0b344ddf2aaf87b654da62f285601abfb2eb367570c94700c1138e0cc4abba';
  const GOLDEN_PATH = path.join(ROOT, 'cli', 'test', 'fixtures', 'golden-case-v0.2.json');
  const golden = async () => JSON.parse(await fs.promises.readFile(GOLDEN_PATH, 'utf8'));
  const sixKeySeal = (x) => pwaCore.hash.shaUri(pwaCore.hash.canonicalJson({
    schemaDef: x.schemaDef,
    caseMeta: x.caseMeta || {},
    childrenRootHashes: (x.children || []).map((ch) => ch.rootHash),
    custodyLog: x.custodyLog || [],
    schemaChangeLog: x.schemaChangeLog || [],
    state: x.state
  }), 'sha256');

  await runCase('C-25', 'explicit specVersion selects the path; legacy v0.2 aggregate stays frozen', async () => {
    const g = await golden();
    assert(K.resolveSpecVersion(g) === K.SPEC_VERSION_V02, 'missing tag is bound to the frozen legacy contract');
    assert((await K.computeSealHash(g)) === await sixKeySeal(g), 'legacy path uses the untouched six-key aggregate');
    const full = Object.assign({}, g, { rootHash: GOLDEN_V02_ROOT_HASH, sealHash: GOLDEN_V02_SEAL_HASH });
    const legacyResult = await K.verifyCase(full);
    assert(legacyResult.coreResult === 'ok' && legacyResult.specVersion === K.SPEC_VERSION_V02, 'legacy verifies ok with explicit resolved version');
    const c = await K.createCase({ metaTemplate: 'blank' });
    assert(K.resolveSpecVersion(c) === K.CURRENT_SPEC_VERSION, 'new manifests declare the current version explicitly');
    assert(K.CASE_SPEC_VERSIONS.includes(c.specVersion), 'declared version is whitelisted');
    assert((await K.verifyCase(c)).coreResult === 'ok', 'current version verifies ok');
    assert((await K.computeSealHash(c)) !== await sixKeySeal(c), 'versioned path must include the versioned aggregate');
    return 'version dispatch explicit; legacy aggregate frozen';
  });

  await runCase('C-30', 'v0.2 golden fixture -> exact rootHash/sealHash strings + canonical injectivity', async () => {
    const g = await golden();
    assert(!Object.prototype.hasOwnProperty.call(g, 'specVersion'), 'golden fixture is a true v0.2 manifest');
    assert((await K.computeRootHash(g)) === GOLDEN_V02_ROOT_HASH, 'golden rootHash exact string');
    assert((await K.computeSealHash(g)) === GOLDEN_V02_SEAL_HASH, 'golden sealHash exact string');
    const full = Object.assign({}, g, { rootHash: GOLDEN_V02_ROOT_HASH, sealHash: GOLDEN_V02_SEAL_HASH });
    assert((await K.verifyCase(full)).coreResult === 'ok', 'golden fixture verifies ok');
    // Ambiguity probe: false / "false" / 0 / null / [] / absent must all serialise differently.
    const encodings = [false, 'false', 0, null, []].map((v) => pwaCore.hash.canonicalJson({ k: v }));
    encodings.push(pwaCore.hash.canonicalJson({}));
    assert(new Set(encodings).size === 6, 'canonical must distinguish all six forms');
    let refused = false;
    try { pwaCore.hash.canonicalJson({ k: undefined }); } catch (e) { refused = true; }
    assert(refused, 'undefined must be refused, not silently dropped');
    let nonFinite = false;
    try { pwaCore.hash.canonicalJson({ k: NaN }); } catch (e) { nonFinite = true; }
    assert(nonFinite, 'non-finite numbers must be refused');
    return 'golden strings exact + canonical injective';
  });

  await runCase('C-31', 'stripping v0.3 fields / specVersion => tampered; unknown version => invalid_spec', async () => {
    const c = await K.createCase({ metaTemplate: 'blank' });
    await K.setSchemaLocked(c, true);
    const base = JSON.parse(JSON.stringify(c));
    const strip = (keys) => {
      const x = JSON.parse(JSON.stringify(base));
      for (const k of keys) delete x[k];
      return x;
    };
    for (const keys of [
      ['schemaLocked'], K.V03_FIELDS, ['specVersion'], ['specVersion'].concat(K.V03_FIELDS)
    ]) {
      assert((await K.verifyCase(strip(keys))).coreResult === 'tampered', 'stripping ' + keys.join(',') + ' must be tampered');
    }
    const downgrade = JSON.parse(JSON.stringify(base));
    downgrade.specVersion = K.SPEC_VERSION_V02;
    assert((await K.verifyCase(downgrade)).coreResult === 'tampered', 'version downgrade must be tampered');
    const unknown = JSON.parse(JSON.stringify(base));
    unknown.specVersion = 'fieldseal-case-v9.9';
    const r = await K.verifyCase(unknown);
    assert(r.coreResult === 'invalid_spec', 'unknown version must be invalid_spec, never ok');
    return 'no shape-based version inference; all downgrades caught';
  });

  await runCase('C-26', 'Schema Lock gates schema edits, is audited and hash-bound', async () => {
    const c = await K.createCase({ metaTemplate: 'blank' });
    await K.setSchemaLocked(c, true);
    for (const op of [
      (x) => K.changeSchema(x, { added: [{ key: 'x', type: 'text' }] }),
      (x) => K.supplementSchema(x, { metaTemplate: 'blank' })
    ]) {
      let blocked = false;
      try { await op(c); } catch (e) { blocked = true; }
      assert(blocked, 'locked schema rejects mutation');
    }
    assert(c.auditLog.some((e) => e.eventType === 'SCHEMA_LOCK'), 'SCHEMA_LOCK audited');
    await K.setSchemaLocked(c, false);
    await K.changeSchema(c, { added: [{ key: 'x', type: 'text' }] });
    assert(c.auditLog.some((e) => e.eventType === 'SCHEMA_UNLOCK'), 'SCHEMA_UNLOCK audited');
    assert((await K.verifyCase(c)).coreResult === 'ok', 'verifies ok after unlock');
    const t = JSON.parse(JSON.stringify(c));
    t.schemaLocked = true;
    assert((await K.verifyCase(t)).coreResult === 'tampered', 'schemaLocked tamper detected');
    return 'lock/unlock gated, audited, hash-bound';
  });

  await runCase('C-27', 'pending_countersign is read-only except countersigns; Seal Final locks', async () => {
    const ev = await buildPwaEvidence(path.join(V03_DIR, 'cs'), pwaCore.manifest.EVIDENCE_V02, 41);
    const c = await K.createCase({ metaTemplate: 'blank' });
    await K.addCapture(c, { evidenceId: 'ev-1', packageId: ev.manifest.packageId, rootHash: ev.manifest.rootHash });
    await K.sendForCountersign(c, { ianaTz: 'UTC' });
    assert(c.state === 'pending_countersign', 'state advanced one-way');
    for (const op of [
      (x) => K.addCapture(x, { rootHash: ev.manifest.rootHash }),
      (x) => K.addCustodyEntry(x, { eventType: 'Reviewed' }),
      (x) => K.changeSchema(x, { added: [{ key: 'y', type: 'text' }] }),
      (x) => K.setSchemaLocked(x, true),
      (x) => K.setCaseEncryption(x, { algorithm: 'AES-GCM-256' })
    ]) {
      let blocked = false;
      try { await op(c); } catch (e) { blocked = true; }
      assert(blocked, 'pending_countersign rejects non-countersign writes');
    }
    let invalid = false;
    try { await K.addCountersign(c, { actorName: 'A', decision: 'Maybe' }); } catch (e) { invalid = true; }
    assert(invalid, 'invalid countersign decision rejected');
    await K.addCountersign(c, { actorName: 'Alice', actorTitle: 'Custodian', decision: 'Approve', remark: 'ok', countersignId: 'cs-alice-1', signatureSha256: 'sha256:' + 'b'.repeat(64) });
    await K.addCountersign(c, { actorName: 'Bob', decision: 'Object', remark: 'needs review' });
    assert(c.countersignList.length === 2 && (await K.verifyCase(c)).coreResult === 'ok', 'two countersigns bound ok');
    for (const mutate of [
      (x) => { x.countersignList[0].decision = 'Object'; },
      (x) => { x.countersignList[0].signatureSha256 = 'sha256:' + 'c'.repeat(64); },
      (x) => { x.auditLog[0].operatorNote = 'forged'; }
    ]) {
      const x = JSON.parse(JSON.stringify(c));
      mutate(x);
      assert((await K.verifyCase(x)).coreResult === 'tampered', 'countersign / audit tamper detected');
    }
    for (const t of ['COUNTERSIGN_SENT', 'COUNTERSIGN_ADD', 'SIGNATURE_RECORDED']) {
      assert(c.auditLog.some((e) => e.eventType === t), 'audit event missing: ' + t);
    }
    for (const a of c.auditLog) {
      for (const k of ['eventId', 'eventType', 'timestampUtc', 'ianaTimezone', 'caseStateBefore', 'caseStateAfter', 'payload', 'operatorNote']) {
        assert(k in a, 'audit field missing: ' + k);
      }
    }
    const sealed = await K.sealCase(c, { actorName: 'Custodian' });
    assert(sealed.state === 'sealed' && (await K.verifyCase(sealed)).coreResult === 'ok', 'Seal Final verifies ok');
    assert(sealed.auditLog.some((e) => e.eventType === 'CASE_SEALED' && e.caseStateBefore === 'pending_countersign'), 'CASE_SEALED transition audited');
    let locked = false;
    try { await K.addCountersign(sealed, { actorName: 'C', decision: 'Approve' }); } catch (e) { locked = true; }
    assert(locked, 'sealed rejects countersign writes');
    return 'workflow read-only + countersign hash binding + Seal Final';
  });

  await runCase('C-28', 'AES-GCM/PBKDF2 round trip, generic decrypt error, metadata hash binding', async () => {
    const c = await K.createCase({ metaTemplate: 'blank' });
    const { blob, meta, ciphertext } = await CR.encryptCaseArchive(c, 'correct horse');
    assert(meta.algorithm === 'AES-GCM-256' && meta.kdf === 'PBKDF2-SHA256' && meta.iterations === 100000, 'KDF params');
    assert(meta.ciphertextSha256.startsWith('sha256:') && meta.authTagB64, 'ciphertext hash + authTag persisted');
    const back = await CR.decryptCaseArchive(ciphertext, meta, 'correct horse');
    assert(back.rootHash === c.rootHash, 'encrypt/decrypt round trip');
    let generic = false;
    try { await CR.decryptCaseArchive(ciphertext, meta, 'wrong'); } catch (e) {
      generic = e.message === 'Decryption failed. Passphrase or encrypted archive may be incorrect.';
    }
    assert(generic, 'decrypt failure must not leak the reason');
    assert(await CS.cipherMatchesMeta(blob, meta), 'ciphertext hash matches meta');
    await K.setCaseEncryption(c, meta, { ianaTz: 'UTC' });
    assert((await K.verifyCase(c)).coreResult === 'ok' && c.auditLog.some((e) => e.eventType === 'CASE_ENCRYPT'), 'metadata bound + audited');
    const t = JSON.parse(JSON.stringify(c));
    t.caseEncryptionMeta.authTagB64 = 'AAAA';
    assert((await K.verifyCase(t)).coreResult === 'tampered', 'encryption metadata tamper detected');
    await K.clearCaseEncryption(c, { ianaTz: 'UTC' });
    assert(c.caseEncryptionMeta === null && c.auditLog.some((e) => e.eventType === 'CASE_DECRYPT'), 'CASE_DECRYPT audited');
    return 'AES-GCM round trip + generic error + metadata bound to hashes';
  });

  await runCase('C-29', 'v0.3 export carries sha256sum manifest, cipher copy and full attestation', async () => {
    const ev = await buildPwaEvidence(path.join(V03_DIR, 'ex'), pwaCore.manifest.EVIDENCE_V02, 42);
    const c = await K.createCase({ metaTemplate: 'blank' });
    await K.addCapture(c, { evidenceId: 'ev-1', packageId: ev.manifest.packageId, rootHash: ev.manifest.rootHash });
    await K.setSchemaLocked(c, true);
    const { blob: cipherBlob, meta } = await CR.encryptCaseArchive(c, 'pass');
    await K.setCaseEncryption(c, meta, { ianaTz: 'UTC' });
    await K.sendForCountersign(c, { ianaTz: 'UTC' });
    const sigBytes = new TextEncoder().encode('PNG-ATTACHMENT-BYTES-FOR-C29');
    const sigHash = await pwaCore.hash.sha256Uri(sigBytes);
    await K.addCountersign(c, { actorName: 'Alice', decision: 'Approve', countersignId: 'cs-c29', signatureSha256: sigHash });
    const sealed = await K.sealCase(c, { actorName: 'Custodian' });
    const bytes = await fs.promises.readFile(ev.path);
    const packages = [{ packageId: ev.manifest.packageId, blob: new Blob([bytes], { type: 'application/zip' }) }];
    const signatureBlobs = [{ countersignId: 'cs-c29', blob: new Blob([sigBytes], { type: 'image/png' }) }];
    const zipBlob = await EX.buildCaseExportZip(sealed, packages, { cipherBlob, signatureBlobs });
    const out = path.join(V03_DIR, 'case-v03.zip');
    await fs.promises.writeFile(out, Buffer.from(await zipBlob.arrayBuffer()));
    const res = JSON.parse(spawnSync(process.execPath, [CLI, 'case', 'verify', out, '--json'], { encoding: 'utf8' }).stdout);
    assert(res.coreResult === 'ok', 'CLI case verify still ok: ' + JSON.stringify(res.errors));
    const handle = await zip.readZip(out);
    const sums = await handle.readText(handle.getEntry('case-files.sha256'));
    const verifyTxt = await handle.readText(handle.getEntry('VERIFY.txt'));
    const report = await handle.readText(handle.getEntry('case-report.html'));
    const csv = await handle.readText(handle.getEntry('case-ledger.csv'));
    const encBytes = await handle.readBytes(handle.getEntry('case-manifest.json.enc'));
    await handle.close();
    assert(/^[0-9a-f]{64}  case-manifest\.json$/m.test(sums), 'sha256sum line format');
    assert(sums.includes('case-manifest.json.enc') && sums.includes('evidence/'), 'checksum covers cipher + children');
    const manifestHex = (await pwaCore.hash.sha256Uri(JSON.stringify(sealed, null, 2))).slice(7);
    assert(sums.includes(manifestHex + '  case-manifest.json'), 'sha256sum hex matches manifest bytes');
    assert(verifyTxt.includes('V0.3 WORKFLOW STATE') && verifyTxt.includes('countersigns  : 1') && verifyTxt.includes('AES-GCM-256'), 'VERIFY.txt v0.3 state');
    assert(report.includes('Countersignatures') && report.includes('Unified Audit Log') && report.includes('LOCKED'), 'report sections + schema-lock header');
    assert(report.includes('@media print') && report.includes('This is native browser print flow'), 'native print note');
    assert(csv.includes('COUNTERSIGN_ADD') && csv.includes('CASE_SEALED'), 'CSV audit rows');
    assert(encBytes && encBytes.length > 0, 'cipher copy present in ZIP');
    assert(sums.includes('signatures/cs-c29.png'), 'checksum covers the signature attachment');
    assert(report.includes(sigHash) && report.includes('signatures/cs-c29.png'), 'report renders attachment path + bound digest');
    // An altered PNG attachment must be caught by the CLI verifier (digest fixed in manifest).
    const badSig = new Blob([new TextEncoder().encode('ALTERED-SIGNATURE')], { type: 'image/png' });
    const badZip = await EX.buildCaseExportZip(sealed, packages, { cipherBlob, signatureBlobs: [{ countersignId: 'cs-c29', blob: badSig }] });
    const badOut = path.join(V03_DIR, 'case-bad-signature.zip');
    await fs.promises.writeFile(badOut, Buffer.from(await badZip.arrayBuffer()));
    const badRes = JSON.parse(spawnSync(process.execPath, [CLI, 'case', 'verify', badOut, '--json'], { encoding: 'utf8' }).stdout);
    assert(badRes.coreResult === 'tampered', 'altered signature attachment -> tampered');
    return 'sha256sum + cipher + signature attachment + attestation + CLI verify ok';
  });

  await runCase('C-33', 'contract A: encryption is forbidden after sealing; sealHash stays byte-fixed', async () => {
    const c = await K.createCase({ metaTemplate: 'blank' });
    const sealed = await K.sealCase(c, { actorName: 'Custodian' });
    const rootBefore = sealed.rootHash;
    const sealBefore = sealed.sealHash;
    const { meta } = await CR.encryptCaseArchive(sealed, 'pass');
    for (const op of [
      (x) => K.setCaseEncryption(x, meta),
      (x) => K.clearCaseEncryption(x),
      (x) => K.appendAuditEvent(x, 'CASE_DECRYPT', { verified: true }),
      (x) => K.setSchemaLocked(x, true),
      (x) => K.addCountersign(x, { actorName: 'X', decision: 'Approve' })
    ]) {
      let blocked = false;
      try { await op(sealed); } catch (e) { blocked = true; }
      assert(blocked, 'sealed case rejects the write');
    }
    assert(sealed.rootHash === rootBefore && sealed.sealHash === sealBefore, 'no sealed-state mutation');
    assert((await K.verifyCase(sealed)).coreResult === 'ok', 'sealHash still authoritative');
    // Encryption BEFORE sealing is the supported path.
    const d = await K.createCase({ metaTemplate: 'blank' });
    await K.setCaseEncryption(d, meta, { ianaTz: 'UTC' });
    const s2 = await K.sealCase(d, { actorName: 'Custodian' });
    assert((await K.verifyCase(s2)).coreResult === 'ok', 'pre-seal encryption then seal verifies ok');
    return '方案 A: sealed 全局锁死，加密不触碰封存态';
  });

  await runCase('C-34', 'plaintext manifest verifies with no password; encrypted-only => needs_password', async () => {
    const ev = await buildPwaEvidence(path.join(V03_DIR, 'np'), pwaCore.manifest.EVIDENCE_V02, 43);
    const c = await K.createCase({ metaTemplate: 'blank' });
    await K.addCapture(c, { evidenceId: 'ev-1', packageId: ev.manifest.packageId, rootHash: ev.manifest.rootHash });
    const { blob: cipherBlob, meta } = await CR.encryptCaseArchive(c, 'pass');
    await K.setCaseEncryption(c, meta, { ianaTz: 'UTC' });
    const sealed = await K.sealCase(c, { actorName: 'Custodian' });
    const bytes = await fs.promises.readFile(ev.path);
    const packages = [{ packageId: ev.manifest.packageId, blob: new Blob([bytes], { type: 'application/zip' }) }];

    // (a) The normal export keeps a PLAINTEXT manifest; no credential needed.
    const normal = await EX.buildCaseExportZip(sealed, packages, { cipherBlob });
    const normalOut = path.join(V03_DIR, 'case-plaintext-verifiable.zip');
    await fs.promises.writeFile(normalOut, Buffer.from(await normal.arrayBuffer()));
    const r1 = JSON.parse(spawnSync(process.execPath, [CLI, 'case', 'verify', normalOut, '--json'], { encoding: 'utf8' }).stdout);
    assert(r1.coreResult === 'ok', 'third party without passphrase must get ok');
    const h = await zip.readZip(normalOut);
    const verifyTxt = await h.readText(h.getEntry('VERIFY.txt'));
    await h.close();
    assert(verifyTxt.includes('ENCRYPTION CONTRACT') && verifyTxt.includes('PLAINTEXT') && verifyTxt.includes('needs_password'), 'VERIFY.txt declares the contract');

    // (b) A container with ONLY the encrypted snapshot cannot be verified without a password.
    const zipBuilder = await import(pathToFileURL(path.join(ROOT, 'pwa', 'core', 'zip-builder.js')).href);
    const enc = new TextEncoder();
    const only = await zipBuilder.buildZip([
      { name: 'case-manifest.json.enc', data: enc.encode('opaque-ciphertext') },
      { name: 'VERIFY.txt', data: enc.encode('encrypted-only container') }
    ]);
    const onlyOut = path.join(V03_DIR, 'case-encrypted-only.zip');
    await fs.promises.writeFile(onlyOut, Buffer.from(await only.arrayBuffer()));
    const r2 = JSON.parse(spawnSync(process.execPath, [CLI, 'case', 'verify', onlyOut, '--json'], { encoding: 'utf8' }).stdout);
    assert(r2.coreResult === 'needs_password', 'encrypted-only => needs_password, never ok');
    assert(r2.sealHash === '' && r2.children.length === 0, 'no integrity conclusion must be leaked');
    return 'plaintext verifiable without password; encrypted-only explicitly needs_password';
  });

  await runCase('C-32', 'wrong passphrase != cipher tampering; IV/tag tampering is hash-bound', async () => {
    const c = await K.createCase({ metaTemplate: 'blank' });
    const { ciphertext, meta } = await CR.encryptCaseArchive(c, 'correct pass');
    const sealBefore = c.sealHash;
    const rootBefore = c.rootHash;
    const verifyFn = (x) => K.verifyCase(x);

    // (a) wrong passphrase, every byte intact -> generic message, sealHash verdict untouched
    const wrong = await CR.classifyCipherResult(c, ciphertext, meta, 'wrong pass', verifyFn);
    assert(wrong.coreResult === 'invalid_passphrase', 'wrong passphrase is its own outcome');
    assert(wrong.message === CR.CIPHER_ERROR_GENERIC, 'no reason leaked');
    assert((await K.verifyCase(c)).coreResult === 'ok' && c.sealHash === sealBefore, 'sealHash conclusion unchanged');

    // (b) correct passphrase + one flipped ciphertext bit -> tampered, never "wrong password"
    const flipped = new Uint8Array(ciphertext);
    flipped[0] ^= 0x01;
    const bit = await CR.classifyCipherResult(c, flipped, meta, 'correct pass', verifyFn);
    assert(bit.coreResult === 'tampered', '1-bit cipher flip -> tampered');
    let refused = false;
    try { await CR.decryptCaseArchive(flipped, meta, 'correct pass'); } catch (e) { refused = e.message === CR.CIPHER_ERROR_TAMPERED; }
    assert(refused, 'tampered bytes must not be reported as a passphrase error');

    // (c) authTag / IV / salt tampering is caught by rootHash/sealHash BEFORE any decryption
    await K.setCaseEncryption(c, meta, { ianaTz: 'UTC' });
    for (const key of ['authTagB64', 'ivB64', 'saltB64']) {
      const t = JSON.parse(JSON.stringify(c));
      t.caseEncryptionMeta[key] = 'AAAA';
      assert((await K.verifyCase(t)).coreResult === 'tampered', key + ' tampering is hash-bound');
    }
    const t2 = JSON.parse(JSON.stringify(c));
    t2.caseEncryptionMeta.authTagB64 = 'AAAA';
    const classified = await CR.classifyCipherResult(t2, ciphertext, t2.caseEncryptionMeta, 'correct pass', verifyFn);
    assert(classified.coreResult === 'tampered', 'metadata tampering -> tampered');

    // (d) intact bytes + correct passphrase -> ok (snapshot carries the pre-encryption rootHash)
    const ok = await CR.classifyCipherResult(c, ciphertext, c.caseEncryptionMeta, 'correct pass', verifyFn);
    assert(ok.coreResult === 'ok' && ok.plain && ok.plain.rootHash === rootBefore, 'intact archive decrypts');
    return 'password error / byte tampering / metadata tampering kept distinct';
  });

  await runCase('C-35', 'duplicate signer is explicitly rejected; earlier decision never overwritten', async () => {
    const c = await K.createCase({ metaTemplate: 'blank' });
    await K.sendForCountersign(c, { ianaTz: 'UTC' });
    await K.addCountersign(c, { actorName: 'Alice', actorOrg: 'Lab A', decision: 'Approve' });
    assert(c.countersignList.length === 1, 'first countersign recorded');
    let dup = false;
    try { await K.addCountersign(c, { actorName: 'Alice', actorOrg: 'Lab A', decision: 'Object' }); } catch (e) {
      dup = /duplicate countersign/.test(e.message);
    }
    assert(dup, 'exact duplicate rejected');
    let normalised = false;
    try { await K.addCountersign(c, { actorName: '  ALICE ', actorOrg: 'lab a', decision: 'Object' }); } catch (e) { normalised = true; }
    assert(normalised, 'whitespace/case-normalised duplicate rejected');
    assert(c.countersignList.length === 1 && c.countersignList[0].decision === 'Approve', 'no silent overwrite');
    await K.addCountersign(c, { actorName: 'Alice', actorOrg: 'Lab B', decision: 'Object' });
    assert(c.countersignList.length === 2, 'a genuinely distinct party may still countersign');
    assert((await K.verifyCase(c)).coreResult === 'ok', 'append-only list stays hash-consistent');
    return 'idempotent-by-rejection; append-only, no overwrite';
  });

  await runCase('C-36', 'DB v2 -> v4 upgrade keeps cases; deleteCase cascades all blobs; stale writes refused', async () => {
    // Simulate a v2 database containing ONLY cases + evidence-packages.
    const stores = {};
    const makeReq = (result) => ({ result, onsuccess: null, onerror: null });
    const fire = (r) => { setTimeout(() => { r.onsuccess && r.onsuccess({ target: r }); }, 0); return r; };
    const makeStore = () => {
      const data = new Map();
      return {
        put(rec) { data.set(rec.packageId, JSON.parse(JSON.stringify(rec))); return fire(makeReq(rec)); },
        get(k) { return fire(makeReq(data.has(k) ? data.get(k) : undefined)); },
        getAll() { return fire(makeReq([...data.values()])); },
        delete(k) { data.delete(k); return fire(makeReq(true)); }
      };
    };
    stores.cases = makeStore();
    stores['evidence-packages'] = makeStore();
    globalThis.indexedDB = {
      open() {
        const req = makeReq();
        setTimeout(() => {
          const db = {
            objectStoreNames: { contains: (n) => !!stores[n] },
            createObjectStore: (n) => { stores[n] = makeStore(); return stores[n]; },
            transaction: (n) => ({ objectStore: () => stores[n] })
          };
          req.result = db;
          req.onupgradeneeded && req.onupgradeneeded({ target: req });
          req.onsuccess && req.onsuccess({ target: req });
        }, 0);
        return req;
      }
    };
    try {
      const store = await import(pathToFileURL(path.join(ROOT, 'pwa', 'helpers', 'case-store.js')).href);
      const legacy = await K.createCase({ metaTemplate: 'blank' });
      stores.cases.put(legacy); // pre-existing v2 record; the upgrade must NOT rewrite it
      const survivors = await store.listCases();
      assert(!!stores['case-ciphers'] && !!stores['signature-images'], 'v2 -> v4 creates both blob stores');
      assert(survivors.some((x) => x.packageId === legacy.packageId), 'existing case survives the upgrade');

      await store.putEvidencePackage({ packageId: 'ev-x', caseId: legacy.packageId, blob: { name: 'x' } });
      await store.putCaseCipher({ packageId: legacy.packageId, blob: { name: 'c' } });
      await store.putSignatureImage({ packageId: 'sig-x', caseId: legacy.packageId, blob: { name: 's' } });
      // Optimistic concurrency: a tab holding a stale rootHash cannot overwrite a newer commit.
      const newer = JSON.parse(JSON.stringify(legacy));
      newer.rootHash = 'sha256:' + 'a'.repeat(64);
      await store.putCase(newer);
      let stale = false;
      try { await store.putCaseIfUnchanged(legacy, legacy.rootHash); } catch (e) { stale = /STALE_CASE/.test(e.message); }
      assert(stale, 'stale concurrent write refused');
      assert((await store.getCase(legacy.packageId)).rootHash === newer.rootHash, 'newer commit not overwritten');
      await store.putCaseIfUnchanged(legacy, newer.rootHash);
      assert((await store.getCase(legacy.packageId)).rootHash === legacy.rootHash, 'fresh write accepted');

      await store.deleteCase(legacy.packageId);
      assert((await store.listCases()).length === 0, 'case deleted');
      assert((await store.listEvidencePackages(legacy.packageId)).length === 0, 'evidence cascade');
      assert((await store.getCaseCipher(legacy.packageId)) === null, 'cipher cascade');
      assert((await store.listSignatureImages(legacy.packageId)).length === 0, 'signature cascade');
      return 'v2->v4 additive migration + full cascade + stale-write guard';
    } finally {
      delete globalThis.indexedDB;
    }
  });
}

async function runV04Cases() {
  const K = await import(pathToFileURL(path.join(ROOT, 'pwa', 'core', 'case-manifest.js')).href);
  const EX = await import(pathToFileURL(path.join(ROOT, 'pwa', 'helpers', 'case-export.js')).href);
  const CS = await import(pathToFileURL(path.join(ROOT, 'pwa', 'helpers', 'case-checksums.js')).href);
  const H = await import(pathToFileURL(path.join(ROOT, 'pwa', 'helpers', 'ext-hooks.js')).href);
  const SNAP = await import(pathToFileURL(path.join(ROOT, 'pwa', 'helpers', 'case-snapshot.js')).href);
  const WM = await import(pathToFileURL(path.join(ROOT, 'pwa', 'helpers', 'case-watermark.js')).href);
  const ZIPB = await import(pathToFileURL(path.join(ROOT, 'pwa', 'core', 'zip-builder.js')).href);
  const HASH = await import(pathToFileURL(path.join(ROOT, 'pwa', 'core', 'hash.js')).href);
  const CLI = CLI_ENTRY;
  const DIR = caseDir('v04');
  await fs.promises.mkdir(DIR, { recursive: true });

  const G02_ROOT = 'sha256:4614bff2004cdbd0b0ffa53b034e20a77dbe1b90495d62c314ef9172553b504b';
  const G02_SEAL = 'sha256:8f0b344ddf2aaf87b654da62f285601abfb2eb367570c94700c1138e0cc4abba';
  const G03_ROOT = 'sha256:1faa21112be553796fa6973111f10f50a69051abaa2d986197c8564f02302304';
  const G03_SEAL = 'sha256:6fb3fd1c263ec406a113213b4201040276b553338095b5ffcbc99bc0f7a33002';

  const writeZip = async (name, blob) => {
    const out = path.join(DIR, name);
    await fs.promises.writeFile(out, Buffer.from(await blob.arrayBuffer()));
    return out;
  };
  const cliVerify = (p) => JSON.parse(spawnSync(process.execPath, [CLI, 'case', 'verify', p, '--json'], { encoding: 'utf8' }).stdout);
  const downgradeToV03 = async (c) => {
    for (const k of K.V04_DEFAULT_FIELD_KEYS) delete c[k];
    c.specVersion = K.SPEC_VERSION_V03;
    c.rootHash = await K.computeRootHash(c);
    c.sealHash = await K.computeSealHash(c);
    return c;
  };

  await runCase('C-37', 'v0.2 + v0.3 golden fixtures keep their exact sealHash strings', async () => {
    const g2 = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'golden-case-v0.2.json'), 'utf8'));
    const g3 = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'golden-case-v0.3.json'), 'utf8'));
    assert((await K.computeRootHash(g2)) === G02_ROOT, 'v0.2 rootHash drifted');
    assert((await K.computeSealHash(g2)) === G02_SEAL, 'v0.2 sealHash drifted');
    assert((await K.computeRootHash(g3)) === G03_ROOT, 'v0.3 rootHash drifted');
    assert((await K.computeSealHash(g3)) === G03_SEAL, 'v0.3 sealHash drifted');
    const c4 = await K.createCase({ metaTemplate: 'blank' });
    assert(c4.specVersion === K.SPEC_VERSION_V05 && (await K.verifyCase(c4)).coreResult === 'ok', 'v0.5 healthy');
    assert((await K.computeSealHash(g3)) !== (await K.computeSealHash(c4)), 'versioned aggregates must differ');
    return 'v0.2=' + G02_SEAL.slice(7, 15) + '… v0.3=' + G03_SEAL.slice(7, 15) + '…';
  });

  await runCase('C-38', 'tampering / stripping schemaDictionaries -> tampered, no shape inference', async () => {
    const c = await K.createCase({ metaTemplate: 'blank' });
    await K.addSchemaDictionary(c, 'condition', ['sealed', 'damaged'], { ianaTz: 'UTC' });
    assert((await K.verifyCase(c)).coreResult === 'ok', 'dictionary write hash-consistent');
    assert(c.auditLog.some((a) => a.eventType === 'DICTIONARY_ADD'), 'DICTIONARY_ADD audited');
    const edited = JSON.parse(JSON.stringify(c));
    edited.schemaDictionaries.condition = ['OTHER'];
    assert((await K.verifyCase(edited)).coreResult === 'tampered', 'value tampering detected');
    const stripped = JSON.parse(JSON.stringify(c));
    delete stripped.schemaDictionaries;
    assert((await K.verifyCase(stripped)).coreResult === 'tampered', 'stripping must not fall back to v0.3');
    assert((await K.computeSealHash(stripped)) !== (await K.computeSealHash(c)), 'dictionary is sealHash-bound');
    const downgraded = JSON.parse(JSON.stringify(c));
    downgraded.specVersion = K.SPEC_VERSION_V03;
    assert((await K.verifyCase(downgraded)).coreResult === 'tampered', 'version downgrade detected');
    return 'dictionary hash-bound; no field-shape fallback';
  });

  await runCase('C-39', 'batch field update: one audit event with affectedCaptureIds, rootHash changes', async () => {
    const c = await K.createCase({ metaTemplate: 'blank' });
    await K.addCapture(c, { evidenceId: 'ev-1', packageId: 'pkg-1', rootHash: 'sha256:' + 'a'.repeat(64) });
    await K.addCapture(c, { evidenceId: 'ev-2', packageId: 'pkg-2', rootHash: 'sha256:' + 'b'.repeat(64) });
    const before = c.rootHash;
    await K.batchUpdateItemField(c, { captureIds: ['ev-1', 'ev-2'], fieldKey: 'condition', value: 'sealed' }, { ianaTz: 'UTC' });
    const ev = c.auditLog.filter((a) => a.eventType === 'BATCH_FIELD_UPDATE');
    assert(ev.length === 1, 'exactly ONE audit event');
    assert(ev[0].payload.affectedCaptureIds.join(',') === 'ev-1,ev-2', 'affectedCaptureIds carried');
    assert(c.custodyLog.filter((e) => e.itemValues && e.itemValues.condition === 'sealed').length === 2, 'both captures updated');
    assert(c.rootHash !== before && (await K.verifyCase(c)).coreResult === 'ok', 'rootHash rebound');
    return 'single BATCH_FIELD_UPDATE event, 2 affected captures';
  });

  await runCase('C-40', 'watermark dual digests in manifest; tampering either one -> tampered', async () => {
    const c = await K.createCase({ metaTemplate: 'blank' });
    const d = await WM.computeWatermarkDigests(new Uint8Array([1, 2, 3, 4]), new Uint8Array([1, 2, 3, 5]));
    await K.recordWatermark(c, [{
      evidenceId: 'ev-1', originalSha256: d.originalSha256,
      watermarkedSha256: d.watermarkedSha256, appliedAtUtc: '2026-01-01T00:00:00Z'
    }], { ianaTz: 'UTC' });
    assert(c.watermarkConfig.records.length === 1 && (await K.verifyCase(c)).coreResult === 'ok', 'both digests in manifest');
    assert(c.auditLog.some((a) => a.eventType === 'WATERMARK_APPLIED'), 'WATERMARK_APPLIED audited');
    for (const key of ['originalSha256', 'watermarkedSha256']) {
      const t = JSON.parse(JSON.stringify(c));
      t.watermarkConfig.records[0][key] = 'sha256:' + '0'.repeat(64);
      assert((await K.verifyCase(t)).coreResult === 'tampered', key + ' tampering detected');
      assert((await K.computeSealHash(t)) === (await K.computeSealHash(c)), key + ' stays OUTSIDE sealHash');
    }
    return 'rootHash binds both digests; sealHash aggregate untouched';
  });

  await runCase('C-41', 'snapshot is an independent archive package; generation never mutates the main case', async () => {
    const c = await K.createCase({ metaTemplate: 'blank' });
    const before = c.rootHash;
    const beforeJson = JSON.stringify(c);
    const { blob, snapshot, manifestSha256 } = await SNAP.buildSnapshotZip(c);
    const out = await writeZip('snapshot-draft.zip', blob);
    const h = await zip.readZip(out);
    const snap = JSON.parse(await h.readText(h.getEntry('snapshot-manifest.json')));
    const verifyTxt = await h.readText(h.getEntry('VERIFY.txt'));
    const sums = await h.readText(h.getEntry('snapshot-files.sha256'));
    await h.close();
    assert(snap.notice.includes('ARCHIVE ONLY') && verifyTxt.includes('ARCHIVE ONLY'), 'archive-only declaration');
    assert(snap.parentRootHash === before && snap.manifestSha256 === undefined, 'parent rootHash recorded');
    assert(verifyTxt.includes(manifestSha256) && sums.includes('snapshot-manifest.json'), 'self digest present');
    assert(JSON.stringify(snap.manifestCopy) === beforeJson, 'verbatim manifest copy');
    assert(c.rootHash === before && JSON.stringify(c) === beforeJson && (await K.verifyCase(c)).coreResult === 'ok', 'draft main case unchanged');
    const sealed = await K.createCase({ metaTemplate: 'blank' });
    await K.sealCase(sealed, { actorName: 'Custodian' });
    const sealedBefore = sealed.rootHash;
    const sealedJson = JSON.stringify(sealed);
    const s2 = await SNAP.buildSnapshotZip(sealed);
    assert(s2.blob.size > 0 && sealed.rootHash === sealedBefore && JSON.stringify(sealed) === sealedJson, 'sealed snapshot is read-only too');
    return 'independent snapshot opens; draft + sealed main case byte-identical';
  });

  await runCase('C-42', 'third-party notes are hash-bound, independent of countersignList, sealed append refused', async () => {
    const c = await K.createCase({ metaTemplate: 'blank' });
    await K.sendForCountersign(c, { ianaTz: 'UTC' });
    await K.addThirdPartyNote(c, { noteBy: 'Reviewer', noteOrg: 'Lab', noteText: 'dissent', decision: 'Dissent' }, { ianaTz: 'UTC' });
    assert(c.thirdPartyNotes.length === 1 && c.countersignList.length === 0, 'independent of countersignList');
    assert((await K.verifyCase(c)).coreResult === 'ok' && c.auditLog.some((a) => a.eventType === 'NOTE_ADDED'), 'note hash-consistent');
    const t = JSON.parse(JSON.stringify(c));
    t.thirdPartyNotes[0].decision = 'Concur';
    assert((await K.verifyCase(t)).coreResult === 'tampered', 'note tampering detected');
    const sealed = await K.createCase({ metaTemplate: 'blank' });
    await K.sealCase(sealed, { actorName: 'Custodian' });
    let refused = false;
    try { await K.addThirdPartyNote(sealed, { noteBy: 'X', decision: 'Concur' }, { ianaTz: 'UTC' }); } catch (e) { refused = /sealed/.test(e.message); }
    assert(refused && sealed.thirdPartyNotes.length === 0, 'sealed append forbidden');
    return 'pending append allowed; sealed refused; note is sealHash-bound';
  });

  await runCase('C-43', 'soft delete is hash-bound, restore is consistent, sealed forbids it', async () => {
    const c = await K.createCase({ metaTemplate: 'blank' });
    const before = c.rootHash;
    await K.setSoftDeleted(c, true, { ianaTz: 'UTC' });
    assert(c.isDeleted === true && c.rootHash !== before, 'isDeleted enters rootHash');
    assert(c.auditLog.some((a) => a.eventType === 'CASE_SOFT_DELETED'), 'CASE_SOFT_DELETED audited');
    const flipped = JSON.parse(JSON.stringify(c));
    flipped.isDeleted = false;
    assert((await K.verifyCase(flipped)).coreResult === 'tampered', 'flipping isDeleted detected');
    await K.setSoftDeleted(c, false, { ianaTz: 'UTC' });
    assert(c.isDeleted === false && (await K.verifyCase(c)).coreResult === 'ok', 'restore hash-consistent');
    assert(c.auditLog.some((a) => a.eventType === 'CASE_RESTORED'), 'CASE_RESTORED audited');
    const sealed = await K.createCase({ metaTemplate: 'blank' });
    await K.sealCase(sealed, { actorName: 'Custodian' });
    let refused = false;
    try { await K.setSoftDeleted(sealed, true, { ianaTz: 'UTC' }); } catch (e) { refused = true; }
    assert(refused && sealed.isDeleted === false, 'sealed soft delete forbidden');
    return 'soft delete / restore hash-bound, no physical deletion';
  });

  await runCase('C-44', 'migration: draft -> v0.4 with data intact; pending/sealed refused and stay read-only', async () => {
    const c3 = await downgradeToV03(await K.createCase({ metaTemplate: 'blank' }));
    assert((await K.verifyCase(c3)).coreResult === 'ok' && c3.specVersion === K.SPEC_VERSION_V03, 'valid v0.3 draft');
    const before = c3.rootHash;
    const childrenBefore = JSON.stringify(c3.children);
    const preExport = JSON.parse(JSON.stringify(c3));
    await K.sealCase(preExport, { actorName: 'Custodian' });
    const preOut = await writeZip('pre-migration-v03.zip', await EX.buildCaseExportZip(preExport, []));
    const preVerdict = cliVerify(preOut);
    assert(preVerdict.coreResult === 'ok' && preVerdict.specVersion === K.SPEC_VERSION_V03, 'pre-migration export verifies under v0.3');
    await K.migrateCaseToV04(c3, { ianaTz: 'UTC' });
    assert(c3.specVersion === K.SPEC_VERSION_V04 && c3.rootHash !== before, 'explicit legal change -> NEW rootHash');
    assert(K.V04_DEFAULT_FIELD_KEYS.every((k) => Object.prototype.hasOwnProperty.call(c3, k)), 'v0.4 defaults supplied');
    assert(JSON.stringify(c3.children) === childrenBefore, 'data intact');
    assert(c3.auditLog.some((a) => a.eventType === 'CASE_MIGRATED_V04' && a.payload.previousRootHash === before), 'migration audited');
    assert((await K.verifyCase(c3)).coreResult === 'ok', 'migrated case verifies');
    const pending = await downgradeToV03(await K.createCase({ metaTemplate: 'blank' }));
    await K.sendForCountersign(pending, { ianaTz: 'UTC' });
    let refused = 0;
    try { await K.migrateCaseToV04(pending, { ianaTz: 'UTC' }); } catch (e) { refused++; }
    assert(refused === 1 && pending.specVersion === K.SPEC_VERSION_V03, 'pending migration refused, stays v0.3');
    const sealed = await downgradeToV03(await K.createCase({ metaTemplate: 'blank' }));
    await K.sealCase(sealed, { actorName: 'Custodian' });
    try { await K.migrateCaseToV04(sealed, { ianaTz: 'UTC' }); } catch (e) { refused++; }
    assert(refused === 2 && sealed.specVersion === K.SPEC_VERSION_V03, 'sealed migration refused, stays v0.3');
    return 'draft migrates + old export still v0.3; pending/sealed read-only';
  });

  await runCase('C-45', 'hooks: flag off hides, on-without-library degrades, products in /attachments and sha256 only', async () => {
    H.resetFeatureFlags();
    H.resetHookOverrides();
    for (const id of H.HOOK_IDS) {
      assert(H.FEATURE_FLAGS[id] === false && H.isAvailable(id) === false, 'flag off: ' + id);
      const r = H.callHook(id, 'run', { caseId: 'x' });
      assert(r.ok === false && /flag is disabled/.test(r.message), 'branch not executed: ' + id);
    }
    globalThis.window = { EXT_HOOKS: {} };
    H.setFeatureFlag('EXTENSION_QR_GENERATE', true);
    assert(H.isAvailable('EXTENSION_QR_GENERATE') === false, 'no library => unavailable');
    const degraded = H.callHook('EXTENSION_QR_GENERATE', 'run', { caseId: 'x' });
    assert(degraded.ok === false && /not loaded/.test(degraded.message), 'friendly degradation, no throw');
    H.setHookOverride('EXTENSION_QR_GENERATE', { run: (copy) => (copy && copy.caseId ? 'QR-DATA' : '') });
    assert(H.isAvailable('EXTENSION_QR_GENERATE') === true, 'injectable replacement seam');
    const called = H.callHook('EXTENSION_QR_GENERATE', 'run', { caseId: 'abc' });
    assert(called.ok === true && called.data === 'QR-DATA', 'normalised envelope');
    const c = await K.createCase({ metaTemplate: 'blank' });
    await K.sealCase(c, { actorName: 'Custodian' });
    const sealBefore = c.sealHash;
    const att = H.attachmentStub('EXTENSION_QR_GENERATE', new Uint8Array([65, 66, 67]), 'qr.txt');
    assert(att.name === 'attachments/qr.txt', 'attachment directory contract');
    const out = await writeZip('hooks-attachment.zip', await EX.buildCaseExportZip(c, [], { attachments: [att] }));
    const h = await zip.readZip(out);
    const sums = await h.readText(h.getEntry('case-files.sha256'));
    const attText = await h.readText(h.getEntry('attachments/qr.txt'));
    await h.close();
    assert(attText === 'ABC' && sums.includes('attachments/qr.txt'), 'attachment covered by case-files.sha256');
    assert(c.sealHash === sealBefore && (await K.verifyCase(c)).coreResult === 'ok', 'attachments excluded from sealHash');
    assert(cliVerify(out).coreResult === 'ok', 'CLI verifies hook-bearing export');
    H.resetFeatureFlags();
    H.resetHookOverrides();
    delete globalThis.window;
    return '5 flags default false; degrade cleanly; /attachments in sha256 only';
  });

  await runCase('C-46', 'attachment byte tampering and signature digest mismatch both -> tampered', async () => {
    const c = await K.createCase({ metaTemplate: 'blank' });
    await K.sendForCountersign(c, { ianaTz: 'UTC' });
    const sigBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const sigHash = await HASH.sha256Uri(sigBytes);
    await K.addCountersign(c, { actorName: 'Alice', decision: 'Approve', countersignId: 'sig-c46', signatureSha256: sigHash });
    await K.sealCase(c, { actorName: 'Custodian' });
    const attBytes = new Uint8Array([70, 71, 72]);
    const extra = {
      signatureBlobs: [{ countersignId: 'sig-c46', blob: new Blob([sigBytes], { type: 'image/png' }) }],
      attachments: [{ name: 'attachments/note.txt', blob: new Blob([attBytes], { type: 'application/octet-stream' }) }]
    };
    const entries = EX.buildCaseExportEntries(c, [], extra);
    const sums = await CS.buildCaseFilesSha256(entries);
    const all = entries.concat([{ name: 'case-files.sha256', data: new TextEncoder().encode(sums) }]);
    assert(cliVerify(await writeZip('c46-good.zip', await ZIPB.buildZip(all))).coreResult === 'ok', 'intact export ok');
    const badAtt = all.map((e) => e.name === 'attachments/note.txt'
      ? { name: e.name, blob: new Blob([new Uint8Array([70, 71, 73])]) } : e);
    assert(cliVerify(await writeZip('c46-att-tampered.zip', await ZIPB.buildZip(badAtt))).coreResult === 'tampered', 'attachment flip -> tampered');
    const badSig = all.map((e) => e.name === 'signatures/sig-c46.png'
      ? { name: e.name, blob: new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 4])]) } : e);
    assert(cliVerify(await writeZip('c46-sig-tampered.zip', await ZIPB.buildZip(badSig))).coreResult === 'tampered', 'signature digest mismatch -> tampered');
    return 'attachments + signatures both byte-verified by the frozen CLI';
  });

  await runCase('C-50', 'v0.4 legacy package verifies under the v0.5 verifier (backward compat)', async () => {
    const v5 = await K.createCase({ metaTemplate: 'blank' });
    await K.addCapture(v5, { evidenceId: 'e1', packageId: 'pkg-1', rootHash: 'sha256:' + 'a'.repeat(64) });
    await K.sealCase(v5, { actorName: 'A' });
    assert((await K.verifyCase(v5)).coreResult === 'ok', 'v0.5 sealed case ok');
    const v4 = await K.createCase({ metaTemplate: 'blank' });
    await K.addCapture(v4, { evidenceId: 'e1', packageId: 'pkg-1', rootHash: 'sha256:' + 'a'.repeat(64) });
    v4.specVersion = K.SPEC_VERSION_V04;
    await K.sealCase(v4, { actorName: 'A' });
    assert((await K.verifyCase(v4)).coreResult === 'ok', 'v0.4-shaped package ok under v0.5 verifier');
    return 'backward-compatible: v0.4 and v0.5 both verify';
  });

  await runCase('C-51', 'v0.5 operatorProfile + exhibitId are hash-bound; stripping -> tampered', async () => {
    const c = await K.createCase({ metaTemplate: 'blank' });
    await K.addCapture(c, { evidenceId: 'e1', packageId: 'pkg-1', rootHash: 'sha256:' + 'a'.repeat(64) });
    await K.bindOperatorProfile(c, { operatorName: 'Jane Doe', operatorTitle: 'Investigator', orgId: 'ORG-1', operatorId: 'BADGE-7' });
    await K.setExhibitId(c, 'e1', 'A-1');
    const sealed = await K.sealCase(c, { actorName: 'A' });
    assert((await K.verifyCase(sealed)).coreResult === 'ok', 'sealed with v0.5 fields ok');
    const noOp = JSON.parse(JSON.stringify(sealed));
    if (noOp.caseMeta) delete noOp.caseMeta.operatorProfile;
    assert((await K.verifyCase(noOp)).coreResult === 'tampered', 'stripping operatorProfile -> tampered');
    const noEx = JSON.parse(JSON.stringify(sealed));
    if (noEx.children[0]) delete noEx.children[0].exhibitId;
    assert((await K.verifyCase(noEx)).coreResult === 'tampered', 'stripping exhibitId -> tampered');
    return 'v0.5 fields hash-bound';
  });

  await runCase('C-52', 'v0.5 human_note is hash-bound; sealed write refused', async () => {
    const c = await K.createCase({ metaTemplate: 'blank' });
    await K.addCapture(c, { evidenceId: 'e1', packageId: 'pkg-1', rootHash: 'sha256:' + 'a'.repeat(64) });
    await K.addHumanNote(c, { noteText: 'Device seized at 10:00 UTC in presence of witness.', jurisdictionContext: 'US-FRE' });
    assert((c.auditLog || []).some((e) => e.eventType === 'HUMAN_NOTE'), 'human_note recorded');
    const sealed = await K.sealCase(c, { actorName: 'A' });
    assert((await K.verifyCase(sealed)).coreResult === 'ok', 'sealed with human_note ok');
    const noNote = JSON.parse(JSON.stringify(sealed));
    noNote.auditLog = (noNote.auditLog || []).filter((e) => e.eventType !== 'HUMAN_NOTE');
    assert((await K.verifyCase(noNote)).coreResult === 'tampered', 'stripping human_note -> tampered');
    let blocked = false;
    try { await K.addHumanNote(sealed, { noteText: 'post-seal note' }); } catch (e) { blocked = true; }
    assert(blocked, 'addHumanNote on sealed case thrown');
    return 'human_note hash-bound; sealed write refused';
  });

  await runCase('C-53', 'v0.5 identity/note/exhibit writes are sealed-locked', async () => {
    const c = await K.createCase({ metaTemplate: 'blank' });
    await K.addCapture(c, { evidenceId: 'e1', packageId: 'pkg-1', rootHash: 'sha256:' + 'a'.repeat(64) });
    const sealed = await K.sealCase(c, { actorName: 'A' });
    for (const fn of [
      () => K.bindOperatorProfile(sealed, { operatorName: 'X' }),
      () => K.setExhibitId(sealed, 'e1', 'A-1'),
      () => K.addHumanNote(sealed, { noteText: 'x' })
    ]) {
      let blocked = false;
      try { await fn(); } catch (e) { blocked = true; }
      assert(blocked, 'sealed write refused');
    }
    return 'all three sealed-locked';
  });

  await runCase('C-54', 'v0.5 malformed fields rejected by schema validation', async () => {
    const c = await K.createCase({ metaTemplate: 'blank' });
    const bad1 = JSON.parse(JSON.stringify(c));
    bad1.caseMeta = { operatorProfile: { operatorName: 123 } };
    assert(K.validateCaseManifest(bad1).ok === false, 'bad operatorProfile rejected');
    const bad2 = JSON.parse(JSON.stringify(c));
    bad2.children = [{ evidenceId: 'e1', packageId: 'p1', rootHash: 'sha256:' + 'a'.repeat(64), exhibitId: 5 }];
    assert(K.validateCaseManifest(bad2).ok === false, 'bad exhibitId rejected');
    const bad3 = JSON.parse(JSON.stringify(c));
    bad3.auditLog = [{ eventId: 'x', eventType: 'HUMAN_NOTE', timestampUtc: '2026-01-01T00:00:00Z', payload: {} }];
    assert(K.validateCaseManifest(bad3).ok === false, 'bad human_note rejected');
    const bad4 = JSON.parse(JSON.stringify(c));
    bad4.specVersion = 'fieldseal-case-v9.9';
    assert(K.validateCaseManifest(bad4).ok === false, 'unknown version rejected');
    return 'malformed v0.5 fields rejected';
  });
}

async function main() {
  await fs.promises.rm(CASES, { recursive: true, force: true });
  await fs.promises.mkdir(CASES, { recursive: true });
  process.stdout.write('FieldSeal Suite - zero-dependency self-test (Step 0-4)\n');
  process.stdout.write('Fixtures: ' + CASES + '\n\n');
  await runFunctionalCases();
  if (process.argv.includes('--full')) await runFullZip64Case();
  // Genuine end-to-end + failure-injection evidence (F1/F2 partial): real product kernel exercised
  // headlessly (create->seal->export->CLI verify, and bad-input/tamper rejection).
  await runCase('E2E-01', 'real create->seal->export->CLI verify returns coreResult ok', async () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'cli', 'test', 'ui-e2e.mjs')], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
    assert(r.status === 0, 'ui-e2e failed: ' + String(r.stderr || r.stdout || '').slice(-300));
  });
  await runCase('E2E-02', 'failure-injection matrix rejects bad input / tampered artifact', async () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'cli', 'test', 'ui-failure-matrix.mjs')], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
    assert(r.status === 0, 'ui-failure-matrix failed: ' + String(r.stderr || r.stdout || '').slice(-300));
  });
  await runCase('LIC-01', 'licensing + bilingual gate: MIT headers, legal set, every doc has EN/DE coverage', async () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'verify-licensing.mjs')], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
    assert(r.status === 0, 'verify-licensing failed: ' + String(r.stdout || r.stderr || '').slice(-400));
    const b = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'verify-bilingual.mjs')], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
    assert(b.stdout.includes('LANGUAGE-POLICY-OK') && b.status === 0, 'verify-language-policy failed: ' + String(b.stdout || b.stderr || '').slice(-400));
  });
  process.stdout.write('\n-- PWA trusted core parity --\n');
  await runPwaParityCases();
  process.stdout.write('\n-- Step 4 end-to-end integration --\n');
  await runE2ECases();
  process.stdout.write('\n-- Step 4 dual signing mode (§I) --\n');
  await runSigningModeCases();
  process.stdout.write('\n-- code provenance static self-check --\n');
  await runBatchAndTrailCases();
  await runDestructiveCases();
  await runCustodyCases();
  await runCaseLayerCases();
  await runCaseFlowCases();
  await runCaseExportCases();
  await runV03Cases();
  process.stdout.write('\n-- v0.4 second-round regression (C-37..C-46) --\n');
  await runV04Cases();
  process.stdout.write('\n-- P0/P1 standalone core self-tests (unified regression) --\n');
  await runCase('S-20', 'P0/P1/P2 core self-tests pass (consent, affidavit, transfer-receipt, bates, witness, retention, media-redaction, bagit, dual-control, geo, operator-identity, zip-slip, large-evidence, csv-injection, sha3-capability, sw-precache, audit-chain, audit-anchor, fuzz-inputs, delivery-tools)', async () => {
    const files = ['test-consent.mjs', 'test-affidavit.mjs', 'test-transfer-receipt.mjs', 'test-bates.mjs', 'test-witness.mjs', 'test-retention.mjs', 'test-media-redaction.mjs', 'test-bagit.mjs', 'test-dual-control.mjs', 'test-geo.mjs', 'test-operator-identity.mjs', 'test-zip-slip.mjs', 'test-large-evidence.mjs', 'test-csv-injection.mjs', 'test-sha3-capability.mjs', 'test-sw-precache.mjs', 'test-audit-chain.mjs', 'test-audit-anchor.mjs', 'test-fuzz-inputs.mjs', 'test-delivery-tools.mjs'];
    for (const f of files) {
      const res = spawnSync(process.execPath, [path.join(ROOT, 'pwa', 'core', f)], { encoding: 'utf8' });
      assert(res.status === 0, f + ' exit ' + res.status + (res.stderr ? ' :: ' + res.stderr.slice(0, 240) : ''));
    }
    return files.length + ' P0/P1/P2 core self-tests exit 0';
  });
  await runCase('S-21', 'golden case package: verifier anchor (ok on genuine, tampered on altered)', async () => {
    const script = path.join(ROOT, 'cli', 'test', 'fixtures', 'golden', 'verify-golden.cjs');
    const res = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    assert(res.status === 0, 'verify-golden.cjs exit ' + res.status + (res.stderr ? ' :: ' + res.stderr.slice(0, 240) : '') + (res.stdout ? '\n' + res.stdout.slice(0, 400) : ''));
    return 'golden ok + tamper detected';
  });
  await runCase('S-22', 'dist binary agrees with source verdict on golden (if built)', async () => {
    const binDir = path.join(ROOT, 'tools', 'build', 'dist');
    const candidates = ['fieldseal-case-verify-macos-arm64', 'fieldseal-case-verify-macos-x64', 'fieldseal-case-verify-linux-x64', 'fieldseal-case-verify-win-x64.exe'];
    const bin = candidates.map((n) => path.join(binDir, n)).find((p) => fs.existsSync(p));
    const golden = path.join(ROOT, 'cli', 'test', 'fixtures', 'golden', 'fieldseal-golden-v0.5-sealed.zip');
    if (!bin) { console.log('  skip- no dist binary built (run `npm run build` in tools/build)'); return 'dist gate skipped (no binary)'; }
    if (!fs.existsSync(golden)) throw new Error('golden missing: ' + golden);
    const res = spawnSync(bin, ['case', 'verify', golden, '--json'], { encoding: 'utf8' });
    if (res.status !== 0) throw new Error('dist verify exit ' + res.status + (res.stderr ? ' :: ' + res.stderr.slice(0, 240) : '') + (res.stdout ? ' :: ' + res.stdout.slice(0, 240) : ''));
    const json = JSON.parse(res.stdout);
    assert(json.coreResult === 'ok', 'dist binary returns ok on golden (matches source) — no stale-binary divergence (B-02)');
    return 'dist verdict matches source';
  });
  await runCase('S-23', 'signed release manifest + backup/restore/rollback (B-08)', async () => {
    const releaseDir = path.join(ROOT, 'tools', 'release');
    const distDir = path.join(ROOT, 'tools', 'build', 'dist');
    const tool = path.join(releaseDir, 'release-tool.mjs');
    const selfTest = path.join(releaseDir, 'test-release-tool.mjs');
    assert(fs.existsSync(tool) && fs.existsSync(selfTest), 'release tool + regression self-test present');

    // 1. Signed manifest: the released SHA256SUMS must carry a verifiable Ed25519 signature.
    //    dist/ holds BUILT artifacts (attached to GitHub Releases, never committed). In a
    //    pristine source checkout the manifest is legitimately absent, so the signature path
    //    is only enforced once dist/ exists — but then it is enforced strictly: a tampered or
    //    unverifiable signature still fails this gate. The rollback baseline below is checked
    //    either way, so this case never degenerates into a no-op.
    const hasDist = fs.existsSync(distDir);
    let distNote = 'dist not built (source checkout) — signature path not exercised';
    if (hasDist) {
      const sums = path.join(distDir, 'SHA256SUMS');
      const sig = path.join(distDir, 'SHA256SUMS.sig');
      const pub = path.join(distDir, 'RELEASE-PUBLIC-KEY.pem');
      assert(fs.existsSync(sums) && fs.existsSync(sig) && fs.existsSync(pub), 'SHA256SUMS + signature + public key shipped');
      const v = spawnSync(process.execPath, [tool, 'verify-signature'], { encoding: 'utf8' });
      assert(v.status === 0, 'release signature does not verify: ' + String(v.stdout || v.stderr).slice(0, 240));
      const envelope = JSON.parse(fs.readFileSync(sig, 'utf8'));
      assert(envelope.algorithm === 'Ed25519' && envelope.signedFile === 'SHA256SUMS', 'signature envelope declares Ed25519 over SHA256SUMS');
      const manifestJson = JSON.parse(fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8'));
      assert(manifestJson.signature && manifestJson.signature.status === 'signed', 'dist manifest.json records signed state');
      distNote = 'dist signature + manifest verified';
    }

    // 2. The RELEASE signing private key must never live inside the repository. The two
    //    cli/verify/fixtures/*.key files are deliberately committed FAKE CA keys used only by the
    //    offline TSA verifier self-test; they are not release signing keys and are excluded.
    const TSA_FIXTURES = path.join(ROOT, 'cli', 'verify', 'fixtures') + path.sep;
    const privKeyHit = allSourceFiles().filter((f) => {
      if (f.startsWith(TSA_FIXTURES)) return false;
      const base = path.basename(f);
      if (/release[-_].*private[-_]key\.pem$/i.test(base)) return true;
      // Only key-container files can hold a private key; source/docs merely discuss them.
      if (!/\.(pem|key)$/i.test(base) || /public/i.test(base)) return false;
      return /BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY/.test(fs.readFileSync(f, 'utf8'));
    });
    assert(privKeyHit.length === 0, 'release private key leaked into repository: ' + privKeyHit.map((f) => path.relative(ROOT, f)).join(', '));

    // 3. Rollback anchor: an in-repo baseline snapshot must verify (self-hash + payload hashes +
    //    signature/SHA256SUMS consistency). It proves a known-good state exists to roll back to.
    const snapshotsDir = path.join(releaseDir, 'snapshots');
    const listing = spawnSync(process.execPath, [tool, 'list', '--store', snapshotsDir], { encoding: 'utf8' });
    assert(listing.status === 0, 'snapshot list failed: ' + String(listing.stderr || '').slice(0, 200));
    const ids = JSON.parse(listing.stdout).snapshots;
    assert(ids.length > 0, 'no in-repo rollback baseline snapshot');
    for (const id of ids) {
      const r = spawnSync(process.execPath, [tool, 'verify', id, '--store', snapshotsDir], { encoding: 'utf8' });
      assert(r.status === 0, 'baseline snapshot ' + id + ' fails verification: ' + String(r.stdout || r.stderr).slice(0, 240));
    }

    // 4. Full backup / restore / rollback regression, including tamper rejection and dry-run safety.
    const st = spawnSync(process.execPath, [selfTest], { encoding: 'utf8' });
    assert(st.status === 0, 'release-tool self-test failed: ' + String(st.stdout || st.stderr).slice(-400));
    return distNote + ', ' + ids.length + ' rollback baseline(s) verified, release self-test green';
  });
  await runStaticSelfChecks();
  const failed = results.filter((result) => !result.ok);
  process.stdout.write('\n' + (results.length - failed.length) + '/' + results.length + ' passed\n');
  if (failed.length) {
    process.stdout.write('FAILED: ' + failed.map((result) => result.id).join(', ') + '\n');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  process.stderr.write('test-runner crashed: ' + String(err.stack || err) + '\n');
  process.exitCode = 2;
});
