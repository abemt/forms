/**
 * Turns a voice-note transcript (or a pasted text report) into dated items:
 * one cleaned, third-person sentence per item, assigned to a date, to the
 * individual(s) it is about and to a shift box, with topics (which routine
 * lines it replaces), moods and review flags.
 *
 * Everything is rule-based and deterministic: the same transcript always gives
 * the same items, and every item keeps the sentence it came from. Nothing is
 * added that was not said; the reviewer can reassign or edit any item.
 */
import type { ShiftKind } from '../logWriter/types.js';

export interface VoicePerson {
  /** Profile id, e.g. "steven". */
  id: string;
  /** Everyday name written in the notes, e.g. "Steve". */
  first: string;
  /** Other spellings that mean this person ("Steven", "Jay", "Jarrell"). */
  aliases: string[];
}

export interface VoiceCorrection {
  from: string;
  to: string;
}

export interface ParseOptions {
  /** YYYY-MM-DD: what "today" means and where sentences before any date go. */
  referenceDate: string;
  people: VoicePerson[];
  corrections?: VoiceCorrection[];
}

export interface VoiceItem {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  /** Profile ids the sentence is about. */
  people: string[];
  /** The person the sentence's subject is (moods belong to them); unset = everyone in people. */
  subject?: string;
  shift: ShiftKind;
  /** Cleaned third-person sentence as it will appear in the log. */
  text: string;
  /** The sentence as transcribed (after spelling corrections). */
  original: string;
  topics: string[];
  moods: string[];
  /** Also apply the mood to the evening box ("all day"). */
  moodAllDay?: boolean;
  program?: 'attended' | 'home';
  flags: ('health' | 'behavior' | 'incident')[];
  /** Why the date/shift were chosen, for the review table. */
  dateReason: string;
  shiftReason: string;
  excluded?: boolean;
}

