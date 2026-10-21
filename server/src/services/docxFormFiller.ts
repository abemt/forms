import AdmZip from 'adm-zip';
import type { FieldValue } from '../types.js';
import type { Form680Spec } from './template680.js';
import { decodeXml } from './docxTemplate.js';
import { config } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('docx-fill');

/**
 * Fills the agency's own Word §680 template with a shift's values, so the
 * Word printable is the real form — same tables, fonts and checkboxes — with
 * the boxes ticked, the blanks written in and the staff signature placed on
 * the signature line.
 *
 * Works directly on word/document.xml: Word checkbox content controls are
 * flipped to checked, text runs are appended into the writing areas, and a
 * PNG signature is embedded as an inline picture.
 */

type Values = Record<string, FieldValue>;

const CHECKED = '\u2612';
const UNCHECKED = '\u2610';

// --------------------------------------------------------------------------
// small XML helpers
// --------------------------------------------------------------------------

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Plain text of an XML fragment (checkbox glyphs removed; paragraphs space-separated). */
function textOf(fragment: string): string {
  return [...fragment.replace(/<\/w:p>/g, '<w:t> </w:t></w:p>').matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)]
    .map((m) => decodeXml(m[1]))
    .join('')
    .replace(/[\u2610\u2611\u2612]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Run properties of the first text run in a paragraph, without bold (values are regular weight). */
function valueRPr(paragraphXml: string): string {
  const afterPPr = paragraphXml.includes('</w:pPr>') ? paragraphXml.slice(paragraphXml.indexOf('</w:pPr>') + 8) : paragraphXml;
  const m = afterPPr.match(/<w:r(?:\s[^>]*)?>\s*(<w:rPr>[\s\S]*?<\/w:rPr>)/);
  if (!m) return '';
  return m[1].replace(/<w:b(?:Cs)?(?:\s[^>]*)?\/>/g, '').replace(/<w:rFonts[^>]*MS Gothic[^>]*\/>/g, '');
}

/** A text run; newlines become line breaks. */
function run(text: string, rPr = ''): string {
  const lines = text.split(/\r?\n/);
  return lines
    .map((line, i) => `<w:r>${rPr}${i > 0 ? '<w:br/>' : ''}<w:t xml:space="preserve">${esc(line)}</w:t></w:r>`)
    .join('');
}

const PARA = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>|<w:p\/>/g;

interface Span {
  start: number;
  end: number;
}

/** Paragraphs of a region (no nesting inside table cells here). */
function paragraphs(region: string): (Span & { xml: string; text: string })[] {
  return [...region.matchAll(PARA)].map((m) => ({
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
    xml: m[0],
    text: textOf(m[0]),
  }));
}

/** Rows of top-level tables (a row that contains a nested table spans it whole). */
function topLevelRows(xml: string): (Span & { text: string })[] {
  const rows: (Span & { text: string })[] = [];
  const re = /<(\/)?(w:tbl|w:tr)(?=[\s>/])[^>]*>/g;
  let depth = 0;
  let rowStart = -1;
  for (const m of xml.matchAll(re)) {
    const closing = m[1] === '/';
    if (m[2] === 'w:tbl') {
      depth += closing ? -1 : 1;
      continue;
    }
    if (depth !== 1) continue;
    if (!closing) rowStart = m.index ?? 0;
    else if (rowStart >= 0) {
      const end = (m.index ?? 0) + m[0].length;
      rows.push({ start: rowStart, end, text: textOf(xml.slice(rowStart, end)) });
      rowStart = -1;
    }
  }
  return rows;
}

function splice(xml: string, span: Span, replacement: string): string {
  return xml.slice(0, span.start) + replacement + xml.slice(span.end);
}

function insertBeforeParagraphEnd(paragraphXml: string, runsXml: string): string {
  if (paragraphXml.endsWith('<w:p/>')) return `<w:p>${runsXml}</w:p>`;
  return paragraphXml.replace(/<\/w:p>$/, `${runsXml}</w:p>`);
}

/**
 * Tick every checkbox content control whose label (the text that follows it
 * in the same paragraph) satisfies `wanted`. Returns the new region and how
 * many boxes were ticked.
 */
function tickBoxes(region: string, wanted: (label: string) => boolean): { xml: string; ticked: number } {
  let ticked = 0;
  const out = region.replace(PARA, (para) => {
    if (!para.includes('<w:sdt>')) return para;
    const sdts = [...para.matchAll(/<w:sdt>[\s\S]*?<\/w:sdt>/g)];
    let result = '';
    let cursor = 0;
    for (let i = 0; i < sdts.length; i++) {
      const s = sdts[i];
      const start = s.index ?? 0;
      const end = start + s[0].length;
      const labelEnd = i + 1 < sdts.length ? (sdts[i + 1].index ?? para.length) : para.length;
      const label = textOf(para.slice(end, labelEnd)).replace(/_+/g, '').trim();
      result += para.slice(cursor, start);
      if (label && wanted(label)) {
        ticked++;
        result += s[0]
          .replace(/<w14:checked w14:val="(?:0|false)"\/>/, '<w14:checked w14:val="1"/>')
          .replace(UNCHECKED, CHECKED);
      } else {
        result += s[0];
      }
      cursor = end;
    }
    return result + para.slice(cursor);
  });
  return { xml: out, ticked };
}

/**
 * Checklists drawn as [empty box cell][label cell] (no glyphs): put a ☒ into
 * the empty cell that precedes each wanted label cell. Returns the new region
 * and how many boxes were ticked.
 */
function tickBoxCells(region: string, wanted: (label: string) => boolean): { xml: string; ticked: number } {
  const cells = [...region.matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)];
  let ticked = 0;
  let out = region;
  // Bottom-up so earlier offsets stay valid.
  for (let i = cells.length - 1; i >= 1; i--) {
    const label = textOf(cells[i][0]).replace(/_+/g, '').trim();
    if (!label || !wanted(label)) continue;
    const box = cells[i - 1];
    if (textOf(box[0]) !== '') continue;
    const rPr = '<w:rPr><w:rFonts w:ascii="MS Gothic" w:eastAsia="MS Gothic" w:hAnsi="MS Gothic" w:cs="MS Gothic" w:hint="eastAsia"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>';
    const mark = `<w:r>${rPr}<w:t>${CHECKED}</w:t></w:r>`;
    let boxXml = box[0].replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>|<w:p\/>/, (p) =>
      insertBeforeParagraphEnd(p.endsWith('<w:p/>') ? '<w:p></w:p>' : p, mark),
    );
    // The box cell is only ~0.17" wide: drop its side padding so the mark fits.
    if (!/<w:tcMar>/.test(boxXml)) {
      boxXml = boxXml.replace(/<\/w:tcPr>/, '<w:tcMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tcMar></w:tcPr>');
    }
    out = out.slice(0, box.index ?? 0) + boxXml + out.slice((box.index ?? 0) + box[0].length);
    ticked++;
  }
  return { xml: out, ticked };
}

