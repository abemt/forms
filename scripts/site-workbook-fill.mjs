// Writes a filled Daily Log Entry workbook from a JSON payload produced by the
// server's Log Writer (services/logWriter/writer.ts):
//   { month: { name, year, days, firstDay?, startDay? }, profile, individual: { first, header, info, keywords, roster },
//     fill: { "<heading>": { day|evening|night: { mood, notes } } }, providers: { "<heading>": { day|evening|night: "Name, DSP" } } }
//   node scripts/site-workbook-fill.mjs <payload.json> <out.docx>
import { readFile, writeFile } from 'node:fs/promises';
import { Packer } from 'docx';
import { INDIVIDUALS, buildDocument } from './build-entry-workbook.mjs';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node scripts/site-workbook-fill.mjs <payload.json> <out.docx>');
  process.exit(1);
}
const payload = JSON.parse(await readFile(input, 'utf8'));
const base = INDIVIDUALS[payload.profile] ?? INDIVIDUALS.steven;
const individual = { ...base, ...payload.individual, first: payload.individual.first ?? base.first };
const bytes = await Packer.toBuffer(buildDocument(payload.month, payload.fill, payload.providers ?? null, individual));
await writeFile(output, bytes);
console.log(`Wrote ${output} (${bytes.length} bytes)`);
