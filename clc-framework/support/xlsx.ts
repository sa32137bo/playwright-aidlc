// Minimal .xlsx reader — enough to assert cell values in a downloaded report.
//
// Deliberately dependency-free. An .xlsx is a ZIP of XML parts, and Node's own
// `zlib` can inflate the raw-deflate entries a ZIP uses, so reading one costs
// about forty lines rather than a new supply-chain dependency. This project
// states it has no runtime deps (see playwright.config.ts's own note on why it
// hand-rolls .env parsing) and that reasoning applies here too.
//
// Scope is intentionally narrow: enough to read a sheet's cells as strings.
// It is NOT a general xlsx library — no styles, no formulas, no dates as
// dates, no streaming. If a future bolt needs more than "what text is in this
// cell", add a real library then rather than growing this.
//
// Verified against a real CrewHub export (RDR.xlsx, bolt
// US-CLC-MISSINGCREWNAME-001, 2026-09-24).

import { inflateRawSync } from 'zlib';

interface ZipEntry {
  name: string;
  data: Buffer;
}

/** Read a ZIP's entries from its central directory. */
function readZip(buf: Buffer): ZipEntry[] {
  // Locate the End Of Central Directory record, scanning back from the tail.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65_557; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip archive: no end-of-central-directory record');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    // The local header repeats the name/extra lengths, and they can differ
    // from the central directory's — read the payload offset from the local
    // header, not from the central one.
    const lhNameLen = buf.readUInt16LE(localOffset + 26);
    const lhExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lhNameLen + lhExtraLen;
    const raw = buf.subarray(start, start + compSize);

    entries.push({ name, data: method === 0 ? raw : inflateRawSync(raw) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

const decodeXmlEntities = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');

/** Strip tags from a shared-string entry, which may be split across <r> runs. */
const sharedStringText = (si: string): string =>
  decodeXmlEntities(si.replace(/<[^>]+>/g, ''));

/** `B12` -> 1 (zero-based column index). */
function columnIndex(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref)?.[1] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Read the first worksheet of an .xlsx as a grid of trimmed strings.
 *
 * Rows are padded so every row has the same width as the widest, which keeps
 * column-index lookups honest when a trailing cell is empty and Excel simply
 * omits it.
 */
export function readXlsxSheet(buf: Buffer): string[][] {
  const entries = readZip(buf);
  const byName = new Map(entries.map((e) => [e.name, e.data]));

  const sharedXml = byName.get('xl/sharedStrings.xml')?.toString('utf8') ?? '';
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => sharedStringText(m[1]));

  const sheetName =
    [...byName.keys()].find((n) => /^xl\/worksheets\/sheet1\.xml$/.test(n)) ??
    [...byName.keys()].find((n) => /^xl\/worksheets\/.*\.xml$/.test(n));
  if (!sheetName) throw new Error(`no worksheet in workbook; parts: ${[...byName.keys()].join(', ')}`);
  const sheet = byName.get(sheetName)!.toString('utf8');

  const rows: string[][] = [];
  for (const rowMatch of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>|<c([^>]*)\/>/g)) {
      const attrs = c[1] ?? c[3] ?? '';
      const inner = c[2] ?? '';
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /t="([^"]+)"/.exec(attrs)?.[1];
      const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '';
      const inlineStr = /<is>([\s\S]*?)<\/is>/.exec(inner)?.[1];

      let value: string;
      if (type === 's') value = shared[Number(raw)] ?? '';
      else if (type === 'inlineStr' && inlineStr !== undefined) value = sharedStringText(inlineStr);
      else value = decodeXmlEntities(raw);

      const at = ref ? columnIndex(ref) : cells.length;
      while (cells.length < at) cells.push('');
      cells[at] = value.trim();
    }
    rows.push(cells);
  }

  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  for (const r of rows) while (r.length < width) r.push('');
  return rows;
}

/** Index of the first header cell matching `pattern`, or -1. */
export function xlsxColumn(headers: string[], pattern: RegExp): number {
  return headers.findIndex((h) => pattern.test(h));
}
