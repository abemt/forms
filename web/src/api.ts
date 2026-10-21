import type { AppliedDraft, DailyInput, ExportOptions, ExportRecord, FieldValue, HealthInfo, JobDetail, JobSummary, PrintCollection, ProfileId, ProfileInfo, QuarterlyInput, QuarterlyReport, QuarterlySummary, VoiceEngineStatus, VoiceItem, VoiceNote, VoiceNoteSummary, VoiceSettings, WriterDraft, WriterPreview, WriterSettings } from './types';

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed with HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* keep default message */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export async function getHealth(): Promise<HealthInfo> {
  return handle(await fetch('/api/health'));
}

export async function createJob(input: DailyInput): Promise<JobDetail> {
  const form = new FormData();
  form.append('log', input.log);
  if (input.template) form.append('template', input.template);
  form.append('autoGenerate', String(input.autoGenerate));
  form.append('profileId', input.profileId);
  form.append('saveTemplate', String(input.saveTemplate));
  form.append('completeRoutineFields', String(input.completeRoutineFields));
  return handle(await fetch('/api/jobs', { method: 'POST', body: form }));
}

export async function getJob(id: string): Promise<JobDetail> {
  return handle(await fetch(`/api/jobs/${id}`));
}

export async function startExtraction(id: string): Promise<void> {
  await handle(await fetch(`/api/jobs/${id}/extract`, { method: 'POST' }));
}

export async function startGeneration(id: string): Promise<void> {
  await handle(await fetch(`/api/jobs/${id}/generate`, { method: 'POST' }));
}

