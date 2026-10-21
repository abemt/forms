import {
  PDFDocument,
  PDFDict,
  PDFFont,
  PDFForm,
  PDFName,
  PDFPage,
  PDFString,
  StandardFonts,
  rgb,
} from 'pdf-lib';
import type { PDFTextField } from 'pdf-lib';
import { toWinAnsi } from '../utils/text.js';
import { config } from '../config.js';

/**
 * Generates the fillable "Daily Progress Note - Form § 680" template as a real
 * AcroForm PDF: editable text fields, checkboxes and radio buttons.
 *
 * By default it renders the built-in Joy Group Home layout; a custom
 * {@link Form680Spec} (e.g. parsed from an uploaded Word template by
 * docxTemplate.ts) renders the same layout with that document's own
 * identity, moods, sections and questions.
 */

export interface Form680Spec {
  orgName: string;
  orgContact: string;
  individualName: string;
  individualId: string;
  /** Shift time labels, e.g. "12am-8am". Field names become "Shift: <label>". */
  shiftOptions: string[];
  /** Optional display labels for the shift checkboxes (defaults to shiftOptions). */
  shiftLabels?: string[];
  moods: string[];
  supportTypeOptions: string[];
  sections: SupportSection[];
  yesNoQuestions: { id: string; question: string }[];
}

export const SUPPORT_TYPE_OPTIONS = [
  'Independent',
  'Monitor (Supervision)',
  'Reminder (Verbal Prompt)',
  'Partial Physical (Some Physical Support)',
  'Full Physical (Total Physical Support)',
  'Out of Facility',
  'Choose not to complete',
  'Not Scheduled',
] as const;

export const MOOD_OPTIONS = [
  'Aggression (physical)',
  'Aggression (verbal)',
  'Agitation',
  'Anger',
  'Anxiety/Fear',
  'Appetite Disturbance',
  'Calm',
  'Caring',
  'Considerate',
  'Content',
  'Danger to Self',
  'Danger to others',
  'Decreased energy/Fatigue',
  'Delusions',
  'Depressed',
  'Distractibility',
  'Emotional Lability',
  'Excited',
  'Feelings of Worthlessness',
  'Friendly',
  'Gentle',
  'Hallucinations (auditory)',
  'Happy',
  'Hopelessness/Helplessness',
  'Impulsivity',
  'Indulgent',
  'Irritability',
  'Modest',
  'Negative Statements',
  'Noncompliance (medical care)',
  'Outgoing',
  'Outspoken',
  'Polite',
  'Restlessness',
  'Sad/Pained/Worried Expression',
  'Self-Deprecation',
  'Social Withdrawal',
  'Socially Inappropriate',
  'Suicidal Ideation or Plan',
] as const;

interface SupportSection {
  /** Field name prefix, e.g. "Outcome 2". */
  id: string;
  title: string;
  detailLines: string[];
}
export type { SupportSection };

