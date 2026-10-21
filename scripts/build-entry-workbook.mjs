// Generates the "Daily Log Entry" workbooks the staff fill in during the
// month. The filled .docx uploads straight into the Form §680 app (which
// converts it to PDF and extracts one shift per filled box).
//
//   node scripts/build-entry-workbook.mjs             -> June ... December workbooks
//   node scripts/build-entry-workbook.mjs --months August,September
//                                                     -> only those months
//   node scripts/build-entry-workbook.mjs --individual jerrell
//                                                     -> Jerrell's workbooks (July from
//                                                        his July 20, 2026 admission)
//   node scripts/build-entry-workbook.mjs --sample    -> also writes a partly
//        filled June sample to /tmp/June-sample-filled.docx (for testing)
//
// Also imported by scripts/fill-august-2026.mjs, scripts/fill-jerrell-2026.mjs
// and scripts/rebuild-workbook.mjs (buildDocument / MONTHS / monthDays).
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHIFTS = [
  { kind: 'day', time: '8am-4pm', label: 'Day Shift' },
  { kind: 'evening', time: '4pm-12am', label: 'Evening Shift' },
  { kind: 'night', time: '12am-8am', label: 'Overnight Shift' },
];

const MONTHS = [
  { name: 'June', year: 2026, days: 30 },
  { name: 'July', year: 2026, days: 31 },
  { name: 'August', year: 2026, days: 31 },
  { name: 'September', year: 2026, days: 30 },
  { name: 'October', year: 2026, days: 31 },
  { name: 'November', year: 2026, days: 30 },
  { name: 'December', year: 2026, days: 31 },
];

// The people the workbooks are kept for. `startDay` trims a month to the days
// from admission on, so no pre-admission boxes are printed.
const INDIVIDUALS = {
  steven: {
    key: 'steven',
    filePrefix: 'Steven',
    first: 'Steve',
    header: 'Individual Supported: Steven (Steve) Lavinius | ID Number: 45198',
    info: 'Diagnoses: Type II Diabetes, Epilepsy, Hypertension, High Cholesterol. Day Program: Inner Vision Day Support.',
    keywords:
      'meals and cooking, medications given (with times), fluids/water offered, personal hygiene and bathing, laundry/housekeeping chores, community outings (walk, store, park, church), transportation, day program, behavior, seizure monitoring, and overnight bed checks',
    months: MONTHS,
  },
  jerrell: {
    key: 'jerrell',
    filePrefix: 'Jerrell',
    first: 'Jerrell',
    header: 'Individual Supported: Jerrell Wright | ID Number: 9566',
    info: 'Admitted: July 20, 2026. Day Program: enrollment in day support pending.',
    keywords:
      'meals and cooking, medications given (with times), personal hygiene and bathing, dressing and appearance, laundry/housekeeping chores, shopping and money handling, community outings (walk, restaurant, store), transportation, appointments, behavior and how staff responded, safety (doors, leaving the house), and overnight bed checks',
    months: MONTHS.filter((m) => m.name !== 'June').map((m) => (m.name === 'July' ? { ...m, startDay: 20 } : m)),
  },
};

// Staffing rules (house manager, Sept 2026): weekends fully covered by
// Nathanael Yohannes; weekday day support is Hanna Tafesse; the weekday
// evening shift is Rahel Tafesse (Hanna covered June 1, 3 and 5); Nathanael
// Yohannes covers weekday overnights.
function provider(kind, day) {
  if (day.weekend) return 'Nathanael Yohannes, DSP';
  if (kind === 'day') return 'Hanna Tafesse, DSP';
  if (kind === 'evening') {
    if ((day.year ?? 2026) === 2026 && day.month === 'June' && [1, 3, 5].includes(day.day)) return 'Hanna Tafesse, DSP';
    return 'Rahel Tafesse, DSP';
  }
  return 'Nathanael Yohannes, DSP';
}

function monthDays(month) {
  const monthIndex = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ].indexOf(month.name);
  const days = [];
  let weekdayIndex = -1;
  // firstDay trims a partial report (e.g. the 1st-9th); startDay is the admission day and also drops that day's 12am-8am box.
  for (let d = month.firstDay ?? month.startDay ?? 1; d <= month.days; d += 1) {
    const date = new Date(Date.UTC(month.year, monthIndex, d));
    const dow = date.getUTCDay();
    const weekend = dow === 0 || dow === 6;
    if (!weekend) weekdayIndex += 1;
    days.push({
      heading: `${month.name} ${String(d).padStart(2, '0')}, ${month.year} (${WEEKDAYS[dow]})`,
      month: month.name,
      year: month.year,
      day: d,
      dow,
      weekend,
      weekdayIndex,
    });
  }
  return days;
}

