// Merge Word forms into ONE .docx (one click to print). Each form becomes its
// own section that starts on an odd page, so when the document is printed
// double-sided no form begins on the back of another; page numbering restarts
// per form ("Page 1 of 6" footers use SECTIONPAGES). Signature images /
// footers that repeat across forms are stored once.
//
//   node scripts/merge-docx-forms.mjs <jobId | folder with FormNNN.docx> <out.docx>
//   import { mergeDocxFiles } from './merge-docx-forms.mjs'   (used by split-month.mjs)
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { XMLValidator } from 'fast-xml-parser';

const resolvePart = (fromDir, target) => path.posix.normalize(path.posix.join(fromDir, target));
const relsNameOf = (part) => part.replace(/([^/]+)$/, '_rels/$1.rels');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function parseRels(xml) {
  const map = new Map();
  for (const m of xml.matchAll(/<Relationship\b[^>]*\/>/g)) {
    const rel = m[0];
    const get = (k) => rel.match(new RegExp(`\\b${k}="([^"]+)"`))?.[1];
    map.set(get('Id'), { type: get('Type'), target: get('Target'), external: get('TargetMode') === 'External' });
  }
  return map;
}

function partHash(zip, part) {
  const data = zip.getEntry(part)?.getData();
  if (!data) return undefined;
  const relsEntry = zip.getEntry(relsNameOf(part));
  return createHash('sha1').update(data).update(relsEntry ? relsEntry.getData() : '').digest('hex').slice(0, 10);
}

function splitDocument(xml) {
  const bodyStart = xml.indexOf('<w:body>') + '<w:body>'.length;
  const sectStart = xml.lastIndexOf('<w:sectPr');
  const sectEnd = xml.lastIndexOf('</w:sectPr>') + '</w:sectPr>'.length;
  if (bodyStart < 8 || sectStart < 0) throw new Error('unexpected document.xml layout');
  return { head: xml.slice(0, bodyStart), blocks: xml.slice(bodyStart, sectStart), sectPr: xml.slice(sectStart, sectEnd), tail: xml.slice(sectEnd) };
}

/** Section starts on an odd page and restarts page numbering (element order follows the schema). */
function oddPageSection(sectPr, duplex) {
  let s = sectPr.replace(/<w:type\b[^>]*\/>/, '');
  const typeTag = `<w:type w:val="${duplex ? 'oddPage' : 'nextPage'}"/>`;
  if (/<w:pgSz\b/.test(s)) s = s.replace(/<w:pgSz\b/, `${typeTag}<w:pgSz`);
  else if (/<w:pgMar\b/.test(s)) s = s.replace(/<w:pgMar\b/, `${typeTag}<w:pgMar`);
  else s = s.replace('</w:sectPr>', `${typeTag}</w:sectPr>`);
  if (/<w:pgNumType\b/.test(s)) {
    s = s.replace(/<w:pgNumType\b([^>]*?)\s*\/>/, (_m, attrs) =>
      /w:start=/.test(attrs) ? `<w:pgNumType${attrs.replace(/w:start="[^"]*"/, 'w:start="1"')}/>` : `<w:pgNumType${attrs} w:start="1"/>`,
    );
  } else {
    const after = /<w:(?:cols|formProt|vAlign|noEndnote|titlePg|textDirection|bidi|rtlGutter|docGrid|printerSettings|sectPrChange)\b/;
    s = after.test(s) ? s.replace(after, (m) => `<w:pgNumType w:start="1"/>${m}`) : s.replace('</w:sectPr>', '<w:pgNumType w:start="1"/></w:sectPr>');
  }
  return s;
}

/**
 * Merge the given .docx files (absolute paths, in order) into `out`.
 * Returns { forms, sections, sharedParts, bytes }.
 */
