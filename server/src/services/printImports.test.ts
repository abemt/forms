import assert from 'node:assert/strict';
import test from 'node:test';
import AdmZip from 'adm-zip';
import { unpackPrintFiles } from './printImports.js';

test('print imports read ZIP members without extracting file paths', () => {
  const zip = new AdmZip();
  zip.addFile('Word/Form001.docx', Buffer.from('original-word'));
  zip.addFile('PDF/Form001.pdf', Buffer.from('original-pdf'));
  zip.addFile('INDEX.txt', Buffer.from('index'));
  const files = unpackPrintFiles([{ name: 'report.zip', bytes: new Uint8Array(zip.toBuffer()) }]);
  assert.equal(files.length, 2);
  assert.equal(Buffer.from(files.find((file) => file.name.endsWith('.docx'))!.bytes).toString(), 'original-word');
  assert.throws(() => unpackPrintFiles([{ name: 'document.exe', bytes: new Uint8Array() }]), /Upload/);
  assert.throws(() => unpackPrintFiles([]), /No individual/);
});