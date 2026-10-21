import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config.js';
import { createQuarterly, generateQuarterly, getQuarterly, listQuarterly, quarterlyDownload, quarterlyInputSchema, updateQuarterly } from '../services/quarterlyReports.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (file.originalname.toLowerCase().endsWith('.docx')) callback(null, true);
    else callback(new Error('Quarterly templates must be Word (.docx) documents.'));
  },
});

export function quarterlyRouter(): Router {
  const router = Router();
  router.get('/', async (_req, res, next) => { try { res.json(await listQuarterly()); } catch (error) { next(error); } });
  router.post('/', upload.single('template'), async (req, res) => {
    try {
      const input = quarterlyInputSchema.parse(JSON.parse(req.body.options ?? '{}'));
      const report = await createQuarterly(input, req.file ? new Uint8Array(req.file.buffer) : undefined, req.file?.originalname);
      res.status(201).json(report);
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  router.get('/:id', async (req, res) => { try { res.json(await getQuarterly(req.params.id)); } catch { res.status(404).json({ error: 'Quarterly report not found.' }); } });
  router.patch('/:id', async (req, res) => {
    try {
      const input = z.object({ values: z.record(z.string(), z.string().max(20_000)) }).parse(req.body);
      res.json(await updateQuarterly(req.params.id, input.values));
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  router.post('/:id/generate', async (req, res) => {
    try {
      const input = z.object({ reviewed: z.literal(true), reviewer: z.string().trim().min(2).max(150) }).parse(req.body);
      res.status(202).json(await generateQuarterly(req.params.id, input.reviewer));
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  router.get('/:id/download', async (req, res) => {
    try {
      const format = z.enum(['word', 'pdf', 'zip']).parse(req.query.format ?? 'word');
      const file = await quarterlyDownload(req.params.id, format);
      res.download(file.path, file.name);
    } catch (error) { res.status(409).json({ error: (error as Error).message }); }
  });
  return router;
}