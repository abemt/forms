import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import type { FieldValue } from '../types.js';
import type { Form680Spec } from './template680.js';

/**
 * Renders a completed Form §680 as a Word (.docx) printable — the same
 * content as the flattened PDF, but editable in Word. Checked boxes appear
 * as ☒, unchecked as ☐; an optional PNG signature image is embedded in the
 * Staff Attestation block.
 */

const FONT = 'Calibri';
const CHECKED = '\u2612'; // ☒
const UNCHECKED = '\u2610'; // ☐

type Values = Record<string, FieldValue>;

/** Case-insensitive field lookup. */
function makeLookup(values: Values) {
  const map = new Map<string, FieldValue>();
  for (const [k, v] of Object.entries(values)) map.set(k.trim().toLowerCase(), v);
  return {
    str(name: string): string {
      const v = map.get(name.trim().toLowerCase());
      if (typeof v === 'string') return v;
      if (v === true) return 'Yes';
      return '';
    },
    bool(name: string): boolean {
      const v = map.get(name.trim().toLowerCase());
      return v === true || (typeof v === 'string' && /^(yes|true|on|checked)$/i.test(v));
    },
  };
}

function run(text: string, opts: { bold?: boolean; italic?: boolean; size?: number; color?: string } = {}): TextRun {
  return new TextRun({
    text,
    bold: opts.bold ?? false,
    italics: opts.italic ?? false,
    size: (opts.size ?? 9) * 2,
    color: opts.color ?? '1F2430',
    font: FONT,
  });
}

function para(children: TextRun[], opts: { after?: number; center?: boolean; keepNext?: boolean } = {}): Paragraph {
  return new Paragraph({
    spacing: { after: opts.after ?? 60 },
    alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
    keepNext: opts.keepNext ?? false,
    children,
  });
}

function text(t: string, opts: { bold?: boolean; italic?: boolean; size?: number; color?: string; after?: number; center?: boolean; keepNext?: boolean } = {}): Paragraph {
  return para([run(t, opts)], opts);
}

/** Bold label followed by the (possibly multi-line) value. */
function labeled(label: string, value: string, opts: { after?: number } = {}): Paragraph {
  const lines = value.split('\n');
  const children: TextRun[] = [run(`${label} `, { bold: true })];
  lines.forEach((line, i) => {
    if (i > 0) children.push(new TextRun({ break: 1, text: line, size: 18, font: FONT, color: '1F2430' }));
    else children.push(run(line));
  });
  return para(children, opts);
}

/** One wrapped paragraph of ☒/☐ options, e.g. the moods checklist. */
function checklist(items: { label: string; checked: boolean }[], opts: { after?: number } = {}): Paragraph {
  const children: TextRun[] = [];
  items.forEach((item, i) => {
    if (i > 0) children.push(run('    ', {}));
    children.push(run(`${item.checked ? CHECKED : UNCHECKED} `, { bold: item.checked }));
    children.push(run(item.label, { bold: item.checked, size: 8.5 }));
  });
  return para(children, { after: opts.after ?? 80 });
}

function sectionBar(title: string): Paragraph {
  return new Paragraph({
    spacing: { before: 160, after: 80 },
    keepNext: true,
    shading: { fill: 'E4E9F0' },
    children: [run(` ${title}`, { bold: true, size: 10 })],
  });
}

/** Read PNG pixel dimensions from the IHDR chunk. */
function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function attestationTable(lookup: ReturnType<typeof makeLookup>, signaturePng?: Uint8Array): Table {
  const thin = { style: BorderStyle.SINGLE, size: 6, color: '9AA3AF' };
  const borders = { top: thin, bottom: thin, left: thin, right: thin };

  const cell = (label: string, children: Paragraph[], widthPct: number) =>
    new TableCell({
      width: { size: widthPct, type: WidthType.PERCENTAGE },
      borders,
      verticalAlign: VerticalAlign.BOTTOM,
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      children: [text(label, { bold: true, size: 8, after: 40 }), ...children],
    });

  let signatureContent: Paragraph[];
  if (signaturePng) {
    const dims = pngSize(signaturePng);
    const maxW = 140;
    const maxH = 45;
    let w = maxW;
    let h = maxH;
    if (dims && dims.width > 0 && dims.height > 0) {
      const scale = Math.min(maxW / dims.width, maxH / dims.height);
      w = Math.round(dims.width * scale);
      h = Math.round(dims.height * scale);
    }
    signatureContent = [
      new Paragraph({
        spacing: { after: 0 },
        children: [
          new ImageRun({
            type: 'png',
            data: signaturePng,
            transformation: { width: w, height: h },
          }),
        ],
      }),
    ];
  } else {
    signatureContent = [text(lookup.str('Staff Signature'), { italic: true, size: 11, after: 0 })];
  }

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          cell('Staff Name:', [text(lookup.str('Staff Name'), { after: 0 })], 30),
          cell('Title:', [text(lookup.str('Staff Title'), { after: 0 })], 20),
          cell('Signature:', signatureContent, 30),
          cell('Date:', [text(lookup.str('Signature Date'), { after: 0 })], 20),
        ],
      }),
    ],
  });
}

