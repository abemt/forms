import assert from 'node:assert/strict';
import test from 'node:test';
import { dateFromFileName, parseTranscript, textFor, type VoicePerson } from './parse.js';

const people: VoicePerson[] = [
  { id: 'steven', first: 'Steve', aliases: ['Steven', 'Stevie'] },
  { id: 'jerrell', first: 'Jerrell', aliases: ['Jay', 'Jerell', 'Jarrell'] },
];

const find = (items: ReturnType<typeof parseTranscript>['items'], text: RegExp) => {
  const item = items.find((i) => text.test(i.text));
  assert.ok(item, `no item matching ${text}: ${items.map((i) => i.text).join(' | ')}`);
  return item;
};

test('a daily voice note is split into per-person, per-shift sentences', () => {
  const transcript =
    'Today is September 12th. Steve went to day program in the morning and came back at 4. He cooked spaghetti for dinner with Rahel, then he played his guitar in the living room. Jerrell stayed home in the morning. He was drawing a picture of the house and he was in a good mood. In the afternoon Hanna took Jerrell to Walmart and he bought new shoes with his own money. In the evening both of them played dominoes together. Last night Steve slept well, no seizure.';
  const { items, skipped } = parseTranscript(transcript, { referenceDate: '2026-09-29', people });
  assert.ok(skipped.some((s) => /Today is September 12th/.test(s)), 'date-only sentence is skipped');
  assert.ok(items.every((i) => i.date === '2026-09-12'));

  const program = find(items, /^Steve went to day program/);
  assert.deepEqual(program.people, ['steven']);
  assert.equal(program.shift, 'day');
  assert.equal(program.program, 'attended');
  assert.ok(program.topics.includes('program'));

  const dinner = find(items, /^Steve cooked spaghetti for dinner with Rahel/);
  assert.equal(dinner.shift, 'evening');
  assert.ok(dinner.topics.includes('dinner'));

  const home = find(items, /^Jerrell stayed home in the morning\.$/);
  assert.deepEqual(home.people, ['jerrell']);
  assert.equal(home.program, 'home');

  const drawing = find(items, /^Jerrell was drawing a picture of the house/);
  assert.deepEqual(drawing.people, ['jerrell']);
  assert.deepEqual(drawing.moods, ['Happy']);
  assert.ok(drawing.topics.includes('leisure'));

  const walmart = find(items, /Hanna took Jerrell to Walmart/);
  assert.deepEqual(walmart.people, ['jerrell']);
  assert.equal(walmart.shift, 'day');
  assert.ok(walmart.topics.includes('outing'));

  const dominoes = find(items, /^In the evening Steve and Jerrell played dominoes together\.$/);
  assert.deepEqual(dominoes.people, ['steven', 'jerrell']);
  assert.equal(dominoes.shift, 'evening');
  assert.equal(textFor(dominoes, 'jerrell', people), 'In the evening Jerrell and Steve played dominoes together.');

  const night = find(items, /^Last night Steve slept well, no seizure\.$/);
  assert.deepEqual(night.people, ['steven']);
  assert.equal(night.shift, 'night');
  assert.deepEqual(night.flags, [], '"no seizure" is not a health event');
});

test('weekly notes switch dates on spoken dates, weekdays and "yesterday"', () => {
  const transcript = [
    'Okay so on September 15th, Steve had cereal for breakfast and went to the program.',
    'The next day he stayed home because the program was closed.',
    'On Thursday he went to the park with Nathaniel.',
    'Yesterday Jerrell cleaned his room.',
  ].join(' ');
  const { items } = parseTranscript(transcript, {
    referenceDate: '2026-09-20',
    people,
    corrections: [{ from: 'Nathaniel', to: 'Nathanael' }],
  });
  assert.equal(find(items, /cereal for breakfast/).date, '2026-09-15');
  assert.equal(find(items, /cereal for breakfast/).shift, 'day');
  const closed = find(items, /^Steve stayed home because the program was closed/);
  assert.equal(closed.date, '2026-09-16');
  assert.equal(closed.program, 'home');
  const park = find(items, /went to the park with Nathanael/);
  assert.equal(park.date, '2026-09-17', 'Thursday after Tuesday the 16th');
  const room = find(items, /^Jerrell cleaned his room/);
  assert.equal(room.date, '2026-09-16', 'yesterday relative to the dated account');
  assert.ok(room.topics.includes('chores'));
});

