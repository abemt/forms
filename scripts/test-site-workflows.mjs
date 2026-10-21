import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import AdmZip from 'adm-zip';
import { Document, Header, Packer, Paragraph, Table, TableCell, TableRow } from 'docx';
import { PDFDocument } from 'pdf-lib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = await mkdtemp(path.join(os.tmpdir(), 'joy-site-test-'));
process.env.DATA_DIR = data;
process.env.JOB_TTL_HOURS = '0';
process.env.ENGINE = 'local';
process.env.WEB_DIST = path.join(root, 'web', 'dist');
await import('../server/dist/polyfill.js');
const { createApp } = await import('../server/dist/app.js');
const { jobManager } = await import('../server/dist/services/jobManager.js');
const { docxLogPages } = await import('../server/dist/services/docxLog.js');
const { extractShiftsLocally } = await import('../server/dist/services/local/extractor.js');

const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function waitFor(read, complete) {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const value = await read();
    if (value.status === 'failed') throw new Error(value.error ?? value.warning ?? value.errors?.join(' ') ?? 'Task failed');
    if (complete(value)) return value;
    if (Date.now() > deadline) throw new Error(`Timed out: ${JSON.stringify(value).slice(0, 300)}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

test('site daily, import, exports, workbook, and quarterly workflows', { timeout: 300_000 }, async () => {
  await jobManager.init();
  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = async (url, options) => {
    const response = await fetch(`${base}${url}`, options);
    const result = await response.json();
    assert.ok(response.ok, `${url}: ${JSON.stringify(result)}`);
    return result;
  };
  const post = (url, value) => request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
  const patch = (url, value) => request(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
  const getBytes = async (url) => {
    const response = await fetch(`${base}${url}`);
    assert.equal(response.status, 200, url);
    return Buffer.from(await response.arrayBuffer());
  };
  const quarterlyForm = (options, bytes) => {
    const form = new FormData();
    form.append('options', JSON.stringify(options));
    if (bytes) form.append('template', new Blob([bytes], { type: mime }), 'quarterly.docx');
    return form;
  };
  try {
    const profiles = await request('/templates/profiles');
    assert.deepEqual(profiles.map((profile) => [profile.id, profile.dailyTemplate, profile.quarterlyTemplate]), [['steven', true, true], ['jerrell', true, false]]);
    for (const [profile, name] of [['steven', 'Steve'], ['jerrell', 'Jerrell']]) {
      const blank = await getBytes(`/templates/${profile}/workbook.docx?month=2026-09`);
      const skipped = [];
      assert.equal(extractShiftsLocally(docxLogPages(blank), { paragraphLines: true, skipped }).length, 0);
      assert.equal(skipped.length, 90);
      assert.equal(skipped[0].provider, 'Hanna Tafesse, DSP');

      const log = await Packer.toBuffer(new Document({ sections: [{ children: [
        new Paragraph('September 01, 2026 (Tuesday)'),
        new Paragraph('Shift (Start and End Time): 8am-4pm'),
        new Paragraph('Assigned Provider: Hanna Tafesse, DSP'),
        new Paragraph('Observed Mood: Calm'),
        new Paragraph(`Notes - what ${name} did this shift:`),
        new Paragraph(`${name} watched a movie.`),
      ] }] }));
      const upload = new FormData();
      upload.append('log', new Blob([log], { type: mime }), 'test-log.docx');
      upload.append('profileId', profile);
      upload.append('completeRoutineFields', 'false');
      const created = await request('/jobs', { method: 'POST', body: upload });
      assert.equal(created.profileId, profile);
      await post(`/jobs/${created.id}/extract`, {});
      const reviewed = await waitFor(() => request(`/jobs/${created.id}`), (job) => job.status === 'review');
      assert.equal(reviewed.shifts.length, 1);
      assert.equal(reviewed.shifts[0].values['Medication Received'], undefined);
      assert.equal(reviewed.shifts[0].values['Staff Name'], 'Hanna Tafesse');
      await post(`/jobs/${created.id}/generate`, {});
      await waitFor(() => request(`/jobs/${created.id}`), (job) => job.status === 'done');
      const bundle = new AdmZip(await getBytes(`/jobs/${created.id}/download`));
      assert.ok(bundle.getEntry('Word/Form001.docx'));
      assert.ok(bundle.getEntry('PDF/Form001.pdf'));
      assert.ok(bundle.getEntry('Editable/Form001.pdf'));

      const output = await post('/exports', { jobId: created.id, options: { format: 'both', layout: 'parts', daysPerPart: 1 } });
      const done = await waitFor(() => request(`/exports/${output.id}`), (record) => record.status === 'done');
      assert.equal(done.artifacts.length, 2);
      const word = await getBytes(`/exports/${output.id}/download?artifact=0`);
      assert.ok(new AdmZip(word).readAsText('word/document.xml').includes('September 01, 2026'));
      const pdf = await PDFDocument.load(await getBytes(`/exports/${output.id}/download?artifact=1`));
      assert.equal(pdf.getForm().getFields().length, 0);
      assert.ok(pdf.getPages().every((page) => !page.node.Annots()?.size()));

      const originalWord = bundle.getEntry('Word/Form001.docx').getData();
      const importWord = new FormData();
      importWord.append('profileId', profile);
      importWord.append('files', new Blob([originalWord], { type: mime }), 'Form001.docx');
      const imported = await request('/imports', { method: 'POST', body: importWord });
      assert.equal(imported.forms[0].date, '2026-09-01');
      assert.deepEqual(await readFile(path.join(data, 'collections', imported.id, imported.forms[0].wordFile)), originalWord);
      const importPdf = new FormData();
      importPdf.append('profileId', profile);
      importPdf.append('convertToWord', 'true');
      importPdf.append('files', new Blob([bundle.getEntry('Editable/Form001.pdf').getData()], { type: 'application/pdf' }), 'Form001.pdf');
      const converted = await request('/imports', { method: 'POST', body: importPdf });
      assert.ok(converted.forms[0].wordFile, converted.warnings.join(' '));
      console.log(`${profile}: workbook, daily creation, both-format export, Word import, and PDF conversion passed`);
    }

    const options = { profileId: 'steven', mode: 'copy', saveTemplate: false };
    const copy = await request('/quarterly', { method: 'POST', body: quarterlyForm(options) });
    assert.equal(copy.values.periodStart, '2026-06-15');
    assert.equal(copy.values.periodEnd, '2026-08-31');
    assert.equal(copy.spec.fields.filter((field) => field.id.endsWith('.summary')).length, 20);
    assert.equal(copy.spec.fields.filter((field) => field.id.endsWith('.answer')).length, 5);
    const illegalEdit = await fetch(`${base}/quarterly/${copy.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ values: { periodStart: '2026-07-01' } }) });
    assert.equal(illegalEdit.status, 400);
    await post(`/quarterly/${copy.id}/generate`, { reviewer: 'Test Reviewer', reviewed: true });
    const finishedCopy = await waitFor(() => request(`/quarterly/${copy.id}`), (report) => report.status === 'done');
    assert.equal(finishedCopy.pdfReady, true, finishedCopy.warning);
    assert.deepEqual(await getBytes(`/quarterly/${copy.id}/download?format=word`), await readFile(path.join(root, 'server/assets/quarterly-steven.docx')));
    const quarterlyPdf = await PDFDocument.load(await getBytes(`/quarterly/${copy.id}/download?format=pdf`));
    assert.ok(quarterlyPdf.getPageCount() >= 10);
    const newReport = await request('/quarterly', { method: 'POST', body: quarterlyForm({ ...options, mode: 'new', periodStart: '2026-09-01', periodEnd: '2026-11-30', quarter: '1st' }) });
    assert.ok(newReport.spec.fields.filter((field) => field.id.endsWith('.summary')).every((field) => newReport.values[field.id] === ''));
    const changed = await patch(`/quarterly/${newReport.id}`, { values: { [newReport.spec.fields.find((field) => field.id.endsWith('.summary')).id]: 'Test reviewer statement.' } });
    assert.ok(Object.values(changed.values).includes('Test reviewer statement.'));

    const paragraph = (value) => new Paragraph(value);
    const cell = (...values) => new TableCell({ children: values.map(paragraph) });
    const fixture = await Packer.toBuffer(new Document({ sections: [{ headers: { default: new Header({ children: [paragraph('Jerrell Wright \u2610 1st \u2610 2nd \u2610 3rd \u2612 4th quarterly review covers information from 6/15/2026 through 8/31/2026')] }) }, children: [new Table({ rows: [new TableRow({ children: [cell('Communication support'), cell('\u2610 Achieved', '\u2612 On track', '\u2610 Limited or no progress', 'Status description: Template example.'), cell('Plan change needed?', '\u2610 Yes \u2612 No', 'If yes, describe:')] })] })] }] }));
    const jerrellQuarterly = await request('/quarterly', { method: 'POST', body: quarterlyForm({ ...options, profileId: 'jerrell', mode: 'new', periodStart: '2026-09-01', periodEnd: '2026-11-30', quarter: '1st', saveTemplate: true }, fixture) });
    const values = { ...jerrellQuarterly.values };
    for (const field of jerrellQuarterly.spec.fields) {
      if (field.id.endsWith('.status')) values[field.id] = 'On track';
      if (field.id.endsWith('.summary')) values[field.id] = 'Test-only reviewed statement.';
      if (field.id.endsWith('.change')) values[field.id] = 'No';
    }
    await patch(`/quarterly/${jerrellQuarterly.id}`, { values });
    await post(`/quarterly/${jerrellQuarterly.id}/generate`, { reviewer: 'Test Reviewer', reviewed: true });
    const finishedJerrell = await waitFor(() => request(`/quarterly/${jerrellQuarterly.id}`), (report) => report.status === 'done');
    assert.equal(finishedJerrell.pdfReady, true, finishedJerrell.warning);
    assert.equal((await request('/templates/profiles')).find((profile) => profile.id === 'jerrell').quarterlyTemplate, true);
    assert.equal((await request('/jobs')).length, 2);
    assert.equal((await request('/quarterly')).length, 3);
    assert.equal((await request('/imports')).length, 4);
    console.log('Quarterly identity, preservation, review, saved-template, Word, and PDF flows passed');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(data, { recursive: true, force: true });
  }
});