export interface ParseResult {
  items: VoiceItem[];
  /** Sentences dropped as greetings, fillers or date-only lines. */
  skipped: string[];
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const UNITS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth'];
const ORDINALS: Record<string, number> = {
  tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16,
  seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30,
};
UNITS.forEach((word, i) => {
  ORDINALS[word] = i + 1;
  ORDINALS[`twenty ${word}`] = 21 + i;
  ORDINALS[`twenty-${word}`] = 21 + i;
});
ORDINALS['thirty first'] = 31;
ORDINALS['thirty-first'] = 31;
const ORDINAL_WORDS = Object.keys(ORDINALS).sort((a, b) => b.length - a.length).map((w) => w.replace('-', '[- ]')).join('|');
const DAY = `(\\d{1,2})(?:st|nd|rd|th)?|(${ORDINAL_WORDS})`;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY = '(sunday|monday|tuesday|wednesday|thursday|friday|saturday)';

const MONTH_DAY_RE = new RegExp(`\\b${MONTH}\\s+(?:the\\s+)?(?:${DAY})\\b`, 'i');
const DAY_MONTH_RE = new RegExp(`\\b(?:the\\s+)?(?:${DAY})\\s+(?:of\\s+)?${MONTH}(?![a-z])`, 'i');
const THE_NTH_RE = new RegExp(`\\bthe\\s+(?:(\\d{1,2})(?:st|nd|rd|th)|(${ORDINAL_WORDS}))\\b`, 'i');
const WEEKDAY_RE = new RegExp(`\\b(every\\s+|each\\s+)?(?:on\\s+|last\\s+|this\\s+|this past\\s+|past\\s+)?${WEEKDAY}(s)?\\b`, 'i');

function monthIndex(token: string): number {
  const t = token.toLowerCase().replace('.', '');
  return MONTH_NAMES.findIndex((m) => m.startsWith(t.slice(0, 3)));
}

function dayNumber(digits: string | undefined, word: string | undefined): number | undefined {
  if (digits) return Number(digits);
  if (word) return ORDINALS[word.toLowerCase().replace(/\s+/g, ' ')] ?? ORDINALS[word.toLowerCase().replace(/[\s-]+/g, '-')];
  return undefined;
}

const toUtc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => toIso(new Date(toUtc(iso).getTime() + n * 86_400_000));

function makeDate(year: number, month: number, day: number): string | undefined {
  const date = new Date(Date.UTC(year, month, day));
  return date.getUTCMonth() === month && day >= 1 ? toIso(date) : undefined;
}

/** The year that puts the month closest to the reference date (December notes read in January). */
function yearFor(month: number, reference: string): number {
  const ref = toUtc(reference);
  const diff = month - ref.getUTCMonth();
  if (diff > 6) return ref.getUTCFullYear() - 1;
  if (diff < -6) return ref.getUTCFullYear() + 1;
  return ref.getUTCFullYear();
}

interface DateContext {
  current: string;
  reference: string;
  /** An explicit calendar date was already mentioned in this note. */
  explicit: boolean;
}

interface DateMarker {
  date: string;
  explicit: boolean;
  reason: string;
}

function findDate(sentence: string, ctx: DateContext): DateMarker | undefined {
  const s = sentence;
  let m = MONTH_DAY_RE.exec(s);
  if (m) {
    const month = monthIndex(m[1]);
    const day = dayNumber(m[2], m[3]);
    const date = day ? makeDate(yearFor(month, ctx.reference), month, day) : undefined;
    if (date) return { date, explicit: true, reason: `said "${m[0].trim()}"` };
  }
  m = DAY_MONTH_RE.exec(s);
  if (m) {
    const month = monthIndex(m[3]);
    const day = dayNumber(m[1], m[2]);
    const date = day ? makeDate(yearFor(month, ctx.reference), month, day) : undefined;
    if (date) return { date, explicit: true, reason: `said "${m[0].trim()}"` };
  }
  m = THE_NTH_RE.exec(s);
  if (m) {
    const day = dayNumber(m[1], m[2]);
    const cur = toUtc(ctx.current);
    const date = day ? makeDate(cur.getUTCFullYear(), cur.getUTCMonth(), day) : undefined;
    if (date) return { date, explicit: true, reason: `said "${m[0].trim()}"` };
  }
  if (/\b(?:the (?:next|following) day|next day)\b/i.test(s)) return { date: addDays(ctx.current, 1), explicit: ctx.explicit, reason: 'said "the next day"' };
  if (/\b(?:yesterday|the day before)\b/i.test(s)) {
    const base = ctx.explicit ? ctx.current : ctx.reference;
    return { date: addDays(base, -1), explicit: ctx.explicit, reason: 'said "yesterday"' };
  }
  m = WEEKDAY_RE.exec(s);
  if (m && !m[1] && !m[3]) {
    const target = WEEKDAYS.indexOf(m[2].toLowerCase());
    return { date: weekdayDate(target, ctx), explicit: ctx.explicit, reason: `said "${m[0].trim()}"` };
  }
  return undefined;
}

function weekdayDate(target: number, ctx: DateContext): string {
  const back = (from: string) => addDays(from, -((toUtc(from).getUTCDay() - target + 7) % 7));
  // Before any calendar date: the most recent such day. Inside a dated account: the next one going forward.
  if (!ctx.explicit) return back(ctx.reference);
  const forward = addDays(ctx.current, (target - toUtc(ctx.current).getUTCDay() + 7) % 7);
  return forward > ctx.reference ? back(ctx.current) : forward;
}

/** Leading "Today, Wednesday, September 10th," / "On Monday" / "Yesterday" phrases, removed from the text once used. */
const LEADING_DATE_RE = new RegExp(
  `^(?:(?:so|and|okay|ok)\\s*,?\\s+)?(?:(?:today|it|this)\\s+(?:is|was)\\s+)?(?:(?:on\\s+)?(?:today|yesterday|the (?:next|following) day|next day|(?:last |this |this past )?${WEEKDAY}|${MONTH}\\s+(?:the\\s+)?(?:${DAY})|(?:the\\s+)?(?:${DAY})\\s+(?:of\\s+)?${MONTH}|the\\s+(?:\\d{1,2}(?:st|nd|rd|th)|${ORDINAL_WORDS}))(?:\\s*,?\\s*(?:\\d{4}\\b|${WEEKDAY}\\b|${MONTH}\\s+(?:the\\s+)?(?:${DAY})\\b))*)[\\s,.:;-]*`,
  'i',
);

// ---------------------------------------------------------------------------
// Sentences
// ---------------------------------------------------------------------------
function normalize(raw: string, corrections: VoiceCorrection[]): string {
  let text = raw.replace(/\r/g, '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  for (const { from, to } of corrections) {
    if (!from.trim()) continue;
    const escaped = from.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pre = /^\w/.test(from.trim()) ? '\\b' : '';
    const post = /\w$/.test(from.trim()) ? '\\b' : '';
    text = text.replace(new RegExp(`${pre}${escaped}${post}`, 'gi'), to);
  }
  return text
    .replace(/\bD\.?\s?S\.?\s?P\.?(?=\W|$)/g, 'DSP')
    // "DSP" in her messages is the day support program, not a staff title.
    .replace(/\b(to|from|at|after|before|attend(?:ed|s)?|started|start|go(?:es)?|went|in|no)\s+(?:the\s+)?DSP\b/gi, '$1 day program')
    .replace(/\b(Dr|Mr|Mrs|Ms|St)\./g, '$1')
    // Speech-to-text writes pauses as dashes: "December 3 - Steve went...".
    .replace(/\s+[–—-]+\s+/g, ', ')
    // Stray one-word fragments between sentences ("...for a haircut. it. The next day").
    .replace(/([.!?])\s+[a-z]{1,4}[.!?](?=\s|$)/g, '$1')
    // Times: "8.30" -> "8:30", "8 in the morning" -> "8:00 AM".
    .replace(/\b(at|around|by|until|till|from|about|before|after)\s+(\d{1,2})\.(\d{2})\b/gi, '$1 $2:$3')
    .replace(/\b(\d{1,2})\.(\d{2})(?=\s*(?:a\.?\s?m|p\.?\s?m|in the)\b)/gi, '$1:$2')
    .replace(/\b(\d{1,2})(?::(\d{2}))?\s+(?:o'?clock\s+)?in the (morning|afternoon|evening)\b/gi, (_m: string, h: string, mm: string | undefined, part: string) => `${Number(h)}:${mm ?? '00'} ${part.toLowerCase() === 'morning' ? 'AM' : 'PM'}`)
    // "a.m." at the end of a sentence also ends the sentence; keep that period.
    .replace(/\b(\d{1,2})(?::(\d{2}))?\s*(a|p)\.?\s?m\b(\.)?/gi, (match: string, h: string, mm: string | undefined, ap: string, dot: string | undefined, offset: number, whole: string) => {
      const rest = whole.slice(offset + match.length);
      const end = dot && (/^\s*$/.test(rest) || /^\s+["(]?[A-Z0-9]/.test(rest)) ? '.' : '';
      return `${Number(h)}:${mm ?? '00'} ${ap.toUpperCase()}M${end}`;
    })
    .replace(/[ \t]+/g, ' ');
}

const CONTINUATION_VERB = /^(?:went|came|watched|played|cooked|ate|made|took|did|helped|cleaned|walked|slept|woke|had|got|drew|called|visited|bought|finished|started|stayed|showered|brushed|washed|folded|packed|returned|left|sat|enjoyed|listened|spent|used|put|read|sang|danced|rested|relaxed|laughed|talked|chatted|asked|told|said|seemed|looked|was|were|also)\b/i;

function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const block of text.split(/\n+/)) {
    for (const sentence of block.split(/(?<=[.!?])\s+(?=["(]?[A-Z0-9])/)) {
      // Speech runs events together; "and then" / "after that" / ", then he" start a new line in the log.
      const parts = sentence.split(/,?\s+(?:and then|and after that|after that|afterwards|then after that)\s*,?\s+|,\s+then\s+(?=(?:he|she|they|we)\b)/i);
      parts.forEach((part, i) => {
        let p = part.trim();
        if (!p) return;
        if (i > 0 && CONTINUATION_VERB.test(p)) p = `he ${p}`;
        out.push(p);
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// People, shifts, topics, moods, flags
// ---------------------------------------------------------------------------
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BOTH_RE = /\b(?:both|they|them|their|the two of them|the guys|the boys|the residents|the clients|everyone|everybody|each other)\b/i;
const TOGETHER_RE = /\b(?:together|both|each other|housemate|roommate|house mate|room mate)\b/i;
const HE_RE = /\b(?:he|him|his|himself)\b/i;

function clockShift(s: string): ShiftKind | undefined {
  const m = /\b(\d{1,2}):(\d{2}) (AM|PM)\b/.exec(s);
  if (!m) return undefined;
  const hour = (Number(m[1]) % 12) + (m[3] === 'PM' ? 12 : 0);
  if (hour >= 8 && hour < 16) return 'day';
  if (hour >= 16) return 'evening';
  return 'night';
}

const NIGHT_RE = /\b(?:overnight|over night|during the night|through(?:out)? the night|all night|last night|midnight|middle of the night|in the night|bed checks?|night checks?)\b/i;
const EVENING_RE = /\b(?:evening|tonight|at night|dinner|supper|after (?:the |his )?(?:day )?program|after day support|(?:came|got) (?:back )?home|(?:came|got) back from (?:the |his )?(?:day )?(?:program|day support|inner vision)|bed ?time|went to bed|go to bed|before bed|night ?time)\b/i;
const DAY_RE = /\b(?:morning|breakfast|lunch|afternoon|noon|midday|day program|day support|inner vision|during the day|in the day|daytime)\b/i;
const SLEEP_RE = /\b(?:slept|sleep|sleeping|asleep|woke up|wake up|waking up)\b/i;

function detectShift(s: string): { shift: ShiftKind; reason: string } | undefined {
  const clock = clockShift(s);
  if (clock) return { shift: clock, reason: 'time of day' };
  let m = NIGHT_RE.exec(s);
  if (m) return { shift: 'night', reason: `"${m[0]}"` };
  m = EVENING_RE.exec(s);
  if (m) return { shift: 'evening', reason: `"${m[0]}"` };
  m = DAY_RE.exec(s);
  if (m) return { shift: 'day', reason: `"${m[0]}"` };
  m = SLEEP_RE.exec(s);
  if (m) return { shift: 'night', reason: `"${m[0]}"` };
  return undefined;
}

const PROGRAM = '(?:day program|day support|inner vision(?: day support)?|(?:his |the )?program)';
const NOT_STARTED_RE = /\b(?:has ?n'?t|have ?n'?t|has not|have not|not yet|still not|never)\s+(?:\w+\s+)?(?:started|begun|begin|start)\b/i;
const HOME_RE = new RegExp(`\\b(?:did not|didn'?t|didnt|does not|doesn'?t|not|no)\\s+(?:\\w+\\s+){0,3}?(?:go|going|attend\\w*|went)\\s+(?:to\\s+)?(?:the\\s+)?${PROGRAM}|\\bno (?:day )?program\\b|\\bstayed (?:at )?home\\b|\\bhome all day\\b|\\bprogram (?:was )?closed\\b`, 'i');
const ATTEND_RE = new RegExp(`\\b(?:went|goes|go|attended|was at|at|to|from|after)\\s+(?:the\\s+|his\\s+)?${PROGRAM}\\b`, 'i');

const TOPIC_RULES: [string, RegExp][] = [
  ['breakfast', /\bbreakfast\b/i],
  ['packlunch', /\bpack(?:ed|s|ing)? (?:his |a |the )?lunch\b/i],
  ['lunch', /\blunch\b(?! bag| box)/i],
  ['dinner', /\b(?:dinner|supper)\b/i],
  ['meds', /\b(?:medications?|meds|medicines?|pills?|insulin)\b/i],
  ['laundry', /\blaundry\b|\b(?:wash|fold)(?:ed|ing|s)? (?:his |the )?(?:clothes|sheets|towels)\b/i],
  ['chores', /\b(?:clean(?:ed|ing|s)?|vacuum(?:ed|ing)?|dishes|trash|garbage|sweep|swept|mop(?:ped|ping)?|tid(?:y|ied|ying)|made his bed|chores?|dust(?:ed|ing)?)\b/i],
  ['hygiene', /\b(?:shower(?:ed|s)?|bath(?:ed)?|brush(?:ed)? (?:his )?teeth|shav(?:ed|e|ing)|got dressed|dressed himself|hygiene|washed (?:his )?(?:face|hands|hair|body))\b/i],
  ['outing', /\b(?:went (?:out|to (?!bed\b|sleep\b|his room\b|the (?:bathroom|restroom)\b|(?:the |his )?(?:day program|day support|program|inner vision)\b))|go(?:es)? (?:out|to the)|took (?:him|them|\w+) (?:to|out)|park|store|mall|walmart|target|church|beach|restaurant|burger king|mcdonald'?s|ihop|wendy'?s|chick-?fil-?a|library|cinema|movie theat(?:er|re)|zoo|museum|drive|ride|community|outing|shopping|goodwill|dollar tree|barber|haircut)\b/i],
  ['walk', /\bwalk(?:ed|ing|s)?\b/i],
  ['leisure', /\b(?:tv|television|movies?|guitar|music|songs?|sing|sang|xbox|video games?|games?|dominoes|cards|draw(?:ing|s)?|drew|sketch\w*|puzzles?|phone|tablet|youtube|color(?:ing|ed)?|paint(?:ing|ed)?|basketball|football|soccer)\b/i],
  ['bedtime', /\b(?:went to bed|go(?:es)? to bed|bed ?time|to bed at)\b/i],
  ['sleep', /\b(?:slept|sleep(?:ing)?|asleep|woke up|wake up|waking up|nap(?:ped|s)?)\b/i],
  ['hydration', /\b(?:water|fluids?|drank|drink(?:ing|s)?|juice)\b/i],
  ['appointment', /\b(?:doctor|dr|dentist|dental|clinic|appointment|physical|nurse|hospital|lab|blood (?:work|test|draw)|therapy|therapist|psychiatrist|counselor|pharmacy|check-?up|tb (?:test|screen\w*))\b/i],
  ['meeting', /\b(?:house meeting|team meeting|meeting)\b/i],
  ['money', /\b(?:savings?|allowance|budget|spending money|bank)\b/i],
  ['grocery', /\bgrocer(?:y|ies)\b/i],
];

const HEALTH_RE = /\b(?:sick|ill|fever|vomit\w*|threw up|pain|hurt|injur\w*|bleed\w*|bruis\w*|fell|fall(?:s)? down|had a fall|seizures?|headache|stomach ?ache|cough\w*|(?:had|has|have|caught) a cold|flu|rash|swollen|sore|dizzy|blood sugar|diarrh\w*|constipat\w*|toothache|burn(?:ed|t)?)\b/i;
const NO_SEIZURE_RE = /\bno (?:seizures?|seizure activity)\b|\bwithout (?:a|any) seizures?\b/i;
const BEHAVIOR_RE = /\b(?:upset|angry|mad|argu\w*|yell\w*|scream\w*|fight|fought|punch\w*|kick\w*|refus\w*|cried|crying|aggressi\w*|agitated|frustrated|curs(?:ed|ing)|swore|slammed|tantrum|meltdown)\b/i;
const INCIDENT_RE = /\b(?:911|ambulance|hospital|emergency|police|incident|elope\w*|ran away|went missing|left the house without)\b/i;

const MOOD_WORDS: [RegExp, string][] = [
  [/\bin a (?:good|great|nice|happy) mood\b/i, 'Happy'],
  [/\b(?:happy|cheerful|joyful|glad)\b/i, 'Happy'],
  [/\b(?:excited|exited)\b/i, 'Excited'],
  [/\b(?:calm|quiet|peaceful)\b/i, 'Calm'],
  [/\b(?:relaxed|chill(?:ed|ing)?)\b/i, 'Relaxed'],
  [/\b(?:content|fine|okay|good)\b/i, 'Content'],
  [/\b(?:friendly|polite|nice)\b/i, 'Friendly'],
  [/\b(?:talkative|chatty)\b/i, 'Talkative'],
  [/\b(?:outgoing|social)\b/i, 'Outgoing'],
  [/\b(?:tired|sleepy|exhausted)\b/i, 'Tired'],
  [/\b(?:sad|down|unhappy)\b/i, 'Sad'],
  [/\bupset\b/i, 'Upset'],
  [/\b(?:angry|mad)\b/i, 'Angry'],
  [/\b(?:anxious|nervous|worried|scared)\b/i, 'Anxious'],
  [/\bfrustrated\b/i, 'Frustrated'],
  [/\b(?:irritable|grumpy|cranky)\b/i, 'Irritable'],
  [/\bbored\b/i, 'Bored'],
];
const LINKING_RE = /\b(?:was|were|is|are|seemed|seems|looked|looks|felt|feels|feeling|stayed|remained|became|got)\s+(?:very |really |so |a bit |a little |kind of |pretty |quite |more |very very )?$/i;

function moodsOf(s: string): string[] {
  const found: string[] = [];
  if (/\bin a (?:good|great|nice|happy) mood\b/i.test(s) && !/\bnot in a\b/i.test(s)) found.push('Happy');
  for (const [re, mood] of MOOD_WORDS.slice(1)) {
    const g = new RegExp(re.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = g.exec(s))) {
      const before = s.slice(Math.max(0, m.index - 30), m.index);
      if (!LINKING_RE.test(before)) continue;
      if (/\b(?:not|n't|never|no)\s+(?:\w+\s+)?$/i.test(before) || /n't\s+(?:\w+\s+)?$/i.test(before)) continue;
      if (!found.includes(mood)) found.push(mood);
    }
  }
  return found.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Professional wording
// ---------------------------------------------------------------------------
const PAST: Record<string, string> = {
  go: 'went', goes: 'went', come: 'came', comes: 'came', eat: 'ate', eats: 'ate', take: 'took', takes: 'took', make: 'made',
  makes: 'made', have: 'had', has: 'had', do: 'did', does: 'did', sleep: 'slept', sleeps: 'slept', wake: 'woke', wakes: 'woke',
  get: 'got', gets: 'got', give: 'gave', gives: 'gave', buy: 'bought', buys: 'bought', drink: 'drank', drinks: 'drank',
  sit: 'sat', sits: 'sat', draw: 'drew', draws: 'drew', bring: 'brought', brings: 'brought', see: 'saw', sees: 'saw',
  say: 'said', says: 'said', tell: 'told', tells: 'told', feel: 'felt', feels: 'felt', leave: 'left', leaves: 'left',
  watch: 'watched', watches: 'watched', play: 'played', plays: 'played', cook: 'cooked', cooks: 'cooked', clean: 'cleaned',
  cleans: 'cleaned', help: 'helped', helps: 'helped', walk: 'walked', walks: 'walked', enjoy: 'enjoyed', enjoys: 'enjoyed',
  stay: 'stayed', stays: 'stayed', call: 'called', calls: 'called', visit: 'visited', visits: 'visited', finish: 'finished',
  finishes: 'finished', start: 'started', starts: 'started', use: 'used', uses: 'used', is: 'was', are: 'were', wash: 'washed',
  washes: 'washed', shower: 'showered', showers: 'showered', brush: 'brushed', brushes: 'brushed', relax: 'relaxed',
  relaxes: 'relaxed', listen: 'listened', listens: 'listened', spend: 'spent', spends: 'spent', attend: 'attended', attends: 'attended',
};
const HEDGE_RE = /^(?:i think|i believe|i guess|i feel like|i noticed that|i noticed|i saw that|i remember)\s+/i;
const LEAD_RE = /^(?:so|and|but|then|also|okay|ok|alright|all right|well|yeah|yes|now|um+|uh+|like|plus)\b[\s,]*/i;
/** A leading time phrase stays in the sentence; the subject after it is resolved. */
const LEAD_TIME_RE = /^((?:(?:in|during) the (?:morning|afternoon|evening|night|day)|at (?:night|noon|lunch ?time|dinner ?time|breakfast|bed ?time)|after (?:dinner|lunch|breakfast|that|day program|program|the program|his program|day support)|before (?:bed|dinner|lunch|breakfast|bed ?time)|this (?:morning|afternoon|evening)|later(?: on)?|tonight|last night|at \d{1,2}:\d{2} [AP]M)\s*,?\s+)/i;
const SKIP_RE = /^(?:that'?s (?:it|all)|thank you|thanks|bye|goodbye|good night|okay|ok|hello|hi|hey|this is \w+|that is all|nothing else|see you)\b/i;
const HALLUCINATION_RE = /thanks? for watching|subscribe|subtitles|amara\.org|transcribed by|www\./i;

/** The clause after leading fillers, dates and time phrases: where its grammatical subject starts. */
function clauseStart(sentence: string): string {
  let t = sentence.trim();
  for (let i = 0; i < 4; i++) t = t.replace(LEAD_RE, '');
  t = t.replace(LEADING_DATE_RE, '');
  for (let i = 0; i < 4; i++) t = t.replace(LEAD_RE, '');
  return t.replace(HEDGE_RE, '').replace(LEAD_TIME_RE, '').trim();
}

function professional(sentence: string, who: string[], people: VoicePerson[], subjectId?: string): string {
  const byId = new Map(people.map((p) => [p.id, p]));
  const names = who.map((id) => byId.get(id)?.first ?? id);
  const joined = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] ?? '';
  const single = subjectId ? byId.get(subjectId)?.first ?? subjectId : names.length === 1 ? names[0] : undefined;
  let t = sentence.trim();
  for (let i = 0; i < 4; i++) t = t.replace(LEAD_RE, '');
  t = t.replace(LEADING_DATE_RE, '');
  for (let i = 0; i < 4; i++) t = t.replace(LEAD_RE, '');
  t = t
    .replace(HEDGE_RE, '')
    .replace(/\b(?:um+|uh+|erm+|hmm+)\b,?\s*/gi, '')
    .replace(/,?\s*\byou know\b,?/gi, '')
    .replace(/\bI mean\b,?\s*/g, '')
    .replace(/,\s*like,\s*/gi, ', ')
    .replace(/\bbasically\b,?\s*/gi, '');
  // Canonical names: "Stevie", "Jay", "Jarrell" -> the everyday name in the log.
  for (const p of people) {
    for (const alias of p.aliases) {
      if (alias && alias.toLowerCase() !== p.first.toLowerCase()) t = t.replace(new RegExp(`\\b${esc(alias)}\\b`, 'gi'), p.first);
    }
  }
  const lead = LEAD_TIME_RE.exec(t)?.[1] ?? '';
  let rest = t.slice(lead.length);
  // Spoken topic + pronoun: "Jerrell, he went" -> "Jerrell went".
  const nameAlt = people.map((p) => esc(p.first)).join('|');
  if (nameAlt) rest = rest.replace(new RegExp(`^((?:${nameAlt})(?:\\s+and\\s+(?:${nameAlt}))?)\\s*,?\\s+(?:he|she|they)\\b`, 'i'), '$1');
  // Pronoun subjects -> names, first person -> staff.
  if (single) rest = rest.replace(/^he\b/i, single).replace(/^his\b/i, `${single}'s`);
  if (names.length > 1) rest = rest.replace(/^(?:both of them|the two of them|they both|the guys|the boys|they|both)\b/i, joined);
  rest = rest.replace(/^we\b/i, names.length > 1 ? `Staff, ${joined}` : joined ? `Staff and ${joined}` : 'Staff').replace(/^I\b/, 'Staff');
  // Shared activities need a group cue ("housemate"/"together") or the form says "no group activity".
  if (names.length > 1 && !/\b(?:together|housemates?|roommates?|both|each other|everyone|peers?)\b/i.test(rest)) {
    const others = names.filter((n) => n !== single);
    const withOther = new RegExp(`\\bwith (${others.map(esc).join('|')})\\b`);
    if (single && withOther.test(rest)) rest = rest.replace(withOther, 'with his housemate $1');
    else if (rest.startsWith(joined)) rest = rest.replace(/^([^,.;!?]*?)([,.;!?]|$)/, (_m, clause: string, end: string) => `${clause.trimEnd()} together${end}`);
  }
  t = `${lead}${rest}`
    .replace(/\bI\b/g, 'staff')
    .replace(/\bme\b/g, 'staff')
    .replace(/\bmy\b/gi, 'the')
    .replace(/\bwe\b/gi, 'staff')
    .replace(/\bus\b/g, 'staff')
    .replace(/\bour\b/gi, 'the');
  // Plain past tense after a subject ("he go to the store" -> "he went to the store").
  const subjects = ['he', 'she', 'they', 'staff', ...people.map((p) => p.first)].map(esc).join('|');
  t = t.replace(new RegExp(`\\b(${subjects})\\s+(${Object.keys(PAST).join('|')})\\b`, 'gi'), (whole, s: string, verb: string) => {
    const next = PAST[verb.toLowerCase()];
    return next ? `${s} ${next}` : whole;
  });
  t = t
    .replace(/\b(\w+)(?:\s+\1\b)+/gi, '$1')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/,\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!t) return '';
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (!/[.!?]$/.test(t)) t += '.';
  return t;
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------
/** Topics (routine lines it replaces), moods, review flags and program attendance of one sentence. */
export function classifySentence(sentence: string): Pick<VoiceItem, 'topics' | 'moods' | 'flags' | 'program'> {
  const topics = TOPIC_RULES.filter(([, re]) => re.test(sentence)).map(([topic]) => topic);
  let program: VoiceItem['program'];
  if (!NOT_STARTED_RE.test(sentence)) {
    if (HOME_RE.test(sentence)) program = 'home';
    else if (ATTEND_RE.test(sentence)) program = 'attended';
  }
  if (program === 'attended') topics.push('program');
  const flags: VoiceItem['flags'] = [];
  if (HEALTH_RE.test(sentence.replace(NO_SEIZURE_RE, ''))) flags.push('health');
  if (BEHAVIOR_RE.test(sentence)) flags.push('behavior');
  if (INCIDENT_RE.test(sentence)) flags.push('incident');
  return { topics: [...new Set(topics)], moods: moodsOf(sentence), flags, program };
}

export function parseTranscript(raw: string, options: ParseOptions): ParseResult {
  const people = options.people;
  const allIds = people.map((p) => p.id);
  const patterns = people.map((p) => ({
    id: p.id,
    re: new RegExp(`\\b(?:${[p.first, ...p.aliases].filter(Boolean).map(esc).join('|')})(?:'s)?\\b`, 'i'),
  }));
  const sentences = splitSentences(normalize(raw, options.corrections ?? []));
  const ctx: DateContext = { current: options.referenceDate, reference: options.referenceDate, explicit: false };
  let dateReason = 'date of the note';
  let shift: ShiftKind | undefined;
  let shiftReason = '';
  let subject: string[] = [];
  let lastSingle: string | undefined;
  const items: VoiceItem[] = [];
  const skipped: string[] = [];

  for (const sentence of sentences) {
    const marker = findDate(sentence, ctx);
    if (marker) {
      if (marker.date !== ctx.current) {
        shift = undefined;
        shiftReason = '';
      }
      ctx.current = marker.date;
      ctx.explicit = ctx.explicit || marker.explicit;
      dateReason = marker.reason;
    }

    const named = patterns.filter((p) => p.re.test(sentence)).map((p) => p.id);
    const bare = clauseStart(sentence);
    const startsWith = patterns.find((p) => new RegExp(`^${p.re.source.slice(2)}`, 'i').test(bare))?.id;
    let who: string[];
    let subjectId: string | undefined;
    if (named.length >= 2) {
      who = named;
      subjectId = /^(?:\S+\s+and\s+|both\b)/i.test(bare.replace(/^\S+\s*,\s*/, '')) ? undefined : startsWith;
    } else if (named.length === 1) {
      if (/^(?:he|his)\b/i.test(bare) && lastSingle && lastSingle !== named[0]) {
        // "he played dominoes with Jerrell": the subject is the person we were talking about, and both were involved.
        who = allIds.filter((id) => id === lastSingle || id === named[0]);
        subjectId = lastSingle;
      } else {
        who = TOGETHER_RE.test(sentence) && allIds.length > 1 ? allIds : named;
        subjectId = named[0];
      }
    } else if (BOTH_RE.test(sentence) && allIds.length > 1) who = allIds;
    else if (HE_RE.test(sentence)) who = lastSingle ? [lastSingle] : subject.length ? subject : allIds;
    else who = subject.length ? subject : allIds;
    if (!subjectId && who.length === 1) subjectId = who[0];
    if (subjectId) lastSingle = subjectId;
    subject = who;

    const detected = detectShift(sentence);
    if (detected) {
      shift = detected.shift;
      shiftReason = detected.reason;
    }

    const text = professional(sentence, who, people, subjectId);
    const words = text.split(/\s+/).filter(Boolean).length;
    if (!text || words < 3 || SKIP_RE.test(text) || HALLUCINATION_RE.test(text)) {
      skipped.push(sentence);
      continue;
    }

    const { topics, moods, flags, program } = classifySentence(sentence);

    items.push({
      id: `i${items.length + 1}`,
      date: ctx.current,
      people: who,
      ...(subjectId && who.length > 1 ? { subject: subjectId } : {}),
      shift: shift ?? 'day',
      text,
      original: sentence,
      topics,
      moods,
      ...(moods.length && /\b(?:all day|the whole day|the entire day|all the day)\b/i.test(sentence) ? { moodAllDay: true } : {}),
      ...(program && who.length === 1 ? { program } : {}),
      flags,
      dateReason,
      shiftReason: shiftReason || 'no time mentioned (day box)',
    });
  }
  return { items, skipped };
}

/** The sentence as it should read in one person's log ("Steve and Jerrell" -> "Jerrell and Steve" for Jerrell). */
export function textFor(item: VoiceItem, personId: string, people: VoicePerson[]): string {
  if (item.people.length < 2) return item.text;
  const me = people.find((p) => p.id === personId)?.first;
  if (!me) return item.text;
  const others = item.people.filter((id) => id !== personId).map((id) => people.find((p) => p.id === id)?.first).filter(Boolean) as string[];
  const pair = new RegExp(`\\b${others.map(esc).join(', ')} and ${esc(me)}\\b`);
  return item.text.replace(pair, `${me} and ${others.join(', ')}`);
}

/** Detects a date in a Telegram / WhatsApp voice file name. */
export function dateFromFileName(name: string): string | undefined {
  let m = /(20\d{2})-(\d{2})-(\d{2})[_ T]\d{2}-\d{2}-\d{2}/.exec(name);
  if (m) return makeDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = /@(\d{2})-(\d{2})-(20\d{2})_\d{2}-\d{2}-\d{2}/.exec(name);
  if (m) return makeDate(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  m = /(?:PTT|AUD)-(20\d{2})(\d{2})(\d{2})-WA/i.exec(name);
  if (m) return makeDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = /(20\d{2})[-_]?(\d{2})[-_]?(\d{2})/.exec(name);
  if (m) return makeDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return undefined;
}
