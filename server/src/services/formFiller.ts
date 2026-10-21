import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFRef,
  PDFString,
  PDFTextField,
  StandardFonts,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FieldValue } from '../types.js';
import { normalize, toWinAnsi } from '../utils/text.js';
import { refreshAppearances, registerDrFont, isSignatureField } from './appearances.js';
import { createLogger } from '../logger.js';

const log = createLogger('filler');

// Handwriting-style font used for staff signature fields (bundled, OFL).
const SIG_FONT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'assets',
  'signature-script.ttf',
);
let sigFontBytes: Uint8Array | null | undefined;

async function loadSignatureFontBytes(): Promise<Uint8Array | null> {
  if (sigFontBytes !== undefined) return sigFontBytes;
  try {
    sigFontBytes = new Uint8Array(await readFile(SIG_FONT_PATH));
  } catch (err) {
    log.warn(`signature font unavailable (${(err as Error).message}); using standard font`);
    sigFontBytes = null;
  }
  return sigFontBytes;
}

export interface FillResult {
  bytes: Uint8Array;
  warnings: string[];
}

interface SignatureSlot {
  page: PDFPage;
  rect: { x: number; y: number; width: number; height: number };
}

/** Page + rectangle of every staff-signature widget in the form. */
function signatureSlots(doc: PDFDocument, warnings: string[]): { slots: SignatureSlot[]; fields: PDFTextField[] } {
  const form = doc.getForm();
  const pages = doc.getPages();
  const slots: SignatureSlot[] = [];
  const fields: PDFTextField[] = [];
  for (const field of form.getFields()) {
    if (!(field instanceof PDFTextField) || !isSignatureField(field.getName())) continue;
    fields.push(field);
    for (const widget of field.acroField.getWidgets()) {
      const rect = widget.getRectangle();
      // Find the widget's page: via /P when present, else scan page annots.
      const pageRef = widget.P();
      let page = pages.find((p) => p.ref === pageRef);
      if (!page) {
        page = pages.find((p) => {
          const annots = p.node.Annots();
          if (!annots) return false;
          for (let i = 0; i < annots.size(); i++) {
            if (doc.context.lookup(annots.get(i)) === widget.dict) return true;
          }
          return false;
        });
      }
      if (!page) {
        warnings.push(`Could not locate the page of signature field "${field.getName()}".`);
        continue;
      }
      slots.push({ page, rect });
    }
  }
  return { slots, fields };
}

/**
 * Draw the PNG signature into the page content at each slot. Called LAST —
 * after the signature widget is removed and after any flattening — so no
 * field box or appearance stream can paint over it. It may extend a little
 * past the box edge, like ink over a printed signature line.
 */
