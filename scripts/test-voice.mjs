// Real-HTTP end-to-end test of voice notes against a running server (port 8787):
// synthetic spoken report (Windows voice) -> Telegram-style OGG -> upload -> offline
// transcription -> dated items -> Log writer drafts -> preview -> daily report job -> forms.
// Uses December 2030 so no real draft is touched; removes everything it creates.
//   node scripts/test-voice.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const API = 'http://localhost:8787/api';
const ROOT = path.resolve('.');
const json = (body) => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ok = async (res) => {
  if (!res.ok) throw new Error(`${res.url} -> HTTP ${res.status}: ${await res.text()}`);
  return res;
};
const get = async (url) => (await ok(await fetch(`${API}${url}`))).json();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const SCRIPT = [
  'December 3rd.',
  'Steve went to day program at 8:30 in the morning and came back at 4 PM.',
  'He made chicken and rice for dinner by himself and then he washed the dishes.',
  'In the evening he played dominoes with Jerrell and he was very happy.',
  'Jerrell stayed home in the morning, he was drawing a picture of a car.',
  'In the afternoon Hanna took Jerrell to the barber shop for a haircut.',
  'The next day Steve stayed home because he was tired.',
  'He watched TV and did his laundry.',
  'Jerrell went for a walk with Nathanael in the evening.',
].join(' ');

const status = await get('/voice/status?refresh=1');
assert.equal(status.engine.ok, true, `voice engine not ready: ${status.engine.error}`);

const tmp = mkdtempSync(path.join(os.tmpdir(), 'joy-voice-test-'));
const cleanup = { notes: [], jobs: [], drafts: ['steven-2030-12', 'jerrell-2030-12'] };
try {
  const wav = path.join(tmp, 'note.wav');
  const ogg = path.join(tmp, 'audio_2030-12-04_21-10-00.ogg');
  const textFile = path.join(tmp, 'script.txt');
  execFileSync('powershell', ['-NoProfile', '-Command', `Set-Content -Encoding UTF8 -Path '${textFile}' -Value '${SCRIPT.replace(/'/g, "''")}'`]);
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'scripts', 'make-test-voice.ps1'), wav, textFile]);
  execFileSync(path.join(ROOT, 'tools', 'whisper', 'python', 'python.exe'), [path.join(ROOT, 'scripts', 'wav-to-ogg.py'), wav, ogg]);

  const form = new FormData();
  form.append('files', new Blob([readFileSync(ogg)], { type: 'audio/ogg' }), path.basename(ogg));
  const [created] = await (await ok(await fetch(`${API}/voice/notes`, { method: 'POST', body: form }))).json();
  cleanup.notes.push(created.id);
  assert.equal(created.recordedOn, '2030-12-04', 'date read from the Telegram file name');
  const started = Date.now();
  let note;
  for (;;) {
    await wait(1500);
    note = await get(`/voice/notes/${created.id}`);
    if (note.status === 'done' || note.status === 'failed') break;
    assert.ok(Date.now() - started < 600_000, 'transcription took more than 10 minutes');
  }
  assert.equal(note.status, 'done', `transcription failed: ${note.error}`);
  console.log(`transcribed ${note.duration}s of audio with ${note.model} on ${note.device} in ${Math.round((Date.now() - started) / 1000)}s`);
  console.log(`transcript: ${note.transcript}`);
  assert.match(note.transcript, /Steve/);
  assert.match(note.transcript, /Jerrell/);

  const items = note.items;
  const item = (re) => {
    const found = items.find((i) => re.test(i.text));
    assert.ok(found, `no item ${re}: ${items.map((i) => `${i.date} ${i.people} ${i.shift}: ${i.text}`).join(' | ')}`);
    return found;
  };
  for (const i of items) console.log(`  ${i.date} ${i.people.join('+').padEnd(15)} ${i.shift.padEnd(8)} ${i.text}`);
  assert.deepEqual(item(/day program/).people, ['steven']);
  assert.equal(item(/day program/).date, '2030-12-03');
  assert.equal(item(/dinner/).shift, 'evening');
  assert.deepEqual(item(/dominoes/).people.sort(), ['jerrell', 'steven']);
  assert.equal(item(/haircut/).shift, 'day');
  assert.deepEqual(item(/haircut/).people, ['jerrell']);
  assert.equal(item(/laundry/).date, '2030-12-04');
  assert.equal(item(/walk/).shift, 'evening');

  const { drafts } = await (await ok(await fetch(`${API}/voice/apply`, { method: 'POST', ...json({ noteIds: [created.id] }) }))).json();
  assert.deepEqual(drafts.map((d) => `${d.profileId}|${d.month}|${d.fromDay}-${d.toDay}`).sort(), ['jerrell|2030-12|3-4', 'steven|2030-12|3-4']);

  const draft = await get('/log-writer/drafts/steven/2030-12');
  assert.equal(draft.routineLevel, 'essentials');
  assert.match(draft.sourceNotes, /=== Voice note audio_2030-12-04_21-10-00\.ogg/);
  const preview = await (await ok(await fetch(`${API}/log-writer/preview`, { method: 'POST', ...json(draft) }))).json();
  const eve3 = preview.boxes.find((b) => b.day === 3 && b.shift === 'evening');
  assert.ok(eve3.voiceLines >= 2, 'Dec 3 evening carries her sentences');
  assert.match(eve3.notes, /dominoes/);
  assert.match(eve3.mood, /Happy/);
  const day4 = preview.boxes.find((b) => b.day === 4 && b.shift === 'day');
  assert.ok(!/Inner Vision/.test(day4.notes), 'Dec 4 is a home day (stayed home)');
  console.log(`preview ok: ${preview.boxes.length} boxes; Dec 3 evening = ${eve3.voiceLines} reported lines`);

  const job = await (await ok(await fetch(`${API}/log-writer/jobs`, { method: 'POST', ...json(draft) }))).json();
  cleanup.jobs.push(job.id);
  let detail;
  for (let i = 0; i < 90; i++) {
    await wait(2000);
    detail = await get(`/jobs/${job.id}`);
    if (detail.status === 'review' || detail.status === 'failed') break;
  }
  assert.equal(detail.status, 'review', `job did not reach review: ${detail.errors?.join('; ')}`);
  assert.equal(detail.shifts.length, 6);
  const dec3Evening = detail.shifts.find((s) => /December 03/.test(s.date) && s.shift === '4pm-12am');
  const text = Object.values(dec3Evening.values).filter((v) => typeof v === 'string').join(' ');
  assert.match(text, /dominoes/i, 'her sentence reached the form');
  await ok(await fetch(`${API}/jobs/${job.id}/generate`, { method: 'POST' }));
  for (let i = 0; i < 120; i++) {
    await wait(2000);
    detail = await get(`/jobs/${job.id}`);
    if (detail.status === 'done' || detail.status === 'failed') break;
  }
  assert.equal(detail.status, 'done');
  console.log(`forms ok: ${detail.formsCompleted} forms generated from the voice note`);
  console.log('all voice checks passed');
} finally {
  for (const id of cleanup.notes) await fetch(`${API}/voice/notes/${id}`, { method: 'DELETE' }).catch(() => undefined);
  for (const id of cleanup.jobs) rmSync(path.join(ROOT, 'server', 'data', 'jobs', id), { recursive: true, force: true });
  for (const name of cleanup.drafts) rmSync(path.join(ROOT, 'server', 'data', 'log-writer', 'drafts', `${name}.json`), { force: true });
  rmSync(tmp, { recursive: true, force: true });
}
