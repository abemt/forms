// Turn already-delivered editable Form §680 PDFs into Word copies WITHOUT
// re-deriving anything: every field value is read straight out of the PDF's
// form and written into the agency's Word template, so the Word file says
// exactly what the auditor already saw. Signatures stay as typed initials
// (the PDFs carried no signature images).
//   node scripts/pdfs-to-docx.mjs "<folder with FormNNN.pdf>" <outDir>
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFCheckBox, PDFDocument, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFTextField } from 'pdf-lib';
import { fillDocxTemplate } from '../server/dist/services/docxFormFiller.js';
import { docxParagraphs, parseForm680Spec } from '../server/dist/services/docxTemplate.js';

const [inDir, outDir] = process.argv.slice(2);
if (!inDir || !outDir) {
  console.error('usage: node scripts/pdfs-to-docx.mjs <pdfDir> <outDir>');
  process.exit(1);
}
await mkdir(outDir, { recursive: true });
const template = new Uint8Array(await readFile('server/assets/form680-default.docx'));
const spec = parseForm680Spec(docxParagraphs(template));

const files = (await readdir(inDir)).filter((f) => /^Form\d+\.pdf$/i.test(f)).sort();
let total = 0;
for (const file of files) {
  const doc = await PDFDocument.load(await readFile(path.join(inDir, file)), { ignoreEncryption: true });
  const values = {};
  for (const field of doc.getForm().getFields()) {
    const name = field.getName();
    if (field instanceof PDFTextField) {
      const text = field.getText();
      if (text) values[name] = text;
    } else if (field instanceof PDFCheckBox) {
      if (field.isChecked()) values[name] = true;
    } else if (field instanceof PDFRadioGroup) {
      const selected = field.getSelected();
      if (selected) values[name] = selected;
    } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
      const selected = field.getSelected();
      if (selected.length) values[name] = selected[0];
    }
  }
  const bytes = await fillDocxTemplate(template, spec, values, {});
  await writeFile(path.join(outDir, file.replace(/\.pdf$/i, '.docx')), bytes);
  total++;
}
console.log(`${total} PDFs -> ${outDir}`);