export async function buildPrintableDocx(
  spec: Form680Spec,
  values: Values,
  options: { signaturePng?: Uint8Array } = {},
): Promise<Uint8Array> {
  const lookup = makeLookup(values);
  const children: (Paragraph | Table)[] = [];

  // Header
  children.push(text(spec.orgName, { bold: true, size: 13, center: true, after: 20 }));
  if (spec.orgContact) children.push(text(spec.orgContact, { size: 8, color: '5A6472', center: true, after: 40 }));
  children.push(text('Daily Progress Note - Form § 680', { bold: true, size: 11.5, center: true, after: 140 }));

  // Identity
  children.push(
    para(
      [
        run('Name: ', { bold: true }),
        run(lookup.str('Individual Name') || spec.individualName),
        run('        ID: ', { bold: true }),
        run(lookup.str('Individual ID') || spec.individualId),
        run('        Date: ', { bold: true }),
        run(lookup.str('Date')),
      ],
      { after: 80 },
    ),
  );

  // Shift
  const shiftLabels =
    spec.shiftLabels && spec.shiftLabels.length === spec.shiftOptions.length
      ? spec.shiftLabels
      : spec.shiftOptions;
  children.push(
    para(
      [
        run('Shift (Start and End Time):   ', { bold: true }),
        ...spec.shiftOptions.flatMap((opt, i) => {
          const checked = lookup.bool(`Shift: ${opt}`);
          return [
            run(`${checked ? CHECKED : UNCHECKED} `, { bold: checked }),
            run(`${shiftLabels[i]}    `, { bold: checked }),
          ];
        }),
      ],
      { after: 100 },
    ),
  );

  // Mood
  children.push(sectionBar("Describe the individual's mood throughout the shift"));
  const moodDescription = lookup.str('Mood Description');
  if (moodDescription) children.push(labeled('', moodDescription));
  children.push(text('Moods Observed Throughout the Shift:', { bold: true, size: 8.5, after: 40, keepNext: true }));
  children.push(
    checklist(spec.moods.map((m) => ({ label: m, checked: lookup.bool(`Mood: ${m}`) }))),
  );
  const moodOther = lookup.str('Mood: Other');
  if (moodOther) children.push(labeled('Other (describe):', moodOther));

  // Activities
  children.push(sectionBar("Describe the individual's activities throughout the shift"));
  children.push(labeled('Individual Activity:', lookup.str('Individual Activity')));
  children.push(labeled('Group Activity:', lookup.str('Group Activity')));
  children.push(labeled('Community Activity:', lookup.str('Community Activity')));

  // Outcomes & supports
  let outcomesBar = false;
  let essentialsBar = false;
  for (const section of spec.sections) {
    if (!outcomesBar && /^Outcome\b/i.test(section.id)) {
      children.push(sectionBar('Outcomes'));
      outcomesBar = true;
    }
    if (!essentialsBar && /^(Identified|Potential) Risk\b|^Routine Support\b/i.test(section.id)) {
      children.push(sectionBar('Essential Supports'));
      essentialsBar = true;
    }
    children.push(text(section.title, { bold: true, size: 8.5, after: 30, keepNext: true }));
    for (const line of section.detailLines) {
      children.push(text(line, { size: 7.5, color: '5A6472', after: 20, keepNext: true }));
    }
    const selected = lookup.str(`${section.id} - Support Type`);
    children.push(
      para(
        [
          run('TYPE OF SUPPORTS PROVIDED:   ', { bold: true, size: 7.5, color: '5A6472' }),
          ...spec.supportTypeOptions.flatMap((opt) => {
            const on = selected.trim().toLowerCase() === opt.trim().toLowerCase();
            return [run(`${on ? CHECKED : UNCHECKED} `, { bold: on, size: 8 }), run(`${opt}    `, { bold: on, size: 8 })];
          }),
        ],
        { after: 30 },
      ),
    );
    const documentation = lookup.str(`${section.id} - Documentation`);
    children.push(labeled('Documentation:', documentation, { after: 100 }));
  }

  // Narrative
  children.push(sectionBar('Shift Narrative (Progress Notes)'));
  children.push(labeled('', lookup.str('Shift Narrative'), { after: 120 }));

  // Yes / No questions
  children.push(sectionBar('End-of-Shift Questions'));
  for (const q of spec.yesNoQuestions) {
    const answer = lookup.str(q.id).trim().toLowerCase();
    children.push(text(q.question, { bold: true, size: 8.5, after: 30, keepNext: true }));
    children.push(
      para(
        [
          run(`${answer === 'yes' ? CHECKED : UNCHECKED} `, { bold: answer === 'yes' }),
          run('Yes        ', { bold: answer === 'yes' }),
          run(`${answer === 'no' ? CHECKED : UNCHECKED} `, { bold: answer === 'no' }),
          run('No', { bold: answer === 'no' }),
        ],
        { after: 30 },
      ),
    );
    const explanation = lookup.str(`${q.id} Explanation`);
    if (explanation) children.push(labeled('If yes, please explain:', explanation, { after: 80 }));
  }

  // Staff attestation
  children.push(sectionBar('Staff Attestation'));
  children.push(attestationTable(lookup, options.signaturePng));

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT } } } },
    sections: [
      {
        properties: { page: { margin: { top: 620, bottom: 620, left: 800, right: 800 } } },
        children,
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}
