import {
  PDFDict,
  PDFDocument,
  PDFFont,
  PDFForm,
  PDFName,
  PDFPage,
  PDFString,
  PDFTextField,
  StandardFonts,
  rgb,
} from 'pdf-lib';
import type { Form680Spec } from './template680.js';
import { convertDocxToPdfExact } from './soffice.js';
import { refreshAppearances } from './appearances.js';
import { prepareTemplateDocx } from './docxFormFiller.js';
import { extractPdfTextItems, type PdfTextItem, type PdfTextPage } from './pdfText.js';
import { config } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('faithful-template');

/**
 * Exact-fidelity template builder.
 *
 * The uploaded Word document is rendered to a PDF by headless LibreOffice so
 * the output looks *identical* to the original template. AcroForm widgets
 * (text fields, checkboxes, radio groups) are then overlaid at coordinates
 * detected from the rendered text: every ☐ glyph becomes a real checkbox or
 * radio option, every writing area becomes an editable text field.
 *
 * Field names follow the same conventions as the built-in generator
 * ("Mood: Happy", "Outcome 2 - Support Type", "Medication Received", ...) so
 * both extraction engines map onto the result unchanged.
 */

const GLYPH = /^[\u2610\u2611\u2612\u25A1\u25FB\u274F]$/;

interface Line {
  page: number;
  y: number;
  items: PdfTextItem[];
  text: string;
}

interface SectionHeading {
  kind: string;
  num: number;
  id: string;
}

function buildLines(pages: PdfTextPage[]): Line[] {
  const lines: Line[] = [];
  pages.forEach((page, pageIndex) => {
    const byY = new Map<number, PdfTextItem[]>();
    for (const item of page.items) {
      // Bucket to 2pt so items of one visual line group together.
      let key: number | undefined;
      for (const existing of byY.keys()) {
        if (Math.abs(existing - item.y) <= 2) {
          key = existing;
          break;
        }
      }
      if (key === undefined) key = item.y;
      const bucket = byY.get(key) ?? [];
      bucket.push(item);
      byY.set(key, bucket);
    }
    for (const [y, items] of byY) {
      items.sort((a, b) => a.x - b.x);
      lines.push({
        page: pageIndex,
        y,
        items,
        text: items
          .map((i) => i.str)
          .join('')
          .replace(/\s+/g, ' ')
          .trim(),
      });
    }
  });
  lines.sort((a, b) => (a.page !== b.page ? a.page - b.page : b.y - a.y));
  return lines;
}

/** Non-space text items right of `fromX` until the next glyph (or line end). */
function labelAfter(line: Line, fromX: number): { text: string; endX: number } {
  let text = '';
  let endX = fromX;
  for (const item of line.items) {
    if (item.x < fromX) continue;
    if (GLYPH.test(item.str.trim()) && item.x > fromX + 1) break;
    if (item.h === 0 || !item.str.trim()) continue; // layout spacer
    text += item.str;
    endX = Math.max(endX, item.x + item.w);
  }
  return { text: text.replace(/\s+/g, ' ').trim(), endX };
}

const SECTION_LINE =
  /^(Outcome|Identified Risk|Potential Risk|Routine Support|(?:Other )?Medical|(?:Other )?Behavioral)\s*#?\s*(\d+)\s*:/i;

function normalizeKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Width of the empty box cell drawn left of a glyph-less mood label (241 twips + cell padding). */
const MOOD_BOX_CELL = 18;

