// Real-HTTP smoke test of the Log Writer API against a running server (port 8787):
// settings -> draft -> preview -> workbook -> job (analyze + generate) -> checks.
// Creates one throwaway job and removes it afterwards.
//   node scripts/test-log-writer.mjs
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { docxLogPages } from '../server/dist/services/docxLog.js';

const API = 'http://localhost:8787/api';
const json = (body) => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ok = async (res) => {
  if (!res.ok) throw new Error(`${res.url} -> HTTP ${res.status}: ${await res.text()}`);
  return res;
};

const settings = await (await ok(await fetch(`${API}/log-writer/settings/steven`))).json();
assert.equal(settings.program.name, 'Inner Vision Day Support');
assert.equal(settings.roster.weekdayDay, 'Hanna Tafesse, DSP');

const draft = {
  profileId: 'steven',
  month: '2026-10',
  fromDay: 1,
  toDay: 4,
  closures: [],
  events: [
    { id: 'e1', day: 2, shift: 'auto', kind: 'meal_out', place: 'IHOP', details: '', meal: 'lunch', withHousemate: true, mood: '' },
    { id: 'e2', day: 3, shift: 'auto', kind: 'outing', place: 'the pumpkin patch', details: 'he picked out a pumpkin and enjoyed the hayride', withHousemate: false, mood: '' },
    { id: 'e3', day: 1, shift: 'evening', kind: 'note', place: '', details: 'Steve called his sister and chatted for twenty minutes', withHousemate: false, mood: '' },
  ],
  overrides: {},
  sourceNotes: 'test run',
};
const preview = await (await ok(await fetch(`${API}/log-writer/preview`, { method: 'POST', ...json(draft) }))).json();
assert.equal(preview.boxes.length, 12, 'Oct 1-4 = 12 boxes');
const oct3 = preview.boxes.find((b) => b.day === 3 && b.shift === 'day');
assert.match(oct3.notes, /pumpkin patch/);
assert.equal(oct3.provider, 'Nathanael Yohannes, DSP', 'Sat Oct 3 is a weekend shift');
const oct1 = preview.boxes.find((b) => b.day === 1 && b.shift === 'day');
assert.match(oct1.notes, /Inner Vision Day Support/, 'Thu Oct 1 is a program day');
console.log(`preview ok: ${preview.boxes.length} boxes, ${preview.assumptions.length} assumptions`);

const saved = await (await ok(await fetch(`${API}/log-writer/drafts/steven/2026-10`, { method: 'PUT', ...json(draft) }))).json();
assert.equal(saved.events.length, 3);
const reloaded = await (await ok(await fetch(`${API}/log-writer/drafts/steven/2026-10`))).json();
assert.equal(reloaded.sourceNotes, 'test run');

const workbook = await ok(await fetch(`${API}/log-writer/workbook`, { method: 'POST', ...json(draft) }));
assert.match(workbook.headers.get('content-disposition') ?? '', /Steven_October2026_Oct1-4_Daily_Log_Entry \(filled\)\.docx/);
const bytes = new Uint8Array(await workbook.arrayBuffer());
const pages = docxLogPages(bytes);
const text = pages.map((p) => (typeof p === 'string' ? p : p.text ?? JSON.stringify(p))).join('\n');
assert.match(text, /October 01, 2026/);
assert.match(text, /October 04, 2026/);
assert.doesNotMatch(text, /October 05, 2026/, 'nothing written past the reported day');
assert.match(text, /pumpkin patch/);
assert.match(text, /Reporting Period: October 1.4, 2026/);
console.log(`workbook ok: ${bytes.length} bytes, ${pages.length} page(s)`);

const created = await (await ok(await fetch(`${API}/log-writer/jobs`, { method: 'POST', ...json(draft) }))).json();
console.log('job', created.id);
let job;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  job = await (await ok(await fetch(`${API}/jobs/${created.id}`))).json();
  if (job.status === 'review' || job.status === 'failed') break;
}
assert.equal(job.status, 'review', `job should reach review (was ${job.status}: ${job.errors.join('; ')})`);
assert.equal(job.shifts.length, 12);
assert.equal(job.completeRoutineFields, true);
const empties = job.shifts.flatMap((s) => s.assignments.filter((a) => a.value === '' || a.value === undefined));
assert.equal(empties.length, 0, 'completion policy leaves no empty fields');
const flagged = job.shifts.filter((s) => s.assignments.some((a) => /^(Medical Complaints|Behavioral Difficulty|Serious Incident)$/.test(a.field) && /^yes$/i.test(String(a.value))));
assert.equal(flagged.length, 0, 'routine month raises no incident flags');
console.log('job ok: 12 shifts in review, 0 empty fields, 0 incident flags');

await fetch(`${API}/jobs/${created.id}/generate`, { method: 'POST' });
for (let i = 0; i < 90; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  job = await (await ok(await fetch(`${API}/jobs/${created.id}`))).json();
  if (job.status === 'done' || job.status === 'failed') break;
}
assert.equal(job.status, 'done', `generation should finish (was ${job.status})`);
assert.equal(job.zipReady, true);
console.log(`generate ok: ${job.formsCompleted} forms, zip ${job.zipName}`);

await rm(path.resolve('server/data/jobs', created.id), { recursive: true, force: true });
await rm(path.resolve('server/data/log-writer/drafts/steven-2026-10.json'), { force: true });
console.log('cleaned up test job and draft - all Log Writer checks passed');
