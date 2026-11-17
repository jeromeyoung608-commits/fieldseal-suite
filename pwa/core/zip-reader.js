/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
import { sha256Uri } from './hash.js';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const MAX_U32 = 0xFFFFFFFF;
const MAX_CENTRAL_DIRECTORY = 16 * 1024 * 1024;

async function readRange(blob, start, length) {
 return new Uint8Array(await blob.slice(start, start + length).arrayBuffer());
}

function view(bytes) {
 return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function decode(bytes) {
 return new TextDecoder().decode(bytes);
}

export async function readZip(blob) {
 if (!(blob instanceof Blob)) throw new TypeError('readZip expects a Blob');
 const size = blob.size;
 if (size < 22) throw new Error('not a ZIP archive: too small');

 const tailLength = Math.min(size, 22 + 65535 + 20 + 56);
 const tail = await readRange(blob, size - tailLength, tailLength);
 const tailView = view(tail);
 let eocd = -1;
 for (let i = tailLength - 22; i >= 0; i--) {
 if (tailView.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
 }
 if (eocd < 0) throw new Error('ZIP end of central directory not found');

 let count = tailView.getUint16(eocd + 10, true);
 let cdSize = tailView.getUint32(eocd + 12, true);
 let cdOffset = tailView.getUint32(eocd + 16, true);
 if (eocd >= 20 && tailView.getUint32(eocd - 20, true) === SIG_ZIP64_LOCATOR) {
 const zip64Offset = Number(tailView.getBigUint64(eocd - 20 + 8, true));
 const record = await readRange(blob, zip64Offset, 56);
 const recordView = view(record);
 if (recordView.getUint32(0, true) !== SIG_ZIP64_EOCD) throw new Error('ZIP64 EOCD missing');
 count = Number(recordView.getBigUint64(32, true));
 cdSize = Number(recordView.getBigUint64(40, true));
 cdOffset = Number(recordView.getBigUint64(48, true));
 }
 if (cdOffset + cdSize > size) throw new Error('central directory points outside the archive');
 if (cdSize > MAX_CENTRAL_DIRECTORY) throw new Error('central directory too large');
 if (![count, cdSize, cdOffset].every(Number.isSafeInteger)) throw new Error('ZIP64 value out of range');

 const central = await readRange(blob, cdOffset, cdSize);
 const cv = view(central);
 const entries = [];
 let p = 0;
 while (p + 46 <= central.length) {
 if (cv.getUint32(p, true) !== SIG_CENTRAL) throw new Error('bad central directory signature');
 const nameLength = cv.getUint16(p + 28, true);
 const extraLength = cv.getUint16(p + 30, true);
 const commentLength = cv.getUint16(p + 32, true);
 const recordLength = 46 + nameLength + extraLength + commentLength;
 if (p + recordLength > central.length) throw new Error('truncated central directory record');

 let compressedSize = cv.getUint32(p + 20, true);
 let uncompressedSize = cv.getUint32(p + 24, true);
 let localOffset = cv.getUint32(p + 42, true);
 const extra = central.subarray(p + 46 + nameLength, p + 46 + nameLength + extraLength);
 const ev = view(extra);
 let q = 0;
 while (q + 4 <= extra.length) {
 const id = ev.getUint16(q, true);
 const length = ev.getUint16(q + 2, true);
 if (q + 4 + length > extra.length) break;
 if (id === 0x0001) {
 let r = q + 4;
 if (uncompressedSize === MAX_U32 && r + 8 <= q + 4 + length) { uncompressedSize = Number(ev.getBigUint64(r, true)); r += 8; }
 if (compressedSize === MAX_U32 && r + 8 <= q + 4 + length) { compressedSize = Number(ev.getBigUint64(r, true)); r += 8; }
 if (localOffset === MAX_U32 && r + 8 <= q + 4 + length) { localOffset = Number(ev.getBigUint64(r, true)); r += 8; }
 }
 q += 4 + length;
 }

 entries.push({
 name: decode(central.subarray(p + 46, p + 46 + nameLength)),
 method: cv.getUint16(p + 10, true),
 crc32: cv.getUint32(p + 16, true),
 compressedSize,
 uncompressedSize,
 localOffset
 });
 p += recordLength;
 }
 if (p !== central.length) throw new Error('trailing bytes in central directory');
 if (entries.length !== count) throw new Error('central directory entry count mismatch');

 const byName = new Map();
 for (const entry of entries) if (!byName.has(entry.name)) byName.set(entry.name, entry);

 async function entryBytes(name) {
 const entry = byName.get(name);
 if (!entry) throw new Error('ZIP entry not found: ' + name);
 const head = await readRange(blob, entry.localOffset, 30);
 const hv = view(head);
 if (hv.getUint32(0, true) !== SIG_LOCAL) throw new Error('bad local header for ' + name);
 const start = entry.localOffset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
 const raw = await readRange(blob, start, entry.compressedSize);
 if (entry.method === 0) return raw;
 if (entry.method === 8) {
 if (typeof DecompressionStream === 'undefined' || typeof Response === 'undefined') {
 throw new Error('deflate entries are not supported by this runtime');
 }
 const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
 return new Uint8Array(await new Response(stream).arrayBuffer());
 }
 throw new Error('unsupported ZIP compression method ' + entry.method);
 }

 return {
 entries,
 getEntry(name) { return byName.get(name); },
 async readBytes(name, limit = MAX_CENTRAL_DIRECTORY) {
 const bytes = await entryBytes(name);
 if (bytes.byteLength > limit) throw new Error('ZIP entry exceeds read limit');
 return bytes;
 },
 async readText(name, limit = MAX_CENTRAL_DIRECTORY) {
 return decode(await this.readBytes(name, limit));
 },
 async hashEntry(name) {
 return sha256Uri(await entryBytes(name));
 }
 };
}
