import type { Form680Spec, SupportSection } from '../template680.js';
import type { TemplateFieldInfo } from '../../types.js';

/**
 * Classifies every support section of a template by TOPIC (what the section
 * is about) rather than by its number, so the same evidence rules and default
 * wording apply to any individual's Form §680 — "Routine Support 5" may be
 * Laundry on one person's plan and Bathing on another's.
 */
export type SectionTopic =
  | 'community'
  | 'cooking'
  | 'meals'
  | 'dehydration'
  | 'seizure'
  | 'pressure'
  | 'aspiration'
  | 'fall'
  | 'bowel'
  | 'sepsis'
  | 'equipment'
  | 'communication'
  | 'medication'
  | 'housekeeping'
  | 'laundry'
  | 'shopping'
  | 'money'
  | 'appointments'
  | 'transportation'
  | 'medical'
  | 'bathing'
  | 'dressing'
  | 'restroom'
  | 'positioning'
  | 'appearance'
  | 'crisis'
  | 'elopement'
  | 'behavior'
  | 'suicidal'
  | 'safety'
  | 'sleep'
  | 'employment'
  | 'skills'
  | 'other';

export type SectionKind = 'Outcome' | 'Identified Risk' | 'Potential Risk' | 'Routine Support' | 'Medical' | 'Behavioral' | 'Other';

export interface IndexedSection {
  id: string;
  kind: SectionKind;
  num: string;
  /** Heading text without the "Kind N:" prefix and trailing frequency note. */
  subject: string;
  topic: SectionTopic;
  /** Binder-style authored line for this section ("Outcome 2 (…): …"). */
  label: RegExp;
  /** Explicit parenthetical reference in prose ("(Outcome 2)"). */
  ref: RegExp;
  typeField?: TemplateFieldInfo;
  docField?: TemplateFieldInfo;
}

/** First match wins; specific clinical topics before broad ones. */
const TOPIC_RULES: [SectionTopic, RegExp][] = [
  ['medical', /^(?:other\s+)?medical\b(?!\s*appointment)/i],
  ['behavior', /^(?:other\s+)?behavio/i],
  ['suicidal', /suicid|self-?harm|harm(?:ing)? (?:him|her|them)sel|danger to self/i],
  ['appointments', /appointment|doctor'?s? visit|dental visit|dentist/i],
  ['seizure', /seizure|epilep|convuls/i],
  ['dehydration', /dehydrat|hydration|fluid intake/i],
  ['pressure', /pressure (?:injur|sore|ulcer|area)|skin (?:integrity|breakdown)|bed ?sore/i],
  ['aspiration', /aspirat|chok|swallow|dysphag/i],
  ['fall', /\bfalls?\b|falling/i],
  ['bowel', /bowel|constipat|GI\b/i],
  ['sepsis', /sepsis|infection|UTI\b/i],
  ['elopement', /elope|wander|leav\w* (?:the )?(?:home|house|residence)|unsupervised|door alarm|AWOL/i],
  ['safety', /safety awareness|lack of safety|unsafe|safety skills|street safety|stranger/i],
  ['crisis', /crisis/i],
  ['medication', /medication|\bmeds?\b|pill/i],
  ['equipment', /adaptive equipment|\bDME\b|glucometer|wheelchair|walker|hearing aid|CPAP|equipment/i],
  ['communication', /communicat|speech|express\w* (?:his|her|their) (?:wants|needs)/i],
  ['housekeeping', /housekeep|chores|clean(?:ing)?\b|tidy/i],
  ['laundry', /laundry/i],
  ['shopping', /shopping/i],
  ['money', /bank|money|budget|financ|allowance|spending/i],
  ['transportation', /transport/i],
  ['bathing', /bath|shower|hygiene/i],
  ['dressing', /dressing|clothing|getting dressed/i],
  ['restroom', /restroom|toilet|incontinen|bathroom|continence/i],
  ['positioning', /position|transferr/i],
  ['appearance', /personal appearance|grooming|shav|hair care|teeth brushing|oral care/i],
  ['sleep', /sleep|bedtime|insomnia/i],
  ['cooking', /cook|kitchen|prepar\w* (?:simple )?(?:meals|food)/i],
  ['meals', /\bmeals?\b|nutrition|\bdiet|eating|intake|food/i],
  ['employment', /\bjob\b|employ|vocation|work(?:ing|place)?\b|volunteer/i],
  ['behavior', /behavio|outburst|aggress|anger|self-?harm|self-?neglect|mental health|psychiatric|emotional|coping|calm/i],
  ['medical', /medical|diabet|hypertension|cholesterol|blood pressure|\bhealth\b|weight|asthma|thyroid|gout|arthritis|GERD|reflux/i],
  ['community', /community|recreation|outing|social|leisure|friends|activities|church|park|library|events|go(?:es|ing)? out/i],
  ['skills', /independen|skill|routine|daily living|ADL/i],
];

const HEADING =
  /^(Outcome|Identified\s+Risk|Potential\s+Risk|Routine\s+Support|(?:Other\s+)?Medical|(?:Other\s+)?Behavioral)\s*#?\s*(\d+)\s*[:.\-—–]?\s*/i;
const FREQUENCY = /\s*\((?:daily|weekly|monthly|routine[^)]*|as needed|[^)]*needed|[^)]*week[^)]*|[^)]*month[^)]*|emergency[^)]*)\)\s*$/i;