export const SUPPORT_SECTIONS: SupportSection[] = [
  {
    id: 'Outcome 2',
    title:
      'Outcome 2: Steven wants to be an active member in the community and be able to participate in recreational activities that he enjoys. (Weekly)',
    detailLines: ['Activity Statement: Steve goes out weekly.'],
  },
  {
    id: 'Outcome 4',
    title: 'Outcome 4: Steve will become more independent with cooking and meal planning. (Daily)',
    detailLines: [
      "Skill Building: Steve learns how to use kitchen appliances safely and prepare simple meals according to his physician's recommended diabetic diet.",
      'Activity Statement: Steve improves his cooking skills and follows his recommended diabetic diet daily.',
    ],
  },
  {
    id: 'Identified Risk 1 (Dehydration)',
    title: 'Identified Risk 1: Dehydration (Daily)',
    detailLines: [],
  },
  {
    id: 'Identified Risk 2 (Seizure)',
    title: 'Identified Risk 2: Seizure (Daily)',
    detailLines: [],
  },
  {
    id: 'Potential Risk 1 (Pressure Injury)',
    title: 'Potential Risk 1: Pressure Injury (Routine as needed)',
    detailLines: ['- Has diagnosis of diabetes or congestive heart failure'],
  },
  {
    id: 'Potential Risk 2 (Aspiration Pneumonia)',
    title: 'Potential Risk 2: Aspiration Pneumonia (Routine as needed)',
    detailLines: [
      '- Has a diagnosis of any neurologic disorder (e.g., Cerebral Palsy, Stroke, Dementia, Seizure disorder etc.)',
      '- Has experienced impaired consciousness or awareness',
    ],
  },
  {
    id: 'Potential Risk 3 (Fall with Injury)',
    title: 'Potential Risk 3: Fall with Injury (Routine as needed)',
    detailLines: [
      '- Has experienced a fall or fall with injury in the past',
      "- Has been diagnosed with a seizure disorder, Meniere's disease (vestibular syncope), or arthritis",
      '- Takes more than 4 medications daily (polypharmacy)',
      '- Experiences fatigue and weakness with activity',
    ],
  },
  {
    id: 'Potential Risk 4 (Bowel Obstruction)',
    title: 'Potential Risk 4: Bowel Obstruction (Routine as needed)',
    detailLines: [
      '- Has diagnosis of any neurological disorder (e.g., Cerebral Palsy, Spina Bifida, Muscular Dystrophy, paralysis etc.)',
      '- Is prescribed psychiatric and/or narcotic medications (routine or PRN)',
    ],
  },
  {
    id: 'Potential Risk 5 (Sepsis)',
    title: 'Potential Risk 5: Sepsis (Routine as needed)',
    detailLines: [
      '- Has been diagnosed with Diabetes, COPD, Cirrhosis, Chronic kidney disease, CHF, Pneumonia, UTI and/or lowered immune response',
    ],
  },
  {
    id: 'Routine Support 1 (Glucometer/DME)',
    title: 'Routine Support 1: Adaptive equipment/DME (Glucometer) (Daily)',
    detailLines: [],
  },
  {
    id: 'Routine Support 2 (Communication)',
    title: 'Routine Support 2: Communication support (Daily)',
    detailLines: [],
  },
  {
    id: 'Routine Support 3 (Medication Use)',
    title: 'Routine Support 3: Medication use (Daily)',
    detailLines: [],
  },
  {
    id: 'Routine Support 4 (Housekeeping)',
    title: 'Routine Support 4: Housekeeping (Weekly)',
    detailLines: [],
  },
  {
    id: 'Routine Support 5 (Laundry)',
    title: 'Routine Support 5: Laundry (Weekly)',
    detailLines: [],
  },
  {
    id: 'Routine Support 6 (Shopping)',
    title: 'Routine Support 6: Shopping (Routine as needed)',
    detailLines: [],
  },
  {
    id: 'Routine Support 7 (Meal Planning/Preparation)',
    title: 'Routine Support 7: Meal planning, preparation, and intake (Daily)',
    detailLines: [],
  },
  {
    id: 'Routine Support 8 (Banking/Money Management)',
    title: 'Routine Support 8: Banking and Money Management (Routine as Needed)',
    detailLines: [],
  },
  {
    id: 'Routine Support 9 (Medical Appointments)',
    title: 'Routine Support 9: Medical Appointments (Routine as Needed)',
    detailLines: [],
  },
  {
    id: 'Routine Support 10 (Transportation)',
    title: 'Routine Support 10: Transportation (Weekly)',
    detailLines: [],
  },
  {
    id: 'Routine Support 11 (Medical Providers/Diabetic Diet)',
    title:
      'Routine Support 11: Medical #1 - his providers with type II Diabetes, Epilepsy/seizures, hypertension, and high cholesterol support Steve. Staff will encourage Steve to eat within his diabetic diet. Staff will follow any related protocols. (Daily)',
    detailLines: [],
  },
];

