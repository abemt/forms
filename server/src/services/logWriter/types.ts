import { z } from 'zod';

/** Which of the three workbook boxes a line belongs to. */
export type ShiftKind = 'day' | 'evening' | 'night';
export const SHIFT_KINDS: ShiftKind[] = ['day', 'evening', 'night'];

/** Who covers which box. Weekend shifts are one person all day unless split. */
export const rosterSchema = z.object({
  weekdayDay: z.string().trim().min(1),
  weekdayEvening: z.string().trim().min(1),
  weekdayNight: z.string().trim().min(1),
  weekendDay: z.string().trim().min(1),
  weekendEvening: z.string().trim().min(1),
  weekendNight: z.string().trim().min(1),
});
export type Roster = z.infer<typeof rosterSchema>;

export const settingsSchema = z.object({
  roster: rosterSchema,
  program: z.object({
    /** e.g. "Inner Vision Day Support"; empty when the person has no program. */
    name: z.string().trim(),
    /** 0 = Sunday ... 6 = Saturday. Empty = no program days. */
    days: z.array(z.number().int().min(0).max(6)),
    leaveTime: z.string().trim(),
    returnTime: z.string().trim(),
    /** false = enrollment still pending (stays home while the housemate leaves). */
    attends: z.boolean(),
  }),
  /** The housemate's program days, used when this person stays home. */
  housemateProgramDays: z.array(z.number().int().min(0).max(6)),
  /** Day of week for laundry, or null for "no fixed day". */
  laundryDay: z.number().int().min(0).max(6).nullable(),
  medTimes: z.object({ morning: z.string().trim(), evening: z.string().trim() }),
  weekly: z.object({ fridayMeeting: z.boolean(), sundayMoney: z.boolean(), saturdayGrocery: z.boolean() }),
  health: z.object({ seizureChecks: z.boolean(), diabetes: z.boolean(), gout: z.boolean(), bowelWatch: z.boolean() }),
  /** Everyday name of the housemate, or empty when the person lives alone. */
  housemate: z.string().trim(),
  /** Free-text interests used by the generic library, e.g. "puzzles", "gardening". */
  interests: z.array(z.string().trim().min(1)).max(12),
  /** Other spellings of the person's name in voice notes and messages ("Jay", "Jarrell"). */
  aliases: z.array(z.string().trim().min(1)).max(20).default([]),
});
export type WriterSettings = z.infer<typeof settingsSchema>;

export const EVENT_KINDS = [
  'outing',
  'meal_out',
  'shopping',
  'appointment',
  'visit',
  'away',
  'holiday',
  'home',
  'cooked',
  'laundry',
  'chore',
  'incident',
  'note',
  /** Sentences taken from a voice note or pasted report (one block per shift box). */
  'voice',
  /** Attended the day program although it was not on the schedule. */
  'program',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const eventSchema = z.object({
  id: z.string().min(1).max(40),
  /** Day of month. */
  day: z.number().int().min(1).max(31),
  /** "auto" places the event by kind (outings in the day box, meals by meal time...). */
  shift: z.enum(['auto', 'day', 'evening', 'night']),
  kind: z.enum(EVENT_KINDS),
  /** Place, person, appointment type, holiday name... depending on kind. */
  place: z.string().trim().max(120).default(''),
  /** Extra detail: what was bought, what was cooked, the outcome of a visit... */
  details: z.string().trim().max(4000).default(''),
  /** For meal_out: which meal. */
  meal: z.enum(['breakfast', 'lunch', 'dinner']).optional(),
  /** Was the housemate along? */
  withHousemate: z.boolean().default(false),
  /** Observed mood to write for that box (blank keeps the routine mood). */
  mood: z.string().trim().max(60).default(''),
  /** Routine slots this text stands in for (voice events). */
  slots: z.array(z.string().max(20)).max(30).optional(),
  /** Where it came from, e.g. "voice:<noteId>". */
  source: z.string().max(80).optional(),
});
export type WriterEvent = z.infer<typeof eventSchema>;

/** Hand edits made in the preview: full replacement of a box's mood/notes. */
export const boxOverrideSchema = z.object({ mood: z.string().max(120).optional(), notes: z.string().max(6000).optional() });

export const draftSchema = z.object({
  profileId: z.string().min(1),
  /** YYYY-MM */
  month: z.string().regex(/^20\d{2}-(?:0[1-9]|1[0-2])$/),
  /** First and last day written (inclusive). Later days wait for the next report. */
  fromDay: z.number().int().min(1).max(31),
  toDay: z.number().int().min(1).max(31),
  /** Days the day program was closed (holidays, closures). */
  closures: z.array(z.object({ day: z.number().int().min(1).max(31), reason: z.string().trim().max(80) })),
  events: z.array(eventSchema).max(400),
  /** Keyed "day|shift". */
  overrides: z.record(boxOverrideSchema).default({}),
  /** Verbatim text of the client's reports, kept with the draft for reference. */
  sourceNotes: z.string().max(200000).default(''),
  /**
   * How much routine wording fills the boxes around reported content:
    * full = warnings for all configured routine schedules, essentials = warnings
    * for essential scheduled care, none = only reported content. Missing = full.
   */
  routineLevel: z.enum(['full', 'essentials', 'none']).optional(),
});
export type WriterDraft = z.infer<typeof draftSchema>;
export type RoutineLevel = NonNullable<WriterDraft['routineLevel']>;
export type LineSource = 'routine' | 'event' | 'voice' | 'edited';

export interface BoxPreview {
  day: number;
  date: string;
  weekday: string;
  shift: ShiftKind;
  shiftLabel: string;
  provider: string;
  mood: string;
  notes: string;
  /** The notes line by line with where each line came from. */
  lines: { text: string; source: LineSource }[];
  /** Lines that came from events rather than routine. */
  eventLines: number;
  /** Lines that came from voice notes / pasted reports. */
  voiceLines: number;
  /** Wording and evidence gaps that require staff review. */
  warnings: string[];
  edited: boolean;
}

export interface MonthPreview {
  profileId: string;
  individualName: string;
  month: string;
  monthName: string;
  year: number;
  fromDay: number;
  toDay: number;
  boxes: BoxPreview[];
  /** Assumptions the routine made that the reviewer should confirm. */
  assumptions: string[];
}
