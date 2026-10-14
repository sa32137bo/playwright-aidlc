import { inflateSync } from 'node:zlib';
import { extname } from 'node:path';

/**
 * .pdf -> Markdown, best effort, with the emphasis on knowing when it failed.
 *
 * PDF has no document structure to recover — no headings, no table cells, just
 * glyphs at coordinates. So this extracts the text layer and says so plainly.
 * What it must never do is return a thin file that looks like a successful
 * conversion: a scanned document yields nothing at all, and the caller has to be
 * told that in as many words so it can fall back to reading the pages visually.
 *
 * Deliberately no dependency. That costs us CID-keyed fonts (Identity-H), which
 * need the embedded CMap to decode; those are detected and reported rather than
 * emitted as mojibake.
 */

export function convertPdf(buf, { name }) {
  const stem = name.replace(/\.pdf$/i, '');
  const objects = readObjects(buf);

  const warnings = [];
  const stats = { pages: 0, images: 0, chars: 0 };

  const pages = orderedPages(objects);
  stats.pages = pages.length;

  const blocks = [];
  let cidSuspect = 0;

  for (let i = 0; i < pages.length; i++) {
    const content = pages[i].map((obj) => decodeStream(obj, warnings)).filter(Boolean).join('\n');
    if (!content) continue;
    const { text, cid } = extractText(content);
    cidSuspect += cid;
    const clean = tidy(text);
    if (clean) {
      blocks.push(`## Page ${i + 1}\n\n${clean}`);
      stats.chars += clean.length;
    }
  }

  const media = [];
  for (const obj of objects) {
    if (!/\/Subtype\s*\/Image/.test(obj.dict)) continue;
    stats.images++;
    if (/\/DCTDecode/.test(obj.dict) && obj.stream) {
      // A DCTDecode stream is a JPEG file already - write the bytes straight out.
      const n = String(media.length + 1).padStart(2, '0');
      media.push({ file: `image-${n}.jpg`, data: obj.stream });
    }
  }

  const undecoded = stats.images - media.length;
  if (undecoded > 0) {
    warnings.push(
      `${undecoded} image(s) are not JPEG-encoded and were not extracted - if the document carries rules inside those images, they are not in this file`
    );
  }
  if (cidSuspect > 0) {
    warnings.push(
      `${cidSuspect} text run(s) use CID-keyed fonts (Identity-H) and could not be decoded without their embedded CMap - text from those runs is missing`
    );
  }
  if (stats.pages === 0) warnings.push('no /Type /Page objects found - the page tree could not be read');

  const hasTextLayer = stats.chars >= 100;

  const markdown = blocks.join('\n\n');
  return { markdown, media, stats, warnings, hasTextLayer, mediaDir: `${stem}.media` };
}

// --- object layer ---------------------------------------------------------

function readObjects(buf) {
  const out = [];
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  const text = buf.toString('latin1');
  let m;

  while ((m = re.exec(text))) {
    const num = Number(m[1]);
    const start = m.index + m[0].length;
    const end = text.indexOf('endobj', start);
    if (end < 0) continue;

    const body = text.slice(start, end);
    const sIdx = body.indexOf('stream');
    let dict = body;
    let stream = null;

    if (sIdx > -1) {
      dict = body.slice(0, sIdx);
      // Data begins after the EOL that follows the "stream" keyword.
      let dataStart = start + sIdx + 6;
      if (text[dataStart] === '\r') dataStart++;
      if (text[dataStart] === '\n') dataStart++;
      // /Length is often an indirect reference, so trust the terminator instead.
      const eIdx = text.indexOf('endstream', dataStart);
      if (eIdx > -1) {
        let dataEnd = eIdx;
        if (text[dataEnd - 1] === '\n') dataEnd--;
        if (text[dataEnd - 1] === '\r') dataEnd--;
        stream = buf.subarray(dataStart, dataEnd);
      }
    }
    out.push({ num, dict, stream });
    re.lastIndex = end;
  }
  return out;
}

function decodeStream(obj, warnings) {
  if (!obj || !obj.stream) return '';
  if (!/\/FlateDecode/.test(obj.dict)) return obj.stream.toString('latin1');
  try {
    return inflateSync(obj.stream).toString('latin1');
  } catch {
    try {
      // Some writers leave a stray leading byte; retry from the next one.
      return inflateSync(obj.stream.subarray(1)).toString('latin1');
    } catch {
      warnings.push(`object ${obj.num}: compressed stream could not be inflated`);
      return '';
    }
  }
}

