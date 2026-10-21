import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config, resolveEngine } from '../config.js';
import { createLogger } from '../logger.js';
import type {
  FieldValue,
  Job,
  JobSummary,
  ShiftRecord,
  TemplateFieldInfo,
} from '../types.js';
import { DiskCache } from './cache.js';
import { extractPdfPages } from './pdfText.js';
import { inspectTemplate, TemplateError } from './templateInspector.js';
import { buildForm680Template, DEFAULT_SPEC, type Form680Spec } from './template680.js';
import {
  buildTemplateFromDocx,
  docxParagraphs,
  isDocxTemplate,
  parseForm680Spec,
} from './docxTemplate.js';
import { docxLogPages } from './docxLog.js';
import { aiClient } from './ai/client.js';
import { extractShifts } from './ai/shiftExtractor.js';
import {
  basicFallbackAssignments,
  mapShiftToFields,
  validateAssignments,
} from './ai/fieldMapper.js';
import { extractShiftsLocally, type BlankBox } from './local/extractor.js';
import { mapShiftLocally } from './local/mapper.js';
import { completeAssignments } from './local/defaults.js';
import { fillBlankShifts, includeBlankShifts } from './local/blanks.js';
import { personFromSpec } from './local/person.js';
import { fillPdf } from './formFiller.js';
import { buildPrintableDocx } from './printableDocx.js';
import { fillDocxTemplate } from './docxFormFiller.js';
import { ensureSignaturesDir, signatureForProvider, signaturesDir } from './signatures.js';
import { zipDirectory } from './zipper.js';
import { mapWithConcurrency } from '../utils/concurrency.js';
import { dateSortKey, monthLabelFromDates } from '../utils/text.js';
import { assertProfile, profileForSpec, profileTemplate, saveProfileTemplate, type ProfileId } from './profiles.js';

const log = createLogger('jobs');

export class JobNotFoundError extends Error {}
export class JobStateError extends Error {}
export { TemplateError };

function formFileName(index: number): string {
  return `Form${String(index + 1).padStart(3, '0')}.pdf`;
}

function formDocxName(index: number): string {
  return `Form${String(index + 1).padStart(3, '0')}.docx`;
}

/** Merge AI assignments with manual review overrides (overrides win). */
export function effectiveValues(shift: ShiftRecord): Record<string, FieldValue> {
  const values: Record<string, FieldValue> = {};
  for (const a of shift.assignments) values[a.field] = a.value;
  for (const [field, value] of Object.entries(shift.overrides)) values[field] = value;
  return values;
}

export class JobManager extends EventEmitter {
  private readonly jobs = new Map<string, Job>();
  private readonly cache = new DiskCache(path.join(config.dataDir, 'cache'));
  private builtinTemplate: Uint8Array | undefined;
  private builtinSpec: Form680Spec | undefined;
  /** Per-job persist queues: serialize concurrent writes to job.json. */
  private readonly persistChains = new Map<string, Promise<void>>();

  jobDir(id: string): string {
    return path.join(config.dataDir, 'jobs', id);
  }

  private jobFile(id: string): string {
    return path.join(this.jobDir(id), 'job.json');
  }

  templatePath(id: string): string {
    return path.join(this.jobDir(id), 'template.pdf');
  }

  /** The Word template a job's forms are filled into (uploaded .docx templates only). */
  templateDocxPath(id: string): string {
    return path.join(this.jobDir(id), 'template.docx');
  }

