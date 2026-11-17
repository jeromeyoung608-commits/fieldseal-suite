/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Case snapshot (§.4): an INDEPENDENT export package containing a verbatim copy of the
// manifest at that moment plus its own digest. Generation is a pure read: it NEVER writes any
// field of the main case (draft, pending_countersign or sealed), so rootHash / sealHash stay
// byte-identical. Only an explicit, separate `recordSnapshot()` core call may register the
// snapshot metadata in a draft case.
// SNAPSHOT FOR ARCHIVE ONLY. A snapshot is NOT an authoritative trust source and MUST NOT be
// used as a substitute for `node cli/bin/audit.js case verify <main-case.zip> --json`.

import { buildZip } from '../core/zip-builder.js';
import { isoUtcNow, uuidV4, sha256Uri } from '../core/hash.js';
import { buildCaseFilesSha256 } from './case-checksums.js';

export const SNAPSHOT_SPEC = 'fieldseal-case-snapshot-v0.4';
export const SNAPSHOT_CHECKSUM_FILE = 'snapshot-files.sha256';
export const SNAPSHOT_NOTICE =
 'SNAPSHOT FOR ARCHIVE ONLY - not an authoritative trust source; never a substitute for the main case verify. ' +
 'case verify';

export function buildSnapshotManifest(c, opts = {}) {
 const manifestCopy = JSON.parse(JSON.stringify(c));
 return {
 snapshotSpec: SNAPSHOT_SPEC,
 snapshotId: opts.snapshotId || uuidV4(),
 createdAtUtc: opts.createdAtUtc || isoUtcNow(),
 parentCaseId: c.packageId,
 parentRootHash: c.rootHash,
 parentSpecVersion: c.specVersion || 'fieldseal-case-v0.2 (legacy, undeclared)',
 parentState: c.state,
 notice: SNAPSHOT_NOTICE,
 manifestCopy
 };
}

function verifyText(snap, manifestSha256) {
 return [
 'FIELDSEAL SUITE - CASE SNAPSHOT (ARCHIVE ONLY)',
 'snapshot spec : ' + SNAPSHOT_SPEC,
 'snapshotId : ' + snap.snapshotId,
 'created UTC : ' + snap.createdAtUtc,
 'parent caseId : ' + snap.parentCaseId,
 'parent rootHash : ' + snap.parentRootHash,
 'parent specVersion : ' + snap.parentSpecVersion,
 'parent state : ' + snap.parentState,
 'snapshot-manifest.json : ' + manifestSha256,
 '',
 SNAPSHOT_NOTICE,
 'To verify the authoritative case, unpack the MAIN case export and run:',
 ' node cli/bin/audit.js case verify <main-case.zip> --json',
 ' sha256sum -c snapshot-files.sha256 (file-level integrity of this snapshot)',
 '',
 'Generating this snapshot did NOT modify the main case. Snapshot metadata may be registered',
 'in a draft case only through the separate core function recordSnapshot().'
 ].join('\n') + '\n';
}

export async function buildSnapshotEntries(c, opts = {}) {
 const snap = buildSnapshotManifest(c, opts);
 const enc = new TextEncoder();
 const manifestBytes = enc.encode(JSON.stringify(snap, null, 2));
 const manifestSha256 = await sha256Uri(manifestBytes);
 const entries = [
 { name: 'snapshot-manifest.json', data: manifestBytes },
 { name: 'VERIFY.txt', data: enc.encode(verifyText(snap, manifestSha256)) }
 ];
 const sums = await buildCaseFilesSha256(entries);
 entries.push({ name: SNAPSHOT_CHECKSUM_FILE, data: enc.encode(sums) });
 return { snapshot: snap, entries, manifestSha256 };
}

export async function buildSnapshotZip(c, opts = {}) {
 const { snapshot, entries, manifestSha256 } = await buildSnapshotEntries(c, opts);
 const blob = await buildZip(entries);
 return { snapshot, blob, manifestSha256, fileName: 'snapshot-' + snapshot.snapshotId.slice(0, 8) + '.zip' };
}
