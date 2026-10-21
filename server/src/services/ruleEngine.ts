/**
 * Deterministic keyword rules derived from the Form §680 mapping specification.
 * These are ADVISORY: they are handed to the AI as grounding hints and never
 * check a box on their own. The AI must still supply verbatim evidence, which
 * the server validates before accepting an assignment.
 */

export interface CategoryRule {
  category: string;
  keywords: string[];
  guidance: string;
}

export const CATEGORY_RULES: CategoryRule[] = [
  {
    category: 'Mood: Happy',
    keywords: ['happy', 'content', 'excited', 'cheerful', 'upbeat', 'joyful', 'high spirits', 'good spirits'],
    guidance: 'Check the Happy / Content / Excited mood checkbox(es) that match.',
  },
  {
    category: 'Mood: Calm',
    keywords: ['calm', 'peaceful', 'relaxed', 'easygoing', 'settled', 'comfortable', 'serene'],
    guidance: 'Check the Calm mood checkbox.',
  },
  {
    category: 'Mood: Friendly/Outgoing',
    keywords: ['friendly', 'outgoing', 'chatty', 'sociable', 'talkative', 'greeting peers', 'greeted staff'],
    guidance: 'Check the Friendly and/or Outgoing mood checkboxes.',
  },
  {
    category: 'Hydration / Dehydration support',
    keywords: ['hydration', 'water', 'fluids', 'drink', 'dehydration', 'hydrated'],
    guidance: 'Fill the dehydration-support section (Identified Risk 1) with support type and documentation.',
  },
  {
    category: 'Medication support',
    keywords: ['medication', 'insulin', 'med pass', 'meds', 'administered', 'prescribed', 'dose', 'pill'],
    guidance:
      'Fill the medication-support section (Routine Support 3) and answer the medication-received question with an explanation.',
  },
  {
    category: 'Cooking / meal preparation (Outcome 4)',
    keywords: ['cooking', 'kitchen', 'meal preparation', 'meal prep', 'cooked', 'prepared', 'stir-fry', 'dinner', 'breakfast', 'lunch', 'diet', 'diabetic plan', 'grilled'],
    guidance: 'Fill Outcome 4 (cooking and meal planning) with support type and documentation.',
  },
  {
    category: 'Community activity (Outcome 2)',
    keywords: ['community', 'shopping', 'park', 'mall', 'river', 'walking', 'outing', 'stroll', 'drive', 'lakeside', 'store', 'library', 'church'],
    guidance: 'Fill Outcome 2 (community inclusion) and the Community Activity text field.',
  },
  {
    category: 'Housekeeping / laundry (Routine Support)',
    keywords: ['laundry', 'housekeeping', 'cleaning', 'chores', 'tidied', 'vacuum', 'folded clothes'],
    guidance: 'Fill the matching routine-support section (housekeeping or laundry).',
  },
  {
    category: 'Transportation',
    keywords: ['transportation', 'taxi', 'drive', 'drove', 'van', 'bus', 'picked up', 'dropped off', 'transported'],
    guidance: 'Fill the transportation routine-support section.',
  },
  {
    category: 'Seizure monitoring (Risk 2)',
    keywords: ['seizure', 'observation', 'monitoring', 'post-ictal', 'epilepsy', 'monitored'],
    guidance: 'Fill Identified Risk 2 (seizure) with support type and documentation.',
  },
  {
    category: 'Overnight monitoring',
    keywords: ['sleeping', 'night checks', 'bedtime', 'overnight', 'slept', 'asleep', 'nocturnal', 'safety checks'],
    guidance: 'Fill the overnight-monitoring documentation (typically Risk 2 documentation on overnight shifts).',
  },
  {
    category: 'Communication support',
    keywords: ['check-in', 'communication', 'talked', 'conversation', 'expressed', 'verbal'],
    guidance: 'Fill Routine Support 2 (communication support) when staff supported communication.',
  },
  {
    category: 'Glucometer / diabetes equipment',
    keywords: ['glucometer', 'glucose', 'blood sugar', 'diabetic baseline', 'sugar level'],
    guidance: 'Fill Routine Support 1 (adaptive equipment / glucometer).',
  },
  {
    category: 'Banking / money management',
    keywords: ['banking', 'money', 'budget', 'savings', 'allowance', 'spending'],
    guidance: 'Fill Routine Support 8 (banking and money management).',
  },
  {
    category: 'Medical appointment',
    keywords: ['appointment', 'doctor', 'physician', 'clinic', 'dentist', 'medical visit'],
    guidance: 'Fill Routine Support 9 (medical appointments).',
  },
];

export interface Hint {
  category: string;
  matched: string[];
  guidance: string;
}

/** Compute keyword hints found in a shift's combined text. */
export function computeHints(shiftText: string): Hint[] {
  const lower = shiftText.toLowerCase();
  const hints: Hint[] = [];
  for (const rule of CATEGORY_RULES) {
    const matched = rule.keywords.filter((k) => lower.includes(k));
    if (matched.length > 0) {
      hints.push({ category: rule.category, matched, guidance: rule.guidance });
    }
  }
  return hints;
}
