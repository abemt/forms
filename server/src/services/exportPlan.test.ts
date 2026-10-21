import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { exportOptionsSchema, isoFormDate, planExport } from './exportPlan.js';
import { createExport, getExport, mergedPdf } from './reportExports.js';
import { config } from '../config.js';

const forms = Array.from({ length: 93 }, (_, index) => ({ index, date: `August ${String(Math.floor(index / 3) + 1).padStart(2, '0')}, 2026`, shift: ['8am-4pm', '4pm-12am', '12am-8am'][index % 3], provider: 'Staff' }));

test('four-day parts preserve every form in order without splitting dates', () => {
  const groups = planExport(forms, 'Steven', exportOptionsSchema.parse({}));
  assert.equal(groups.length, 8);
  assert.ok(groups.every((group) => group.forms.length <= 12));
  assert.deepEqual(groups.flatMap((group) => group.forms.map((form) => form.index)), forms.map((form) => form.index));
});

test('resume separates the last printed day and excludes earlier dates', () => {
  const groups = planExport(forms, 'Steven', exportOptionsSchema.parse({ printedThrough: '2026-08-13' }));
  assert.equal(groups[0].check, true);
  assert.equal(groups[0].forms.length, 3);
  assert.equal(groups[1].fromDate, '2026-08-14');
  assert.equal(groups[groups.length - 1].toDate, '2026-08-31');
  assert.deepEqual(groups.flatMap((group) => group.forms.map((form) => form.index)), forms.slice(36).map((form) => form.index));
});

test('validates dates, empty selections, batch sizes, and month boundaries', () => {
  assert.throws(() => isoFormDate('February 30, 2026'));
  assert.throws(() => exportOptionsSchema.parse({ daysPerPart: 0 }));
  assert.throws(() => exportOptionsSchema.parse({ fromDate: '2026-08-20', toDate: '2026-08-01' }));
  assert.throws(() => planExport(forms, 'Steven', exportOptionsSchema.parse({ fromDate: '2026-09-01' })));
  const groups = planExport([...forms.slice(-3), { ...forms[0], index: 94, date: 'September 01, 2026' }], 'Jerrell', exportOptionsSchema.parse({ layout: 'merged' }));
  assert.equal(groups.length, 2);
});

test('merged PDFs add duplex separation and leave sources untouched', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'joy-pdf-'));
  try {
    const source = await PDFDocument.create();
    source.addPage([612, 792]);
    source.getForm().createTextField('Date').addToPage(source.getPage(0));
    source.getForm().getTextField('Date').setText('August 01, 2026');
    const file = path.join(directory, 'form.pdf');
    const original = Buffer.from(await source.save());
    await writeFile(file, original);
    const result = await mergedPdf([file, file], true);
    const saved = await PDFDocument.load(result.bytes);
    assert.equal(result.pages, 3);
    assert.equal(saved.getForm().getFields().length, 0);
    assert.ok(saved.getPages().every((page) => !page.node.Annots()?.size()));
    assert.deepEqual(await readFile(file), original);
    assert.equal((await mergedPdf([file, file], false)).pages, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('queued exports use a snapshot even if a source document changes', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'joy-snapshot-'));
  let exportId;
  try {
    const original = await PDFDocument.create();
    original.addPage([612, 792]);
    const file = path.join(directory, 'form.pdf');
    await writeFile(file, await original.save());
    const record = await createExport('test', 'Test', [{ index: 0, date: '2026-09-01', shift: '8am-4pm', provider: 'Test', pdfPath: file }], exportOptionsSchema.parse({ format: 'pdf' }));
    exportId = record.id;
    await writeFile(file, 'changed after export was requested');
    const deadline = Date.now() + 10_000;
    let state = await getExport(record.id);
    while (state.status !== 'done' && state.status !== 'failed' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      state = await getExport(record.id);
    }
    assert.equal(state.status, 'done', state.error);
    assert.equal(state.artifacts[0].pages, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
    if (exportId) await rm(path.join(config.dataDir, 'exports', exportId), { recursive: true, force: true });
  }
});