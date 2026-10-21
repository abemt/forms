// Regression snapshot: the complete field assignments the local engine
// produces for a workbook, as stable JSON — diff before/after engine changes.
//   node scripts/snapshot-mapping.mjs <workbook.docx> <out.json> [--job <jobId>] [--template <form.docx>]
// Template fields + spec come from the given job (default: the most recent
// persisted job) or are parsed from a Word template.
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { docxLogPages } from '../server/dist/services/docxLog.js';
import { extractShiftsLocally } from '../server/dist/services/local/extractor.js';
import { mapShiftLocally } from '../server/dist/services/local/mapper.js';
import { completeAssignments } from '../server/dist/services/local/defaults.js';
import { fillBlankShifts } from '../server/dist/services/local/blanks.js';
import { validateAssignments } from '../server/dist/services/ai/fieldMapper.js';
import { parseForm680Spec, docxParagraphs } from '../server/dist/services/docxTemplate.js';
import { inspectTemplate } from '../server/dist/services/templateInspector.js';
import { buildTemplateFromDocx } from '../server/dist/services/docxTemplate.js';

const [file, out, ...flags] = process.argv.slice(2);
const opt = (name) => { const i = flags.indexOf(name); return i >= 0 ? flags[i + 1] : undefined; };

let templateFields;
let spec;
if (opt('--template')) {
  const docx = new Uint8Array(await readFile(opt('--template')));
  spec = parseForm680Spec(docxParagraphs(docx));
  templateFields = await inspectTemplate(await buildTemplateFromDocx(docx));
} else {
  const jobsDir = path.resolve('server/data/jobs');
  let jobId = opt('--job');
  if (!jobId) {
    const dirs = await Promise.all((await readdir(jobsDir)).map(async (d) => ({ d, t: (await stat(path.join(jobsDir, d))).mtimeMs })));
    jobId = dirs.sort((a, b) => b.t - a.t)[0].d;
  }
  const job = JSON.parse(await readFile(path.join(jobsDir, jobId, 'job.json'), 'utf8'));
  templateFields = job.templateFields;
  spec = job.form680Spec;
}

const pages = docxLogPages(new Uint8Array(await readFile(file)));
const skipped = [];
const extracted = extractShiftsLocally(pages, { paragraphLines: true, skipped });
const { drafts: shifts, fills } = fillBlankShifts(extracted, skipped, spec);

const snapshot = [];
for (const s of shifts) {
  const validated = validateAssignments(mapShiftLocally(s, templateFields, spec), s, templateFields);
  const { assignments, notes } = completeAssignments(validated.assignments, s, templateFields, spec);
  snapshot.push({
    date: s.date,
    shift: s.shift,
    provider: s.provider,
    warnings: [...validated.warnings, ...notes],
    assignments: [...assignments].sort((a, b) => a.field.localeCompare(b.field)),
  });
}
await writeFile(out, JSON.stringify({ fills, shifts: snapshot }, null, 1));
console.log(`${shifts.length} shifts, ${snapshot.reduce((n, s) => n + s.assignments.length, 0)} assignments -> ${out}`);
