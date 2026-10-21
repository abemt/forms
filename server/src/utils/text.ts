import crypto from 'node:crypto';

export function sha256(data: string | Uint8Array): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** Collapse whitespace and lowercase — used for fuzzy containment checks. */
export function normalize(text: string): string {
  return text
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Replace characters that cannot be encoded in WinAnsi (pdf-lib standard fonts). */
export function toWinAnsi(text: string): string {
  return text
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u2022/g, '-')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/[^\x00-\xff]/g, '?');
}

/** True when `needle` appears in `haystack` after whitespace/case normalization. */
export function looseIncludes(haystack: string, needle: string): boolean {
  const h = normalize(haystack);
  const n = normalize(needle);
  if (!n) return false;
  return h.includes(n);
}

/** Fraction of `needle` word-tokens present in `haystack` (0..1). */
export function tokenOverlap(haystack: string, needle: string): number {
  const tokens = normalize(needle)
    .split(/[^a-z0-9']+/)
    .filter((t) => t.length > 2);
  if (tokens.length === 0) return 0;
  const h = normalize(haystack);
  let hit = 0;
  for (const t of tokens) if (h.includes(t)) hit++;
  return hit / tokens.length;
}

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

export interface ParsedDate {
  year: number;
  month: number; // 1-12
  day: number;
}

/** Parse dates in the formats commonly found in shift logs. Returns null when unsure. */
export function parseDateLoose(raw: string): ParsedDate | null {
  const text = raw.trim();
  // "May 01, 2026", "May 1 2026" (optionally with weekday suffixes/prefixes)
  let m = text.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/);
  if (m) {
    const month = MONTHS.findIndex((name) => name.startsWith(m![1].toLowerCase())) + 1;
    if (month > 0) {
      const day = Number(m[2]);
      const year = Number(m[3]);
      if (day >= 1 && day <= 31) return { year, month, day };
    }
  }
  // "05/01/2026", "5-1-2026"
  m = text.match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (m) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    const year = Number(m[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return { year, month, day };
  }
  // "2026-05-01"
  m = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return { year, month, day };
  }
  return null;
}

/** Derive a label like "May2026" from the most common month among shift dates. */
export function monthLabelFromDates(dates: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const raw of dates) {
    const parsed = parseDateLoose(raw);
    if (!parsed) continue;
    const key = `${parsed.year}-${parsed.month}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  if (!best) return undefined;
  const [year, month] = best.split('-').map(Number);
  const name = MONTHS[month - 1];
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}${year}`;
}

/** Comparable sort key so forms come out in chronological order when dates parse. */
export function dateSortKey(raw: string): number | null {
  const parsed = parseDateLoose(raw);
  if (!parsed) return null;
  return parsed.year * 10_000 + parsed.month * 100 + parsed.day;
}
