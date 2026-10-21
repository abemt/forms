import assert from 'node:assert/strict';
import test from 'node:test';
import { personFromSpec } from '../local/person.js';
import { buildDefaultDraft, composeMonth, defaultSettings } from '../logWriter/writer.js';
import { mergeIntoDraft } from './apply.js';
import { parseTranscript, type VoicePerson } from './parse.js';
import type { VoiceNote } from './store.js';

const people: VoicePerson[] = [
  { id: 'steven', first: 'Steve', aliases: ['Steven'] },
  { id: 'jerrell', first: 'Jerrell', aliases: ['Jay'] },
];
const TRANSCRIPT =
  'Today is September 12th. Steve went to day program in the morning and came back at 4. He cooked spaghetti for dinner with Rahel, then he played his guitar in the living room. Jerrell stayed home in the morning. He was drawing a picture of the house and he was in a good mood. In the afternoon Hanna took Jerrell to Walmart and he bought new shoes with his own money. In the evening both of them played dominoes together. Last night Steve slept well, no seizure.';

function note(id: string, transcript = TRANSCRIPT): VoiceNote {
  const now = new Date().toISOString();
  return {
    id,
    kind: 'text',
    fileName: 'test report',
    size: transcript.length,
    uploadedAt: now,
    updatedAt: now,
    referenceDate: '2026-09-29',
    status: 'done',
    transcript,
    items: parseTranscript(transcript, { referenceDate: '2026-09-29', people }).items,
  };
}

test('a voice note is written into each person\'s draft, once, with its transcript on record', () => {
  const n = note('11111111-1111-4111-8111-111111111111');
  const jerrell = mergeIntoDraft(buildDefaultDraft('jerrell', '2026-09'), 'jerrell', [n], people, true);
  assert.equal(jerrell.fromDay, 12);
  assert.equal(jerrell.toDay, 12);
  assert.equal(jerrell.routineLevel, 'essentials');
  const voice = jerrell.events.filter((e) => e.kind === 'voice');
  assert.deepEqual(voice.map((e) => e.shift).sort(), ['day', 'evening']);
  const day = voice.find((e) => e.shift === 'day')!;
  assert.match(day.details, /^Jerrell stayed home in the morning\.\nJerrell was drawing a picture/);
  assert.match(day.details, /Hanna took Jerrell to Walmart/);
  assert.doesNotMatch(day.details, /Steve/);
  assert.equal(day.mood, 'Happy');
  assert.ok(day.slots?.includes('main'), 'outing replaces the routine main activity');
  const evening = voice.find((e) => e.shift === 'evening')!;
  assert.equal(evening.details, 'In the evening Jerrell and Steve played dominoes together.');
  assert.ok(jerrell.events.some((e) => e.kind === 'home' && e.day === 12));
  assert.match(jerrell.sourceNotes, /\[id:11111111-1111-4111-8111-111111111111\] ===\nToday is September 12th/);

  // Applying the same note again replaces its sentences instead of duplicating them.
  const again = mergeIntoDraft(jerrell, 'jerrell', [n], people, false);
  assert.equal(again.events.length, jerrell.events.length);
  assert.equal(again.sourceNotes.match(/=== Voice note/g)?.length, 1);

  const steve = mergeIntoDraft(buildDefaultDraft('steven', '2026-09'), 'steven', [n], people, true);
  const night = steve.events.find((e) => e.kind === 'voice' && e.shift === 'night')!;
  assert.equal(night.details, 'Last night Steve slept well, no seizure.');
  assert.ok(steve.events.some((e) => e.kind === 'program' && e.day === 12), 'attended on a Saturday');
});

test('the preview puts reported sentences where the routine lines were and trims filler by level', () => {
  const n = note('22222222-2222-4222-8222-222222222222');
  const draft = mergeIntoDraft(buildDefaultDraft('steven', '2026-09'), 'steven', [n], people, true);
  const person = personFromSpec({ individualName: 'Steven “Steve” Lavinus' });
  const settings = defaultSettings('steven');
  const box = (preview: ReturnType<typeof composeMonth>, shift: string) => preview.boxes.find((b) => b.shift === shift)!;

  const full = composeMonth({ draft: { ...draft, routineLevel: 'full' }, settings, person });
  const evening = box(full, 'evening');
  assert.equal(evening.voiceLines, 3);
  assert.equal(evening.lines[0].source, 'voice');
  assert.match(evening.lines[0].text, /cooked spaghetti for dinner with Rahel/);
  assert.equal(evening.lines.filter((l) => /for dinner/.test(l.text)).length, 1, 'reported dinner remains once');
  assert.ok(evening.lines.every((l) => l.source === 'voice'), 'full mode does not add unsupported routine lines');
  assert.ok(evening.warnings.some((w) => /Evening medication support/.test(w)));
  const day = box(full, 'day');
  assert.ok(day.lines.some((l) => l.source === 'voice' && /went to day program in the morning/.test(l.text)));
  assert.ok(day.lines.every((l) => l.source === 'voice'), 'reported day lines remain source-backed');

  const essentials = composeMonth({ draft, settings, person });
  const trimmed = box(essentials, 'evening');
  assert.equal(trimmed.lines.length, 3, 'essentials does not invent routine care');
  assert.ok(trimmed.lines.every((l) => l.source === 'voice'));
  assert.ok(trimmed.warnings.some((w) => /Evening medication support/.test(w)), 'scheduled care gap is visible as metadata');
  assert.equal(box(essentials, 'night').lines.filter((l) => l.source === 'voice').length, 1);

  const none = composeMonth({ draft: { ...draft, routineLevel: 'none' }, settings, person });
  assert.ok(none.boxes.every((b) => b.lines.every((l) => l.source === 'voice')));
});