export async function saveOverrides(
  id: string,
  shiftIndex: number,
  overrides: Record<string, FieldValue>,
): Promise<{ index: number; overrides: Record<string, FieldValue>; values: Record<string, FieldValue> }> {
  return handle(
    await fetch(`/api/jobs/${id}/shifts/${shiftIndex}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ overrides }),
    }),
  );
}

export function previewUrl(id: string, shiftIndex: number, cacheBuster: number): string {
  return `/api/jobs/${id}/shifts/${shiftIndex}/preview.pdf?t=${cacheBuster}`;
}

export function downloadUrl(id: string): string {
  return `/api/jobs/${id}/download`;
}

export const builtinTemplateUrl = '/api/templates/builtin-680.pdf';

export async function listJobs(): Promise<JobSummary[]> {
  return handle(await fetch('/api/jobs'));
}
export async function getProfiles(): Promise<ProfileInfo[]> {
  return handle(await fetch('/api/templates/profiles'));
}
export async function createPrintExport(sourceId: string, options: ExportOptions, collection = false): Promise<ExportRecord> {
  return handle(await fetch('/api/exports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ [collection ? 'collectionId' : 'jobId']: sourceId, options }) }));
}
export async function getPrintExport(id: string): Promise<ExportRecord> {
  return handle(await fetch(`/api/exports/${id}`));
}
export function printExportUrl(id: string, artifact?: number): string {
  return `/api/exports/${id}/download${artifact === undefined ? '' : `?artifact=${artifact}`}`;
}

export async function listQuarterlyReports(): Promise<QuarterlySummary[]> {
  return handle(await fetch('/api/quarterly'));
}
export async function getQuarterlyReport(id: string): Promise<QuarterlyReport> {
  return handle(await fetch(`/api/quarterly/${id}`));
}
export async function createQuarterlyReport(options: QuarterlyInput, template?: File): Promise<QuarterlyReport> {
  const form = new FormData();
  if (template) form.append('template', template);
  form.append('options', JSON.stringify(options));
  return handle(await fetch('/api/quarterly', { method: 'POST', body: form }));
}
export async function saveQuarterlyReport(id: string, values: Record<string, string>): Promise<QuarterlyReport> {
  return handle(await fetch(`/api/quarterly/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ values }) }));
}
export async function generateQuarterlyReport(id: string, reviewer: string): Promise<QuarterlyReport> {
  return handle(await fetch(`/api/quarterly/${id}/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reviewer, reviewed: true }) }));
}
export function quarterlyDownloadUrl(id: string, format: 'word' | 'pdf' | 'zip'): string {
  return `/api/quarterly/${id}/download?format=${format}`;
}

export async function importPrintFiles(profileId: ProfileId, files: File[], convertToWord: boolean): Promise<PrintCollection> {
  const form = new FormData();
  form.append('profileId', profileId);
  form.append('convertToWord', String(convertToWord));
  for (const file of files) form.append('files', file);
  return handle(await fetch('/api/imports', { method: 'POST', body: form }));
}
export async function getPrintCollection(id: string): Promise<PrintCollection> {
  return handle(await fetch(`/api/imports/${id}`));
}
export async function listPrintCollections(): Promise<{ id: string; profileId: ProfileId; label: string; createdAt: string; forms: number }[]> {
  return handle(await fetch('/api/imports'));
}

const json = (body: unknown): RequestInit => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
export async function getWriterSettings(profileId: ProfileId): Promise<WriterSettings> {
  return handle(await fetch(`/api/log-writer/settings/${profileId}`));
}
export async function saveWriterSettings(profileId: ProfileId, settings: WriterSettings): Promise<WriterSettings> {
  return handle(await fetch(`/api/log-writer/settings/${profileId}`, { method: 'PUT', ...json(settings) }));
}
export async function getWriterDraft(profileId: ProfileId, month: string): Promise<WriterDraft> {
  return handle(await fetch(`/api/log-writer/drafts/${profileId}/${month}`));
}
export async function saveWriterDraft(draft: WriterDraft): Promise<WriterDraft> {
  return handle(await fetch(`/api/log-writer/drafts/${draft.profileId}/${draft.month}`, { method: 'PUT', ...json(draft) }));
}
export async function previewWriterDraft(draft: WriterDraft): Promise<WriterPreview> {
  return handle(await fetch('/api/log-writer/preview', { method: 'POST', ...json(draft) }));
}
export async function downloadWriterWorkbook(draft: WriterDraft): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch('/api/log-writer/workbook', { method: 'POST', ...json(draft) });
  if (!res.ok) await handle(res);
  const match = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '');
  return { blob: await res.blob(), filename: match?.[1] ?? 'Daily_Log_Entry (filled).docx' };
}
export async function createWriterJob(draft: WriterDraft): Promise<{ id: string }> {
  return handle(await fetch('/api/log-writer/jobs', { method: 'POST', ...json(draft) }));
}

export async function getVoiceStatus(refresh = false): Promise<VoiceEngineStatus> {
  return handle(await fetch(`/api/voice/status${refresh ? '?refresh=1' : ''}`));
}
export async function getVoiceSettings(): Promise<VoiceSettings> {
  return handle(await fetch('/api/voice/settings'));
}
export async function saveVoiceSettings(settings: VoiceSettings): Promise<VoiceSettings> {
  return handle(await fetch('/api/voice/settings', { method: 'PUT', ...json(settings) }));
}
export async function listVoiceNotes(): Promise<VoiceNoteSummary[]> {
  return handle(await fetch('/api/voice/notes'));
}
export async function uploadVoiceNotes(files: File[], referenceDate: string): Promise<VoiceNoteSummary[]> {
  const form = new FormData();
  form.append('referenceDate', referenceDate);
  for (const file of files) form.append('files', file);
  return handle(await fetch('/api/voice/notes', { method: 'POST', body: form }));
}
export async function addTextReport(text: string, referenceDate: string, title: string): Promise<VoiceNote> {
  return handle(await fetch('/api/voice/notes/text', { method: 'POST', ...json({ text, referenceDate, title }) }));
}
export async function getVoiceNote(id: string): Promise<VoiceNote> {
  return handle(await fetch(`/api/voice/notes/${id}`));
}
export async function updateVoiceNote(id: string, patch: { referenceDate?: string; transcript?: string; items?: VoiceItem[] }): Promise<VoiceNote> {
  return handle(await fetch(`/api/voice/notes/${id}`, { method: 'PATCH', ...json(patch) }));
}
export async function reanalyzeVoiceNote(id: string): Promise<VoiceNote> {
  return handle(await fetch(`/api/voice/notes/${id}/reanalyze`, { method: 'POST' }));
}
export async function retranscribeVoiceNote(id: string): Promise<VoiceNoteSummary> {
  return handle(await fetch(`/api/voice/notes/${id}/retranscribe`, { method: 'POST' }));
}
export async function deleteVoiceNote(id: string): Promise<void> {
  await handle(await fetch(`/api/voice/notes/${id}`, { method: 'DELETE' }));
}
export async function applyVoiceNotes(noteIds: string[]): Promise<{ drafts: AppliedDraft[] }> {
  return handle(await fetch('/api/voice/apply', { method: 'POST', ...json({ noteIds }) }));
}
export function voiceAudioUrl(id: string): string {
  return `/api/voice/notes/${id}/audio`;
}
