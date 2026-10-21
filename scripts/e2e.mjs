#!/usr/bin/env node
/**
 * End-to-end test for Form §680 AutoNotes.
 *
 * Boots a stub OpenAI-compatible AI server (deterministic, regex-based) and the
 * real application server, then pushes the real monthly log PDF through the
 * complete pipeline: upload -> AI extraction -> AI field mapping -> review ->
 * override editing -> preview -> generation -> ZIP download. Asserts on every
 * stage, including AcroForm editability of the output PDFs.
 *
 * Usage:  npm run build && npm run e2e
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { PDFDocument } from 'pdf-lib';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LOG_PDF = path.join(ROOT, 'Steven_May2026_Complete_Monthly_Log.pdf');
const SERVER_ENTRY = path.join(ROOT, 'server', 'dist', 'index.js');
const STUB_PORT = 8899;
const APP_PORT = 8790;
const APP = `http://127.0.0.1:${APP_PORT}`;
const EXPECTED_SHIFTS = 81;

let failures = 0;
function assert(cond, label) {
  if (cond) {
    console.log(`  ✔ ${label}`);
  } else {
    failures++;
    console.error(`  ✘ FAIL: ${label}`);
  }
}

// ---------------------------------------------------------------------------
// Stub AI: deterministic extraction + mapping so the E2E needs no API key.
// ---------------------------------------------------------------------------

function parseShiftsFromChunk(chunk) {
  const shifts = [];
  let date = '';
  let current = null;
  const push = () => {
    if (current && current.narrative.length) {
      shifts.push({ ...current, narrative: current.narrative.join(' ').trim() });
    }
    current = null;
  };
  for (const rawLine of chunk.split('\n')) {
    const line = rawLine.trim();
    if (!line || /^\[PAGE \d+\]$/.test(line)) continue;
    const dateMatch = line.match(/^([A-Z][a-z]+ \d{2}, \d{4}) \([A-Za-z]+\)(?:\s*-.*)?$/);
    if (dateMatch) {
      push();
      date = dateMatch[1];
      continue;
    }
    const shiftMatch = line.match(/^Shift \(Start and End Time\):\s*(.+)$/);
    if (shiftMatch) {
      push();
      current = { date, shift: shiftMatch[1].trim(), provider: '', mood: '', narrative: [] };
      continue;
    }
    const provMatch = line.match(/^Assigned Provider:\s*(.+?)\s*\|\s*Observed Mood:\s*(.+)$/);
    if (provMatch && current) {
      current.provider = provMatch[1].trim();
      current.mood = provMatch[2].trim();
      continue;
    }
    if (current) current.narrative.push(line);
  }
  push();
  return shifts;
}

const MOOD_SYNONYMS = {
  happy: 'Happy', content: 'Content', excited: 'Excited', cheerful: 'Happy',
  upbeat: 'Happy', joyful: 'Happy', calm: 'Calm', peaceful: 'Calm',
  relaxed: 'Calm', easygoing: 'Calm', friendly: 'Friendly', outgoing: 'Outgoing',
  chatty: 'Outgoing', sociable: 'Friendly', cooperative: 'Considerate',
  sleepy: 'Decreased energy/Fatigue', focused: 'Considerate',
};

function sentenceWith(text, regex) {
  for (const sentence of text.split(/(?<=\.)\s+/)) {
    if (regex.test(sentence)) return sentence.trim();
  }
  return undefined;
}

function mapShiftToAssignments(fields, shift) {
  const names = new Set(fields.map((f) => f.name));
  const byName = new Map(fields.map((f) => [f.name, f]));
  const assignments = [];
  const add = (field, value, evidence) => {
    if (names.has(field)) assignments.push({ field, value, evidence });
  };

  if (shift.date) add('Date', shift.date, shift.date);
  if (shift.shift) add(`Shift: ${shift.shift}`, true, shift.shift);
  if (shift.mood) add('Mood Description', shift.mood, shift.mood);

  for (const word of shift.mood.split(/[,/]+/).map((w) => w.trim()).filter(Boolean)) {
    const mapped = MOOD_SYNONYMS[word.toLowerCase()] ?? word;
    add(`Mood: ${mapped}`, true, word);
  }

  const provMatch = shift.provider.match(/^(.+?),\s*([A-Z]{2,4})$/);
  if (provMatch) {
    add('Staff Name', provMatch[1], shift.provider);
    add('Staff Title', provMatch[2], shift.provider);
  } else if (shift.provider) {
    add('Staff Name', shift.provider, shift.provider);
  }
  if (shift.date) add('Signature Date', shift.date, shift.date);

  if (shift.narrative) {
    add('Shift Narrative', shift.narrative, shift.narrative.split(/\s+/).slice(0, 12).join(' '));
  }

  const text = shift.narrative;
  const sectionRules = [
    { prefix: 'Outcome 4', regex: /outcome 4|cook|meal|kitchen|lunchbox|dinner/i },
    { prefix: 'Outcome 2', regex: /outcome 2|outing|community|park|mall|shopping|walk|river/i },
    { prefix: 'Identified Risk 1', regex: /risk 1|water|hydrat|fluid|glycemic drink/i },
    { prefix: 'Identified Risk 2', regex: /risk 2|seizure/i },
    { prefix: 'Routine Support 3', regex: /routine support 3|medication|insulin/i },
    { prefix: 'Routine Support 5', regex: /laundry/i },
    { prefix: 'Routine Support 4', regex: /housekeeping|cleaning|chores/i },
    { prefix: 'Routine Support 10', regex: /taxi|transport|drove/i },
  ];
  for (const rule of sectionRules) {
    const sentence = sentenceWith(text, rule.regex);
    if (!sentence) continue;
    const typeField = fields.find(
      (f) => f.name.startsWith(rule.prefix) && f.name.endsWith('- Support Type'),
    );
    const docField = fields.find(
      (f) => f.name.startsWith(rule.prefix) && f.name.endsWith('- Documentation'),
    );
    if (typeField) {
      const options = byName.get(typeField.name)?.options ?? [];
      let option = options.find((o) => o.startsWith('Monitor'));
      if (/remind|encourag|prompt|steer/i.test(sentence)) {
        option = options.find((o) => o.startsWith('Reminder')) ?? option;
      }
      if (/independent/i.test(sentence)) {
        option = options.find((o) => o === 'Independent') ?? option;
      }
      if (/administered|staff assisted/i.test(sentence)) {
        option = options.find((o) => o.startsWith('Full Physical')) ?? option;
      }
      if (option) assignments.push({ field: typeField.name, value: option, evidence: sentence });
    }
    if (docField) assignments.push({ field: docField.name, value: sentence, evidence: sentence });
  }

  const medSentence = sentenceWith(text, /medication|insulin/i);
  if (medSentence) {
    add('Medication Received', 'Yes', medSentence);
    add('Medication Received Explanation', medSentence, medSentence);
  }
  const commSentence = sentenceWith(text, /taxi|outing|park|mall|shopping|walk|community|day support/i);
  if (commSentence) add('Community Activity', commSentence, commSentence);

  return assignments;
}

function startStubAi() {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || !req.url?.includes('/chat/completions')) {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const system = payload.messages.find((m) => m.role === 'system')?.content ?? '';
        const user = payload.messages.find((m) => m.role === 'user')?.content ?? '';
        let result;
        if (system.includes('TASK: EXTRACT_SHIFTS')) {
          const chunk = user.replace(/^Extract all shifts from this portion of the report:\s*/, '');
          result = { shifts: parseShiftsFromChunk(chunk) };
        } else if (system.includes('TASK: MAP_FIELDS')) {
          const fieldsJson = user.slice(user.indexOf('FIELDS:') + 7, user.indexOf('SHIFT:')).trim();
          const shiftJson = user
            .slice(user.indexOf('SHIFT:') + 6, user.indexOf('HINTS'))
            .trim();
          const fields = JSON.parse(fieldsJson);
          const shift = JSON.parse(shiftJson);
          result = { assignments: mapShiftToAssignments(fields, shift), warnings: [] };
        } else {
          result = {};
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }),
        );
      } catch (err) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: String(err) } }));
      }
    });
  });
  return new Promise((resolve) => server.listen(STUB_PORT, '127.0.0.1', () => resolve(server)));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitFor(fn, { timeoutMs = 180_000, intervalMs = 500, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function main() {
  if (!fs.existsSync(SERVER_ENTRY)) {
    console.error('server/dist not found — run "npm run build" first.');
    process.exit(1);
  }
  if (!fs.existsSync(LOG_PDF)) {
    console.error(`Sample log PDF not found at ${LOG_PDF}`);
    process.exit(1);
  }

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'form680-e2e-'));
  console.log(`\nE2E starting (data dir: ${dataDir})`);

  const stub = await startStubAi();
  console.log(`Stub AI listening on :${STUB_PORT}`);

  const serverProc = spawn('node', [SERVER_ENTRY], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(APP_PORT),
      DATA_DIR: dataDir,
      AI_BASE_URL: `http://127.0.0.1:${STUB_PORT}/v1`,
      AI_MODEL: 'stub-model',
      AI_API_KEY: '',
      AI_CONCURRENCY: '8',
      PDF_CONCURRENCY: '8',
      WEB_DIST: path.join(ROOT, 'web', 'dist'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', (d) => process.env.E2E_VERBOSE && process.stdout.write(d));
  serverProc.stderr.on('data', (d) => process.stderr.write(d));

  try {
    await waitFor(
      async () => {
        try {
          const res = await fetch(`${APP}/api/health`);
          return res.ok ? res.json() : undefined;
        } catch {
          return undefined;
        }
      },
      { label: 'server health', timeoutMs: 30_000 },
    );
    console.log('\n[1] Health');
    const health = await (await fetch(`${APP}/api/health`)).json();
    assert(health.ok === true, 'health ok');
    assert(health.aiConfigured === true, 'AI configured (keyless localhost stub)');

    console.log('\n[2] Built-in template');
    const tplRes = await fetch(`${APP}/api/templates/builtin-680.pdf`);
    assert(tplRes.ok, 'built-in template downloads');
    const tplBytes = new Uint8Array(await tplRes.arrayBuffer());
    const tplDoc = await PDFDocument.load(tplBytes);
    assert(tplDoc.getForm().getFields().length > 90, 'built-in template has AcroForm fields');

    console.log('\n[3] Create job (review mode)');
    const form = new FormData();
    form.set(
      'log',
      new Blob([fs.readFileSync(LOG_PDF)], { type: 'application/pdf' }),
      'Steven_Form680_Distributed_Shifts_May2026.pdf',
    );
    form.set('autoGenerate', 'false');
    const createRes = await fetch(`${APP}/api/jobs`, { method: 'POST', body: form });
    assert(createRes.status === 201, 'job created (201)');
    const job = await createRes.json();
    assert(typeof job.id === 'string' && job.id.length > 0, 'job has id');
    assert(job.templateSource === 'builtin', 'built-in template selected automatically');
    assert(Array.isArray(job.templateFields) && job.templateFields.length > 90, 'template fields cataloged');

    console.log('\n[4] Extraction + mapping');
    const extractRes = await fetch(`${APP}/api/jobs/${job.id}/extract`, { method: 'POST' });
    assert(extractRes.status === 202, 'extraction accepted (202)');
    const reviewJob = await waitFor(
      async () => {
        const res = await fetch(`${APP}/api/jobs/${job.id}`);
        const j = await res.json();
        if (j.status === 'failed') throw new Error(`job failed: ${j.errors.join('; ')}`);
        return j.status === 'review' ? j : undefined;
      },
      { label: 'review status' },
    );
    assert(reviewJob.shiftsFound === EXPECTED_SHIFTS, `found all ${EXPECTED_SHIFTS} shifts`);
    assert(reviewJob.shifts.length === EXPECTED_SHIFTS, 'shift details returned');
    const first = reviewJob.shifts[0];
    assert(first.date === 'May 01, 2026', `shifts sorted by date (first: ${first.date})`);
    assert(first.shift === '8am-4pm', 'first shift is the day shift');
    assert(first.values['Date'] === 'May 01, 2026', 'Date field mapped');
    assert(first.values['Shift: 8am-4pm'] === true, 'shift checkbox mapped');
    assert(
      typeof first.values['Mood Description'] === 'string' && first.values['Mood Description'].length > 10,
      'mood description mapped',
    );
    const moodChecks = Object.entries(first.values).filter(
      ([k, v]) => k.startsWith('Mood: ') && v === true,
    );
    assert(moodChecks.length > 0, `mood checkboxes checked (${moodChecks.map(([k]) => k).join(', ')})`);
    const evidenced = first.assignments.every((a) => a.evidence && a.evidence.length > 0);
    assert(evidenced, 'every assignment carries evidence');
    const shiftWithStaff = reviewJob.shifts.find((s) => s.values['Staff Name']);
    assert(!!shiftWithStaff, 'staff name mapped from provider');

    console.log('\n[5] Anti-hallucination guard');
    // The stub emitted only evidence-backed assignments; verify the server kept
    // Individual Name's template default rather than inventing content.
    assert(first.values['Individual Name'] === undefined, 'no unevidenced Individual Name assignment');

    console.log('\n[6] Review editing (PATCH overrides)');
    const patchRes = await fetch(`${APP}/api/jobs/${job.id}/shifts/0`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        overrides: { 'Mood: Other': 'E2E override note', 'Mood: Happy': true },
      }),
    });
    assert(patchRes.ok, 'override PATCH accepted');
    const patched = await patchRes.json();
    assert(patched.values['Mood: Other'] === 'E2E override note', 'text override applied');
    assert(patched.values['Mood: Happy'] === true, 'checkbox override applied');

    console.log('\n[7] Preview');
    const previewRes = await fetch(`${APP}/api/jobs/${job.id}/shifts/0/preview.pdf`);
    assert(previewRes.ok, 'preview endpoint responds');
    const previewBytes = new Uint8Array(await previewRes.arrayBuffer());
    const previewDoc = await PDFDocument.load(previewBytes);
    const previewForm = previewDoc.getForm();
    assert(previewForm.getFields().length > 90, 'preview keeps AcroForm fields (editable)');
    assert(
      previewForm.getTextField('Mood: Other').getText() === 'E2E override note',
      'preview reflects override',
    );

    console.log('\n[8] Generation + ZIP');
    const genRes = await fetch(`${APP}/api/jobs/${job.id}/generate`, { method: 'POST' });
    assert(genRes.status === 202, 'generation accepted (202)');
    const doneJob = await waitFor(
      async () => {
        const res = await fetch(`${APP}/api/jobs/${job.id}`);
        const j = await res.json();
        if (j.status === 'failed') throw new Error(`job failed: ${j.errors.join('; ')}`);
        return j.status === 'done' ? j : undefined;
      },
      { label: 'done status' },
    );
    assert(doneJob.formsCompleted === EXPECTED_SHIFTS, `all ${EXPECTED_SHIFTS} forms generated`);
    assert(doneJob.zipReady === true, 'zip ready');
    assert(/^(?:Steven_)?May2026_Forms\.zip$/.test(doneJob.zipName), `zip named by person/month (${doneJob.zipName})`);
    assert(doneJob.errors.length === 0, 'no generation errors');

    console.log('\n[9] ZIP contents');
    const zipRes = await fetch(`${APP}/api/jobs/${job.id}/download`);
    assert(zipRes.ok, 'zip downloads');
    const zipPath = path.join(dataDir, 'out.zip');
    fs.writeFileSync(zipPath, Buffer.from(await zipRes.arrayBuffer()));
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries().map((e) => e.entryName);
    const editable = entries.filter((e) => e.startsWith('Editable/') && e.endsWith('.pdf')).sort();
    const printable = entries.filter((e) => e.startsWith('PDF/') && e.endsWith('.pdf')).sort();
    assert(editable.length === EXPECTED_SHIFTS, `Editable/ has ${EXPECTED_SHIFTS} PDFs`);
    assert(printable.length === EXPECTED_SHIFTS, `PDF/ has ${EXPECTED_SHIFTS} printable PDFs`);
    assert(editable[0] === 'Editable/Form001.pdf', 'sequential naming (Form001.pdf)');
    assert(
      editable[EXPECTED_SHIFTS - 1] === `Editable/Form${String(EXPECTED_SHIFTS).padStart(3, '0')}.pdf`,
      'last form numbered correctly',
    );

    console.log('\n[10] Editable PDFs are true AcroForms');
    const ed1 = await PDFDocument.load(zip.getEntry('Editable/Form001.pdf').getData());
    const ed1Form = ed1.getForm();
    assert(ed1Form.getFields().length > 90, 'editable form keeps all fields');
    assert(ed1Form.getTextField('Date').getText() === 'May 01, 2026', 'Date filled in editable PDF');
    assert(ed1Form.getCheckBox('Shift: 8am-4pm').isChecked(), 'shift checkbox checked in editable PDF');
    assert(
      ed1Form.getTextField('Mood: Other').getText() === 'E2E override note',
      'override persisted into final editable PDF',
    );
    const desc = ed1Form.getTextField('Mood Description').getText() ?? '';
    assert(desc.length > 10, 'mood description text in final PDF');
    // Radio group filled somewhere across the month
    const ed2 = await PDFDocument.load(zip.getEntry('Editable/Form002.pdf').getData());
    const radioSelected = ed2
      .getForm()
      .getFields()
      .some((f) => f.constructor.name === 'PDFRadioGroup' && ed2.getForm().getRadioGroup(f.getName()).getSelected());
    assert(radioSelected, 'support-type radio selected in Form002 (evening shift)');

    console.log('\n[11] Printable PDFs are flattened');
    const pr1 = await PDFDocument.load(zip.getEntry('PDF/Form001.pdf').getData());
    assert(pr1.getForm().getFields().length === 0, 'printable form has zero fields (flattened)');

    console.log('\n[12] AI response caching');
    const cacheDir = path.join(dataDir, 'cache');
    const cacheFiles = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir) : [];
    assert(cacheFiles.length > EXPECTED_SHIFTS, `cache populated (${cacheFiles.length} entries)`);
  } finally {
    serverProc.kill('SIGTERM');
    stub.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  await localSuite();

  console.log(`\n${failures === 0 ? 'E2E PASSED' : `E2E FAILED (${failures} assertion(s))`}\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

/**
 * Zero-cost local engine suite: no AI provider at all (the out-of-the-box
 * configuration). ENGINE=auto must resolve to the built-in rule engine and
 * produce all forms without a single network call.
 */
async function localSuite() {
  const LOCAL_PORT = 8791;
  const LOCAL = `http://127.0.0.1:${LOCAL_PORT}`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'form680-e2e-local-'));
  console.log(`\n=== LOCAL ENGINE SUITE (no AI, $0) — data dir: ${dataDir} ===`);

  const serverProc = spawn('node', [SERVER_ENTRY], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(LOCAL_PORT),
      DATA_DIR: dataDir,
      ENGINE: 'auto',
      AI_API_KEY: '',
      AI_BASE_URL: 'https://api.openai.com/v1',
      PDF_CONCURRENCY: '8',
      WEB_DIST: path.join(ROOT, 'web', 'dist'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', (d) => process.env.E2E_VERBOSE && process.stdout.write(d));
  serverProc.stderr.on('data', (d) => process.stderr.write(d));

  try {
    await waitFor(
      async () => {
        try {
          const res = await fetch(`${LOCAL}/api/health`);
          return res.ok ? res.json() : undefined;
        } catch {
          return undefined;
        }
      },
      { label: 'local server health', timeoutMs: 30_000 },
    );

    console.log('\n[L1] Health resolves to local engine');
    const health = await (await fetch(`${LOCAL}/api/health`)).json();
    assert(health.ok === true, 'health ok');
    assert(health.engine === 'local', `engine is local (${health.engine})`);
    assert(health.aiConfigured === false, 'no AI configured');

    console.log('\n[L2] Full pipeline without AI');
    const form = new FormData();
    form.set(
      'log',
      new Blob([fs.readFileSync(LOG_PDF)], { type: 'application/pdf' }),
      'Steven_Form680_Distributed_Shifts_May2026.pdf',
    );
    form.set('autoGenerate', 'false');
    const createRes = await fetch(`${LOCAL}/api/jobs`, { method: 'POST', body: form });
    assert(createRes.status === 201, 'job created');
    const job = await createRes.json();

    const extractRes = await fetch(`${LOCAL}/api/jobs/${job.id}/extract`, { method: 'POST' });
    assert(extractRes.status === 202, 'extraction accepted');
    const reviewJob = await waitFor(
      async () => {
        const res = await fetch(`${LOCAL}/api/jobs/${job.id}`);
        const j = await res.json();
        if (j.status === 'failed') throw new Error(`local job failed: ${j.errors.join('; ')}`);
        return j.status === 'review' ? j : undefined;
      },
      { label: 'local review status' },
    );
    assert(reviewJob.shiftsFound === EXPECTED_SHIFTS, `local engine found all ${EXPECTED_SHIFTS} shifts`);
    const first = reviewJob.shifts[0];
    assert(first.values['Date'] === 'May 01, 2026', 'Date mapped locally');
    assert(first.values['Shift: 8am-4pm'] === true, 'shift checkbox mapped locally');
    assert(
      typeof first.values['Mood Description'] === 'string' && first.values['Mood Description'].length > 10,
      'mood description mapped locally',
    );
    const moodChecks = Object.entries(first.values).filter(([k, v]) => k.startsWith('Mood: ') && v === true);
    assert(moodChecks.length > 0, `local mood checkboxes (${moodChecks.map(([k]) => k).join(', ')})`);
    assert(
      reviewJob.shifts.every((s) => s.assignments.every((a) => a.evidence && a.evidence.length > 0)),
      'every local assignment carries evidence',
    );
    const supportTyped = reviewJob.shifts.some((s) =>
      Object.entries(s.values).some(([k, v]) => k.endsWith('Support Type') && typeof v === 'string' && v),
    );
    assert(supportTyped, 'support-type radios selected where evidence allows');

    console.log('\n[L3] Generation + ZIP without AI');
    const genRes = await fetch(`${LOCAL}/api/jobs/${job.id}/generate`, { method: 'POST' });
    assert(genRes.status === 202, 'generation accepted');
    const doneJob = await waitFor(
      async () => {
        const res = await fetch(`${LOCAL}/api/jobs/${job.id}`);
        const j = await res.json();
        if (j.status === 'failed') throw new Error(`local job failed: ${j.errors.join('; ')}`);
        return j.status === 'done' ? j : undefined;
      },
      { label: 'local done status' },
    );
    assert(doneJob.formsCompleted === EXPECTED_SHIFTS, `all ${EXPECTED_SHIFTS} forms generated locally`);
    assert(/^(?:Steven_)?May2026_Forms\.zip$/.test(doneJob.zipName), `zip named by person/month (${doneJob.zipName})`);

    const zipRes = await fetch(`${LOCAL}/api/jobs/${job.id}/download`);
    assert(zipRes.ok, 'zip downloads');
    const zipPath = path.join(dataDir, 'out.zip');
    fs.writeFileSync(zipPath, Buffer.from(await zipRes.arrayBuffer()));
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries().map((e) => e.entryName);
    assert(
      entries.filter((e) => e.startsWith('Editable/') && e.endsWith('.pdf')).length === EXPECTED_SHIFTS,
      `Editable/ has ${EXPECTED_SHIFTS} PDFs`,
    );
    assert(
      entries.filter((e) => e.startsWith('PDF/') && e.endsWith('.pdf')).length === EXPECTED_SHIFTS,
      `PDF/ has ${EXPECTED_SHIFTS} printable PDFs`,
    );
    const ed1 = await PDFDocument.load(zip.getEntry('Editable/Form001.pdf').getData());
    assert(ed1.getForm().getTextField('Date').getText() === 'May 01, 2026', 'Date filled in local editable PDF');
    assert(ed1.getForm().getFields().length > 90, 'local editable form keeps AcroForm fields');

    console.log('\n[L4] Word (.docx) template upload -> fillable PDF conversion');
    const docxForm = new FormData();
    docxForm.set(
      'log',
      new Blob([fs.readFileSync(LOG_PDF)], { type: 'application/pdf' }),
      'Steven_Form680_Distributed_Shifts_May2026.pdf',
    );
    docxForm.set(
      'template',
      new Blob([makeDocxTemplate()], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
      'Daily_Progress_Note_Template.docx',
    );
    docxForm.set('autoGenerate', 'false');
    const docxCreate = await fetch(`${LOCAL}/api/jobs`, { method: 'POST', body: docxForm });
    assert(docxCreate.status === 201, 'docx template job created');
    const docxJob = await docxCreate.json();
    assert(docxJob.templateSource === 'docx', `templateSource is docx (${docxJob.templateSource})`);
    const fieldNames = docxJob.templateFields.map((f) => f.name);
    assert(fieldNames.includes('Outcome 2 - Support Type'), 'docx sections became radio groups');
    assert(
      fieldNames.includes('Identified Risk 2 (Seizure) - Documentation'),
      'docx risk sections became documentation fields',
    );
    assert(fieldNames.includes('Mood: Happy'), 'docx moods became checkboxes');
    assert(fieldNames.includes('Shift: 8am-4pm'), 'docx shift options became checkboxes');

    await fetch(`${LOCAL}/api/jobs/${docxJob.id}/extract`, { method: 'POST' });
    const docxReview = await waitFor(
      async () => {
        const res = await fetch(`${LOCAL}/api/jobs/${docxJob.id}`);
        const j = await res.json();
        if (j.status === 'failed') throw new Error(`docx job failed: ${j.errors.join('; ')}`);
        return j.status === 'review' ? j : undefined;
      },
      { label: 'docx review status' },
    );
    assert(docxReview.shiftsFound === EXPECTED_SHIFTS, `docx job found all ${EXPECTED_SHIFTS} shifts`);
    const docxFirst = docxReview.shifts[0];
    assert(docxFirst.values['Date'] === 'May 01, 2026', 'Date mapped on docx-converted template');
    assert(
      Object.entries(docxFirst.values).some(([k, v]) => k.endsWith('Support Type') && typeof v === 'string' && v),
      'support types mapped on docx-converted template',
    );
    const docxPreview = await fetch(`${LOCAL}/api/jobs/${docxJob.id}/shifts/0/preview.pdf`);
    assert(docxPreview.ok, 'docx-converted preview renders');
    const docxPreviewDoc = await PDFDocument.load(new Uint8Array(await docxPreview.arrayBuffer()));
    assert(docxPreviewDoc.getForm().getFields().length > 40, 'docx-converted preview keeps AcroForm fields');
  } finally {
    serverProc.kill('SIGTERM');
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

/**
 * Build a minimal but structurally faithful §680 Word template in memory:
 * org header, identity, shift checkboxes, mood checklist, outcome/risk/
 * routine-support sections with TYPE OF SUPPORTS blocks, and the four
 * end-of-shift yes/no questions.
 */
function makeDocxTemplate() {
  const P = (text) =>
    `<w:p><w:r><w:t xml:space="preserve">${text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')}</w:t></w:r></w:p>`;
  const supports = [
    'Independent',
    'Monitor (Supervision)',
    'Reminder (Verbal Prompt)',
    'Partial Physical (Some Physical Support)',
    'Full Physical (Total Physical Support)',
    'Out of Facility',
    'Choose not to complete',
    'Not Scheduled',
  ];
  const typeBlock = ['TYPE OF SUPPORTS PROVIDED:', ...supports.map((s) => `\u2610 ${s}`),
    'Instructions: Staff are to document how the supports were being provided.'];
  const moods = [
    'Happy', 'Calm', 'Content', 'Excited', 'Friendly', 'Outgoing', 'Outspoken', 'Polite',
    'Considerate', 'Restlessness', 'Sad/Pained/Worried Expression', 'Anxiety/Fear',
  ];
  const paragraphs = [
    'Joy Group Home, INC.',
    '5801 Garden Ridge Rd Chesterfield, VA 23832',
    '(804) 467-8366',
    'Daily Progress Note',
    'Form § 680',
    'Name:  Steven \u201CSteve\u201D Lavinus',
    'ID: 45198',
    'Date:',
    'Shift (Start and End Time):  \u2610 12am-8am    \u26108am-4pm    \u26104pm-12am',
    "Describe the individual's mood throughout the shift:",
    'Moods Observed Throughout the Shift:',
    ...moods.map((m) => `\u2610${m}`),
    '\u2610Other: ___________',
    "Describe the individual's activities throughout the shift:",
    'Individual Activity: ____________',
    'Group Activity: ____________',
    'Community Activity: ____________',
    'Outcomes',
    'Outcome 2: Steven wants to be an active member in the community. (Weekly)',
    'Activity Statement: Steve goes out weekly.',
    ...typeBlock,
    'Outcome 4: Steve will become more independent with cooking and meal planning. (Daily)',
    ...typeBlock,
    'Essential Supports',
    'Identified Risk 1: Dehydration (Daily)',
    ...typeBlock,
    'Identified Risk 2: Seizure (Daily)',
    ...typeBlock,
    'Routine Support 3: Medication use (Daily)',
    ...typeBlock,
    'Routine Support 10: Transportation (Weekly)',
    ...typeBlock,
    'Any medication received today? If yes, please explain what was given and the time:',
    '\u2610 Yes',
    '\u2610 No',
    'If yes, please explain:',
    'Any mental health or medical complaints or concerns reported by or on behalf of the individual?',
    '\u2610 Yes',
    '\u2610 No',
    'If yes, please explain:',
    'Any emotional or behavioral difficulty experienced or reported by the individual today:',
    '\u2610 Yes',
    '\u2610 No',
    'If yes, please explain:',
    'Any serious incident reports documented today?',
    '\u2610 Yes',
    '\u2610 No',
    'If yes, please explain:',
    'Staff Name  Title  Signature  Date',
  ];
  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${paragraphs.map(P).join('')}</w:body></w:document>`;
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>';
  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(contentTypes));
  zip.addFile('_rels/.rels', Buffer.from(rels));
  zip.addFile('word/document.xml', Buffer.from(documentXml));
  return zip.toBuffer();
}

main().catch((err) => {
  console.error(`\nE2E crashed: ${err.stack ?? err}`);
  process.exit(1);
});
