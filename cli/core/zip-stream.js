/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite project / 项目归属：FieldSeal Suite.
 */
'use strict';

const fs = require('fs');
const zlib = require('zlib');
const { pipeline } = require('stream').promises;
const { Readable } = require('stream');
const { createSha256, CHUNK_SIZE } = require('./hash');

const ZIP_STORED = 0;
const ZIP_DEFLATED = 8;
const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const MAX_U32 = 0xFFFFFFFF;
const MAX_U16 = 0xFFFF;
const DOS_DATE_1980 = 0x0021;

class ZipError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'ZipError';
    this.code = code;
  }
}

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n >>> 0;
  for (let k = 0; k < 8; k++) c = (c & 1) ? ((0xEDB88320 ^ (c >>> 1)) >>> 0) : (c >>> 1);
  CRC_TABLE[n] = c >>> 0;
}

function createCrc32() {
  let crc = 0;
  return {
    update(buf) {
      let c = (crc ^ 0xFFFFFFFF) >>> 0;
      for (let i = 0; i < buf.length; i++) c = (CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)) >>> 0;
      crc = (c ^ 0xFFFFFFFF) >>> 0;
    },
    value() { return crc >>> 0; }
  };
}

function crc32OfBuffer(buf) {
  const state = createCrc32();
  state.update(buf);
  return state.value();
}

async function scanFile(filePath) {
  const crc = createCrc32();
  const sha = createSha256();
  let size = 0;
  for await (const chunk of fs.createReadStream(filePath, { highWaterMark: CHUNK_SIZE })) {
    size += chunk.length;
    crc.update(chunk);
    sha.update(chunk);
  }
  return { size, crc32: crc.value(), sha256: sha.digest() };
}

function u64(number) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(number), 0);
  return buf;
}

function zip64LocalExtra(uncompressedSize, compressedSize) {
  const data = Buffer.concat([u64(uncompressedSize), u64(compressedSize)]);
  const head = Buffer.alloc(4);
  head.writeUInt16LE(0x0001, 0);
  head.writeUInt16LE(data.length, 2);
  return Buffer.concat([head, data]);
}

function zip64CentralExtra(sizeIsZip64, offsetIsZip64, size, offset) {
  const parts = [];
  if (sizeIsZip64) parts.push(u64(size), u64(size));
  if (offsetIsZip64) parts.push(u64(offset));
  const data = Buffer.concat(parts);
  const head = Buffer.alloc(4);
  head.writeUInt16LE(0x0001, 0);
  head.writeUInt16LE(data.length, 2);
  return Buffer.concat([head, data]);
}

function buildZip64EocdRecord(count, cdSize, cdOffset) {
  const rec = Buffer.alloc(56);
  rec.writeUInt32LE(SIG_ZIP64_EOCD, 0);
  rec.writeBigUInt64LE(44n, 4);
  rec.writeUInt16LE(45, 12);
  rec.writeUInt16LE(45, 14);
  rec.writeUInt32LE(0, 16);
  rec.writeUInt32LE(0, 20);
  rec.writeBigUInt64LE(BigInt(count), 24);
  rec.writeBigUInt64LE(BigInt(count), 32);
  rec.writeBigUInt64LE(BigInt(cdSize), 40);
  rec.writeBigUInt64LE(BigInt(cdOffset), 48);
  return rec;
}

function buildZip64Locator(zip64Offset) {
  const loc = Buffer.alloc(20);
  loc.writeUInt32LE(SIG_ZIP64_LOCATOR, 0);
  loc.writeUInt32LE(0, 4);
  loc.writeBigUInt64LE(BigInt(zip64Offset), 8);
  loc.writeUInt32LE(1, 16);
  return loc;
}

function readZip64Fields(data, state) {
  let p = 0;
  if (state.uncompressedSize === MAX_U32 && p + 8 <= data.length) { state.uncompressedSize = Number(data.readBigUInt64LE(p)); p += 8; }
  if (state.compressedSize === MAX_U32 && p + 8 <= data.length) { state.compressedSize = Number(data.readBigUInt64LE(p)); p += 8; }
  if (state.localHeaderOffset === MAX_U32 && p + 8 <= data.length) { state.localHeaderOffset = Number(data.readBigUInt64LE(p)); p += 8; }
  if (!Number.isSafeInteger(state.uncompressedSize) || !Number.isSafeInteger(state.compressedSize) || !Number.isSafeInteger(state.localHeaderOffset)) {
    throw new ZipError('ZIP64_OVERFLOW', 'archive exceeds supported safe-integer range');
  }
}