export const YES_NO_QUESTIONS = [
  {
    id: 'Medication Received',
    question: 'Any medication received today? If yes, please explain what was given and the time:',
  },
  {
    id: 'Medical Complaints',
    question:
      'Any mental health or medical complaints or concerns reported by or on behalf of the individual?',
  },
  {
    id: 'Behavioral Difficulty',
    question: 'Any emotional or behavioral difficulty experienced or reported by the individual today?',
  },
  {
    id: 'Serious Incident',
    question: 'Any serious incident reports documented today?',
  },
] as const;

export const DEFAULT_SPEC: Form680Spec = {
  orgName: 'Joy Group Home, INC.',
  orgContact: '5801 Garden Ridge Rd Chesterfield, VA 23832  |  (804) 467-8366',
  individualName: 'Steven "Steve" Lavinus',
  individualId: '45198',
  shiftOptions: ['12am-8am', '8am-4pm', '4pm-12am'],
  shiftLabels: ['12am - 8am (Overnight)', '8am - 4pm (Day)', '4pm - 12am (Evening)'],
  moods: [...MOOD_OPTIONS],
  supportTypeOptions: [...SUPPORT_TYPE_OPTIONS],
  sections: SUPPORT_SECTIONS,
  yesNoQuestions: YES_NO_QUESTIONS.map((q) => ({ ...q })),
};

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const INK = rgb(0.13, 0.15, 0.19);
const MUTED = rgb(0.38, 0.42, 0.48);
const FIELD_BG = rgb(0.965, 0.975, 0.99);
const FIELD_BORDER = rgb(0.62, 0.68, 0.76);
const BAR_BG = rgb(0.9, 0.925, 0.955);

class Layout {
  page!: PDFPage;
  y = 0;

  constructor(
    readonly doc: PDFDocument,
    readonly form: PDFForm,
    readonly fonts: { regular: PDFFont; bold: PDFFont },
  ) {
    this.newPage();
  }

  newPage(): void {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  ensure(height: number): void {
    if (this.y - height < MARGIN) this.newPage();
  }

  gap(height: number): void {
    this.y -= height;
  }

  wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
    const words = toWinAnsi(text).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines.length > 0 ? lines : [''];
  }

