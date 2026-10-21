import assert from 'node:assert/strict';
import test from 'node:test';
import AdmZip from 'adm-zip';
import { fillQuarterly, inspectQuarterly } from './quarterlyTemplate.js';

function template(name: string): Uint8Array {
  const zip = new AdmZip();
  const paragraph = (value: string) => `<w:p><w:r><w:t>${value}</w:t></w:r></w:p>`;
  zip.addFile('word/document.xml', Buffer.from(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tr><w:tc>${paragraph('Start date: 4/1/2026')}${paragraph('Communication support')}</w:tc><w:tc>${paragraph('\u2610 Achieved')}${paragraph('\u2612 On track')}${paragraph('\u2610 Limited or no progress')}${paragraph('Status description: Original &amp; reviewed.')}</w:tc><w:tc>${paragraph('Plan change needed?')}${paragraph('\u2610 Yes \u2612 No')}${paragraph('If yes, describe:')}</w:tc></w:tr><w:tr><w:tc>${paragraph('1.')}</w:tc><w:tc>${paragraph('Any significant events?')}</w:tc><w:tc>${paragraph('\u2610 Yes \u2612 No')}</w:tc><w:tc>${paragraph('If yes, describe: Nothing added.')}</w:tc></w:tr></w:tbl>${paragraph('Completed by: Reviewer (signature) Date: 9/1/2026')}<w:sectPr/></w:body></w:document>`));
  zip.addFile('word/header1.xml', Buffer.from(`<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${paragraph(`${name} \u2610 1st \u2610 2nd \u2610 3rd \u2612 4th quarterly review covers information from 6/15/2026 through 8/31/2026`)}</w:hdr>`));
  zip.addFile('word/media/original.bin', Buffer.from('untouched'));
  return new Uint8Array(zip.toBuffer());
}

test('quarterly inspection and editing preserve names, definitions, and unrelated package parts', () => {
  const original = template('Steven "Steve" Lavinus');
  const spec = inspectQuarterly(original, 'steven');
  assert.equal(spec.fields.find((field) => field.id === 'quarter')?.value, '4th');
  assert.equal(spec.fields.find((field) => field.id === 'row0.status')?.value, 'On track');
  assert.deepEqual(fillQuarterly(original, 'steven', {}), original);
  const changed = fillQuarterly(original, 'steven', { periodStart: '2026-09-01', periodEnd: '2026-11-30', quarter: '1st', 'row0.summary': 'Reviewed <update> & details.', 'row0.status': 'Achieved', 'row1.answer': 'Yes' });
  const reread = inspectQuarterly(changed, 'steven');
  const values = Object.fromEntries(reread.fields.map((field) => [field.id, field.value]));
  assert.equal(values.periodStart, '2026-09-01');
  assert.equal(values.periodEnd, '2026-11-30');
  assert.equal(values.quarter, '1st');
  assert.equal(values['row0.summary'], 'Reviewed <update> & details.');
  assert.equal(values['row0.status'], 'Achieved');
  assert.equal(values['row1.answer'], 'Yes');
  const zip = new AdmZip(Buffer.from(changed));
  assert.ok(zip.readAsText('word/document.xml').includes('Start date: 4/1/2026'));
  assert.equal(zip.readAsText('word/media/original.bin'), 'untouched');
  const rows = zip.readAsText('word/document.xml').match(/<w:tr>[\s\S]*?<\/w:tr>/g)!;
  assert.ok(!rows[0].includes('cantSplit'), 'status rows keep their original row properties');
  assert.ok(!rows[1].includes('cantSplit'), 'an unedited question row is left alone');
  const explained = new AdmZip(Buffer.from(fillQuarterly(original, 'steven', { 'row1.explanation': 'Two lines\nof detail.' }))).readAsText('word/document.xml');
  assert.match(explained, /<w:tr><w:trPr><w:cantSplit\/><\/w:trPr><w:tc><w:p><w:r><w:t>1\./, 'a filled question row is kept on one page');
});

test('Jerrell has an independent template and wrong-person or invalid fields fail', () => {
  const original = template('Jerrell Wright');
  assert.equal(inspectQuarterly(original, 'jerrell').individualName, 'Jerrell Wright');
  assert.throws(() => inspectQuarterly(original, 'steven'), /does not identify/);
  assert.throws(() => fillQuarterly(original, 'jerrell', { periodStart: '2026-09-01' }), /must not follow/);
  assert.throws(() => fillQuarterly(original, 'jerrell', { 'row0.status': 'Invented' }), /Invalid choice/);
  assert.throws(() => fillQuarterly(original, 'jerrell', { unknown: 'value' }), /Unknown/);
});