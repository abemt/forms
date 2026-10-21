import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { PDFCheckBox, PDFDocument, PDFDropdown, PDFName, PDFOptionList, PDFRadioGroup, PDFTextField } from 'pdf-lib';
import { z } from 'zod';
import { config } from '../config.js';
import type { FieldValue } from '../types.js';
import { docxParagraphs, parseForm680Spec } from './docxTemplate.js';
import { fillDocxTemplate } from './docxFormFiller.js';
import { isoFormDate, type ExportForm } from './exportPlan.js';
import { extractPdfPages } from './pdfText.js';
import { assertProfile, profileTemplate, type ProfileId } from './profiles.js';

export interface ImportFile { name: string; bytes: Uint8Array }
export interface PrintCollection {
  id: string;
  profileId: ProfileId;
  label: string;
  createdAt: string;
  warnings: string[];
  forms: { index: number; date: string; shift: string; provider: string; originalName: string; wordFile?: string; pdfFile?: string }[];
}

function directory(id: string): string {
  z.string().uuid().parse(id);
  return path.join(config.dataDir, 'collections', id);
}

export function unpackPrintFiles(files: ImportFile[]): ImportFile[] {
  const unpacked: ImportFile[] = [];
  let total = 0;
  for (const file of files) {
    if (/\.zip$/i.test(file.name)) {
      const archive = new AdmZip(Buffer.from(file.bytes));
      const entries = archive.getEntries();
      if (entries.length > 1000) throw new Error('The ZIP contains too many entries.');
      for (const entry of entries) {
        if (entry.isDirectory || !/\.(?:pdf|docx)$/i.test(entry.entryName)) continue;
        if (entry.entryName.split(/[\\/]/).includes('..') || /^(?:[\\/]|[a-z]:)/i.test(entry.entryName)) throw new Error('Unsafe path in ZIP.');
        total += entry.header.size;
        if (entry.header.size > 60 * 1024 * 1024 || total > 400 * 1024 * 1024) throw new Error('Expanded files exceed the import limit.');
        unpacked.push({ name: entry.entryName, bytes: new Uint8Array(entry.getData()) });
      }
    } else {
      total += file.bytes.length;
      if (total > 400 * 1024 * 1024) throw new Error('Files exceed the import limit.');
      if (!/\.(?:pdf|docx)$/i.test(file.name)) throw new Error('Upload PDF, Word, or ZIP files.');
      unpacked.push(file);
    }
  }
  if (!unpacked.length) throw new Error('No individual Word or PDF forms were found.');
  return unpacked;
}

function assertPerson(text: string, profile: ProfileId): void {
  const name = text.match(/(?:Name|Individual(?: Supported)?)\s*:\s*([^\n]+)/i)?.[1] ?? text.slice(0, 250);
  if (!(profile === 'jerrell' ? /\bJerrell\b/i : /\bSteve(?:n)?\b/i).test(name)) throw new Error('The form identity does not match the selected individual.');
}

function wordMetadata(bytes: Uint8Array, profile: ProfileId) {
  const archive = new AdmZip(Buffer.from(bytes));
  if (archive.getEntries().reduce((total, entry) => total + entry.header.size, 0) > 60 * 1024 * 1024) throw new Error('Word file expands beyond the import limit.');
  const xml = archive.readAsText('word/document.xml');
  if ((xml.match(/<w:sectPr\b/g) ?? []).length > 1) throw new Error('Upload individual forms, not an already-merged monthly Word file.');
  const paragraphs = docxParagraphs(bytes);
  const text = paragraphs.join('\n');
  assertPerson(text, profile);
  const date = text.match(/Date\s*:\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})/i)?.[1];
  if (!date) throw new Error('The Word form has no readable Date value.');
  const shift = text.match(/[\u2611\u2612]\s*(12am-8am|8am-4pm|4pm-12am)/i)?.[1];
  if (!shift) throw new Error('The Word form has no selected shift.');
  return { date: isoFormDate(date.replace(/\s+/g, ' ')), shift, provider: '' };
}

function pdfValues(document: PDFDocument): Record<string, FieldValue> {
  const values: Record<string, FieldValue> = {};
  for (const field of document.getForm().getFields()) {
    if (field instanceof PDFTextField) values[field.getName()] = field.getText() ?? '';
    else if (field instanceof PDFCheckBox) values[field.getName()] = field.isChecked();
    else if (field instanceof PDFRadioGroup) values[field.getName()] = field.getSelected() ?? '';
    else if (field instanceof PDFDropdown || field instanceof PDFOptionList) values[field.getName()] = field.getSelected()[0] ?? '';
  }
  return values;
}

