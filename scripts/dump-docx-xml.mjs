// Print the raw XML around a text needle inside a .docx body.
//   node scripts/dump-docx-xml.mjs <file.docx> "<needle>" [contextChars]
import { readFile } from 'node:fs/promises';
import AdmZip from 'adm-zip';

const [file, needle, ctx = '1500'] = process.argv.slice(2);
const xml = new AdmZip(await readFile(file)).getEntry('word/document.xml').getData().toString('utf8');
let idx = -1;
let hits = 0;
while ((idx = xml.indexOf(needle, idx + 1)) >= 0 && hits < 2) {
  hits++;
  const start = Math.max(0, idx - Number(ctx) / 3);
  const end = Math.min(xml.length, idx + Number(ctx));
  console.log(`\n===== hit ${hits} @ ${idx} =====\n${xml.slice(start, end)}\n`);
}
if (!hits) console.log('needle not found');
