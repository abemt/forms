// Print the block structure (paragraphs / table rows) of a .docx with the raw
// XML of the first N paragraphs — to design template filling.
//   node scripts/dump-docx-structure.mjs <file.docx> [--xml N]
import { readFile } from 'node:fs/promises';
import AdmZip from 'adm-zip';
import { docxBlocks } from '../server/dist/services/docxLog.js';

const [file, ...flags] = process.argv.slice(2);
const zip = new AdmZip(await readFile(file));
const xml = zip.getEntry('word/document.xml').getData().toString('utf8');
console.log(`document.xml: ${xml.length} chars; parts: ${zip.getEntries().map((e) => e.entryName).join(', ')}`);
const blocks = docxBlocks(xml);
let n = 0;
for (const b of blocks) {
  n++;
  if (b.kind === 'para') console.log(`${String(n).padStart(3)} P ${b.pageBreakBefore ? '[PB] ' : ''}${JSON.stringify(b.text)}`);
  else console.log(`${String(n).padStart(3)} ROW ${JSON.stringify(b.cells.map((c) => c.join(' | ')))}`);
}
const xmlFlag = flags.indexOf('--xml');
if (xmlFlag >= 0) {
  const count = Number(flags[xmlFlag + 1] ?? 3);
  const paras = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [];
  console.log(`\n--- first ${count} paragraph XML blocks (of ${paras.length}) ---`);
  for (const p of paras.slice(0, count)) console.log(p, '\n');
}
