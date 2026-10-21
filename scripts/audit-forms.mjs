// Audit every editable PDF of a job: count empty text fields / unselected
// radios / unchecked mood groups, and report the smallest font size used so
// overflow-shrinking is visible.   node scripts/audit-forms.mjs <jobId>
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, PDFTextField, PDFRadioGroup, PDFCheckBox } from 'pdf-lib';

const id = process.argv[2];
const dir = path.resolve(`server/data/jobs/${id}/output/Editable`);
const files = (await readdir(dir)).filter((f) => f.endsWith('.pdf')).sort();
let worst = { file: '', empty: 0 };
let minFont = 99;
const emptyNames = new Map();
let withImage = 0;
let imageButField = 0;
for (const f of files) {
  const bytes = await readFile(path.join(dir, f));
  const doc = await PDFDocument.load(bytes);
  const form = doc.getForm();
  const hasImage = bytes.toString('latin1').includes('/Subtype /Image');
  if (hasImage) withImage++;
  let empty = 0;
  let moodChecked = 0;
  let awayForm = false;
  for (const field of form.getFields()) {
    const name = field.getName();
    if (hasImage && /^Staff Signature$/.test(name)) imageButField++;
    if (field instanceof PDFTextField) {
      const text = field.getText() ?? '';
      if (name === 'Mood Description' && /^Not observed/i.test(text)) awayForm = true;
      // "Other" mood and typed signature are legitimately blank when unused.
      if (!text.trim() && !/^Mood: Other$|^Staff Signature$/.test(name)) {
        empty++;
        emptyNames.set(name, (emptyNames.get(name) ?? 0) + 1);
      }
      const da = field.acroField.getDefaultAppearance() ?? '';
      const m = da.match(/(\d+(?:\.\d+)?)\s+Tf/);
      if (m && text.trim()) minFont = Math.min(minFont, Number(m[1]));
    } else if (field instanceof PDFRadioGroup) {
      if (!field.getSelected()) {
        empty++;
        emptyNames.set(name, (emptyNames.get(name) ?? 0) + 1);
      }
    } else if (field instanceof PDFCheckBox && /^Mood: /.test(name) && field.isChecked()) {
      moodChecked++;
    }
  }
  if (moodChecked === 0 && !awayForm) {
    empty++;
    emptyNames.set('(no mood checkbox)', (emptyNames.get('(no mood checkbox)') ?? 0) + 1);
  }
  if (empty > worst.empty) worst = { file: f, empty };
}
console.log(`${files.length} forms audited`);
console.log(`signature image present: ${withImage}; of those still carrying a covering Staff Signature field: ${imageButField}`);
console.log(`worst form: ${worst.file} with ${worst.empty} empty field(s)`);
console.log(`smallest font size used for a filled text field: ${minFont}pt`);
if (emptyNames.size) {
  console.log('empty fields by name (count of forms):');
  for (const [n, c] of [...emptyNames.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${c.toString().padStart(3)}  ${n}`);
} else {
  console.log('no empty fields anywhere.');
}
