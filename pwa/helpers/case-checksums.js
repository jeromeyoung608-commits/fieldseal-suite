/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
import { sha256Hex } from '../core/hash.js';

export const CHECKSUM_FILE = 'case-files.sha256';
// Output is `sha256sum -c` compatible (one `<hex> <name>` line per exported file).

async function entryBytes(entry) {
 if (entry.blob) return new Uint8Array(await entry.blob.arrayBuffer());
 if (typeof entry.data === 'string') return new TextEncoder().encode(entry.data);
 if (entry.data instanceof Uint8Array) return entry.data;
 if (entry.data instanceof ArrayBuffer) return new Uint8Array(entry.data);
 throw new TypeError('unsupported checksum entry: ' + entry.name);
}

/** Build the checksum text for all export entries except the checksum file itself. */
export async function buildCaseFilesSha256(entries) {
 const lines = [];
 for (const entry of entries || []) {
 if (entry.name === CHECKSUM_FILE || !entry.name) continue;
 lines.push((await sha256Hex(await entryBytes(entry))) + '  ' + entry.name);
 }
 return lines.join('\n') + '\n';
}

/** Cross-check a cipher blob against the hash recorded in caseEncryptionMeta. */
export async function cipherMatchesMeta(blob, meta) {
 if (!blob || !meta || typeof meta.ciphertextSha256 !== 'string') return false;
 const actual = 'sha256:' + await sha256Hex(new Uint8Array(await blob.arrayBuffer()));
 return actual === meta.ciphertextSha256;
}
