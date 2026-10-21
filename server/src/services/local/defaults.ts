import type { FieldAssignment, ShiftDraft, TemplateFieldInfo } from '../../types.js';
import type { Form680Spec } from '../template680.js';
import { nameRegex, personFromSpec, withName, type Person } from './person.js';
import { indexSections, type SectionKind, type SectionTopic } from './sectionTopics.js';

/**
 * Completion policy: after the evidence-based mapping, fill every field that
 * is still empty so no form goes out half-blank.
 *
 * The reviewer confirmed the individual had no medical issues in the covered
 * period, so untouched risk/routine sections are documented as routine
 * monitoring with nothing observed; weekly / as-needed supports that the
 * notes never mention are marked "Not Scheduled"; the end-of-shift questions
 * default to the household's normal pattern (scheduled meds on day and
 * evening shifts, none overnight; no complaints, no incidents).
 *
 * The only exception: a shift whose notes say the individual was away
 * (family visit, hospital, vacation...) — those get "Out of Facility" and
 * nothing is claimed about supports.
 *
 * Every string below is plain wording and can be edited freely.
 */

export type ShiftKind = 'day' | 'evening' | 'overnight';

export function shiftKind(shift: string): ShiftKind {
  const s = shift.toLowerCase();
  if (/overnight|night/.test(s) && !/day/.test(s)) return 'overnight';
  if (/evening|afternoon/.test(s)) return 'evening';
  if (/^\s*(?:day|morning)\b/.test(s)) return 'day';
  // "8am-4pm", "4pm-12am", "12am-8am", "16:00-00:00": classify by START hour.
  const m = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!m) return 'day';
  let hour = Number(m[1]) % 24;
  if (m[3] === 'pm' && hour !== 12) hour += 12;
  if (m[3] === 'am' && hour === 12) hour = 0;
  if (hour < 6 || hour >= 22) return 'overnight';
  if (hour >= 14) return 'evening';
  return 'day';
}

