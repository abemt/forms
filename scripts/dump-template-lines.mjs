// Debug: rendered text lines of a Word template as the faithful builder sees them.
//   node scripts/dump-template-lines.mjs <template.docx> [pattern]
import { readFile } from 'node:fs/promises';
import { convertDocxToPdfExact } from '../server/dist/services/soffice.js';
import { prepareTemplateDocx } from '../server/dist/services/docxFormFiller.js';
import { extractPdfTextItems } from '../server/dist/services/pdfText.js';

const [input, pattern] = process.argv.slice(2);
const pdf = await convertDocxToPdfExact(prepareTemplateDocx(new Uint8Array(await readFile(input))));
const pages = await extractPdfTextItems(pdf);
const re = pattern ? new RegExp(pattern, 'i') : null;
pages.forEach((page, pi) => {
  const byY = new Map();
  for (const item of page.items) {
    let key;
    for (const k of byY.keys()) if (Math.abs(k - item.y) <= 2) { key = k; break; }
    if (key === undefined) key = item.y;
    byY.set(key, [...(byY.get(key) ?? []), item]);
  }
  const lines = [...byY.entries()].sort((a, b) => b[0] - a[0]);
  for (const [y, items] of lines) {
    items.sort((a, b) => a.x - b.x);
    const text = items.map((i) => i.str).join('').replace(/\s+/g, ' ').trim();
    if (re && !re.test(text)) continue;
    console.log(`p${pi + 1} y=${y.toFixed(1)} | ${text.slice(0, 110)}`);
    if (re) for (const i of items) if (i.str.trim()) console.log(`      x=${i.x.toFixed(1)} w=${i.w.toFixed(1)} h=${i.h.toFixed(1)} ${JSON.stringify(i.str)}`);
  }
});
