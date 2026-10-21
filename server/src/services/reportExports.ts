import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Duplex, PDFDocument, PDFRef } from 'pdf-lib';
import { config } from '../config.js';
import { pruneDanglingAnnots } from './formFiller.js';
import { planExport, type ExportForm, type ExportOptions } from './exportPlan.js';
import { zipDirectory } from './zipper.js';
import { writeJsonAtomic } from '../utils/atomicJson.js';

const execute = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
let queue = Promise.resolve();

export interface ExportArtifact {
  name: string;
  format: 'word' | 'pdf';
  forms: number;
  fromDate: string;
  toDate: string;
  check: boolean;
  alreadyPrinted: boolean;
  pages?: number;
}

export interface ExportRecord {
  id: string;
  sourceId: string;
  label: string;
  createdAt: string;
  status: 'queued' | 'building' | 'done' | 'failed';
  options: ExportOptions;
  artifacts: ExportArtifact[];
  error?: string;
}

function exportDir(id: string): string {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Invalid export ID.');
  return path.join(config.dataDir, 'exports', id);
}

async function save(record: ExportRecord): Promise<void> {
  const file = path.join(exportDir(record.id), 'export.json');
  await writeJsonAtomic(file, record);
}

export async function getExport(id: string): Promise<ExportRecord> {
  return JSON.parse(await readFile(path.join(exportDir(id), 'export.json'), 'utf8')) as ExportRecord;
}

export async function initExports(): Promise<void> {
  const directory = path.join(config.dataDir, 'exports');
  await mkdir(directory, { recursive: true });
  for (const name of await readdir(directory)) {
    try {
      const record = await getExport(name);
      if (record.status === 'queued' || record.status === 'building') {
        record.status = 'failed';
        record.error = 'Export interrupted by a server restart. Create a new export from the saved report.';
        await save(record);
      }
    } catch { /* Ignore non-export files. */ }
  }
}

export async function mergedPdf(files: string[], duplex: boolean): Promise<{ bytes: Uint8Array; pages: number }> {
  const result = await PDFDocument.create();
  for (const file of files) {
    const source = await PDFDocument.load(await readFile(file));
    if (source.getForm().getFields().length) source.getForm().flatten({ updateFieldAppearances: false });
    pruneDanglingAnnots(source);
    if (duplex && result.getPageCount() % 2) {
      const size = result.getPage(result.getPageCount() - 1).getSize();
      result.addPage([size.width, size.height]);
    }
    for (const page of await result.copyPages(source, source.getPageIndices())) result.addPage(page);
  }
  if (duplex) result.catalog.getOrCreateViewerPreferences().setDuplex(Duplex.DuplexFlipLongEdge);
  pruneDanglingAnnots(result);
  const bytes = await result.save();
  const saved = await PDFDocument.load(bytes);
  for (const page of saved.getPages()) {
    const annotations = page.node.Annots();
    for (const annotation of annotations?.asArray() ?? []) {
      if (annotation instanceof PDFRef && !saved.context.lookup(annotation)) throw new Error('PDF validation found a missing annotation.');
    }
  }
  return { bytes, pages: saved.getPageCount() };
}