// ---------------------------------------------------------------------------
// docx building blocks
// ---------------------------------------------------------------------------
const THIN = { style: BorderStyle.SINGLE, size: 6, color: '9AA3AF' };
const BORDERS = { top: THIN, bottom: THIN, left: THIN, right: THIN };
const FONT = 'Calibri';

const text = (t, opts = {}) =>
  new Paragraph({
    spacing: { after: opts.after ?? 80 },
    alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
    pageBreakBefore: opts.pageBreakBefore ?? false,
    children: [
      new TextRun({
        text: t,
        bold: opts.bold ?? false,
        italics: opts.italic ?? false,
        size: (opts.size ?? 10) * 2,
        color: opts.color ?? '1F2430',
        font: FONT,
      }),
    ],
  });

const bullet = (t) =>
  new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text: t, size: 19, font: FONT, color: '1F2430' })],
  });

const labelCell = (t, widthPct) =>
  new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    borders: BORDERS,
    verticalAlign: VerticalAlign.TOP,
    shading: { type: ShadingType.CLEAR, fill: 'EEF1F5' },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [text(t, { bold: true, size: 9.5, after: 0 })],
  });

const entryCell = (widthPct, value = '', lines = 1) =>
  new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    borders: BORDERS,
    verticalAlign: VerticalAlign.TOP,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: (value ? value.split('\n') : ['']).map(
      (line, i, arr) =>
        new Paragraph({
          spacing: { after: i === arr.length - 1 ? Math.max(0, (lines - arr.length) * 220) : 40 },
          children: [new TextRun({ text: line, size: 19, font: FONT, color: '1F2430' })],
        }),
    ),
  });

function shiftTable(shift, prefillProvider, fill, first = 'Steve') {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            columnSpan: 2,
            borders: BORDERS,
            shading: { type: ShadingType.CLEAR, fill: 'DDE3EC' },
            margins: { top: 70, bottom: 70, left: 100, right: 100 },
            children: [
              text(`Shift (Start and End Time): ${shift.time}`, { bold: true, size: 10.5, after: 0 }),
            ],
          }),
        ],
      }),
      new TableRow({
        children: [labelCell('Assigned Provider:', 28), entryCell(72, prefillProvider)],
      }),
      new TableRow({
        children: [labelCell('Observed Mood:', 28), entryCell(72, fill?.mood ?? '')],
      }),
      new TableRow({
        children: [
          new TableCell({
            columnSpan: 2,
            borders: BORDERS,
            shading: { type: ShadingType.CLEAR, fill: 'EEF1F5' },
            margins: { top: 50, bottom: 50, left: 100, right: 100 },
            children: [text(`Notes — what ${first} did this shift:`, { bold: true, size: 9.5, after: 0 })],
          }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({
            columnSpan: 2,
            borders: BORDERS,
            verticalAlign: VerticalAlign.TOP,
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
            children: (fill?.notes ? fill.notes.split('\n') : ['']).map(
              (line, i, arr) =>
                new Paragraph({
                  spacing: { after: i === arr.length - 1 ? Math.max(0, (6 - arr.length) * 220) : 40 },
                  children: [new TextRun({ text: line, size: 19, font: FONT, color: '1F2430' })],
                }),
            ),
          }),
        ],
      }),
    ],
  });
}

const spacer = () => text('', { after: 140 });

