// Dump the text lines our docx reader produces for a Word shift log, the
// shifts the local extractor finds, and (with --map) what the local mapper
// fills for each shift — for debugging real client workbooks.
//   node scripts/dump-docx-log.mjs <file.docx> [--lines] [--map]
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { docxLogPages } from '../server/dist/services/docxLog.js';
import { extractShiftsLocally } from '../server/dist/services/local/extractor.js';
import { mapShiftLocally } from '../server/dist/services/local/mapper.js';
import { completeAssignments, absentLine } from '../server/dist/services/local/defaults.js';
import { fillBlankShifts } from '../server/dist/services/local/blanks.js';
import { validateAssignments } from '../server/dist/services/ai/fieldMapper.js';

const [file, ...flags] = process.argv.slice(2);
const pages = docxLogPages(new Uint8Array(await readFile(file)));
console.log(`pages: ${pages.length}`);
if (flags.includes('--lines')) {
  pages.forEach((p, i) => {
    console.log(`\n===== page ${i + 1} =====`);
    console.log(p);
  });
}
const skipped = [];
const extracted = extractShiftsLocally(pages, { paragraphLines: true, skipped });
const { drafts: shifts, fills } = fillBlankShifts(extracted, skipped);
console.log(`\nshifts: ${shifts.length}  (written: ${extracted.length}, blank boxes completed: ${fills.length})`);
for (const f of fills) console.log(`   blank -> ${f.kind.toUpperCase().padEnd(4)} ${f.date} ${f.shift} (${f.provider})`);
for (const s of shifts) {
  const away = absentLine(s.narrative);
  console.log(` ${s.date} | ${s.shift} | ${s.provider} | mood="${s.mood}" | ${s.narrative.length}ch: ${s.narrative.slice(0, 90).replace(/\n/g, ' / ')}${s.narrative.length > 90 ? '…' : ''}${away ? `   <<< AWAY: "${away}"` : ''}`);
}

if (flags.includes('--map')) {
  // Template fields from the most recent persisted job.
  const jobsDir = path.resolve('server/data/jobs');
  const dirs = await Promise.all((await readdir(jobsDir)).map(async (d) => ({ d, t: (await stat(path.join(jobsDir, d))).mtimeMs })));
  const latest = dirs.sort((a, b) => b.t - a.t)[0].d;
  const { templateFields } = JSON.parse(await readFile(path.join(jobsDir, latest, 'job.json'), 'utf8'));
  console.log(`\nmapping with ${templateFields.length} template fields (job ${latest})`);
  let total = 0;
  for (const s of shifts) {
    const validated = validateAssignments(mapShiftLocally(s, templateFields), s, templateFields);
    const fromNotes = validated.assignments.length;
    const { assignments, notes } = completeAssignments(validated.assignments, s, templateFields);
    const warnings = [...validated.warnings, ...notes];
    total += assignments.length;
    const sections = assignments.filter((a) => / - Support Type$/.test(a.field)).length;
    const moods = assignments.filter((a) => /^Mood: /.test(a.field) && a.value === true).map((a) => a.field.slice(6));
    console.log(` ${s.date} ${s.shift.padEnd(9)} ${String(assignments.length).padStart(3)} fields (${fromNotes} from notes) | ${sections} sections | moods=[${moods.join(', ')}] | warnings=${warnings.length}`);
    if (flags.includes('--detail')) {
      for (const a of assignments) if (!/^(Individual Name|Individual ID|Date|Shift:|Signature Date|Staff)/.test(a.field)) console.log(`      ${a.evidence ? '' : '~'}${a.field} => ${String(a.value).slice(0, 110).replace(/\n/g, ' / ')}`);
      for (const w of warnings) console.log(`      ! ${w}`);
    }
  }
  console.log(`\naverage fields per form: ${(total / shifts.length).toFixed(1)}`);
}
