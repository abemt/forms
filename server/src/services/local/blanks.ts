import type { ShiftDraft } from '../../types.js';
import type { BlankBox } from './extractor.js';
import type { Form680Spec } from '../template680.js';
import { nameRegex, personFromSpec, withName } from './person.js';

/**
 * Completes shift boxes that staff left completely blank.
 *
 * A run of blank boxes is treated as an ABSENCE when the notes around it say
 * so — the last written shift before the run mentions leaving (dad picked him
 * up, going to visit family, for the weekend...) and/or the first written
 * shift after it mentions coming back. Those boxes become "out of facility"
 * forms that claim no care. Any other blank box is a HOME shift nobody wrote
 * up; it becomes a routine shift that the completion policy fills in, per the
 * agency's instruction to complete the remaining fields.
 */

export type BlankKind = 'away' | 'home';

export interface BlankFill {
  date: string;
  shift: string;
  provider: string;
  kind: BlankKind;
}

/** Preserve blank workbook boxes as empty, review-only source entries. */
export function includeBlankShifts(drafts: ShiftDraft[], blanks: BlankBox[]): ShiftDraft[] {
  if (blanks.length === 0) return drafts;
  const byPosition = new Map<number, BlankBox[]>();
  for (const blank of blanks) byPosition.set(blank.position, [...(byPosition.get(blank.position) ?? []), blank]);
  const combined: ShiftDraft[] = [];
  for (let position = 0; position <= drafts.length; position++) {
    for (const blank of byPosition.get(position) ?? []) {
      combined.push({ date: blank.date, shift: blank.shift, provider: blank.provider, mood: '', narrative: '' });
    }
    if (position < drafts.length) combined.push(drafts[position]);
  }
  return combined;
}

const DEPARTURE =
  '\\b(?:pick(?:ed)? (?:him|{name}) up|came (?:and |to )?pick|went (?:home|to (?:his |see his )?(?:family|dad|mom|mother|father|parents))|left (?:for|with) (?:his )?(?:family|dad|mom|home|fredericksburg)|(?:going|excited|exited) to (?:go )?(?:visit|see) (?:his )?(?:family|dad|mom|mother|father|parents)|visit(?:ing)? his (?:family|dad|mom|mother|father|parents)|for the weekend|family (?:visit|time|trip)|home visit|dropped (?:him )?off (?:at|with) (?:his )?(?:family|dad|mom|parents))\\b';
const RETURN =
  /\b(?:came back|come back|returned|return(?:s|ing)? (?:to|from)|back (?:to|at|in|from) the (?:group )?home|back from (?:his )?(?:family|visit|trip|weekend)|dropped (?:him )?(?:back )?(?:off )?(?:at|to) the (?:group )?home|after spending time with (?:his )?family)\b/i;

/** Blank runs at least this long count as an absence on a departure cue alone. */
const LONG_RUN = 3;

export const AWAY_NOTE = '{name} was away on a family visit for this shift.';

type Item =
  | { kind: 'real'; draft: ShiftDraft }
  | { kind: 'blank'; box: BlankBox; fill?: BlankKind };

/**
 * Merge written shifts and blank boxes back into workbook order, decide what
 * each blank run was, and return the completed draft list.
 */
export function fillBlankShifts(
  drafts: ShiftDraft[],
  blanks: BlankBox[],
  spec?: Form680Spec,
): { drafts: ShiftDraft[]; fills: BlankFill[] } {
  if (blanks.length === 0) return { drafts, fills: [] };
  const person = personFromSpec(spec);
  const departure = nameRegex(DEPARTURE, person);
  const awayNote = withName(AWAY_NOTE, person);

  const items: Item[] = [];
  const byPosition = new Map<number, BlankBox[]>();
  for (const b of blanks) byPosition.set(b.position, [...(byPosition.get(b.position) ?? []), b]);
  for (let i = 0; i <= drafts.length; i++) {
    for (const box of byPosition.get(i) ?? []) items.push({ kind: 'blank', box });
    if (i < drafts.length) items.push({ kind: 'real', draft: drafts[i] });
  }

  // Classify each run of consecutive blanks.
  let i = 0;
  while (i < items.length) {
    if (items[i].kind !== 'blank') {
      i++;
      continue;
    }
    let j = i;
    while (j < items.length && items[j].kind === 'blank') j++;
    const run = items.slice(i, j) as Extract<Item, { kind: 'blank' }>[];
    const prev = i > 0 ? (items[i - 1] as Extract<Item, { kind: 'real' }>).draft : undefined;
    const next = j < items.length ? (items[j] as Extract<Item, { kind: 'real' }>).draft : undefined;
    const leaving = prev ? departure.test(prev.narrative) : false;
    const returning = next ? RETURN.test(next.narrative) : false;
    const away = (leaving && (returning || run.length >= LONG_RUN)) || (returning && run.length >= LONG_RUN);
    for (const item of run) item.fill = away ? 'away' : 'home';
    i = j;
  }

  const fills: BlankFill[] = [];
  const completed: ShiftDraft[] = items.map((item) => {
    if (item.kind === 'real') return item.draft;
    const kind = item.fill ?? 'home';
    fills.push({ date: item.box.date, shift: item.box.shift, provider: item.box.provider, kind });
    return {
      date: item.box.date,
      shift: item.box.shift,
      provider: item.box.provider,
      mood: '',
      narrative: kind === 'away' ? awayNote : '',
    };
  });
  return { drafts: completed, fills };
}
