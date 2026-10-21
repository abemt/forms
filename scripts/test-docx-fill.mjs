// Fill the bundled Word template with one shift of a persisted job and dump
// the result's block structure.   node scripts/test-docx-fill.mjs <jobId> [shiftIndex]
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import AdmZip from 'adm-zip';
import { fillDocxTemplate } from '../server/dist/services/docxFormFiller.js';
import { docxBlocks } from '../server/dist/services/docxLog.js';
import { signatureForProvider } from '../server/dist/services/signatures.js';

const [jobId, indexArg = '0'] = process.argv.slice(2);
const job = JSON.parse(await readFile(`server/data/jobs/${jobId}/job.json`, 'utf8'));
const shift = job.shifts[Number(indexArg)];
const values = {};
for (const a of shift.assignments) values[a.field] = a.value;
for (const [k, val] of Object.entries(shift.overrides)) values[k] = val;

const template = new Uint8Array(await readFile('server/assets/form680-default.docx'));
const signaturePng = (await signatureForProvider(values['Staff Name'] || shift.provider)) ?? undefined;
const out = await fillDocxTemplate(template, job.form680Spec, values, { signaturePng });
const file = path.join(os.tmpdir(), `filled-${jobId.slice(0, 8)}-${indexArg}.docx`);
await writeFile(file, out);
console.log(`wrote ${file} (${out.length} bytes, signature: ${signaturePng ? 'image' : 'typed'})`);

const zip = new AdmZip(Buffer.from(out));
const xml = zip.getEntry('word/document.xml').getData().toString('utf8');
console.log(`parts: ${zip.getEntries().map((e) => e.entryName).filter((n) => /media|rels|Content/.test(n)).join(', ')}`);
console.log(`checked boxes: ${(xml.match(/w14:val="1"/g) ?? []).length}, ☒ glyphs: ${(xml.match(/\u2612/g) ?? []).length}, drawings: ${(xml.match(/<w:drawing>/g) ?? []).length}`);
let n = 0;
for (const b of docxBlocks(xml)) {
  n++;
  const text = b.kind === 'para' ? b.text : b.cells.map((c) => c.join(' | ')).join(' || ');
  if (text.trim()) console.log(`${String(n).padStart(3)} ${b.kind === 'para' ? 'P  ' : 'ROW'} ${text.slice(0, 230)}`);
}
