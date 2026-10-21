import AdmZip from 'adm-zip';
import { createLogger } from '../logger.js';
import { TemplateError } from './templateInspector.js';
import { buildFaithfulTemplate } from './faithfulTemplate.js';
import {
  buildForm680Template,
  DEFAULT_SPEC,
  type Form680Spec,
  type SupportSection,
} from './template680.js';

const log = createLogger('docx-template');

/**
 * Converts a Form §680 "Daily Progress Note" Word (.docx) template into a
 * fillable AcroForm PDF.
 *
 * Word documents print fine but carry no fillable fields, and neither do
 * PDFs exported from them — so instead of rejecting them, we read the
 * document's own structure (identity, shift times, mood checklist, Outcome /
 * Risk / Routine Support sections, end-of-shift questions) and rebuild it as
 * a true AcroForm with editable text fields, checkboxes and radio groups.
 * Field names follow the same conventions as the built-in template, so both
 * mapping engines work on the converted form unchanged.
 */

const CHECKBOX = /[\u2610\u2611\u2612\u25A1\u25FB\u274F]/; // ☐ ☑ ☒ □ ◻ ❏
const CHECKBOX_SPLIT = /[\u2610\u2611\u2612\u25A1\u25FB\u274F]/g;
const SECTION_HEADING =
  /^(Outcome|Identified\s+Risk|Potential\s+Risk|Routine\s+Support|(?:Other\s+)?Medical|(?:Other\s+)?Behavioral)\s*#?\s*(\d+)\s*:\s*(.+)$/i;
const TYPE_OF_SUPPORTS = /TYPE\s+OF\s+SUPPORTS\s+PROVIDED/i;
/** Lines that end the mood checklist when its boxes are cells rather than glyphs. */
const MOODS_END = /^(?:describe\b|individual\s+activity|group\s+activity|community\s+activity|outcomes?$|essential\s+supports)/i;

export function isDocxTemplate(fileName: string | undefined, bytes: Uint8Array): boolean {
  const zipMagic = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (fileName && /\.docx$/i.test(fileName)) return true;
  // No .docx extension: accept only if it is a zip that contains a Word body.
  if (!zipMagic) return false;
  try {
    return new AdmZip(Buffer.from(bytes)).getEntry('word/document.xml') !== null;
  } catch {
    return false;
  }
}

export function decodeXml(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Extract the visible paragraph texts of a .docx, in document order. */
export function docxParagraphs(bytes: Uint8Array): string[] {
  let xml: string;
  try {
    const zip = new AdmZip(Buffer.from(bytes));
    const entry = zip.getEntry('word/document.xml');
    if (!entry) throw new Error('word/document.xml not found');
    xml = entry.getData().toString('utf8');
  } catch (err) {
    throw new TemplateError(
      `The template is not a readable Word (.docx) document: ${(err as Error).message}`,
    );
  }

  const paragraphs: string[] = [];
  for (const chunk of xml.split('</w:p>')) {
    const withTabs = chunk.replace(/<w:tab[^>]*\/>/g, '<w:t> </w:t>');
    const runs = [...withTabs.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => decodeXml(m[1]));
    const text = runs.join('').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) paragraphs.push(text);
  }
  return paragraphs;
}

function stripCheckbox(text: string): string {
  return text.replace(CHECKBOX_SPLIT, '').trim();
}

/**
 * Make a string safe for use inside a pdf-lib field name: periods create
 * field hierarchies, so they must not appear.
 */
function fieldNamePart(text: string): string {
  return stripCheckbox(text).replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

/** Short parenthetical subject for a section id, e.g. "Dehydration". */
function sectionSubject(rest: string): string {
  // Drop a trailing frequency like "(Daily)" / "(Routine as needed)",
  // then any other parenthetical noise.
  let subject = rest
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\([^)]*\)/g, ' ')
    .trim();
  // Keep only the head of long prose descriptions.
  subject = subject.split(/[—–]|(?:\.\s)|(?:,\s)/)[0].trim();
  if (subject.length > 32) subject = subject.slice(0, 32).trim();
  return fieldNamePart(subject.replace(/[()]/g, ' '));
}

