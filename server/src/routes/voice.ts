import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config.js';
import { analyzeNote, applyNotes, reclassify, removeNoteFromDrafts } from '../services/voice/apply.js';
import { engineStatus, transcriptionQueue } from '../services/voice/transcriber.js';
import {
  AUDIO_TYPES,
  audioPath,
  createAudioNote,
  createTextNote,
  deleteNote,
  getNote,
  listNotes,
  loadVoiceSettings,
  saveVoiceSettings,
  updateNote,
  type VoiceNote,
} from '../services/voice/store.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 60 } });
const isoDate = z.string().regex(/^20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/);
const today = () => new Date().toISOString().slice(0, 10);

const itemSchema = z.object({
  id: z.string().max(20),
  date: isoDate,
  people: z.array(z.string().max(30)).min(1).max(5),
  shift: z.enum(['day', 'evening', 'night']),
  text: z.string().trim().min(1).max(2000),
  original: z.string().max(4000),
  topics: z.array(z.string().max(20)).max(30),
  moods: z.array(z.string().max(30)).max(5),
  moodAllDay: z.boolean().optional(),
  program: z.enum(['attended', 'home']).optional(),
  flags: z.array(z.enum(['health', 'behavior', 'incident'])).max(3),
  dateReason: z.string().max(300),
  shiftReason: z.string().max(300),
  excluded: z.boolean().optional(),
});
const patchSchema = z.object({
  referenceDate: isoDate.optional(),
  transcript: z.string().max(100_000).optional(),
  items: z.array(itemSchema).max(1000).optional(),
});

/** List rows: everything except the long transcript segments. */
function summary(note: VoiceNote) {
  const { segments: _segments, ...rest } = note;
  const dates = [...new Set((note.items ?? []).filter((i) => !i.excluded).map((i) => i.date))].sort();
  return { ...rest, items: undefined, itemCount: note.items?.filter((i) => !i.excluded).length ?? 0, dates };
}

/** Voice notes: upload, offline transcription, review, and hand-off into Log writer drafts. */
export function voiceRouter(): Router {
  const router = Router();

  router.get('/status', async (req, res, next) => {
    try {
      res.json({ engine: await engineStatus(req.query.refresh === '1'), queue: transcriptionQueue.state });
    } catch (error) {
      next(error);
    }
  });

  router.get('/settings', async (_req, res, next) => {
    try {
      res.json(await loadVoiceSettings());
    } catch (error) {
      next(error);
    }
  });

  router.put('/settings', async (req, res, next) => {
    try {
      res.json(await saveVoiceSettings(req.body));
    } catch (error) {
      next(error);
    }
  });

  router.get('/notes', async (_req, res, next) => {
    try {
      res.json((await listNotes()).map(summary));
    } catch (error) {
      next(error);
    }
  });

  router.post('/notes', upload.array('files', 60), async (req, res, next) => {
    try {
      const files = (req.files ?? []) as Express.Multer.File[];
      if (files.length === 0) {
        res.status(400).json({ error: 'Choose at least one voice note (ogg, opus, mp3, m4a, wav).' });
        return;
      }
      const fallback = isoDate.safeParse(req.body?.referenceDate).success ? String(req.body.referenceDate) : today();
      const created: VoiceNote[] = [];
      for (const file of files) created.push(await createAudioNote(new Uint8Array(file.buffer), file.originalname, fallback));
      transcriptionQueue.kick();
      res.status(201).json(created.map(summary));
    } catch (error) {
      next(error);
    }
  });

  router.post('/notes/text', async (req, res, next) => {
    try {
      const body = z.object({ text: z.string().trim().min(3).max(100_000), referenceDate: isoDate, title: z.string().max(200).default('') }).parse(req.body);
      const note = await createTextNote(body.text, body.referenceDate, body.title);
      res.status(201).json(await updateNote(note.id, (n) => analyzeNote(n)));
    } catch (error) {
      next(error);
    }
  });

  router.get('/notes/:id', async (req, res, next) => {
    try {
      res.json(await getNote(req.params.id));
    } catch (error) {
      next(error);
    }
  });

  // Reference date or transcript changes re-read the note; item edits are kept as the reviewer made them.
  router.patch('/notes/:id', async (req, res, next) => {
    try {
      const body = patchSchema.parse(req.body);
      const note = await updateNote(req.params.id, async (n) => {
        if (body.items) {
          const before = new Map((n.items ?? []).map((item) => [item.id, item.text]));
          n.items = body.items.map((item) => (before.get(item.id) === item.text ? item : reclassify(item)));
          n.itemsEdited = true;
          return;
        }
        let reread = false;
        if (body.referenceDate && body.referenceDate !== n.referenceDate) {
          n.referenceDate = body.referenceDate;
          reread = true;
        }
        if (body.transcript !== undefined && body.transcript !== (n.editedTranscript ?? n.transcript)) {
          if (body.transcript === n.transcript) delete n.editedTranscript;
          else n.editedTranscript = body.transcript;
          reread = true;
        }
        if (reread && n.status === 'done') await analyzeNote(n);
      });
      res.json(note);
    } catch (error) {
      next(error);
    }
  });

  router.post('/notes/:id/reanalyze', async (req, res, next) => {
    try {
      res.json(await updateNote(req.params.id, (n) => analyzeNote(n)));
    } catch (error) {
      next(error);
    }
  });

  router.post('/notes/:id/retranscribe', async (req, res, next) => {
    try {
      const note = await updateNote(req.params.id, (n) => {
        if (n.kind !== 'audio') throw Object.assign(new Error('Typed reports have nothing to transcribe.'), { status: 409 });
        n.status = 'queued';
        n.progress = 0;
        delete n.error;
        delete n.transcript;
        delete n.editedTranscript;
        delete n.items;
        delete n.skipped;
      });
      transcriptionQueue.kick();
      res.json(summary(note));
    } catch (error) {
      next(error);
    }
  });

  router.delete('/notes/:id', async (req, res, next) => {
    try {
      const note = await getNote(req.params.id);
      await removeNoteFromDrafts(note);
      await deleteNote(note.id);
      res.json({ deleted: true });
    } catch (error) {
      next(error);
    }
  });

  router.get('/notes/:id/audio', async (req, res, next) => {
    try {
      const note = await getNote(req.params.id);
      const ext = (note.audioFile ?? '').split('.').pop() ?? '';
      res.setHeader('content-type', AUDIO_TYPES[ext] ?? 'application/octet-stream');
      res.setHeader('x-content-type-options', 'nosniff');
      res.sendFile(audioPath(note));
    } catch (error) {
      next(error);
    }
  });

  router.post('/apply', async (req, res, next) => {
    try {
      const { noteIds } = z.object({ noteIds: z.array(z.string().regex(/^[a-f0-9-]{36}$/)).min(1).max(500) }).parse(req.body);
      res.json({ drafts: await applyNotes(noteIds) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
