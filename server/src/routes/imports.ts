import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { getPrintCollection, importPrintCollection, listPrintCollections } from '../services/printImports.js';
import { profileId } from '../services/profiles.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 120 } });

export function importsRouter(): Router {
  const router = Router();
  router.get('/', async (_req, res, next) => { try { res.json(await listPrintCollections()); } catch (error) { next(error); } });
  router.post('/', upload.array('files', 120), async (req, res) => {
    try {
      const files = (req.files ?? []) as Express.Multer.File[];
      const collection = await importPrintCollection(profileId(req.body.profileId), files.map((file) => ({ name: file.originalname, bytes: new Uint8Array(file.buffer) })), req.body.convertToWord === 'true');
      res.status(201).json(collection);
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  router.get('/:id', async (req, res) => { try { res.json(await getPrintCollection(req.params.id)); } catch { res.status(404).json({ error: 'Imported report not found.' }); } });
  return router;
}