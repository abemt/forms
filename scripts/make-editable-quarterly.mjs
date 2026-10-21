/**
 * Convert the rendered quarterly-report PDF into an editable AcroForm PDF.
 *
 * - Every printed checkbox glyph (☐/☒) becomes a real toggleable checkbox,
 *   pre-set to its printed state. Checked glyphs are whited-out and the box
 *   outline is redrawn so unticking one leaves a clean empty square.
 * - Every narrative/describe paragraph (status descriptions, outcome
 *   definitions, plan-change and question answer cells) becomes a multiline
 *   text field pre-filled with the printed text (geometry + text come from
 *   scripts/quarterly-cells.py, spawned automatically).
 * - The "Completed by" name, script signature, and date become editable
 *   text fields (signature keeps the handwriting font).
 * - The ISP Revision Date(s) blanks become fill-in text fields.
 *
 * Usage: node scripts/make-editable-quarterly.mjs <input.pdf> <output.pdf>
 *   CELLS_JSON=<file>  use a precomputed quarterly-cells.py result instead of
 *                      spawning python3 (e.g. when Python only runs in Docker).
 */
import '../server/dist/polyfill.js';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PDFDocument, PDFName, rgb,
  pushGraphicsState, popGraphicsState,
  moveTo, lineTo, stroke, setLineWidth, setStrokingColor,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { extractPdfTextItems } from '../server/dist/services/pdfText.js';
import { registerDrFont, refreshAppearances } from '../server/dist/services/appearances.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const [inputArg, outputArg] = process.argv.slice(2);
if (!inputArg || !outputArg) {
  console.error('usage: node scripts/make-editable-quarterly.mjs <input.pdf> <output.pdf>');
  process.exit(1);
}

const buf = await readFile(inputArg);
const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
const pages = await extractPdfTextItems(bytes);

const doc = await PDFDocument.load(bytes);
doc.registerFontkit(fontkit);
const form = doc.getForm();
const helv = await doc.embedFont('Helvetica');
const sigFontBytes = await readFile(path.join(here, '..', 'server', 'assets', 'signature-script.ttf'));
const sigFont = await doc.embedFont(sigFontBytes, { subset: true });
registerDrFont(form, helv);
registerDrFont(form, sigFont);
// refreshAppearances writes '/SigF 0 Tf' for signature fields; alias it in /DR.
{
  const dr = form.acroForm.dict.lookup(PDFName.of('DR'));
  const fonts = dr.lookup(PDFName.of('Font'));
  fonts.set(PDFName.of('SigF'), sigFont.ref);
}

const black = rgb(0, 0, 0);
const white = rgb(1, 1, 1);

/** ✗-in-place appearance: transparent when off, X strokes when on. */
const xMarkProvider = (_box, widget) => {
  const { width, height } = widget.getRectangle();
  const inset = Math.min(width, height) * 0.18;
  const on = [
    pushGraphicsState(),
    setStrokingColor(black),
    setLineWidth(Math.max(0.9, Math.min(width, height) * 0.11)),
    moveTo(inset, inset), lineTo(width - inset, height - inset), stroke(),
    moveTo(inset, height - inset), lineTo(width - inset, inset), stroke(),
    popGraphicsState(),
  ];
  return { normal: { on, off: [] }, down: { on, off: [] } };
};

// Measured MS Gothic glyph square, relative to item origin (x, baseline y),
// as a fraction of the point size: left 0, right 0.98em, bottom -0.128em,
// top 0.765em (from a 300 dpi calibration render).
function squareRect(item) {
  const fs = item.h;
  return {
    x: item.x,
    y: item.y - 0.128 * fs,
    w: 0.98 * fs,
    h: 0.893 * fs,
  };
}

let boxCount = 0;
let checkedCount = 0;

for (let p = 0; p < pages.length; p++) {
  const page = doc.getPage(p);
  for (const item of pages[p].items) {
    if (item.str !== '\u2610' && item.str !== '\u2612') continue;
    const checked = item.str === '\u2612';
    const sq = squareRect(item);

    if (checked) {
      // Erase the printed ☒ and redraw a clean empty square outline.
      page.drawRectangle({
        x: item.x - 0.75, y: item.y - 0.129 * item.h - 0.75,
        width: item.w + 1.5, height: 0.91 * item.h + 1.5,
        color: white,
      });
      const strokeW = Math.max(0.55, item.h * 0.055);
      page.drawRectangle({
        x: sq.x + strokeW / 2, y: sq.y + strokeW / 2,
        width: sq.w - strokeW, height: sq.h - strokeW,
        borderColor: black, borderWidth: strokeW,
      });
    }

    const field = form.createCheckBox(`chk_p${p + 1}_${++boxCount}`);
    field.addToPage(page, {
      x: sq.x, y: sq.y, width: sq.w, height: sq.h,
      borderWidth: 0,
      // no color / borderColor -> widget has no /MK, transparent style
    });
    // Drop the /MK dict pdf-lib may add so appearances stay transparent.
    for (const w of field.acroField.getWidgets()) w.dict.delete(PDFName.of('MK'));
    if (checked) { field.check(); checkedCount++; }
    field.updateAppearances(xMarkProvider);
  }
}

