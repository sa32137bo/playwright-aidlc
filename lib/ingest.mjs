import { existsSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve, relative, basename, extname, dirname } from 'node:path';
import { c, ok, warn, info, bad, head, ensureDir, loadConfig, get } from './util.mjs';
import { convertDocx } from './docx.mjs';
import { convertPdf } from './pdf.mjs';

/**
 * Turn the business documents in inputs/ into Markdown the rest of the kit can
 * actually read.
 *
 * This runs before any agent does. It costs no tokens because no model is
 * involved: a .docx is a ZIP of XML and a .pdf has a text layer, and both are
 * mechanical to read. The kit used to ask the agent to do this by hand, which
 * paid a model to do a parser's job and left nothing reviewable behind.
 *
 * The output is the artifact that matters: a human reads it before Gate 1, git
 * diffs it when the business reissues the document, and the audit trail points
 * at it. Content that exists only as pixels comes out as an [IMAGE: ...]
 * placeholder pointing at the extracted file - never as a guess at what the
 * picture said.
 */

const SUPPORTED = new Set(['.docx', '.pdf']);

export async function ingest(args) {
  const root = resolve(args.root || process.cwd());
  const cfg = loadConfig(root);

  const targets = collect(root, cfg, args);
  if (!targets.length) {
    head('Ingest');
    info('no .docx or .pdf files found — nothing to convert');
    info(`looked in: ${searchDirs(root, cfg, args).map((d) => relative(root, d) || '.').join(', ')}`);
    console.log();
    return { converted: 0, skipped: 0, failed: 0 };
  }

  head(`Ingest — ${targets.length} document(s)`);

  let converted = 0;
  let skipped = 0;
  let failed = 0;
  const followUps = [];

  for (const file of targets) {
    const rel = relative(root, file) || basename(file);
    const outFile = file.replace(/\.(docx|pdf)$/i, '.md');

    console.log(`\n  ${c.bold(basename(file))}`);

    if (existsSync(outFile) && !args.force) {
      info(`${basename(outFile)} exists — left alone (use --force to replace)`);
      skipped++;
      continue;
    }

    try {
      const buf = readFileSync(file);
      const ext = extname(file).toLowerCase();
      const result = ext === '.docx'
        ? convertDocx(buf, { name: basename(file) })
        : convertPdf(buf, { name: basename(file) });

      // A PDF with no text layer is a scan. Writing a near-empty .md here would
      // look like a successful conversion and quietly starve the planner.
      if (ext === '.pdf' && !result.hasTextLayer) {
        bad('no text layer — this PDF is scanned or image-only, nothing was written');
        info(`${result.stats.pages} page(s), ${result.stats.images} image(s) found`);
        followUps.push(
          `${rel} has no text layer. Ask Claude Code to read it directly:\n` +
          `        Read ${rel} with the pages parameter (max 20 pages per call) and\n` +
          `        write the requirements to ${relative(root, outFile)} verbatim.`
        );
        failed++;
        continue;
      }

      const mediaDir = join(dirname(file), result.mediaDir);
      if (result.media.length) {
        ensureDir(mediaDir);
        for (const m of result.media) writeFileSync(join(mediaDir, m.file), m.data);
      }

      writeFileSync(outFile, frontMatter(basename(file), result) + result.markdown + '\n', 'utf8');
      converted++;

      ok(`${basename(outFile)} — ${summarise(result.stats)}`);
      if (result.media.length) {
        ok(`${result.media.length} image(s) -> ${result.mediaDir}/`);
      }
      for (const w of result.warnings) warn(w);

      // The signal that matters most: structure went missing into pictures.
      if (result.stats.images > 0 && !result.stats.tables) {
        warn(
          'no tables, but ' + result.stats.images + ' image(s) — if this document ' +
          'carries field rules, formats or limits in tables, they are inside those ' +
          'images and are NOT in the Markdown'
        );
      }
    } catch (err) {
      bad(`${err.message}`);
      failed++;
    }
  }

  console.log();
  head('Summary');
  ok(`${converted} converted`);
  if (skipped) info(`${skipped} skipped (already converted)`);
  if (failed) warn(`${failed} need attention`);

  if (followUps.length) {
    console.log(`\n${c.bold('Needs Claude Code:')}`);
    for (const f of followUps) console.log(`  ${c.yellow('!')} ${f}`);
  }

  console.log(`
${c.dim('The .md files are now the grounding source. Originals are left in place as')}
${c.dim('provenance; the kit reads the Markdown. Check any table before Gate 1 —')}
${c.dim('that is where the testable detail lives.')}
`);

  return { converted, skipped, failed };
}

function summarise(s) {
  const parts = [];
  if (s.headings) parts.push(`${s.headings} headings`);
  if (s.tables) parts.push(`${s.tables} tables (${s.tableRows} rows)`);
  if (s.listItems) parts.push(`${s.listItems} list items`);
  if (s.paragraphs) parts.push(`${s.paragraphs} paragraphs`);
  if (s.pages) parts.push(`${s.pages} pages`);
  if (s.chars) parts.push(`${(s.chars / 1024).toFixed(1)} KB of text`);
  return parts.length ? parts.join(', ') : 'no content recovered';
}

function frontMatter(source, result) {
  const lines = [
    '---',
    `source: "${source}"`,
    `converted: "${new Date().toISOString()}"`,
    'converter: "pw-aidlc ingest — deterministic, no model involved"',
  ];
  if (result.media.length) lines.push(`images: ${result.media.length} extracted to ${result.mediaDir}/`);
  if (result.stats.tables !== undefined) lines.push(`tables: ${result.stats.tables}`);
  if (result.warnings.length) {
    lines.push('extraction_warnings:');
    for (const w of result.warnings) lines.push(`  - "${w.replace(/"/g, "'")}"`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

function searchDirs(root, cfg, args) {
  if (args.file) return [dirname(resolve(root, args.file))];
  if (args.dir) return [resolve(root, args.dir)];
  const reqs = get(cfg, 'inputs.requirements_dir', 'inputs/requirements');
  const stories = get(cfg, 'inputs.stories_dir', 'inputs/stories');
  const contracts = get(cfg, 'inputs.contracts_dir', 'inputs/contracts');
  return [reqs, stories, contracts].map((d) => resolve(root, d));
}

function collect(root, cfg, args) {
  if (args.file) {
    const p = resolve(root, args.file);
    if (!existsSync(p)) throw new Error(`no such file: ${args.file}`);
    return SUPPORTED.has(extname(p).toLowerCase()) ? [p] : [];
  }

  const out = [];
  for (const dir of searchDirs(root, cfg, args)) {
    if (!existsSync(dir)) continue;
    walk(dir, out);
  }
  return out.sort();
}

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Extracted media folders are output, not input.
      if (entry.name.endsWith('.media')) continue;
      walk(p, out);
    } else if (SUPPORTED.has(extname(entry.name).toLowerCase())) {
      if (statSync(p).size > 0) out.push(p);
    }
  }
}
