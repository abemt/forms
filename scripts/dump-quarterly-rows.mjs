// Diagnostic: table nesting + per-row cell paragraph texts for the quarterly docx.
import { readFile } from 'node:fs/promises';
import AdmZip from 'adm-zip';

const file = process.argv[2];
const xml = new AdmZip(await readFile(file)).getEntry('word/document.xml').getData().toString('utf8');
console.log('tables:', (xml.match(/<w:tbl>/g) ?? []).length, ' rows:', (xml.match(/<w:tr[ >]/g) ?? []).length, ' cells:', (xml.match(/<w:tc[ >]/g) ?? []).length);
console.log('textboxes:', (xml.match(/<w:txbxContent/g) ?? []).length, ' sdt:', (xml.match(/<w:sdt>/g) ?? []).length);
// nesting check: does any <w:tbl> start inside an open <w:tc>?
let depth = 0, nested = 0;
for (const m of xml.matchAll(/<w:tbl>|<\/w:tbl>/g)) {
  if (m[0] === '<w:tbl>') { if (depth > 0) nested++; depth++; } else depth--;
}
console.log('nested tables:', nested);
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const pText = (p) => decode((p.match(/<w:t(?: [^>]*)?>[^<]*<\/w:t>|<w:tab\/>/g) ?? []).map((t) => (t === '<w:tab/>' ? '\t' : t.replace(/<[^>]+>/g, ''))).join(''));
// Print row 7 (Seizure) cell-by-cell paragraph texts with run counts
const rows = xml.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) ?? [];
const target = rows.find((r) => /Seizure/.test(pText(r)) && /Status description/.test(pText(r)));
const cells = target.match(/<w:tc[ >][\s\S]*?<\/w:tc>/g) ?? [];
cells.forEach((c, ci) => {
  console.log(`-- cell ${ci}`);
  for (const p of c.match(/<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) ?? []) {
    const runs = p.match(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g) ?? [];
    console.log(`   [${runs.length} runs] ${JSON.stringify(pText(p).slice(0, 100))}`);
  }
});
