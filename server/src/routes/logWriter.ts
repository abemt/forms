import { Router, type Request } from 'express';
import { z } from 'zod';
import { jobManager } from '../services/jobManager.js';
import { buildDefaultDraft, buildFilledWorkbook, composeMonth, loadDraft, loadSettings, personForProfile, saveDraft, saveSettings, workbookFileName } from '../services/logWriter/writer.js';
import { EVENT_KINDS, draftSchema, type WriterDraft } from '../services/logWriter/types.js';
import { profileId } from '../services/profiles.js';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const monthSchema = z.string().regex(/^20\d{2}-(?:0[1-9]|1[0-2])$/);
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Days in the draft's range that already have forms in a saved daily report, so batches are not written twice. */
function alreadyReported(draft: WriterDraft): string | undefined {
  const [year, month] = draft.month.split('-').map(Number);
  const days = new Set<number>();
  const files = new Set<string>();
  for (const summary of jobManager.list()) {
    if (summary.profileId !== draft.profileId || summary.status === 'failed') continue;
    for (const shift of jobManager.get(summary.id).shifts) {
      const match = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(shift.date.trim());
      if (!match || Number(match[3]) !== year || match[1].toLowerCase() !== MONTHS[month - 1]) continue;
      const day = Number(match[2]);
      if (day < draft.fromDay || day > draft.toDay) continue;
      days.add(day);
      if (summary.logFileName) files.add(summary.logFileName);
    }
  }
  if (days.size === 0) return undefined;
  const sorted = [...days].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    ranges.push(i === j ? `${sorted[i]}` : `${sorted[i]}-${sorted[j]}`);
    i = j;
  }
  const name = MONTHS[month - 1][0].toUpperCase() + MONTHS[month - 1].slice(1);
  const last = sorted[sorted.length - 1];
  const next = sorted[0] === draft.fromDay && last - sorted[0] + 1 === sorted.length && last < draft.toDay
    ? `set "Write from day" to ${last + 1} to write only the new days`
    : 'start the range after them';
  return `${name} ${ranges.join(', ')} already ${sorted.length === 1 ? 'has' : 'have'} daily notes in a saved report (${[...files].slice(0, 3).join('; ')}). Unless you mean to replace those forms, ${next}.`;
}

async function compose(body: unknown) {
  const draft = draftSchema.parse(body);
  const profile = profileId(draft.profileId);
  const [settings, { person, individualId }] = await Promise.all([loadSettings(profile), personForProfile(profile)]);
  const preview = composeMonth({ draft, settings, person });
  const overlap = alreadyReported(draft);
  if (overlap) preview.assumptions.unshift(overlap);
  return { draft, settings, person, individualId, preview };
}

/** Log Writer: key events + routine -> filled Daily Log Entry workbook. */
export function logWriterRouter(): Router {
  const router = Router();

  router.get('/kinds', (_req, res) => res.json({ kinds: EVENT_KINDS }));

  router.get('/settings/:profile', async (req, res, next) => {
    try {
      res.json(await loadSettings(profileId(req.params.profile)));
    } catch (error) {
      next(error);
    }
  });

  router.put('/settings/:profile', async (req, res, next) => {
    try {
      res.json(await saveSettings(profileId(req.params.profile), req.body));
    } catch (error) {
      next(error);
    }
  });

  router.get('/drafts/:profile/:month', async (req, res, next) => {
    try {
      const profile = profileId(req.params.profile);
      const month = monthSchema.parse(req.params.month);
      const draft = await loadDraft(profile, month);
      res.json(draft ?? buildDefaultDraft(profile, month));
    } catch (error) {
      next(error);
    }
  });

  router.put('/drafts/:profile/:month', async (req, res, next) => {
    try {
      const profile = profileId(req.params.profile);
      const month = monthSchema.parse(req.params.month);
      res.json(await saveDraft({ ...(req.body as object), profileId: profile, month }));
    } catch (error) {
      next(error);
    }
  });

  // The month as it would be written: one entry per shift box, with wording warnings.
  router.post('/preview', async (req, res, next) => {
    try {
      const { preview } = await compose(req.body);
      res.json(preview);
    } catch (error) {
      next(error);
    }
  });

  router.post('/workbook', async (req: Request, res, next) => {
    try {
      const { settings, person, individualId, preview } = await compose(req.body);
      const bytes = await buildFilledWorkbook(preview, settings, person, individualId);
      res.setHeader('content-type', DOCX);
      res.setHeader('content-disposition', `attachment; filename="${workbookFileName(preview)}"`);
      res.send(Buffer.from(bytes));
    } catch (error) {
      next(error);
    }
  });

  // Write the workbook and start a daily report from it in one step. The job
  // uses the saved daily template and the routine-completion policy, and stops
  // at the review screen like any other completed draft.
  router.post('/jobs', async (req, res, next) => {
    try {
      const { draft, settings, person, individualId, preview } = await compose(req.body);
      await saveDraft(draft);
      const bytes = await buildFilledWorkbook(preview, settings, person, individualId);
      const job = await jobManager.createJob({
        logBytes: bytes,
        logFileName: workbookFileName(preview),
        autoGenerate: false,
        profileId: profileId(draft.profileId),
        completeRoutineFields: false,
      });
      void jobManager.runExtraction(job.id);
      res.status(201).json({ id: job.id, status: job.status, logFileName: job.logFileName });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
