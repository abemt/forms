// Fill a Word §680 template with test values (every field) and render it —
// checks the Word printable on a new individual's template.
//   node scripts/test-docx-template.mjs <template.docx> <out.docx> [signature.png]
import { readFile, writeFile } from 'node:fs/promises';
import AdmZip from 'adm-zip';
import { fillDocxTemplate } from '../server/dist/services/docxFormFiller.js';
import { parseForm680Spec, docxParagraphs, buildTemplateFromDocx } from '../server/dist/services/docxTemplate.js';
import { inspectTemplate } from '../server/dist/services/templateInspector.js';

const [input, output, sig] = process.argv.slice(2);
const docx = new Uint8Array(await readFile(input));
const spec = parseForm680Spec(docxParagraphs(docx));
const fields = await inspectTemplate(await buildTemplateFromDocx(docx));
const values = {};
let moodCount = 0;
for (const f of fields) {
  if (f.type === 'checkbox' && /^Mood: /.test(f.name)) values[f.name] = moodCount++ % 3 === 0;
  else if (f.type === 'checkbox') values[f.name] = /8am-4pm/.test(f.name);
  else if (f.type === 'radio' && / - Support Type$/.test(f.name)) values[f.name] = f.options[fields.indexOf(f) % f.options.length];
  else if (f.type === 'radio') values[f.name] = 'Yes';
  else if (/Documentation$/.test(f.name)) values[f.name] = `Documentation for ${f.name.replace(/ - Documentation$/, '')}: staff provided support and the individual responded well.`;
  else if (/Explanation$/.test(f.name)) values[f.name] = `Explanation text for ${f.name}.`;
  else if (f.name === 'Mood: Other') values[f.name] = 'Bored';
  else if (f.name === 'Mood Description') values[f.name] = 'Jerrell appeared content and relaxed throughout the shift.';
  else if (/Activity$/.test(f.name)) values[f.name] = `watched a movie and drew a picture (${f.name}).`;
  else if (f.name === 'Date' || f.name === 'Signature Date') values[f.name] = 'July 20, 2026';
  else if (f.name === 'Staff Name') values[f.name] = 'Hanna Tafesse';
  else if (f.name === 'Staff Title') values[f.name] = 'DSP';
  else if (f.name === 'Staff Signature') values[f.name] = 'H.T.';
  else values[f.name] = f.name;
}
const signaturePng = sig ? new Uint8Array(await readFile(sig)) : undefined;
const out = await fillDocxTemplate(docx, spec, values, { signaturePng });
await writeFile(output, out);
const xml = new AdmZip(Buffer.from(out)).getEntry('word/document.xml').getData().toString('utf8');
console.log(`wrote ${output}; ☒ glyphs: ${(xml.match(/\u2612/g) ?? []).length} (moods wanted: ${Math.ceil(moodCount / 3)} + shift 1 + sections ${spec.sections.length} + questions ${spec.yesNoQuestions.length}); drawings: ${(xml.match(/<w:drawing>/g) ?? []).length}`);