async function stampSignatureImage(
  doc: PDFDocument,
  png: Uint8Array,
  slots: SignatureSlot[],
  warnings: string[],
): Promise<void> {
  let image;
  try {
    image = await doc.embedPng(png);
  } catch (err) {
    warnings.push(`Signature image could not be embedded (${(err as Error).message}).`);
    return;
  }
  for (const { page, rect } of slots) {
    const maxW = Math.max(20, rect.width - 4);
    const maxH = Math.max(rect.height * 1.25, 30);
    const scale = Math.min(maxW / image.width, maxH / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    // Centred in a tall box; on a short one it stands on the box's bottom
    // edge and rises above it like ink over a printed signature line.
    page.drawImage(image, {
      x: rect.x + 2,
      y: rect.y + Math.max(0, (rect.height - h) / 2),
      width: w,
      height: h,
    });
  }
}

function pickOption(options: string[], value: string): string | undefined {
  const target = normalize(value);
  return (
    options.find((o) => normalize(o) === target) ??
    options.find((o) => normalize(o).includes(target) || target.includes(normalize(o)))
  );
}

const MIN_FIT_FONT_SIZE = 5;

/** Font size declared in the field's /DA string, e.g. "/Helv 8 Tf 0 g". */
function declaredFontSize(field: PDFTextField): number | undefined {
  const da = field.acroField.getDefaultAppearance();
  const m = da?.match(/(\d+(?:\.\d+)?)\s+Tf/);
  const size = m ? Number(m[1]) : undefined;
  return size && size > 0 ? size : undefined;
}

/** Lines needed to lay `text` out at `size` inside `width` (word wrapping). */
function linesNeeded(text: string, font: PDFFont, size: number, width: number): number {
  let lines = 0;
  for (const paragraph of text.split(/\r?\n/)) {
    lines += 1;
    let remaining = width;
    const words = paragraph.split(' ');
    for (let i = 0; i < words.length; i++) {
      const word = i === words.length - 1 ? words[i] : `${words[i]} `;
      const w = font.widthOfTextAtSize(word, size);
      remaining -= w;
      if (remaining <= 0) {
        lines += 1;
        remaining = width - w;
      }
    }
  }
  return lines;
}

/**
 * Shrink a multiline field's font (never grow it) until its text fits the
 * widget box, so flattened printables never clip long entries.
 */
function fitMultilineText(field: PDFTextField, text: string, font: PDFFont): void {
  const widget = field.acroField.getWidgets()[0];
  if (!widget || !text) return;
  const rect = widget.getRectangle();
  const pad = 2 + (widget.getBorderStyle()?.getWidth() ?? 1);
  const width = rect.width - pad * 2;
  const height = rect.height - pad * 2;
  if (width <= 0 || height <= 0) return;

  const start = declaredFontSize(field) ?? 8;
  let size = start;
  while (size > MIN_FIT_FONT_SIZE) {
    const lineHeight = font.heightAtSize(size) * 1.2;
    if (linesNeeded(text, font, size, width) * lineHeight <= height) break;
    size = Math.round((size - 0.5) * 2) / 2;
  }
  if (size < start) {
    try {
      field.setFontSize(size);
    } catch {
      field.acroField.dict.set(PDFName.of('DA'), PDFString.of(`/Helv ${size} Tf 0 g`));
    }
  }
}

/** Shrink a single-line field's font (never grow it) until its text fits the box width. */
function fitSingleLineText(field: PDFTextField, text: string, font: PDFFont): void {
  const widget = field.acroField.getWidgets()[0];
  if (!widget || !text) return;
  const rect = widget.getRectangle();
  const pad = 2 + (widget.getBorderStyle()?.getWidth() ?? 1);
  const width = rect.width - pad * 2;
  if (width <= 0) return;
  const start = declaredFontSize(field) ?? 8;
  let size = start;
  while (size > MIN_FIT_FONT_SIZE && font.widthOfTextAtSize(text, size) > width) size = Math.round((size - 0.5) * 2) / 2;
  if (size < start) {
    try {
      field.setFontSize(size);
    } catch {
      field.acroField.dict.set(PDFName.of('DA'), PDFString.of(`/Helv ${size} Tf 0 g`));
    }
  }
}

/**
 * Fill a copy of the template with the given field values.
 * - flatten=false -> a fully editable AcroForm PDF (fields stay interactive).
 * - flatten=true  -> a print-ready PDF with the values burned into the page.
 */
export async function fillPdf(
  templateBytes: Uint8Array,
  values: Record<string, FieldValue>,
  options: { flatten: boolean; signatureImage?: Uint8Array },
): Promise<FillResult> {
  const warnings: string[] = [];
  const doc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const form = doc.getForm();

  // Embed the handwriting font when the template has a signature field so
  // staff signatures render as a real-looking signature.
  let signatureFont: PDFFont | undefined;
  if (
    !options.signatureImage &&
    form.getFields().some((f) => f instanceof PDFTextField && isSignatureField(f.getName()))
  ) {
    const bytes = await loadSignatureFontBytes();
    if (bytes) {
      try {
        doc.registerFontkit(fontkit);
        signatureFont = await doc.embedFont(bytes, { subset: true });
        registerDrFont(form, signatureFont);
      } catch (err) {
        log.warn(`could not embed signature font: ${(err as Error).message}`);
      }
    }
  }

  for (const [name, value] of Object.entries(values)) {
    let field;
    try {
      field = form.getField(name);
    } catch {
      warnings.push(`Field "${name}" does not exist in the template — skipped.`);
      continue;
    }
    try {
      if (field instanceof PDFTextField) {
        // A signature image replaces typed initials on signature fields.
        if (options.signatureImage && isSignatureField(name)) continue;
        let text = typeof value === 'boolean' ? (value ? 'Yes' : '') : String(value);
        text = toWinAnsi(text);
        const maxLength = field.getMaxLength();
        if (maxLength !== undefined && text.length > maxLength) {
          text = text.slice(0, maxLength);
          warnings.push(`Value for "${name}" truncated to ${maxLength} characters.`);
        }
        field.setText(text);
        if (field.isMultiline()) fitMultilineText(field, text, font);
        else if (!isSignatureField(name)) fitSingleLineText(field, text, font);
      } else if (field instanceof PDFCheckBox) {
        if (value === true) field.check();
        else field.uncheck();
      } else if (field instanceof PDFRadioGroup) {
        if (typeof value === 'string' && value) {
          const option = pickOption(field.getOptions(), value);
          if (option) field.select(option);
          else warnings.push(`"${value}" is not an option of radio group "${name}" — skipped.`);
        } else if (value === '' || value === false) {
          field.clear();
        }
      } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
        if (typeof value === 'string' && value) {
          const option = pickOption(field.getOptions(), value);
          if (option) field.select(option);
          else warnings.push(`"${value}" is not an option of "${name}" — skipped.`);
        }
      } else {
        warnings.push(`Field "${name}" has an unsupported type — skipped.`);
      }
    } catch (err) {
      warnings.push(`Could not set "${name}": ${(err as Error).message}`);
    }
  }

  // Regenerate appearances so every viewer displays the values. Faithful
  // templates (widgets without /MK) get transparent checkbox/radio looks so
  // the printed glyphs and labels stay fully visible.
  try {
    refreshAppearances(form, font, { signatureFont });
  } catch (err) {
    log.warn(`refreshAppearances failed: ${(err as Error).message}`);
  }

  // With a signature image the text widget is replaced by the picture: the
  // widget's opaque box would otherwise be painted over the image by viewers
  // (editable PDF) and by flattening (printable PDF).
  let slots: SignatureSlot[] = [];
  if (options.signatureImage) {
    const found = signatureSlots(doc, warnings);
    slots = found.slots;
    for (const field of found.fields) {
      try {
        form.removeField(field);
      } catch (err) {
        warnings.push(`Could not detach signature field "${field.getName()}": ${(err as Error).message}`);
      }
    }
  }

  if (options.flatten) {
    try {
      form.flatten();
    } catch (err) {
      // Extremely defensive: fall back to read-only fields so output is still printable.
      warnings.push(`Flattening failed (${(err as Error).message}); fields marked read-only instead.`);
      for (const f of form.getFields()) {
        try {
          f.enableReadOnly();
        } catch {
          /* ignore */
        }
      }
    }
  }

  if (options.signatureImage && slots.length > 0) {
    await stampSignatureImage(doc, options.signatureImage, slots, warnings);
  }

  pruneDanglingAnnots(doc);
  const bytes = await doc.save();
  return { bytes, warnings };
}

/**
 * pdf-lib's removeField()/flatten() delete widget objects but leave their
 * references in the pages' /Annots arrays (it removes the appearance-stream
 * ref instead of the widget ref). Viewers ignore the dead references, but
 * Acrobat's print pipeline fails on them ("The document could not be printed").
 */
export function pruneDanglingAnnots(doc: PDFDocument): number {
  let removed = 0;
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const entry = annots.get(i);
      if (entry instanceof PDFRef && doc.context.lookup(entry) === undefined) {
        annots.remove(i);
        removed++;
      }
    }
    if (annots.size() === 0) page.node.delete(PDFName.of('Annots'));
  }
  return removed;
}
