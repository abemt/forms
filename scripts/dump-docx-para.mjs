// Diagnostic: raw XML of the first paragraph whose text starts with a needle.
import { readFile } from 'node:fs/promises';
import AdmZip from 'adm-zip';
const [file, needle] = process.argv.slice(2);
const xml = new AdmZip(await readFile(file)).getEntry('word/document.xml').getData().toString('utf8');
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const text = (x) => decode((x.match(/<w:t(?: [^>]*)?>[^<]*<\/w:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join(''));
for (const p of xml.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) ?? []) {
  if (!text(p).trim().startsWith(needle)) continue;
  console.log(p.replace(/(<w:t(?: [^>]*)?>)([^<]{60})[^<]*(<\/w:t>)/g, '$1$2…$3'));
  break;
}