function parseCentralRecord(rec, fnLen, exLen) {
  const state = {
    compressedSize: rec.readUInt32LE(20),
    uncompressedSize: rec.readUInt32LE(24),
    localHeaderOffset: rec.readUInt32LE(42)
  };
  const extra = rec.subarray(46 + fnLen, 46 + fnLen + exLen);
  let p = 0;
  while (p + 4 <= extra.length) {
    const id = extra.readUInt16LE(p);
    const len = extra.readUInt16LE(p + 2);
    if (p + 4 + len > extra.length) break;
    if (id === 0x0001) readZip64Fields(extra.subarray(p + 4, p + 4 + len), state);
    p += 4 + len;
  }
  return {
    name: rec.subarray(46, 46 + fnLen).toString('utf8'),
    flags: rec.readUInt16LE(8),
    method: rec.readUInt16LE(10),
    crc32: rec.readUInt32LE(16),
    compressedSize: state.compressedSize,
    uncompressedSize: state.uncompressedSize,
    localHeaderOffset: state.localHeaderOffset
  };
}

async function parseCentralDirectory(fh, cdOffset, cdSize, expectedCount) {
  const entries = [];
  const CHUNK = 1024 * 1024;
  let remaining = cdSize;
  let pos = cdOffset;
  let pending = Buffer.alloc(0);
  while (remaining > 0 || pending.length > 0) {
    if (remaining > 0) {
      const n = Math.min(CHUNK, remaining);
      const buf = Buffer.alloc(n);
      const { bytesRead } = await fh.read(buf, 0, n, pos);
      if (bytesRead <= 0) break;
      const slice = buf.subarray(0, bytesRead);
      pending = pending.length ? Buffer.concat([pending, slice]) : slice;
      pos += bytesRead;
      remaining -= bytesRead;
    }
    let progressed = true;
    while (progressed) {
      progressed = false;
      if (pending.length < 46) break;
      if (pending.readUInt32LE(0) !== SIG_CENTRAL) throw new ZipError('BAD_CENTRAL_DIRECTORY', 'central directory signature mismatch');
      const fnLen = pending.readUInt16LE(28);
      const exLen = pending.readUInt16LE(30);
      const cmLen = pending.readUInt16LE(32);
      const recLen = 46 + fnLen + exLen + cmLen;
      if (pending.length < recLen) break;
      entries.push(parseCentralRecord(pending.subarray(0, recLen), fnLen, exLen));
      pending = pending.subarray(recLen);
      progressed = true;
    }
    if (remaining <= 0) break;
  }
  if (pending.length > 0) throw new ZipError('BAD_CENTRAL_DIRECTORY', 'truncated central directory record');
  if (expectedCount > 0 && entries.length !== expectedCount) {
    throw new ZipError('BAD_CENTRAL_DIRECTORY', 'central directory entry count mismatch');
  }
  return entries;
}

