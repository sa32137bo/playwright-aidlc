import { basename, extname } from 'node:path';
import { readZip, readText, readEntry } from './zip.mjs';
import { parseXml, kid, kids, find, findAll, textOf } from './xml.mjs';

/**
 * .docx -> Markdown, deterministically and with no model in the loop.
 *
 * The point is not just to save tokens. A converted file is a reviewable
 * artifact: a human can read it before Gate 1, git can diff it when the business
 * reissues the document, and the audit trail can point at it. An agent reading
 * the binary directly leaves nothing anyone can check.
 *
 * What it will not do is guess. Content that exists only inside an image comes
 * out as an [IMAGE: ...] placeholder pointing at the extracted file, never as a
 * description. A plan built on a thin extraction should be able to see that it
 * is thin.
 */

export function convertDocx(buf, { name }) {
  const entries = readZip(buf);
  const documentXml = readText(buf, entries, 'word/document.xml');
  if (!documentXml) throw new Error('no word/document.xml — is this really a .docx?');

  const rels = readRels(readText(buf, entries, 'word/_rels/document.xml.rels'));
  const styles = readStyles(readText(buf, entries, 'word/styles.xml'));

  const stem = basename(name, extname(name));
  const mediaDir = `${stem}.media`;

  const ctx = {
    rels,
    styles,
    entries,
    buf,
    mediaDir,
    media: [],
    seenMedia: new Map(),
    lastHeading: '',
    stats: { headings: 0, paragraphs: 0, tables: 0, tableRows: 0, images: 0, listItems: 0 },
    warnings: [],
  };

  const body = find(parseXml(documentXml), 'w:body');
  if (!body) throw new Error('no <w:body> in word/document.xml');

  const blocks = renderBlocks(body, ctx);
  const markdown = blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();

  return { markdown, media: ctx.media, stats: ctx.stats, warnings: ctx.warnings, mediaDir };
}

// --- block level ----------------------------------------------------------

function renderBlocks(node, ctx) {
  const out = [];
  for (const child of node.children || []) {
    if (typeof child === 'string') continue;
    switch (child.name) {
      case 'w:p': {
        const md = renderParagraph(child, ctx);
        if (md) out.push(md);
        break;
      }
      case 'w:tbl':
        out.push(...renderTable(child, ctx));
        break;
      case 'w:sdt': {
        // Content control (a form field or a rich-text placeholder).
        const content = kid(child, 'w:sdtContent');
        if (content) out.push(...renderBlocks(content, ctx));
        break;
      }
      default:
        break;
    }
  }
  return out;
}

function renderParagraph(p, ctx) {
  const pPr = kid(p, 'w:pPr');
  const styleId = kid(pPr, 'w:pStyle')?.attrs['w:val'] || '';
  const styleName = ctx.styles.get(styleId) || styleId;

  const { text, images } = renderInline(p, ctx);
  const level = headingLevel(styleName, pPr);
  const trimmed = text.trim();

  const lines = [];

  if (trimmed && level) {
    ctx.stats.headings++;
    ctx.lastHeading = trimmed;
    lines.push(`${'#'.repeat(Math.min(level, 6))} ${trimmed}`);
  } else if (trimmed) {
    const numPr = kid(pPr, 'w:numPr');
    if (numPr) {
      ctx.stats.listItems++;
      const ilvl = Number(kid(numPr, 'w:ilvl')?.attrs['w:val'] || 0);
      lines.push(`${'  '.repeat(Math.max(0, ilvl))}- ${trimmed}`);
    } else {
      ctx.stats.paragraphs++;
      lines.push(trimmed);
    }
  }

  // Placeholders go after the text of the paragraph that carried them, so the
  // image stays where it sat in the reading order.
  for (const img of images) lines.push(img);

  return lines.join('\n\n');
}

function renderTable(tbl, ctx) {
  const rows = kids(tbl, 'w:tr');
  if (!rows.length) return [];

  const grid = rows.map((tr) =>
    kids(tr, 'w:tc').map((tc) => {
      const parts = [];
      for (const p of kids(tc, 'w:p')) {
        const { text } = renderInline(p, ctx);
        if (text.trim()) parts.push(text.trim());
      }
      return parts.join(' ').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim();
    })
  );

  if (findAll(tbl, 'w:tbl').length) {
    ctx.warnings.push('a nested table was flattened into its parent row');
  }

  const width = Math.max(...grid.map((r) => r.length));
  if (!width) return [];

  const pad = (r) => {
    const copy = r.slice();
    while (copy.length < width) copy.push('');
    return copy;
  };

  ctx.stats.tables++;
  ctx.stats.tableRows += grid.length;

  const [header, ...rest] = grid;
  const out = [
    `| ${pad(header).join(' | ')} |`,
    `|${' --- |'.repeat(width)}`,
    ...rest.map((r) => `| ${pad(r).join(' | ')} |`),
  ];
  return [out.join('\n')];
}

// --- inline level ---------------------------------------------------------

