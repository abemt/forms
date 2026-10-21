// Validate a single .docx: every XML part well-formed + LibreOffice can open/convert it.
//   node scripts/check-docx-file.mjs <file.docx> [--pdf <outDir>]
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { XMLValidator } from 'fast-xml-parser';
import { findSoffice } from '../server/dist/services/soffice.js';

const [file, ...flags] = process.argv.slice(2);
const zip = new AdmZip(await readFile(file));
let bad = 0;
for (const e of zip.getEntries()) {
  if (!/\.(xml|rels)$/.test(e.entryName)) continue;
  const res = XMLValidator.validate(e.getData().toString('utf8'));
  if (res !== true) {
    bad++;
    console.log(`MALFORMED ${e.entryName}: ${res.err.msg} (line ${res.err.line})`);
  }
}
console.log(`${path.basename(file)}: ${zip.getEntries().length} parts, malformed XML parts: ${bad}`);
const pdfFlag = flags.indexOf('--pdf');
if (pdfFlag >= 0) {
  const outDir = flags[pdfFlag + 1];
  const soffice = await findSoffice();
  if (!soffice) throw new Error('LibreOffice not found');
  const t0 = Date.now();
  execFileSync(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', outDir, file], { stdio: 'pipe' });
  console.log(`converted to PDF in ${outDir} (${Date.now() - t0} ms)`);
}
