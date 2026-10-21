#!/usr/bin/env node
/**
 * Generates a small sample monthly shift-log PDF (3 days x 3 shifts = 9 shifts)
 * in the style of a real provider report, so the app can be tried without any
 * private data. Output: samples/Sample_ShiftLog_May2026.pdf
 *
 * Usage: npm run build && npm run make-samples
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = path.join(ROOT, 'samples');

const DAYS = [
  {
    heading: 'May 01, 2026 (Friday)',
    shifts: [
      {
        time: '8am-4pm',
        provider: 'Alex Morgan, DSP',
        mood: 'Happy, Outgoing',
        title: 'Day Program and Community Walk',
        narrative:
          'A taxi picked the individual up at 7:45 AM for the day support program. Staff at the ' +
          'center reported he was cheerful and chatty with peers throughout the morning session. ' +
          'After lunch, staff supported a short community walk in the park, and he greeted ' +
          'neighbors politely (Outcome 2). Staff encouraged him to drink a full glass of water ' +
          'after the walk to stay hydrated (Risk 1). He returned to the residence safely by taxi ' +
          'at 4:00 PM.',
      },
      {
        time: '4pm-12am',
        provider: 'Jordan Lee, DSP',
        mood: 'Calm, Content',
        title: 'Evening Cooking Practice',
        narrative:
          'The individual helped prepare dinner in the kitchen, practicing safe knife handling ' +
          'while staff provided verbal prompts (Outcome 4). Staff administered his evening ' +
          'medications at the scheduled time (Routine Support 3). After dinner he completed his ' +
          'laundry with reminders from staff (Routine Support 5). Staff observed him during the ' +
          'meal for any seizure or swallowing difficulty (Risk 2); none was noted.',
      },
      {
        time: '12am-8am',
        provider: 'Sam Rivera, DSP',
        mood: 'Calm, Sleepy',
        title: 'Overnight Observation',
        narrative:
          'The individual completed his bedtime routine independently and went to bed on time. ' +
          'Staff conducted routine overnight safety checks every hour, monitoring respiration and ' +
          'seizure status (Risk 2). He slept soundly through the night with no disruptions and no ' +
          'concerns were noted.',
      },
    ],
  },
  {
    heading: 'May 02, 2026 (Saturday)',
    shifts: [
      {
        time: '8am-4pm',
        provider: 'Alex Morgan, DSP',
        mood: 'Excited, Friendly',
        title: 'Weekend Shopping Outing',
        narrative:
          'Staff supported the individual on a shopping trip to the mall (Outcome 2, Routine ' +
          'Support 6). He selected his own items and paid at the register with partial physical ' +
          'support at the card terminal. He was excited and friendly with store staff. Staff ' +
          'reminded him to drink fluids during the outing (Risk 1). The drive back was calm and ' +
          'he helped carry the bags inside (Routine Support 10).',
      },
      {
        time: '4pm-12am',
        provider: 'Jordan Lee, DSP',
        mood: 'Content, Cooperative',
        title: 'Housekeeping and Meal Planning',
        narrative:
          'The individual vacuumed his room and wiped the kitchen counters with staff supervision ' +
          '(Routine Support 4). Together with staff he planned meals for the coming week, choosing ' +
          'balanced options per his dietary plan (Outcome 4, Routine Support 7). Staff administered ' +
          'evening medications on schedule (Routine Support 3). No medical complaints were voiced.',
      },
      {
        time: '12am-8am',
        provider: 'Sam Rivera, DSP',
        mood: 'Calm',
        title: 'Overnight Monitoring',
        narrative:
          'Staff performed overnight checks throughout the shift, tracking sleep quality and ' +
          'seizure status (Risk 2). The individual remained asleep and safe all night; no ' +
          'incidents occurred.',
      },
    ],
  },
  {
    heading: 'May 03, 2026 (Sunday)',
    shifts: [
      {
        time: '8am-4pm',
        provider: 'Jordan Lee, DSP',
        mood: 'Happy, Chatty',
        title: 'River Walk and Photo Review',
        narrative:
          'Staff drove the individual to the river trail for a morning walk (Outcome 2, Routine ' +
          'Support 10). He took photos of the scenery and chatted happily about them on the way ' +
          'home. Staff encouraged water breaks twice during the walk (Risk 1). In the afternoon he ' +
          'reviewed his photos with a peer and helped make sandwiches for lunch (Outcome 4).',
      },
      {
        time: '4pm-12am',
        provider: 'Alex Morgan, DSP',
        mood: 'Calm, Content',
        title: 'Quiet Evening and Medication Pass',
        narrative:
          'The individual enjoyed a quiet evening watching a nature documentary. Staff ' +
          'administered his insulin as prescribed and logged the medication pass (Routine Support ' +
          '3). He voiced no complaints of pain or discomfort. Staff observed him at dinner for ' +
          'swallowing difficulty (Risk 2, Potential Risk 2); the meal proceeded safely.',
      },
      {
        time: '12am-8am',
        provider: 'Sam Rivera, DSP',
        mood: 'Sleepy',
        title: 'Overnight Safety Checks',
        narrative:
          'The individual went to bed after his hygiene routine. Staff conducted hourly night ' +
          'checks, monitoring breathing and seizure status (Risk 2). He slept through the night ' +
          'and woke briefly once for water, returning to sleep without difficulty.',
      },
    ],
  },
];

const PAGE = { width: 612, height: 792, margin: 54 };

async function main() {
  const doc = await PDFDocument.create();
  doc.setTitle('Sample Monthly Shift Log - May 2026');
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

  const drawText = (text, { font = regular, size = 10, gap = 4, color = rgb(0.1, 0.12, 0.16) } = {}) => {
    // simple word wrap
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

  drawText('Sample Residential Services Provider', { font: bold, size: 16, gap: 2 });
  drawText('Monthly Continuous Service Log — May 2026', { font: bold, size: 12, gap: 10 });
  drawText(
    'This is a synthetic sample report for demonstration purposes. Each day below is divided ' +
      'into Day, Evening and Overnight shift blocks.',
    { size: 9, gap: 14, color: rgb(0.35, 0.38, 0.45) },
  );

  for (const day of DAYS) {
    newPageIfNeeded(60);
    drawText(day.heading, { font: bold, size: 12, gap: 6 });
    for (const shift of day.shifts) {
      newPageIfNeeded(80);
      drawText(`Shift (Start and End Time): ${shift.time}`, { font: bold, size: 10, gap: 2 });
      drawText(`Assigned Provider: ${shift.provider} | Observed Mood: ${shift.mood}`, {
        size: 10,
        gap: 2,
      });
      drawText(`${shift.title}: ${shift.narrative}`, { size: 10, gap: 10 });
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, 'Sample_ShiftLog_May2026.pdf');
  fs.writeFileSync(outPath, await doc.save());
  console.log(`Sample report written to ${outPath} (${DAYS.length} days, ${DAYS.reduce((n, d) => n + d.shifts.length, 0)} shifts)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
