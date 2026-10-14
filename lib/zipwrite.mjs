import { deflateRawSync, crc32 as zlibCrc32 } from 'node:zlib';
import { readZip, readEntry } from './zip.mjs';

/**
 * Minimal ZIP writer, enough to rewrite an Office document.
 *
 * The companion to zip.mjs, and deliberately narrow: it exists so we can inject
 * rows into a tester's .xlsx template and hand the file back with everything else
 * untouched. Authoring a workbook from scratch would mean recreating the styles,
 * the colour legend and the instructions sheet, and would produce something the
 * testers do not recognise as theirs.
 *
 * No dependency. Node already ships deflate and, since 22.2, crc32.
 */

const LOCAL_SIG = 0x04034b50;
const CD_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

const crc32 = typeof zlibCrc32 === 'function' ? zlibCrc32 : makeCrc32();

/**
 * Build a ZIP from entries: [{ name, data, store? }].
 *
 * Order is preserved, which matters for OPC packages: readers expect
 * [Content_Types].xml first, and some are stricter about it than the spec is.
 */
export function writeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  const { time, date } = dosStamp(new Date());

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const store = !!entry.store || raw.length === 0;
    const body = store ? raw : deflateRawSync(raw, { level: 9 });
    const method = store ? 0 : 8;
    const sum = crc32(raw) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0, 6);           // flags — no data descriptor, sizes are known
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);          // no extra field

    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CD_SIG, 0);
    central.writeUInt16LE(20, 4);        // version made by
    central.writeUInt16LE(20, 6);        // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);        // extra
    central.writeUInt16LE(0, 32);        // comment
    central.writeUInt16LE(0, 34);        // disk
    central.writeUInt16LE(0, 36);        // internal attrs
    central.writeUInt32LE(0, 38);        // external attrs
    central.writeUInt32LE(offset, 42);

    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }

  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, cd, eocd]);
}

/**
 * Rewrite an existing archive, replacing named parts and copying the rest
 * through **byte for byte**.
 *
 * That copying is the whole point. A workbook carries styles, themes, relationship
 * graphs and content-type declarations that we have no business regenerating, and
 * a mistake in any of them surfaces as "Excel found unreadable content" on a
 * tester's machine rather than as an error here.
 *
 * `replacements` is a map of entry name -> string | Buffer.
 */
export function rewriteZip(sourceBuf, replacements) {
  const entries = readZip(sourceBuf);
  const unknown = [...Object.keys(replacements)].filter((k) => !entries.has(k));
  if (unknown.length) throw new Error(`not in the archive: ${unknown.join(', ')}`);

  const out = [];
  for (const [name, entry] of entries) {
    const replacement = replacements[name];
    out.push({ name, data: replacement !== undefined ? replacement : readEntry(sourceBuf, entry) });
  }
  return writeZip(out);
}

function dosStamp(d) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

/** Fallback for Node older than 22.2, which has no zlib.crc32. */
function makeCrc32() {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return (buf) => {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ table[(c ^ buf[i]) & 0xff];
    return (c ^ -1) >>> 0;
  };
}