/** Parse the paragraphs of a §680-style Word template into a form spec. */
export function parseForm680Spec(paragraphs: string[]): Form680Spec {
  const titleIdx = paragraphs.findIndex((p) => /daily\s+progress\s+note/i.test(p));
  const orgName = titleIdx > 0 ? paragraphs[0] : (paragraphs[0] ?? DEFAULT_SPEC.orgName);
  const orgContact =
    titleIdx > 1 ? paragraphs.slice(1, Math.min(titleIdx, 4)).join('  |  ') : '';

  let individualName = '';
  let individualId = '';
  let shiftOptions: string[] = [];
  const moods: string[] = [];
  let supportTypeOptions: string[] = [];
  const sections: SupportSection[] = [];
  const yesNoQuestions: { id: string; question: string }[] = [];

  let inMoods = false;
  let currentSection: SupportSection | null = null;
  let collectingTypes: 'first' | 'skip' | null = null;

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];

    const nameMatch = p.match(/^Name\s*:\s*(.*)$/i);
    if (nameMatch && !individualName) {
      individualName = nameMatch[1].trim();
      continue;
    }
    const idMatch = p.match(/^ID\s*#?\s*:\s*(.*)$/i);
    if (idMatch && !individualId) {
      individualId = idMatch[1].trim();
      continue;
    }

    if (/^Shift\b[^:]{0,40}:/.test(p) && CHECKBOX.test(p) && shiftOptions.length === 0) {
      const afterColon = p.slice(p.indexOf(':') + 1);
      shiftOptions = [...new Set(
        afterColon
          .split(CHECKBOX_SPLIT)
          .map((s) => fieldNamePart(s))
          .filter(Boolean),
      )];
      continue;
    }

    if (/moods?\s+observed/i.test(p)) {
      inMoods = true;
      continue;
    }
    if (inMoods) {
      if (CHECKBOX.test(p)) {
        const mood = fieldNamePart(p.replace(/_{2,}/g, ''));
        // "Other: ____" becomes the dedicated "Mood: Other" text field.
        if (mood && !/^other\b/i.test(mood) && !moods.includes(mood)) moods.push(mood);
        continue;
      }
      // Checklist drawn as [empty box cell][label cell]: the labels arrive as
      // short plain paragraphs until the activities heading.
      if (!MOODS_END.test(p) && !SECTION_HEADING.test(p) && p.length <= 40 && !/[.:]$/.test(p.replace(/^other:?$/i, ''))) {
        const mood = fieldNamePart(p.replace(/_{2,}/g, ''));
        if (mood && !/^other\b/i.test(mood) && !moods.includes(mood)) moods.push(mood);
        continue;
      }
      if (/^other\s*:?\s*_*$/i.test(p)) continue;
      inMoods = false;
    }

    const heading = p.match(SECTION_HEADING);
    if (heading) {
      const num = heading[2];
      const rest = heading[3].trim();
      const normalizedKind = heading[1]
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
      const subject = /^outcome$/i.test(normalizedKind) ? '' : sectionSubject(rest);
      let id = subject ? `${normalizedKind} ${num} (${subject})` : `${normalizedKind} ${num}`;
      if (sections.some((s) => s.id === id)) id = `${id} #${sections.length + 1}`;
      currentSection = { id, title: p, detailLines: [] };
      sections.push(currentSection);
      collectingTypes = null;
      continue;
    }

    if (TYPE_OF_SUPPORTS.test(p)) {
      collectingTypes = supportTypeOptions.length === 0 ? 'first' : 'skip';
      continue;
    }
    if (collectingTypes && CHECKBOX.test(p)) {
      if (collectingTypes === 'first') {
        const option = stripCheckbox(p);
        if (option && !supportTypeOptions.includes(option)) supportTypeOptions.push(option);
      }
      continue;
    }
    if (collectingTypes && !CHECKBOX.test(p)) collectingTypes = null;

    // Yes/No question: a prompt immediately followed by ☐ Yes then ☐ No.
    const next = paragraphs[i + 1] ?? '';
    const after = paragraphs.slice(i + 2, i + 4);
    const isQuestion =
      !CHECKBOX.test(p) &&
      p.length > 12 &&
      !/^(if\s+yes|instructions)\b/i.test(p) &&
      CHECKBOX.test(next) &&
      /^yes$/i.test(stripCheckbox(next)) &&
      after.some((l) => CHECKBOX.test(l) && /^no$/i.test(stripCheckbox(l)));
    if (isQuestion) {
      const question = p.trim();
      let id: string;
      if (/medication/i.test(question)) id = 'Medication Received';
      else if (/complaint|concern/i.test(question)) id = 'Medical Complaints';
      else if (/behavio|emotional/i.test(question)) id = 'Behavioral Difficulty';
      else if (/serious\s+incident/i.test(question)) id = 'Serious Incident';
      else id = `Question ${yesNoQuestions.length + 1}`;
      if (yesNoQuestions.some((q) => q.id === id)) id = `Question ${yesNoQuestions.length + 1}`;
      yesNoQuestions.push({ id, question });
      currentSection = null;
      continue;
    }

    if (CHECKBOX.test(p) || /^instructions\s*:/i.test(p) || /^if\s+yes\b/i.test(p)) continue;
    if (/^(outcomes|essential supports)$/i.test(p)) continue;
    if (/^describe\b/i.test(p) || /^staff\s+name/i.test(p)) continue;
    if (/^(individual|group|community)\s+activity\s*:/i.test(p)) continue;

    if (currentSection && currentSection.detailLines.length < 6 && p.length > 2) {
      currentSection.detailLines.push(p.replace(/_{3,}/g, '').trim());
    }
  }

  if (sections.length === 0 || moods.length < 3 || shiftOptions.length === 0) {
    throw new TemplateError(
      'The Word document does not look like a Form §680 Daily Progress Note template: ' +
        `found ${sections.length} support section(s), ${moods.length} mood option(s) and ` +
        `${shiftOptions.length} shift option(s). ` +
        'It must contain shift checkboxes, a "Moods Observed" checklist and Outcome / Risk / Routine Support sections.',
    );
  }

  return {
    orgName,
    orgContact,
    individualName,
    individualId,
    shiftOptions,
    moods,
    supportTypeOptions:
      supportTypeOptions.length >= 2 ? supportTypeOptions : [...DEFAULT_SPEC.supportTypeOptions],
    sections,
    yesNoQuestions:
      yesNoQuestions.length > 0 ? yesNoQuestions : DEFAULT_SPEC.yesNoQuestions.map((q) => ({ ...q })),
  };
}

/** Convert an uploaded .docx §680 template into a fillable AcroForm PDF. */
export async function buildTemplateFromDocx(bytes: Uint8Array): Promise<Uint8Array> {
  const paragraphs = docxParagraphs(bytes);
  const spec = parseForm680Spec(paragraphs);
  log.info(
    `docx template parsed: ${spec.sections.length} section(s), ${spec.moods.length} mood(s), ` +
      `${spec.shiftOptions.length} shift option(s), ${spec.yesNoQuestions.length} question(s)` +
      (spec.individualName ? `, individual "${spec.individualName}"` : ''),
  );
  // Exact-fidelity path: LibreOffice renders the Word layout pixel-perfectly
  // and form widgets are overlaid in place. Falls back to the structural
  // re-creation when LibreOffice is unavailable.
  try {
    return await buildFaithfulTemplate(bytes, spec);
  } catch (err) {
    log.warn(
      `exact-layout rendering unavailable (${(err as Error).message}); ` +
        'using the structural re-creation instead',
    );
    return buildForm680Template(spec);
  }
}