  private builtinDocxPath(): string {
    return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'form680-default.docx');
  }

  logPath(id: string): string {
    return path.join(this.jobDir(id), 'log.pdf');
  }

  logDocxPath(id: string): string {
    return path.join(this.jobDir(id), 'log.docx');
  }

  outputDir(id: string): string {
    return path.join(this.jobDir(id), 'output');
  }

  zipPath(job: Job): string {
    return path.join(this.jobDir(job.id), job.zipName ?? 'Forms.zip');
  }

  async init(): Promise<void> {
    await fs.mkdir(path.join(config.dataDir, 'jobs'), { recursive: true });
    await ensureSignaturesDir();
    log.info(`signature images dir: ${signaturesDir()} (drop "<Staff Name>.png" files here)`);
    await this.loadPersistedJobs();
    await this.cleanupExpiredJobs();
  }

  private async loadPersistedJobs(): Promise<void> {
    const jobsRoot = path.join(config.dataDir, 'jobs');
    let entries: string[] = [];
    try {
      entries = await fs.readdir(jobsRoot);
    } catch {
      return;
    }
    for (const id of entries) {
      try {
        const raw = await fs.readFile(this.jobFile(id), 'utf8');
        const job = JSON.parse(raw) as Job;
        // A server restart aborts in-flight work; reflect that honestly.
        if (job.status === 'processing' || job.status === 'generating') {
          job.status = 'failed';
          job.stage = 'Interrupted by a server restart. Please start again.';
          job.errors.push('Processing was interrupted by a server restart.');
        }
        this.jobs.set(job.id, job);
      } catch {
        /* ignore unreadable job dirs */
      }
    }
    if (this.jobs.size > 0) log.info(`restored ${this.jobs.size} persisted job(s)`);
  }

  private async cleanupExpiredJobs(): Promise<void> {
    if (config.jobTtlHours <= 0) return;
    const cutoff = Date.now() - config.jobTtlHours * 3600_000;
    for (const job of [...this.jobs.values()]) {
      if (new Date(job.createdAt).getTime() < cutoff) {
        this.jobs.delete(job.id);
        this.persistChains.delete(job.id);
        await fs.rm(this.jobDir(job.id), { recursive: true, force: true }).catch(() => undefined);
        log.info(`cleaned up expired job ${job.id}`);
      }
    }
  }

  private persist(job: Job): Promise<void> {
    // Progress updates fire from parallel workers; chain writes per job so a
    // tmp-file rename never races another writer, and use unique tmp names.
    const prev = this.persistChains.get(job.id) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(async () => {
        const file = this.jobFile(job.id);
        const tmp = `${file}.${crypto.randomUUID()}.tmp`;
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(tmp, JSON.stringify(job), 'utf8');
        await fs.rename(tmp, file);
      });
    this.persistChains.set(job.id, next);
    return next;
  }

  private emitUpdate(job: Job): void {
    this.emit(`update:${job.id}`, this.summarize(job));
  }

  private async update(job: Job, mutate: (j: Job) => void): Promise<void> {
    mutate(job);
    await this.persist(job);
    this.emitUpdate(job);
  }

  get(id: string): Job {
    const job = this.jobs.get(id);
    if (!job) throw new JobNotFoundError(`Job ${id} not found`);
    return job;
  }

  list(): JobSummary[] {
    return [...this.jobs.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).map((job) => this.summarize(job));
  }

  summarize(job: Job): JobSummary {
    return {
      id: job.id,
      profileId: job.profileId ?? profileForSpec(job.form680Spec),
      individualName: job.form680Spec?.individualName,
      createdAt: job.createdAt,
      logFileName: job.logFileName,
      monthLabel: job.monthLabel,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      shiftsFound: job.shifts.length,
      formsCompleted: job.status === 'done' ? job.shifts.length : job.progress.current,
      errors: job.errors,
      warningCount:
        job.warnings.length + job.shifts.reduce((acc, s) => acc + s.warnings.length, 0),
      zipName: job.zipName,
      zipReady: job.zipReady,
    };
  }

  async getBuiltinTemplate(): Promise<Uint8Array> {
    if (!this.builtinTemplate) {
      // The bundled Form §680 Word template is the source of truth so the
      // default output matches the agency's document exactly. The structural
      // generator remains as the fallback when the asset or LibreOffice is
      // unavailable.
      const assetPath = this.builtinDocxPath();
      try {
        const docx = new Uint8Array(await fs.readFile(assetPath));
        this.builtinSpec = parseForm680Spec(docxParagraphs(docx));
        this.builtinTemplate = await buildTemplateFromDocx(docx);
        log.info('built-in Form §680 template rendered from bundled Word document');
      } catch (err) {
        log.warn(`bundled template unavailable (${(err as Error).message}); using generator`);
        this.builtinSpec = DEFAULT_SPEC;
        this.builtinTemplate = await buildForm680Template();
        log.info('built-in Form §680 template generated');
      }
    }
    return this.builtinTemplate;
  }

  /**
   * Create a job from an uploaded monthly log and either an uploaded fillable
   * template or the built-in Form §680 template.
   */
  async createJob(input: {
    logBytes: Uint8Array;
    logFileName: string;
    templateBytes?: Uint8Array;
    templateFileName?: string;
    autoGenerate: boolean;
    profileId?: ProfileId;
    saveTemplate?: boolean;
    completeRoutineFields?: boolean;
  }): Promise<Job> {
    const id = crypto.randomUUID();
    const uploadedTemplate = input.templateBytes;
    if (!input.templateBytes && input.profileId) {
      input = { ...input, templateBytes: await profileTemplate(input.profileId, 'daily'), templateFileName: `${input.profileId}-daily.docx` };
    }
    let templateSource: Job['templateSource'] = 'builtin';
    let templateBytes: Uint8Array;
    let form680Spec: Form680Spec | undefined;
    if (!input.templateBytes) {
      templateBytes = await this.getBuiltinTemplate();
      form680Spec = this.builtinSpec;
    } else if (isDocxTemplate(input.templateFileName, input.templateBytes)) {
      // Word templates carry no AcroForm fields — rebuild them as fillable PDFs.
      templateBytes = await buildTemplateFromDocx(input.templateBytes);
      templateSource = 'docx';
      form680Spec = parseForm680Spec(docxParagraphs(input.templateBytes));
    } else {
      templateBytes = input.templateBytes;
      templateSource = 'upload';
    }

    if (input.profileId && form680Spec) assertProfile(form680Spec, input.profileId);
    if (input.profileId && !form680Spec) throw new TemplateError('Use a Word template when selecting a saved individual.');

    // Validate the template up-front so failures happen at upload time.
    const templateFields: TemplateFieldInfo[] = await inspectTemplate(templateBytes);

    const dir = this.jobDir(id);
    await fs.mkdir(dir, { recursive: true });
    if (templateSource === 'docx' && input.templateBytes) {
      await fs.writeFile(this.templateDocxPath(id), input.templateBytes);
    }
    // Word shift logs (e.g. the filled Daily Log Entry workbook) are kept as
    // .docx and read directly at extraction time; PDFs go through pdf.js.
    if (isDocxTemplate(input.logFileName, input.logBytes)) {
      log.info(`log "${input.logFileName}" is a Word document — will be read directly`);
      await fs.writeFile(this.logDocxPath(id), input.logBytes);
    } else {
      await fs.writeFile(this.logPath(id), input.logBytes);
    }
    await fs.writeFile(this.templatePath(id), templateBytes);

    const job: Job = {
      id,
      profileId: input.profileId ?? profileForSpec(form680Spec),
      completeRoutineFields: input.completeRoutineFields ?? false,
      createdAt: new Date().toISOString(),
      status: 'created',
      stage: 'Upload received.',
      progress: { current: 0, total: 0 },
      autoGenerate: input.autoGenerate && input.completeRoutineFields !== true,
      logFileName: input.logFileName,
      templateFileName:
        templateSource === 'builtin'
          ? 'Built-in Form §680 (Joy Group Home)'
          : templateSource === 'docx'
            ? `${input.templateFileName ?? 'template.docx'} (converted to fillable PDF)`
            : (input.templateFileName ?? 'template.pdf'),
      templateSource,
      form680Spec,
      templateFields,
      shifts: [],
      errors: [],
      warnings: [],
      zipReady: false,
    };
    this.jobs.set(id, job);
    await this.persist(job);
    if (uploadedTemplate && input.saveTemplate && input.profileId && form680Spec) {
      await saveProfileTemplate(input.profileId, 'daily', uploadedTemplate);
    }
    log.info(`job ${id} created (${templateFields.length} template fields, source=${templateSource})`);
    return job;
  }

  /** Text pages of the job's shift log — from the .docx directly or via pdf.js. */
  private async readLogPages(id: string): Promise<{ pages: string[]; paragraphLines: boolean }> {
    const docxPath = this.logDocxPath(id);
    const hasDocx = await fs
      .access(docxPath)
      .then(() => true)
      .catch(() => false);
    if (hasDocx) {
      return { pages: docxLogPages(new Uint8Array(await fs.readFile(docxPath))), paragraphLines: true };
    }
    return {
      pages: await extractPdfPages(new Uint8Array(await fs.readFile(this.logPath(id)))),
      paragraphLines: false,
    };
  }

  /** Phase 1+2: read the report, extract shifts with AI, map every shift. */
  async runExtraction(id: string): Promise<void> {
    const job = this.get(id);
    if (job.status !== 'created') {
      throw new JobStateError(`Job is ${job.status}; extraction can only start once.`);
    }
    await this.update(job, (j) => {
      j.status = 'processing';
      j.stage = 'Reading report...';
      j.progress = { current: 0, total: 0 };
    });

    try {
      const engine = resolveEngine();
      if (engine === 'ai') aiClient.assertConfigured();

      const { pages, paragraphLines } = await this.readLogPages(id);
      const totalChars = pages.reduce((n, p) => n + p.length, 0);
      if (totalChars < 40) {
        throw new Error(
          'No text found in the shift log. Scanned/image-only PDFs are not supported — upload the filled Word workbook or export the log as a text PDF.',
        );
      }

      await this.update(job, (j) => {
        j.stage = 'Extracting shifts...';
      });

      const skipped: BlankBox[] = [];
      let drafts =
        engine === 'local'
          ? extractShiftsLocally(pages, { paragraphLines, skipped })
          : await extractShifts(pages, aiClient, this.cache, (chunk, chunks, found) => {
              void this.update(job, (j) => {
                j.stage = `Extracting shifts... (section ${chunk} of ${chunks}, ${found} found)`;
              });
            });

      if (drafts.length === 0) {
        throw new Error('No shifts were found in this report. Check that the correct PDF was uploaded.');
      }
      const blankNotes = new Map<string, string>();
      if (skipped.length > 0) {
        const describe = (s: { date: string; shift: string; provider: string }) =>
          `${s.date} ${s.shift}${s.provider ? ` (${s.provider.split(',')[0]})` : ''}`;
        if (config.fillBlankShifts && job.completeRoutineFields !== false) {
          const filled = fillBlankShifts(drafts, skipped, job.form680Spec);
          drafts = filled.drafts;
          const away = filled.fills.filter((f) => f.kind === 'away');
          const home = filled.fills.filter((f) => f.kind === 'home');
          const who = personFromSpec(job.form680Spec).first;
          for (const f of filled.fills) {
            blankNotes.set(
              `${f.date}|${f.shift}`,
              f.kind === 'away'
                ? `Blank shift box: notes around it show ${who} was away, so this form is marked out of facility.`
                : 'Blank shift box: no staff notes, completed as a routine shift from the default wording.',
            );
          }
          const parts: string[] = [];
          if (away.length) parts.push(`${away.length} as out-of-facility (${away.map(describe).join('; ')})`);
          if (home.length) parts.push(`${home.length} as routine shifts with default wording (${home.map(describe).join('; ')})`);
          job.warnings.push(
            `${skipped.length} shift box${skipped.length === 1 ? ' was' : 'es were'} left blank by staff and completed automatically: ${parts.join(' | ')}.`,
          );
        } else if (job.completeRoutineFields === false) {
          drafts = includeBlankShifts(drafts, skipped);
          for (const blank of skipped) {
            blankNotes.set(
              `${blank.date}|${blank.shift}`,
              'Retrospective draft: no narrative or verified observation was supplied for this shift; review the source record before filing.',
            );
          }
          job.warnings.push(
            `${skipped.length} blank shift box${skipped.length === 1 ? '' : 'es'} were included as review-only draft shifts. No routine completion is asserted.`,
          );
        } else {
          job.warnings.push(
            `${skipped.length} shift box${skipped.length === 1 ? '' : 'es'} had no mood and no notes and produced no form: ${skipped.map(describe).join('; ')}.`,
          );
        }
      }

      // Stable chronological order when dates parse; otherwise document order.
      const ordered = drafts
        .map((d, i) => ({ d, i, key: dateSortKey(d.date) }))
        .sort((a, b) => {
          if (a.key !== null && b.key !== null && a.key !== b.key) return a.key - b.key;
          return a.i - b.i;
        })
        .map((x) => x.d);

      const shifts: ShiftRecord[] = ordered.map((d, index) => ({
        index,
        ...d,
        assignments: [],
        overrides: {},
        warnings: [blankNotes.get(`${d.date}|${d.shift}`)].filter((w): w is string => Boolean(w)),
      }));

      await this.update(job, (j) => {
        j.shifts = shifts;
        j.monthLabel = monthLabelFromDates(shifts.map((s) => s.date));
        const who = personFromSpec(j.form680Spec);
        const prefix = who.full ? `${who.full.split(/\s+/)[0].replace(/[^A-Za-z]/g, '')}_` : '';
        j.zipName = `${prefix}${j.monthLabel ?? 'Report'}_Forms.zip`;
        j.progress = { current: 0, total: shifts.length };
        j.stage = `Found ${shifts.length} shifts. Analyzing shift 1 of ${shifts.length}...`;
      });

      // Phase 2: field mapping (parallel with a concurrency cap). The local
      // engine's output passes through the same evidence validator as AI
      // output, so ungrounded values can never reach a form.
      let completed = 0;
      await mapWithConcurrency(
        shifts,
        config.ai.concurrency,
        async (shift) => {
          const result =
            engine === 'local'
              ? validateAssignments(mapShiftLocally(shift, job.templateFields, job.form680Spec), shift, job.templateFields)
              : await mapShiftToFields(shift, job.templateFields, aiClient, this.cache);
          // Evidence-checked values first, then the completion policy fills
          // whatever the notes did not cover so no form goes out half-blank.
          const completed = job.completeRoutineFields === false
            ? { assignments: result.assignments, notes: [] }
            : completeAssignments(result.assignments, shift, job.templateFields, job.form680Spec);
          shift.assignments = completed.assignments;
          shift.warnings = [...shift.warnings, ...result.warnings, ...completed.notes];
          if (completed.assignments.length > result.assignments.length) {
            shift.warnings.push('Unverified routine defaults added. Staff must confirm these before export.');
          }
        },
        (index, _result, error) => {
          const shift = shifts[index];
          if (error) {
            shift.assignments = basicFallbackAssignments(shift, job.templateFields);
            shift.warnings.push(
              `Field mapping failed for this shift (${error.message}). Only basic fields were pre-filled — review carefully.`,
            );
          }
          completed++;
          void this.update(job, (j) => {
            j.progress = { current: completed, total: shifts.length };
            j.stage =
              completed < shifts.length
                ? `Analyzing shift ${Math.min(completed + 1, shifts.length)} of ${shifts.length}...`
                : 'Analysis complete.';
          });
        },
      );

      await this.update(job, (j) => {
        j.status = 'review';
        j.stage = `Ready for review: ${shifts.length} forms prepared.`;
        j.progress = { current: shifts.length, total: shifts.length };
      });

      if (job.autoGenerate && job.completeRoutineFields === false) {
        await this.runGeneration(id);
      }
    } catch (err) {
      const message = (err as Error).message;
      log.error(`job ${id} extraction failed: ${message}`);
      await this.update(job, (j) => {
        j.status = 'failed';
        j.stage = 'Failed.';
        j.errors.push(message);
      });
    }
  }

  /** Update manual overrides for one shift from the review screen. */
  async setOverrides(id: string, shiftIndex: number, overrides: Record<string, FieldValue>): Promise<ShiftRecord> {
    const job = this.get(id);
    if (job.status !== 'review' && job.status !== 'done') {
      throw new JobStateError('Forms can only be edited on the review screen.');
    }
    const shift = job.shifts[shiftIndex];
    if (!shift) throw new JobNotFoundError(`Shift ${shiftIndex} not found`);

    const known = new Set(job.templateFields.map((f) => f.name));
    const clean: Record<string, FieldValue> = {};
    for (const [field, value] of Object.entries(overrides)) {
      if (!known.has(field)) continue;
      if (typeof value !== 'string' && typeof value !== 'boolean') continue;
      clean[field] = value;
    }
    await this.update(job, () => {
      shift.overrides = clean;
      // Any edit invalidates a previously generated zip.
      if (job.status === 'done') {
        job.status = 'review';
        job.zipReady = false;
        job.stage = 'Edited after generation — regenerate to refresh the ZIP.';
      }
    });
    return shift;
  }

  /** Signature PNG for the shift's staff member (a Staff Name override wins). */
  private async shiftSignature(
    shift: ShiftRecord,
    values: Record<string, FieldValue>,
  ): Promise<Uint8Array | undefined> {
    const staffName = values['Staff Name'];
    const name = typeof staffName === 'string' && staffName.trim() ? staffName : shift.provider;
    return (await signatureForProvider(name)) ?? undefined;
  }

  /** Render one form on demand (used by the preview iframe). */
  async renderShiftPdf(id: string, shiftIndex: number, flatten: boolean): Promise<Uint8Array> {
    const job = this.get(id);
    const shift = job.shifts[shiftIndex];
    if (!shift) throw new JobNotFoundError(`Shift ${shiftIndex} not found`);
    const templateBytes = new Uint8Array(await fs.readFile(this.templatePath(id)));
    const values = effectiveValues(shift);
    const signatureImage = await this.shiftSignature(shift, values);
    const { bytes } = await fillPdf(templateBytes, values, { flatten, signatureImage });
    return bytes;
  }

  /** Phase 3: generate every editable + printable PDF in parallel, then zip. */
  async runGeneration(id: string): Promise<void> {
    const job = this.get(id);
    if (job.status !== 'review' && job.status !== 'done') {
      throw new JobStateError(`Job is ${job.status}; generation requires the review state.`);
    }
    await this.update(job, (j) => {
      j.status = 'generating';
      j.zipReady = false;
      j.progress = { current: 0, total: j.shifts.length };
      j.stage = `Generating PDF 1 of ${j.shifts.length}...`;
    });

    try {
      const templateBytes = new Uint8Array(await fs.readFile(this.templatePath(id)));
      const outDir = this.outputDir(id);
      await fs.rm(outDir, { recursive: true, force: true });
      await fs.mkdir(path.join(outDir, 'Editable'), { recursive: true });
      await fs.mkdir(path.join(outDir, 'Printable'), { recursive: true });

      // Word printables need the parsed §680 layout; jobs created before this
      // feature fall back to the built-in spec when they used the built-in template.
      let spec = job.form680Spec;
      if (!spec && job.templateSource === 'builtin') {
        await this.getBuiltinTemplate();
        spec = this.builtinSpec;
      }
      if (!spec) {
        const note =
          'Word (.docx) printables are only generated for the built-in or Word-derived templates; this uploaded PDF template produced PDF printables only.';
        if (!job.warnings.includes(note)) job.warnings.push(note);
      }
      // The Word printable is the agency's own template filled in; the
      // structural re-creation is only a fallback when no Word file exists.
      let docxTemplate: Uint8Array | undefined;
      if (spec) {
        const candidate = job.templateSource === 'builtin' ? this.builtinDocxPath() : this.templateDocxPath(id);
        docxTemplate = await fs
          .readFile(candidate)
          .then((b) => new Uint8Array(b))
          .catch(() => undefined);
      }

      let completed = 0;
      const { errors } = await mapWithConcurrency(
        job.shifts,
        config.pdfConcurrency,
        async (shift) => {
          const values = effectiveValues(shift);
          const signatureImage = await this.shiftSignature(shift, values);
          const editable = await fillPdf(templateBytes, values, { flatten: false, signatureImage });
          const printable = await fillPdf(templateBytes, values, { flatten: true, signatureImage });
          const name = formFileName(shift.index);
          await fs.writeFile(path.join(outDir, 'Editable', name), editable.bytes);
          await fs.writeFile(path.join(outDir, 'Printable', name), printable.bytes);
          if (spec) {
            try {
              const docxBytes = docxTemplate
                ? await fillDocxTemplate(docxTemplate, spec, values, { signaturePng: signatureImage })
                : await buildPrintableDocx(spec, values, { signaturePng: signatureImage });
              await fs.writeFile(path.join(outDir, 'Printable', formDocxName(shift.index)), docxBytes);
            } catch (err) {
              shift.warnings.push(`Word printable failed: ${(err as Error).message}`);
            }
          }
          for (const w of [...editable.warnings, ...printable.warnings]) {
            if (!shift.warnings.includes(w)) shift.warnings.push(w);
          }
        },
        (index, _result, error) => {
          completed++;
          void this.update(job, (j) => {
            if (error) j.errors.push(`Form ${formFileName(index)} failed: ${error.message}`);
            j.progress = { current: completed, total: j.shifts.length };
            j.stage =
              completed < j.shifts.length
                ? `Generating PDF ${Math.min(completed + 1, j.shifts.length)} of ${j.shifts.length}...`
                : 'Zipping...';
          });
        },
      );

      const failures = errors.filter(Boolean).length;
      if (failures === job.shifts.length) {
        throw new Error('Every PDF failed to generate.');
      }

      await this.update(job, (j) => {
        j.stage = 'Zipping...';
      });
      await zipDirectory(this.outputDir(id), this.zipPath(job), 'print');

      await this.update(job, (j) => {
        j.status = 'done';
        j.zipReady = true;
        j.stage = `Finished. ${j.shifts.length - failures} of ${j.shifts.length} forms generated.`;
        j.progress = { current: j.shifts.length, total: j.shifts.length };
      });
    } catch (err) {
      const message = (err as Error).message;
      log.error(`job ${id} generation failed: ${message}`);
      await this.update(job, (j) => {
        j.status = 'failed';
        j.stage = 'Failed.';
        j.errors.push(message);
      });
    }
  }
}

export const jobManager = new JobManager();
