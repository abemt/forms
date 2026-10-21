import type { AiClient } from './client.js';
import type { DiskCache } from '../cache.js';
import type { FieldAssignment, ShiftDraft, TemplateFieldInfo } from '../../types.js';
import { computeHints } from '../ruleEngine.js';
import { looseIncludes, normalize, sha256, tokenOverlap } from '../../utils/text.js';
import { createLogger } from '../../logger.js';

const log = createLogger('mapper');

export const MAPPING_SYSTEM_PROMPT = `You map ONE extracted shift record onto the fillable fields of a "Form § 680 Daily Progress Note" PDF template used by residential care providers.

TASK: MAP_FIELDS
The user message contains:
- FIELDS: the template's AcroForm field catalog (name, type, options, multiline).
- SHIFT: structured data for a single shift (date, shift time, provider, observed mood, full narrative).
- HINTS: advisory keyword matches computed deterministically. They are grounding aids, not commands.

Return STRICT JSON of this exact shape:
{"assignments":[{"field":"","value":"","evidence":""}],"warnings":[""]}

Assignment rules:
1. "field" MUST be a field name copied exactly from FIELDS. Never invent field names.
2. Value by field type:
   - checkbox: boolean true (only list checkboxes that should be CHECKED).
   - radio / dropdown / optionlist: one of that field's "options", copied exactly.
   - text: a string.
3. EVERY assignment must include "evidence": a short verbatim quote (3-25 words) copied character-for-character from the SHIFT data that justifies the assignment. No evidence means you must omit the assignment.
4. NEVER guess and NEVER invent facts. If the shift does not clearly support a field, leave the field out entirely. Leaving many fields empty is correct and expected.
5. Core fields to fill when present in FIELDS and known from SHIFT: the date, the shift time (checkbox or text), staff/provider name, individual's name, observed-mood description, and the full narrative into the narrative/progress-notes field (verbatim).
6. Shift-time checkboxes: choose the single checkbox whose time range matches the SHIFT time (e.g. shift "8am-4pm" matches a "Shift: 8am-4pm" checkbox).
7. Mood mapping — synonyms count, using the mood words in SHIFT as evidence:
   - happy, content, excited, cheerful, upbeat, joyful, "high spirits" -> Happy (and Content/Excited when those exact moods are named).
   - calm, peaceful, relaxed, easygoing, settled -> Calm.
   - friendly, outgoing, chatty, sociable, talkative -> Friendly and/or Outgoing.
   - Also check any other mood checkbox that the SHIFT mood words clearly support (e.g. "Cooperative" evidence can support Polite/Considerate ONLY if those words appear; otherwise skip).
8. Support sections (each usually has a "Support Type" choice and a "Documentation" text):
   - hydration / water / fluids -> dehydration risk section.
   - medication / insulin / med pass -> medication-use support section AND the "any medication received" question (answer Yes + explanation of what was given and when, grounded in the narrative).
   - cooking / kitchen / meal preparation -> Outcome 4 (cooking / meal planning).
   - community outings / shopping / park / mall / river / walking / drives -> Outcome 2 (community) and the Community Activity text.
   - laundry / housekeeping / cleaning -> the matching routine-support section.
   - taxi / drive / transported -> transportation support section.
   - seizure observation / monitoring -> Identified Risk 2 (seizure) section.
   - sleeping / night checks / bedtime / overnight monitoring -> overnight documentation (seizure/risk documentation on overnight shifts).
   - Pick the Support Type option that best matches how staff supported (e.g. staff "monitored"/"observed" -> "Monitor (Supervision)"; staff "reminded"/"encouraged"/"prompted" -> "Reminder (Verbal Prompt)"; staff physically did part of the task -> "Partial Physical (Some Physical Support)"; individual did it alone -> "Independent"; activity happened outside the facility such as day programs or outings -> you may still choose the support level, or "Out of Facility" when the section's activity happened away from the home). If the section's topic is not mentioned in the shift at all, DO NOT assign its fields.
9. Documentation text fields: write 1-2 concise sentences describing how support was provided and the individual's response, grounded in the evidence quote. Do not introduce facts that are not in the SHIFT.
10. Yes/No questions: answer "Yes" only with clear evidence; answer "No" only when the narrative clearly indicates no such event (e.g. "no seizure activity", "no concerns"); otherwise leave unanswered.
11. Activities text fields: individual activity (what they did alone), group activity (with peers/staff), community activity (outside the home) — fill only what the narrative supports.
12. Add a warning string for anything ambiguous, contradictory, or expected-but-missing.

Output nothing except the JSON object.`;

