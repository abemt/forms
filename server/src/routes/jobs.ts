import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { z, ZodError } from 'zod';
import { config } from '../config.js';
import {
  effectiveValues,
  jobManager,
  JobNotFoundError,
  JobStateError,
  TemplateError,
} from '../services/jobManager.js';
import { AiConfigError } from '../services/ai/client.js';
import type { Job } from '../types.js';
import { createLogger } from '../logger.js';
import fsSync from 'node:fs';
import { listProfiles, profileId, profileTemplate } from '../services/profiles.js';
import { buildWorkbook } from '../services/workbooks.js';

const log = createLogger('http');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 2 },
  fileFilter: (_req, file, cb) => {
    const name = file.originalname.toLowerCase();
    const isPdf = file.mimetype === 'application/pdf' || name.endsWith('.pdf');
    const isDocx =
      name.endsWith('.docx') ||
      file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (file.fieldname === 'template') {
      if (isPdf || isDocx) return cb(null, true);
      if (name.endsWith('.doc')) {
        return cb(
          new Error(
            `"${file.originalname}" is a legacy .doc file — save it as .docx in Word, or upload a fillable PDF.`,
          ),
        );
      }
      return cb(new Error(`"${file.originalname}" must be a fillable PDF or a Word (.docx) template.`));
    }
    if (isPdf || isDocx) return cb(null, true);
    cb(new Error(`"${file.originalname}" must be a PDF or Word (.docx) shift log.`));
  },
});

const overridesSchema = z.object({
  overrides: z.record(z.string(), z.union([z.string().max(20_000), z.boolean()])),
});

/** Full job payload for the client (includes per-shift merged values). */
function jobDetail(job: Job) {
  return {
    ...jobManager.summarize(job),
    autoGenerate: job.autoGenerate,
    completeRoutineFields: job.completeRoutineFields,
    logFileName: job.logFileName,
    templateFileName: job.templateFileName,
    templateSource: job.templateSource,
    templateFields: job.templateFields,
    monthLabel: job.monthLabel,
    warnings: job.warnings,
    shifts: job.shifts.map((s) => ({
      index: s.index,
      date: s.date,
      shift: s.shift,
      provider: s.provider,
      mood: s.mood,
      narrative: s.narrative,
      assignments: s.assignments,
      overrides: s.overrides,
      warnings: s.warnings,
      values: effectiveValues(s),
    })),
  };
}

function parseShiftIndex(req: Request): number {
  const index = Number.parseInt(req.params.index, 10);
  if (!Number.isInteger(index) || index < 0) throw new JobNotFoundError('Invalid shift index');
  return index;
}