  text(
    content: string,
    opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; x?: number; maxWidth?: number; lineGap?: number } = {},
  ): void {
    const font = opts.font ?? this.fonts.regular;
    const size = opts.size ?? 9;
    const color = opts.color ?? INK;
    const x = opts.x ?? MARGIN;
    const maxWidth = opts.maxWidth ?? PAGE_WIDTH - x - MARGIN;
    const lineGap = opts.lineGap ?? 2;
    const lines = this.wrap(content, font, size, maxWidth);
    for (const line of lines) {
      this.ensure(size + lineGap);
      this.page.drawText(line, { x, y: this.y - size, size, font, color });
      this.y -= size + lineGap;
    }
  }

  sectionBar(title: string): void {
    this.ensure(30);
    this.gap(4);
    this.page.drawRectangle({
      x: MARGIN,
      y: this.y - 16,
      width: CONTENT_WIDTH,
      height: 16,
      color: BAR_BG,
    });
    this.page.drawText(toWinAnsi(title), {
      x: MARGIN + 6,
      y: this.y - 12,
      size: 9.5,
      font: this.fonts.bold,
      color: INK,
    });
    this.y -= 22;
  }

  textField(
    name: string,
    opts: {
      label?: string;
      x?: number;
      width?: number;
      lines?: number;
      fontSize?: number;
      defaultValue?: string;
      inlineLabel?: boolean;
    } = {},
  ): void {
    const x = opts.x ?? MARGIN;
    const width = opts.width ?? PAGE_WIDTH - x - MARGIN;
    const fontSize = opts.fontSize ?? 8.5;
    const lines = opts.lines ?? 1;
    const height = lines === 1 ? 15 : lines * (fontSize + 3.5) + 8;
    const labelHeight = opts.label && !opts.inlineLabel ? 12 : 0;
    this.ensure(labelHeight + height + 4);

    let fieldX = x;
    let fieldWidth = width;
    if (opts.label && opts.inlineLabel) {
      const labelWidth = this.fonts.bold.widthOfTextAtSize(toWinAnsi(opts.label), 9) + 6;
      this.page.drawText(toWinAnsi(opts.label), {
        x,
        y: this.y - 11,
        size: 9,
        font: this.fonts.bold,
        color: INK,
      });
      fieldX = x + labelWidth;
      fieldWidth = width - labelWidth;
    } else if (opts.label) {
      this.page.drawText(toWinAnsi(opts.label), {
        x,
        y: this.y - 10,
        size: 9,
        font: this.fonts.bold,
        color: INK,
      });
      this.y -= labelHeight;
    }

    const field = this.form.createTextField(name);
    if (lines > 1) field.enableMultiline();
    setTextFieldFont(field, fontSize);
    if (opts.defaultValue) field.setText(toWinAnsi(opts.defaultValue));
    field.addToPage(this.page, {
      x: fieldX,
      y: this.y - height,
      width: fieldWidth,
      height,
      borderWidth: 0.8,
      borderColor: FIELD_BORDER,
      backgroundColor: FIELD_BG,
    });
    this.y -= height + 4;
  }

  /** Draw several single-line text fields side by side on one row. */
  textFieldRow(fields: { name: string; label: string; width: number; defaultValue?: string; height?: number }[]): void {
    const rowHeight = Math.max(15, ...fields.map((f) => f.height ?? 15));
    this.ensure(18 + rowHeight);
    let x = MARGIN;
    const labelY = this.y - 10;
    const fieldTop = this.y - 13;
    for (const spec of fields) {
      this.page.drawText(toWinAnsi(spec.label), {
        x,
        y: labelY,
        size: 8.5,
        font: this.fonts.bold,
        color: INK,
      });
      const field = this.form.createTextField(spec.name);
      setTextFieldFont(field, 8.5);
      if (spec.defaultValue) field.setText(toWinAnsi(spec.defaultValue));
      const height = spec.height ?? 15;
      field.addToPage(this.page, {
        x,
        y: fieldTop - height,
        width: spec.width,
        height,
        borderWidth: 0.8,
        borderColor: FIELD_BORDER,
        backgroundColor: FIELD_BG,
      });
      x += spec.width + 10;
    }
    this.y -= 18 + rowHeight;
  }

  checkboxGrid(names: string[], labels: string[], columns: number, labelSize = 7): void {
    const colWidth = CONTENT_WIDTH / columns;
    const rowHeight = 14;
    const rows = Math.ceil(names.length / columns);
    for (let row = 0; row < rows; row++) {
      this.ensure(rowHeight);
      for (let col = 0; col < columns; col++) {
        const i = row * columns + col;
        if (i >= names.length) break;
        const x = MARGIN + col * colWidth;
        const boxY = this.y - 11;
        const cb = this.form.createCheckBox(names[i]);
        cb.addToPage(this.page, {
          x,
          y: boxY,
          width: 10,
          height: 10,
          borderWidth: 0.9,
          borderColor: FIELD_BORDER,
          backgroundColor: FIELD_BG,
        });
        this.page.drawText(toWinAnsi(labels[i]), {
          x: x + 14,
          y: boxY + 2,
          size: labelSize,
          font: this.fonts.regular,
          color: INK,
        });
      }
      this.y -= rowHeight;
    }
  }

  radioGrid(name: string, options: readonly string[], columns: number): void {
    const group = this.form.createRadioGroup(name);
    const colWidth = CONTENT_WIDTH / columns;
    const rowHeight = 13;
    const rows = Math.ceil(options.length / columns);
    // A radio group cannot span pages cleanly; reserve the full block first.
    this.ensure(rows * rowHeight + 2);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const i = row * columns + col;
        if (i >= options.length) break;
        const x = MARGIN + 8 + col * colWidth;
        const boxY = this.y - 10.5;
        group.addOptionToPage(options[i], this.page, {
          x,
          y: boxY,
          width: 9,
          height: 9,
          borderWidth: 0.9,
          borderColor: FIELD_BORDER,
          backgroundColor: FIELD_BG,
        });
        this.page.drawText(toWinAnsi(options[i]), {
          x: x + 13,
          y: boxY + 1.5,
          size: 7,
          font: this.fonts.regular,
          color: INK,
        });
      }
      this.y -= rowHeight;
    }
    this.y -= 2;
  }
}

