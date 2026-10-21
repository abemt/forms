import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { config } from '../../config.js';
import { docxParagraphs, parseForm680Spec } from '../docxTemplate.js';
import { personFromSpec, type Person } from '../local/person.js';
import { profileTemplate, type ProfileId } from '../profiles.js';
import { SHIFT_KINDS, draftSchema, settingsSchema, type BoxPreview, type LineSource, type MonthPreview, type ShiftKind, type WriterDraft, type WriterEvent, type WriterSettings } from './types.js';

const execute = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHIFT_LABEL: Record<ShiftKind, string> = { day: '8am-4pm', evening: '4pm-12am', night: '12am-8am' };

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const DEFAULT_ROSTER = {
  weekdayDay: 'Hanna Tafesse, DSP',
  weekdayEvening: 'Rahel Tafesse, DSP',
  weekdayNight: 'Nathanael Yohannes, DSP',
  weekendDay: 'Nathanael Yohannes, DSP',
  weekendEvening: 'Nathanael Yohannes, DSP',
  weekendNight: 'Nathanael Yohannes, DSP',
};

export function defaultSettings(profile: string): WriterSettings {
  if (profile === 'steven') {
    return {
      roster: DEFAULT_ROSTER,
      program: { name: 'Inner Vision Day Support', days: [1, 2, 4, 5], leaveTime: '8:30 AM', returnTime: '4:00 PM', attends: true },
      housemateProgramDays: [],
      laundryDay: 3,
      medTimes: { morning: '8:00 AM', evening: '8:00 PM' },
      weekly: { fridayMeeting: true, sundayMoney: true, saturdayGrocery: true },
      health: { seizureChecks: true, diabetes: true, gout: false, bowelWatch: false },
      housemate: 'Jerrell',
      interests: ['guitar', 'dominoes', 'movies', 'Xbox', 'walks', 'music'],
      aliases: ['Steven', 'Stevie', 'Stephen', 'Steph'],
    };
  }
  if (profile === 'jerrell') {
    return {
      roster: DEFAULT_ROSTER,
      program: { name: 'day support', days: [], leaveTime: '8:30 AM', returnTime: '4:00 PM', attends: false },
      housemateProgramDays: [1, 2, 4, 5],
      laundryDay: 4,
      medTimes: { morning: '9:00 AM', evening: '8:00 PM' },
      weekly: { fridayMeeting: true, sundayMoney: true, saturdayGrocery: true },
      health: { seizureChecks: false, diabetes: false, gout: true, bowelWatch: true },
      housemate: 'Steve',
      interests: ['drawing', 'movies', 'smoothies', 'music', 'dominoes', 'Xbox', 'walks'],
      aliases: ['Jay', 'Jerell', 'Jarrell', 'Jarell', 'Jerrel', 'Jerel', 'Jarel', 'JW', 'Gerald', 'Jerald', 'Jerold'],
    };
  }
  return {
    roster: DEFAULT_ROSTER,
    program: { name: '', days: [], leaveTime: '8:30 AM', returnTime: '4:00 PM', attends: false },
    housemateProgramDays: [],
    laundryDay: 3,
    medTimes: { morning: '8:00 AM', evening: '8:00 PM' },
    weekly: { fridayMeeting: true, sundayMoney: true, saturdayGrocery: true },
    health: { seizureChecks: false, diabetes: false, gout: false, bowelWatch: false },
    housemate: '',
    interests: ['music', 'movies', 'puzzles'],
    aliases: [],
  };
}

const settingsPath = (profile: string) => path.join(config.dataDir, 'log-writer', 'settings', `${profile}.json`);
const draftPath = (profile: string, month: string) => path.join(config.dataDir, 'log-writer', 'drafts', `${profile}-${month}.json`);

export async function loadSettings(profile: string): Promise<WriterSettings> {
  try {
    const saved = JSON.parse(await readFile(settingsPath(profile), 'utf8')) as unknown;
    return settingsSchema.parse({ ...defaultSettings(profile), ...(saved as object) });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return defaultSettings(profile);
  }
}

