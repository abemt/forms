// Build the faithful fillable PDF from a Word §680 template and list its fields.
//   node scripts/build-template-pdf.mjs <template.docx> <out.pdf>
import { readFile, writeFile } from 'node:fs/promises';
import { buildTemplateFromDocx } from '../server/dist/services/docxTemplate.js';
import { inspectTemplate } from '../server/dist/services/templateInspector.js';

const [input, output] = process.argv.slice(2);
const bytes = await buildTemplateFromDocx(new Uint8Array(await readFile(input)));
await writeFile(output, bytes);
const fields = await inspectTemplate(bytes);
const byType = {};
for (const f of fields) byType[f.type] = (byType[f.type] ?? 0) + 1;
console.log(`${output}: ${fields.length} fields`, byType);
for (const f of fields) console.log(`  p${f.page} ${f.type.padEnd(8)} ${f.name}${f.options ? ' [' + f.options.length + ' options]' : ''}`);
