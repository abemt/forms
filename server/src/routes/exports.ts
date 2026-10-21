import { Router } from 'express';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { jobManager } from '../services/jobManager.js';
import { createExport, exportDownload, getExport } from '../services/reportExports.js';
import { exportOptionsSchema } from '../services/exportPlan.js';
import { personFromSpec } from '../services/local/person.js';
import { collectionForms, getPrintCollection } from '../services/printImports.js';

export function exportsRouter(): Router {
  const router = Router();
  router.post('/', async (req, res) => {
    try {
      if (req.body.collectionId) {
        const input = z.object({ collectionId: z.string().uuid(), options: exportOptionsSchema }).parse(req.body);
        const collection = await getPrintCollection(input.collectionId);
        res.status(202).json(await createExport(collection.id, collection.label, collectionForms(collection), input.options));
        return;
      }
      const input = z.object({ jobId: z.string().uuid(), options: exportOptionsSchema }).parse(req.body);
      const job = jobManager.get(input.jobId);
      if (job.status !== 'done' || job.errors.length) {
        res.status(409).json({ error: 'Finish generating every form before creating a print export.' });
        return;
      }
      const directory = path.join(jobManager.outputDir(job.id), 'Printable');
      const forms = await Promise.all(job.shifts.map(async (shift) => {
        const base = `Form${String(shift.index + 1).padStart(3, '0')}`;
        const wordPath = path.join(directory, `${base}.docx`);
        const pdfPath = path.join(directory, `${base}.pdf`);
        return { index: shift.index, date: shift.date, shift: shift.shift, provider: shift.provider,
          wordPath: await access(wordPath).then(() => wordPath, () => undefined),
          pdfPath: await access(pdfPath).then(() => pdfPath, () => undefined),
        };
      }));
      const record = await createExport(job.id, personFromSpec(job.form680Spec).given, forms, input.options);
      res.status(202).json(record);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });
  router.get('/:id', async (req, res) => {
    try { res.json(await getExport(z.string().uuid().parse(req.params.id))); }
    catch { res.status(404).json({ error: 'Export not found.' }); }
  });
  router.get('/:id/download', async (req, res) => {
    try {
      const artifact = req.query.artifact === undefined ? undefined : z.coerce.number().int().min(0).parse(req.query.artifact);
      const file = await exportDownload(z.string().uuid().parse(req.params.id), artifact);
      res.download(file.path, file.name);
    } catch (error) { res.status(409).json({ error: (error as Error).message }); }
  });
  return router;
}