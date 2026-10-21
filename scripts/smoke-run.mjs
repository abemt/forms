// Ad-hoc e2e: upload a log (arg or the May sample), extract, generate, wait, report.
//   node scripts/smoke-run.mjs <log.docx|pdf> [--template <form.docx>] [--profile steven|jerrell] [--complete]
// --profile uses the saved daily template of that individual; --complete turns on
// the routine-completion policy (no empty fields) and generates once the job
// reaches review, since the API disables auto-generate for completed drafts.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const API = 'http://localhost:8787/api/jobs';
const args = process.argv.slice(2);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i > -1 ? args[i + 1] : undefined;
};
const template = valueOf('--template') ? path.resolve(valueOf('--template')) : undefined;
const profile = valueOf('--profile');
const complete = args.includes('--complete');
const skip = new Set([valueOf('--template'), valueOf('--profile')].filter(Boolean));
const positional = args.filter((a) => !a.startsWith('--') && !skip.has(a));
const log = path.resolve(positional[0] ?? 'Steven_May2026_Complete_Monthly_Log.pdf');
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const mime = log.toLowerCase().endsWith('.docx') ? DOCX : 'application/pdf';

const form = new FormData();
form.append('log', new Blob([await readFile(log)], { type: mime }), path.basename(log));
if (template) form.append('template', new Blob([await readFile(template)], { type: DOCX }), path.basename(template));
form.append('autoGenerate', 'true');
if (profile) form.append('profileId', profile);
if (complete) form.append('completeRoutineFields', 'true');
const res = await fetch(API, { method: 'POST', body: form });
const created = await res.json();
if (!res.ok) {
  console.error('create failed:', created);
  process.exit(1);
}
console.log('job', created.id);
await fetch(`${API}/${created.id}/extract`, { method: 'POST' });

let job;
let generateRequested = false;
for (;;) {
  await new Promise((r) => setTimeout(r, 4000));
  job = await (await fetch(`${API}/${created.id}`)).json();
  process.stdout.write(`\r${job.status}: ${job.stage}                    `);
  if (job.status === 'review' && !generateRequested) {
    generateRequested = true;
    const gen = await fetch(`${API}/${created.id}/generate`, { method: 'POST' });
    if (!gen.ok) {
      console.error('\ngenerate failed:', await gen.json());
      process.exit(1);
    }
    continue;
  }
  if (job.status === 'done' || job.status === 'failed') break;
}
console.log();
console.log('errors:', job.errors);
console.log('job warnings:', job.warnings);
const withWarnings = job.shifts.filter((s) => s.warnings.length > 0);
console.log(`shifts with warnings: ${withWarnings.length}/${job.shifts.length}`);
for (const s of withWarnings.slice(0, 5)) console.log(` - #${s.index + 1} ${s.provider}: ${s.warnings.join(' | ')}`);
console.log('\nextracted shifts:');
for (const s of job.shifts) {
  console.log(
    ` #${String(s.index + 1).padStart(3, '0')} ${s.date} ${s.shift.padEnd(9)} ${s.provider.padEnd(24)} mood="${s.mood}" narrative=${s.narrative.length}ch`,
  );
}
const s0 = job.shifts[0];
console.log(`\nForm001 narrative (${s0.values['Shift Narrative']?.length ?? 0} chars):\n  ${s0.values['Shift Narrative']}`);
const byProvider = {};
for (const s of job.shifts) byProvider[s.provider] = (byProvider[s.provider] ?? 0) + 1;
console.log('\nshifts per provider:', byProvider);
await writeFile(path.join(process.env.TEMP ?? '/tmp', 'joyform-test-jobid.txt'), created.id);
