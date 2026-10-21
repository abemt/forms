// Diagnostic: dump text of headers/footers of a docx (with checkbox glyphs).
import { readFile } from 'node:fs/promises';
import AdmZip from 'adm-zip';
const zip = new AdmZip(await readFile(process.argv[2]));
for (const e of zip.getEntries()) {
  if (!/^word\/(header|footer)\d*\.xml$/.test(e.entryName)) continue;
  const xml = e.getData().toString('utf8');
  const paras = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [];
  console.log(`== ${e.entryName} (${paras.length} paragraphs)`);
  for (const p of paras) {
    const t = (p.match(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g) ?? []).map((m) => m.replace(/<[^>]+>/g, '')).join('');
    if (t.trim()) console.log('   ' + JSON.stringify(t));
  }
}
// also the sectPr / references
const doc = zip.getEntry('word/document.xml').getData().toString('utf8');
console.log((doc.match(/<w:(header|footer)Reference[^>]*>/g) ?? []).join('\n'));