/**
 * Write `text` into an empty paragraph after the paragraph matching `after`,
 * leaving `gap` blank paragraphs in between (extra paragraphs are inserted
 * when the template has too few).
 */
function writeAfter(region: string, after: (text: string) => boolean, text: string, gap = 0): string {
  const paras = paragraphs(region);
  const idx = paras.findIndex((p) => after(p.text));
  if (idx < 0) return region;
  const rPr = valueRPr(paras[idx].xml);
  const empties = paras.slice(idx + 1).filter((p) => p.text === '');
  const target = empties[gap];
  if (target) return splice(region, target, insertBeforeParagraphEnd(target.xml, run(text, rPr)));
  const anchor = paras[idx];
  const pPr = anchor.xml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? '';
  const missing = gap - empties.length; // blank paragraphs still needed before the text
  const blanks = `<w:p>${pPr}</w:p>`.repeat(Math.max(0, missing));
  const insertAt = empties.length > 0 ? empties[empties.length - 1].end : anchor.end;
  return splice(region, { start: insertAt, end: insertAt }, `${blanks}<w:p>${pPr}${run(text, rPr)}</w:p>`);
}

/** Append `text` to the end of the paragraph matching `where`. */
function appendTo(region: string, where: (text: string) => boolean, text: string): string {
  const paras = paragraphs(region);
  const p = paras.find((x) => where(x.text));
  if (!p) return region;
  return splice(region, p, insertBeforeParagraphEnd(p.xml, run(text, valueRPr(p.xml))));
}

