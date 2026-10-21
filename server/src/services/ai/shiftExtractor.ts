import type { AiClient } from './client.js';
import type { DiskCache } from '../cache.js';
import type { ShiftDraft } from '../../types.js';
import { normalize, sha256 } from '../../utils/text.js';
import { createLogger } from '../../logger.js';

const log = createLogger('extract');

const MAX_CHUNK_CHARS = 14_000;

export const EXTRACTION_SYSTEM_PROMPT = `You are a meticulous data-extraction engine for residential care / disability service provider shift logs.

TASK: EXTRACT_SHIFTS
You receive a portion of a monthly shift log. Identify EVERY individual shift entry it contains and return them as JSON.

A shift entry typically starts with a heading such as "Shift (Start and End Time): 8am-4pm", but wording and formatting vary between agencies — rely on meaning, not exact wording. A date heading (e.g. "May 01, 2026 (Friday)") usually precedes the shifts of that day and applies to every shift until the next date heading.

Return STRICT JSON of this exact shape:
{"shifts":[{"date":"","shift":"","provider":"","mood":"","narrative":""}]}

Field rules:
- "date": the calendar date of the shift exactly as written in the document (e.g. "May 01, 2026").
- "shift": the shift time range exactly as written (e.g. "8am-4pm", "7:00 AM - 3:00 PM").
- "provider": the assigned staff/provider name and title as written (e.g. "Hana Tafesse, DSP").
- "mood": the observed mood text as written (e.g. "Calm, Sleepy").
- "narrative": the COMPLETE narrative text of the shift, verbatim. Do NOT summarize, shorten or paraphrase. Include the narrative title/heading if it has one.

Hard rules:
- Include every shift whose shift heading appears in this text portion, in document order.
- Never merge two shifts. Never invent a shift. Never fabricate values.
- If a value is genuinely absent, use "" for it.
- Page markers like "[PAGE 12]" are artifacts of the input, not content.
- Output nothing except the JSON object.`;

export interface ExtractionProgress {
  (chunkIndex: number, chunkCount: number, shiftsSoFar: number): void;
}

/** Group pages into chunks below the size limit, with one page of overlap. */
export function buildChunks(pages: string[]): string[] {
  const tagged = pages.map((text, i) => `[PAGE ${i + 1}]\n${text}`);
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLen = 0;

  for (let i = 0; i < tagged.length; i++) {
    const page = tagged[i];
    if (currentLen > 0 && currentLen + page.length > MAX_CHUNK_CHARS) {
      chunks.push(current.join('\n\n'));
      // Overlap: start the next chunk with the previous page so shifts that
      // straddle a boundary are fully visible in at least one chunk.
      current = [tagged[i - 1], page];
      currentLen = tagged[i - 1].length + page.length;
    } else {
      current.push(page);
      currentLen += page.length;
    }
  }
  if (current.length > 0) chunks.push(current.join('\n\n'));
  return chunks;
}

function dedupeKey(shift: ShiftDraft): string {
  return `${normalize(shift.date)}|${normalize(shift.shift)}|${normalize(shift.provider)}`;
}

/**
 * Merge a draft into the accumulated list. Chunk overlap means the same shift
 * can be seen twice: once truncated at a chunk boundary and once complete, or
 * with the date heading missing when a chunk starts mid-day. Merging keeps the
 * richest version of each shift instead of duplicating or dropping data.
 */
function mergeDraft(all: ShiftDraft[], index: Map<string, number>, draft: ShiftDraft): void {
  const richer = (a: ShiftDraft, b: ShiftDraft): ShiftDraft => ({
    date: a.date || b.date,
    shift: a.shift || b.shift,
    provider: a.provider || b.provider,
    mood: a.mood || b.mood,
    narrative: b.narrative.length > a.narrative.length ? b.narrative : a.narrative,
  });

  if (draft.date) {
    const key = dedupeKey(draft);
    const existing = index.get(key);
    if (existing === undefined) {
      index.set(key, all.length);
      all.push(draft);
    } else {
      all[existing] = richer(all[existing], draft);
    }
    return;
  }

  // Date-less fragment (chunk began mid-day): attach it to the most recent
  // shift whose narrative overlaps; otherwise keep it as an unknown-date shift.
  const head = normalize(draft.narrative).slice(0, 100);
  for (let i = all.length - 1; i >= 0; i--) {
    const candidate = all[i];
    if (draft.shift && candidate.shift && normalize(candidate.shift) !== normalize(draft.shift)) {
      continue;
    }
    const candidateNorm = normalize(candidate.narrative);
    if (
      head.length > 20 &&
      (candidateNorm.includes(head) || normalize(draft.narrative).includes(candidateNorm.slice(0, 100)))
    ) {
      all[i] = richer(candidate, draft);
      return;
    }
  }
  all.push(draft);
}

function sanitizeDraft(raw: unknown): ShiftDraft | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const draft: ShiftDraft = {
    date: str(obj.date),
    shift: str(obj.shift),
    provider: str(obj.provider),
    mood: str(obj.mood),
    narrative: str(obj.narrative).replace(/\[PAGE \d+\]/g, '').trim(),
  };
  // A record with no narrative and no time range is noise.
  if (!draft.narrative && !draft.shift) return null;
  return draft;
}

/**
 * Extract every shift from the report pages using the AI, chunk by chunk.
 * Results are cached on disk by content hash so identical reports never
 * trigger duplicate AI calls.
 */
export async function extractShifts(
  pages: string[],
  ai: AiClient,
  cache: DiskCache,
  onProgress?: ExtractionProgress,
): Promise<ShiftDraft[]> {
  const chunks = buildChunks(pages);
  const all: ShiftDraft[] = [];
  const index = new Map<string, number>();

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const cacheKey = `extract|${ai.model}|${sha256(chunk)}`;
    let drafts = await cache.get<ShiftDraft[]>(cacheKey);

    if (!drafts) {
      const response = await ai.chatJSON({
        system: EXTRACTION_SYSTEM_PROMPT,
        user: `Extract all shifts from this portion of the report:\n\n${chunk}`,
        purpose: `extract chunk ${i + 1}/${chunks.length}`,
      });
      const rawShifts = (response as { shifts?: unknown[] })?.shifts;
      if (!Array.isArray(rawShifts)) {
        throw new Error(`AI extraction returned an unexpected shape for chunk ${i + 1}`);
      }
      drafts = rawShifts
        .map(sanitizeDraft)
        .filter((d): d is ShiftDraft => d !== null);
      await cache.set(cacheKey, drafts);
    }

    for (const draft of drafts) {
      mergeDraft(all, index, draft);
    }
    onProgress?.(i + 1, chunks.length, all.length);
  }

  log.info(`extracted ${all.length} shift(s) from ${chunks.length} chunk(s)`);
  return all;
}
