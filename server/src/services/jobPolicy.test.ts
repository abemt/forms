import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { JobManager } from './jobManager.js';

test('new API jobs default to evidence-only and routine drafts cannot skip review', async () => {
  const template = await PDFDocument.create();
  template.addPage();
  template.getForm().createTextField('Date').addToPage(template.getPage(0));
  const manager = new JobManager();
  const jobs: string[] = [];
  try {
    const input = { logBytes: new Uint8Array(), logFileName: 'log.pdf', templateBytes: await template.save(), templateFileName: 'template.pdf', autoGenerate: true };
    const evidenceOnly = await manager.createJob(input);
    jobs.push(evidenceOnly.id);
    assert.equal(evidenceOnly.completeRoutineFields, false);
    assert.equal(evidenceOnly.autoGenerate, true);
    const draft = await manager.createJob({ ...input, completeRoutineFields: true });
    jobs.push(draft.id);
    assert.equal(draft.autoGenerate, false);
    assert.equal(draft.completeRoutineFields, true);
  } finally {
    for (const id of jobs) await rm(manager.jobDir(id), { recursive: true, force: true });
  }
});