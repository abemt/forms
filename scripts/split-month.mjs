// Split a month into small print jobs a home printer can swallow: one Word file
// per run of N calendar days (default 4 days ≈ 12 forms ≈ 84 pages), named by
// date range, plus an INDEX.txt that says which form is in which file.
//
// --printed-through <day>: the client already printed up to that day. Days
// before it go into a "Part0 … ALREADY-PRINTED" file (for reference only), that
// day alone becomes a "CHECK-YOUR-STACK" file (reprint only if it was cut off),
// and the remaining days are chunked normally.
//
//   node scripts/split-month.mjs --job <jobId> --label Steven_August2026 --out <dir> [--days 4] [--printed-through 13]
//   node scripts/split-month.mjs --pdfs "<folder of FormNNN.pdf>" --docx "<folder of FormNNN.docx>" --label Steven_May2026 --out <dir> [--days 4]
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { PDFCheckBox, PDFDocument, PDFTextField } from 'pdf-lib';
import { mergeDocxFiles } from './merge-docx-forms.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const label = opt('label');
const outDir = opt('out');
const daysPerPart = Number(opt('days', '4'));
const printedThrough = opt('printed-through') ? Number(opt('printed-through')) : undefined;
if (!label || !outDir) {
  console.error('usage: see header of scripts/split-month.mjs');
  process.exit(1);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const parseDate = (text) => {
  const m = text.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  return m ? { month: m[1], day: Number(m[2]), year: Number(m[3]) } : undefined;
};

// ---- one record per form: file, date, shift, staff ---------------------------
let forms = [];
if (opt('job')) {
  const id = opt('job');
  const job = JSON.parse(await readFile(`server/data/jobs/${id}/job.json`, 'utf8'));
  const dir = path.resolve(`server/data/jobs/${id}/output/Printable`);
  forms = job.shifts.map((s) => {
    const no = String(s.index + 1).padStart(3, '0');
    const staff = (s.overrides?.['Staff Name'] ?? s.assignments.find((a) => a.field === 'Staff Name')?.value ?? s.provider ?? '').toString().replace(/,?\s*DSP$/i, '');
    return { no, file: path.join(dir, `Form${no}.docx`), ...parseDate(s.date), shift: s.shift, staff };
  });
} else if (opt('pdfs')) {
  const pdfDir = path.resolve(opt('pdfs'));
  const docxDir = path.resolve(opt('docx'));
  for (const f of (await readdir(pdfDir)).filter((n) => /^Form\d+\.pdf$/i.test(n)).sort()) {
    const doc = await PDFDocument.load(await readFile(path.join(pdfDir, f)), { ignoreEncryption: true });
    const fields = doc.getForm().getFields();
    const text = (name) => fields.find((x) => x.getName() === name && x instanceof PDFTextField)?.getText() ?? '';
    const shift = fields.find((x) => x instanceof PDFCheckBox && /^Shift: /.test(x.getName()) && x.isChecked())?.getName().replace(/^Shift: /, '') ?? '';
    const no = f.match(/(\d+)/)[1];
    forms.push({ no, file: path.join(docxDir, `Form${no}.docx`), ...parseDate(text('Date')), shift, staff: text('Staff Name') });
  }
} else {
  throw new Error('need --job or --pdfs/--docx');
}
if (forms.some((f) => !f.day)) throw new Error('some forms have no readable date');

// ---- group into parts -----------------------------------------------------------
const mon = (f) => f.month.slice(0, 3);
const dd = (n) => String(n).padStart(2, '0');
const rangeName = (group) => (group[0].day === group.at(-1).day ? `${mon(group[0])}${dd(group[0].day)}` : `${mon(group[0])}${dd(group[0].day)}-${mon(group.at(-1))}${dd(group.at(-1).day)}`);

const parts = [];
const chunkByDays = (list, suffix = '') => {
  const days = [...new Set(list.map((f) => f.day))];
  for (let i = 0; i < days.length; i += daysPerPart) {
    const slice = new Set(days.slice(i, i + daysPerPart));
    parts.push({ forms: list.filter((f) => slice.has(f.day)), suffix });
  }
};
if (printedThrough) {
  const before = forms.filter((f) => f.day < printedThrough);
  const boundary = forms.filter((f) => f.day === printedThrough);
  if (before.length) parts.push({ forms: before, suffix: '_ALREADY-PRINTED' });
  if (boundary.length) parts.push({ forms: boundary, suffix: '_CHECK-YOUR-STACK' });
  chunkByDays(forms.filter((f) => f.day > printedThrough));
} else {
  chunkByDays(forms);
}

// ---- write ------------------------------------------------------------------------
// The out dir is rebuilt from scratch; refuse to wipe a folder that holds other output.
const existing = await readdir(outDir, { withFileTypes: true }).catch(() => []);
if (existing.some((e) => e.isDirectory() || (e.isFile() && !/^(?:INDEX\.txt|.*\.docx)$/i.test(e.name)))) {
  throw new Error(`refusing to replace ${outDir}: it contains other folders/files - use a dedicated folder such as --out ${path.join(outDir, label)}`);
}
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
const index = [`${label.replace(/_/g, ' ')} - print one file at a time, double-sided. Each form starts on a new sheet.`, ''];
let n = 0;
for (const part of parts) {
  const name = `${label}_Part${printedThrough ? n : n + 1}_${rangeName(part.forms)}${part.suffix}.docx`;
  const r = mergeDocxFiles(part.forms.map((f) => f.file), path.join(outDir, name));
  index.push(`${name}  (${r.forms} forms)`);
  for (const f of part.forms) index.push(`    Form${f.no}  ${f.month} ${dd(f.day)}  ${f.shift.padEnd(9)}  ${f.staff}`);
  index.push('');
  console.log(`${name}: ${r.forms} forms, ${(r.bytes / 1024).toFixed(0)} KB`);
  n++;
}
await writeFile(path.join(outDir, 'INDEX.txt'), `\ufeff${index.join('\r\n')}`, 'utf8');
const zip = new AdmZip();
zip.addLocalFolder(outDir, path.basename(outDir));
zip.writeZip(`${outDir}.zip`);
console.log(`${parts.length} parts -> ${outDir}.zip`);
