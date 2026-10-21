// Diagnostic: embedded-font info of a docx (fontTable + raw font bytes).
import { readFile } from 'node:fs/promises';
import AdmZip from 'adm-zip';
const z = new AdmZip(await readFile(process.argv[2]));
const ft = z.getEntry('word/fontTable.xml').getData().toString('utf8');
for (const f of ft.match(/<w:font w:name="[^"]+">[\s\S]*?<\/w:font>/g) ?? []) {
  if (!/embed/i.test(f)) continue;
  console.log(f.replace(/<w:(panose1|sig|charset|family|pitch)[^>]*\/>/g, ''));
}
for (const e of z.getEntries()) {
  if (!e.entryName.startsWith('word/fonts/')) continue;
  const b = e.getData();
  console.log(e.entryName, b.length, 'bytes, magic', b.subarray(0, 4).toString('hex'));
}