/** Notes that say the individual was away for the shift (present tense / whole shift). */
const ABSENT =
  /\b(?:(?:is|was|still|remained|remains|stayed|staying|spent the (?:night|day|weekend)) (?:at|with|in) (?:his )?(?:family|mom|mother|dad|father|parents|sister|brother|aunt|uncle|grandm\w+|relatives)(?:'s)?(?: (?:home|house|place))?|on (?:a |his )?(?:family|home) visit|(?:in|at) (?:the )?hospital|hospitali[sz]ed|admitted to|emergency room|\bER\b|on vacation|out of (?:the )?(?:house|facility|home) (?:for|all|the whole|this|today|tonight)|not (?:at|in) the (?:house|home|facility)|did not (?:come|return) (?:back|home)|away (?:for|all|the whole) (?:the )?(?:shift|day|night|weekend)|\babsent\b|leave of absence|\bLOA\b|respite)\b/i;
/** A bare status note: "Family visit", "Home visit - not in the house", "Away". */
const ABSENT_SHORT = /\b(?:family visit|home visit|out of (?:the )?(?:facility|house)|not (?:in|at) (?:the )?(?:house|home)|away|hospital|vacation|respite|absent|LOA)\b/i;
/** Lines about leaving later or having come back describe a present individual. */
const NOT_ABSENT = /\b(?:came back|come back|returned|return(?:s|ing)? (?:to|from)|back (?:to|at|in|from) the|to visit|will (?:be )?visit|going to|go to|excited|exited|leaving|will leave|packed|getting ready|drop(?:ped)? (?:him )?off|pick(?:ed)? (?:him )?up)\b/i;

export function absentLine(narrative: string, _person?: Person): string | undefined {
  const lines = narrative.split(/\n+|(?<=[.!?])\s+/).map((l) => l.trim()).filter(Boolean);
  // Only a short note that is about being away — a full day of activities
  // with one mention of "his family" is not an absence.
  if (lines.length > 3) return undefined;
  return lines.find((l) => {
    // "did not come back" is an absence even though it contains "come back".
    if (/\b(?:did not|didn'?t|has not|hasn'?t|never) (?:come|return|came)\b|\bnot back\b/i.test(l)) return true;
    if (NOT_ABSENT.test(l)) return false;
    if (ABSENT.test(l)) return true;
    return l.split(/\s+/).length <= 6 && ABSENT_SHORT.test(l);
  });
}

interface SectionDefault {
  /** Section topic (sectionTopics.ts); `match` is the name-based fallback for plain PDF templates. */
  topic: SectionTopic;
  match: RegExp;
  /** [type, documentation] for day/evening shifts (several phrasings rotate). */
  active: [string, string | string[]];
  /** [type, documentation] for the overnight shift. */
  overnight: [string, string | string[]];
}

/** Deterministic pick so the same shift always renders the same wording. */
function seeded(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  return h;
}
function pickText(text: string | string[], seed: number, salt: number): string {
  if (typeof text === 'string') return text;
  return text[(seed + salt * 7919) % text.length];
}

const MONITOR = 'Monitor';
const REMINDER = 'Reminder';
const FULL = 'Full Physical';
const NOT_SCHEDULED = 'Not Scheduled';

const SECTION_DEFAULTS: SectionDefault[] = [
  {
    topic: 'community',
    match: /^Outcome 2\b|community/i,
    active: [NOT_SCHEDULED, 'No community outing was scheduled this shift; {name}\'s weekly outing follows his activity schedule.'],
    overnight: [NOT_SCHEDULED, 'Community inclusion activities were not scheduled during the overnight hours while {given} slept.'],
  },
  {
    topic: 'cooking',
    match: /^Outcome 4\b|cook/i,
    active: [
      MONITOR,
      [
        '{name} took part in mealtime routines in the kitchen with staff supervision; staff reinforced safe appliance use and {diet}.',
        'Staff supervised {name} in the kitchen at mealtimes, reminding him about safe use of appliances and {diet} choices.',
        '{name} joined meal preparation with staff nearby; staff reinforced kitchen safety and {diet}.',
      ],
    ],
    overnight: [NOT_SCHEDULED, 'Cooking activities were not scheduled overnight; the kitchen was cleaned and secured for the morning.'],
  },
  {
    topic: 'dehydration',
    match: /^Identified Risk 1\b|dehydrat/i,
    active: [
      REMINDER,
      [
        'Staff offered fluids throughout the shift and encouraged {name} to drink water; no signs of dehydration were observed.',
        'Staff reminded {name} to drink water with meals and during the shift; he drank well and showed no signs of dehydration.',
        'Fluids were offered regularly and {name} was encouraged to keep drinking water; no signs of dehydration were noted.',
      ],
    ],
    overnight: [MONITOR, 'Water was available at {name}\'s bedside; no signs of dehydration were observed.'],
  },
  {
    topic: 'seizure',
    match: /^Identified Risk 2\b|seizure/i,
    active: [
      MONITOR,
      [
        'Staff monitored {name} for any signs of seizure activity throughout the shift; none were observed.',
        'Staff observed {name} for seizure activity during the shift and noted none.',
        'Seizure precautions were followed and staff monitored {name} throughout the shift; no seizure activity occurred.',
      ],
    ],
    overnight: [
      MONITOR,
      [
        'Staff completed overnight checks and monitored for seizure activity; none was observed.',
        'Overnight checks were completed at regular intervals with no seizure activity observed.',
      ],
    ],
  },
  {
    topic: 'pressure',
    match: /^Potential Risk 1\b|pressure/i,
    active: [MONITOR, 'Staff observed {name}\'s skin during routine care; no redness, marks or breakdown were noted.'],
    overnight: [MONITOR, '{name} repositioned himself naturally during sleep; skin remained intact with no areas of concern.'],
  },
  {
    topic: 'aspiration',
    match: /^Potential Risk 2\b|aspirat/i,
    active: [MONITOR, 'Staff supervised meals and snacks for safe pacing and swallowing; no coughing or choking occurred.'],
    overnight: [MONITOR, 'Staff listened for congestion or coughing during overnight checks; his breathing remained clear and even.'],
  },
  {
    topic: 'fall',
    match: /^Potential Risk 3\b|fall/i,
    active: [MONITOR, 'Walkways were kept clear and staff stayed nearby on stairs and uneven ground; {name} walked with a steady gait and no falls occurred.'],
    overnight: [MONITOR, 'A night light stayed on and pathways were kept clear; no falls occurred.'],
  },
  {
    topic: 'bowel',
    match: /^Potential Risk 4\b|bowel/i,
    active: [MONITOR, 'Staff monitored for signs of constipation or abdominal discomfort; {name} reported none.'],
    overnight: [MONITOR, 'No signs of constipation or abdominal discomfort were observed overnight.'],
  },
  {
    topic: 'sepsis',
    match: /^Potential Risk 5\b|sepsis/i,
    active: [MONITOR, 'Staff checked for fever, chills or unusual lethargy during routine care; no signs of infection were observed.'],
    overnight: [MONITOR, 'Staff observed no fever, chills or unusual lethargy during overnight checks.'],
  },
  {
    topic: 'equipment',
    match: /^Routine Support 1\b|glucometer|adaptive/i,
    active: [MONITOR, '{name}\'s {equipmentClause}'],
    overnight: [MONITOR, 'Adaptive equipment was stored safely within reach overnight; no concerns were noted.'],
  },
  {
    topic: 'communication',
    match: /^Routine Support 2\b|communicat/i,
    active: [
      MONITOR,
      [
        'Staff used clear, simple language and gave {name} time to respond; he communicated his needs and choices appropriately.',
        'Staff spoke with {name} in short, clear sentences and he expressed his needs and preferences without difficulty.',
        '{name} communicated his wants and needs clearly during the shift; staff listened and responded with simple language.',
      ],
    ],
    overnight: [MONITOR, 'Staff spoke calmly with {name} during the bedtime routine and checks; he communicated his needs appropriately.'],
  },
  {
    topic: 'medication',
    match: /^Routine Support 3\b|medication/i,
    active: [
      FULL,
      [
        'Staff administered {name}\'s scheduled medications as prescribed; he took them without difficulty and no errors occurred.',
        'Scheduled medications were administered by staff as prescribed and {name} took them cooperatively; no errors or concerns.',
      ],
    ],
    overnight: [NOT_SCHEDULED, 'No medications were scheduled during the overnight hours; the medication cabinet remained locked and secure.'],
  },
  {
    topic: 'housekeeping',
    match: /^Routine Support 4\b|housekeep/i,
    active: [NOT_SCHEDULED, 'Housekeeping tasks were not scheduled this shift; common areas were clean and orderly.'],
    overnight: [NOT_SCHEDULED, 'Housekeeping tasks were not scheduled overnight; common areas were already clean and secured.'],
  },
  {
    topic: 'laundry',
    match: /^Routine Support 5\b|laundry/i,
    active: [NOT_SCHEDULED, 'Laundry was not scheduled this shift; {name}\'s laundry follows the weekly household routine.'],
    overnight: [NOT_SCHEDULED, 'Laundry was not scheduled during the overnight hours.'],
  },
  {
    topic: 'shopping',
    match: /^Routine Support 6\b|shopping/i,
    active: [NOT_SCHEDULED, 'Shopping was not scheduled this shift and no purchases were needed.'],
    overnight: [NOT_SCHEDULED, 'Shopping was not scheduled during the overnight hours.'],
  },
  {
    topic: 'meals',
    match: /^Routine Support 7\b|meal/i,
    active: [
      MONITOR,
      [
        '{name} ate his meals in line with the {menu}; staff monitored portions and intake.',
        'Staff monitored {name}\'s meals and portions according to the {menuShort}; his intake was good.',
      ],
    ],
    overnight: [NOT_SCHEDULED, 'Meal planning was not scheduled overnight; the posted menu for the next day remained on the kitchen board.'],
  },
  {
    topic: 'money',
    match: /^Routine Support 8\b|bank|money/i,
    active: [NOT_SCHEDULED, 'Money management support was not scheduled this shift.'],
    overnight: [NOT_SCHEDULED, 'Money management support was not scheduled during the overnight hours.'],
  },
  {
    topic: 'appointments',
    match: /^Routine Support 9\b|appointment/i,
    active: [NOT_SCHEDULED, 'No medical appointments were scheduled this shift; the appointment calendar was reviewed and current.'],
    overnight: [NOT_SCHEDULED, 'No medical appointments were scheduled during the overnight hours.'],
  },
  {
    topic: 'transportation',
    match: /^Routine Support 10\b|transport/i,
    active: [NOT_SCHEDULED, 'No transportation was needed this shift; activities took place at the residence.'],
    overnight: [NOT_SCHEDULED, 'Transportation was not scheduled during the overnight hours.'],
  },
  {
    topic: 'medical',
    match: /^Routine Support 11\b|medical|diabet/i,
    active: [
      MONITOR,
      [
        'Staff encouraged {name} to follow {diet} and monitored for any concerns related to {conditions}; none were noted.',
        'Staff reinforced {name}\'s {dietBare} and watched for any health concerns linked to his diagnoses; nothing of concern was observed.',
      ],
    ],
    overnight: [MONITOR, 'Staff monitored {name} overnight for any health concerns related to his diagnoses; none were noted.'],
  },
  // ---- categories other individuals' plans use ----------------------------
  {
    topic: 'bathing',
    match: /bathing/i,
    active: [
      REMINDER,
      [
        'Staff reminded {name} to bathe and stayed nearby for safety; he completed his bathing routine.',
        '{name} took his shower with verbal prompts from staff and completed his hygiene routine.',
      ],
    ],
    overnight: [NOT_SCHEDULED, 'Bathing was not scheduled during the overnight hours.'],
  },
  {
    topic: 'dressing',
    match: /dressing/i,
    active: [REMINDER, '{name} chose his clothes and dressed himself with verbal prompts from staff; he was dressed appropriately for the weather.'],
    overnight: [MONITOR, '{name} changed into night clothes before bed with staff nearby as needed.'],
  },
  {
    topic: 'restroom',
    match: /restroom|toilet/i,
    active: [MONITOR, '{name} used the restroom independently during the shift; staff monitored and no concerns were noted.'],
    overnight: [MONITOR, '{name} used the restroom as needed overnight; staff monitored and no concerns were noted.'],
  },
  {
    topic: 'positioning',
    match: /positioning|transferring/i,
    active: [MONITOR, '{name} moved about the home and changed positions on his own; staff monitored and no assistance was needed.'],
    overnight: [MONITOR, '{name} repositioned himself during sleep; staff monitored during checks and no concerns were noted.'],
  },
  {
    topic: 'appearance',
    match: /personal appearance|grooming/i,
    active: [REMINDER, 'Staff reminded {name} to brush his teeth and groom himself; his appearance was neat and appropriate.'],
    overnight: [NOT_SCHEDULED, 'Personal appearance support was not scheduled during the overnight hours.'],
  },
  {
    topic: 'crisis',
    match: /crisis/i,
    active: [MONITOR, 'No crisis occurred this shift; staff followed {name}\'s support plan and he remained calm and safe.'],
    overnight: [MONITOR, 'No crisis occurred overnight; {name} remained calm and safe and the residence stayed secure.'],
  },
  {
    topic: 'elopement',
    match: /elopement|wandering/i,
    active: [
      MONITOR,
      [
        'Staff kept {name} within sight and knew his whereabouts throughout the shift; he did not attempt to leave the home unsupervised.',
        'Staff monitored the doors and checked on {name}\'s whereabouts regularly; he stayed at the home and did not attempt to leave unsupervised.',
      ],
    ],
    overnight: [MONITOR, 'Doors were secured for the night and staff completed regular checks; {name} remained in the home and did not attempt to leave.'],
  },
  {
    topic: 'suicidal',
    match: /suicid/i,
    active: [
      MONITOR,
      [
        'Staff monitored {name}\'s mood and statements throughout the shift; he made no statements of self-harm or suicidal ideation and no emergency support was needed.',
        'Staff checked in with {name} about how he was feeling during the shift; no statements or signs of suicidal ideation or self-harm were observed and no emergency support was needed.',
      ],
    ],
    overnight: [MONITOR, 'Staff completed overnight checks; {name} slept safely and no statements or signs of self-harm or suicidal ideation were observed.'],
  },
  {
    topic: 'safety',
    match: /safety awareness|lack of safety/i,
    active: [
      MONITOR,
      [
        'Staff supervised {name} for safety at home and in the community and reminded him about safe choices as needed; no safety concerns occurred.',
        'Staff kept {name} within sight during activities and prompted safe behavior when needed (kitchen, doors, crossing streets); no unsafe situations occurred.',
      ],
    ],
    overnight: [MONITOR, 'Doors and appliances were secured for the night and staff completed regular checks; no safety concerns occurred.'],
  },
  {
    topic: 'behavior',
    match: /behavio|outburst|aggression|mental health/i,
    active: [
      MONITOR,
      [
        'Staff monitored {name}\'s mood and behavior throughout the shift and used a calm, supportive approach; no behavioral concerns were observed.',
        '{name} interacted appropriately with staff and housemates during the shift; no behavioral concerns were observed.',
      ],
    ],
    overnight: [MONITOR, 'Staff monitored {name}\'s mood and behavior during overnight checks; no behavioral concerns were observed.'],
  },
  {
    topic: 'sleep',
    match: /sleep|bedtime/i,
    active: [NOT_SCHEDULED, 'Sleep support was not scheduled during the day; {name} followed his daytime routine.'],
    overnight: [MONITOR, '{name} settled for the night after his bedtime routine and slept through the night; staff completed the scheduled checks.'],
  },
  {
    topic: 'employment',
    match: /employment|vocational|\bjob\b/i,
    active: [NOT_SCHEDULED, 'Employment activities were not scheduled this shift; {name} continues to discuss his work goals with staff and his team.'],
    overnight: [NOT_SCHEDULED, 'Employment activities were not scheduled during the overnight hours.'],
  },
  {
    topic: 'skills',
    match: /independen|daily living|life skills|skill/i,
    active: [REMINDER, 'Staff encouraged {name} to complete his daily routine with as much independence as possible and provided reminders as needed.'],
    overnight: [MONITOR, '{name} completed his bedtime routine with reminders as needed and staff monitored overnight.'],
  },
];

const GENERIC_SECTION: SectionDefault = {
  topic: 'other',
  match: /.*/,
  active: [MONITOR, 'Staff monitored {name}\'s needs in this support area during the shift; no concerns were noted.'],
  overnight: [MONITOR, 'Staff monitored this support area during overnight checks; no concerns were noted.'],
};

/** Unknown topics still read sensibly for their kind of section. */
const GENERIC_BY_KIND: Partial<Record<SectionKind, SectionDefault>> = {
  Outcome: {
    topic: 'other',
    match: /.*/,
    active: [REMINDER, 'Staff encouraged {name} to work toward this outcome during the shift and supported his choices; no concerns were noted.'],
    overnight: [NOT_SCHEDULED, 'Activities for this outcome were not scheduled during the overnight hours.'],
  },
  'Identified Risk': {
    topic: 'other',
    match: /.*/,
    active: [MONITOR, 'Staff followed {name}\'s protocol for this risk and monitored him throughout the shift; no concerns were observed.'],
    overnight: [MONITOR, 'Staff followed {name}\'s protocol for this risk during overnight checks; no concerns were observed.'],
  },
  'Potential Risk': {
    topic: 'other',
    match: /.*/,
    active: [MONITOR, 'Staff monitored {name} for any signs related to this potential risk during the shift; none were observed.'],
    overnight: [MONITOR, 'Staff monitored for any signs related to this potential risk during overnight checks; none were observed.'],
  },
};

interface QuestionDefault {
  match: RegExp;
  answer: Record<ShiftKind, 'Yes' | 'No'>;
  explanation: Record<ShiftKind, string>;
}

const QUESTION_DEFAULTS: QuestionDefault[] = [
  {
    match: /medication/i,
    answer: { day: 'Yes', evening: 'Yes', overnight: 'No' },
    explanation: {
      day: 'Morning medications were administered as prescribed and taken without difficulty.',
      evening: 'Evening medications were administered as prescribed and taken without difficulty.',
      overnight: 'No medications were scheduled during the overnight hours.',
    },
  },
  {
    match: /complaint|concern|medical/i,
    answer: { day: 'No', evening: 'No', overnight: 'No' },
    explanation: {
      day: '{name} voiced no medical or mental health complaints during the shift.',
      evening: '{name} voiced no medical or mental health complaints during the shift.',
      overnight: '{name} voiced no complaints and slept comfortably through his checks.',
    },
  },
  {
    match: /behavio|emotional/i,
    answer: { day: 'No', evening: 'No', overnight: 'No' },
    explanation: {
      day: 'No emotional or behavioral concerns were observed; {name} followed staff guidance cooperatively.',
      evening: 'No emotional or behavioral concerns were observed; {name} followed staff guidance cooperatively.',
      overnight: 'No behavioral concerns were noted at any point overnight.',
    },
  },
  {
    match: /incident/i,
    answer: { day: 'No', evening: 'No', overnight: 'No' },
    explanation: {
      day: 'No serious incidents occurred; {name} remained safe throughout the shift.',
      evening: 'No serious incidents occurred; {name} remained safe throughout the shift.',
      overnight: 'No serious incidents occurred; {name} remained safe and the residence stayed secure.',
    },
  },
];

const ACTIVITY_DEFAULTS: Record<'Individual' | 'Group' | 'Community', Record<ShiftKind, string>> = {
  Individual: {
    day: '{name} spent time on his preferred activities at home.',
    evening: '{name} relaxed with his preferred activities at home in the evening.',
    overnight: '{name} completed his bedtime routine and slept through the night.',
  },
  Group: {
    day: 'No group activity was scheduled this shift.',
    evening: 'No group activity was scheduled this shift.',
    overnight: 'Group activities were not scheduled during the overnight hours.',
  },
  Community: {
    day: 'No community outing took place this shift.',
    evening: 'No community outing took place this shift.',
    overnight: 'Community outings were not scheduled during the overnight hours.',
  },
};

const MOOD_DEFAULT: Record<ShiftKind, { box: string; description: string }> = {
  day: { box: 'Content', description: '{name} appeared content throughout the shift.' },
  evening: { box: 'Content', description: '{name} appeared content throughout the evening.' },
  overnight: { box: 'Calm', description: '{name} appeared calm and settled and slept through the night.' },
};

/**
 * Wording that depends on the individual's plan, read off the template text:
 * a diabetic plan keeps the diabetic-diet phrasing, any other plan gets
 * neutral healthy-eating wording.
 */
interface Vocabulary {
  person: Person;
  diet: string;
  dietBare: string;
  menu: string;
  menuShort: string;
  conditions: string;
  equipmentClause: string;
}

function vocabularyFor(spec: Form680Spec | undefined): Vocabulary {
  const person = personFromSpec(spec);
  const text = spec ? spec.sections.map((s) => `${s.title} ${s.detailLines.join(' ')}`).join(' ') : '';
  const diabetic = /diabet/i.test(text);
  const conditions: string[] = [];
  if (diabetic) conditions.push('diabetes');
  if (/seizure|epilep/i.test(text)) conditions.push('seizures');
  if (/hypertension|blood pressure/i.test(text)) conditions.push('blood pressure');
  if (/cholesterol/i.test(text)) conditions.push('cholesterol');
  if (/asthma/i.test(text)) conditions.push('asthma');
  if (/thyroid/i.test(text)) conditions.push('thyroid');
  if (/\bgout\b/i.test(text)) conditions.push('gout');
  const list =
    conditions.length === 0
      ? 'his diagnoses'
      : conditions.length === 1
        ? `his ${conditions[0]}`
        : `his ${conditions.slice(0, -1).join(', ')} or ${conditions[conditions.length - 1]}`;
  const glucometer = /glucometer/i.test(text);
  return {
    person,
    diet: diabetic ? 'his diabetic diet' : 'healthy eating',
    dietBare: diabetic ? 'diabetic diet' : 'healthy eating habits',
    menu: diabetic ? 'posted diabetic-friendly menu' : 'posted menu',
    menuShort: diabetic ? 'diabetic-friendly menu' : 'posted menu',
    conditions: list,
    equipmentClause: glucometer
      ? 'glucometer and adaptive equipment were available and in working order; staff monitored their use as needed.'
      : 'adaptive equipment was available and in working order; staff monitored its use as needed.',
  };
}

function fill(text: string, v: Vocabulary): string {
  return withName(
    text
      .replace(/\{diet\}/g, v.diet)
      .replace(/\{dietBare\}/g, v.dietBare)
      .replace(/\{menu\}/g, v.menu)
      .replace(/\{menuShort\}/g, v.menuShort)
      .replace(/\{conditions\}/g, v.conditions)
      .replace(/\{equipmentClause\}/g, v.equipmentClause),
    v.person,
  );
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

function pickOption(options: string[] | undefined, wanted: string): string | undefined {
  if (!options) return undefined;
  const w = norm(wanted);
  return options.find((o) => norm(o) === w) ?? options.find((o) => norm(o).startsWith(w)) ?? options.find((o) => norm(o).includes(w));
}

/** Fill every still-empty field of the template with the policy defaults above. */
export function completeAssignments(
  assignments: FieldAssignment[],
  shift: ShiftDraft,
  fields: TemplateFieldInfo[],
  spec?: Form680Spec,
): { assignments: FieldAssignment[]; notes: string[] } {
  const out = [...assignments];
  const notes: string[] = [];
  const has = (name: string): boolean => out.some((a) => a.field === name && a.value !== '' && a.value !== false);
  const set = (name: string, value: string | boolean): void => {
    if (!has(name)) out.push({ field: name, value });
  };
  const byName = new Map(fields.map((f) => [f.name, f]));
  const vocab = vocabularyFor(spec);
  const person = vocab.person;
  const say = (text: string): string => fill(text, vocab);
  const index = indexSections(spec, fields);
  const topicOfId = (id: string): SectionTopic | undefined => index?.find((s) => s.id === id)?.topic;
  const kindOfId = (id: string): SectionKind | undefined => index?.find((s) => s.id === id)?.kind;
  const isTopic = (id: string, topic: SectionTopic, fallback: RegExp): boolean =>
    index ? topicOfId(id) === topic : fallback.test(id);

  const kind = shiftKind(shift.shift);
  const away = absentLine(shift.narrative, person);
  const seed = seeded(`${shift.date}|${shift.shift}`);
  const awayReason = away?.replace(/[.\s]+$/, '') ?? '';
  const awayDoc = nameRegex('^{name}\\b', person).test(awayReason)
    ? `${awayReason}; no supports were provided at the residence.`
    : say(`{name} was out of the facility during this shift (${awayReason}).`);
  // Did the notes place him in the community this shift (day support, outing)?
  const wentOut =
    !away &&
    (out.some((a) => {
      const m = a.field.match(/^(.+) - Support Type$/);
      return m && isTopic(m[1], 'community', /^Outcome 2$/i) && /out of facility/i.test(String(a.value));
    }) ||
      out.some((a) => a.evidence && /^Community Activity$/i.test(a.field)));
  const atDaySupport = wentOut && /\bday (?:support|program)\b/i.test(shift.narrative) && !/\b(?:did not|didn'?t|not) go\b|\bday off\b/i.test(shift.narrative);
  // A recorded health event: the medical-support section must reflect it
  // instead of the routine "no concerns" wording.
  const healthEvent = out.some((a) => /^Medical Complaints$/i.test(a.field) && a.evidence && /^yes$/i.test(String(a.value)))
    ? String(out.find((a) => /^Medical Complaints Explanation$/i.test(a.field))?.value ?? '')
    : '';

  // ---- Support sections ----------------------------------------------------
  const sectionIds = new Set<string>();
  for (const f of fields) {
    const m = f.name.match(/^(.+?) - (?:Support Type|Documentation)$/);
    if (m) sectionIds.add(m[1]);
  }
  let sectionIndex = 0;
  for (const id of sectionIds) {
    sectionIndex++;
    const typeField = byName.get(`${id} - Support Type`);
    const docField = byName.get(`${id} - Documentation`);
    const topic = topicOfId(id);
    const rule =
      (topic && topic !== 'other' ? SECTION_DEFAULTS.find((r) => r.topic === topic) : undefined) ??
      (index ? undefined : SECTION_DEFAULTS.find((r) => r.match.test(id))) ??
      (kindOfId(id) ? GENERIC_BY_KIND[kindOfId(id)!] : undefined) ??
      GENERIC_SECTION;
    const [defType, defDoc] = kind === 'overnight' ? rule.overnight : rule.active;
    let [type, doc] = away ? ['Out of Facility', awayDoc] : [defType, say(pickText(defDoc, seed, sectionIndex))];
    if (wentOut && isTopic(id, 'transportation', /^Routine Support 10\b|transport/i)) {
      [type, doc] = [
        'Out of Facility',
        say("Transportation to and from {name}'s community activity was provided as scheduled; he traveled and returned safely."),
      ];
    }
    if (healthEvent && !away && isTopic(id, 'medical', /^Routine Support 11\b|medical #|diabet/i)) {
      [type, doc] = [MONITOR, say(`Staff responded to a health concern this shift: ${healthEvent.replace(/[.\s]+$/, '')}. {name} was monitored for the rest of the shift.`)];
    }
    if (typeField && !has(typeField.name)) {
      const option = pickOption(typeField.options, type) ?? pickOption(typeField.options, MONITOR);
      if (option) set(typeField.name, option);
    }
    if (docField && !has(docField.name)) set(docField.name, doc);
  }

  // ---- End-of-shift questions ---------------------------------------------
  for (const f of fields) {
    if (f.type !== 'radio' && f.type !== 'dropdown') continue;
    if (/ - Support Type$/.test(f.name)) continue;
    const yes = f.options?.find((o) => /^yes$/i.test(o));
    const no = f.options?.find((o) => /^no$/i.test(o));
    if (!yes || !no) continue;
    const q = QUESTION_DEFAULTS.find((d) => d.match.test(f.name));
    const explainField = fields.find((x) => x.type === 'text' && x.name.startsWith(f.name) && /explanation/i.test(x.name));
    if (away) {
      set(f.name, no);
      if (explainField) set(explainField.name, say('{name} was out of the facility during this shift.'));
      continue;
    }
    const answer = q ? q.answer[kind] : 'No';
    const alreadyAnswered = out.find((a) => a.field === f.name)?.value;
    set(f.name, answer === 'Yes' ? yes : no);
    if (explainField && !has(explainField.name)) {
      // A "Yes" found in the notes without a detail line keeps its evidence.
      const fromNotes = out.find((a) => a.field === f.name)?.evidence;
      const explanation =
        alreadyAnswered && fromNotes ? fromNotes : q ? say(q.explanation[kind]) : 'None reported this shift.';
      set(explainField.name, explanation);
    }
  }

  // ---- Mood ------------------------------------------------------------------
  const moodBoxes = fields.filter((f) => f.type === 'checkbox' && /^Mood: /i.test(f.name));
  if (moodBoxes.length > 0) {
    // A write-in under "Other" ticks the Other box (PDF templates that have one).
    if (has('Mood: Other') && byName.has('Mood: Other Checked')) set('Mood: Other Checked', true);
    const anyMood = moodBoxes.some((f) => has(f.name));
    // A word the staff wrote in "Other" (e.g. "Bored") is the mood; don't add a default on top.
    if (!anyMood && !away && !has('Mood: Other')) {
      const box = moodBoxes.find((f) => norm(f.name) === norm(`Mood: ${MOOD_DEFAULT[kind].box}`));
      if (box) set(box.name, true);
    }
  }
  if (byName.has('Mood Description') && !has('Mood Description')) {
    set('Mood Description', away ? say('Not observed - {name} was out of the facility during this shift.') : say(MOOD_DEFAULT[kind].description));
  }

  // ---- Activities ------------------------------------------------------------
  const narrativeLines = shift.narrative.split(/\n+|(?<=[.!?])\s+/).map((l) => l.trim()).filter((l) => l.length >= 8);
  // Lines already placed somewhere (documentation, explanations, other
  // activity boxes) or that describe feelings rather than an activity.
  const usedTexts = new Set<string>();
  for (const a of out) {
    if (typeof a.value === 'string') usedTexts.add(a.value);
    if (a.evidence) usedTexts.add(a.evidence);
  }
  const notAnActivity = /\b(?:sad|upset|cried|crying|grie\w+|passed away|lost his|felt|feeling|mood|seizure|medication|meds|incident|911|ambulance|hospital|fight|injur\w*|bleed\w*|first aid|notified|complained)\b|^(?:nothing|none|n\/a)$/i;
  for (const kindName of ['Individual', 'Group', 'Community'] as const) {
    const field = byName.get(`${kindName} Activity`);
    if (!field || has(field.name)) continue;
    if (away) {
      set(field.name, kindName === 'Community' ? awayDoc : say('Not applicable - {name} was out of the facility.'));
      continue;
    }
    if (kindName === 'Individual') {
      // Prefer something the staff actually wrote over boilerplate.
      const line = narrativeLines.find((l) => !usedTexts.has(l) && !notAnActivity.test(l));
      if (line) {
        set(field.name, line);
        usedTexts.add(line);
        continue;
      }
    }
    if (kindName === 'Group' && atDaySupport) {
      set(field.name, say('{name} took part in group activities with peers at his day support program.'));
      continue;
    }
    if (kindName === 'Community' && wentOut) {
      // Keep the activity box consistent with what the community outcome documented.
      const outing = out.find((a) => {
        const m = a.field.match(/^(.+) - Documentation$/);
        return m && a.evidence && isTopic(m[1], 'community', /^Outcome 2$/i);
      });
      if (outing) {
        set(field.name, String(outing.value));
        continue;
      }
    }
    set(field.name, say(ACTIVITY_DEFAULTS[kindName][kind]));
  }

  // ---- Narrative -------------------------------------------------------------
  const narrativeField = fields.find((f) => f.type === 'text' && /narrative|progress note/i.test(f.name));
  if (narrativeField && !has(narrativeField.name)) {
    const mood = shift.mood ? `{Name} appeared ${shift.mood.toLowerCase()} throughout the shift. ` : '';
    const routine =
      kind === 'overnight'
        ? [
            `${mood}Staff completed overnight checks; {Name} slept through the night and no concerns were noted.`,
            `${mood}{Name} settled for the night after his bedtime routine. Overnight checks were completed and he slept without incident.`,
            `${mood}{Name} slept through the night. Staff completed the scheduled checks and nothing of concern was observed.`,
          ]
        : [
            `${mood}Staff provided routine supports and monitoring throughout the shift; no concerns were noted.`,
            `${mood}{Name} followed his usual routine this shift with staff support and supervision; there were no concerns.`,
            `${mood}Routine shift: {Name} took part in his daily routine with staff nearby, and no issues were observed.`,
          ];
    set(narrativeField.name, say(pickText(routine, seed, 99)));
  }

  if (away) notes.push(`Marked as out of the facility ("${awayReason}").`);
  return { assignments: out, notes };
}