/** Replace the underscore blank of the paragraph matching `where` with `text`. */
function fillBlank(region: string, where: (text: string) => boolean, text: string): string {
  const paras = paragraphs(region);
  const p = paras.find((x) => where(x.text));
  if (!p) return region;
  let replaced = false;
  let xml = p.xml.replace(/(<w:t(?:\s[^>]*)?>)([^<]*_{3,}[^<]*)(<\/w:t>)/, (_m, open: string, body: string, close: string) => {
    replaced = true;
    return `${open.includes('xml:space') ? open : open.replace('>', ' xml:space="preserve">')}${esc(body.replace(/_{3,}/, text))}${close}`;
  });
  // The rest of a blank that continues in further runs would trail the text.
  if (replaced) xml = xml.replace(/(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g, (m, open: string, body: string, close: string) => (/_{3,}/.test(body) ? `${open}${body.replace(/_{3,}/g, '')}${close}` : m));
  return splice(region, p, replaced ? xml : insertBeforeParagraphEnd(p.xml, run(` ${text}`, valueRPr(p.xml))));
}

// --------------------------------------------------------------------------
// signature picture
// --------------------------------------------------------------------------

function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

const EMU_PER_INCH = 914400;

function pictureRun(rId: string, png: Uint8Array): string {
  const dims = pngSize(png) ?? { width: 4, height: 1 };
  const maxW = 2.0 * EMU_PER_INCH;
  const maxH = 0.5 * EMU_PER_INCH;
  const scale = Math.min(maxW / dims.width, maxH / dims.height);
  const cx = Math.round(dims.width * scale);
  const cy = Math.round(dims.height * scale);
  // Lower the picture so it straddles the text baseline like ink on the line
  // instead of standing on top of it (w:position is in half-points).
  const drop = -Math.round((cy / EMU_PER_INCH) * 72 * 0.45 * 2);
  return (
    `<w:r><w:rPr><w:position w:val="${drop}"/></w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="9001" name="Staff signature"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="signature.png"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
  );
}

function addPngPart(zip: AdmZip, png: Uint8Array): string {
  const rId = 'rIdSig1';
  zip.addFile('word/media/signature1.png', Buffer.from(png));
  const relsEntry = zip.getEntry('word/_rels/document.xml.rels');
  let rels = relsEntry?.getData().toString('utf8') ?? '';
  if (!rels.includes(`Id="${rId}"`)) {
    rels = rels.replace(
      '</Relationships>',
      `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/signature1.png"/></Relationships>`,
    );
    zip.updateFile('word/_rels/document.xml.rels', Buffer.from(rels, 'utf8'));
  }
  const ctEntry = zip.getEntry('[Content_Types].xml');
  let ct = ctEntry?.getData().toString('utf8') ?? '';
  if (!/Extension="png"/i.test(ct)) {
    ct = ct.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>');
    zip.updateFile('[Content_Types].xml', Buffer.from(ct, 'utf8'));
  }
  return rId;
}

// --------------------------------------------------------------------------
// the fill
// --------------------------------------------------------------------------

function lookup(values: Values) {
  const map = new Map<string, FieldValue>();
  for (const [k, v] of Object.entries(values)) map.set(norm(k), v);
  return {
    str(name: string): string {
      const v = map.get(norm(name));
      return typeof v === 'string' ? v.trim() : v === true ? 'Yes' : '';
    },
    bool(name: string): boolean {
      const v = map.get(norm(name));
      return v === true || (typeof v === 'string' && /^(yes|true|on|checked)$/i.test(v));
    },
  };
}

