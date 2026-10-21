// Print the form number for a date + shift in a persisted job.
//   node scripts/find-form.mjs <jobId> "June 18, 2026" "8am-4pm"
import { readFile } from 'node:fs/promises';
const [id, date, shift] = process.argv.slice(2);
const job = JSON.parse(await readFile(`server/data/jobs/${id}/job.json`, 'utf8'));
const s = job.shifts.find((x) => x.date === date && x.shift === shift);
if (!s) {
  console.log('not found');
  process.exit(1);
}
console.log(`Form${String(s.index + 1).padStart(3, '0')}`);