export async function buildFaithfulTemplate(
  docxBytes: Uint8Array,
  spec: Form680Spec,
): Promise<Uint8Array> {
  // Same staff-line tab stops as the Word printable, so the labels render on
  // one line and the two outputs match.
  const flatPdf = await convertDocxToPdfExact(prepareTemplateDocx(docxBytes));
  const textPages = await extractPdfTextItems(flatPdf);
  const lines = buildLines(textPages);

  const doc = await PDFDocument.load(flatPdf);
  doc.setTitle('Daily Progress Note - Form § 680');
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const form = doc.getForm();
  ensureDrFont(form, 'Helv', helv);
  const pages = doc.getPages();
  const pageFor = (line: Line): PDFPage => pages[line.page];
  const rightEdge = (line: Line): number => textPages[line.page].width - 54;

  const created = new Set<string>();
  const textField = (
    name: string,
    page: PDFPage,
    rect: { x: number; y: number; width: number; height: number },
    options: { multiline?: boolean; size?: number } = {},
  ): void => {
    if (created.has(name) || rect.width < 8 || rect.height < 7) return;
    created.add(name);
    const tf = form.createTextField(name);
    if (options.multiline !== false) tf.enableMultiline();
    tf.addToPage(page, { ...rect, borderWidth: 0 });
    setTextFieldFont(tf, options.size ?? 8);
  };
  const checkbox = (name: string, page: PDFPage, glyph: PdfTextItem): void => {
    if (created.has(name)) return;
    created.add(name);
    const cb = form.createCheckBox(name);
    cb.addToPage(page, { x: glyph.x - 0.4, y: glyph.y - 0.6, width: 8, height: 9.4, borderWidth: 0 });
  };
  /** Checkbox inside the empty bordered cell that precedes a label item. */
  const cellCheckbox = (name: string, page: PDFPage, label: PdfTextItem): void => {
    if (created.has(name)) return;
    created.add(name);
    const cb = form.createCheckBox(name);
    cb.addToPage(page, { x: label.x - MOOD_BOX_CELL + 2.5, y: label.y - 1, width: 8.5, height: 9.4, borderWidth: 0 });
  };

  // Match rendered mood labels back to the spec's exact wording.
  const moodByKey = new Map(spec.moods.map((m) => [normalizeKey(m), m]));
  const resolveMood = (text: string): string | undefined => {
    // Long labels wrap onto a second line in the render ("Sad/Pained/Worried"
    // + "Expression"): resolve by prefix so the field keeps the full name.
    const key = normalizeKey(text);
    if (!key) return undefined;
    return moodByKey.get(key) ?? (key.length >= 4 ? spec.moods.find((m) => normalizeKey(m).startsWith(key)) : undefined);
  };
  // Several sections may share a number ("Outcome 2" twice on one plan): hand
  // out their ids in document order.
  const sectionIds = new Map<string, string[]>();
  for (const section of spec.sections) {
    const m = section.id.match(/^([A-Za-z ]+?)\s*(\d+)/);
    if (!m) continue;
    const key = `${normalizeKey(m[1])}:${Number(m[2])}`;
    sectionIds.set(key, [...(sectionIds.get(key) ?? []), section.id]);
  }
  const questionKeys = spec.yesNoQuestions.map((q) => normalizeKey(q.question).slice(0, 30));
  const isQuestionLine = (text: string): boolean => {
    const key = normalizeKey(text);
    return key.length >= 12 && questionKeys.some((q) => key.startsWith(q) || q.startsWith(key));
  };

  type Phase = 'top' | 'moods' | 'body';
  let phase: Phase = 'top';
  let moodBoxTop: Line | undefined;
  let currentSection: SectionHeading | undefined;
  let radioPending:
    | { id: string; group: ReturnType<PDFForm['createRadioGroup']>; index: number }
    | undefined;
  let docPending: { id: string } | undefined;
  let questionIndex = 0;
  let pendingQuestionId: string | undefined;
  const staffLabels: { name: string; line: Line; item: PdfTextItem }[] = [];

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const page = pageFor(line);
    const glyphs = line.items.filter((i) => GLYPH.test(i.str.trim()));

    // ---- Identity row -----------------------------------------------------
    if (phase === 'top') {
      const dateItem = line.items.find((i) => /^Date:?$/i.test(i.str.trim()));
      if (dateItem && !created.has('Date')) {
        textField(
          'Date',
          page,
          {
            x: dateItem.x + dateItem.w + 4,
            y: dateItem.y - 3.5,
            width: rightEdge(line) - (dateItem.x + dateItem.w + 4) - 4,
            height: 13,
          },
          { multiline: false, size: 9 },
        );
      }
      if (/^Shift \(Start and End Time\)/i.test(line.text) && glyphs.length > 0) {
        for (const glyph of glyphs) {
          const { text } = labelAfter(line, glyph.x + glyph.w);
          const label =
            spec.shiftOptions.find((o) => normalizeKey(o) === normalizeKey(text)) ?? text;
          if (label) checkbox(`Shift: ${label}`, page, glyph);
        }
        continue;
      }
      if (/describe the individual.{0,2}s mood/i.test(line.text)) {
        moodBoxTop = line;
        phase = 'moods';
        continue;
      }
    }

    // ---- Mood section -----------------------------------------------------
    if (phase === 'moods') {
      if (/^Moods Observed Throughout/i.test(line.text)) {
        if (moodBoxTop) {
          const top = moodBoxTop.y - 7;
          const bottom = line.y + 12;
          if (top - bottom >= 12) {
            textField('Mood Description', page, {
              x: 58,
              y: bottom,
              width: rightEdge(line) - 58 - 4,
              height: Math.max(top - bottom, 14),
            });
          } else {
            // No writing row between the header and the checklist: use the
            // free part of the header bar, right of its label.
            const labelEnd = Math.max(...moodBoxTop.items.filter((i) => i.str.trim()).map((i) => i.x + i.w));
            textField(
              'Mood Description',
              page,
              { x: labelEnd + 6, y: moodBoxTop.y - 3.5, width: rightEdge(line) - labelEnd - 10, height: 12.5 },
              { multiline: false, size: 8 },
            );
          }
        }
        continue;
      }
      if (/describe the individual.{0,2}s activities/i.test(line.text)) {
        phase = 'body';
        continue;
      }
      if (glyphs.length === 0) {
        // Checklist drawn as [empty box cell][label cell]: every label item
        // on the line gets a checkbox in the cell to its left.
        for (const item of line.items) {
          const text = item.str.trim();
          if (!text || item.h === 0) continue;
          if (/^Other\b/i.test(text)) {
            cellCheckbox('Mood: Other Checked', page, item);
            textField(
              'Mood: Other',
              page,
              { x: item.x + item.w + 3, y: item.y - 2.5, width: 95, height: 11.5 },
              { multiline: false, size: 8 },
            );
            continue;
          }
          const label = resolveMood(text);
          if (label) cellCheckbox(`Mood: ${label}`, page, item);
        }
        continue;
      }
      for (const glyph of glyphs) {
        const { text, endX } = labelAfter(line, glyph.x + glyph.w);
        if (/^Other\b/i.test(text)) {
          // The "Other" entry is both a tick and a write-in.
          checkbox('Mood: Other Checked', page, glyph);
          const labelEnd = line.items.find((i) => /Other/i.test(i.str) && i.x >= glyph.x);
          const x = labelEnd ? labelEnd.x + helv.widthOfTextAtSize('Other: ', 8.5) + 2 : endX;
          textField(
            'Mood: Other',
            page,
            { x, y: glyph.y - 2.5, width: 120, height: 11.5 },
            { multiline: false, size: 8 },
          );
          continue;
        }
        const label = resolveMood(text) ?? text;
        if (label) checkbox(`Mood: ${label}`, page, glyph);
      }
      continue;
    }

    // ---- Activities, sections, questions, staff ---------------------------
    const activity = line.text.match(/^(Individual|Group|Community) Activity\s*:/i);
    if (activity) {
      const labelItem = line.items.find((i) => /Activity/i.test(i.str));
      // Label and its underscore blank may be one text item: measure the label alone.
      const labelEndX = labelItem
        ? labelItem.str.includes('_')
          ? labelItem.x + helv.widthOfTextAtSize(activity[0], labelItem.h || 9) + 2
          : labelItem.x + labelItem.w
        : line.items[0].x + helv.widthOfTextAtSize(activity[0], 9);
      const kind = activity[1][0].toUpperCase() + activity[1].slice(1).toLowerCase();
      textField(`${kind} Activity`, page, {
        x: labelEndX + 4,
        y: line.y - 13,
        width: rightEdge(line) - labelEndX - 8,
        height: 22,
      });
      continue;
    }

    const heading = line.text.match(SECTION_LINE);
    if (heading) {
      const kind = heading[1].replace(/\s+/g, ' ');
      const num = Number(heading[2]);
      const id = sectionIds.get(`${normalizeKey(kind)}:${num}`)?.shift();
      if (id) {
        currentSection = { kind, num, id };
        radioPending = undefined;
        docPending = { id };
      }
      continue;
    }

    if (/^TYPE OF SUPPORTS/i.test(line.text) && currentSection) {
      radioPending = {
        id: currentSection.id,
        group: form.createRadioGroup(`${currentSection.id} - Support Type`),
        index: 0,
      };
      created.add(`${currentSection.id} - Support Type`);
      // The "Instructions:" paragraph of the right-hand cell shares this
      // visual row, so fall through to the instructions handler below.
    }

    const instr = line.items.find((i) => /^Instructions:/i.test(i.str.trim()));
    if (instr && docPending) {
      // Documentation area: right cell below the instructions paragraph. The
      // cell's bottom tracks the support-option stack (or the page margin
      // when the row continues on the next page).
      const sectionGlyphYs: number[] = [];
      for (let lj = li + 1; lj < lines.length && lines[lj].page === line.page; lj++) {
        if (SECTION_LINE.test(lines[lj].text) || isQuestionLine(lines[lj].text)) break;
        for (const g of lines[lj].items) {
          if (GLYPH.test(g.str.trim()) && g.x < instr.x - 20) sectionGlyphYs.push(g.y);
        }
      }
      const bottom = sectionGlyphYs.length > 0 ? Math.min(...sectionGlyphYs) - 7 : 42;
      const top = instr.y - 21;
      if (top - bottom >= 14) {
        textField(
          `${docPending.id} - Documentation`,
          page,
          {
            x: instr.x,
            y: bottom,
            width: rightEdge(line) - instr.x - 4,
            height: top - bottom,
          },
          { size: 7.5 },
        );
      } else {
        // The row is split by a page break: there is no room under the
        // instructions on this page, and the option stack continues on the
        // next page beside an empty right-hand cell. Place the field there
        // instead of letting it ride up over the instructions text.
        const contYs: number[] = [];
        let contPage: number | undefined;
        for (let lj = li + 1; lj < lines.length; lj++) {
          const l2 = lines[lj];
          if (l2.page === line.page) continue;
          if (contPage === undefined) contPage = l2.page;
          if (l2.page !== contPage) break;
          if (SECTION_LINE.test(l2.text) || isQuestionLine(l2.text)) break;
          if (l2.items.some((g) => GLYPH.test(g.str.trim()) && g.x < instr.x - 20)) {
            contYs.push(l2.y);
          }
        }
        if (contPage !== undefined && contYs.length > 0) {
          textField(
            `${docPending.id} - Documentation`,
            pages[contPage],
            {
              x: instr.x,
              y: Math.min(...contYs) - 7,
              width: textPages[contPage].width - 54 - instr.x - 4,
              height: Math.max(Math.max(...contYs) + 10 - (Math.min(...contYs) - 7), 14),
            },
            { size: 7.5 },
          );
        } else {
          // No continuation found — keep the field strictly below the
          // instructions so it can never overlap them.
          textField(
            `${docPending.id} - Documentation`,
            page,
            { x: instr.x, y: top - 14, width: rightEdge(line) - instr.x - 4, height: 14 },
            { size: 7.5 },
          );
        }
      }
      docPending = undefined;
      continue;
    }

    if (radioPending && glyphs.length > 0 && !isQuestionLine(line.text)) {
      for (const glyph of glyphs) {
        if (radioPending.index >= spec.supportTypeOptions.length) break;
        const option = spec.supportTypeOptions[radioPending.index++];
        radioPending.group.addOptionToPage(option, page, {
          x: glyph.x - 0.4,
          y: glyph.y - 0.6,
          width: 8,
          height: 9.4,
          borderWidth: 0,
        });
      }
      if (radioPending.index >= spec.supportTypeOptions.length) radioPending = undefined;
      continue;
    }

    if (isQuestionLine(line.text) && glyphs.length === 0 && questionIndex < spec.yesNoQuestions.length) {
      pendingQuestionId = spec.yesNoQuestions[questionIndex].id;
      questionIndex += 1;
      radioPending = undefined;
      continue;
    }

    if (pendingQuestionId && glyphs.length > 0) {
      const group = form.createRadioGroup(pendingQuestionId);
      created.add(pendingQuestionId);
      for (const glyph of glyphs) {
        const { text } = labelAfter(line, glyph.x + glyph.w);
        const option = /^no/i.test(text) ? 'No' : 'Yes';
        group.addOptionToPage(option, page, {
          x: glyph.x - 0.4,
          y: glyph.y - 0.6,
          width: 8,
          height: 9.4,
          borderWidth: 0,
        });
      }
      const explain = line.items.find((i) => /if yes,? please explain/i.test(i.str));
      if (explain) {
        const x = explain.x + explain.w + 4;
        textField(
          `${pendingQuestionId} Explanation`,
          page,
          { x, y: line.y - 14.5, width: rightEdge(line) - x - 4, height: 24 },
          { size: 7.5 },
        );
      }
      pendingQuestionId = undefined;
      continue;
    }
    // Explanation label rendered on its own line (layout variant).
    const soloExplain = line.items.find((i) => /if yes,? please explain/i.test(i.str));
    if (soloExplain && created.size > 0) {
      const lastQuestion = spec.yesNoQuestions[questionIndex - 1];
      if (lastQuestion && !created.has(`${lastQuestion.id} Explanation`)) {
        const x = soloExplain.x + soloExplain.w + 4;
        textField(
          `${lastQuestion.id} Explanation`,
          page,
          { x, y: line.y - 14.5, width: rightEdge(line) - x - 4, height: 24 },
          { size: 7.5 },
        );
      }
    }

    for (const item of line.items) {
      const label = item.str.trim();
      if (/^Staff Name$/i.test(label)) staffLabels.push({ name: 'Staff Name', line, item });
      else if (/^Title$/i.test(label)) staffLabels.push({ name: 'Staff Title', line, item });
      else if (/^Signature$/i.test(label)) staffLabels.push({ name: 'Staff Signature', line, item });
      else if (/^Date$/i.test(label) && questionIndex >= spec.yesNoQuestions.length) {
        staffLabels.push({ name: 'Signature Date', line, item });
      }
    }
  }

  // ---- Shift narrative: the free space between the supports and the questions
  const firstQuestion = lines.find((l) =>
    spec.yesNoQuestions.some((q) => normalizeKey(l.text).startsWith(normalizeKey(q.question.slice(0, 25)))),
  );
  if (config.narrativeSection && firstQuestion && !created.has('Shift Narrative')) {
    const above = lines.filter((l) => l.page === firstQuestion.page && l.y > firstQuestion.y + 30);
    if (above.length > 0) {
      const page = pageFor(firstQuestion);
      const sectionsBottom = Math.min(...above.map((l) => l.y)) - 18;
      const questionsTop = firstQuestion.y + 26;
      const x = 54;
      const width = textPages[firstQuestion.page].width - 108;
      const headerH = 17;
      if (sectionsBottom - questionsTop >= 44) {
        // Same look as the form's shaded section headers.
        page.drawRectangle({
          x,
          y: sectionsBottom - headerH,
          width,
          height: headerH,
          color: rgb(0.8, 0.8, 0.8),
          borderWidth: 0.8,
          borderColor: rgb(0, 0, 0),
        });
        page.drawRectangle({
          x,
          y: questionsTop,
          width,
          height: sectionsBottom - headerH - questionsTop,
          borderWidth: 0.8,
          borderColor: rgb(0, 0, 0),
        });
        page.drawText('Shift Narrative (Progress Notes):', {
          x: x + 5,
          y: sectionsBottom - headerH + 5,
          size: 8.5,
          font: helvBold,
        });
        textField(
          'Shift Narrative',
          page,
          { x: x + 4, y: questionsTop + 2, width: width - 8, height: sectionsBottom - headerH - 2 - (questionsTop + 2) },
          { size: 8 },
        );
      }
    }
  }

  // ---- Staff footer: write on the rule above the labels --------------------
  for (let i = 0; i < staffLabels.length; i++) {
    const { name, line, item } = staffLabels[i];
    const next = staffLabels[i + 1];
    const width = next && next.line === line ? next.item.x - item.x - 14 : rightEdge(line) - item.x;
    // A real signature needs room: its box rises well above the rule.
    const height = name === 'Staff Signature' ? 30 : 13;
    textField(
      name,
      pageFor(line),
      { x: item.x, y: item.y + 11.5, width: Math.max(width, 60), height },
      { multiline: false, size: 8.5 },
    );
  }

  // pdf-lib paints widgets with a white background and black border by
  // default, which would hide the printed ☐ glyphs and clip label text.
  // Strip the decoration (/MK) from every widget, then regenerate every
  // appearance stream with fully transparent providers (empty when off,
  // check mark / dot only when on) so the printed page shows through.
  for (const field of form.getFields()) {
    for (const widget of field.acroField.getWidgets()) {
      widget.dict.delete(PDFName.of('MK'));
    }
  }
  refreshAppearances(form, helv);

  const fieldCount = form.getFields().length;
  if (fieldCount < 40) {
    throw new Error(
      `faithful overlay produced only ${fieldCount} fields — layout not recognized`,
    );
  }
  log.info(`faithful template built: ${fieldCount} fields over ${pages.length} page(s)`);
  return doc.save();
}

/** Write the /DA string directly (fresh pdf-lib fields have none). */
function setTextFieldFont(field: PDFTextField, size: number): void {
  field.acroField.dict.set(PDFName.of('DA'), PDFString.of(`/Helv ${size} Tf 0 g`));
}

/** Register a font in the AcroForm default resources so /DA strings resolve. */
function ensureDrFont(form: PDFForm, name: string, font: PDFFont): void {
  const acroDict = form.acroForm.dict;
  const context = acroDict.context;
  let dr = acroDict.lookupMaybe(PDFName.of('DR'), PDFDict);
  if (!dr) {
    dr = context.obj({});
    acroDict.set(PDFName.of('DR'), dr);
  }
  let fonts = dr.lookupMaybe(PDFName.of('Font'), PDFDict);
  if (!fonts) {
    fonts = context.obj({});
    dr.set(PDFName.of('Font'), fonts);
  }
  fonts.set(PDFName.of(name), font.ref);
}