async function readZip(filePath) {
  const fh = await fs.promises.open(filePath, 'r');
  try {
    const stat = await fh.stat();
    const fileSize = stat.size;
    if (fileSize < 22) throw new ZipError('EOCD_NOT_FOUND', 'file is too small to be a ZIP archive');
    const tailLen = Math.min(fileSize, 22 + MAX_U16 + 20 + 56);
    const tail = Buffer.alloc(tailLen);
    const { bytesRead } = await fh.read(tail, 0, tailLen, fileSize - tailLen);
    if (bytesRead !== tailLen) throw new ZipError('EOCD_NOT_FOUND', 'cannot read ZIP trailer');
    let eocdPos = -1;
    for (let i = tailLen - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === SIG_EOCD) { eocdPos = i; break; }
    }
    if (eocdPos < 0) throw new ZipError('EOCD_NOT_FOUND', 'end of central directory not found');
    let count = tail.readUInt16LE(eocdPos + 10);
    let cdSize = tail.readUInt32LE(eocdPos + 12);
    let cdOffset = tail.readUInt32LE(eocdPos + 16);
    if (eocdPos >= 20 && tail.readUInt32LE(eocdPos - 20) === SIG_ZIP64_LOCATOR) {
      const zip64Offset = Number(tail.readBigUInt64LE(eocdPos - 20 + 8));
      const rec = Buffer.alloc(56);
      const res = await fh.read(rec, 0, 56, zip64Offset);
      if (res.bytesRead !== 56 || rec.readUInt32LE(0) !== SIG_ZIP64_EOCD) {
        throw new ZipError('BAD_ZIP64_EOCD', 'ZIP64 end of central directory missing');
      }
      count = Number(rec.readBigUInt64LE(32));
      cdSize = Number(rec.readBigUInt64LE(40));
      cdOffset = Number(rec.readBigUInt64LE(48));
      if (![count, cdSize, cdOffset].every(Number.isSafeInteger)) {
        throw new ZipError('ZIP64_OVERFLOW', 'archive exceeds supported safe-integer range');
      }
    }
    if (cdOffset + cdSize > fileSize) throw new ZipError('BAD_CENTRAL_DIRECTORY', 'central directory points outside the archive');
    const entries = await parseCentralDirectory(fh, cdOffset, cdSize, count);
    const byName = new Map();
    for (const entry of entries) if (!byName.has(entry.name)) byName.set(entry.name, entry);
    let closed = false;

    async function dataOffset(entry) {
      const head = Buffer.alloc(30);
      const res = await fh.read(head, 0, 30, entry.localHeaderOffset);
      if (res.bytesRead !== 30 || head.readUInt32LE(0) !== SIG_LOCAL) {
        throw new ZipError('BAD_LOCAL_HEADER', 'local file header missing for ' + entry.name);
      }
      return entry.localHeaderOffset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
    }

    function createEntryStream(entry, start) {
      if (entry.compressedSize === 0) return Readable.from([]);
      const source = fs.createReadStream(filePath, {
        start,
        end: start + entry.compressedSize - 1,
        highWaterMark: CHUNK_SIZE
      });
      if (entry.method === ZIP_STORED) return source;
      if (entry.method === ZIP_DEFLATED) {
        const inflate = zlib.createInflateRaw();
        source.on('error', (err) => inflate.destroy(err));
        return source.pipe(inflate);
      }
      throw new ZipError('UNSUPPORTED_METHOD', 'unsupported compression method ' + entry.method);
    }

    return {
      filePath,
      entries,
      getEntry(name) { return byName.get(name); },
      async readText(entry, maxBytes) {
        const limit = maxBytes || 8 * 1024 * 1024;
        const stream = createEntryStream(entry, await dataOffset(entry));
        const chunks = [];
        let total = 0;
        for await (const chunk of stream) {
          total += chunk.length;
          if (total > limit) throw new ZipError('ENTRY_TOO_LARGE', 'entry exceeds read limit');
          chunks.push(chunk);
        }
        return Buffer.concat(chunks).toString('utf8');
      },
      async hashEntry(entry) {
        const stream = createEntryStream(entry, await dataOffset(entry));
        const sink = createSha256();
        for await (const chunk of stream) sink.update(chunk);
        return sink.digest();
      },
      async readBytes(entry) {
        const stream = createEntryStream(entry, await dataOffset(entry));
        const chunks = [];
        let total = 0;
        for await (const chunk of stream) {
          total += chunk.length;
          if (total > 64 * 1024 * 1024) throw new ZipError('ENTRY_TOO_LARGE', 'entry exceeds read limit');
          chunks.push(chunk);
        }
        return Buffer.concat(chunks);
      },
      async extractToFile(entry, outPath) {
        const stream = createEntryStream(entry, await dataOffset(entry));
        await pipeline(stream, fs.createWriteStream(outPath));
      },
      async close() {
        if (!closed) { closed = true; await fh.close(); }
      }
    };
  } catch (err) {
    await fh.close();
    throw err;
  }
}

