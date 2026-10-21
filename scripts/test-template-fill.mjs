// Fill a faithful template PDF with a few test values and render it, to check
// widget placement on a new individual's template.
//   node scripts/test-template-fill.mjs <template.pdf> <out.pdf> [signature.png]
import { readFile, writeFile } from 'node:fs/promises';
import { fillPdf } from '../server/dist/services/formFiller.js';
import { inspectTemplate } from '../server/dist/services/templateInspector.js';

const [input, output, sig] = process.argv.slice(2);
const template = new Uint8Array(await readFile(input));
const fields = await inspectTemplate(template);
const values = {};
for (const f of fields) {
  if (f.type === 'checkbox' && /^Mood: /.test(f.name)) values[f.name] = true;
  else if (f.type === 'checkbox') values[f.name] = /8am-4pm/.test(f.name);
  else if (f.type === 'radio' && / - Support Type$/.test(f.name)) values[f.name] = f.options[Math.floor(Math.random() * f.options.length)];
  else if (f.type === 'radio') values[f.name] = 'Yes';
  else if (/Documentation$/.test(f.name)) values[f.name] = `Documentation for ${f.name.replace(/ - Documentation$/, '')}: staff provided support and the individual responded well.`;
  else if (/Explanation$/.test(f.name)) values[f.name] = `Explanation text for ${f.name}.`;
  else if (f.name === 'Mood: Other') values[f.name] = 'Bored';
  else if (f.name === 'Mood Description') values[f.name] = 'Jerrell appeared content and relaxed throughout the shift.';
  else if (/Activity$/.test(f.name)) values[f.name] = `${f.name}: watched a movie and drew a picture.`;
  else if (f.name === 'Date' || f.name === 'Signature Date') values[f.name] = 'July 20, 2026';
  else if (f.name === 'Staff Name') values[f.name] = 'Hanna Tafesse';
  else if (f.name === 'Staff Title') values[f.name] = 'DSP';
  else if (f.name === 'Staff Signature') values[f.name] = 'H.T.';
  else values[f.name] = f.name;
}
const signatureImage = sig ? new Uint8Array(await readFile(sig)) : undefined;
const { bytes, warnings } = await fillPdf(template, values, { flatten: true, signatureImage });
await writeFile(output, bytes);
console.log(`wrote ${output}; warnings: ${warnings.length ? warnings.join(' | ') : 'none'}`);
