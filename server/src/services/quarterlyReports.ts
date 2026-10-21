import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { config } from '../config.js';
import { calendarDate, isoFormDate } from './exportPlan.js';
import { jobManager } from './jobManager.js';
import { indexSections, topicOf } from './local/sectionTopics.js';
import { fillQuarterly, inspectQuarterly, type QuarterlySpec } from './quarterlyTemplate.js';
import { profileForSpec, profileTemplate, saveProfileTemplate, type ProfileId } from './profiles.js';
import { convertDocxToPdfExact } from './soffice.js';
import { zipDirectory } from './zipper.js';
import { writeJsonAtomic } from '../utils/atomicJson.js';

export const quarterlyInputSchema = z.object({
  profileId: z.enum(['steven', 'jerrell']),
  mode: z.enum(['new', 'copy']).default('new'),
  periodStart: z.string().default(''),
  periodEnd: z.string().default(''),
  quarter: z.enum(['1st', '2nd', '3rd', '4th']).default('1st'),
  sourceJobIds: z.array(z.string().uuid()).max(12).default([]),
  saveTemplate: z.boolean().default(true),
}).refine((input) => input.mode === 'copy' || (calendarDate(input.periodStart) && calendarDate(input.periodEnd)), 'Enter valid reporting dates.')
  .refine((input) => input.mode === 'copy' || input.periodStart <= input.periodEnd, 'Reporting dates are reversed.');

export interface QuarterlySource {
  jobId: string;
  date: string;
  shift: string;
  topic: string;
  text: string;
}

export interface QuarterlyReport {
  id: string;
  profileId: ProfileId;
  createdAt: string;
  updatedAt: string;
  mode: 'new' | 'copy';
  templateName: string;
  status: 'review' | 'building' | 'done' | 'failed';
  spec: QuarterlySpec;
  values: Record<string, string>;
  sources: QuarterlySource[];
  sourceJobIds: string[];
  reviewer?: string;
  reviewedAt?: string;
  pdfReady?: boolean;
  warning?: string;
}

function directory(id: string): string {
  z.string().uuid().parse(id);
  return path.join(config.dataDir, 'quarterly', id);
}

async function persist(report: QuarterlyReport): Promise<void> {
  const file = path.join(directory(report.id), 'report.json');
  await writeJsonAtomic(file, report);
}

export async function getQuarterly(id: string): Promise<QuarterlyReport> {
  return JSON.parse(await readFile(path.join(directory(id), 'report.json'), 'utf8')) as QuarterlyReport;
}

export async function listQuarterly() {
  const root = path.join(config.dataDir, 'quarterly');
  await mkdir(root, { recursive: true });
  const reports = await Promise.all((await readdir(root)).map((id) => getQuarterly(id).catch(() => undefined)));
  return reports.filter((report): report is QuarterlyReport => !!report).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((report) => ({ id: report.id, profileId: report.profileId, individualName: report.spec.individualName, updatedAt: report.updatedAt, status: report.status, periodStart: report.values.periodStart, periodEnd: report.values.periodEnd }));
}

export async function initQuarterly(): Promise<void> {
  for (const item of await listQuarterly()) {
    if (item.status !== 'building') continue;
    const report = await getQuarterly(item.id);
    report.status = 'review';
    report.warning = 'Export interrupted. Review and export again.';
    await persist(report);
  }
}

export async function createQuarterly(input: z.infer<typeof quarterlyInputSchema>, templateBytes?: Uint8Array, templateName?: string): Promise<QuarterlyReport> {
  const validated = quarterlyInputSchema.parse(input);
  const bytes = templateBytes ?? await profileTemplate(validated.profileId, 'quarterly');
  const spec = inspectQuarterly(bytes, validated.profileId);
  const values = Object.fromEntries(spec.fields.map((field) => [field.id, validated.mode === 'copy' ? field.value : field.id.startsWith('completion') ? 'Completed by:                 (signature)                 Date:' : '']));
  if (validated.mode === 'new') Object.assign(values, { periodStart: validated.periodStart, periodEnd: validated.periodEnd, quarter: validated.quarter });
  const sources: QuarterlySource[] = [];
  const unique = new Set<string>();
  const sourceJobIds = validated.mode === 'copy' ? [] : validated.sourceJobIds;
  for (const jobId of sourceJobIds) {
    const job = jobManager.get(jobId);
    if ((job.profileId ?? profileForSpec(job.form680Spec)) !== validated.profileId) throw new Error('A source report belongs to a different individual.');
    const sections = indexSections(job.form680Spec, job.templateFields) ?? [];
    for (const shift of job.shifts) {
      const date = isoFormDate(shift.date);
      if (date < validated.periodStart || date > validated.periodEnd) continue;
      for (const assignment of shift.assignments) {
        if (!assignment.evidence || !assignment.field.endsWith(' - Documentation') || typeof assignment.value !== 'string') continue;
        const section = sections.find((candidate) => candidate.docField?.name === assignment.field);
        const topic = section?.topic ?? topicOf(assignment.field);
        const key = `${date}|${shift.shift}|${topic}|${assignment.evidence}`;
        if (unique.has(key)) continue;
        unique.add(key);
        sources.push({ jobId, date, shift: shift.shift, topic, text: assignment.evidence });
      }
    }
  }
  if (sources.length > 5000) throw new Error('Too many source notes; select fewer source reports.');
  const now = new Date().toISOString();
  const report: QuarterlyReport = { id: randomUUID(), profileId: validated.profileId, createdAt: now, updatedAt: now, mode: validated.mode, templateName: templateName ?? `${validated.profileId}-quarterly.docx`, status: 'review', spec, values, sources, sourceJobIds };
  await mkdir(directory(report.id), { recursive: true });
  await writeFile(path.join(directory(report.id), 'template.docx'), bytes);
  await persist(report);
  if (templateBytes && validated.saveTemplate) await saveProfileTemplate(validated.profileId, 'quarterly', bytes);
  return report;
}