function renderInline(node, ctx, acc = { text: '', images: [] }) {
  for (const child of node.children || []) {
    if (typeof child === 'string') continue;

    switch (child.name) {
      case 'w:r':
        acc.text += renderRun(child, ctx, acc);
        break;

      case 'w:hyperlink': {
        const inner = renderInline(child, ctx, { text: '', images: acc.images });
        const target = ctx.rels.get(child.attrs['r:id'])?.target;
        const label = inner.text.trim();
        if (label && target && /^https?:/i.test(target)) acc.text += `[${label}](${target})`;
        else acc.text += inner.text;
        break;
      }

      // Tracked insertions are part of the current text; deletions are not.
      case 'w:ins':
      case 'w:smartTag':
      case 'w:sdtContent':
      case 'w:sdt':
        renderInline(child, ctx, acc);
        break;

      case 'w:del':
        break;

      default:
        break;
    }
  }
  return acc;
}

function renderRun(r, ctx, acc) {
  const rPr = kid(r, 'w:rPr');
  const bold = !!kid(rPr, 'w:b');
  const italic = !!kid(rPr, 'w:i');

  let text = '';
  for (const child of r.children || []) {
    if (typeof child === 'string') continue;
    switch (child.name) {
      case 'w:t':
        text += textOf(child);
        break;
      case 'w:tab':
        text += ' ';
        break;
      case 'w:br':
      case 'w:cr':
        text += '\n';
        break;
      case 'w:noBreakHyphen':
        text += '-';
        break;
      case 'w:drawing':
      case 'w:pict':
      case 'w:object': {
        const placeholder = extractImage(child, ctx);
        if (placeholder) acc.images.push(placeholder);
        break;
      }
      default:
        break;
    }
  }

  if (!text.trim()) return text;
  // Emphasis wraps the trimmed core so the surrounding spacing survives.
  const lead = text.match(/^\s*/)[0];
  const tail = text.match(/\s*$/)[0];
  let core = text.trim();
  if (bold) core = `**${core}**`;
  if (italic) core = `*${core}*`;
  return `${lead}${core}${tail}`;
}

function extractImage(node, ctx) {
  const blip = find(node, 'a:blip');
  const vml = find(node, 'v:imagedata');
  const rid = blip?.attrs['r:embed'] || blip?.attrs['r:link'] || vml?.attrs['r:id'];
  if (!rid) return null;

  const rel = ctx.rels.get(rid);
  if (!rel) {
    ctx.warnings.push(`image reference ${rid} has no relationship entry`);
    return null;
  }

  const entryName = resolvePart('word', rel.target);
  let file = ctx.seenMedia.get(entryName);

  if (!file) {
    const entry = ctx.entries.get(entryName);
    if (!entry) {
      ctx.warnings.push(`image ${rel.target} is referenced but missing from the archive`);
      return null;
    }
    const data = readEntry(ctx.buf, entry);
    const n = String(ctx.media.length + 1).padStart(2, '0');
    file = `image-${n}${extname(rel.target) || '.png'}`;
    ctx.media.push({ file, data });
    ctx.seenMedia.set(entryName, file);
  }

  ctx.stats.images++;
  const where = ctx.lastHeading ? ` - ${ctx.lastHeading}` : '';
  return `> [IMAGE: ${file}${where}] - content not extracted; open \`${ctx.mediaDir}/${file}\` to read it`;
}

// --- parts ----------------------------------------------------------------

function readRels(xml) {
  const map = new Map();
  if (!xml) return map;
  for (const rel of findAll(parseXml(xml), 'Relationship')) {
    map.set(rel.attrs.Id, { target: rel.attrs.Target || '', type: rel.attrs.Type || '' });
  }
  return map;
}

/**
 * styleId -> human style name. Word writes the *id* on a paragraph, and the id
 * is only "Heading1" by convention — a document authored in another locale, or
 * from a template, can carry any id at all. The name is the reliable signal.
 */
function readStyles(xml) {
  const map = new Map();
  if (!xml) return map;
  for (const style of findAll(parseXml(xml), 'w:style')) {
    const id = style.attrs['w:styleId'];
    const name = kid(style, 'w:name')?.attrs['w:val'];
    if (id && name) map.set(id, name);
  }
  return map;
}

/**
 * Resolve a relationship Target to its entry name in the archive.
 *
 * The leading slash is not decoration. A target beginning "/" is package-
 * absolute; anything else is relative to the folder holding the .rels file.
 * Documents produced by tools other than Word mix both forms, and one of the
 * MDUI business-process documents carries images under *both* "word/media/" and
 * a root-level "media/" with overlapping names. Treating "/media/image10.png"
 * as relative silently returns a different picture — which is worse than
 * returning nothing, because nothing at least gets reported.
 */
function resolvePart(base, target) {
  const t = String(target).replace(/\\/g, '/');
  const segs = (t.startsWith('/') ? t : `${base}/${t}`).split('/');
  const out = [];
  for (const s of segs) {
    if (!s || s === '.') continue;
    if (s === '..') out.pop();
    else out.push(s);
  }
  return out.join('/');
}

function headingLevel(styleName, pPr) {
  const s = String(styleName).toLowerCase().replace(/\s+/g, '');
  const m = /^heading([1-9])$/.exec(s) || /^h([1-9])$/.exec(s);
  if (m) return Number(m[1]);
  if (s === 'title') return 1;
  if (s === 'subtitle') return 2;

  // No recognised style, but Word still records an outline level for anything
  // that appears in the navigation pane. Trust it as a fallback.
  const outline = kid(pPr, 'w:outlineLvl')?.attrs['w:val'];
  if (outline !== undefined && outline !== null && outline !== '') {
    const n = Number(outline);
    if (Number.isFinite(n) && n >= 0 && n <= 8) return n + 1;
  }
  return 0;
}