// ---- narrative / describe paragraphs -> multiline text fields --------------
const cellPages = process.env.CELLS_JSON
  ? JSON.parse(await readFile(process.env.CELLS_JSON, 'utf8'))
  : JSON.parse(execFileSync('python3',
    [path.join(here, 'quarterly-cells.py'), inputArg], { maxBuffer: 64 * 1024 * 1024 }).toString());

let paraCount = 0;
for (const pg of cellPages) {
  const page = doc.getPage(pg.page - 1);
  const H = pg.height;
  for (const cell of pg.fields) {
    const [x0, yTop, x1, yBottom] = cell.region;
    const rect = { x: x0, y: H - yBottom, width: x1 - x0, height: yBottom - yTop };
    if (rect.width < 20 || rect.height < 10) continue;
    // Erase the printed paragraph; the field re-displays it as editable text.
    page.drawRectangle({ x: rect.x - 1, y: rect.y - 1, width: rect.width + 2, height: rect.height + 2, color: white });
    const f = form.createTextField(`para_p${pg.page}_${++paraCount}`);
    f.enableMultiline();
    f.setText(cell.text || '');
    f.addToPage(page, { ...rect, borderWidth: 0 });
    f.setFontSize(9);
    for (const w of f.acroField.getWidgets()) w.dict.delete(PDFName.of('MK'));
  }
}

// ---- last page: Completed by / signature / date --------------------------
const last = pages.length - 1;
const lastPage = doc.getPage(last);
const items = pages[last].items;
const find = (pred) => items.find(pred);

const nameItem = find((i) => i.str === 'Kierra Crump');
const sigItem = items.filter((i) => i.str === 'Kierra Crump')[1];
const dateItem = find((i) => /^\d{2}\/\d{2}\/\d{4}$/.test(i.str.trim()));
const sigLabel = find((i) => i.str.includes('(signature)'));
const dateLabel = find((i) => i.str.trim() === 'Date:');
if (!nameItem || !sigItem || !dateItem || !sigLabel || !dateLabel) {
  throw new Error('completer line items not found on last page');
}

function textField(name, value, rect, opts = {}) {
  const f = form.createTextField(name);
  f.setText(value);
  f.addToPage(lastPage, { ...rect, borderWidth: 0 });
  for (const w of f.acroField.getWidgets()) w.dict.delete(PDFName.of('MK'));
  if (opts.fontSize) f.setFontSize(opts.fontSize);
  return f;
}

function eraseAndUnderline(x0, x1, baseY, above, below) {
  lastPage.drawRectangle({
    x: x0, y: baseY - below, width: x1 - x0, height: above + below, color: white,
  });
  lastPage.drawLine({
    start: { x: x0, y: baseY - 1.6 }, end: { x: x1, y: baseY - 1.6 },
    thickness: 0.7, color: black,
  });
}

// Name value: between "Completed by:" and "(signature)"
{
  const x0 = nameItem.x - 1.5;
  const x1 = sigLabel.x - 3;
  eraseAndUnderline(x0, x1, nameItem.y, 12, 4);
  textField('completedBy_name', 'Kierra Crump',
    { x: x0, y: nameItem.y - 3, width: x1 - x0, height: 14 }, { fontSize: 10 });
}
// Script signature: between "(signature)" and "Date:"
{
  const x0 = sigLabel.x + sigLabel.w + 2;
  const x1 = dateLabel.x - 4;
  eraseAndUnderline(x0, x1, sigItem.y, 15, 6);
  textField('completedBy_signature', 'Kierra Crump',
    { x: x0, y: sigItem.y - 5.5, width: x1 - x0, height: 19 });
}
// Date value
{
  const x0 = dateItem.x - 1.5;
  const x1 = dateItem.x + dateItem.w + 14;
  eraseAndUnderline(x0, x1, dateItem.y, 12, 4);
  textField('completedBy_date', dateItem.str.trim(),
    { x: x0, y: dateItem.y - 3, width: x1 - x0, height: 14 }, { fontSize: 10 });
}

// ---- ISP Revision Date(s) blanks ------------------------------------------
const revItem = find((i) => i.str.startsWith('ISP Revision Date(s)'));
if (revItem) {
  const perChar = revItem.w / revItem.str.length;
  const runs = [...revItem.str.matchAll(/_+/g)];
  runs.forEach((m, n) => {
    const x0 = revItem.x + m.index * perChar + 2;
    const w = m[0].length * perChar - 4;
    textField(`ispRevisionDate_${n + 1}`, '',
      { x: x0, y: revItem.y - 2, width: w, height: 13 }, { fontSize: 10 });
  });
}

refreshAppearances(form, helv, { signatureFont: sigFont });
// Checkbox appearances were set with the custom X provider; refreshAppearances
// rewrote them with the check-mark provider, so re-apply the X style last.
for (const f of form.getFields()) {
  if (f.constructor.name === 'PDFCheckBox') f.updateAppearances(xMarkProvider);
}

const out = await doc.save();
await writeFile(outputArg, out);
console.log(`fields: ${form.getFields().length} (checkboxes: ${boxCount}, pre-checked: ${checkedCount}, paragraphs: ${paraCount})`);
console.log('saved:', outputArg);
