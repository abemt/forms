import { readFile, writeFile } from 'node:fs/promises';
import { Packer } from 'docx';
import { INDIVIDUALS, buildDocument, monthDays } from './build-entry-workbook.mjs';

const [profile, monthValue, output, name, individualId, rosterFile] = process.argv.slice(2);
const [year, monthNumber] = monthValue.split('-').map(Number);
const date = new Date(Date.UTC(year, monthNumber - 1, 1));
const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
const admissionMonth = profile === 'jerrell' && monthValue === '2026-07';
const month = { name: date.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }), year, days, ...(admissionMonth ? { startDay: 20 } : {}) };
const roster = rosterFile ? JSON.parse(await readFile(rosterFile, 'utf8')) : null;
const individual = { ...INDIVIDUALS[profile], header: `Individual Supported: ${name} | ID Number: ${individualId}`, info: '', keywords: 'observed activities, staff supports, medication records, meals, hygiene, appointments, and safety concerns', ...(roster ? { roster } : {}) };
// Pre-fill every shift's provider from the saved roster (falls back to the built-in schedule).
let providers = null;
if (roster) {
  providers = {};
  for (const day of monthDays(month)) {
    providers[day.heading] = day.weekend
      ? { day: roster.weekendDay, evening: roster.weekendEvening, night: roster.weekendNight }
      : { day: roster.weekdayDay, evening: roster.weekdayEvening, night: roster.weekdayNight };
  }
}
await writeFile(output, await Packer.toBuffer(buildDocument(month, null, providers, individual)));