// Rasterize every page of a PDF (or a .docx, converted first) to PNG using
// LibreOffice: split into single-page PDFs with pdf-lib, convert each.
//   node scripts/render-pages.mjs <file.pdf|file.docx> <outDir> [scaleHint]
import { mkdir, readFile, writeFile, readdir, rm, rename } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PDFDocument } from 'pdf-lib';

const exec = promisify(execFile);
const SOFFICE = process.env.SOFFICE ?? 'C:\\Program Files\\LibreOffice\\program\\soffice.exe';
const [input, outDir] = process.argv.slice(2);
await mkdir(outDir, { recursive: true });

let pdfPath = path.resolve(input);
if (/\.docx$/i.test(input)) {
  await exec(SOFFICE, ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', outDir, pdfPath]);
  pdfPath = path.join(outDir, path.basename(input).replace(/\.docx$/i, '.pdf'));
}
const src = await PDFDocument.load(await readFile(pdfPath));
const n = src.getPageCount();
console.log(`${path.basename(pdfPath)}: ${n} page(s)`);
for (let i = 0; i < n; i++) {
  const single = await PDFDocument.create();
  const [page] = await single.copyPages(src, [i]);
  single.addPage(page);
  const pageDir = path.join(outDir, `page${i + 1}`);
  await rm(pageDir, { recursive: true, force: true });
  await mkdir(pageDir, { recursive: true });
  const singlePath = path.join(pageDir, `p${i + 1}.pdf`);
  await writeFile(singlePath, await single.save());
  await exec(SOFFICE, ['--headless', '--norestore', '--convert-to', 'png', '--outdir', pageDir, singlePath]);
  const png = (await readdir(pageDir)).find((f) => f.endsWith('.png'));
  if (png) {
    const target = path.join(outDir, `page${i + 1}.png`);
    await rename(path.join(pageDir, png), target);
    console.log(`  -> ${target}`);
  }
  await rm(pageDir, { recursive: true, force: true });
}
