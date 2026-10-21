// Diagnostic: PDF metadata (producer/creator), page count, AcroForm fields.
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
const bytes = await readFile(process.argv[2]);
const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
console.log('producer:', doc.getProducer());
console.log('creator :', doc.getCreator());
console.log('pages   :', doc.getPageCount());
let fields = [];
try { fields = doc.getForm().getFields(); } catch { /* no form */ }
const kinds = {};
for (const f of fields) kinds[f.constructor.name] = (kinds[f.constructor.name] ?? 0) + 1;
console.log('fields  :', fields.length, JSON.stringify(kinds));
