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
const MAX_U16 = 0xFFFF;
const DOS_DATE_1980 = 0x0021;
const ENTRY_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
 let c = n >>> 0;
 for (let k = 0; k < 8; k++) c = (c & 1) ? ((0xEDB88320 ^ (c >>> 1)) >>> 0) : (c >>> 1);
 CRC_TABLE[n] = c >>> 0;
}

export function crc32OfBytes(bytes) {
 let c = 0xFFFFFFFF;
 for (let i = 0; i < bytes.length; i++) c = (CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8)) >>> 0;
 return (c ^ 0xFFFFFFFF) >>> 0;
}

export async function inspectBlob(blob) {
 const bytes = new Uint8Array(await blob.arrayBuffer());
 return {
 size: bytes.byteLength,
 crc32: crc32OfBytes(bytes),
 sha256: await sha256Uri(bytes)
 };
}

function localHeader(size, crc32, nameLen, extraLen, sizeIsZip64) {
 const bytes = new Uint8Array(30);
 const view = new DataView(bytes.buffer);
 view.setUint32(0, SIG_LOCAL, true);
 view.setUint16(4, sizeIsZip64 ? 45 : 20, true);
 view.setUint16(6, 0, true);
 view.setUint16(8, 0, true);
 view.setUint16(10, 0, true);
 view.setUint16(12, DOS_DATE_1980, true);
 view.setUint32(14, crc32 >>> 0, true);
 view.setUint32(18, sizeIsZip64 ? MAX_U32 : size >>> 0, true);
 view.setUint32(22, sizeIsZip64 ? MAX_U32 : size >>> 0, true);
 view.setUint16(26, nameLen, true);
 view.setUint16(28, extraLen, true);
 return bytes;
}

function centralHeader(size, crc32, nameLen, extraLen, offset, sizeIsZip64, offsetIsZip64) {
 const bytes = new Uint8Array(46);
 const view = new DataView(bytes.buffer);
 view.setUint32(0, SIG_CENTRAL, true);
 view.setUint16(4, 45, true);
 view.setUint16(6, sizeIsZip64 || offsetIsZip64 ? 45 : 20, true);
 view.setUint16(8, 0, true);
 view.setUint16(10, 0, true);
 view.setUint16(12, 0, true);
 view.setUint16(14, DOS_DATE_1980, true);
 view.setUint32(16, crc32 >>> 0, true);
 view.setUint32(20, sizeIsZip64 ? MAX_U32 : size >>> 0, true);
 view.setUint32(24, sizeIsZip64 ? MAX_U32 : size >>> 0, true);
 view.setUint16(28, nameLen, true);
 view.setUint16(30, extraLen, true);
 view.setUint16(32, 0, true);
 view.setUint16(34, 0, true);
 view.setUint16(36, 0, true);
 view.setUint32(38, 0, true);
 view.setUint32(42, offsetIsZip64 ? MAX_U32 : offset >>> 0, true);
 return bytes;
}

function zip64LocalExtra(size) {
 const bytes = new Uint8Array(20);
 const view = new DataView(bytes.buffer);
 view.setUint16(0, 0x0001, true);
 view.setUint16(2, 16, true);
 view.setBigUint64(4, BigInt(size), true);
 view.setBigUint64(12, BigInt(size), true);
 return bytes;
}

function zip64CentralExtra(size, offset, sizeIsZip64, offsetIsZip64) {
 const fields = (sizeIsZip64 ? 2 : 0) + (offsetIsZip64 ? 1 : 0);
 const bytes = new Uint8Array(4 + fields * 8);
 const view = new DataView(bytes.buffer);
 view.setUint16(0, 0x0001, true);
 view.setUint16(2, fields * 8, true);
 let p = 4;
 if (sizeIsZip64) {
 view.setBigUint64(p, BigInt(size), true); p += 8;
 view.setBigUint64(p, BigInt(size), true); p += 8;
 }
 if (offsetIsZip64) view.setBigUint64(p, BigInt(offset), true);
 return bytes;
}

function zip64EocdRecord(count, cdSize, cdOffset) {
 const bytes = new Uint8Array(56);
 const view = new DataView(bytes.buffer);
 view.setUint32(0, SIG_ZIP64_EOCD, true);
 view.setBigUint64(4, 44n, true);
 view.setUint16(12, 45, true);
 view.setUint16(14, 45, true);
 view.setUint32(16, 0, true);
 view.setUint32(20, 0, true);
 view.setBigUint64(24, BigInt(count), true);
 view.setBigUint64(32, BigInt(count), true);
 view.setBigUint64(40, BigInt(cdSize), true);
 view.setBigUint64(48, BigInt(cdOffset), true);
 return bytes;
}