export function jobsRouter(): Router {
  const router = Router();

  router.get('/', (_req, res) => res.json(jobManager.list()));

  // Create a job: multipart with "log" (required) and "template" (optional).
  router.post(
    '/',
    upload.fields([
      { name: 'log', maxCount: 1 },
      { name: 'template', maxCount: 1 },
    ]),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const files = req.files as Record<string, Express.Multer.File[]> | undefined;
        const logFile = files?.log?.[0];
        if (!logFile) {
          res.status(400).json({ error: 'A monthly shift log (PDF or Word .docx) is required (field "log").' });
          return;
        }
        const templateFile = files?.template?.[0];
        const autoGenerate = req.body?.autoGenerate === 'true';

        const job = await jobManager.createJob({
          logBytes: new Uint8Array(logFile.buffer),
          logFileName: logFile.originalname,
          templateBytes: templateFile ? new Uint8Array(templateFile.buffer) : undefined,
          templateFileName: templateFile?.originalname,
          autoGenerate,
          profileId: req.body?.profileId ? profileId(req.body.profileId) : undefined,
          saveTemplate: req.body?.saveTemplate === 'true',
          completeRoutineFields: req.body?.completeRoutineFields === undefined ? undefined : req.body.completeRoutineFields === 'true',
        });
        res.status(201).json(jobDetail(job));
      } catch (err) {
        next(err);
      }
    },
  );

  router.get('/:id', (req, res, next) => {
    try {
      res.json(jobDetail(jobManager.get(req.params.id)));
    } catch (err) {
      next(err);
    }
  });

  // Server-sent events with live progress.
  router.get('/:id/events', (req, res, next) => {
    try {
      const job = jobManager.get(req.params.id);
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      res.write(`data: ${JSON.stringify(jobManager.summarize(job))}\n\n`);

      const listener = (summary: unknown) => {
        res.write(`data: ${JSON.stringify(summary)}\n\n`);
      };
      jobManager.on(`update:${job.id}`, listener);
      const ping = setInterval(() => res.write(': ping\n\n'), 15_000);

      req.on('close', () => {
        clearInterval(ping);
        jobManager.off(`update:${job.id}`, listener);
      });
    } catch (err) {
      next(err);
    }
  });

  // Start phase 1+2 (read, extract, analyze). Fire-and-forget by design.
  router.post('/:id/extract', (req, res, next) => {
    try {
      const job = jobManager.get(req.params.id);
      if (job.status !== 'created') {
        throw new JobStateError(`Extraction already started (status: ${job.status}).`);
      }
      void jobManager.runExtraction(job.id);
      res.status(202).json({ started: true });
    } catch (err) {
      next(err);
    }
  });

  // Start phase 3 (generate + zip). Fire-and-forget by design.
  router.post('/:id/generate', (req, res, next) => {
    try {
      const job = jobManager.get(req.params.id);
      if (job.status !== 'review' && job.status !== 'done') {
        throw new JobStateError(`Generation requires the review state (status: ${job.status}).`);
      }
      void jobManager.runGeneration(job.id);
      res.status(202).json({ started: true });
    } catch (err) {
      next(err);
    }
  });

  // Manual edits from the review screen.
  router.patch('/:id/shifts/:index', async (req, res, next) => {
    try {
      const parsed = overridesSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid overrides payload.' });
        return;
      }
      const index = parseShiftIndex(req);
      const shift = await jobManager.setOverrides(req.params.id, index, parsed.data.overrides);
      res.json({
        index: shift.index,
        overrides: shift.overrides,
        values: effectiveValues(shift),
      });
    } catch (err) {
      next(err);
    }
  });

  // Live preview of a single filled form.
  router.get('/:id/shifts/:index/preview.pdf', async (req, res, next) => {
    try {
      const index = parseShiftIndex(req);
      const flatten = req.query.flatten === '1';
      const bytes = await jobManager.renderShiftPdf(req.params.id, index, flatten);
      res.setHeader('content-type', 'application/pdf');
      res.setHeader('content-disposition', `inline; filename="Form${String(index + 1).padStart(3, '0')}.pdf"`);
      res.setHeader('cache-control', 'no-store');
      res.send(Buffer.from(bytes));
    } catch (err) {
      next(err);
    }
  });

  // Download the finished ZIP.
  router.get('/:id/download', (req, res, next) => {
    try {
      const job = jobManager.get(req.params.id);
      if (!job.zipReady) {
        res.status(409).json({ error: 'The ZIP is not ready yet.' });
        return;
      }
      const zipPath = jobManager.zipPath(job);
      if (!fsSync.existsSync(zipPath)) {
        res.status(410).json({ error: 'The ZIP file no longer exists. Regenerate the forms.' });
        return;
      }
      res.download(zipPath, job.zipName ?? 'Forms.zip');
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/** Serve the built-in fillable §680 template so users can inspect/download it. */
export function templateRouter(): Router {
  const router = Router();
  router.get('/:profile/workbook.docx', async (req, res) => {
    try {
      const selected = profileId(req.params.profile);
      const month = z.string().parse(req.query.month);
      const bytes = await buildWorkbook(selected, month);
      res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${selected}_${month}_Daily_Log_Entry.docx"`);
      res.send(Buffer.from(bytes));
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  router.get('/profiles', async (_req, res, next) => {
    try { res.json(await listProfiles()); } catch (error) { next(error); }
  });
  router.get('/:profile/:kind.docx', async (req, res) => {
    try {
      const selected = profileId(req.params.profile);
      const kind = z.enum(['daily', 'quarterly']).parse(req.params.kind);
      const bytes = await profileTemplate(selected, kind);
      res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${selected}-${kind}.docx"`);
      res.send(Buffer.from(bytes));
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  router.get('/builtin-680.pdf', async (_req, res, next) => {
    try {
      const bytes = await jobManager.getBuiltinTemplate();
      res.setHeader('content-type', 'application/pdf');
      res.setHeader('content-disposition', 'inline; filename="Form680_Template.pdf"');
      res.send(Buffer.from(bytes));
    } catch (err) {
      next(err);
    }
  });
  return router;
}

export function errorHandler() {
  return (err: Error, _req: Request, res: Response, _next: NextFunction): void => {
    if (err instanceof JobNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof JobStateError || err instanceof TemplateError) {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof AiConfigError) {
      res.status(503).json({ error: err.message });
      return;
    }
    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `A file exceeds the ${config.maxUploadMb} MB upload limit.`
          : err.message;
      res.status(400).json({ error: message });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({ error: err.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ') });
      return;
    }
    const status = (err as { status?: unknown }).status;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      res.status(status).json({ error: err.message });
      return;
    }
    log.error(`unhandled: ${err.message}`, err.stack);
    res.status(500).json({ error: err.message || 'Internal server error' });
  };
}
