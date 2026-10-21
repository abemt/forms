import type { ShiftDraft } from '../../types.js';
import { createLogger } from '../../logger.js';

const log = createLogger('local-extract');

/**
 * Deterministic, zero-cost shift extraction — no AI involved.
 *
 * Parses the report line by line, recognizing the common structure of
 * residential-care shift logs:
 *
 *   May 01, 2026 (Friday)                       <- date heading (variants OK)
 *   Shift (Start and End Time): 8am-4pm         <- shift heading
 *   Assigned Provider: X, DSP | Observed Mood: Happy, Chatty
 *   <narrative paragraph(s) until the next heading>
 *
 * Wording variations ("Shift:", "Provider:", separate mood line, date headings
 * with status suffixes) are handled. Everything is taken verbatim from the
 * document; nothing is invented.
 */

const MONTHS =
  'January|February|March|April|May|June|July|August|September|October|November|December';

/** "May 01, 2026 (Friday)" / "May 16, 2026 (Saturday) - Status: ..." / "5/16/2026" */
const DATE_HEADING = new RegExp(
  `^((?:${MONTHS})\\s+\\d{1,2},\\s*\\d{4}|\\d{1,2}/\\d{1,2}/\\d{2,4}|\\d{4}-\\d{2}-\\d{2})` +
    `\\s*(?:\\([A-Za-z]+\\))?\\s*(?:[-–—].*)?$`,
);

/** "Shift (Start and End Time): 8am-4pm" / "Shift Time: ..." / "Shift: ..." */
const SHIFT_HEADING = /^Shift\b[^:]{0,40}:\s*(.+)$/i;

/** Binder style: "Day Shift (8:00 AM – 4:00 PM)" — named shifts map to the standard grid. */
const SHIFT_HEADING_NAMED = /^(Day|Morning|Evening|Afternoon|Overnight|Night)\s+Shift\s*(?:\(([^)]*)\))?\s*:?\s*$/i;
const NAMED_SHIFT_TIMES: Record<string, string> = {
  day: '8am-4pm',
  morning: '8am-4pm',
  evening: '4pm-12am',
  afternoon: '4pm-12am',
  overnight: '12am-8am',
  night: '12am-8am',
};

/** "Assigned Provider: Hana Tafesse, DSP | Observed Mood: Easygoing, Chatty" */
const PROVIDER_AND_MOOD =
  /^(?:Assigned\s+)?(?:Provider|Staff(?:\s+Name)?|DSP)\s*:\s*(.+?)\s*\|\s*(?:Observed\s+)?Mood\s*:\s*(.+)$/i;
const PROVIDER_ONLY = /^(?:Assigned\s+)?(?:Provider|Staff(?:\s+Name)?|DSP)\s*:\s*(.+)$/i;
const MOOD_ONLY = /^(?:Observed\s+)?Mood(?:s)?(?:\s+Observed)?\s*:\s*(.+)$/i;

/**
 * Entry-workbook labels: an untouched box leaves its label on a line by
 * itself ("Observed Mood:", "Notes — what Steve did this shift:") — these
 * carry no data and must not leak into the narrative.
 */
const EMPTY_LABEL =
  /^(?:(?:Assigned\s+)?(?:Provider|Staff(?:\s+Name)?|DSP)|(?:Observed\s+)?Moods?(?:\s+Observed)?|Notes[^:]{0,60})\s*:$/i;

/** "Notes — what Steve did this shift: Steve woke..." -> keep only the notes text. */
const NOTES_PREFIX = /^Notes[^:]{0,60}:\s*/i;

/**
 * All-caps signature/attestation heading ends the shift entries. Prose
 * mentions ("…on the final signature page.") must not trigger it, so the
 * line itself must be upper-case.
 */
const END_MARKER = /SIGNATURE\s*&?\s*ATTESTATION|ATTESTATION\s+KEY|SIGNATURE\s+PAGE/i;

function isEndMarker(line: string): boolean {
  return END_MARKER.test(line) && line === line.toUpperCase();
}

export interface ExtractOptions {
  /**
   * True when every line is a real paragraph (Word logs). Note lines are then
   * kept apart so each one reads as its own sentence; PDF lines are visual
   * wraps and are joined with spaces instead.
   */
  paragraphLines?: boolean;
  /** Receives the pre-printed shift boxes that were left completely blank. */
  skipped?: BlankBox[];
}

/** A shift box with no mood and no notes; `position` = where it sat among the kept shifts. */
export interface BlankBox {
  date: string;
  shift: string;
  provider: string;
  position: number;
}

export function extractShiftsLocally(pages: string[], options: ExtractOptions = {}): ShiftDraft[] {
  const shifts: ShiftDraft[] = [];
  const joiner = options.paragraphLines ? '\n' : ' ';
  let date = '';
  let current: (Omit<ShiftDraft, 'narrative'> & { narrative: string[] }) | null = null;

  const push = (): void => {
    // Keep only shifts that carry observations. Pre-printed workbook blocks
    // that were never filled in (time + pre-filled staff, but no mood and no
    // notes) are skipped so unmonitored days do not produce empty forms.
    if (current && (current.narrative.length > 0 || current.mood)) {
      shifts.push({ ...current, narrative: current.narrative.join(joiner).trim() });
    } else if (current) {
      options.skipped?.push({
        date: current.date,
        shift: current.shift,
        provider: current.provider,
        position: shifts.length,
      });
    }
    current = null;
  };

  outer: for (const pageText of pages) {
    for (const rawLine of pageText.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;

      if (isEndMarker(line)) {
        push();
        break outer;
      }

      const dateMatch = line.match(DATE_HEADING);
      if (dateMatch) {
        push();
        date = dateMatch[1].trim();
        continue;
      }

      const shiftMatch = line.match(SHIFT_HEADING);
      if (shiftMatch) {
        push();
        current = { date, shift: shiftMatch[1].trim(), provider: '', mood: '', narrative: [] };
        continue;
      }

      const namedMatch = line.match(SHIFT_HEADING_NAMED);
      if (namedMatch) {
        push();
        const canonical = NAMED_SHIFT_TIMES[namedMatch[1].toLowerCase()] ?? namedMatch[2]?.trim() ?? namedMatch[1];
        current = { date, shift: canonical, provider: '', mood: '', narrative: [] };
        continue;
      }

      if (!current) continue; // preamble / wrapped heading remainders

      if (EMPTY_LABEL.test(line)) continue; // untouched entry-workbook box

      const both = line.match(PROVIDER_AND_MOOD);
      if (both && !current.provider) {
        current.provider = both[1].trim();
        current.mood = both[2].trim();
        continue;
      }
      if (!current.provider && !current.narrative.length) {
        const prov = line.match(PROVIDER_ONLY);
        if (prov) {
          current.provider = prov[1].trim();
          continue;
        }
      }
      if (!current.mood && !current.narrative.length) {
        const mood = line.match(MOOD_ONLY);
        if (mood) {
          current.mood = mood[1].trim();
          continue;
        }
      }

      current.narrative.push(line.replace(NOTES_PREFIX, ''));
    }
  }
  push();

  log.info(`local engine extracted ${shifts.length} shift(s) from ${pages.length} page(s)`);
  return shifts;
}
