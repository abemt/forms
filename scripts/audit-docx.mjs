// Validate every Word printable of a job (well-formed XML + signature part).
//   node scripts/audit-docx.mjs <jobId>
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { XMLValidator } from 'fast-xml-parser';

const dir = path.resolve(`server/data/jobs/${process.argv[2]}/output/Printable`);
let ok = 0;
let bad = 0;
let img = 0;
for (const f of (await readdir(dir)).filter((f) => f.endsWith('.docx'))) {
  const zip = new AdmZip(await readFile(path.join(dir, f)));
  const xml = zip.getEntry('word/document.xml').getData().toString('utf8');
  const result = XMLValidator.validate(xml);
  if (result === true) ok++;
  else {
    bad++;
    console.log(`${f}: ${JSON.stringify(result.err)}`);
  }
  if (zip.getEntry('word/media/signature1.png')) img++;
}
console.log(`docx well-formed: ${ok}, malformed: ${bad}, with signature image: ${img}`);