export async function saveSettings(profile: string, input: unknown): Promise<WriterSettings> {
  const settings = settingsSchema.parse(input);
  await mkdir(path.dirname(settingsPath(profile)), { recursive: true });
  await writeFile(settingsPath(profile), JSON.stringify(settings, null, 2));
  return settings;
}

export async function loadDraft(profile: string, month: string): Promise<WriterDraft | undefined> {
  try {
    return draftSchema.parse(JSON.parse(await readFile(draftPath(profile, month), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function saveDraft(input: unknown): Promise<WriterDraft> {
  const draft = draftSchema.parse(input);
  await mkdir(path.dirname(draftPath(draft.profileId, draft.month)), { recursive: true });
  await writeFile(draftPath(draft.profileId, draft.month), JSON.stringify(draft, null, 2));
  return draft;
}

export function buildDefaultDraft(profileId: string, month: string): WriterDraft {
  return { profileId, month, fromDay: 1, toDay: 1, closures: [], events: [], overrides: {}, sourceNotes: '' };
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------
interface DayContext {
  d: number;
  dow: number;
  weekend: boolean;
  /** Program closed today (holiday) - reason text. */
  closure?: string;
  /** Reported as a home day although the program was scheduled. */
  homeDay: boolean;
  programDay: boolean;
  nextProgramDay: boolean;
  /** The housemate is out at his own program today. */
  mateAway: boolean;
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

// ---------------------------------------------------------------------------
// Routine composition
// ---------------------------------------------------------------------------
interface Line {
  slot: string;
  text: string;
  fromEvent?: boolean;
  source?: LineSource;
}
interface Box {
  mood: string;
  lines: Line[];
  moodFromEvent: boolean;
  warnings: string[];
}

interface Voice {
  person: Person;
  settings: WriterSettings;
}

function dayBox(v: Voice, ctx: DayContext): Box {
  return { mood: '', moodFromEvent: false, lines: [], warnings: [] };
}

function eveningBox(v: Voice, ctx: DayContext): Box {
  return { mood: '', moodFromEvent: false, lines: [], warnings: [] };
}

function nightBox(v: Voice, ctx: DayContext): Box {
  return { mood: '', moodFromEvent: false, lines: [], warnings: [] };
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
interface Rendered {
  shift: ShiftKind;
  lines: string[];
  mood?: string;
  /** Slots the event stands in for. */
  replaces: string[];
  /** Insert after this slot (first match); falls back to after "meds". */
  after: string[];
  /** Insert where the first replaced routine line was (voice text keeps the box in time order). */
  inPlace?: boolean;
  assumption?: string;
  reviewWarnings?: string[];
}

function tidy(text: string): string {
  let t = text.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (!/[.!?]$/.test(t)) t += '.';
  return t;
}

const clause = (text: string) => text.replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '');

function namedSentence(name: string, details: string, fallback: string): string {
  if (!details) return fallback;
  return new RegExp(`^${name}(?:\\b|[,.:])`, 'i').test(details) ? details : `${name} ${details}`;
}

function housekeepingSentence(name: string, details: string): string {
  let text = namedSentence(name, details, `${name} completed a household chore.`);
  text = text.replace(/\btook out the trash\b/i, 'took out the household trash');
  text = text.replace(/\bwiped the kitchen counter\b/i, 'wiped down the kitchen counter');
  text = text.replace(/^(.+?)\s+after lunch\.?$/i, 'Following lunch, $1.');
  return tidy(text);
}

function reportedSentence(prefix: string, details: string): string {
  return tidy(details ? `${prefix}. ${details.charAt(0).toUpperCase()}${details.slice(1)}` : `${prefix}.`);
}

function autoShift(ev: WriterEvent, ctx: DayContext): ShiftKind {
  if (ev.shift !== 'auto') return ev.shift;
  switch (ev.kind) {
    case 'meal_out':
      return ev.meal === 'dinner' ? 'evening' : 'day';
    case 'cooked':
      return ev.meal === 'dinner' || !ev.meal ? 'evening' : 'day';
    case 'outing':
    case 'shopping':
    case 'visit':
      return ctx.programDay ? 'evening' : 'day';
    default:
      return 'day';
  }
}

function renderEvent(ev: WriterEvent, ctx: DayContext, v: Voice): Rendered {
  const name = v.person.first;
  const mate = v.settings.housemate || 'his housemate';
  const withMate = ev.withHousemate && v.settings.housemate ? ` together with ${mate}` : '';
  const place = clause(ev.place);
  const details = clause(ev.details);
  const shift = autoShift(ev, ctx);
  const dateLabel = `day ${ctx.d}`;
  switch (ev.kind) {
    case 'outing': {
      const where = place ? `to ${place}` : 'out into the community';
      return {
        shift,
        mood: ev.mood || undefined,
        replaces: shift === 'day' ? ['main', 'activity', 'solo', 'together', 'walk', 'chore'] : ['solo', 'shared', 'walk'],
        after: shift === 'day' ? ['hygiene', 'laundry', 'breakfast', 'meds'] : ['return'],
        lines: [reportedSentence(`${name} went ${where}${withMate}`, details)],
        reviewWarnings: details ? undefined : ['Review needed: outing details, support level and resident response were not documented.'],
        assumption: `${dateLabel}: outing written in the ${SHIFT_LABEL[shift]} box${ev.withHousemate ? ` with ${mate} along` : ''}.`,
      };
    }
    case 'meal_out': {
      const meal = ev.meal ?? (shift === 'evening' ? 'dinner' : 'lunch');
      return {
        shift,
        mood: ev.mood || undefined,
        replaces: meal === 'dinner' ? ['dinner'] : meal === 'lunch' ? ['lunch'] : ['breakfast'],
        after: meal === 'dinner' ? ['return'] : ['hygiene', 'laundry', 'meds'],
        lines: [reportedSentence(`${name} went out for ${meal} at ${place || 'a restaurant'}${withMate}`, details)],
        reviewWarnings: details ? undefined : ['Review needed: meal details, support level and resident response were not documented.'],
        assumption: `${dateLabel}: ${meal} out written in the ${SHIFT_LABEL[shift]} box.`,
      };
    }
    case 'shopping':
      return {
        shift,
        mood: ev.mood || undefined,
        replaces: shift === 'day' ? ['main', 'chore', 'activity'] : ['solo', 'shared'],
        after: shift === 'day' ? ['hygiene', 'laundry', 'breakfast', 'meds'] : ['return'],
        lines: [reportedSentence(`${name} went shopping${place ? ` at ${place}` : ''}${withMate}`, details)],
        reviewWarnings: details ? undefined : ['Review needed: shopping details, support level and resident response were not documented.'],
        assumption: `${dateLabel}: shopping written in the ${SHIFT_LABEL[shift]} box.`,
      };
    case 'appointment':
      return {
        shift,
        mood: ev.mood || undefined,
        replaces: shift === 'day' ? ['main', 'activity', 'chore'] : ['solo', 'shared'],
        after: shift === 'day' ? ['hygiene', 'breakfast', 'meds'] : ['return'],
        lines: [reportedSentence(`${name} attended ${place || 'an appointment'}`, details)],
        reviewWarnings: details ? undefined : ['Review needed: appointment outcome, transportation and support level were not documented.'],
        assumption: `${dateLabel}: appointment written in the ${SHIFT_LABEL[shift]} box.`,
      };
    case 'visit':
      return {
        shift,
        mood: ev.mood || undefined,
        replaces: shift === 'day' ? ['solo', 'together'] : ['solo', 'shared'],
        after: shift === 'day' ? ['lunch', 'meds'] : ['meds', 'dinner'],
        lines: [reportedSentence(`${place || 'A visitor'} came to the house to see ${name}`, details)],
        reviewWarnings: details ? undefined : ['Review needed: visit activity and resident response were not documented.'],
      };
    case 'away':
      return {
        shift,
        mood: ev.mood || undefined,
        replaces: ['*'],
        after: [],
        lines: [`${name} was away on a family visit${place ? ` with ${place}` : ''} for this shift${details ? ` (${details})` : ''}.`],
        assumption: `${dateLabel}: written as away (out of facility) for the ${SHIFT_LABEL[shift]} box.`,
      };
    case 'holiday':
    case 'home':
      return { shift: 'day', replaces: [], after: ['meds'], lines: details ? [tidy(details)] : [], mood: ev.mood || undefined };
    case 'cooked': {
      const meal = ev.meal ?? 'dinner';
      return {
        shift,
        mood: ev.mood || undefined,
        replaces: meal === 'dinner' ? ['dinner'] : meal === 'lunch' ? ['lunch'] : ['breakfast'],
        after: meal === 'dinner' ? ['return', 'meds'] : ['meds'],
        lines: [reportedSentence(`${name} cooked ${place || meal} for ${meal}`, details)],
        reviewWarnings: details ? undefined : ['Review needed: meal details and support level were not documented.'],
      };
    }
    case 'laundry':
      return {
        shift: 'day',
        replaces: ['laundry', 'chore'],
        after: ['hygiene', 'breakfast', 'meds'],
        lines: [tidy(details ? namedSentence(name, details, `${name} did laundry.`) : `${name} did laundry.`)],
        reviewWarnings: details ? undefined : ['Review needed: laundry tasks and support level were not documented.'],
      };
    case 'chore':
      return {
        shift,
        replaces: ['chore'],
        after: ['lunch', 'meds'],
        lines: [housekeepingSentence(name, details)],
        reviewWarnings: details ? undefined : ['Review needed: household task and support level were not documented.'],
      };
    case 'incident':
      return {
        shift,
        mood: ev.mood || undefined,
        replaces: [],
        after: shift === 'night' ? ['monitor'] : ['meds'],
        lines: [tidy(details || place)],
        assumption: `${dateLabel}: incident text inserted as written - review the Behavioral/Medical/Serious Incident answers on that form.`,
      };
    case 'note':
      return { shift, mood: ev.mood || undefined, replaces: [], after: shift === 'night' ? ['monitor'] : ['meds'], lines: [tidy(details || place)] };
    case 'voice':
      return {
        shift: ev.shift === 'auto' ? 'day' : ev.shift,
        mood: ev.mood || undefined,
        replaces: ev.slots ?? [],
        inPlace: true,
        after: ev.shift === 'night' ? ['monitor', 'asleep'] : ev.shift === 'evening' ? ['meds', 'dinner', 'return'] : ['meds', 'breakfast', 'ready', 'wake'],
        lines: ev.details.split('\n').map((l) => l.trim()).filter(Boolean),
      };
    case 'program':
      return { shift: 'day', replaces: [], after: ['meds'], lines: details ? [tidy(details)] : [], mood: ev.mood || undefined };
    default:
      return { shift, mood: ev.mood || undefined, replaces: [], after: shift === 'night' ? ['monitor'] : ['meds'], lines: [tidy(details || place)] };
  }
}

function applyEvent(box: Box, rendered: Rendered, source: LineSource): void {
  if (rendered.mood) {
    box.mood = rendered.mood;
    box.moodFromEvent = true;
  }
  box.warnings.push(...(rendered.reviewWarnings ?? []));
  if (rendered.lines.length === 0) return;
  const added = rendered.lines.map((text) => ({ slot: 'event', text, fromEvent: true, source }));
  if (rendered.replaces.includes('*')) {
    box.lines = added;
    return;
  }
  const drop = new Set(rendered.replaces);
  let at = rendered.inPlace ? box.lines.findIndex((l) => drop.has(l.slot)) : -1;
  box.lines = box.lines.filter((l) => !drop.has(l.slot));
  if (at < 0) {
    const anchor = rendered.after.map((slot) => box.lines.findIndex((l) => l.slot === slot)).find((i) => i >= 0);
    // No anchor found: evening events go first (before dinner), others after the second line.
    at = anchor === undefined ? (rendered.after.includes('return') ? 0 : Math.min(2, box.lines.length)) : anchor + 1;
  }
  box.lines.splice(at, 0, ...added);
}

/** Routine slots that are kept at the "essentials" level: scheduled care, not invented activity detail. */
const ESSENTIAL_SLOTS = new Set(['closure', 'ready', 'wake', 'meds', 'hydration', 'depart', 'program', 'return', 'hygiene', 'bedtime', 'asleep', 'monitor', 'sleep', 'water', 'house']);

function scheduleWarnings(settings: WriterSettings, ctx: DayContext, shift: ShiftKind, level: 'full' | 'essentials' | 'none', covered: Set<string>): string[] {
  if (level === 'none') return [];
  const warnings: string[] = [];
  const add = (slot: string, text: string) => {
    if (!covered.has(slot)) warnings.push(`Review needed: ${text} Completion not documented in the available source.`);
  };
  if (shift === 'day' && ctx.programDay) add('program', `${settings.program.name || 'Day program'} attendance was scheduled.`);
  if (shift === 'day' && settings.medTimes.morning) add('meds', `Morning medication support at ${settings.medTimes.morning} was scheduled.`);
  if (shift === 'evening' && settings.medTimes.evening) add('meds', `Evening medication support at ${settings.medTimes.evening} was scheduled.`);
  if (level === 'full' && shift === 'day' && settings.laundryDay === ctx.dow) add('laundry', 'Laundry was scheduled.');
  if (level === 'full' && shift === 'day' && ctx.dow === 6 && settings.weekly.saturdayGrocery) add('grocery', 'Weekly grocery activity was scheduled.');
  if (level === 'full' && shift === 'evening' && ctx.dow === 5 && settings.weekly.fridayMeeting) add('meeting', 'The weekly house meeting was scheduled.');
  if (level === 'full' && shift === 'evening' && ctx.dow === 0 && settings.weekly.sundayMoney) add('money', 'The weekly money-management activity was scheduled.');
  if (shift === 'night' && settings.health.seizureChecks) add('monitor', 'Overnight monitoring was configured.');
  return warnings;
}

/** Which routine slots a reported topic stands in for, per box. */
const TOPIC_SLOTS: Record<string, Partial<Record<ShiftKind, string[]>>> = {
  breakfast: { day: ['breakfast'] },
  lunch: { day: ['lunch'] },
  dinner: { evening: ['dinner'] },
  meds: { day: ['meds'], evening: ['meds'] },
  program: { day: ['depart', 'program', 'lunchbag'], evening: ['return'] },
  laundry: { day: ['laundry', 'chore'], evening: ['housekeeping'] },
  chores: { day: ['chore'], evening: ['housekeeping'] },
  hygiene: { day: ['hygiene', 'ready', 'wake'], evening: ['hygiene'] },
  outing: { day: ['main', 'activity', 'walk', 'together', 'solo', 'leisure'], evening: ['shared', 'solo', 'walk'] },
  walk: { day: ['walk'], evening: ['walk', 'shared'] },
  leisure: { day: ['solo', 'together', 'activity', 'leisure'], evening: ['solo', 'shared'] },
  bedtime: { evening: ['bedtime'] },
  sleep: { evening: ['bedtime'], night: ['asleep', 'sleep', 'wake'] },
  hydration: { day: ['hydration'], evening: ['hydration'], night: ['water'] },
  appointment: { day: ['main', 'activity', 'chore', 'depart', 'program'], evening: ['solo', 'shared'] },
  meeting: { evening: ['weekly', 'shared'] },
  money: { evening: ['weekly'] },
  grocery: { day: ['main'] },
  packlunch: { evening: ['packlunch'] },
};

export function slotsForTopics(topics: string[], shift: ShiftKind): string[] {
  return [...new Set(topics.flatMap((topic) => TOPIC_SLOTS[topic]?.[shift] ?? []))];
}

// ---------------------------------------------------------------------------
// Wording checks (what the form mapper is known to misread)
// ---------------------------------------------------------------------------
const CHECKS: { pattern: RegExp; message: string; kinds?: Set<string> }[] = [
  { pattern: /\btalk(?:ed|ing|s)? about\b/i, message: '"talked about" reads as a plan, not something that happened - use "chatted about" or "told staff about".' },
  { pattern: /\bday off\b/i, message: '"day off" next to a program word reads as a declined outing - describe the home day instead.' },
  { pattern: /\bstayed home\b[^.\n]*\b(?:day support|day program|program)\b/i, message: '"stayed home" + the program name reads as a declined outing.' },
  { pattern: /\b(?:sore|in pain|hurt|injur\w*|bleed\w*|fever|vomit\w*|felt sick|was sick|dizzy|swollen|complained)\b/i, message: 'health wording - the form will answer Medical Complaints = Yes.' },
  { pattern: /\b(?:upset|angry|argu\w*|yell\w*|refus\w*|fight|fought|punch\w*|scream\w*|cried|aggressi\w*|meltdown)\b/i, message: 'behavior wording - the form will answer Behavioral Difficulty = Yes.' },
  { pattern: /\b(?:911|ambulance|hospital|police|incident report|emergency|elope\w*|went missing)\b/i, message: 'incident wording - the form will answer Serious Incident = Yes.' },
  { pattern: /\btrips?\b/i, message: '"trip" lands in the fall-risk section - say "outing".' },
  { pattern: /\bswallow\w*/i, message: '"swallow" lands in the aspiration section.' },
  { pattern: /\bglasses\b/i, message: '"glasses" lands in the adaptive-equipment section - say "cups".' },
  { pattern: /\b(?:listen\w*|asked)\b/i, message: '"listened"/"asked" land in the communication section.' },
  { pattern: /\b(?:with his family|family visit|at the hospital|did not come back)\b/i, message: 'reads as absent for the whole shift (all supports become Out of Facility).' },
  { pattern: /\b(?:declined|refused|chose not to|did not want)\b/i, message: 'reads as "Choose not to complete" for the matching support.' },
];

function checkWording(text: string, eventKinds: Set<string>): string[] {
  const out: string[] = [];
  for (const check of CHECKS) {
    if (!check.pattern.test(text)) continue;
    if (eventKinds.has('incident') && /Medical Complaints|Behavioral|Serious Incident/.test(check.message)) continue;
    if (eventKinds.has('away') && /absent for the whole shift/.test(check.message)) continue;
    out.push(check.message);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Month assembly
// ---------------------------------------------------------------------------
export interface ComposeInput {
  draft: WriterDraft;
  settings: WriterSettings;
  person: Person;
}

export function composeMonth({ draft, settings, person }: ComposeInput): MonthPreview {
  const [year, monthNumber] = draft.month.split('-').map(Number);
  const monthIndex = monthNumber - 1;
  const total = daysInMonth(year, monthIndex);
  const fromDay = Math.max(1, Math.min(draft.fromDay, total));
  const toDay = Math.max(fromDay, Math.min(draft.toDay, total));
  const voice: Voice = { person, settings };
  const closures = new Map(draft.closures.map((c) => [c.day, c.reason || 'holiday']));
  for (const ev of draft.events) if (ev.kind === 'holiday' && !closures.has(ev.day)) closures.set(ev.day, clause(ev.place) || 'holiday');
  const homeDays = new Set(draft.events.filter((ev) => ev.kind === 'home' || ev.kind === 'appointment' || ev.kind === 'away').map((ev) => ev.day));
  const attendedDays = new Set(draft.events.filter((ev) => ev.kind === 'program').map((ev) => ev.day));
  const level = draft.routineLevel ?? 'full';

  const dowOf = (d: number) => new Date(Date.UTC(year, monthIndex, d)).getUTCDay();
  // Works past the end of the month too (Date.UTC rolls over), so the last
  // evening still packs a lunch when the 1st of next month is a program day.
  const scheduled = (d: number) =>
    attendedDays.has(d) || (settings.program.attends && settings.program.days.includes(dowOf(d)) && !closures.has(d));
  const context = (d: number): DayContext => {
    const dow = dowOf(d);
    return {
      d,
      dow,
      weekend: dow === 0 || dow === 6,
      closure: closures.get(d),
      homeDay: homeDays.has(d),
      programDay: scheduled(d) && !homeDays.has(d),
      nextProgramDay: scheduled(d + 1) && !homeDays.has(d + 1),
      mateAway: settings.housemateProgramDays.includes(dow) && !closures.has(d),
    };
  };

  const assumptions: string[] = [];
  const boxes: BoxPreview[] = [];
  for (let d = fromDay; d <= toDay; d++) {
    const ctx = context(d);
    const date = `${MONTH_NAMES[monthIndex]} ${String(d).padStart(2, '0')}, ${year}`;
    const built: Record<ShiftKind, Box> = { day: dayBox(voice, ctx), evening: eveningBox(voice, ctx), night: nightBox(voice, ctx) };
    const kindsByShift: Record<ShiftKind, Set<string>> = { day: new Set(), evening: new Set(), night: new Set() };
    const coveredByShift: Record<ShiftKind, Set<string>> = { day: new Set(), evening: new Set(), night: new Set() };
    if (ctx.closure) assumptions.push(`${MONTH_NAMES[monthIndex]} ${d}: written as a home day (program closed: ${ctx.closure}).`);
    if (homeDays.has(d) && scheduled(d)) assumptions.push(`${MONTH_NAMES[monthIndex]} ${d}: written as a home day although ${settings.program.name || 'the day program'} was scheduled.`);
    for (const ev of draft.events.filter((e) => e.day === d)) {
      // "Away" with automatic placement covers the whole day; everything else lands in one box.
      const targets: (ShiftKind | undefined)[] = ev.kind === 'away' && ev.shift === 'auto' ? SHIFT_KINDS : [undefined];
      for (const forced of targets) {
        const rendered = renderEvent(forced ? { ...ev, shift: forced } : ev, ctx, voice);
        applyEvent(built[rendered.shift], rendered, ev.kind === 'voice' ? 'voice' : 'event');
        kindsByShift[rendered.shift].add(ev.kind);
        rendered.replaces.forEach((slot) => coveredByShift[rendered.shift].add(slot));
        if (ev.kind === 'program' || ev.kind === 'home') coveredByShift[rendered.shift].add('program');
        if (ev.kind === 'laundry') coveredByShift[rendered.shift].add('laundry');
        if (ev.kind === 'shopping') coveredByShift[rendered.shift].add('grocery');
        if (ev.kind === 'appointment') coveredByShift[rendered.shift].add('appointment');
        if (ev.kind === 'incident') coveredByShift[rendered.shift].add('incident');
        if (rendered.assumption) assumptions.push(rendered.assumption.replace(/^day \d+/, `${MONTH_NAMES[monthIndex]} ${d}`));
      }
    }
    if (level !== 'full') {
      for (const shift of SHIFT_KINDS) {
        built[shift].lines = built[shift].lines.filter((l) => l.fromEvent || (level === 'essentials' && ESSENTIAL_SLOTS.has(l.slot)));
      }
    }
    for (const shift of SHIFT_KINDS) {
      const box = built[shift];
      const override = draft.overrides[`${d}|${shift}`];
      const mood = override?.mood ?? box.mood;
      const notes = override?.notes ?? box.lines.map((l) => l.text).join('\n');
      const lines = override?.notes !== undefined
        ? notes.split('\n').filter(Boolean).map((text) => ({ text, source: 'edited' as const }))
        : box.lines.map((l) => ({ text: l.text, source: l.source ?? ('routine' as const) }));
      boxes.push({
        day: d,
        date,
        weekday: WEEKDAYS[ctx.dow],
        shift,
        shiftLabel: SHIFT_LABEL[shift],
        provider: providerFor(settings, ctx.weekend, shift),
        mood,
        notes,
        lines,
        eventLines: box.lines.filter((l) => l.source === 'event').length,
        voiceLines: box.lines.filter((l) => l.source === 'voice').length,
        warnings: [...new Set([...box.warnings, ...scheduleWarnings(settings, ctx, shift, level, coveredByShift[shift]), ...checkWording(`${mood}\n${notes}`, kindsByShift[shift])])],
        edited: Boolean(override),
      });
    }
  }
  if (settings.housemate) assumptions.push(`Shared afternoons and evenings assume ${settings.housemate} was home; the two logs must be generated with the same events.`);
  if (toDay < total) assumptions.push(`${MONTH_NAMES[monthIndex]} ${toDay + 1}-${total} are not written yet.`);
  return {
    profileId: draft.profileId,
    individualName: person.full || person.first,
    month: draft.month,
    monthName: MONTH_NAMES[monthIndex],
    year,
    fromDay,
    toDay,
    boxes,
    assumptions: [...new Set(assumptions)],
  };
}

export function providerFor(settings: WriterSettings, weekend: boolean, shift: ShiftKind): string {
  const r = settings.roster;
  if (weekend) return shift === 'day' ? r.weekendDay : shift === 'evening' ? r.weekendEvening : r.weekendNight;
  return shift === 'day' ? r.weekdayDay : shift === 'evening' ? r.weekdayEvening : r.weekdayNight;
}

// ---------------------------------------------------------------------------
// Word workbook
// ---------------------------------------------------------------------------
export async function personForProfile(profile: ProfileId): Promise<{ person: Person; individualId: string }> {
  const spec = parseForm680Spec(docxParagraphs(await profileTemplate(profile, 'daily')));
  return { person: personFromSpec(spec), individualId: spec.individualId ?? '' };
}

export async function buildFilledWorkbook(preview: MonthPreview, settings: WriterSettings, person: Person, individualId: string): Promise<Uint8Array> {
  const [year, monthNumber] = preview.month.split('-').map(Number);
  const total = daysInMonth(year, monthNumber - 1);
  const fill: Record<string, Partial<Record<ShiftKind, { mood: string; notes: string }>>> = {};
  const providers: Record<string, Partial<Record<ShiftKind, string>>> = {};
  for (const box of preview.boxes) {
    const heading = `${box.date} (${box.weekday})`;
    (fill[heading] ??= {})[box.shift] = { mood: box.mood, notes: box.notes };
    (providers[heading] ??= {})[box.shift] = box.provider;
  }
  const partial = preview.fromDay > 1 || preview.toDay < total;
  const payload = {
    month: { name: preview.monthName, year, days: preview.toDay, ...(partial ? { firstDay: preview.fromDay } : {}) },
    profile: preview.profileId,
    individual: {
      first: person.first,
      header: `Individual Supported: ${preview.individualName} | ID Number: ${individualId}`,
      info: '',
      keywords: 'observed activities, staff supports, medication records, meals, hygiene, appointments, and safety concerns',
      roster: settings.roster,
    },
    fill,
    providers,
  };
  const directory = await mkdtemp(path.join(os.tmpdir(), 'joy-logwriter-'));
  try {
    const input = path.join(directory, 'fill.json');
    const output = path.join(directory, 'workbook.docx');
    await writeFile(input, JSON.stringify(payload));
    await execute(process.execPath, [path.join(root, 'scripts', 'site-workbook-fill.mjs'), input, output], { cwd: root, timeout: 60_000 });
    return new Uint8Array(await readFile(output));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function workbookFileName(preview: MonthPreview): string {
  const first = (preview.individualName.match(/[A-Za-z]+/)?.[0] ?? 'Individual').replace(/[^A-Za-z]/g, '');
  const [year, monthNumber] = preview.month.split('-').map(Number);
  const partial = preview.fromDay > 1 || preview.toDay < daysInMonth(year, monthNumber - 1);
  const range = partial ? `_${preview.monthName.slice(0, 3)}${preview.fromDay}-${preview.toDay}` : '';
  return `${first}_${preview.monthName}${year}${range}_Daily_Log_Entry (filled).docx`;
}
