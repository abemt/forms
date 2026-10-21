// Rebuilds one of the staff-filled Daily Log Entry workbooks with the staffing
// corrections from the house manager (Sept 2026), leaving the original file
// untouched:
//   - every box's provider follows the confirmed schedule (Hanna mornings,
//     Rahel evenings - Hanna on June 1/3/5 -, Nathanael overnights + weekends),
//     whatever the staff had typed ("Abdela", misspellings, swaps);
//   - with --housemate: the staff notes call the new housemate "the new
//     member" / "J" from the day he moved in (July 20); one line naming him
//     (Jerrell Wright) is appended to that evening's box.
// Notes, moods and blank boxes are carried over unchanged.
//
//   node scripts/rebuild-workbook.mjs "<client workbook.docx>" "<out.docx>" [--housemate]
import { readFile, writeFile } from 'node:fs/promises';
import { Packer } from 'docx';
import { docxLogPages } from '../server/dist/services/docxLog.js';
import { extractShiftsLocally } from '../server/dist/services/local/extractor.js';
import { MONTHS, SHIFTS, buildDocument, monthDays, provider } from './build-entry-workbook.mjs';

const [input, output, ...flags] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node scripts/rebuild-workbook.mjs <in.docx> <out.docx> [--housemate]');
  process.exit(1);
}

// What the staff actually typed, normalised - only used to report the changes.
const ROSTER = [
  { match: /abdel/i, name: 'Abdela' },
  { match: /nat[ah]|nath/i, name: 'Nathanael Yohannes' },
  { match: /han+a/i, name: 'Hanna Tafesse' },
  { match: /rahel/i, name: 'Rahel Tafesse' },
];
function typedName(raw) {
  const hit = ROSTER.find((r) => r.match.test(raw));
  return hit ? hit.name : raw.replace(/\s*,?\s*DSP\s*$/i, '').trim();
}

const HOUSEMATE_MOVE_IN = { month: 'July', day: 20, shift: 'evening' };
const HOUSEMATE_LINE = 'The new member who moved in today is Jerrell Wright; Steve welcomed him to the house.';

const pages = docxLogPages(new Uint8Array(await readFile(input)));
const skipped = [];
const written = extractShiftsLocally(pages, { paragraphLines: true, skipped });
const monthName = written[0]?.date.match(/^[A-Za-z]+/)?.[0];
const month = MONTHS.find((m) => m.name === monthName);
if (!month) throw new Error(`could not tell which month "${input}" covers`);

const byKey = new Map();
for (const s of written) byKey.set(`${s.date}|${s.shift}`, { provider: s.provider, mood: s.mood, notes: s.narrative, blank: false });
for (const b of skipped) byKey.set(`${b.date}|${b.shift}`, { provider: b.provider, mood: '', notes: '', blank: true });

const fill = {};
const providers = {};
const changes = { reassigned: [], housemate: [] };
for (const day of monthDays(month)) {
  const date = day.heading.replace(/\s*\(.*$/, '');
  fill[day.heading] = {};
  providers[day.heading] = {};
  for (const shift of SHIFTS) {
    const box = byKey.get(`${date}|${shift.time}`);
    if (!box) throw new Error(`no box found for ${date} ${shift.time}`);
    const name = provider(shift.kind, day);
    const typed = typedName(box.provider);
    if (!name.startsWith(typed)) changes.reassigned.push(`${date} ${shift.time}: ${typed} -> ${name.replace(/, DSP$/, '')}`);
    providers[day.heading][shift.kind] = name;

    let notes = box.notes;
    if (
      flags.includes('--housemate') &&
      !box.blank &&
      day.month === HOUSEMATE_MOVE_IN.month &&
      day.day === HOUSEMATE_MOVE_IN.day &&
      shift.kind === HOUSEMATE_MOVE_IN.shift
    ) {
      notes = notes ? `${notes}\n${HOUSEMATE_LINE}` : HOUSEMATE_LINE;
      changes.housemate.push(`${date} ${shift.time}`);
    }
    // Blank boxes keep an empty mood + notes so the app still completes them.
    fill[day.heading][shift.kind] = box.blank ? null : { mood: box.mood, notes };
  }
}

const bytes = await Packer.toBuffer(buildDocument(month, fill, providers));
await writeFile(output, bytes);
console.log(`Wrote ${output} (${bytes.length} bytes): ${written.length} written boxes, ${skipped.length} blank boxes kept blank`);
console.log(`provider changed from what staff typed in ${changes.reassigned.length} box(es):`);
for (const c of changes.reassigned) console.log(`   ${c}`);
if (changes.housemate.length) console.log(`housemate lines added to: ${changes.housemate.join('; ')}`);