const locks = new Set<string>();

export async function updateQuarterly(id: string, values: Record<string, string>): Promise<QuarterlyReport> {
  if (locks.has(id)) throw new Error('The report is busy. Try again after export.');
  locks.add(id);
  try {
    const report = await getQuarterly(id);
    if (report.status === 'building') throw new Error('The report is being exported.');
    if (report.mode === 'copy' && Object.entries(values).some(([key, value]) => report.values[key] !== value)) throw new Error('Existing-copy mode preserves the report unchanged. Create a new-quarter draft to edit it.');
    const updated = { ...report.values, ...values };
    fillQuarterly(new Uint8Array(await readFile(path.join(directory(id), 'template.docx'))), report.profileId, updated);
    report.values = updated;
    report.status = 'review';
    report.updatedAt = new Date().toISOString();
    delete report.reviewedAt;
    delete report.reviewer;
    await persist(report);
    return report;
  } finally { locks.delete(id); }
}

export async function generateQuarterly(id: string, reviewer: string): Promise<QuarterlyReport> {
  if (locks.has(id)) throw new Error('The report is busy.');
  locks.add(id);
  try {
    const report = await getQuarterly(id);
    if (report.status === 'building') throw new Error('Export is already running.');
    if (report.mode === 'new') {
      const missing = report.spec.fields.filter((field) => (field.id.endsWith('.summary') || field.id.endsWith('.status') || field.id.endsWith('.answer') || field.id.endsWith('.change')) && !report.values[field.id]?.trim());
      if (missing.length) throw new Error(`${missing.length} status, narrative, or answer fields still need review.`);
      const unexplainedChanges = report.spec.fields.filter((field) => field.id.endsWith('.change') && report.values[field.id] === 'Yes' && !report.values[`${field.id}Text`]?.trim());
      if (unexplainedChanges.length) throw new Error('Describe each requested plan change before export.');
    }
    report.status = 'building';
    report.reviewer = reviewer;
    report.reviewedAt = new Date().toISOString();
    report.pdfReady = false;
    delete report.warning;
    await persist(report);
    void (async () => {
      try {
        const template = new Uint8Array(await readFile(path.join(directory(id), 'template.docx')));
        const bytes = fillQuarterly(template, report.profileId, report.values);
        const out = path.join(directory(id), 'output');
        await rm(out, { recursive: true, force: true });
        await mkdir(path.join(out, 'Word'), { recursive: true });
        await writeFile(path.join(out, 'Word', 'Quarterly_Report.docx'), bytes);
        try {
          const pdf = await convertDocxToPdfExact(bytes);
          await mkdir(path.join(out, 'PDF'), { recursive: true });
          await writeFile(path.join(out, 'PDF', 'Quarterly_Report.pdf'), pdf);
          report.pdfReady = true;
        } catch (error) {
          report.warning = `Word is ready. PDF conversion failed: ${(error as Error).message}`;
        }
        await zipDirectory(out, path.join(directory(id), 'download.zip'));
        report.status = 'done';
      } catch (error) {
        report.status = 'failed';
        report.warning = (error as Error).message;
      }
      report.updatedAt = new Date().toISOString();
      await persist(report);
    })().catch(() => undefined);
    return report;
  } finally { locks.delete(id); }
}

export async function quarterlyDownload(id: string, format: 'word' | 'pdf' | 'zip'): Promise<{ path: string; name: string }> {
  const report = await getQuarterly(id);
  if (report.status !== 'done') throw new Error('The quarterly export is not ready.');
  if (format === 'pdf' && !report.pdfReady) throw new Error('PDF is unavailable; use the Word copy.');
  const extension = format === 'word' ? 'docx' : format;
  const location = format === 'zip' ? 'download.zip' : `output/${format === 'word' ? 'Word' : 'PDF'}/Quarterly_Report.${extension}`;
  return { path: path.join(directory(id), location), name: `${report.profileId}_Quarterly_${report.values.periodStart}_${report.values.periodEnd}.${extension}` };
}