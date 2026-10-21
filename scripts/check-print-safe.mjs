// Print-safety audit: every PDF of a job must have no dangling /Annots
// references (pdf-lib's flatten/removeField leaves them behind; Acrobat then
// refuses to print with "The document could not be printed").
//   node scripts/check-print-safe.mjs <jobId>
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, PDFRef } from 'pdf-lib';

const id = process.argv[2];
const out = path.resolve(`server/data/jobs/${id}/output`);
let files = 0;
let bad = 0;
for (const sub of ['Editable', 'Printable']) {
  const dir = path.join(out, sub);
  for (const f of (await readdir(dir)).filter((n) => n.endsWith('.pdf')).sort()) {
    files++;
    const doc = await PDFDocument.load(await readFile(path.join(dir, f)));
    let dangling = 0;
    let annots = 0;
    for (const page of doc.getPages()) {
      const arr = page.node.Annots();
      for (let i = 0; i < (arr?.size() ?? 0); i++) {
        annots++;
        const ref = arr.get(i);
        if (ref instanceof PDFRef && doc.context.lookup(ref) === undefined) dangling++;
      }
    }
    if (dangling > 0) {
      bad++;
      console.log(`  ${sub}/${f}: ${dangling} dangling annotation ref(s) of ${annots}`);
    }
  }
}
console.log(`${files} PDFs checked, ${bad} with dangling annotation refs${bad ? '' : ' — print-safe'}`);
process.exit(bad ? 1 : 0);
