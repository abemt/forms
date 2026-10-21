import assert from 'node:assert/strict';
import test from 'node:test';
import { personFromSpec } from '../local/person.js';
import { composeMonth, defaultSettings, providerFor, workbookFileName } from './writer.js';
import type { WriterDraft } from './types.js';

const steve = personFromSpec({ individualName: 'Steven “Steve” Lavinus' });
const jerrell = personFromSpec({ individualName: 'Jerrell Wright' });

function draft(profileId: string, partial: Partial<WriterDraft> = {}): WriterDraft {
  return { profileId, month: '2026-09', fromDay: 1, toDay: 9, closures: [], events: [], overrides: {}, sourceNotes: '', ...partial };
}

const box = (preview: ReturnType<typeof composeMonth>, day: number, shift: 'day' | 'evening' | 'night') =>
  preview.boxes.find((b) => b.day === day && b.shift === shift)!;

test('routine follows the program schedule, closures and the day range', () => {
  const settings = defaultSettings('steven');
  const preview = composeMonth({
    draft: draft('steven', { closures: [{ day: 7, reason: 'Labor Day' }] }),
    settings,
    person: steve,
  });
  assert.equal(preview.boxes.length, 27);
  // A configured schedule is review metadata, not proof that care occurred.
  assert.equal(box(preview, 1, 'day').notes, '');
  assert.ok(box(preview, 1, 'day').warnings.some((w) => /attendance was scheduled/.test(w)));
  assert.ok(box(preview, 1, 'day').warnings.some((w) => /Morning medication support/.test(w)));
  assert.equal(box(preview, 2, 'day').notes, '');
  assert.ok(box(preview, 2, 'day').warnings.some((w) => /Laundry was scheduled/.test(w)));
  // A closure is retained as a draft assumption, but it does not create routine activity text.
  assert.equal(box(preview, 7, 'day').notes, '');
  assert.doesNotMatch(box(preview, 7, 'day').notes, /Inner Vision|day off|stayed home/);
  // Roster drives the provider names.
  assert.equal(box(preview, 5, 'day').provider, settings.roster.weekendDay);
  assert.equal(box(preview, 1, 'evening').provider, settings.roster.weekdayEvening);
  assert.ok(preview.assumptions.some((a) => /Labor Day/.test(a)));
  assert.ok(preview.assumptions.some((a) => /September 10-30 are not written yet/.test(a)));
  assert.equal(workbookFileName(preview), 'Steven_September2026_Sep1-9_Daily_Log_Entry (filled).docx');
});

test('events replace the matching routine slots and set the mood', () => {
  const preview = composeMonth({
    draft: draft('steven', {
      events: [
        { id: 'a', day: 5, shift: 'auto', kind: 'outing', place: 'Yorktown Beach', details: 'he walked along the shoreline and waded in the river', withHousemate: false, mood: '' },
        { id: 'b', day: 2, shift: 'auto', kind: 'meal_out', place: 'Burger King', details: '', meal: 'lunch', withHousemate: true, mood: '' },
        { id: 'c', day: 3, shift: 'evening', kind: 'note', place: '', details: 'staff took steve out for a drive and then a walk', withHousemate: false, mood: 'Content, Happy' },
        { id: 'd', day: 1, shift: 'auto', kind: 'outing', place: 'the park', details: '', withHousemate: false, mood: '' },
        { id: 'e', day: 8, shift: 'auto', kind: 'away', place: 'his mother', details: '', withHousemate: false, mood: '' },
      ],
    }),
    settings: defaultSettings('steven'),
    person: steve,
  });
  const beach = box(preview, 5, 'day');
  assert.match(beach.notes, /went to Yorktown Beach\. He walked along the shoreline/);
  assert.doesNotMatch(beach.notes, /grocery/i);
  assert.equal(beach.mood, '');
  assert.equal(beach.eventLines, 1);
  assert.doesNotMatch(beach.notes, /enjoyed|supervis|good mood|transportation/);
  const lunch = box(preview, 2, 'day');
  assert.match(lunch.notes, /went out for lunch at Burger King together with Jerrell/);
  assert.doesNotMatch(lunch.notes, /staff supervising|sandwich on wheat bread|chose water/);
  const note = box(preview, 3, 'evening');
  assert.equal(note.notes, 'Staff took steve out for a drive and then a walk.');
  assert.equal(note.mood, 'Content, Happy');
  // A reported program-day outing remains in the reported event box without an invented return line.
  const park = box(preview, 1, 'evening').notes.split('\n');
  assert.match(park[0], /went to the park/);
  // "Away" with automatic placement covers all three boxes and drops unsupported routine text.
  for (const shift of ['day', 'evening', 'night'] as const) {
    const away = box(preview, 8, shift);
    assert.equal(away.notes, 'Steve was away on a family visit with his mother for this shift.');
    assert.equal(away.mood, '');
  }
});

