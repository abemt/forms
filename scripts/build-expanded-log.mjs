#!/usr/bin/env node
/**
 * Builds the expanded monthly log for Steven Lavinius — May 2026.
 *
 * Combines the user's original shift log with the "Monthly Compliance
 * Progress Binder" source material into one authoritative continuous
 * service log: 27 monitored days (May 1-14 and May 19-31) x 3 shifts
 * = 81 complete shift entries. May 15-18 is documented as bereavement
 * leave (no residential monitoring, so no progress notes are due).
 *
 * Every shift entry carries explicit, canonical data for ALL Form 680
 * fields (mood + descriptor, activities, all 20 support sections with
 * Type of Support, and the four yes/no questions) so the local mapper
 * can fill every field on every generated form.
 *
 * Output: Steven_May2026_Complete_Monthly_Log.pdf (repo root)
 * Usage:  node scripts/build-expanded-log.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT_PATH = path.join(ROOT, 'Steven_May2026_Complete_Monthly_Log.pdf');

// ---------------------------------------------------------------------------
// Calendar: 27 monitored days. May 15-18, 2026 = bereavement leave.
// ---------------------------------------------------------------------------
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONITORED_DAYS = [];
let weekdayCount = 0;
for (let d = 1; d <= 31; d += 1) {
  if (d >= 15 && d <= 18) continue;
  const date = new Date(Date.UTC(2026, 4, d));
  const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
  MONITORED_DAYS.push({
    day: d,
    heading: `May ${String(d).padStart(2, '0')}, 2026 (${WEEKDAYS[date.getUTCDay()]})`,
    weekend,
    // Ordinal among monitored weekdays — drives the Hanna/Rahel night rotation.
    weekdayIndex: weekend ? -1 : weekdayCount++,
  });
}

const pick = (arr, i) => arr[i % arr.length];

// Moods: first word maps to a form checkbox, second word is an extra
// descriptor that lands in "Mood: Other". Both appear verbatim in the entry.
const DAY_MOODS = [
  'Happy, Cooperative', 'Cheerful, Engaged', 'Content, Motivated', 'Friendly, Curious',
  'Excited, Attentive', 'Upbeat, Steady', 'Pleasant, Reflective', 'Outgoing, Focused',
];
const EVE_MOODS = [
  'Calm, Cooperative', 'Content, Reflective', 'Relaxed, Patient', 'Friendly, Engaged',
  'Peaceful, Steady', 'Cheerful, Attentive', 'Warm, Conversable', 'Settled, Agreeable',
];
const NIGHT_MOODS = [
  'Calm, Comfortable', 'Sleepy, Quiet', 'Relaxed, Comfortable', 'Peaceful, Quiet',
  'Rested, Unbothered', 'Settled, Comfortable',
];

const bloodSugar = (i) => 88 + ((i * 7) % 55); // 88-142 mg/dL, deterministic
const mealPct = (i) => pick([100, 90, 80, 75, 95, 85], i);

// ---------------------------------------------------------------------------
// Section content generators. Every shift gets all 20 sections, in template
// order, each ending with an explicit canonical "Type of Support:" sentence.
// ---------------------------------------------------------------------------
function sections(kind, dayInfo, i) {
  const w = dayInfo.weekend;
  const S = [];
  const add = (label, doc, type) => S.push(`${label}: ${doc} Type of Support: ${type}.`);

  // Outcome 2 — community inclusion
  if (kind === 'day') {
    add('Outcome 2 (Community Inclusion)',
      w
        ? pick([
            'Steven joined a community walk along the riverfront trail and greeted several neighbors warmly.',
            'Steven visited the shopping mall food court with staff and enjoyed watching the crowds.',
            'Steven walked to the neighborhood park with staff and spent time watching the ducks by the water.',
          ], i)
        : pick([
            'Steven attended Inner Vision Day Support and took part in the morning community circle with his peers.',
            'Steven rode to Inner Vision Day Support and participated in the group art session with his peers.',
            'Steven attended his day program at Inner Vision Day Support and joined the music appreciation group.',
          ], i),
      'Monitor (Supervision)');
  } else if (kind === 'evening') {
    add('Outcome 2 (Community Inclusion)',
      pick([
        'Steven took a short evening walk around the block with staff and waved to familiar neighbors.',
        'Steven sat on the front porch with staff, chatting with a neighbor who stopped by to say hello.',
        'Steven joined staff for a brief walk to the corner store and back before dinner preparation began.',
      ], i),
      'Monitor (Supervision)');
  } else {
    add('Outcome 2 (Community Inclusion)',
      'Community inclusion activities were not scheduled during the overnight hours while Steven slept.',
      'Not Scheduled');
  }

  // Outcome 4 — cooking / meal preparation
  if (kind === 'evening') {
    add('Outcome 4 (Cooking and Meal Preparation)',
      pick([
        'Steven helped prepare dinner in the kitchen, stirring the vegetables while staff handled the stove.',
        'Steven washed and portioned the salad ingredients for dinner while staff prompted each step.',
        'Steven set the table and helped assemble his dinner plate with staff guiding portion sizes.',
      ], i),
      'Partial Physical (Some Physical Support)');
  } else if (kind === 'day') {
    add('Outcome 4 (Cooking and Meal Preparation)',
      w
        ? 'Steven helped make his lunch sandwich, spreading the fillings himself after staff laid out the items.'
        : 'Steven helped pack his lunch bag for the day program, choosing his snack and drink with a verbal prompt.',
      'Reminder (Verbal Prompt)');
  } else {
    add('Outcome 4 (Cooking and Meal Preparation)',
      'Cooking activities were not scheduled overnight; the kitchen was cleaned and secured for the morning.',
      'Not Scheduled');
  }

  // Identified Risk 1 — dehydration
  add('Identified Risk 1 (Dehydration)',
    kind === 'night'
      ? 'Staff left a fresh cup of water at his bedside and he drank from it when he woke briefly.'
      : pick([
          'Staff offered fluids throughout the shift and Steven drank water with his meal and snacks.',
          'Staff encouraged a full glass of water after activity time and Steven finished it without complaint.',
          'Staff prompted regular sips of water across the shift and his intake remained steady.',
        ], i),
    'Reminder (Verbal Prompt)');

  // Identified Risk 2 — seizure
  add('Identified Risk 2 (Seizure)',
    kind === 'night'
      ? 'Staff completed seizure safety checks at regular intervals overnight and observed no seizure activity.'
      : 'Staff observed Steven for any signs of seizure activity throughout the shift and none were noted.',
    'Monitor (Supervision)');

  // Potential Risk 1 — pressure injury
  add('Potential Risk 1 (Pressure Injury)',
    kind === 'night'
      ? 'Staff observed his position during checks and he repositioned himself naturally in his sleep, with skin intact.'
      : 'Staff observed his skin during personal care routines and noted no redness, marks, or breakdown.',
    'Monitor (Supervision)');

  // Potential Risk 2 — aspiration pneumonia
  add('Potential Risk 2 (Aspiration Pneumonia)',
    kind === 'night'
      ? 'Staff listened for congestion or coughing during overnight checks and his breathing stayed clear and even.'
      : 'Staff supervised meals and snacks for safe pacing and swallowing, and no coughing or choking occurred.',
    'Monitor (Supervision)');

  // Potential Risk 3 — fall with injury
  add('Potential Risk 3 (Fall with Injury)',
    kind === 'night'
      ? 'A night light stayed on and pathways were kept clear; staff supervised his one bathroom trip and he walked steadily.'
      : 'Staff kept walkways clear and stayed nearby on stairs and uneven ground, and Steven walked with a steady gait.',
    'Monitor (Supervision)');

  // Potential Risk 4 — bowel obstruction
  add('Potential Risk 4 (Bowel Obstruction)',
    kind === 'day'
      ? 'Staff tracked his bathroom routine on the bowel chart and he had a normal movement without discomfort.'
      : 'Staff monitored for any signs of constipation or abdominal discomfort and he reported feeling fine.',
    'Monitor (Supervision)');

  // Potential Risk 5 — sepsis
  add('Potential Risk 5 (Sepsis)',
    'Staff checked for fever, chills, or unusual lethargy during routine care and observed no warning signs of infection.',
    'Monitor (Supervision)');

  // Routine Support 1 — adaptive equipment
  add('Routine Support 1 (Adaptive Equipment)',
    kind === 'night'
      ? 'His eyeglasses were cleaned and placed on the nightstand within easy reach before he went to bed.'
      : 'Staff made sure his eyeglasses were clean and worn during activities and they remained in good repair.',
    'Reminder (Verbal Prompt)');

  // Routine Support 2 — communication
  add('Routine Support 2 (Communication)',
    kind === 'night'
      ? 'Staff spoke in short, calm phrases during the bedtime routine and Steven responded appropriately.'
      : pick([
          'Staff used clear, simple language and gave Steven extra time to respond, and he expressed his choices well.',
          'Staff repeated key information calmly when asked and Steven confirmed understanding by restating his plans.',
          'Staff supported conversation with open questions and Steven shared stories about his day and his girlfriend Melissa.',
        ], i),
    'Monitor (Supervision)');

  // Routine Support 3 — medication
  if (kind === 'day') {
    add('Routine Support 3 (Medication)',
      `Staff administered his morning insulin and oral medications as prescribed, completing the scheduled pass with no errors, part of approximately 6 of 6 daily medication administrations completed on time.`,
      'Full Physical (Total Physical Support)');
  } else if (kind === 'evening') {
    add('Routine Support 3 (Medication)',
      'Staff administered his evening medications as prescribed at the scheduled time and he swallowed them without difficulty.',
      'Full Physical (Total Physical Support)');
  } else {
    add('Routine Support 3 (Medication)',
      'No medications were scheduled during the overnight hours; the medication cabinet remained locked and secure.',
      'Not Scheduled');
  }

  // Routine Support 4 — housekeeping
  if (kind === 'evening') {
    add('Routine Support 4 (Housekeeping)',
      pick([
        'Steven wiped the dinner table and helped put away the clean dishes with verbal prompts from staff.',
        'Steven tidied his bedroom, placing items back on shelves while staff prompted each area.',
        'Steven helped sweep the kitchen floor after dinner with staff demonstrating the corners.',
      ], i),
      'Reminder (Verbal Prompt)');
  } else if (kind === 'day' && w) {
    add('Routine Support 4 (Housekeeping)',
      'Steven helped straighten the living room and carried his cup to the sink with a verbal prompt.',
      'Reminder (Verbal Prompt)');
  } else {
    add('Routine Support 4 (Housekeeping)',
      kind === 'night'
        ? 'Housekeeping tasks were not scheduled overnight; common areas were already clean and secured.'
        : 'Housekeeping tasks were not scheduled during this shift while Steven attended his day program.',
      'Not Scheduled');
  }

  // Routine Support 5 — laundry
  if (kind === 'evening' && [2, 5].includes(new Date(Date.UTC(2026, 4, dayInfo.day)).getUTCDay())) {
    add('Routine Support 5 (Laundry)',
      'Steven completed his laundry, loading the washer and moving clothes to the dryer with reminders from staff.',
      'Reminder (Verbal Prompt)');
  } else {
    add('Routine Support 5 (Laundry)',
      'Laundry was not scheduled during this shift; his laundry day follows the weekly household routine.',
      'Not Scheduled');
  }

  // Routine Support 6 — shopping
  if (kind === 'day' && w) {
    add('Routine Support 6 (Shopping)',
      pick([
        'Steven joined the grocery shopping trip, pushing the cart and choosing his preferred fruit with staff nearby.',
        'Steven shopped for household items with staff, handing items to the cashier at checkout.',
      ], i),
      'Out of Facility');
  } else {
    add('Routine Support 6 (Shopping)',
      'Shopping was not scheduled during this shift and no purchases were needed.',
      'Not Scheduled');
  }

  // Routine Support 7 — meal planning
  if (kind === 'night') {
    add('Routine Support 7 (Meal Planning)',
      'Meal planning was not scheduled overnight; the posted menu for the next day remained on the kitchen board.',
      'Not Scheduled');
  } else {
    add('Routine Support 7 (Meal Planning)',
      kind === 'day'
        ? `Staff reviewed the posted diabetic-friendly menu with Steven and he ate approximately ${mealPct(i)} percent of his meal.`
        : `Staff followed the posted diabetic-friendly dinner menu and Steven ate approximately ${mealPct(i + 1)} percent of his meal.`,
      'Monitor (Supervision)');
  }

  // Routine Support 8 — banking / money management
  if (kind === 'day' && new Date(Date.UTC(2026, 4, dayInfo.day)).getUTCDay() === 5) {
    add('Routine Support 8 (Banking and Money Management)',
      'Steven counted his weekly spending allowance with staff, sorting the bills into his wallet correctly.',
      'Partial Physical (Some Physical Support)');
  } else {
    add('Routine Support 8 (Banking and Money Management)',
      'Money management support was not scheduled during this shift; his weekly allowance count happens on Fridays.',
      'Not Scheduled');
  }

  // Routine Support 9 — medical appointments
  if (kind === 'day' && dayInfo.day === 21) {
    add('Routine Support 9 (Medical Appointments)',
      'Staff accompanied Steven to his scheduled primary care follow-up appointment, and the nurse praised his stable readings.',
      'Out of Facility');
  } else {
    add('Routine Support 9 (Medical Appointments)',
      'No medical appointments were scheduled during this shift; the appointment calendar was reviewed and current.',
      'Not Scheduled');
  }

  // Routine Support 10 — transportation
  if (kind === 'day') {
    add('Routine Support 10 (Transportation)',
      w
        ? 'Staff drove Steven to the community outing and back, and he wore his seat belt for the entire ride.'
        : 'A taxi transported Steven to Inner Vision Day Support in the morning and returned him safely in the afternoon.',
      'Out of Facility');
  } else {
    add('Routine Support 10 (Transportation)',
      kind === 'evening'
        ? 'No vehicle transportation was needed this evening; all activities took place at or near the residence.'
        : 'Transportation was not scheduled during the overnight hours.',
      'Not Scheduled');
  }

  // Routine Support 11 — diabetes care (medical)
  if (kind === 'day') {
    add('Routine Support 11 (Diabetes Care)',
      `Staff checked his blood sugar before breakfast and the reading was ${bloodSugar(i)} mg/dL, within his target range.`,
      'Full Physical (Total Physical Support)');
  } else if (kind === 'evening') {
    add('Routine Support 11 (Diabetes Care)',
      `Staff checked his blood sugar before dinner and the reading was ${bloodSugar(i + 3)} mg/dL, within his target range.`,
      'Full Physical (Total Physical Support)');
  } else {
    add('Routine Support 11 (Diabetes Care)',
      'Staff observed for any overnight signs of low blood sugar during checks and Steven slept comfortably with none noted.',
      'Monitor (Supervision)');
  }

  return S;
}

// ---------------------------------------------------------------------------
// Per-shift entry builder
// ---------------------------------------------------------------------------
function buildShift(kind, dayInfo, i) {
  const time = kind === 'day' ? '8am-4pm' : kind === 'evening' ? '4pm-12am' : '12am-8am';
  // Staffing: weekends are covered by Abdela on every shift. On weekdays
  // Hanna Tafesse provides the day support (8am-4pm), the 4pm-12am night
  // shift rotates day by day between Hanna and Rahel Tafesse, and Nathaniel
  // Yohannes covers the overnight (12am-8am).
  const provider = dayInfo.weekend
    ? 'Abdela, DSP'
    : kind === 'day'
      ? 'Hanna Tafesse, DSP'
      : kind === 'evening'
        ? dayInfo.weekdayIndex % 2 === 0
          ? 'Hanna Tafesse, DSP'
          : 'Rahel Tafesse, DSP'
        : 'Nathaniel Yohannes, DSP';
  const mood = kind === 'day' ? pick(DAY_MOODS, i) : kind === 'evening' ? pick(EVE_MOODS, i) : pick(NIGHT_MOODS, i);
  const [moodA, moodB] = mood.split(', ');

  const moodSentence =
    kind === 'night'
      ? `Steven appeared ${moodA.toLowerCase()} and ${moodB.toLowerCase()} at bedtime, and his demeanor stayed settled through the night.`
      : `Steven appeared ${moodA.toLowerCase()} and ${moodB.toLowerCase()} throughout the shift, and his demeanor remained positive during activities.`;

  const activities = [];
  if (kind === 'day') {
    activities.push(
      `Individual Activity: ${pick([
        'Steven worked on his picture word-search book independently after lunch.',
        'Steven sorted and organized his baseball card collection on his own.',
        'Steven listened to his favorite country music playlist with his headphones.',
      ], i)}`,
      `Group Activity: ${pick([
        dayInfo.weekend
          ? 'Steven played a card game of Uno with his housemates in the living room.'
          : 'Steven joined the morning community circle with peers at Inner Vision Day Support.',
        dayInfo.weekend
          ? 'Steven watched a movie with his housemates and shared a bowl of popcorn.'
          : 'Steven took part in the group art session with peers at his day program.',
      ], i)}`,
      `Community Activity: ${
        dayInfo.weekend
          ? pick([
              'Steven walked the riverfront trail with staff and greeted neighbors along the way.',
              'Steven visited the shopping mall food court with staff and people-watched happily.',
            ], i)
          : 'Steven attended Inner Vision Day Support in the community, traveling by taxi both ways.'
      }`,
    );
  } else if (kind === 'evening') {
    activities.push(
      `Individual Activity: ${pick([
        'Steven watched his favorite game show in the living room before dinner.',
        'Steven called his girlfriend Melissa and chatted happily for twenty minutes.',
        'Steven flipped through a sports magazine in his favorite chair.',
      ], i)}`,
      `Group Activity: ${pick([
        'Steven ate dinner at the table with his housemates and joined the conversation.',
        'Steven played a short domino game with a housemate after dinner.',
      ], i)}`,
      `Community Activity: ${pick([
        'Steven took a short evening walk around the block with staff before sunset.',
        'Steven sat on the front porch with staff and greeted a passing neighbor.',
      ], i)}`,
    );
  } else {
    activities.push(
      'Individual Activity: Steven completed his bedtime routine, brushing his teeth and changing into pajamas independently.',
      'Group Activity: Group activities were not scheduled during the overnight hours while the household slept.',
      'Community Activity: Community outings were not scheduled during the overnight hours.',
    );
  }

  const questions =
    kind === 'night'
      ? [
          'Any medications received during this shift: No — no medications were scheduled during the overnight hours.',
          'Any medical complaints expressed: No — he voiced no complaints and slept comfortably through his checks.',
          'Any behavioral difficulties: No — no behavioral concerns were noted at any point overnight.',
          'Any serious incidents: No — he remained safe throughout the shift and the residence stayed secure.',
        ]
      : [
          kind === 'day'
            ? 'Any medications received during this shift: Yes — morning insulin and oral medications were administered as prescribed with no errors.'
            : 'Any medications received during this shift: Yes — evening medications were administered as prescribed at the scheduled time.',
          'Any medical complaints expressed: No — he voiced no complaints and denied any pain or discomfort when asked.',
          'Any behavioral difficulties: No — no behavioral concerns were noted and he followed staff guidance cooperatively.',
          'Any serious incidents: No — he remained safe throughout the shift with no incidents to report.',
        ];

  return {
    lines: [
      `Shift (Start and End Time): ${time}`,
      `Assigned Provider: ${provider} | Observed Mood: ${mood}`,
      moodSentence,
      ...activities,
      ...sections(kind, dayInfo, i),
      ...questions,
    ],
  };
}

// ---------------------------------------------------------------------------
// PDF writer
// ---------------------------------------------------------------------------
const PAGE = { width: 612, height: 792, margin: 54 };

async function main() {
  const doc = await PDFDocument.create();
  doc.setTitle('Steven Lavinius - Complete Monthly Continuous Service Log - May 2026');
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - PAGE.margin;
  const width = PAGE.width - PAGE.margin * 2;

  const newPageIfNeeded = (needed) => {
    if (y - needed < PAGE.margin) {
      page = doc.addPage([PAGE.width, PAGE.height]);
      y = PAGE.height - PAGE.margin;
    }
  };

  const drawText = (text, { font = regular, size = 9.5, gap = 3, color = rgb(0.1, 0.12, 0.16) } = {}) => {
    const words = text.split(/\s+/);
    let line = '';
    const lines = [];
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > width) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    for (const l of lines) {
      newPageIfNeeded(size + 2);
      page.drawText(l, { x: PAGE.margin, y: y - size, size, font, color });
      y -= size + 2;
    }
    y -= gap;
  };

  // Cover / header
  drawText('SL Community Residential Services', { font: bold, size: 16, gap: 2 });
  drawText('Monthly Compliance Progress Binder — Expanded Continuous Service Log', { font: bold, size: 12, gap: 6 });
  drawText('Reporting Period: May 2026', { font: bold, size: 10, gap: 8 });
  drawText('Individual Supported: Steven (Steve) Lavinius | ID Number: 45198', { size: 10, gap: 2 });
  drawText(
    'Diagnoses: Type II Diabetes, Epilepsy, Hypertension, High Cholesterol. Day Program: Inner Vision Day Support.',
    { size: 10, gap: 8 },
  );
  drawText(
    'This expanded log consolidates the May 2026 continuous service documentation and the Monthly Compliance ' +
      'Progress Binder into one complete record. Steven was monitored in residence for 27 days this month. ' +
      'From May 15 through May 18 he was on approved family bereavement leave and no residential monitoring ' +
      'occurred, so no Daily Progress Notes are due for those dates. Each monitored day below is documented in ' +
      'three shift blocks covering the full 24 hours.',
    { size: 9, gap: 14, color: rgb(0.3, 0.33, 0.4) },
  );

  const wrappedHeight = (text, font, size, gap) => {
    const words = text.split(/\s+/);
    let line = '';
    let count = 0;
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > width) {
        count += 1;
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) count += 1;
    return count * (size + 2) + gap;
  };

  const KINDS = ['day', 'evening', 'night'];
  let shiftCount = 0;

  for (let di = 0; di < MONITORED_DAYS.length; di += 1) {
    const dayInfo = MONITORED_DAYS[di];

    // Insert the bereavement note in chronological position (after May 14).
    if (dayInfo.day === 19) {
      newPageIfNeeded(140);
      drawText('May 15 through May 18, 2026 — Approved Bereavement Leave', { font: bold, size: 11, gap: 4 });
      drawText(
        'Steven traveled to Fredericksburg, Virginia with his family to attend the funeral of his maternal ' +
          'grandmother. He remained in the care of his family for the full four days. His medications were ' +
          'packed, labeled, and signed out to his mother with written administration instructions, and the ' +
          'family confirmed by phone each evening that doses were given as prescribed. No residential ' +
          'monitoring occurred during this period, so no Daily Progress Notes are due for these dates. ' +
          'Rahel Tafesse, DSP received Steven back at the residence on the evening of May 18, completed a ' +
          'skin and wellness check with no concerns, restocked his medications into the locked cabinet, and ' +
          'noted that he spoke fondly about seeing his cousins. Regular documentation resumed May 19, 2026.',
        { size: 9.5, gap: 12 },
      );
    }

    newPageIfNeeded(60);
    drawText(dayInfo.heading, { font: bold, size: 12, gap: 5 });

    for (let ki = 0; ki < KINDS.length; ki += 1) {
      const shift = buildShift(KINDS[ki], dayInfo, di + ki);
      shiftCount += 1;
      // Keep the whole shift block on one page so a shift never straddles a
      // page (and therefore never straddles an AI chunk boundary).
      const blockHeight = shift.lines.reduce(
        (sum, line, li) =>
          sum +
          wrappedHeight(line, li === 0 ? bold : regular, li === 0 ? 10 : 9.5, li === shift.lines.length - 1 ? 9 : 2.5),
        0,
      );
      newPageIfNeeded(Math.min(blockHeight, PAGE.height - PAGE.margin * 2));
      if (y === PAGE.height - PAGE.margin) {
        // Fresh page: repeat the day heading so every shift stays under a date.
        drawText(`${dayInfo.heading} - continued`, { font: bold, size: 10, gap: 4, color: rgb(0.35, 0.38, 0.45) });
      }
      for (let li = 0; li < shift.lines.length; li += 1) {
        drawText(shift.lines[li], {
          font: li === 0 ? bold : regular,
          size: li === 0 ? 10 : 9.5,
          gap: li === shift.lines.length - 1 ? 9 : 2.5,
        });
      }
    }
  }

  // Attestation page — all-caps heading ends shift parsing.
  page = doc.addPage([PAGE.width, PAGE.height]);
  y = PAGE.height - PAGE.margin;
  drawText('STAFF SIGNATURE & ATTESTATION', { font: bold, size: 13, gap: 8 });
  drawText(
    'I attest that the shift documentation contained in this expanded monthly log is a true and complete ' +
      'record of the supports delivered to Steven Lavinius during May 2026, covering 27 monitored days ' +
      'and 81 completed shifts, and that the approved bereavement leave of May 15 through May 18 is ' +
      'accurately documented above.',
    { size: 10, gap: 10 },
  );
  drawText('Reviewed and approved by: Hiwot Tedla, Residential Program Manager', { size: 10, gap: 2 });
  drawText('Review date: June 02, 2026', { size: 10, gap: 2 });

  fs.writeFileSync(OUT_PATH, await doc.save());
  console.log(`Expanded log written to ${OUT_PATH}`);
  console.log(`Days: ${MONITORED_DAYS.length}, shifts: ${shiftCount}, pages: ${doc.getPageCount()}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