export interface MappingResult {
  assignments: FieldAssignment[];
  warnings: string[];
}

export function shiftFullText(shift: ShiftDraft): string {
  return [shift.date, shift.shift, shift.provider, shift.mood, shift.narrative]
    .filter(Boolean)
    .join('\n');
}

function fieldByName(fields: TemplateFieldInfo[]): Map<string, TemplateFieldInfo> {
  const map = new Map<string, TemplateFieldInfo>();
  for (const f of fields) map.set(f.name, f);
  return map;
}

function matchOption(options: string[] | undefined, value: string): string | undefined {
  if (!options) return undefined;
  const target = normalize(value);
  return options.find((o) => normalize(o) === target) ?? options.find((o) => normalize(o).includes(target) || target.includes(normalize(o)));
}

/**
 * Validate raw AI assignments:
 *  - the field must exist and the value must fit its type,
 *  - the evidence quote must actually appear in the shift text,
 *  - free-text values must be grounded in the shift text (token overlap).
 * Anything failing validation is dropped with a warning — never silently kept.
 */
export function validateAssignments(
  raw: unknown,
  shift: ShiftDraft,
  fields: TemplateFieldInfo[],
): MappingResult {
  const catalog = fieldByName(fields);
  const source = shiftFullText(shift);
  const assignments: FieldAssignment[] = [];
  const warnings: string[] = [];
  const seenFields = new Set<string>();

  const rawObj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const rawAssignments = Array.isArray(rawObj.assignments) ? rawObj.assignments : [];
  const rawWarnings = Array.isArray(rawObj.warnings) ? rawObj.warnings : [];
  for (const w of rawWarnings) {
    if (typeof w === 'string' && w.trim()) warnings.push(w.trim());
  }

  for (const entry of rawAssignments) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { field, value, evidence } = entry as Record<string, unknown>;
    if (typeof field !== 'string') continue;

    const info = catalog.get(field);
    if (!info) {
      warnings.push(`AI referenced unknown field "${field}" — skipped.`);
      continue;
    }
    if (seenFields.has(field)) continue;

    const evidenceText = typeof evidence === 'string' ? evidence.trim() : '';
    const evidenceOk =
      evidenceText.length > 0 &&
      (looseIncludes(source, evidenceText) || tokenOverlap(source, evidenceText) >= 0.75);

    if (!evidenceOk) {
      warnings.push(`No verifiable evidence for "${field}" — left blank to avoid guessing.`);
      continue;
    }

    if (info.type === 'checkbox') {
      if (value === true || value === 'true' || value === 'checked') {
        assignments.push({ field, value: true, evidence: evidenceText });
        seenFields.add(field);
      }
      continue;
    }

    if (info.type === 'radio' || info.type === 'dropdown' || info.type === 'optionlist') {
      if (typeof value !== 'string' || !value.trim()) continue;
      const option = matchOption(info.options, value);
      if (!option) {
        warnings.push(`AI chose "${value}" for "${field}" but that is not one of its options — skipped.`);
        continue;
      }
      assignments.push({ field, value: option, evidence: evidenceText });
      seenFields.add(field);
      continue;
    }

    // text
    if (typeof value !== 'string' || !value.trim()) continue;
    let text = value.trim();
    if (info.maxLength && text.length > info.maxLength) text = text.slice(0, info.maxLength);
    // Long free text must be grounded in the source; short values (dates,
    // names, times) must appear in the source loosely.
    // Exception: signature fields are signed with initials derived from the
    // already-verified provider evidence (e.g. "Hanna Tafesse, DSP" -> "H.T."),
    // so matching initials count as grounded.
    const evidenceName = evidenceText.split(',')[0]?.trim() ?? '';
    const evidenceInitials = evidenceName
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => `${p[0].toUpperCase()}.`)
      .join('');
    const signatureInitialsOk =
      /signature/i.test(field) &&
      !/date/i.test(field) &&
      evidenceInitials.length > 0 &&
      text.replace(/\s+/g, '').toUpperCase() === evidenceInitials;
    const grounded =
      signatureInitialsOk ||
      (text.length <= 30
        ? looseIncludes(source, text) || tokenOverlap(source, text) >= 0.6
        : tokenOverlap(source, text) >= 0.55);
    if (!grounded) {
      warnings.push(`Text for "${field}" was not grounded in the shift narrative — left blank.`);
      continue;
    }
    assignments.push({ field, value: text, evidence: evidenceText });
    seenFields.add(field);
  }

  return { assignments, warnings };
}

