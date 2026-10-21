// Client-facing ZIP for a finished job: flattened PDFs in one folder, Word
// copies in another (the editable AcroForm PDFs stay in the job folder).
//   node scripts/package-final.mjs <jobId> <out.zip>
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';

const [id, out] = process.argv.slice(2);
if (!id || !out) {
  console.error('usage: node scripts/package-final.mjs <jobId> <out.zip>');
  process.exit(1);
}
const printable = path.resolve(`server/data/jobs/${id}/output/Printable`);
const zip = new AdmZip();
let pdfs = 0;
let docs = 0;
for (const f of (await readdir(printable)).sort()) {
  if (f.endsWith('.pdf')) {
    zip.addLocalFile(path.join(printable, f), 'PDF');
    pdfs++;
  } else if (f.endsWith('.docx')) {
    zip.addLocalFile(path.join(printable, f), 'Word');
    docs++;
  }
}
zip.writeZip(path.resolve(out));
console.log(`${out}: PDF/ ${pdfs} files, Word/ ${docs} files`);