/**
 * Fresh pdf-lib text fields have no /DA (default appearance) entry, so
 * PDFTextField.setFontSize throws. Write the DA string directly instead;
 * `/Helv` is registered in the AcroForm /DR resources by ensureDrFont().
 */
function setTextFieldFont(field: PDFTextField, size: number): void {
  field.acroField.dict.set(PDFName.of('DA'), PDFString.of(`/Helv ${size} Tf 0 g`));
}

/** Register a font in the AcroForm default resources so /DA strings resolve. */
function ensureDrFont(form: PDFForm, name: string, font: PDFFont): void {
  const acroDict = form.acroForm.dict;
  const context = acroDict.context;
  let dr = acroDict.lookupMaybe(PDFName.of('DR'), PDFDict);
  if (!dr) {
    dr = context.obj({});
    acroDict.set(PDFName.of('DR'), dr);
  }
  let fonts = dr.lookupMaybe(PDFName.of('Font'), PDFDict);
  if (!fonts) {
    fonts = context.obj({});
    dr.set(PDFName.of('Font'), fonts);
  }
  fonts.set(PDFName.of(name), font.ref);
}

export async function buildForm680Template(spec: Form680Spec = DEFAULT_SPEC): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Daily Progress Note - Form § 680');
  doc.setAuthor(spec.orgName);
  doc.setCreator('Form 680 AutoNotes');

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const form = doc.getForm();
  ensureDrFont(form, 'Helv', regular);
  const layout = new Layout(doc, form, { regular, bold });

  // ---------- Header ----------
  const center = (text: string, size: number, font: PDFFont, color = INK) => {
    const width = font.widthOfTextAtSize(text, size);
    layout.ensure(size + 3);
    layout.page.drawText(text, {
      x: (PAGE_WIDTH - width) / 2,
      y: layout.y - size,
      size,
      font,
      color,
    });
    layout.y -= size + 3;
  };
  center(spec.orgName, 14, bold);
  if (spec.orgContact) center(spec.orgContact, 8.5, regular, MUTED);
  layout.gap(6);
  center('Daily Progress Note - Form § 680', 12.5, bold);
  layout.gap(4);
  layout.page.drawLine({
    start: { x: MARGIN, y: layout.y },
    end: { x: PAGE_WIDTH - MARGIN, y: layout.y },
    thickness: 1,
    color: FIELD_BORDER,
  });
  layout.gap(10);

  // ---------- Identity row ----------
  layout.textFieldRow([
    { name: 'Individual Name', label: 'Name:', width: 220, defaultValue: spec.individualName },
    { name: 'Individual ID', label: 'ID:', width: 90, defaultValue: spec.individualId },
    { name: 'Date', label: 'Date:', width: 202 },
  ]);

  // ---------- Shift checkboxes ----------
  layout.text('Shift (Start and End Time):', { font: bold, size: 9 });
  layout.gap(2);
  layout.checkboxGrid(
    spec.shiftOptions.map((s) => `Shift: ${s}`),
    spec.shiftLabels && spec.shiftLabels.length === spec.shiftOptions.length
      ? [...spec.shiftLabels]
      : [...spec.shiftOptions],
    Math.min(3, Math.max(1, spec.shiftOptions.length)),
    8,
  );
  layout.gap(4);

  // ---------- Mood ----------
  layout.sectionBar("Describe the individual's mood throughout the shift");
  layout.textField('Mood Description', { lines: 3, fontSize: 8.5 });
  layout.gap(2);
  layout.text('Moods Observed Throughout the Shift:', { font: bold, size: 9 });
  layout.gap(3);
  layout.checkboxGrid(
    spec.moods.map((m) => `Mood: ${m}`),
    [...spec.moods],
    4,
  );
  layout.gap(2);
  layout.textField('Mood: Other', { label: 'Other (describe):', inlineLabel: true, width: CONTENT_WIDTH });
  layout.gap(4);

  // ---------- Activities ----------
  layout.sectionBar("Describe the individual's activities throughout the shift");
  layout.textField('Individual Activity', { label: 'Individual Activity:', lines: 2 });
  layout.textField('Group Activity', { label: 'Group Activity:', lines: 2 });
  layout.textField('Community Activity', { label: 'Community Activity:', lines: 2 });

  // ---------- Outcomes & supports ----------
  let firstOutcome = true;
  let outcomesBarDrawn = false;
  let essentialsBarDrawn = false;
  for (const section of spec.sections) {
    if (!outcomesBarDrawn && /^Outcome\b/i.test(section.id)) {
      layout.sectionBar('Outcomes');
      outcomesBarDrawn = true;
    }
    if (!essentialsBarDrawn && /^(Identified|Potential) Risk\b|^Routine Support\b/i.test(section.id)) {
      layout.sectionBar('Essential Supports');
      essentialsBarDrawn = true;
    }
    if (!firstOutcome) layout.gap(2);
    firstOutcome = false;

    // Keep the heading, radio block and documentation together when possible.
    layout.ensure(120);
    layout.text(section.title, { font: bold, size: 8.5 });
    for (const line of section.detailLines) {
      layout.text(line, { size: 7.5, color: MUTED });
    }
    layout.gap(2);
    layout.text('TYPE OF SUPPORTS PROVIDED:', { font: bold, size: 7.5, color: MUTED });
    layout.gap(2);
    layout.radioGrid(`${section.id} - Support Type`, spec.supportTypeOptions, 2);
    layout.textField(`${section.id} - Documentation`, {
      label: "Documentation (how supports were provided and the individual's response):",
      lines: 2,
      fontSize: 8,
    });
    layout.gap(4);
  }

  // ---------- Narrative (optional, not on the agency's form) ----------
  if (config.narrativeSection) {
    layout.sectionBar('Shift Narrative (Progress Notes)');
    layout.textField('Shift Narrative', { lines: 10, fontSize: 8 });
    layout.gap(4);
  }

  // ---------- Yes / No questions ----------
  layout.sectionBar('End-of-Shift Questions');
  for (const q of spec.yesNoQuestions) {
    layout.ensure(70);
    layout.text(q.question, { font: bold, size: 8.5 });
    layout.gap(2);
    layout.radioGrid(q.id, ['Yes', 'No'], 6);
    layout.textField(`${q.id} Explanation`, {
      label: 'If yes, please explain:',
      lines: 2,
      fontSize: 8,
    });
    layout.gap(3);
  }

  // ---------- Staff attestation ----------
  layout.sectionBar('Staff Attestation');
  layout.textFieldRow([
    { name: 'Staff Name', label: 'Staff Name:', width: 170 },
    { name: 'Staff Title', label: 'Title:', width: 130 },
    { name: 'Staff Signature', label: 'Signature:', width: 130, height: 30 },
    { name: 'Signature Date', label: 'Date:', width: 82 },
  ]);

  form.updateFieldAppearances(regular);
  return doc.save();
}
