// Simplified XML skeleton of a .docx body region: keeps structure tags, drops
// formatting noise, shows text and tabs inline.
//   node scripts/dump-docx-skeleton.mjs <file.docx> "<needle>" [contextChars]
import { readFile } from 'node:fs/promises';
import AdmZip from 'adm-zip';

const [file, needle, ctx = '4000'] = process.argv.slice(2);
const xml = new AdmZip(await readFile(file)).getEntry('word/document.xml').getData().toString('utf8');
const idx = xml.indexOf(needle);
if (idx < 0) {
  console.log('needle not found');
  process.exit(1);
}
// Snap to the enclosing paragraph/row start.
const start = Math.max(xml.lastIndexOf('<w:tr ', idx - 1), xml.lastIndexOf('<w:tr>', idx - 1), 0);
const region = xml.slice(Math.max(start, idx - Number(ctx) / 4), idx + Number(ctx));
const simplified = region
  .replace(/<w:rPr>[\s\S]*?<\/w:rPr>/g, '')
  .replace(/<w:tcPr>[\s\S]*?<\/w:tcPr>/g, '<tcPr/>')
  .replace(/<w:trPr>[\s\S]*?<\/w:trPr>/g, '')
  .replace(/<w:tblPr>[\s\S]*?<\/w:tblPr>/g, '<tblPr/>')
  .replace(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/g, '<tblGrid/>')
  .replace(/<w:pPr>([\s\S]*?)<\/w:pPr>/g, (_, inner) => `<pPr ${inner.replace(/<w:([a-zA-Z]+)[^>]*\/>/g, '$1 ').replace(/<[^>]+>/g, '').trim()}/>`)
  .replace(/<w:tab\/>/g, '⇥')
  .replace(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g, '“$1”')
  .replace(/<w:r(?:\s[^>]*)?>/g, '')
  .replace(/<\/w:r>/g, '')
  .replace(/ w:rsid\w*="[^"]*"/g, '')
  .replace(/<w:p(?:\s[^>]*)?>/g, '\n  <p>')
  .replace(/<\/w:p>/g, '</p>')
  .replace(/<w:tc>/g, '\n <tc>')
  .replace(/<\/w:tc>/g, '\n </tc>')
  .replace(/<w:tr(?:\s[^>]*)?>/g, '\n<tr>')
  .replace(/<\/w:tr>/g, '\n</tr>')
  .replace(/<w:tbl>/g, '\n<tbl>')
  .replace(/<\/w:tbl>/g, '\n</tbl>');
console.log(simplified);
