import assert from 'node:assert/strict';
import test from 'node:test';
import { includeBlankShifts } from './blanks.js';
import { mapShiftLocally } from './mapper.js';
import type { TemplateFieldInfo } from '../../types.js';

const fields: TemplateFieldInfo[] = [
  { name: 'Date', type: 'text' },
  { name: 'Shift: 4pm-12am', type: 'checkbox' },
  { name: 'Identified Risk 1 - Support Type', type: 'radio', options: ['Independent', 'Monitor (Supervision)'] },
  { name: 'Identified Risk 1 - Documentation', type: 'text' },
  { name: 'Routine Support 7 - Support Type', type: 'radio', options: ['Independent', 'Out of Facility'] },
  { name: 'Routine Support 7 - Documentation', type: 'text' },
  { name: 'Routine Support 8 - Support Type', type: 'radio', options: ['Independent', 'Out of Facility'] },
  { name: 'Routine Support 8 - Documentation', type: 'text' },
  { name: 'Behavioral Difficulty', type: 'radio', options: ['Yes', 'No'] },
  { name: 'Behavioral Difficulty Explanation', type: 'text' },
  { name: 'Serious Incident', type: 'radio', options: ['Yes', 'No'] },
  { name: 'Serious Incident Explanation', type: 'text' },
];

test('blank workbook boxes become explicit empty review shifts without routine text', () => {
  const result = includeBlankShifts(
    [{ date: 'September 15, 2026', shift: '8am-4pm', provider: 'Hanna Tafesse, DSP', mood: 'Calm', narrative: 'A food bank visit was reported.' }],
    [{ date: 'September 15, 2026', shift: '4pm-12am', provider: 'Rahel Tafesse, DSP', position: 1 }],
  );
  assert.equal(result.length, 2);
  assert.deepEqual(result[1], { date: 'September 15, 2026', shift: '4pm-12am', provider: 'Rahel Tafesse, DSP', mood: '', narrative: '' });
});

test('water bottles and food bank do not create unrelated support mappings', () => {
  const result = mapShiftLocally(
    {
      date: 'October 11, 2026',
      shift: '4pm-12am',
      provider: 'Rahel Tafesse, DSP',
      mood: '',
      narrative: 'Jerrell and Steve had an altercation. They threw water bottles at each other. A 911 call was made and police responded.',
    },
    fields,
  );
  const names = result.assignments.map((assignment) => assignment.field);
  assert.ok(names.includes('Behavioral Difficulty'));
  assert.ok(names.includes('Serious Incident'));
  assert.ok(!names.includes('Identified Risk 1 - Documentation'));
  assert.ok(!names.includes('Routine Support 7 - Documentation'));
  assert.ok(!names.includes('Routine Support 8 - Documentation'));
  assert.ok(!names.includes('Identified Risk 1 - Support Type'));
  assert.ok(!names.includes('Routine Support 7 - Support Type'));
  assert.ok(!names.includes('Routine Support 8 - Support Type'));
  assert.ok(result.warnings.some((warning) => /injury status|staff intervention/.test(warning)));

  const foodBank = mapShiftLocally(
    { date: 'September 15, 2026', shift: '8am-4pm', provider: 'Hanna Tafesse, DSP', mood: '', narrative: 'Jerrell went to a food bank with staff.' },
    fields,
  );
  const foodFields = foodBank.assignments.map((assignment) => assignment.field);
  assert.ok(!foodFields.includes('Routine Support 7 - Documentation'));
  assert.ok(!foodFields.includes('Routine Support 8 - Documentation'));
});
