import type { FieldAssignment, ShiftDraft, TemplateFieldInfo } from '../../types.js';
import type { MappingResult } from '../ai/fieldMapper.js';
import type { Form680Spec } from '../template680.js';
import { createLogger } from '../../logger.js';
import { personFromSpec, type Person } from './person.js';
import { indexSections, type SectionTopic } from './sectionTopics.js';

const log = createLogger('local-map');

/**
 * Deterministic, zero-cost field mapping — no AI involved.
 *
 * Rules-based engine that fills Form §680 fields from a shift's text using:
 *  1. explicit section references in the narrative ("(Outcome 4)", "(Risk 2)",
 *     "(Routine Support 3)", "(Potential Risk 1)") — strongest signal;
 *  2. a curated keyword table derived from the §680 mapping specification;
 *  3. a mood-synonym table for the mood checkboxes.
 *
 * Every assignment carries a verbatim evidence quote from the shift text and
 * is afterwards re-validated by the same evidence checker used for AI output,
 * so nothing ungrounded can reach a form. Uncertain fields stay blank.
 */

/** Mood word -> template mood checkbox. Only unambiguous synonyms. */
export const MOOD_SYNONYMS: Record<string, string[]> = {
  happy: ['Happy'],
  happily: ['Happy'],
  cheerful: ['Happy'],
  upbeat: ['Happy'],
  joyful: ['Happy'],
  glad: ['Happy'],
  proud: ['Happy'],
  grateful: ['Happy'],
  pleasant: ['Happy'],
  smiling: ['Happy'],
  laughing: ['Happy'],
  joking: ['Happy'],
  content: ['Content'],
  satisfied: ['Content'],
  good: ['Content'],
  fine: ['Content'],
  okay: ['Content'],
  ok: ['Content'],
  positive: ['Happy'],
  excited: ['Excited'],
  exited: ['Excited'], // common misspelling in staff notes
  excitement: ['Excited'],
  enthusiastic: ['Excited'],
  eager: ['Excited'],
  thrilled: ['Excited'],
  calm: ['Calm'],
  peaceful: ['Calm'],
  relaxed: ['Calm'],
  relax: ['Calm'],
  easygoing: ['Calm'],
  settled: ['Calm'],
  serene: ['Calm'],
  rested: ['Calm'],
  restful: ['Calm'],
  mellow: ['Calm'],
  friendly: ['Friendly'],
  sociable: ['Friendly'],
  social: ['Friendly'],
  warm: ['Friendly'],
  outgoing: ['Outgoing'],
  chatty: ['Outgoing'],
  talkative: ['Outgoing'],
  conversational: ['Outgoing'],
  outspoken: ['Outspoken'],
  polite: ['Polite'],
  courteous: ['Polite'],
  respectful: ['Polite'],
  considerate: ['Considerate'],
  thoughtful: ['Considerate'],
  caring: ['Caring'],
  kind: ['Caring'],
  gentle: ['Gentle'],
  modest: ['Modest'],
  sleepy: ['Decreased energy/Fatigue'],
  tired: ['Decreased energy/Fatigue'],
  fatigued: ['Decreased energy/Fatigue'],
  exhausted: ['Decreased energy/Fatigue'],
  drowsy: ['Decreased energy/Fatigue'],
  lethargic: ['Decreased energy/Fatigue'],
  sad: ['Sad/Pained/Worried Expression'],
  unhappy: ['Sad/Pained/Worried Expression'],
  upset: ['Sad/Pained/Worried Expression'],
  worried: ['Sad/Pained/Worried Expression'],
  tearful: ['Sad/Pained/Worried Expression'],
  crying: ['Sad/Pained/Worried Expression'],
  cried: ['Sad/Pained/Worried Expression'],
  pained: ['Sad/Pained/Worried Expression'],
  lonely: ['Sad/Pained/Worried Expression'],
  grieving: ['Sad/Pained/Worried Expression'],
  anxious: ['Anxiety/Fear'],
  fearful: ['Anxiety/Fear'],
  nervous: ['Anxiety/Fear'],
  scared: ['Anxiety/Fear'],
  afraid: ['Anxiety/Fear'],
  angry: ['Anger'],
  mad: ['Anger'],
  furious: ['Anger'],
  agitated: ['Agitation'],
  restless: ['Restlessness'],
  irritable: ['Irritability'],
  irritated: ['Irritability'],
  frustrated: ['Irritability'],
  grumpy: ['Irritability'],
  cranky: ['Irritability'],
  annoyed: ['Irritability'],
  depressed: ['Depressed'],
  withdrawn: ['Social Withdrawal'],
  impulsive: ['Impulsivity'],
  distracted: ['Distractibility'],
};

/** Filler around mood words that should never end up in "Mood: Other". */
const MOOD_FILLER = new Set([
  'a', 'an', 'the', 'and', 'but', 'or', 'very', 'so', 'bit', 'little', 'some', 'somehow', 'how', 'kind', 'of',
  'pretty', 'really', 'quite', 'was', 'is', 'were', 'in', 'at', 'on', 'to', 'he', 'his', 'steve', 'steven',
  'today', 'this', 'that', 'shift', 'morning', 'evening', 'night', 'day', 'mood', 'seemed', 'appeared', 'felt',
  'feeling', 'with', 'about', 'for', 'from',
]);