export async function importPrintCollection(profile: ProfileId, uploads: ImportFile[], convertToWord: boolean): Promise<PrintCollection> {
  const files = unpackPrintFiles(uploads);
  const paired = new Map<string, { word?: ImportFile; pdf?: ImportFile }>();
  for (const file of files) {
    const name = path.posix.basename(file.name.replace(/\\/g, '/'));
    const key = name.replace(/\.(?:pdf|docx)$/i, '').toLowerCase();
    const pair = paired.get(key) ?? {};
    const type = /\.docx$/i.test(name) ? 'word' : 'pdf';
    if (pair[type]) {
      const existingPrint = /(?:^|\/)(?:PDF|Printable)\//i.test(pair[type]!.name);
      const incomingPrint = /(?:^|\/)(?:PDF|Printable)\//i.test(file.name);
      if (type === 'pdf' && existingPrint !== incomingPrint) { if (incomingPrint) pair.pdf = file; }
      else if (!Buffer.from(pair[type]!.bytes).equals(Buffer.from(file.bytes))) throw new Error(`Duplicate form name: ${name}. Upload one month at a time.`);
    } else pair[type] = file;
    paired.set(key, pair);
  }
  if (paired.size > 120) throw new Error('Import at most 120 individual forms at once.');
  const collection: PrintCollection = { id: randomUUID(), profileId: profile, label: profile === 'steven' ? 'Steven' : 'Jerrell', createdAt: new Date().toISOString(), warnings: [], forms: [] };
  const root = directory(collection.id);
  await mkdir(root, { recursive: true });
  const template = convertToWord ? await profileTemplate(profile, 'daily') : undefined;
  const spec = template ? parseForm680Spec(docxParagraphs(template)) : undefined;
  if (spec) assertProfile(spec, profile);
  try {
    const seen = new Set<string>();
    for (const [key, pair] of [...paired].sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))) {
      const index = collection.forms.length;
      const stem = `Form${String(index + 1).padStart(3, '0')}`;
      let metadata: { date: string; shift: string; provider: string };
      let pdf: PDFDocument | undefined;
      let pdfFirstPage = '';
      let values: Record<string, FieldValue> = {};
      if (pair.pdf) {
        pdf = await PDFDocument.load(pair.pdf.bytes);
        values = pdfValues(pdf);
        pdfFirstPage = (await extractPdfPages(pair.pdf.bytes))[0] ?? '';
        assertPerson(pdfFirstPage, profile);
      }
      if (pair.word) metadata = wordMetadata(pair.word.bytes, profile);
      else {
        if (!pair.pdf || !pdf) throw new Error('No report content found.');
        const date = typeof values.Date === 'string' ? values.Date : pdfFirstPage.match(/Date\s*:\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})/i)?.[1];
        const shift = Object.entries(values).find(([field, value]) => field.startsWith('Shift: ') && value === true)?.[0].slice(7);
        if (!date || !shift) throw new Error(`${key}: this PDF has no readable date/shift fields. Upload its individual Word copy.`);
        metadata = { date: isoFormDate(date), shift, provider: String(values['Staff Name'] ?? '') };
      }
      if (pair.word && pair.pdf) {
        const date = typeof values.Date === 'string' && values.Date ? isoFormDate(values.Date) : undefined;
        const shift = Object.entries(values).find(([field, value]) => field.startsWith('Shift: ') && value === true)?.[0].slice(7);
        if ((date && date !== metadata.date) || (shift && shift !== metadata.shift)) throw new Error(`${key}: paired Word and PDF dates or shifts do not match.`);
      }
      const identity = `${metadata.date}|${metadata.shift}`;
      if (seen.has(identity)) throw new Error(`Duplicate date and shift: ${identity}.`);
      seen.add(identity);
      let wordBytes = pair.word?.bytes;
      if (!wordBytes && convertToWord && pdf && template && spec) {
        const hasImages = pdf.context.enumerateIndirectObjects().some(([, object]) => 'dict' in object && (object as { dict: { get: (name: PDFName) => unknown } }).dict.get(PDFName.of('Subtype'))?.toString() === '/Image');
        if (hasImages) collection.warnings.push(`${key}: Word conversion skipped because the PDF contains images that must be preserved. Supply its Word copy.`);
        else {
          const converted = await fillDocxTemplate(template, spec, values);
          const text = docxParagraphs(converted).join(' ').replace(/\s+/g, ' ');
          const missing = Object.entries(values).filter(([field, value]) => typeof value === 'string' && value.trim() && !/(?:Support Type|Shift:)/.test(field) && !text.includes(value.replace(/\s+/g, ' ').trim()));
          if (missing.length) collection.warnings.push(`${key}: Word conversion skipped; ${missing.length} source values did not match the template.`);
          else wordBytes = converted;
        }
      }
      const wordFile = wordBytes ? `${stem}.docx` : undefined;
      const pdfFile = pair.pdf ? `${stem}.pdf` : undefined;
      if (wordBytes) await writeFile(path.join(root, wordFile!), wordBytes);
      if (pair.pdf) await writeFile(path.join(root, pdfFile!), pair.pdf.bytes);
      collection.forms.push({ index, ...metadata, originalName: path.posix.basename((pair.word ?? pair.pdf)!.name), wordFile, pdfFile });
    }
    if (convertToWord) collection.warnings.unshift('PDF-to-Word copies transfer source field values without generating notes. Layout and signature fonts may differ; original PDFs retain the original appearance.');
    await writeFile(path.join(root, 'collection.json'), JSON.stringify(collection), 'utf8');
    return collection;
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

export async function getPrintCollection(id: string): Promise<PrintCollection> {
  return JSON.parse(await readFile(path.join(directory(id), 'collection.json'), 'utf8')) as PrintCollection;
}

export async function listPrintCollections() {
  const root = path.join(config.dataDir, 'collections');
  await mkdir(root, { recursive: true });
  const records = await Promise.all((await readdir(root)).map((id) => getPrintCollection(id).catch(() => undefined)));
  return records.filter((record): record is PrintCollection => !!record).sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((record) => ({ id: record.id, profileId: record.profileId, label: record.label, createdAt: record.createdAt, forms: record.forms.length }));
}

export function collectionForms(collection: PrintCollection): ExportForm[] {
  return collection.forms.map((form) => ({ ...form, wordPath: form.wordFile ? path.join(directory(collection.id), form.wordFile) : undefined, pdfPath: form.pdfFile ? path.join(directory(collection.id), form.pdfFile) : undefined }));
}