import { inflateRawSync } from 'node:zlib';

/**
 * Minimal ZIP reader, enough for the Office formats.
 *
 * A .docx (and .xlsx, .pptx) is a ZIP archive of XML parts, so reading one
 * needs no dependency at all — just the central directory and zlib, which Node
 * already ships. The kit has no runtime dependencies and this keeps it that way.
 *
 * Reads the central directory rather than local headers on purpose: when Word
 * streams a file it writes zero into the local header's size fields and puts the
 * real sizes in a trailing data descriptor. The central directory always has
 * them.
 */

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

export function readZip(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('not a ZIP archive (no end-of-central-directory record)');

  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);

  if (cdOffset === 0xffffffff || count === 0xffff) {
    throw new Error('ZIP64 archives are not supported — re-save the document from Word');
  }

  const entries = new Map();
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CD_SIG) break;
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, { name, method, compressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function readEntry(buf, entry) {
  if (!entry) return null;
  const o = entry.localOffset;
  if (buf.readUInt32LE(o) !== LOCAL_SIG) throw new Error(`corrupt entry: ${entry.name}`);
  // Local extra field length can differ from the central one, so read it here.
  const nameLen = buf.readUInt16LE(o + 26);
  const extraLen = buf.readUInt16LE(o + 28);
  const start = o + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(raw);
  if (entry.method === 8) return inflateRawSync(raw);
  throw new Error(`unsupported compression method ${entry.method} in ${entry.name}`);
}

export function readText(buf, entries, name) {
  const data = readEntry(buf, entries.get(name));
  return data ? data.toString('utf8') : null;
}

function findEocd(buf) {
  // The EOCD sits at the end, after an optional comment of up to 64 KB.
  const min = Math.max(0, buf.length - 0xffff - 22);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}
