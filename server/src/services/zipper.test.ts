import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import AdmZip from 'adm-zip';
import { zipDirectory } from './zipper.js';

test('print archives separate file types without changing saved source files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'joy-zip-'));
  try {
    const source = path.join(root, 'output');
    for (const folder of ['Editable', 'Printable']) await mkdir(path.join(source, folder), { recursive: true });
    await writeFile(path.join(source, 'Editable', 'Form001.pdf'), 'editable');
    await writeFile(path.join(source, 'Printable', 'Form001.pdf'), 'printable');
    await writeFile(path.join(source, 'Printable', 'Form001.docx'), 'word');
    const target = path.join(root, 'print.zip');
    await zipDirectory(source, target, 'print');
    const archive = new AdmZip(target);
    assert.deepEqual(archive.getEntries().filter((entry) => !entry.isDirectory).map((entry) => entry.entryName).sort(), [
      'Editable/Form001.pdf', 'PDF/Form001.pdf', 'Word/Form001.docx',
    ]);
    assert.equal(archive.readAsText('Word/Form001.docx'), 'word');
    assert.equal(await readFile(path.join(source, 'Printable', 'Form001.pdf'), 'utf8'), 'printable');
    await zipDirectory(source, path.join(root, 'original.zip'));
    assert.ok(new AdmZip(path.join(root, 'original.zip')).getEntry('Printable/Form001.docx'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});