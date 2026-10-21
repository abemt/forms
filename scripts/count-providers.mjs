// Count shifts per provider in a persisted job: node scripts/count-providers.mjs <jobId>
import { readFile } from 'node:fs/promises';
const id = process.argv[2];
const job = JSON.parse(await readFile(`server/data/jobs/${id}/job.json`, 'utf8'));
const counts = {};
for (const s of job.shifts) {
  const p = s.provider.split(',')[0].trim();
  counts[p] = (counts[p] ?? 0) + 1;
}
console.log(counts);
