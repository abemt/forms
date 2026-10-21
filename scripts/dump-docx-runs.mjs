// Diagnostic: show run-level text of paragraphs matching a needle in document.xml / headers.
import { readFile } from 'node:fs/promises';
import AdmZip from 'adm-zip';
const [file, needle] = process.argv.slice(2);
const zip = new AdmZip(await readFile(file));
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const text = (x) => decode((x.match(/<w:t(?: [^>]*)?>[^<]*<\/w:t>|<w:tab\/>/g) ?? []).map((t) => (t === '<w:tab/>' ? '\t' : t.replace(/<[^>]+>/g, ''))).join(''));
for (const e of zip.getEntries()) {
  if (!/^word\/(document|header\d*|footer\d*)\.xml$/.test(e.entryName)) continue;
  const xml = e.getData().toString('utf8');
  for (const p of xml.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) ?? []) {
    if (!text(p).includes(needle)) continue;
    console.log(`== ${e.entryName}: ${JSON.stringify(text(p))}`);
    for (const r of p.match(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g) ?? []) console.log('   run:', JSON.stringify(text(r)));
  }
}