async function writeZip(outputPath, sources) {
  const planned = [];
  for (const source of sources) {
    let name = source.name;
    if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name) || name.indexOf('..') !== -1) {
      throw new ZipError('BAD_ENTRY_NAME', 'invalid ZIP entry name: ' + name);
    }
    if (source.data !== undefined) {
      const buf = Buffer.isBuffer(source.data) ? source.data : Buffer.from(source.data, 'utf8');
      const crc = createCrc32();
      crc.update(buf);
      const sha = createSha256();
      sha.update(buf);
      planned.push({ name, size: buf.length, crc32: crc.value(), sha256: sha.digest(), data: buf });
    } else {
      const scan = await scanFile(source.sourcePath);
      planned.push({ name, size: scan.size, crc32: scan.crc32, sha256: scan.sha256, sourcePath: source.sourcePath });
    }
  }

  const fh = await fs.promises.open(outputPath, 'w');
  let pos = 0;
  async function put(buf) {
    let off = 0;
    while (off < buf.length) {
      const { bytesWritten } = await fh.write(buf, off, buf.length - off, pos);
      if (bytesWritten <= 0) throw new ZipError('WRITE_FAILED', 'short write to output archive');
      off += bytesWritten;
      pos += bytesWritten;
    }
  }

  try {
    const central = [];
    for (const item of planned) {
      const offset = pos;
      const nameBuf = Buffer.from(item.name, 'utf8');
      const sizeIsZip64 = item.size > MAX_U32;
      const localExtra = sizeIsZip64 ? zip64LocalExtra(item.size, item.size) : Buffer.alloc(0);
      const lh = Buffer.alloc(30);
      lh.writeUInt32LE(SIG_LOCAL, 0);
      lh.writeUInt16LE(sizeIsZip64 ? 45 : 20, 4);
      lh.writeUInt16LE(0, 6);
      lh.writeUInt16LE(ZIP_STORED, 8);
      lh.writeUInt16LE(0, 10);
      lh.writeUInt16LE(DOS_DATE_1980, 12);
      lh.writeUInt32LE(item.crc32, 14);
      lh.writeUInt32LE(sizeIsZip64 ? MAX_U32 : item.size, 18);
      lh.writeUInt32LE(sizeIsZip64 ? MAX_U32 : item.size, 22);
      lh.writeUInt16LE(nameBuf.length, 26);
      lh.writeUInt16LE(localExtra.length, 28);
      await put(lh);
      await put(nameBuf);
      if (localExtra.length) await put(localExtra);
      if (item.data) {
        await put(item.data);
      } else {
        for await (const chunk of fs.createReadStream(item.sourcePath, { highWaterMark: CHUNK_SIZE })) await put(chunk);
      }
      central.push({ item, nameBuf, offset, sizeIsZip64 });
    }

    const cdOffset = pos;
    for (const record of central) {
      const { item, nameBuf, offset, sizeIsZip64 } = record;
      const offsetIsZip64 = offset > MAX_U32;
      const extra = (sizeIsZip64 || offsetIsZip64) ? zip64CentralExtra(sizeIsZip64, offsetIsZip64, item.size, offset) : Buffer.alloc(0);
      const ch = Buffer.alloc(46);
      ch.writeUInt32LE(SIG_CENTRAL, 0);
      ch.writeUInt16LE(45, 4);
      ch.writeUInt16LE(sizeIsZip64 || offsetIsZip64 ? 45 : 20, 6);
      ch.writeUInt16LE(0, 8);
      ch.writeUInt16LE(ZIP_STORED, 10);
      ch.writeUInt16LE(0, 12);
      ch.writeUInt16LE(DOS_DATE_1980, 14);
      ch.writeUInt32LE(item.crc32, 16);
      ch.writeUInt32LE(sizeIsZip64 ? MAX_U32 : item.size, 20);
      ch.writeUInt32LE(sizeIsZip64 ? MAX_U32 : item.size, 24);
      ch.writeUInt16LE(nameBuf.length, 28);
      ch.writeUInt16LE(extra.length, 30);
      ch.writeUInt16LE(0, 32);
      ch.writeUInt16LE(0, 34);
      ch.writeUInt16LE(0, 36);
      ch.writeUInt32LE(0, 38);
      ch.writeUInt32LE(offsetIsZip64 ? MAX_U32 : offset, 42);
      await put(ch);
      await put(nameBuf);
      if (extra.length) await put(extra);
    }
    const cdSize = pos - cdOffset;
    const count = central.length;
    const needZip64Eocd = count > MAX_U16 || cdSize > MAX_U32 || cdOffset > MAX_U32;
    if (needZip64Eocd) {
      await put(buildZip64EocdRecord(count, cdSize, cdOffset));
      await put(buildZip64Locator(cdOffset + cdSize));
    }
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(SIG_EOCD, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(needZip64Eocd ? MAX_U16 : count, 8);
    eocd.writeUInt16LE(needZip64Eocd ? MAX_U16 : count, 10);
    eocd.writeUInt32LE(needZip64Eocd ? MAX_U32 : cdSize, 12);
    eocd.writeUInt32LE(needZip64Eocd ? MAX_U32 : cdOffset, 16);
    eocd.writeUInt16LE(0, 20);
    await put(eocd);
  } finally {
    await fh.close();
  }

  return planned.map((item) => ({ name: item.name, size: item.size, crc32: item.crc32, sha256: item.sha256 }));
}

module.exports = {
  ZIP_STORED, ZIP_DEFLATED, ZipError,
  createCrc32, crc32OfBuffer, scanFile,
  readZip, writeZip,
  buildZip64EocdRecord, buildZip64Locator
};