function buildDocument(month, sampleFill = null, providerOverrides = null, individual = INDIVIDUALS.steven) {
  const { first } = individual;
  const firstDay = month.firstDay ?? month.startDay;
  const period = firstDay ? `${month.name} ${firstDay}–${month.days}, ${month.year}` : `${month.name} ${month.year}`;
  const roster = individual.roster;
  const staffBullet = roster
    ? `Staff names are pre-filled from the schedule (weekday day: ${roster.weekdayDay}; weekday evening: ${roster.weekdayEvening}; weekday overnight: ${roster.weekdayNight}; weekend day/evening/overnight: ${[...new Set([roster.weekendDay, roster.weekendEvening, roster.weekendNight])].join(' / ')}). Edit the name if someone else covered the shift.`
    : 'Staff names are pre-filled from the schedule (weekends: Nathanael Yohannes; weekday day: Hanna Tafesse; weekday evening: Rahel Tafesse; weekday overnight: Nathanael Yohannes). Edit the name if someone else covered the shift.';
  const children = [
    text(individual.agency ?? 'SL Community Residential Services', { bold: true, size: 16, after: 40 }),
    text('Monthly Compliance Progress Binder — Daily Log Entry Workbook', { bold: true, size: 12, after: 120 }),
    text(`Reporting Period: ${period}`, { bold: true, size: 11, after: 120 }),
    text(individual.header, { size: 10, after: 40 }),
    text(individual.info, { size: 10, after: 200 }),
    text('How to use this workbook', { bold: true, size: 12, after: 100 }),
    bullet('Each day has three shift boxes (8am-4pm, 4pm-12am, 12am-8am). Type directly into the white boxes.'),
    bullet(
      'Observed Mood — one to three words, e.g.: Happy, Content, Calm, Excited, Friendly, Outgoing, Caring, Gentle, Polite, Considerate; or when applicable: Irritability, Restlessness, Anxiety/Fear, Agitation, Decreased energy/Fatigue.',
    ),
    bullet(
      `Notes — write what ${first} did in plain sentences. When it happened, mention: ${individual.keywords}. The app uses these words to tick the matching boxes on Form §680.`,
    ),
    bullet(staffBullet),
    bullet(
      `If ${first} was away (family leave, hospital, etc.), leave that day\u2019s Mood and Notes boxes empty — empty days are skipped automatically and no form is generated for them.`,
    ),
    bullet(
      `When ${month.name} is finished, save this file and upload it directly to the Form §680 app as the Monthly Shift Log (it accepts this .docx). Exporting it to PDF first also works.`,
    ),
  ];

  for (const day of monthDays(month)) {
    children.push(text(day.heading, { bold: true, size: 13, after: 140, pageBreakBefore: true }));
    for (const shift of SHIFTS) {
      // The 12am-8am box is the early hours of its date; on the admission day
      // those hours are before the move-in, so that box is not printed.
      if (month.startDay && day.day === month.startDay && shift.kind === 'night') continue;
      const fill = sampleFill?.[day.heading]?.[shift.kind] ?? null;
      const staff = providerOverrides?.[day.heading]?.[shift.kind] ?? provider(shift.kind, day);
      children.push(shiftTable(shift, staff, fill, first));
      children.push(spacer());
    }
  }

  children.push(
    text('STAFF SIGNATURE & ATTESTATION', { bold: true, size: 13, after: 140, pageBreakBefore: true }),
    text(
      'I attest that the entries above are accurate and complete to the best of my knowledge and were recorded for each shift worked.',
      { size: 10, after: 200 },
    ),
    text('Staff Name: ____________________________    Signature: ____________________________    Date: ______________', { size: 10, after: 120 }),
    text('Staff Name: ____________________________    Signature: ____________________________    Date: ______________', { size: 10, after: 120 }),
    text('Reviewed and approved by: ____________________________    Review date: ______________', { size: 10, after: 0 }),
  );

  return new Document({
    styles: { default: { document: { run: { font: FONT } } } },
    sections: [
      {
        properties: {
          page: { margin: { top: 720, bottom: 720, left: 900, right: 900 } },
        },
        children,
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Sample fill (testing only): June 1-3 + June 6 filled, everything else blank.
// ---------------------------------------------------------------------------
const SAMPLE_FILL = {
  'June 01, 2026 (Monday)': {
    day: {
      mood: 'Happy, Outgoing',
      notes:
        'Steve attended Inner Vision day program in the morning and greeted peers warmly. Staff prepared breakfast with Steve helping with cooking scrambled eggs in the kitchen. Morning medications were given at 8:00 AM as prescribed and Steve swallowed them without difficulty. Staff offered water and fluids through the shift to support hydration. Steve completed personal hygiene and bathing with stand-by support. Staff provided transportation to the day program by van.',
    },
    evening: {
      mood: 'Calm, Content',
      notes:
        'Steve returned from day program and rested. He helped with laundry and folding towels as part of housekeeping chores. Staff prepared dinner and Steve assisted with meal preparation in the kitchen. Evening medications were administered at 8:00 PM as prescribed. Staff went with Steve on a short community walk to the park and he enjoyed the fresh air. Fluids were offered regularly.',
    },
    night: {
      mood: 'Calm',
      notes:
        'Steve went to bed at 10:30 PM after his bedtime routine. Staff completed overnight bed checks every 30 minutes and seizure monitoring throughout the night. No seizure activity was observed. Steve slept through the night and woke briefly at 5 AM for the bathroom, then returned to sleep. Staff offered water in the morning.',
    },
  },
  'June 02, 2026 (Tuesday)': {
    day: {
      mood: 'Friendly, Talkative',
      notes:
        'Steve helped cook lunch in the kitchen and set the table. Morning medications were given at 8:00 AM as prescribed. Staff took Steve shopping at the grocery store in the community and he picked out fruit. Water and fluids were offered across the shift for hydration. Steve completed hygiene tasks with verbal prompts.',
    },
    evening: {
      mood: 'Content',
      notes:
        'Steve did his laundry with staff support and helped with housekeeping in his room. Dinner was prepared together and Steve practiced cooking skills. Evening medications were administered at 8:00 PM. Staff provided transportation for a short drive to the river walk and Steve enjoyed walking.',
    },
    night: {
      mood: 'Calm',
      notes:
        'Steve followed his bedtime routine and was asleep by 11 PM. Overnight bed checks and seizure monitoring were completed on schedule with no seizure activity observed. Steve slept well through the night.',
    },
  },
  'June 03, 2026 (Wednesday)': {
    day: {
      mood: 'Happy, Caring',
      notes:
        'Steve attended his day program and participated well. Morning medications given at 8:00 AM as prescribed. Steve helped prepare breakfast and practiced kitchen safety. Staff offered fluids regularly to support hydration and Steve completed bathing with stand-by assistance. Transportation to the program was provided by staff.',
    },
    evening: {
      mood: 'Calm, Polite',
      notes:
        'Steve helped with meal preparation for dinner and cleaned the kitchen counters. Evening medications were administered at 8:00 PM. Staff and Steve went for a community walk around the neighborhood park. Laundry was folded and put away with staff prompts. Fluids offered through the evening.',
    },
    night: {
      mood: 'Calm',
      notes:
        'Steve went to bed after his night routine. Staff completed overnight checks and seizure monitoring every 30 minutes; no seizure activity observed. Steve woke once for water and returned to sleep without difficulty.',
    },
  },
  'June 06, 2026 (Saturday)': {
    day: {
      mood: 'Excited, Outgoing',
      notes:
        'Steve enjoyed a weekend outing to the mall in the community with staff and greeted store clerks politely. Morning medications given at 8:00 AM as prescribed. Steve helped cook pancakes for breakfast in the kitchen. Staff offered water and fluids throughout the day. Transportation was provided by staff van.',
    },
    evening: {
      mood: 'Happy, Content',
      notes:
        'Steve helped prepare dinner and set the table. Evening medications were administered at 8:00 PM. Steve and staff watched a movie and he helped with light housekeeping afterwards. Fluids offered regularly through the shift.',
    },
    night: {
      mood: 'Calm',
      notes:
        'Steve completed his bedtime routine and went to sleep at 11 PM. Staff completed overnight bed checks and seizure monitoring on schedule; no seizure activity was observed. Steve slept soundly through the night.',
    },
  },
};

export { INDIVIDUALS, MONTHS, SHIFTS, buildDocument, monthDays, provider };

const isCli = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isCli) {
  const sampleMode = process.argv.includes('--sample');
  const sampleOnly = process.argv.includes('--sample-only');
  const monthsArg = process.argv.indexOf('--months');
  const wanted = monthsArg > -1 ? new Set(process.argv[monthsArg + 1].split(',').map((m) => m.trim().toLowerCase())) : null;
  const individualArg = process.argv.indexOf('--individual');
  const individual = INDIVIDUALS[individualArg > -1 ? process.argv[individualArg + 1].toLowerCase() : 'steven'];
  if (!individual) throw new Error(`unknown individual; use one of: ${Object.keys(INDIVIDUALS).join(', ')}`);
  if (!sampleOnly) {
    for (const month of individual.months) {
      if (wanted && !wanted.has(month.name.toLowerCase())) continue;
      const doc = buildDocument(month, null, null, individual);
      const bytes = await Packer.toBuffer(doc);
      const out = path.join(ROOT, `${individual.filePrefix}_${month.name}${month.year}_Daily_Log_Entry.docx`);
      await writeFile(out, bytes);
      console.log(`Wrote ${out} (${bytes.length} bytes, ${month.days - (month.startDay ?? 1) + 1} days)`);
    }
  }
  if (sampleMode || sampleOnly) {
    const june = MONTHS[0];
    const bytes = await Packer.toBuffer(buildDocument(june, SAMPLE_FILL));
    const out = path.join(os.tmpdir(), 'June-sample-filled.docx');
    await writeFile(out, bytes);
    console.log(`Wrote ${out} (sample fill: June 1-3 + June 6)`);
  }
}