test('speech is cleaned into third-person past-tense documentation', () => {
  const transcript =
    'Um so today Jarrell, you know, he go to the store with me and he buy a soda. And then we come back and he eat lunch. I think he was very happy. Um, that is all. Thank you.';
  const { items, skipped } = parseTranscript(transcript, { referenceDate: '2026-09-22', people });
  const store = find(items, /store/);
  assert.equal(store.text, 'Jerrell went to the store with staff and he bought a soda.');
  const back = find(items, /came back/);
  assert.equal(back.text, 'Staff and Jerrell came back and he ate lunch.');
  assert.ok(back.topics.includes('lunch'));
  const mood = find(items, /happy/);
  assert.equal(mood.text, 'Jerrell was very happy.');
  assert.deepEqual(mood.moods, ['Happy']);
  assert.deepEqual(mood.people, ['jerrell']);
  assert.ok(skipped.length >= 2, 'closing phrases are dropped');
});

test('"DSP" means the day program, clock times pick the box, and flags are raised', () => {
  const transcript =
    "Steve went to DSP at 8:30 a.m. After DSP he made a meal. At 11 pm he had a seizure and staff called 911. Jerrell hasn't started DSP. Jerrell was upset and refused his medication at 9 p.m.";
  const { items } = parseTranscript(transcript, { referenceDate: '2026-09-18', people });
  const program = find(items, /^Steve went to day program at 8:30 AM/);
  assert.equal(program.shift, 'day');
  assert.equal(program.program, 'attended');
  const meal = find(items, /After day program Steve made a meal|After day program he made a meal/);
  assert.equal(meal.shift, 'evening');
  const seizure = find(items, /seizure/);
  assert.equal(seizure.shift, 'evening');
  assert.deepEqual(seizure.flags.sort(), ['health', 'incident']);
  const status = find(items, /hasn't started/);
  assert.equal(status.program, undefined, 'enrollment status is not a home/attended day');
  const refused = find(items, /refused his medication/);
  assert.ok(refused.flags.includes('behavior'));
  assert.ok(refused.topics.includes('meds'));
  assert.deepEqual(refused.moods, ['Upset']);
});

test('real speech-to-text quirks: dashes, "8.30", stray fragments, pronoun subject with a named partner', () => {
  const transcript =
    'December 3 – Steve went to day program at 8.30 in the morning and came back at 4 pm. He made chicken and rice for dinner by himself and then he washed the dishes. In the evening he played dominoes with Jerrell and he was very happy. In the afternoon Hanna took Jerrell to the barber shop for a haircut. it. Gerald went for a walk with Nathanael in the evening.';
  const { items } = parseTranscript(transcript, {
    referenceDate: '2030-12-04',
    people: [people[0], { ...people[1], aliases: [...people[1].aliases, 'Gerald'] }],
  });
  const program = find(items, /^Steve went to day program at 8:30 AM and came back at 4:00 PM\.$/);
  assert.equal(program.date, '2030-12-03');
  assert.equal(program.shift, 'day');
  assert.equal(find(items, /^Steve washed the dishes\.$/).shift, 'evening');
  const dominoes = find(items, /^In the evening Steve played dominoes with his housemate Jerrell and he was very happy\.$/);
  assert.deepEqual(dominoes.people, ['steven', 'jerrell']);
  assert.equal(dominoes.subject, 'steven');
  assert.deepEqual(dominoes.moods, ['Happy']);
  assert.equal(find(items, /haircut/).text, 'In the afternoon Hanna took Jerrell to the barber shop for a haircut.');
  const walk = find(items, /^Jerrell went for a walk with Nathanael in the evening\.$/);
  assert.deepEqual(walk.people, ['jerrell']);
  assert.equal(walk.shift, 'evening');

  const movie = parseTranscript('Steve and Jerrell watched a movie, then they went to bed.', { referenceDate: '2030-12-04', people }).items[0];
  assert.equal(movie.text, 'Steve and Jerrell watched a movie together.');
});

test('dates are read from Telegram and WhatsApp file names', () => {
  assert.equal(dateFromFileName('audio_2026-09-12_21-14-05.ogg'), '2026-09-12');
  assert.equal(dateFromFileName('audio_3@12-09-2026_21-14-05.ogg'), '2026-09-12');
  assert.equal(dateFromFileName('PTT-20260912-WA0003.opus'), '2026-09-12');
  assert.equal(dateFromFileName('voice.ogg'), undefined);
});