/** Pages in file order, each as the list of its content-stream objects. */
function orderedPages(objects) {
  const byNum = new Map(objects.map((o) => [o.num, o]));
  const pages = [];

  for (const obj of objects) {
    if (!/\/Type\s*\/Page[^s]/.test(`${obj.dict} `)) continue;
    const m = /\/Contents\s+(\[[^\]]*\]|\d+\s+\d+\s+R)/.exec(obj.dict);
    if (!m) { pages.push([]); continue; }

    const refs = [...m[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((r) => Number(r[1]));
    pages.push(refs.map((n) => byNum.get(n)).filter(Boolean));
  }
  return pages;
}

// --- content stream -------------------------------------------------------

/**
 * Walk the content stream's text operators. Positioning operators become line
 * breaks, which is the only structure a PDF actually offers.
 */
function extractText(content) {
  let out = '';
  let cid = 0;

  const re = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>|\[|\]|(-?\d*\.?\d+)|(BT|ET|T\*|Td|TD|Tm|TJ|Tj|'|")/g;
  let pending = [];
  let m;

  while ((m = re.exec(content))) {
    const tok = m[0];

    if (tok[0] === '(') { pending.push({ s: decodeLiteral(tok.slice(1, -1)) }); continue; }
    if (tok[0] === '<') {
      const hex = tok.slice(1, -1).replace(/\s+/g, '');
      const { text, isCid } = decodeHex(hex);
      if (isCid) cid++;
      pending.push({ s: text });
      continue;
    }
    if (tok === '[' || tok === ']') continue;
    if (m[1] !== undefined) { pending.push({ n: Number(m[1]) }); continue; }

    switch (tok) {
      case 'Tj':
      case "'":
      case '"':
        out += pending.map((p) => p.s || '').join('');
        if (tok !== 'Tj') out += '\n';
        pending = [];
        break;
      case 'TJ':
        // Numbers are kerning in thousandths of an em; a big gap is a space.
        out += pending.map((p) => (p.s !== undefined ? p.s : p.n <= -120 ? ' ' : '')).join('');
        pending = [];
        break;
      case 'Td':
      case 'TD':
      case 'T*':
      case 'Tm':
        out += '\n';
        pending = [];
        break;
      case 'BT':
      case 'ET':
        out += '\n';
        pending = [];
        break;
      default:
        pending = [];
    }
  }
  return { text: out, cid };
}

/**
 * WinAnsiEncoding differs from Latin-1 exactly in 0x80-0x9F, and that range is
 * where business documents keep their punctuation: en and em dashes, curly
 * quotes, the ellipsis, the bullet. Mapping it costs one table and stops the
 * text layer arriving full of control characters.
 */
const WIN_ANSI_HIGH = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…',
  0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š',
  0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’',
  0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
  0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ',
  0x9e: 'ž', 0x9f: 'Ÿ',
};

const winAnsi = (code) => WIN_ANSI_HIGH[code] || String.fromCharCode(code);

function decodeLiteral(s) {
  const out = s.replace(/\\(\d{1,3}|.)/gs, (m0, e) => {
    if (/^\d/.test(e)) return String.fromCharCode(parseInt(e, 8) & 0xff);
    switch (e) {
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case 'b': return '\b';
      case 'f': return '\f';
      case '\n': return '';
      default: return e;
    }
  });
  return [...out].map((ch) => winAnsi(ch.charCodeAt(0))).join('');
}

function decodeHex(hex) {
  if (hex.length % 4 === 0 && hex.length > 0) {
    // Even 2-byte grouping is the Identity-H signature. Without the embedded
    // CMap these are glyph indices, not characters, so decoding would produce
    // convincing nonsense. Report instead.
    const codes = hex.match(/.{4}/g).map((h) => parseInt(h, 16));
    const printable = codes.filter((c) => c >= 32 && c <= 0x2fff).length;
    if (printable / codes.length < 0.5) return { text: '', isCid: true };
  }
  const bytes = hex.length % 2 ? `${hex}0` : hex;
  const chars = (bytes.match(/.{2}/g) || []).map((h) => winAnsi(parseInt(h, 16)));
  return { text: chars.join(''), isCid: false };
}

function tidy(text) {
  return text
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trimEnd())
    .filter((l, i, a) => l.trim() || (i > 0 && a[i - 1].trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const isPdf = (name) => extname(name).toLowerCase() === '.pdf';