/** Words that flip the meaning of a following mood word. */
const NEGATION = /^(?:not|no|never|wasn'?t|isn'?t|didn'?t|without)$/i;

/** Mood checkboxes supported by a text: word-level synonym lookup with negation guard. */
function moodTargets(text: string): { target: string; word: string }[] {
  const words = text.split(/[^A-Za-z']+/).filter(Boolean);
  const found: { target: string; word: string }[] = [];
  for (let i = 0; i < words.length; i++) {
    const key = words[i].toLowerCase().replace(/'/g, '');
    const targets = MOOD_SYNONYMS[key];
    if (!targets) continue;
    if ((i > 0 && NEGATION.test(words[i - 1])) || (i > 1 && NEGATION.test(words[i - 2]))) continue;
    for (const target of targets) {
      if (!found.some((f) => f.target === target)) found.push({ target, word: words[i] });
    }
  }
  return found;
}

/**
 * Support-section rules, one per section TOPIC. A template's sections are
 * classified by topic (sectionTopics.ts) so the same rule serves "Routine
 * Support 5: Laundry" on one individual's plan and "Routine Support 9:
 * Laundry" on another's. `label` matches an authored/binder-style section
 * sentence ("Outcome 2 (Community Inclusion): …"); `ref` matches explicit
 * parenthetical references in prose ("(Outcome 2)"); `keywords` are the
 * fallback signals; `sectionMatch` locates the section's fields by name when
 * no template spec is available (plain PDF templates).
 */
interface SectionRule {
  topic: SectionTopic;
  label: RegExp;
  ref?: RegExp;
  keywords: RegExp;
  /** Sentences matching this are NOT evidence for the section ("did not go out"). */
  exclude?: RegExp;
  /** Sentences matching this are ignored entirely (plans, talk about the topic). */
  ignore?: RegExp;
  /** Community-type sections: an outing with staff is "Out of Facility" first. */
  outOfFacilityFirst?: boolean;
  sectionMatch: RegExp;
}

const NOT_OUT = /\b(?:did not|didn'?t|does not|doesn'?t|not|never) (?:go|went|attend\w*|leave)\b|\bstay(?:ed|s)? (?:home|in|inside|at (?:the )?(?:house|home))\b|\bno outing\b|\bday off\b/i;
/** Talking about or planning an outing is not an outing. */
const INTENT = /\b(?:to go to|going to|is going out|will (?:go|be going|visit|be)|plans? to|planned to|excited to|exited to|looking forward|tomorrow|next (?:week|day)|this weekend|for the weekend|talk(?:ed|ing)? about|conversation about|discuss\w* (?:about|his interest)|interest in|would like to)\b/i;

const SECTION_RULES: SectionRule[] = [
  {
    topic: 'community',
    label: /^[●•*\s-]*Outcome\s*#?\s*2\b[^:]{0,80}:/i,
    ref: /\(Outcome 2[^)]*\)/i,
    keywords:
      /\b(?:community|outing|went out|going out|go out|took \w+ out|shopping|park|mall|river|library|church|walk(?:ed|ing)?|day support|day program|goodwill|good will|store|restaurant|theat(?:er|re)|bowling|trip|visited|zoo|museum|event)\b/i,
    exclude: NOT_OUT,
    ignore: INTENT,
    outOfFacilityFirst: true,
    sectionMatch: /^Outcome 2\b/i,
  },
  {
    topic: 'cooking',
    label: /^[●•*\s-]*Outcome\s*#?\s*4\b[^:]{0,80}:/i,
    ref: /\(Outcome 4[^)]*\)/i,
    keywords:
      /\b(?:cook\w*|kitchen|stove|oven|toaster|micro ?wave|recipe|meal prep\w*|(?:made|make|making|prepar\w+|preprepar\w+|pack(?:ed|ing)?|fix(?:ed|ing)?|heat(?:ed|ing)?|scrambl\w+|fried|fry(?:ing)?|grill\w*|bak(?:ed|ing))\b[^.\n]{0,40}\b(?:breakfast|break fast|lunch|dinner|supper|meals?|food|sandwich|oatmeal|eggs?|bacon|beacon|pancakes?|steak|rice|pasta|soup|salad|snack)|(?:breakfast|break fast|lunch|dinner|supper|meal) (?:prep\w*|preparation))\b/i,
    sectionMatch: /^Outcome 4\b/i,
  },
  {
    topic: 'dehydration',
    label: /^[●•*\s-]*(?:Identified\s+)?Risk\s*#?\s*1\b[^:]{0,80}:/i,
    ref: /\((?:Identified )?Risk 1[^)]*\)/i,
    keywords: /\b(?:hydrat\w*|dehydrat\w*|water|fluids?|drank|drink(?:s|ing)?|juice|beverage|thirst\w*)\b/i,
    exclude: /\bwater bottles?\b/i,
    sectionMatch: /^Identified Risk 1\b|dehydration/i,
  },
  {
    topic: 'seizure',
    label: /^[●•*\s-]*(?:Identified\s+)?Risk\s*#?\s*2\b[^:]{0,80}:/i,
    ref: /\((?:Identified )?Risk 2[^)]*\)/i,
    keywords:
      /\b(?:seizure\w*|post-ictal|epilep\w*|convuls\w*|(?:night|bed|overnight) checks?|monitored .{0,40}(?:night|sleep|slept)|slept (?:well|through)|through ?out the night|during the night)\b/i,
    sectionMatch: /^Identified Risk 2\b|seizure/i,
  },
  {
    topic: 'pressure',
    label: /^[●•*\s-]*Potential\s+Risk\s*#?\s*1\b[^:]{0,80}:/i,
    ref: /\(Potential Risk 1[^)]*\)/i,
    keywords: /\b(?:pressure (?:injury|area|sore|ulcer)|reposition\w*|skin (?:integrity|check|breakdown)|bed ?sore|redness)\b/i,
    sectionMatch: /^Potential Risk 1\b|pressure injury/i,
  },
  {
    topic: 'aspiration',
    label: /^[●•*\s-]*Potential\s+Risk\s*#?\s*2\b[^:]{0,80}:/i,
    ref: /\(Potential Risk 2[^)]*\)/i,
    keywords: /\b(?:aspirat\w*|swallow\w*|chok\w*|cough\w*|chewing)\b/i,
    sectionMatch: /^Potential Risk 2\b|aspiration/i,
  },
  {
    topic: 'fall',
    label: /^[●•*\s-]*Potential\s+Risk\s*#?\s*3\b[^:]{0,80}:/i,
    ref: /\(Potential Risk 3[^)]*\)/i,
    keywords: /\b(?:fall\w*|fell|slipp?\w*|tripp?\w*|unsteady|balance|stumbl\w*|stairs|walker|cane)\b/i,
    sectionMatch: /^Potential Risk 3\b|fall/i,
  },
  {
    topic: 'bowel',
    label: /^[●•*\s-]*Potential\s+Risk\s*#?\s*4\b[^:]{0,80}:/i,
    ref: /\(Potential Risk 4[^)]*\)/i,
    keywords: /\b(?:bowel\w*|constipat\w*|BM log|BMs?|stool|laxative|abdominal)\b/i,
    sectionMatch: /^Potential Risk 4\b|bowel/i,
  },
  {
    topic: 'sepsis',
    label: /^[●•*\s-]*Potential\s+Risk\s*#?\s*5\b[^:]{0,80}:/i,
    ref: /\(Potential Risk 5[^)]*\)/i,
    keywords: /\b(?:sepsis|infection\w*|fever\w*|temperature|chills|feeling sick|felt sick|flu|vomit\w*|nausea)\b/i,
    sectionMatch: /^Potential Risk 5\b|sepsis/i,
  },
  {
    topic: 'equipment',
    label: /^[●•*\s-]*Routine\s+Support\s*#?\s*1\b[^:]{0,80}:/i,
    ref: /\(Routine Support 1[^)]*\)/i,
    keywords: /\b(?:glucometer|glucose|blood sugar|blood-sugar|sugar level|checked his sugar|eyeglasses|glasses|hearing aid|cpap|adaptive equipment)\b/i,
    sectionMatch: /^Routine Support 1\b|glucometer|adaptive equipment/i,
  },
  {
    topic: 'communication',
    label: /^[●•*\s-]*Routine\s+Support\s*#?\s*2\b[^:]{0,80}:/i,
    ref: /\(Routine Support 2[^)]*\)/i,
    keywords:
      /\b(?:wellness check-in|check-in|conversation\w*|communicat\w*|discuss\w*|talk(?:ed|ing|s)?|express\w*|shared|told|asked|explain\w*|chat\w*|listen\w*)\b/i,
    sectionMatch: /^Routine Support 2\b|communication/i,
  },
  {
    topic: 'medication',
    label: /^[●•*\s-]*Routine\s+Support\s*#?\s*3\b[^:]{0,80}:/i,
    ref: /\(Routine Support 3[^)]*\)/i,
    keywords: /\b(?:medication\w*|meds?|pills?|insulin|metformin|med pass|prescri\w*|dose)\b/i,
    sectionMatch: /^Routine Support 3\b|medication/i,
  },
  {
    topic: 'housekeeping',
    label: /^[●•*\s-]*Routine\s+Support\s*#?\s*4\b[^:]{0,80}:/i,
    ref: /\(Routine Support 4[^)]*\)/i,
    keywords:
      /\b(?:housekeeping|vacuum\w*|wip(?:ed|ing) .{0,20}(?:counter|table)|tid(?:y|ied|ying)|clean(?:ed|ing|s)? (?:his |her |the |up )?(?:room|kitchen|bathroom|table|counter|dishes|house|up)|dishes|trash|garbage|swe(?:pt|ep)\w*|mopp?\w*|chores?|made (?:his|her) bed|organi[sz]\w+ (?:his |her |the )?(?:room|closet|drawers?|shelf|shelves|clothes|belongings)|put away)\b/i,
    sectionMatch: /^Routine Support 4\b|housekeeping/i,
  },
  {
    topic: 'laundry',
    label: /^[●•*\s-]*Routine\s+Support\s*#?\s*5\b[^:]{0,80}:/i,
    ref: /\(Routine Support 5[^)]*\)/i,
    keywords: /\b(?:laundry|fold(?:ed|ing)? (?:his |her |the )?(?:clothes|towels|laundry)|washer|dryer|wash(?:ed|ing)? (?:his |her |the )?clothes)\b/i,
    sectionMatch: /^Routine Support 5\b|laundry/i,
  },
  {
    topic: 'shopping',
    label: /^[●•*\s-]*Routine\s+Support\s*#?\s*6\b[^:]{0,80}:/i,
    ref: /\(Routine Support 6[^)]*\)/i,
    keywords: /\b(?:shopp?\w*|grocer\w*|bought|buy(?:ing)?|purchas\w*|store visit|goodwill|good will|walmart|target|dollar tree|mall)\b/i,
    exclude: NOT_OUT,
    ignore: INTENT,
    outOfFacilityFirst: true,
    sectionMatch: /^Routine Support 6\b|shopping/i,
  },
  {
    topic: 'meals',
    label: /^[●•*\s-]*Routine\s+Support\s*#?\s*7\b[^:]{0,80}:/i,
    ref: /\(Routine Support 7[^)]*\)/i,
    keywords:
      /\b(?:meal\w*|menu|ate|eat\w*|intake|portion\w*|diet\w*|snack\w*|breakfast|break fast|lunch(?! allowance| money)|dinner|supper|healthy food|food)\b/i,
    exclude: /\bfood\s+bank\b/i,
    sectionMatch: /^Routine Support 7\b|meal planning/i,
  },
  {
    topic: 'money',
    label: /^[●•*\s-]*Routine\s+Support\s*#?\s*8\b[^:]{0,80}:/i,
    ref: /\(Routine Support 8[^)]*\)/i,
    keywords: /\b(?:bank\w*|budget\w*|saving\w*|save money|allowance|spending|spend\w*|money|financ\w*|cash|paid|pay(?:ing)?|dollars?|\$\d)\b/i,
    exclude: /\bfood\s+bank\b/i,
    sectionMatch: /^Routine Support 8\b|banking|money management/i,
  },
  {
    topic: 'appointments',
    label: /^[●•*\s-]*Routine\s+Support\s*#?\s*9\b[^:]{0,80}:/i,
    ref: /\(Routine Support 9[^)]*\)/i,
    keywords: /\b(?:appointment\w*|doctor\w*|dr\.|physician|clinic|dentist|hospital|pharmacy|nurse|therap\w*|check-?up|medical visit)\b/i,
    sectionMatch: /^Routine Support 9\b|medical appointment/i,
  },
  {
    topic: 'transportation',
    label: /^[●•*\s-]*Routine\s+Support\s*#?\s*10\b[^:]{0,80}:/i,
    ref: /\(Routine Support 10[^)]*\)/i,
    keywords:
      /\b(?:taxi|uber|lyft|transport\w*|drove|driv(?:e|ing|en)|rode|ride|bus|van|picked (?:him |steven? )?up|dropped (?:him |steven? )?off|took (?:him|steven?) to)\b/i,
    exclude: NOT_OUT,
    outOfFacilityFirst: true,
    sectionMatch: /^Routine Support 10\b|transportation/i,
  },
  {
    topic: 'medical',
    label: /^[●•*\s-]*Routine\s+Support\s*#?\s*11\b[^:]{0,80}:/i,
    ref: /\(Routine Support 11[^)]*\)/i,
    keywords:
      /\b(?:diabet\w*|blood pressure|blood sugar|sugar|cholesterol|healthy|health\w*|weigh\w*|exercis\w*|diet\w*|serving sizes|carb(?:ohydrate)?s?|gout|uric acid|flare-?ups?)\b/i,
    sectionMatch: /^Routine Support 11\b|diabetic diet|medical ?#?1/i,
  },
  // ---- categories other individuals' plans use (matched by topic only) ----
  {
    topic: 'bathing',
    label: /^[●•*\s-]*Bathing\b[^:]{0,40}:/i,
    keywords: /\b(?:bath(?:ed|ing|e)?|shower(?:ed|ing|s)?|wash(?:ed|ing)? (?:up|himself|herself|his (?:face|hair|body))|hygiene)\b/i,
    sectionMatch: /bathing/i,
  },
  {
    topic: 'dressing',
    label: /^[●•*\s-]*Dressing\b[^:]{0,40}:/i,
    keywords: /\b(?:dress(?:ed|ing)?|got dressed|changed (?:his |her )?clothes|picked out (?:his |her )?(?:clothes|outfit)|outfit|clean clothes|pajamas)\b/i,
    sectionMatch: /dressing/i,
  },
  {
    topic: 'restroom',
    label: /^[●•*\s-]*Restroom\b[^:]{0,40}:/i,
    keywords: /\b(?:restroom|bathroom|toilet(?:ing)?|used the (?:restroom|bathroom)|incontinen\w*|accident|briefs?|depends)\b/i,
    sectionMatch: /restroom|toilet/i,
  },
  {
    topic: 'positioning',
    label: /^[●•*\s-]*Positioning\b[^:]{0,40}:/i,
    keywords: /\b(?:reposition\w*|transferr?\w*|positioning|(?:in|out of) (?:bed|his chair|the wheelchair)|lift(?:ed|ing)?)\b/i,
    sectionMatch: /positioning|transferring/i,
  },
  {
    topic: 'appearance',
    label: /^[●•*\s-]*Personal\s+Appearance\b[^:]{0,40}:/i,
    keywords: /\b(?:brushed (?:his |her )?teeth|teeth brushing|shav(?:ed|ing)|combed|hair(?:cut| care)?|groom\w*|deodorant|lotion|nails?|personal appearance|looked (?:neat|clean|presentable))\b/i,
    sectionMatch: /personal appearance|grooming/i,
  },
  {
    topic: 'crisis',
    label: /^[●•*\s-]*Crisis\s+Plan\b[^:]{0,40}:/i,
    keywords: /\b(?:crisis|de-?escalat\w*|calm(?:ed|ing)? (?:him|her|down)|coping (?:skills?|strategies)|redirect\w*|cool(?:ed)? down|quiet (?:time|space)|breathing exercises?|911|police|emergency)\b/i,
    sectionMatch: /crisis/i,
  },
  {
    topic: 'elopement',
    label: /^[●•*\s-]*(?:Elopement|Wandering)\b[^:]{0,40}:/i,
    keywords: /\b(?:elope\w*|wander\w*|left the (?:house|home|residence|property) (?:without|alone|unsupervised|by himself|by herself)|walked (?:out|off|away)|opened the (?:front |back )?door|went out(?:side)? (?:alone|by himself|by herself|without (?:staff|telling))|unsupervised|door alarm|whereabouts|brought (?:him|her) back|found (?:him|her) (?:outside|down the street|at))\b/i,
    sectionMatch: /elopement|wandering/i,
  },
  {
    topic: 'suicidal',
    label: /^[●•*\s-]*Suicidal\b[^:]{0,40}:/i,
    keywords: /\b(?:suicid\w*|self-?harm|hurt (?:him|her)self|harm (?:him|her)self|kill (?:him|her)self|end (?:his|her) life|(?:did not|didn'?t) want to live|hopeless\w*|worthless\w*|statements? (?:about|of) (?:dying|death|self-harm))\b/i,
    sectionMatch: /suicid/i,
  },
  {
    topic: 'safety',
    label: /^[●•*\s-]*(?:Lack of )?Safety\s+Awareness\b[^:]{0,40}:/i,
    keywords: /\b(?:safety|unsafe|dangerous|look(?:ed)? both ways|cross(?:ed|ing)? the street|traffic|stove (?:on|off|left on)|burner|hot (?:stove|pan|water)|sharp|knife|stranger|seat ?belt|wandered (?:off|away)|ran (?:off|ahead)|stayed (?:with|close to|next to) staff|held staff'?s hand|reminded .{0,30}(?:safe|careful))\b/i,
    sectionMatch: /safety awareness|lack of safety/i,
  },
  {
    topic: 'behavior',
    label: /^[●•*\s-]*(?:Other\s+)?Behavio\w*\b[^:]{0,60}:/i,
    keywords: /\b(?:behavio\w*|outburst|aggress\w*|agitat\w*|yell\w*|scream\w*|curs\w*|threaten\w*|hit|punch\w*|kick\w*|threw|throwing|slam\w*|refus\w*|argu\w*|meltdown|tantrum|upset|angry|anger|frustrat\w*|calm(?:ed)? down|redirect\w*|de-?escalat\w*|coping|self-?harm|self-?neglect|mood swing\w*|paranoi\w*|hallucinat\w*|delusion\w*|talking to himself|anxious|anxiety|panic)\b/i,
    sectionMatch: /behavio|outburst|aggression|mental health/i,
  },
  {
    topic: 'sleep',
    label: /^[●•*\s-]*Sleep\b[^:]{0,40}:/i,
    keywords: /\b(?:sleep\w*|slept|bed ?time|went to bed|woke (?:up )?(?:at|early|late|during the night)|up (?:at|during) (?:the )?night|nap|insomnia|restless night|bed checks?)\b/i,
    sectionMatch: /sleep|bedtime/i,
  },
  {
    topic: 'employment',
    label: /^[●•*\s-]*(?:Employment|Job|Vocational)\b[^:]{0,60}:/i,
    keywords: /\b(?:job|employ\w*|work(?:ed|ing)?|interview|application|resume|vocational|volunteer\w*|career|paycheck)\b/i,
    ignore: INTENT,
    sectionMatch: /employment|vocational|\bjob\b/i,
  },
  {
    topic: 'skills',
    label: /^[●•*\s-]*(?:Independent\s+Living|Daily\s+Living|Life\s+Skills)\b[^:]{0,60}:/i,
    keywords: /\b(?:independent(?:ly)?|on his own|on her own|by himself|by herself|learn(?:ed|ing)?|practic\w*|skill\w*|routine|schedule|step[- ]by[- ]step|with (?:minimal|less|fewer) prompts?)\b/i,
    sectionMatch: /independen|daily living|life skills|skill/i,
  },
];

const RULE_BY_TOPIC = new Map(SECTION_RULES.map((r) => [r.topic, r]));

/** How staff supported -> "TYPE OF SUPPORTS PROVIDED" option, checked in order. */
const SUPPORT_TYPE_HEURISTICS: { pattern: RegExp; option: RegExp }[] = [
  { pattern: /\bnot scheduled\b/i, option: /^Not Scheduled/i },
  { pattern: /\b(?:declined|refused|chose not to|did not wish to|opted out|did not want)\b/i, option: /^Choose not to/i },
  {
    pattern:
      /\b(?:administered|dispensed|staff (?:gave|performed|completed|did)|(?:was|were) (?:given|administered|dispensed|provided|applied)|full(?:y)? assist)\w*\b/i,
    option: /^Full Physical/i,
  },
  {
    pattern:
      /\b(?:assist(?:ed|ing|s)?|help(?:ed|ing|s)? (?:him|her|them|with|to|prepare|cook|make|fold|set|clean|wash)|hand-over-hand|partial(?:ly)? support|together(?: with staff)?|side by side|alongside staff|staff supported|supported (?:him|steven?))\b/i,
    option: /^Partial Physical/i,
  },
  {
    pattern:
      /\b(?:remind(?:ed|er|ers|ing)?|encourag(?:ed|ement|ing)|prompt(?:s|ed|ing)?|steered|coached|cue[ds]?|cuing|offered|offering|discuss(?:ed|ion|ing)?|talked (?:about|with)|conversation about|reviewed .{0,30} with|explained|advised|suggested)\b/i,
    option: /^Reminder/i,
  },
  {
    pattern:
      /\b(?:independent(?:ly)?|on his own|on her own|his own|his won|her own|by (?:him|her)self|without (?:any )?(?:help|assistance|supervision|prompt(?:s|ing)?)|managed to|manage to|mana to)\b/i,
    option: /^Independent$/i,
  },
  {
    pattern:
      /\b(?:out of (?:the )?facility|day program|day support|off-?site|outing|drove|driven|provided transportation|transported|van ride|bus ride|taxi|went (?:out|to|shopping|for a (?:walk|drive))|go (?:out|to)|took \w+ (?:to|shopping|out)|community walk|walk (?:to|around|in) the|trip to|store|goodwill|good will|mall|shopping|grocer\w*)\b/i,
    option: /^Out of Facility/i,
  },
  {
    pattern:
      /\b(?:monitored|observed|supervis\w*|watch(?:ed|ing) (?:him|steven?|over)|tracked|checks?|checked on|stand-?by|under staff supervision|(?:was|were) (?:maintained|checked|completed|verified|confirmed)|staff|we|us)\b/i,
    option: /^Monitor/i,
  },
];

const OUT_OF_FACILITY = SUPPORT_TYPE_HEURISTICS.find((h) => /Out of Facility/.test(h.option.source))!;

function splitSentences(text: string): string[] {
  // Word logs keep one note per line (no punctuation needed); prose splits on
  // sentence punctuation.
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** "Hanna Tafesse, DSP" / "Natanael DSP" / "Abdela (DSP)" -> name + title. */
const ROLE_TITLES = /^(.+?)\s*(?:,|\(|\s)\s*((?:DSP|QIDP|IDP|RN|LPN|CNA|DCW|DSW|HHA|PCA|Staff|Caregiver|Manager|Supervisor)\.?)\)?\s*$/i;

function splitProvider(raw: string): { name: string; title?: string } {
  const role = raw.match(ROLE_TITLES);
  if (role) return { name: role[1].replace(/[,(]\s*$/, '').trim(), title: role[2].replace(/\.$/, '').toUpperCase() };
  const comma = raw.match(/^(.+?),\s*([A-Za-z .()]{2,40})$/);
  if (comma) return { name: comma[1].trim(), title: comma[2].trim() };
  return { name: raw.trim() };
}

function findField(
  fields: TemplateFieldInfo[],
  type: TemplateFieldInfo['type'] | undefined,
  pattern: RegExp,
): TemplateFieldInfo | undefined {
  return fields.find((f) => (!type || f.type === type) && pattern.test(f.name));
}

function normOption(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** "Type of Support: Reminder (Verbal Prompt)." — explicit statements win. */
const EXPLICIT_SUPPORT_TYPE = /Type of Supports?(?:\s+Provided)?\s*:\s*([^.;|]+)/i;

/** Anything health-related that staff wrote down: complaints, symptoms, injuries. */
const HEALTH_EVENT =
  /\b(?:complained of|voiced .{0,20}(?:pain|discomfort|complaint)|reported (?:pain|nausea|discomfort|headache)|burn(?:ed|t)? (?:his|her|him)|(?:got|was) burn(?:ed|t)|cut (?:his|her) \w+|bleed\w*|bruis\w*|swell\w*|swollen|rash|fever|vomit\w*|nause\w*|diarrh\w*|headache|stomach ?ache|toothache|(?:broke|broken|chipped|knocked out|lost) (?:his |a |two |several )?(?:front )?(?:teeth|tooth)|(?:teeth|tooth|mouth|lip|gum)s? (?:was|were|is|are) (?:still )?(?:broken|chipped|bleeding|injured|hurt|swollen|sore|tender|hurting|aching|fixed|repaired|treated)|(?:had|got|get) (?:his )?(?:teeth|tooth) (?:fixed|repaired|pulled|treated)|dental (?:injury|pain|damage|treatment|work|repair)|(?:was|felt|feeling|got|is|been) (?:sick|ill|unwell|dizzy|nauseous)|injur\w*|hurt (?:his|her|him)self|hurt his \w+|in pain|pain in|sore (?:throat|arm|leg|back|foot|hand|mouth)|cough(?:ed|ing)|cold symptoms|the flu|blood sugar (?:was )?(?:high|low|elevated)|(?:high|low) blood sugar|had a seizure|seizure (?:occurred|happened|was observed|lasted)|(?:tonic|grand mal|generalized) seizure|threw up)\b/i;

function matchOption(options: string[], wanted: string): string | undefined {
  const w = normOption(wanted);
  if (!w) return undefined;
  const exact = options.find((o) => normOption(o) === w);
  if (exact) return exact;
  const contains = options.find((o) => normOption(o).includes(w) || w.includes(normOption(o)));
  if (contains) return contains;
  // First-word prefix match: "Monitoring" -> "Monitor (Supervision)"
  const firstWord = (s: string) => (s.toLowerCase().match(/[a-z]+/)?.[0] ?? '');
  const ww = firstWord(wanted);
  if (ww.length >= 4) {
    return options.find((o) => {
      const ow = firstWord(o);
      return ow.startsWith(ww) || ww.startsWith(ow);
    });
  }
  return undefined;
}

function pickSupportType(
  options: string[],
  sentences: string[],
  prefer?: { pattern: RegExp; option: RegExp },
  person?: Person,
): { option: string; evidence: string } | undefined {
  for (const sentence of sentences) {
    const explicit = sentence.match(EXPLICIT_SUPPORT_TYPE);
    if (explicit) {
      const option = matchOption(options, explicit[1].trim());
      if (option) return { option, evidence: sentence };
    }
  }
  const heuristics = prefer ? [prefer, ...SUPPORT_TYPE_HEURISTICS] : SUPPORT_TYPE_HEURISTICS;
  for (const heuristic of heuristics) {
    const pattern = person ? forPerson(heuristic.pattern, person) : heuristic.pattern;
    for (const sentence of sentences) {
      if (pattern.test(sentence)) {
        const option = options.find((o) => heuristic.option.test(o));
        if (option) return { option, evidence: sentence };
      }
    }
  }
  // Absence of staff wording does not prove independence.
  return undefined;
}

function truncateEvidence(sentence: string): string {
  const words = sentence.split(/\s+/);
  return words.length <= 25 ? sentence : words.slice(0, 25).join(' ');
}

/** A rule bound to one concrete section of the template. */
interface ActiveRule {
  rule: SectionRule;
  label: RegExp;
  ref?: RegExp;
  typeField?: TemplateFieldInfo;
  docField?: TemplateFieldInfo;
}

/**
 * Bind rules to the template's sections: by topic when the template spec is
 * known (any individual's plan), by section name otherwise (plain PDFs).
 */
function activeRules(fields: TemplateFieldInfo[], spec: Form680Spec | undefined): ActiveRule[] {
  const index = indexSections(spec, fields);
  if (index) {
    const active: ActiveRule[] = [];
    for (const section of index) {
      const rule = RULE_BY_TOPIC.get(section.topic);
      if (!rule || (!section.typeField && !section.docField)) continue;
      active.push({ rule, label: section.label, ref: section.ref, typeField: section.typeField, docField: section.docField });
    }
    return active;
  }
  return SECTION_RULES.map((rule) => ({
    rule,
    label: rule.label,
    ref: rule.ref,
    typeField: fields.find(
      (f) => (f.type === 'radio' || f.type === 'dropdown' || f.type === 'optionlist') && rule.sectionMatch.test(f.name) && /support type/i.test(f.name),
    ),
    docField: fields.find((f) => f.type === 'text' && rule.sectionMatch.test(f.name) && /documentation/i.test(f.name)),
  })).filter((a) => a.typeField || a.docField);
}

/** Regexes written for Steve's notes ("steven?") re-targeted at another individual's name. */
const personalized = new Map<string, RegExp>();
function forPerson(re: RegExp, person: Person): RegExp {
  if (!/steven\?/.test(re.source)) return re;
  const key = `${person.namePattern}|${re.source}`;
  let out = personalized.get(key);
  if (!out) {
    out = new RegExp(re.source.replace(/steven\?/g, `(?:steven?|${person.namePattern})`), re.flags);
    personalized.set(key, out);
  }
  return out;
}

export function mapShiftLocally(shift: ShiftDraft, fields: TemplateFieldInfo[], spec?: Form680Spec): MappingResult {
  const person = personFromSpec(spec);
  const nameTokens = person.first.toLowerCase().split(/\s+/);
  const assignments: FieldAssignment[] = [];
  const warnings: string[] = [];
  const assigned = new Set<string>();
  const add = (field: TemplateFieldInfo | undefined, value: string | boolean, evidence: string): void => {
    if (!field || assigned.has(field.name)) return;
    assigned.add(field.name);
    assignments.push({ field: field.name, value, evidence: truncateEvidence(evidence) });
  };

  const narrative = shift.narrative;
  const sentences = splitSentences(narrative);
  // Structured entries ("Outcome 2 (…): …", "Type of Support: …", explicit
  // activity / yes-no lines) already land in their own fields; they are kept
  // out of the Shift Narrative so it only carries the free-text prose.
  const consumed = new Set<string>();

  // ---- Core fields -------------------------------------------------------
  if (shift.date) {
    add(findField(fields, 'text', /^date$/i) ?? findField(fields, 'text', /\bdate\b/i), shift.date, shift.date);
  }

  if (shift.shift) {
    const normShift = (s: string) =>
      s
        .toLowerCase()
        .replace(/[–—]/g, '-')
        .replace(/:00/g, '')
        .replace(/\s+/g, '')
        .replace(/^shift:?/, '');
    const want = normShift(shift.shift);
    const shiftBox = fields.find(
      (f) =>
        f.type === 'checkbox' &&
        /shift/i.test(f.name) &&
        (() => {
          const have = normShift(f.name.replace(/^shift:?\s*/i, ''));
          return have.length > 0 && (want.includes(have) || have.includes(want));
        })(),
    );
    if (shiftBox) {
      add(shiftBox, true, shift.shift);
    } else {
      add(findField(fields, 'text', /shift/i), shift.shift, shift.shift);
      if (fields.some((f) => f.type === 'checkbox' && /shift/i.test(f.name))) {
        warnings.push(`Shift time "${shift.shift}" does not match any shift checkbox — left unchecked.`);
      }
    }
  }

  // ---- Mood --------------------------------------------------------------
  const moodSentence = sentences.find((s) =>
    /\b(?:mood|appeared|presented|seemed|demeanor|spirits|affect|was (?:very |so )?(?:happy|sad|excited|exited|calm|tired|upset))\b/i.test(s),
  );
  if (shift.mood || moodSentence) {
    const moodField = findField(fields, 'text', /^mood description$/i) ?? findField(fields, 'text', /mood/i);
    // A one-line description slot (header-bar layouts) only has room for the
    // mood words themselves; the sentence stays in the notes.
    const oneLine = moodField?.multiline === false;
    const description = shift.mood
      ? moodSentence && !oneLine && !/[.!?]$/.test(shift.mood) && shift.mood.split(/\s+/).length <= 5
        ? `${shift.mood}. ${moodSentence}`
        : shift.mood
      : moodSentence!;
    add(moodField, description, moodSentence ?? shift.mood);
  }
  {
    // Checkboxes: words in the Observed Mood box first, then explicit mood
    // statements in the notes ("he felt so sad").
    const fromBox = moodTargets(shift.mood ?? '');
    const fromNotes = moodSentence ? moodTargets(moodSentence) : [];
    for (const { target, word } of [...fromBox, ...fromNotes]) {
      const box = fields.find((f) => f.type === 'checkbox' && f.name.toLowerCase() === `mood: ${target.toLowerCase()}`);
      if (box) add(box, true, word);
    }

    if (shift.mood) {
      // "Mood: Other" only gets short unmatched descriptors ("Sleeping"),
      // never a whole sentence — that already lives in Mood Description.
      const phrases = shift.mood
        .split(/[,;/]|\b(?:and|then|but)\b/i)
        .map((p) => p.replace(/[.!?]+$/, '').trim())
        .filter(Boolean);
      const totalWords = shift.mood.split(/\s+/).filter(Boolean).length;
      const other: string[] = [];
      for (const phrase of phrases) {
        if (moodTargets(phrase).length > 0) continue;
        const words = phrase.split(/\s+/).filter((w) => {
          const w0 = w.toLowerCase().replace(/[^a-z]/g, '');
          return !MOOD_FILLER.has(w0) && !nameTokens.includes(w0);
        });
        if (words.length === 0) continue;
        if (words.length <= 3) other.push(words.join(' '));
      }
      const otherField =
        findField(fields, 'text', /^mood: other$/i) ?? findField(fields, 'text', /other.*(describe|mood)|mood.*other/i);
      if (otherField) {
        if (other.length > 0 && totalWords <= 8) add(otherField, other.join(', '), other.join(', '));
        else if (fromBox.length === 0 && totalWords <= 8) add(otherField, shift.mood, shift.mood);
      }
    }
  }

  // ---- Provider / staff --------------------------------------------------
  if (shift.provider) {
    const { name: providerName, title } = splitProvider(shift.provider);
    add(findField(fields, 'text', /^staff name$/i) ?? findField(fields, 'text', /staff|provider/i), providerName, shift.provider);
    if (title) add(findField(fields, 'text', /^staff title$/i) ?? findField(fields, 'text', /\btitle\b/i), title, shift.provider);
    // Signature is signed with the staff member's initials (e.g. "H.T.").
    // Single-word names are signed with the name itself.
    const nameParts = providerName.split(/\s+/).filter(Boolean);
    const signature = nameParts.length > 1 ? nameParts.map((p) => `${p[0].toUpperCase()}.`).join('') : providerName;
    add(findField(fields, 'text', /^staff signature$/i) ?? findField(fields, 'text', /signature(?! date)/i), signature, shift.provider);
  }
  if (shift.date) add(findField(fields, 'text', /^signature date$/i), shift.date, shift.date);

  // ---- Activities ----------------------------------------------------------
  // Explicit labels first ("Individual Activity: …"), heuristics as fallback.
  const explicitActivity = (kind: string): { value: string; evidence: string } | undefined => {
    const re = new RegExp(`^[●•*\\s-]*${kind}\\s+Activit(?:y|ies)\\s*:\\s*(.+)$`, 'i');
    for (const s of sentences) {
      const m = s.match(re);
      if (m && m[1].trim()) return { value: m[1].trim(), evidence: s };
    }
    return undefined;
  };
  for (const kind of ['Individual', 'Group', 'Community'] as const) {
    const explicit = explicitActivity(kind);
    if (explicit) {
      add(findField(fields, 'text', new RegExp(`^${kind} activity$`, 'i')), explicit.value, explicit.evidence);
      consumed.add(explicit.evidence);
    }
  }

  const communitySentence = sentences.find(
    (s) =>
      /\b(?:outing|community|park|mall|shopping|store|goodwill|good will|river|library|church|day support|day program|taxi|walk(?:ed|ing)?|went out|go out|going out|restaurant|theat(?:er|re)|bowling|trip|zoo|museum)\b/i.test(s) &&
      !NOT_OUT.test(s) &&
      !INTENT.test(s),
  );
  if (communitySentence) add(findField(fields, 'text', /^community activity$/i), communitySentence, communitySentence);

  const groupSentence = sentences.find((s) =>
    /\b(?:group activit\w*|with (?:his )?peers|peers?|group session|group game|housemates?|roommates?|friends?|with (?:the )?others?|everyone|together)\b/i.test(s),
  );
  if (groupSentence) add(findField(fields, 'text', /^group activity$/i), groupSentence, groupSentence);

  const individualSentence = sentences.find((s) =>
    /\b(?:independently|on his own|on her own|his own|his won|by himself|by herself|himself|alone|watch(?:ed|ing) (?:a |the |his )?(?:movie|tv|game show|show|video)s?|played (?:his |the )?(?:guitar|video games?|games?)|took a nap|nap|relax(?:ed|ing)?|read(?:ing)? (?:a |his )?(?:book|magazine)|listen(?:ed|ing)? to music|music|puzzle|drawing|coloring|drew|sketch\w*|art ?work)\b/i.test(s),
  );
  if (individualSentence) add(findField(fields, 'text', /^individual activity$/i), individualSentence, individualSentence);

  // ---- Support sections --------------------------------------------------
  // Group sentences into per-section blocks: a block starts at a sentence
  // matching a section label ("Outcome 2 (Community Inclusion): …") and ends
  // with its "Type of Support: X." sentence (or at the next label).
  const active = activeRules(fields, spec);
  const incidentOnly = sentences.length > 0 && sentences.every((s) =>
    /\b(?:altercation|fight(?:ing)?|911|police|water bottles?|incident report|emergency|aggressi\w*)\b/i.test(s),
  );
  const sectionBlocks = new Map<number, string[]>();
  let openBlock: { idx: number; buf: string[] } | null = null;
  const closeBlock = (): void => {
    if (openBlock && !sectionBlocks.has(openBlock.idx)) sectionBlocks.set(openBlock.idx, openBlock.buf);
    openBlock = null;
  };
  for (const s of sentences) {
    const startIdx = active.findIndex((a) => a.label.test(s));
    if (startIdx >= 0) {
      closeBlock();
      openBlock = { idx: startIdx, buf: [s] };
      if (EXPLICIT_SUPPORT_TYPE.test(s)) closeBlock();
      continue;
    }
    if (openBlock) {
      openBlock.buf.push(s);
      if (/^Type of Support/i.test(s) || openBlock.buf.length >= 6) closeBlock();
    }
  }
  closeBlock();

  for (let ruleIdx = 0; ruleIdx < active.length; ruleIdx++) {
    const { rule, label, ref, typeField, docField } = active[ruleIdx];
    if (incidentOnly && rule.topic !== 'behavior') continue;
    const keywords = forPerson(rule.keywords, person);

    // Authored/binder block first, then explicit reference, then keywords.
    const block = sectionBlocks.get(ruleIdx) ?? [];
    let relevant = block;
    if (relevant.length === 0 && ref) relevant = sentences.filter((s) => ref.test(s));
    if (relevant.length === 0) {
      relevant = sentences.filter(
        (s) =>
          keywords.test(s) &&
          !(rule.exclude && rule.exclude.test(s)) &&
          !(rule.ignore && rule.ignore.test(s)) &&
          !((rule.topic === 'meals' || rule.topic === 'money') && /\bfood\s+bank\b/i.test(s)) &&
          !(rule.topic === 'dehydration' && /\bwater bottles?\b/i.test(s)),
      );
    }
    if (relevant.length === 0 && rule.exclude) {
      // Only a negated mention ("did not go to the day support"): the outing
      // was declined/skipped rather than not scheduled.
      const declined = sentences.find(
        (s) => keywords.test(s) && rule.exclude!.test(s) && !(rule.ignore && rule.ignore.test(s)),
      );
      if (declined) {
        if (docField) add(docField, declined, declined);
        const option = typeField?.options?.find((o) => /^Choose not to/i.test(o));
        if (typeField && option) add(typeField, option, declined);
      }
      continue;
    }
    if (relevant.length === 0) continue;
    // Only labeled binder blocks are structured data; keyword-matched prose
    // stays in the narrative.
    for (const s of block) consumed.add(s);

    if (docField) {
      // Strip the section label prefix and drop pure "Type of Support" meta
      // sentences so the documentation reads as narrative. Free-form notes
      // can match many lines; keep the box to a readable length.
      const docSentences = relevant
        .map((s, i) => (i === 0 ? s.replace(label, '').trim() : s))
        .filter((s) => s && !/^Type of Support/i.test(s));
      const picked: string[] = [];
      let length = 0;
      for (const s of docSentences.length > 0 ? docSentences : relevant) {
        if (picked.length > 0 && length + s.length > 320) break;
        picked.push(s);
        length += s.length + 1;
      }
      add(docField, picked.join(' '), relevant[0]);
    }
    if (typeField && typeField.options && typeField.options.length > 0) {
      const picked = pickSupportType(typeField.options, relevant, rule.outOfFacilityFirst ? OUT_OF_FACILITY : undefined, person);
      // No cue at all -> the completion policy picks the section default.
      if (picked) add(typeField, picked.option, picked.evidence);
    }
  }

  // ---- End-of-shift yes/no questions --------------------------------------
  const yesNo = (
    namePattern: RegExp,
    explicitLabel: RegExp,
    yes: RegExp | null,
    no: RegExp | null,
    prefer?: RegExp,
  ): void => {
    const radio = fields.find(
      (f) => (f.type === 'radio' || f.type === 'dropdown') && namePattern.test(f.name) && !/explanation/i.test(f.name),
    );
    if (!radio || !radio.options) return;
    const explain = fields.find((f) => f.type === 'text' && namePattern.test(f.name) && /explanation/i.test(f.name));
    const yesOpt = radio.options.find((o) => /^yes$/i.test(o));
    const noOpt = radio.options.find((o) => /^no$/i.test(o));

    // Explicit authored answer ("Medications received: Yes — …") wins.
    for (const s of sentences) {
      const m = s.match(explicitLabel);
      if (m) {
        const answer = /^y/i.test(m[1]) ? yesOpt : noOpt;
        if (answer) {
          add(radio, answer, s);
          consumed.add(s);
          const detail = (m[2] ?? '').trim();
          if (explain) add(explain, detail.length > 3 ? detail : s, s);
          return;
        }
      }
    }

    // When several sentences say "yes", explain with the most specific one
    // (the symptom line, the incident-report line) rather than the first.
    const yesSentence = yes
      ? (prefer ? sentences.find((s) => yes.test(s) && prefer.test(s)) : undefined) ?? sentences.find((s) => yes.test(s))
      : undefined;
    const noSentence = no ? sentences.find((s) => no.test(s)) : undefined;
    if (yesSentence && yesOpt) {
      add(radio, yesOpt, yesSentence);
      if (explain) add(explain, yesSentence, yesSentence);
    } else if (noSentence && noOpt) {
      add(radio, noOpt, noSentence);
      if (explain) add(explain, noSentence, noSentence);
    }
  };

  yesNo(
    /medication received/i,
    /^[●•*\s-]*(?:any\s+)?medications?(?:\(s\))?\s+received[^:]{0,40}:\s*(yes|no)\b[\s.,:;—–-]*(.*)$/i,
    /\b(?:administered .{0,40}(?:medication|insulin|dose)|medication(?:s)? (?:was|were)? ?(?:administered|given|taken)|med pass|gave .{0,30}(?:medication|insulin|meds)|took (?:his |her )?(?:medication|meds|pills|insulin)|meds? (?:given|taken|done|completed))\b/i,
    /\bno medications? (?:were |was )?(?:administered|given|scheduled|due)\b/i,
  );
  yesNo(
    /medical complaint/i,
    /^[●•*\s-]*(?:any\s+)?medical\s+complaints?[^:]{0,40}:\s*(yes|no)\b[\s.,:;—–-]*(.*)$/i,
    HEALTH_EVENT,
    /\b(?:no (?:medical )?complaints?|voiced no complaints?|no signs of (?:pain|discomfort)|denied (?:any )?(?:pain|discomfort))\b/i,
    /\b(?:complained|bleed\w*|in pain|sore|swollen|bruis\w*|had a seizure|vomit\w*|fever|(?:was|felt|feeling) (?:sick|ill|unwell|dizzy|nauseous))\b/i,
  );
  yesNo(
    /behavioral difficulty/i,
    /^[●•*\s-]*(?:any\s+)?behavioral\s+(?:difficulty|difficulties|issues?|concerns?)[^:]{0,40}:\s*(yes|no)\b[\s.,:;—–-]*(.*)$/i,
    /\b(?:behavioral (?:difficulty|incident|outburst|issue)|refused .{0,30}(?:care|medication|meal)|became (?:aggressive|agitated|upset)|(?:was|felt|fled|feeling) (?:so |very |really )?(?:sad|upset|angry|anxious|frustrated|agitated)|cried|crying|yell\w*|scream\w*|meltdown|tantrum|aggressi\w*|fight|fought|fighting|altercation|physical (?:confrontation|dispute)|(?:hit|punched|struck|shoved|pushed|kicked) (?:him|steven?|each other|his housemate|the other)|(?:was|got) (?:hit|punched|struck|shoved|pushed|kicked)|argument|heated (?:disagreement|exchange)|disagreement (?:that )?(?:escalated|turned|led))\b/i,
    /\b(?:no behavioral (?:difficulties|issues|concerns)|excellent behavioral baseline|behavioral baseline|no (?:issues|concerns) (?:were )?noted)\b/i,
  );
  yesNo(
    /serious incident/i,
    /^[●•*\s-]*(?:any\s+)?serious\s+incidents?[^:]{0,40}:\s*(yes|no)\b[\s.,:;—–-]*(.*)$/i,
    /\b(?:serious incident|incident report|emergency (?:services|room)|hospitali[sz]\w*|(?:to|at) the hospital|urgent care|911|ambulance|police|(?:fall|fell) (?:and|with) (?:injur\w*|hit)|unresponsive|went missing|elope\w*|choking incident|had a seizure|seizure (?:occurred|happened|lasted)|(?:tonic|grand mal|generalized) seizure|fight|fought|fighting|altercation|assault\w*|physical aggression|(?:was|got) (?:hit|punched|struck|shoved|pushed|kicked)|(?:broke|broken|chipped|knocked out) (?:his |a |two |several )?(?:front )?(?:teeth|tooth))\b/i,
    /\b(?:no (?:serious )?incidents?|no concerns were noted|remained safe|stayed comfortable and secure|safe throughout)\b/i,
    /\b(?:incident report|911|ambulance|emergency (?:services|room)|(?:to|at) the hospital|police)\b/i,
  );

  const incidentLine = sentences.find((s) =>
    /\b(?:911|police|altercation|fought|fighting|fight|aggressi\w*|incident report|emergency)\b/i.test(s),
  );
  if (incidentLine) {
    const missing: string[] = [];
    if (!/\b(?:injur\w*|hurt|pain|bleed\w*|no injuries|without injury)\b/i.test(narrative)) missing.push('injury status');
    if (!/\b(?:staff|worker|intervened|separated|redirected|brought back|transported)\b/i.test(narrative)) missing.push('staff intervention');
    if (!/\b(?:outcome|resolved|arrested|transported|returned|remained|responded)\b/i.test(narrative)) missing.push('outcome');
    if (missing.length > 0) warnings.push(`Incident review needed: ${missing.join(', ')} not supplied in the source.`);
  }

  // A health or injury mention must reach the reviewer even when the notes
  // do not say whether an incident report was filed.
  const healthLine = sentences.find((s) => HEALTH_EVENT.test(s));
  if (healthLine) {
    warnings.push(
      `Health/injury mention: "${truncateEvidence(healthLine)}" — Medical Complaints set to Yes; confirm whether the Serious Incident answer should change.`,
    );
  }

  // ---- Narrative ---------------------------------------------------------
  // Free-text prose only; falls back to the full text when everything in the
  // shift was structured (so the field is never left blank).
  if (narrative) {
    const prose = sentences.filter((s) => !consumed.has(s));
    // Word logs keep one note per line; prose logs stay a paragraph.
    const value = prose.length > 0 ? prose.join(narrative.includes('\n') ? '\n' : ' ') : narrative;
    add(
      findField(fields, 'text', /narrative/i) ?? findField(fields, 'text', /progress note/i),
      value,
      truncateEvidence(prose[0] ?? sentences[0] ?? narrative),
    );
  }

  log.info(
    `local-mapped ${shift.date} ${shift.shift}: ${assignments.length} assignment(s), ${warnings.length} warning(s)`,
  );
  return { assignments, warnings };
}