function zip64Locator(offset) {
 const bytes = new Uint8Array(20);
 const view = new DataView(bytes.buffer);
 view.setUint32(0, SIG_ZIP64_LOCATOR, true);
 view.setUint32(4, 0, true);
 view.setBigUint64(8, BigInt(offset), true);
 view.setUint32(16, 1, true);
 return bytes;
}

function eocdRecord(count, cdSize, cdOffset, useZip64) {
 const bytes = new Uint8Array(22);
 const view = new DataView(bytes.buffer);
 view.setUint32(0, SIG_EOCD, true);
 view.setUint16(4, 0, true);
 view.setUint16(6, 0, true);
 view.setUint16(8, useZip64 ? MAX_U16 : count, true);
 view.setUint16(10, useZip64 ? MAX_U16 : count, true);
 view.setUint32(12, useZip64 ? MAX_U32 : cdSize, true);
 view.setUint32(16, useZip64 ? MAX_U32 : cdOffset, true);
 view.setUint16(20, 0, true);
 return bytes;
}

function partSize(part) {
 return part instanceof Blob ? part.size : part.byteLength;
}

function toBytes(data) {
 if (data instanceof Uint8Array) return data;
 if (typeof data === 'string') return new TextEncoder().encode(data);
 if (data instanceof ArrayBuffer) return new Uint8Array(data);
 throw new TypeError('entry.data must be a string, Uint8Array or ArrayBuffer');
}

export async function buildZip(entries) {
 const planned = [];
 for (const entry of entries) {
 if (typeof entry.name !== 'string' || !ENTRY_NAME_RE.test(entry.name) || entry.name.indexOf('..') !== -1) {
 throw new Error('invalid ZIP entry name: ' + entry.name);
 }
 const nameBytes = new TextEncoder().encode(entry.name);
 let blob;
 let size;
 let crc32;
 let sha256;
 if (entry.data !== undefined) {
 const bytes = toBytes(entry.data);
 size = bytes.byteLength;
 crc32 = crc32OfBytes(bytes);
 sha256 = await sha256Uri(bytes);
 blob = new Blob([bytes], { type: 'application/octet-stream' });
 } else {
 blob = entry.blob;
 if (!(blob instanceof Blob)) throw new TypeError('entry.blob must be a Blob');
 if (entry.size !== undefined && entry.crc32 !== undefined) {
 size = entry.size;
 crc32 = entry.crc32;
 sha256 = entry.sha256;
 if (blob.size !== size) throw new Error('precomputed size does not match blob size for ' + entry.name);
 } else {
 const info = await inspectBlob(blob);
 size = info.size;
 crc32 = info.crc32;
 sha256 = info.sha256;
 }
 }
 planned.push({ name: entry.name, nameBytes, blob, size, crc32, sha256 });
 }

 const parts = [];
 let pos = 0;
 const push = (part) => {
 parts.push(part);
 pos += partSize(part);
 };

 const central = [];
 for (const item of planned) {
 const offset = pos;
 const sizeIsZip64 = item.size > MAX_U32;
 const extra = sizeIsZip64 ? zip64LocalExtra(item.size) : new Uint8Array(0);
 push(localHeader(item.size, item.crc32, item.nameBytes.byteLength, extra.byteLength, sizeIsZip64));
 push(item.nameBytes);
 if (extra.byteLength) push(extra);
 push(item.blob);
 central.push({ item, offset, sizeIsZip64 });
 }

 const cdOffset = pos;
 for (const record of central) {
 const { item, offset, sizeIsZip64 } = record;
 const offsetIsZip64 = offset > MAX_U32;
 const extra = (sizeIsZip64 || offsetIsZip64)
 ? zip64CentralExtra(item.size, offset, sizeIsZip64, offsetIsZip64)
 : new Uint8Array(0);
 push(centralHeader(item.size, item.crc32, item.nameBytes.byteLength, extra.byteLength, offset, sizeIsZip64, offsetIsZip64));
 push(item.nameBytes);
 if (extra.byteLength) push(extra);
 }
 const cdSize = pos - cdOffset;
 const count = central.length;
 const useZip64 = count > MAX_U16 || cdSize > MAX_U32 || cdOffset > MAX_U32;
 if (useZip64) {
 push(zip64EocdRecord(count, cdSize, cdOffset));
 push(zip64Locator(cdOffset + cdSize));
 }
 push(eocdRecord(count, cdSize, cdOffset, useZip64));

 return new Blob(parts, { type: 'application/zip' });
}