test('wording checks flag what the form mapper misreads, and hand edits win', () => {
  const preview = composeMonth({
    draft: draft('jerrell', {
      fromDay: 4,
      toDay: 4,
      events: [{ id: 'x', day: 4, shift: 'day', kind: 'note', place: '', details: 'Jerrell talked about the trip and said his knee was sore', withHousemate: false, mood: '' }],
      overrides: { '4|night': { mood: 'Sleeping', notes: 'Jerrell slept through the night.' } },
    }),
    settings: defaultSettings('jerrell'),
    person: jerrell,
  });
  const day = box(preview, 4, 'day');
  assert.ok(day.warnings.some((w) => /talked about/.test(w)));
  assert.ok(day.warnings.some((w) => /trip/.test(w)));
  assert.ok(day.warnings.some((w) => /Medical Complaints/.test(w)));
  assert.equal(day.notes, 'Jerrell talked about the trip and said his knee was sore.');
  const night = box(preview, 4, 'night');
  assert.equal(night.edited, true);
  assert.equal(night.notes, 'Jerrell slept through the night.');
  assert.equal(preview.boxes.length, 3);
});

test('typed fallbacks stay neutral and put missing details in warnings', () => {
  const preview = composeMonth({
    draft: draft('jerrell', {
      fromDay: 10,
      toDay: 13,
      events: [
        { id: 'meal', day: 10, shift: 'day', kind: 'meal_out', place: 'a restaurant', details: '', meal: 'lunch', withHousemate: false, mood: '' },
        { id: 'appointment', day: 11, shift: 'day', kind: 'appointment', place: 'medical appointment', details: '', withHousemate: false, mood: '' },
        { id: 'laundry', day: 12, shift: 'day', kind: 'laundry', place: '', details: '', withHousemate: false, mood: '' },
        { id: 'chore', day: 13, shift: 'day', kind: 'chore', place: '', details: 'Jerrell took out the trash and wiped the kitchen counter after lunch.', withHousemate: false, mood: '' },
      ],
    }),
    settings: defaultSettings('jerrell'),
    person: jerrell,
  });
  const lunch = box(preview, 10, 'day');
  assert.equal(lunch.notes, 'Jerrell went out for lunch at a restaurant.');
  assert.ok(lunch.warnings.some((w) => /meal details.*not documented/.test(w)));
  assert.doesNotMatch(lunch.notes, /enjoyed|water|reminder|supervis/);
  const appointment = box(preview, 11, 'day');
  assert.equal(appointment.notes, 'Jerrell attended medical appointment.');
  assert.ok(appointment.warnings.some((w) => /appointment outcome.*not documented/.test(w)));
  const laundry = box(preview, 12, 'day');
  assert.equal(laundry.notes, 'Jerrell did laundry.');
  assert.ok(laundry.warnings.some((w) => /laundry tasks.*not documented/.test(w)));
  const chore = box(preview, 13, 'day');
  assert.equal(chore.notes, 'Following lunch, Jerrell took out the household trash and wiped down the kitchen counter.');
  assert.doesNotMatch(chore.notes, /staff|helped|prompt|enjoyed|mood|outcome/i);
});

test('generic library serves an unknown individual with the health toggles', () => {
  const settings = { ...defaultSettings('other'), health: { seizureChecks: true, diabetes: false, gout: false, bowelWatch: false }, housemate: '' };
  const preview = composeMonth({
    draft: draft('other', { fromDay: 12, toDay: 13 }),
    settings,
    person: personFromSpec({ individualName: 'Maria Lopez' }),
  });
  assert.equal(box(preview, 12, 'night').notes, '');
  assert.ok(box(preview, 12, 'night').warnings.some((w) => /Overnight monitoring was configured/.test(w)));
  assert.equal(box(preview, 12, 'day').notes, '');
  assert.doesNotMatch(box(preview, 12, 'evening').notes, /together|housemate/);
  assert.equal(providerFor(settings, true, 'night'), settings.roster.weekendNight);
});
