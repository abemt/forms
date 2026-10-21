// Confirm no "Shift Narrative" section exists in a job's PDF and Word output.
//   node scripts/check-narrative.mjs <jobId>
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { PDFDocument } from 'pdf-lib';

const id = process.argv[2];
const out = path.resolve(`server/data/jobs/${id}/output`);
const pdf = await PDFDocument.load(await readFile(path.join(out, 'Editable', 'Form001.pdf')));
const pdfHas = pdf.getForm().getFields().some((f) => /narrative/i.test(f.getName()));
const pdfText = Buffer.from(await readFile(path.join(out, 'Printable', 'Form001.pdf'))).toString('latin1');
const docx = new AdmZip(await readFile(path.join(out, 'Printable', 'Form001.docx')));
const docxHas = /Shift Narrative/.test(docx.getEntry('word/document.xml').getData().toString('utf8'));
console.log(`PDF narrative field: ${pdfHas ? 'PRESENT' : 'absent'}; PDF drawn label: ${/Shift Narrative/.test(pdfText) ? 'PRESENT' : 'absent'}; DOCX narrative: ${docxHas ? 'PRESENT' : 'absent'}`);
