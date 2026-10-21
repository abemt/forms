// Inspect the package structure of a filled Word form (rels, sectPr, footer fields).
//   node scripts/dump-docx-package.mjs <file.docx>
import AdmZip from 'adm-zip';

const z = new AdmZip(process.argv[2]);
console.log('parts:', z.getEntries().map((e) => e.entryName).filter((n) => !/theme|fontTable|webSettings|docProps|customXml/.test(n)).join(', '));
const rels = z.getEntry('word/_rels/document.xml.rels').getData().toString('utf8');
console.log('rels:', [...rels.matchAll(/Id="([^"]+)"[^>]*Type="[^"]*\/([a-zA-Z]+)"[^>]*Target="([^"]+)"/g)].map((m) => `${m[1]}:${m[2]}->${m[3]}`).join(' | '));
const doc = z.getEntry('word/document.xml').getData().toString('utf8');
const sect = doc.slice(doc.lastIndexOf('<w:sectPr'), doc.lastIndexOf('</w:sectPr>') + 11);
console.log('final sectPr:', sect.replace(/\s+/g, ' ').slice(0, 700));
console.log(
  'sectPr count:', (doc.match(/<w:sectPr/g) || []).length,
  '| bookmarks:', (doc.match(/<w:bookmarkStart/g) || []).length,
  '| docPr ids:', [...doc.matchAll(/<wp:docPr id="(\d+)"/g)].map((m) => m[1]).join(','),
  '| sdt ids:', (doc.match(/<w:id w:val=/g) || []).length,
  '| paraIds:', (doc.match(/w14:paraId/g) || []).length,
  '| r: refs in body:', [...new Set([...doc.matchAll(/\br:(?:id|embed|link)="([^"]+)"/g)].map((m) => m[1]))].join(','),
);
for (const e of z.getEntries()) {
  if (!/word\/(header|footer)\d*\.xml$/.test(e.entryName)) continue;
  const x = e.getData().toString('utf8');
  console.log(
    `${e.entryName}:`, [...x.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('|').slice(0, 120),
    '| instrText:', [...x.matchAll(/<w:instrText[^>]*>([^<]*)</g)].map((m) => m[1].trim()).join(','),
    '| fldSimple:', [...x.matchAll(/w:instr="([^"]+)"/g)].map((m) => m[1].trim()).join(','),
  );
  const rr = z.getEntry(e.entryName.replace('word/', 'word/_rels/') + '.rels');
  if (rr) console.log('   rels:', rr.getData().toString('utf8').match(/Target="[^"]+"/g)?.join(','));
}