async function mergeWord(files: string[], output: string, staging: string, duplex: boolean): Promise<void> {
  await mkdir(staging, { recursive: true });
  try {
    for (const [index, file] of files.entries()) {
      await copyFile(file, path.join(staging, `Form${String(index + 1).padStart(5, '0')}.docx`));
    }
    await execute(process.execPath, [path.join(projectRoot, 'scripts', 'merge-docx-forms.mjs'), staging, output, ...(duplex ? [] : ['--single-sided'])], { cwd: projectRoot, maxBuffer: 2 * 1024 * 1024, timeout: 180_000 });
    await access(output);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function createExport(sourceId: string, label: string, forms: ExportForm[], options: ExportOptions): Promise<ExportRecord> {
  const groups = planExport(forms, label, options);
  for (const group of groups) {
    for (const form of group.forms) {
      if (options.format !== 'pdf' && !form.wordPath) throw new Error('A Word copy is unavailable for this report. Select PDF or provide the original Word template.');
      if (options.format !== 'word' && !form.pdfPath) throw new Error('A printable PDF is unavailable for this report. Select Word.');
      if (options.format !== 'pdf') await access(form.wordPath!);
      if (options.format !== 'word') await access(form.pdfPath!);
    }
  }
  const record: ExportRecord = { id: randomUUID(), sourceId, label, createdAt: new Date().toISOString(), status: 'queued', options, artifacts: [] };
  const directory = exportDir(record.id);
  await mkdir(directory, { recursive: true });
  const snapshot = path.join(directory, 'source');
  await mkdir(snapshot, { recursive: true });
  try {
    for (const group of groups) {
      for (const form of group.forms) {
        if (options.format !== 'pdf') {
          const target = path.join(snapshot, `Form${form.index + 1}.docx`);
          await copyFile(form.wordPath!, target);
          form.wordPath = target;
        }
        if (options.format !== 'word') {
          const target = path.join(snapshot, `Form${form.index + 1}.pdf`);
          await copyFile(form.pdfPath!, target);
          form.pdfPath = target;
        }
      }
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  await save(record);
  queue = queue.catch(() => undefined).then(async () => {
    record.status = 'building';
    await save(record);
    const output = path.join(directory, 'files');
    await mkdir(output, { recursive: true });
    const indexLines = [label, 'Print one file at a time. Verify the last completed date and shift before resuming.', ''];
    for (const group of groups) {
      for (const format of ['word', 'pdf'] as const) {
        if (options.format !== 'both' && options.format !== format) continue;
        const filename = `${group.name}.${format === 'word' ? 'docx' : 'pdf'}`;
        const folder = format === 'word' ? 'Word' : 'PDF';
        await mkdir(path.join(output, folder), { recursive: true });
        const target = path.join(output, folder, filename);
        let pages: number | undefined;
        if (format === 'word') {
          if (options.layout === 'individual') await copyFile(group.forms[0].wordPath!, target);
          else await mergeWord(group.forms.map((form) => form.wordPath!), target, path.join(directory, 'staging'), options.duplex);
        } else {
          const merged = await mergedPdf(group.forms.map((form) => form.pdfPath!), options.duplex);
          await writeFile(target, merged.bytes);
          pages = merged.pages;
        }
        record.artifacts.push({ name: `${folder}/${filename}`, format, forms: group.forms.length, fromDate: group.fromDate, toDate: group.toDate, check: group.check, alreadyPrinted: group.alreadyPrinted, pages });
        indexLines.push(`${folder}/${filename}`);
      }
      for (const form of group.forms) indexLines.push(`  Form${String(form.index + 1).padStart(3, '0')} | ${form.date} | ${form.shift} | ${form.provider}`);
      indexLines.push('');
      await save(record);
    }
    await writeFile(path.join(output, 'INDEX.txt'), indexLines.join('\r\n'), 'utf8');
    await zipDirectory(output, path.join(directory, 'download.zip'));
    await rm(snapshot, { recursive: true, force: true });
    record.status = 'done';
    await save(record);
  }).catch(async (error: Error) => {
    record.status = 'failed';
    record.error = error.message;
    await rm(snapshot, { recursive: true, force: true }).catch(() => undefined);
    await save(record);
  });
  return { ...record };
}

export async function exportDownload(id: string, artifact?: number): Promise<{ path: string; name: string }> {
  const record = await getExport(id);
  if (record.status !== 'done') throw new Error('Export is not ready.');
  if (artifact === undefined) return { path: path.join(exportDir(id), 'download.zip'), name: `${record.label.replace(/[^a-z0-9_-]/gi, '_')}_Print_Files.zip` };
  const selected = record.artifacts[artifact];
  if (!selected) throw new Error('Download not found.');
  return { path: path.join(exportDir(id), 'files', selected.name), name: path.basename(selected.name) };
}