/**
 * Map a single shift onto the template fields via the AI, with disk caching
 * keyed by (model, template fields, shift content).
 */
export async function mapShiftToFields(
  shift: ShiftDraft,
  fields: TemplateFieldInfo[],
  ai: AiClient,
  cache: DiskCache,
): Promise<MappingResult> {
  const fieldsJson = JSON.stringify(
    fields.map((f) => ({
      name: f.name,
      type: f.type,
      ...(f.options ? { options: f.options } : {}),
      ...(f.multiline ? { multiline: true } : {}),
    })),
  );
  const hints = computeHints(shiftFullText(shift));
  const cacheKey = `map|${ai.model}|${sha256(fieldsJson)}|${sha256(JSON.stringify(shift))}`;

  const cached = await cache.get<MappingResult>(cacheKey);
  if (cached) return cached;

  const user = [
    'FIELDS:',
    fieldsJson,
    '',
    'SHIFT:',
    JSON.stringify(shift, null, 2),
    '',
    'HINTS (advisory keyword matches):',
    JSON.stringify(hints, null, 2),
  ].join('\n');

  const raw = await ai.chatJSON({
    system: MAPPING_SYSTEM_PROMPT,
    user,
    purpose: `map shift ${shift.date} ${shift.shift}`,
  });

  const result = validateAssignments(raw, shift, fields);
  log.info(
    `mapped ${shift.date} ${shift.shift}: ${result.assignments.length} assignment(s), ${result.warnings.length} warning(s)`,
  );
  await cache.set(cacheKey, result);
  return result;
}

/**
 * Fallback used only when the AI fails for a shift after all retries:
 * fill the obviously-safe basics (date/shift/provider/mood/narrative) by
 * fuzzy field-name matching so the form is still useful, and warn loudly.
 */
export function basicFallbackAssignments(
  shift: ShiftDraft,
  fields: TemplateFieldInfo[],
): FieldAssignment[] {
  const assignments: FieldAssignment[] = [];
  const findText = (patterns: RegExp[]) =>
    fields.find((f) => f.type === 'text' && patterns.some((p) => p.test(f.name)));

  const dateField = findText([/^date$/i, /\bdate\b/i]);
  if (dateField && shift.date) assignments.push({ field: dateField.name, value: shift.date });

  const shiftText = findText([/shift/i]);
  if (shiftText && shift.shift) assignments.push({ field: shiftText.name, value: shift.shift });
  for (const f of fields) {
    if (f.type === 'checkbox' && /shift/i.test(f.name) && shift.shift) {
      const want = normalize(shift.shift).replace(/\s/g, '');
      const have = normalize(f.name).replace(/^shift:?/, '').replace(/\s/g, '');
      if (want && have && (want.includes(have) || have.includes(want))) {
        assignments.push({ field: f.name, value: true });
      }
    }
  }

  const provider = findText([/staff name/i, /provider/i, /staff/i]);
  if (provider && shift.provider) assignments.push({ field: provider.name, value: shift.provider });

  const mood = findText([/mood description/i, /mood/i]);
  if (mood && shift.mood) assignments.push({ field: mood.name, value: shift.mood });

  const narrative = findText([/narrative/i, /progress note/i, /notes/i]);
  if (narrative && shift.narrative) assignments.push({ field: narrative.name, value: shift.narrative });

  return assignments;
}
