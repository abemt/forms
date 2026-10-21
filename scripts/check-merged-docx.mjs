// Structural check of a merged month document (ids unique, bookmarks paired, one odd-page section per form).
//   node scripts/check-merged-docx.mjs <file.docx> <expectedForms>
import AdmZip from 'adm-zip';
import { XMLValidator } from 'fast-xml-parser';

const [file, expected] = process.argv.slice(2);
const zip = new AdmZip(file);
const x = zip.getEntry('word/document.xml').getData().toString('utf8');
const starts = [...x.matchAll(/<w:bookmarkStart\b[^>]*\bw:id="(\d+)"/g)].map((m) => m[1]);
const ends = [...x.matchAll(/<w:bookmarkEnd\b[^>]*\bw:id="(\d+)"/g)].map((m) => m[1]);
const sdtIds = [...x.matchAll(/<w:id w:val="(-?\d+)"\/>/g)].map((m) => m[1]);
const docPr = [...x.matchAll(/<wp:docPr\b[^>]*\bid="(\d+)"/g)].map((m) => m[1]);
const sections = (x.match(/<w:sectPr\b/g) ?? []).length;
const oddPage = (x.match(/<w:type w:val="oddPage"\/>/g) ?? []).length;
const restarts = (x.match(/<w:pgNumType w:start="1"\/>/g) ?? []).length;
const rels = zip.getEntry('word/_rels/document.xml.rels').getData().toString('utf8');
const relIds = new Set([...rels.matchAll(/Id="([^"]+)"/g)].map((m) => m[1]));
const usedRels = new Set([...x.matchAll(/\br:(?:id|embed|link)="([^"]+)"/g)].map((m) => m[1]));
const missingRels = [...usedRels].filter((r) => !relIds.has(r));
const problems = [];
if (XMLValidator.validate(x) !== true) problems.push('document.xml not well-formed');
if (starts.length !== ends.length || ends.some((e) => !starts.includes(e))) problems.push(`bookmarks unpaired (${starts.length}/${ends.length})`);
if (new Set(sdtIds).size !== sdtIds.length) problems.push('duplicate content-control ids');
if (new Set(docPr).size !== docPr.length) problems.push('duplicate drawing ids');
if (Number(expected) && sections !== Number(expected)) problems.push(`sections ${sections} != forms ${expected}`);
if (oddPage !== sections || restarts !== sections) problems.push(`oddPage ${oddPage} / restarts ${restarts} != sections ${sections}`);
if (missingRels.length) problems.push(`missing relationships: ${missingRels.join(',')}`);
for (const e of zip.getEntries()) {
  if (/\.(?:xml|rels)$/.test(e.entryName) && XMLValidator.validate(e.getData().toString('utf8')) !== true) problems.push(`${e.entryName} not well-formed`);
}
console.log(`${file.split(/[\\/]/).pop()}: ${sections} sections, ${docPr.length} signatures, ${sdtIds.length} content controls — ${problems.length ? 'PROBLEMS: ' + problems.join('; ') : 'OK'}`);
process.exit(problems.length ? 1 : 0);