export async function fillDocxTemplate(
  templateBytes: Uint8Array,
  spec: Form680Spec,
  values: Values,
  options: { signaturePng?: Uint8Array } = {},
): Promise<Uint8Array> {
  const zip = new AdmZip(Buffer.from(templateBytes));
  const entry = zip.getEntry('word/document.xml');
  if (!entry) throw new Error('word/document.xml not found in the Word template');
  let xml = entry.getData().toString('utf8');
  const v = lookup(values);
  const startsWith = (prefix: string) => (text: string) => norm(text).startsWith(norm(prefix));
  const labelIs = (label: string) => (text: string) => norm(text) === norm(label);

  // Edits are applied bottom-up so earlier row offsets stay valid.
  const rows = topLevelRows(xml);
  const edits: { span: Span; xml: string }[] = [];
  const edit = (span: Span, replacement: string): void => {
    edits.push({ span, xml: replacement });
  };

  // ---- identity + shift -------------------------------------------------------
  const identity = rows.find((r) => /\bName\s*:/.test(r.text) && /\bDate\s*:/.test(r.text));
  if (identity) {
    let region = xml.slice(identity.start, identity.end);
    const date = v.str('Date');
    if (date) region = appendTo(region, (t) => /^Date\s*:?$/i.test(t), ` ${date}`);
    edit(identity, region);
  }
  const shiftRow = rows.find((r) => /^Shift\b/i.test(r.text));
  if (shiftRow) {
    const wanted = spec.shiftOptions.filter((o) => v.bool(`Shift: ${o}`)).map(norm);
    const { xml: region } = tickBoxes(xml.slice(shiftRow.start, shiftRow.end), (label) => wanted.includes(norm(label)));
    edit(shiftRow, region);
  }

  // ---- mood -------------------------------------------------------------------
  const moodRow = rows.find((r) => /moods? observed/i.test(r.text));
  if (moodRow) {
    let region = xml.slice(moodRow.start, moodRow.end);
    const description = v.str('Mood Description');
    if (description) {
      // The writing area is the empty paragraph before the nested checklist table.
      const tbl = region.indexOf('<w:tbl>');
      const head = tbl > 0 ? region.slice(0, tbl) : region;
      const empty = paragraphs(head).find((p) => p.text === '');
      if (empty) region = splice(region, empty, insertBeforeParagraphEnd(empty.xml, run(description)));
      else {
        // No writing row: the description goes on the header bar, after its label.
        const header = rows.find((r) => /describe the individual.{0,2}s mood/i.test(r.text));
        if (header) edit(header, appendTo(xml.slice(header.start, header.end), (t) => /^describe the individual.{0,2}s mood/i.test(t), `  ${description}`));
      }
    }
    const wantedMoods = new Set(spec.moods.filter((m) => v.bool(`Mood: ${m}`)).map(norm));
    const other = v.str('Mood: Other');
    const wantMood = (label: string) => wantedMoods.has(norm(label)) || (Boolean(other) && /^other\b/i.test(label));
    const ticked = tickBoxes(region, wantMood);
    region = ticked.xml;
    // Glyph-less checklist (box cells): nothing to flip in the label paragraphs.
    if (ticked.ticked === 0 && (wantedMoods.size > 0 || other) && !/[\u2610\u2612]/.test(region.slice(region.indexOf('<w:tbl>')))) {
      region = tickBoxCells(region, wantMood).xml;
    }
    if (other) region = fillBlank(region, (t) => /^other\s*:/i.test(t), ` ${other}`);
    edit(moodRow, region);
  }

  // ---- activities -------------------------------------------------------------
  const activityRow = rows.find((r) => /individual activity\s*:/i.test(r.text));
  if (activityRow) {
    let region = xml.slice(activityRow.start, activityRow.end);
    for (const kind of ['Individual', 'Group', 'Community']) {
      const text = v.str(`${kind} Activity`);
      if (text) region = fillBlank(region, startsWith(`${kind} Activity`), text);
    }
    edit(activityRow, region);
  }

  // ---- support sections -------------------------------------------------------
  // Two sections can share a heading ("Outcome 2" twice on one plan): each
  // takes the next unused matching row.
  const usedHeadRows = new Set<number>();
  for (const section of spec.sections) {
    const headPrefix = section.title.split(':')[0];
    const headIdx = rows.findIndex(
      (r, i) => !usedHeadRows.has(i) && startsWith(headPrefix)(r.text) && norm(r.text).startsWith(norm(section.title.slice(0, 24))),
    );
    if (headIdx < 0) continue;
    usedHeadRows.add(headIdx);
    const typeRow = rows.slice(headIdx + 1, headIdx + 4).find((r) => /^type of supports? provided/i.test(r.text));
    if (!typeRow) continue;
    let region = xml.slice(typeRow.start, typeRow.end);
    const type = v.str(`${section.id} - Support Type`);
    if (type) region = tickBoxes(region, labelIs(type)).xml;
    const doc = v.str(`${section.id} - Documentation`);
    // One blank line between the printed instructions and the staff's entry.
    if (doc) region = writeAfter(region, (t) => /^instructions\s*:/i.test(t), doc, 1);
    edit(typeRow, region);
  }

  // ---- end-of-shift questions --------------------------------------------------
  for (const q of spec.yesNoQuestions) {
    const qIdx = rows.findIndex((r) => norm(r.text).startsWith(norm(q.question.slice(0, 30))));
    if (qIdx < 0) continue;
    const answerRow = rows.slice(qIdx + 1, qIdx + 3).find((r) => /^yes\b/i.test(r.text));
    if (!answerRow) continue;
    let region = xml.slice(answerRow.start, answerRow.end);
    const answer = v.str(q.id);
    if (/^yes$/i.test(answer)) region = tickBoxes(region, (l) => /^yes$/i.test(l)).xml;
    else if (/^no$/i.test(answer)) region = tickBoxes(region, (l) => /^no$/i.test(l)).xml;
    const explanation = v.str(`${q.id} Explanation`);
    if (explanation) region = appendTo(region, (t) => /^if yes, please explain\s*:?$/i.test(t), ` ${explanation}`);
    edit(answerRow, region);
  }

  // Apply table edits bottom-up.
  edits.sort((a, b) => b.span.start - a.span.start);
  for (const e of edits) xml = splice(xml, e.span, e.xml);

  // ---- shift narrative (a boxed section between the supports and the questions)
  const narrative = config.narrativeSection ? v.str('Shift Narrative') : '';
  if (narrative) {
    const lastSection = topLevelRows(xml).filter((r) => /^type of supports? provided/i.test(r.text)).pop();
    const firstQuestion = topLevelRows(xml).find((r) => spec.yesNoQuestions.some((q) => norm(r.text).startsWith(norm(q.question.slice(0, 30)))));
    if (lastSection && firstQuestion) {
      const tableEnd = xml.indexOf('</w:tbl>', lastSection.end) + '</w:tbl>'.length;
      const nextTable = xml.lastIndexOf('<w:tbl>', firstQuestion.start);
      if (tableEnd > 0 && nextTable > tableEnd) {
        // Borrow the questions table's frame so the box matches the form.
        const questionsTable = xml.slice(nextTable, xml.indexOf('</w:tblPr>', nextTable) + '</w:tblPr>'.length);
        let tblPr = questionsTable.match(/<w:tblPr>[\s\S]*?<\/w:tblPr>/)?.[0] ?? '<w:tblPr><w:tblW w:w="10980" w:type="dxa"/></w:tblPr>';
        tblPr = tblPr.replace(/<w:tblLook[^>]*\/>/, '');
        const widthMatch = tblPr.match(/<w:tblW w:w="(\d+)"/);
        const width = widthMatch ? widthMatch[1] : '10980';
        const headerTcPr =
          xml.slice(firstQuestion.start, firstQuestion.end).match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/)?.[0].replace(/<w:gridSpan[^>]*\/>/, '') ??
          `<w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="CCCCCC"/></w:tcPr>`;
        const headerRPr = xml.slice(firstQuestion.start, firstQuestion.end).match(/<w:r(?:\s[^>]*)?>\s*(<w:rPr>[\s\S]*?<\/w:rPr>)/)?.[1] ?? '<w:rPr><w:b/></w:rPr>';
        const bodyRPr = headerRPr.replace(/<w:b(?:Cs)?(?:\s[^>]*)?\/>/g, '');
        const cellMar = '<w:tcMar><w:top w:w="100" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tcMar>';
        const table =
          `<w:tbl>${tblPr}<w:tblGrid><w:gridCol w:w="${width}"/></w:tblGrid>` +
          `<w:tr><w:tc>${headerTcPr}<w:p><w:pPr><w:widowControl w:val="0"/></w:pPr>${run('Shift Narrative (Progress Notes):', headerRPr)}</w:p></w:tc></w:tr>` +
          `<w:tr><w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${cellMar}</w:tcPr><w:p><w:pPr><w:widowControl w:val="0"/></w:pPr>${run(narrative, bodyRPr)}</w:p></w:tc></w:tr>` +
          '</w:tbl>';
        // A paragraph on each side keeps Word from merging neighbouring tables.
        xml = `${xml.slice(0, tableEnd)}<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p>${table}<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p>${xml.slice(nextTable)}`;
      }
    }
  }

  // ---- staff line -----------------------------------------------------------------
  xml = normalizeStaffLine(xml);
  const staffPara = staffLabelParagraph(xml);
  if (staffPara) {
    const labelRPr = staffPara.xml.match(/<w:r(?:\s[^>]*)?>\s*(<w:rPr>[\s\S]*?<\/w:rPr>)/)?.[1] ?? '';
    const valueRunPr = labelRPr.replace(/<w:b(?:Cs)?(?:\s[^>]*)?\/>/g, '');
    const pPr = staffPara.xml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? '<w:pPr></w:pPr>';

    let signatureRun: string;
    if (options.signaturePng) {
      const rId = addPngPart(zip, options.signaturePng);
      signatureRun = pictureRun(rId, options.signaturePng);
    } else {
      signatureRun = run(v.str('Staff Signature'), valueRunPr.replace('</w:rPr>', '<w:i/></w:rPr>'));
    }
    // Values sit on the line above the labels (the rule is the labels' top
    // border); keepNext stops a page break from separating the two lines.
    const valuesPPr = pPr
      .replace(/<w:pBdr>[\s\S]*?<\/w:pBdr>/, '')
      .replace('<w:pPr>', '<w:pPr><w:keepNext/><w:keepLines/>');
    const valuesPara =
      `<w:p>${valuesPPr}` +
      run(v.str('Staff Name'), valueRunPr) + `<w:r>${valueRunPr}<w:tab/></w:r>` +
      run(v.str('Staff Title'), valueRunPr) + `<w:r>${valueRunPr}<w:tab/></w:r>` +
      signatureRun + `<w:r>${valueRunPr}<w:tab/></w:r>` +
      run(v.str('Signature Date') || v.str('Date'), valueRunPr) + '</w:p>';

    // Replace the empty paragraph right above the labels with the values line,
    // and drop two more spacer paragraphs + the trailing empty one so the
    // taller signature line cannot push a blank page at the end.
    let head = xml.slice(0, staffPara.start);
    let tail = xml.slice(staffPara.start);
    const emptyBefore = /(<w:p(?:\s[^>]*)?>(?:(?!<w:p[\s>/])[\s\S])*?<\/w:p>|<w:p\/>)\s*$/;
    for (let i = 0; i < 3; i++) {
      const m = head.match(emptyBefore);
      if (!m || textOf(m[1]) !== '') break;
      head = head.slice(0, head.length - m[0].length);
    }
    const labelEnd = tail.indexOf('</w:p>') + '</w:p>'.length;
    const afterLabel = tail.slice(labelEnd);
    const sect = afterLabel.indexOf('<w:sectPr');
    if (sect >= 0) {
      const between = afterLabel.slice(0, sect).replace(PARA, (p) => (textOf(p) === '' ? '' : p));
      tail = tail.slice(0, labelEnd) + between + afterLabel.slice(sect);
    }
    xml = head + valuesPara + tail;
  }

  zip.updateFile('word/document.xml', Buffer.from(xml, 'utf8'));
  stripEmbeddedFonts(zip);
  log.info('Word template filled');
  return new Uint8Array(zip.toBuffer());
}