export function mergeDocxFiles(files, out, { duplex = true } = {}) {
  if (files.length === 0) throw new Error('nothing to merge');
  const merged = new AdmZip(files[0]);
  let rels = merged.getEntry('word/_rels/document.xml.rels').getData().toString('utf8');
  let contentTypes = merged.getEntry('[Content_Types].xml').getData().toString('utf8');

  const partByHash = new Map(); // content hash -> part name in the merged package
  const relByTarget = new Map(); // `${type}|${part}` -> rId in the merged document
  let relCounter = 0;
  let docPrCounter = 0;
  let sdtCounter = 0;

  /** Copy a part (and the parts it references) into the merged package; identical parts are shared. */
  const copyPart = (src, part) => {
    const entry = src.getEntry(part);
    if (!entry) return undefined;
    const hash = partHash(src, part);
    if (partByHash.has(hash)) return partByHash.get(hash);
    const ext = path.posix.extname(part);
    const partDir = path.posix.dirname(part);
    const newName = `${partDir}/${path.posix.basename(part, ext)}_m${hash}${ext}`;
    const relsEntry = src.getEntry(relsNameOf(part));
    if (relsEntry) {
      const rewritten = relsEntry
        .getData()
        .toString('utf8')
        .replace(/<Relationship\b[^>]*\/>/g, (rel) => {
          if (/TargetMode="External"/.test(rel)) return rel;
          const target = rel.match(/Target="([^"]+)"/)?.[1];
          const copied = target && copyPart(src, resolvePart(partDir, target));
          return copied ? rel.replace(/Target="[^"]+"/, `Target="${path.posix.relative(partDir, copied)}"`) : rel;
        });
      merged.addFile(relsNameOf(newName), Buffer.from(rewritten, 'utf8'));
    }
    merged.addFile(newName, entry.getData());
    const srcTypes = src.getEntry('[Content_Types].xml').getData().toString('utf8');
    const override = srcTypes.match(new RegExp(`<Override PartName="/${escapeRe(part)}" ContentType="([^"]+)"`));
    if (override) {
      contentTypes = contentTypes.replace('</Types>', `<Override PartName="/${newName}" ContentType="${override[1]}"/></Types>`);
    } else if (!new RegExp(`<Default Extension="${escapeRe(ext.slice(1))}"`, 'i').test(contentTypes)) {
      const def = srcTypes.match(new RegExp(`<Default Extension="${escapeRe(ext.slice(1))}"[^>]*/>`, 'i'));
      if (def) contentTypes = contentTypes.replace('</Types>', `${def[0]}</Types>`);
    }
    partByHash.set(hash, newName);
    return newName;
  };

  // The first form's own parts are the canonical copies for everything identical later.
  for (const [rid, rel] of parseRels(rels)) {
    if (rel.external) continue;
    const part = resolvePart('word', rel.target);
    const hash = partHash(merged, part);
    if (!hash) continue;
    partByHash.set(hash, part);
    relByTarget.set(`${rel.type}|${part}`, rid);
  }

  /** Ids that must be unique across the whole document. */
  const uniquify = (xml, index) => {
    // Word's hidden _GoBack bookmark exists in every form; drop it (start and matching end).
    const goBackIds = [...xml.matchAll(/<w:bookmarkStart\b[^>]*w:name="_GoBack"[^>]*\bw:id="(\d+)"/g), ...xml.matchAll(/<w:bookmarkStart\b[^>]*\bw:id="(\d+)"[^>]*w:name="_GoBack"/g)].map((m) => m[1]);
    return xml
      .replace(/\s(?:w14:paraId|w14:textId)="[^"]*"/g, '')
      .replace(/(<wp:docPr\b[^>]*?\bid=")\d+(")/g, (_m, a, c) => `${a}${++docPrCounter}${c}`)
      .replace(/<w:id w:val="-?\d+"\/>/g, () => `<w:id w:val="${++sdtCounter}"/>`)
      .replace(/<w:bookmarkStart\b[^>]*w:name="_GoBack"[^>]*\/>/g, '')
      .replace(/<w:bookmarkEnd\b[^>]*\bw:id="(\d+)"[^>]*\/>/g, (m, n) => (goBackIds.includes(n) ? '' : m))
      .replace(/(<w:bookmark(?:Start|End)\b[^>]*?\bw:id=")(\d+)(")/g, (_m, a, n, c) => `${a}${Number(n) + index * 1000}${c}`);
  };

  const docs = [];
  let head = '';
  let tail = '';
  files.forEach((file, index) => {
    const zip = index === 0 ? merged : new AdmZip(file);
    const parts = splitDocument(zip.getEntry('word/document.xml').getData().toString('utf8'));
    if (index === 0) ({ head, tail } = parts);
    let { blocks, sectPr } = parts;
    if (index > 0) {
      // Re-point this form's relationships (signature image, footer) at shared parts.
      const srcRels = parseRels(zip.getEntry('word/_rels/document.xml.rels').getData().toString('utf8'));
      const idMap = new Map();
      for (const rid of new Set([...`${blocks}${sectPr}`.matchAll(/\br:(?:id|embed|link)="([^"]+)"/g)].map((m) => m[1]))) {
        const rel = srcRels.get(rid);
        if (!rel) continue;
        let newId;
        if (rel.external) {
          newId = `rIdM${++relCounter}`;
          rels = rels.replace('</Relationships>', `<Relationship Id="${newId}" Type="${rel.type}" Target="${rel.target}" TargetMode="External"/></Relationships>`);
        } else {
          const part = copyPart(zip, resolvePart('word', rel.target));
          if (!part) continue;
          const key = `${rel.type}|${part}`;
          newId = relByTarget.get(key);
          if (!newId) {
            newId = `rIdM${++relCounter}`;
            rels = rels.replace('</Relationships>', `<Relationship Id="${newId}" Type="${rel.type}" Target="${path.posix.relative('word', part)}"/></Relationships>`);
            relByTarget.set(key, newId);
          }
        }
        idMap.set(rid, newId);
      }
      const remap = (xml) => xml.replace(/\b(r:(?:id|embed|link))="([^"]+)"/g, (m, attr, v) => (idMap.has(v) ? `${attr}="${idMap.get(v)}"` : m));
      blocks = remap(blocks);
      sectPr = remap(sectPr);
    }
    docs.push({ blocks: uniquify(blocks, index), sectPr: oddPageSection(sectPr, duplex) });
  });

  // A 1pt paragraph carries each section break so it never pushes a form onto an extra page.
  const breakPara = (sectPr) =>
    `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr>${sectPr}</w:pPr></w:p>`;
  const body = docs.map((d, i) => d.blocks + (i < docs.length - 1 ? breakPara(d.sectPr) : d.sectPr)).join('');
  const documentXml = `${head}${body}${tail}`;

  merged.updateFile('word/document.xml', Buffer.from(documentXml, 'utf8'));
  merged.updateFile('word/_rels/document.xml.rels', Buffer.from(rels, 'utf8'));
  merged.updateFile('[Content_Types].xml', Buffer.from(contentTypes, 'utf8'));
  // "Page X of Y" per form, not of the whole file.
  for (const entry of merged.getEntries()) {
    if (!/^word\/(?:header|footer)[^/]*\.xml$/.test(entry.entryName)) continue;
    const xml = entry.getData().toString('utf8');
    const fixed = xml.replace(/\bNUMPAGES\b/g, 'SECTIONPAGES');
    if (fixed !== xml) merged.updateFile(entry.entryName, Buffer.from(fixed, 'utf8'));
  }

  for (const name of ['word/document.xml', 'word/_rels/document.xml.rels', '[Content_Types].xml']) {
    const check = XMLValidator.validate(merged.getEntry(name).getData().toString('utf8'));
    if (check !== true) throw new Error(`${name} is not well-formed: ${JSON.stringify(check.err)}`);
  }
  merged.writeZip(path.resolve(out));
  const bytes = merged.toBuffer().length;
  return { forms: files.length, sections: (documentXml.match(/<w:sectPr\b/g) ?? []).length, sharedParts: partByHash.size, bytes };
}

const isCli = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isCli) {
  const [source, out] = process.argv.slice(2);
  if (!source || !out) {
    console.error('usage: node scripts/merge-docx-forms.mjs <jobId | folder> <out.docx>');
    process.exit(1);
  }
  const dir = existsSync(source) && statSync(source).isDirectory() ? path.resolve(source) : path.resolve(`server/data/jobs/${source}/output/Printable`);
  const files = (await readdir(dir)).filter((f) => /^Form\d+\.docx$/i.test(f)).sort();
  if (files.length === 0) throw new Error(`no Form*.docx in ${dir}`);
  const r = mergeDocxFiles(files.map((f) => path.join(dir, f)), out, { duplex: !process.argv.includes('--single-sided') });
  console.log(`${out}: ${r.forms} forms -> ${r.sections} sections, ${r.sharedParts} shared parts, ${(r.bytes / 1024 / 1024).toFixed(1)} MB`);
}
