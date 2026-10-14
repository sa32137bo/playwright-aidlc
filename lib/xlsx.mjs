import { readZip, readText } from './zip.mjs';
import { rewriteZip } from './zipwrite.mjs';
import { parseXml, findAll, textOf } from './xml.mjs';

/**
 * Just enough .xlsx to read a sheet and to refill one.
 *
 * Generic on purpose — it knows about rows, cells and styles, and nothing about
 * test cases. The column meanings live with the feature that owns them.
 *
 * An .xlsx is a ZIP of XML, like .docx, so this rides on the same reader the
 * ingest command already uses.
 */

export const colOf = (ref) => (String(ref).match(/^[A-Z]+/) || [''])[0];
export const rowOf = (ref) => Number((String(ref).match(/\d+/) || [0])[0]);

/** Column letter for a 0-based index: 0 -> A, 25 -> Z, 26 -> AA. */
export function colName(i) {
  let s = '';
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
  return s;
}

export function sheets(buf) {
  const z = readZip(buf);
  const wb = readText(buf, z, 'xl/workbook.xml');
  if (!wb) return [];
  return findAll(parseXml(wb), 'sheet').map((s, i) => ({
    name: s.attrs.name,
    file: `xl/worksheets/sheet${i + 1}.xml`,
  }));
}

/**
 * Rows as [{ r, cells: { A: 'text', B: 'text' } }].
 *
 * Shared strings are resolved, so callers see text rather than indices. Formulas
 * are ignored — a cell's cached value is what a tester sees and what we want.
 */
export function readRows(buf, sheetFile) {
  const z = readZip(buf);
  const xml = readText(buf, z, sheetFile);
  if (!xml) return [];

  const ssXml = readText(buf, z, 'xl/sharedStrings.xml');
  const shared = ssXml ? findAll(parseXml(ssXml), 'si').map((si) => textOf(si)) : [];

  const out = [];
  for (const row of findAll(parseXml(xml), 'row')) {
    const cells = {};
    for (const cell of findAll(row, 'c')) {
      const ref = cell.attrs.r || '';
      const raw = textOf(cell);
      let value = raw;
      if (cell.attrs.t === 's') value = shared[Number(raw)] ?? raw;
      value = String(value).replace(/\r\n?/g, '\n').trim();
      if (value) cells[colOf(ref)] = value;
    }
    out.push({ r: Number(row.attrs.r) || out.length + 1, cells });
  }
  return out;
}

/**
 * Replace a sheet's data rows, keeping everything above `keepThroughRow`.
 *
 * Cell styles are copied from `styleFromRow` — the template's worked-example row —
 * so generated rows inherit the borders, fills and wrapping the tester designed,
 * rather than arriving as unformatted text next to a carefully styled header.
 *
 * Values are written as inline strings, which means `sharedStrings.xml` is never
 * touched. Appending to the shared string table would work too, but every index
 * in the file is relative to it, and getting that subtly wrong produces a workbook
 * that opens with the wrong text in the wrong cells.
 */
export function replaceSheetData(buf, sheetFile, { keepThroughRow, rows, styleFromRow }) {
  const z = readZip(buf);
  const xml = readText(buf, z, sheetFile);
  if (!xml) throw new Error(`no such sheet part: ${sheetFile}`);

  const open = xml.indexOf('<sheetData');
  if (open < 0) throw new Error(`${sheetFile} has no <sheetData>`);
  const selfClosing = /^<sheetData\s*\/>/.test(xml.slice(open));
  const bodyStart = selfClosing ? open : xml.indexOf('>', open) + 1;
  const bodyEnd = selfClosing ? open + xml.slice(open).indexOf('/>') + 2 : xml.indexOf('</sheetData>', bodyStart);
  const body = selfClosing ? '' : xml.slice(bodyStart, bodyEnd);
  const tail = selfClosing ? xml.slice(bodyEnd) : xml.slice(bodyEnd + '</sheetData>'.length);

  const styles = styleStops(body, styleFromRow);

  const kept = [...body.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*(?:\/>|>[\s\S]*?<\/row>)/g)]
    .filter((m) => Number(m[1]) <= keepThroughRow)
    .map((m) => m[0])
    .join('');

  const generated = rows
    .map((cells, i) => renderRow(keepThroughRow + 1 + i, cells, styles))
    .join('');

  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  const lastRow = keepThroughRow + rows.length;

  const head = xml
    .slice(0, open)
    .replace(/<dimension\s+ref="[^"]*"\s*\/>/, `<dimension ref="A1:${colName(Math.max(width, 1) - 1)}${lastRow}"/>`);

  const rebuilt = `${head}<sheetData>${kept}${generated}</sheetData>${tail}`;
  return rewriteZip(buf, { [sheetFile]: rebuilt });
}

/** Style index per column, lifted from one row of the template. */
function styleStops(body, styleFromRow) {
  const stops = {};
  if (!styleFromRow) return stops;
  const row = new RegExp(`<row\\b[^>]*\\br="${styleFromRow}"[^>]*>([\\s\\S]*?)</row>`).exec(body);
  if (!row) return stops;
  for (const m of row[1].matchAll(/<c\b[^>]*\br="([A-Z]+)\d+"[^>]*?(?:\bs="(\d+)")?[^>]*\/?>/g)) {
    if (m[2] !== undefined) stops[m[1]] = m[2];
  }
  return stops;
}

function renderRow(r, cells, styles) {
  const parts = cells
    .map((value, i) => {
      const col = colName(i);
      if (value === null || value === undefined || value === '') {
        // Still emit the cell when the template styles it, so empty execution
        // columns keep their borders instead of leaving a ragged block.
        return styles[col] ? `<c r="${col}${r}" s="${styles[col]}"/>` : '';
      }
      const s = styles[col] ? ` s="${styles[col]}"` : '';
      return `<c r="${col}${r}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
    })
    .join('');
  return `<row r="${r}">${parts}</row>`;
}

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Excel stores newlines inside a cell as literal LF; CR would show as a box.
    .replace(/\r\n?/g, '\n')
    // Control characters other than tab and newline are not valid XML 1.0.
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