function kindOf(raw: string): SectionKind {
  const k = raw.replace(/\s+/g, ' ').trim().toLowerCase();
  if (k === 'outcome') return 'Outcome';
  if (k === 'identified risk') return 'Identified Risk';
  if (k === 'potential risk') return 'Potential Risk';
  if (k === 'routine support') return 'Routine Support';
  if (/medical$/.test(k)) return 'Medical';
  if (/behavioral$/.test(k)) return 'Behavioral';
  return 'Other';
}

export function topicOf(text: string): SectionTopic {
  for (const [topic, re] of TOPIC_RULES) if (re.test(text)) return topic;
  return 'other';
}

function classify(section: SupportSection): Omit<IndexedSection, 'typeField' | 'docField'> {
  const m = section.title.match(HEADING);
  const kind = m ? kindOf(m[1]) : 'Other';
  const num = m?.[2] ?? '';
  const subject = (m ? section.title.slice(m[0].length) : section.title).replace(FREQUENCY, '').trim();
  let topic = topicOf(subject);
  // "Medical #1: Gout" — a bare diagnosis says nothing by itself; the kind does.
  if (topic === 'other' && kind === 'Medical') topic = 'medical';
  if (topic === 'other' && kind === 'Behavioral') topic = 'behavior';
  // A bare heading ("Outcome 1: (Weekly)") says nothing; try the detail lines.
  if (topic === 'other' && section.detailLines.length > 0) topic = topicOf(section.detailLines.join(' '));
  // Binder-style notes write "Risk 1 (Dehydration): …" as often as "Identified Risk 1".
  const kindSrc =
    kind === 'Other'
      ? escapeRegex(section.id.split(/\s+\d/)[0])
      : kind === 'Identified Risk'
        ? '(?:Identified\\s+)?Risk'
        : kind === 'Medical' || kind === 'Behavioral'
          ? `(?:Other\\s+)?${kind}`
          : kind.replace(' ', '\\s+');
  const numSrc = num ? `\\s*#?\\s*${num}\\b` : '\\b';
  return {
    id: section.id,
    kind,
    num,
    subject,
    topic,
    label: new RegExp(`^[●•*\\s-]*${kindSrc}${numSrc}[^:]{0,80}:`, 'i'),
    ref: new RegExp(`\\(${kindSrc}${numSrc}[^)]*\\)`, 'i'),
  };
}

/** Sections of a template with their topic and the two fields that belong to each. */
export function indexSections(spec: Form680Spec | undefined, fields: TemplateFieldInfo[]): IndexedSection[] | undefined {
  if (!spec || spec.sections.length === 0) return undefined;
  const seenSubjects = new Set<string>();
  return spec.sections.map((section) => {
    const base = classify(section);
    // A heading copied onto a second section ("Outcome 2: … goes out weekly"
    // twice, one about budgeting): the duplicate is what its details say.
    const subjectKey = base.subject.toLowerCase();
    if (seenSubjects.has(subjectKey) && section.detailLines.length > 0) {
      const fromDetails = topicOf(section.detailLines.join(' '));
      if (fromDetails !== 'other') base.topic = fromDetails;
    }
    seenSubjects.add(subjectKey);
    const prefix = `${section.id} - `;
    return {
      ...base,
      typeField: fields.find((f) => f.name === `${prefix}Support Type`),
      docField: fields.find((f) => f.name === `${prefix}Documentation`),
    };
  });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
