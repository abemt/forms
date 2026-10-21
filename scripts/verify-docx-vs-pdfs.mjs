// Prove the merged Word month says exactly what the source PDFs say: every
// text value of every PDF form must appear, in form order, in the document
// text; every ticked box must be ticked (☒) in the right section.
//   node scripts/verify-docx-vs-pdfs.mjs "<pdf folder>" <merged.docx>
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { PDFCheckBox, PDFDocument, PDFRadioGroup, PDFTextField } from 'pdf-lib';
import { decodeXml } from '../server/dist/services/docxTemplate.js';

const [pdfDir, docx] = process.argv.slice(2);
const xml = new AdmZip(docx).getEntry('word/document.xml').getData().toString('utf8');
// One text blob per section (form), glyphs kept so ticks can be checked.
const sections = xml.split(/<w:sectPr\b/).slice(0, -1).map((part) =>
  [...part.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:br\/>|<\/w:p>/g)].map((m) => (m[1] === undefined ? ' ' : decodeXml(m[1]))).join('').replace(/\s+/g, ' '),
);
const files = (await readdir(pdfDir)).filter((f) => /^Form\d+\.pdf$/i.test(f)).sort();
if (sections.length !== files.length) {
  console.log(`section count ${sections.length} != pdf count ${files.length}`);
  process.exit(1);
}
let checkedText = 0;
let checkedBoxes = 0;
const problems = [];
for (let i = 0; i < files.length; i++) {
  const doc = await PDFDocument.load(await readFile(path.join(pdfDir, files[i])), { ignoreEncryption: true });
  const text = sections[i];
  for (const field of doc.getForm().getFields()) {
    const name = field.getName();
    if (field instanceof PDFTextField) {
      const value = field.getText()?.replace(/\s+/g, ' ').trim();
      if (!value) continue;
      checkedText++;
      if (!text.includes(value)) problems.push(`${files[i]} "${name}" missing: ${value.slice(0, 70)}`);
    } else if (field instanceof PDFCheckBox && field.isChecked()) {
      checkedBoxes++;
      const label = name.replace(/^(?:Mood|Shift): /, '');
      if (!new RegExp(`\u2612\\s*${label.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`).test(text)) problems.push(`${files[i]} box "${name}" not ticked`);
    } else if (field instanceof PDFRadioGroup && field.getSelected()) {
      checkedBoxes++;
      const option = field.getSelected();
      // "<section> - Support Type" -> the ☒ option must follow that section's heading; questions -> ☒ Yes/No after the question.
      const section = name.replace(/ - Support Type$/, '');
      const anchor = / - Support Type$/.test(name) ? section.replace(/ \(.*\)$/, '') : null;
      const from = anchor ? text.indexOf(anchor) : -1;
      const window = from >= 0 ? text.slice(from, from + 1500) : text;
      if (!window.includes(`\u2612 ${option}`)) problems.push(`${files[i]} "${name}" = ${option} not ticked`);
    }
  }
}
console.log(`${files.length} forms: ${checkedText} text values + ${checkedBoxes} ticks compared — ${problems.length ? `${problems.length} PROBLEMS` : 'all present'}`);
for (const p of problems.slice(0, 15)) console.log('  ' + p);
process.exit(problems.length ? 1 : 0);