/**
 * Templates exported from Google Docs embed every font they use (several MB
 * per file). The fonts are the standard Windows ones, so the printable copies
 * drop them; a template without embedded fonts is left as it is.
 */
function stripEmbeddedFonts(zip: AdmZip): void {
  const fonts = zip.getEntries().filter((e) => /^word\/fonts\//.test(e.entryName));
  if (fonts.length === 0) return;
  for (const e of fonts) zip.deleteFile(e.entryName);
  const update = (name: string, edit: (text: string) => string): void => {
    const entry = zip.getEntry(name);
    if (!entry) return;
    const text = entry.getData().toString('utf8');
    const next = edit(text);
    if (next !== text) zip.updateFile(name, Buffer.from(next, 'utf8'));
  };
  update('word/fontTable.xml', (t) =>
    t.replace(/<w:embed(?:Regular|Bold|Italic|BoldItalic)\b[^>]*\/>/g, '').replace(/<w:embed(?:Regular|Bold|Italic|BoldItalic)\b[^>]*>[\s\S]*?<\/w:embed\w+>/g, ''),
  );
  update('word/_rels/fontTable.xml.rels', (t) => t.replace(/<Relationship\b[^>]*relationships\/font"[^>]*\/>/g, ''));
  update('[Content_Types].xml', (t) => t.replace(/<Default Extension="odttf"[^>]*\/>/g, ''));
  update('word/settings.xml', (t) => t.replace(/<w:(?:embedTrueTypeFonts|saveSubsetFonts|embedSystemFonts)\b[^>]*\/>/g, ''));
  log.info(`dropped ${fonts.length} embedded font file(s) from the Word output`);
}

// --------------------------------------------------------------------------
// staff line normalization (shared with the exact-layout PDF template)
// --------------------------------------------------------------------------

const STAFF_TABS =
  '<w:tabs><w:tab w:val="left" w:pos="3200"/><w:tab w:val="left" w:pos="5200"/><w:tab w:val="left" w:pos="8200"/></w:tabs>';

function staffLabelParagraph(xml: string): (Span & { xml: string; text: string }) | undefined {
  return paragraphs(xml).find((p) => /staff name/i.test(p.text) && /signature/i.test(p.text));
}

/** <w:tabs> must follow <w:pBdr>/<w:widowControl> to keep Word's element order. */
function withTabs(pPr: string): string {
  if (pPr.includes('<w:tabs>')) return pPr;
  if (pPr.includes('</w:pBdr>')) return pPr.replace('</w:pBdr>', `</w:pBdr>${STAFF_TABS}`);
  if (pPr.includes('<w:widowControl')) return pPr.replace(/(<w:widowControl[^>]*\/>)/, `$1${STAFF_TABS}`);
  return pPr.replace('<w:pPr>', `<w:pPr>${STAFF_TABS}`);
}

/**
 * Rewrite the "Staff Name / Title / Signature / Date" label line with fixed
 * tab columns. The template relies on default tab stops, which wrap or drift
 * depending on the font that renders it.
 */
export function normalizeStaffLine(xml: string): string {
  const p = staffLabelParagraph(xml);
  if (!p || p.xml.includes('<w:tabs>')) return xml;
  const labelRPr = p.xml.match(/<w:r(?:\s[^>]*)?>\s*(<w:rPr>[\s\S]*?<\/w:rPr>)/)?.[1] ?? '';
  const pPr = p.xml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? '<w:pPr></w:pPr>';
  const tab = `<w:r>${labelRPr}<w:tab/></w:r>`;
  const labelPara =
    `<w:p>${withTabs(pPr)}` +
    run('Staff Name', labelRPr) + tab +
    run('Title', labelRPr) + tab +
    run('Signature', labelRPr) + tab +
    run('Date', labelRPr) + '</w:p>';
  return splice(xml, p, labelPara);
}

/** The template .docx with the staff line normalized (used before LibreOffice renders it). */
export function prepareTemplateDocx(bytes: Uint8Array): Uint8Array {
  try {
    const zip = new AdmZip(Buffer.from(bytes));
    const entry = zip.getEntry('word/document.xml');
    if (!entry) return bytes;
    const xml = entry.getData().toString('utf8');
    const fixed = normalizeStaffLine(xml);
    if (fixed === xml) return bytes;
    zip.updateFile('word/document.xml', Buffer.from(fixed, 'utf8'));
    return new Uint8Array(zip.toBuffer());
  } catch {
    return bytes;
  }
}
