import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { config } from '../../config.js';
import { writeJsonAtomic } from '../../utils/atomicJson.js';
import { dateFromFileName, type ParseResult, type VoiceItem } from './parse.js';

export type NoteStatus = 'queued' | 'transcribing' | 'done' | 'failed';

export interface VoiceNote {
  id: string;
  /** audio = voice note file; text = pasted/typed report (no transcription needed). */
  kind: 'audio' | 'text';
  fileName: string;
  audioFile?: string;
  size: number;
  uploadedAt: string;
  updatedAt: string;
  /** Date found in the file name (Telegram/WhatsApp), if any. */
  recordedOn?: string;
  /** What "today" means in the note; sentences before any spoken date go here. */
  referenceDate: string;
  status: NoteStatus;
  progress?: number;
  error?: string;
  model?: string;
  device?: string;
  duration?: number;
  /** Speech-to-text output, never changed afterwards. */
  transcript?: string;
  /** The reviewer's corrected transcript (used instead of the raw one when present). */
  editedTranscript?: string;
  segments?: { start: number; end: number; text: string }[];
  items?: VoiceItem[];
  skipped?: string[];
  itemsEdited?: boolean;
  appliedAt?: string;
  /** Drafts this note was written into, as "profile|YYYY-MM". */
  appliedTo?: string[];
}

export const AUDIO_TYPES: Record<string, string> = {
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  webm: 'audio/webm',
  flac: 'audio/flac',
  amr: 'audio/amr',
};

const ID_RE = /^[a-f0-9-]{36}$/;
const root = () => path.join(config.dataDir, 'voice');
const noteDir = (id: string) => {
  if (!ID_RE.test(id)) throw Object.assign(new Error('Unknown voice note.'), { status: 404 });
  return path.join(root(), 'notes', id);
};
const notePath = (id: string) => path.join(noteDir(id), 'note.json');

export function transcriptOf(note: VoiceNote): string {
  return note.editedTranscript ?? note.transcript ?? '';
}

export function audioPath(note: VoiceNote): string {
  if (!note.audioFile) throw Object.assign(new Error('This note has no audio.'), { status: 404 });
  return path.join(noteDir(note.id), note.audioFile);
}

export async function listNotes(): Promise<VoiceNote[]> {
  let ids: string[];
  try {
    ids = await readdir(path.join(root(), 'notes'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const notes: VoiceNote[] = [];
  for (const id of ids.filter((name) => ID_RE.test(name))) {
    try {
      notes.push(JSON.parse(await readFile(notePath(id), 'utf8')) as VoiceNote);
    } catch {
      /* half-written upload: skip */
    }
  }
  return notes.sort((a, b) => a.referenceDate.localeCompare(b.referenceDate) || a.uploadedAt.localeCompare(b.uploadedAt));
}

export async function getNote(id: string): Promise<VoiceNote> {
  try {
    return JSON.parse(await readFile(notePath(id), 'utf8')) as VoiceNote;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw Object.assign(new Error('Unknown voice note.'), { status: 404 });
    throw error;
  }
}

// Writes to one note are serialized so progress updates never overwrite a reviewer's edit.
const locks = new Map<string, Promise<unknown>>();
export async function updateNote(id: string, mutate: (note: VoiceNote) => void | Promise<void>): Promise<VoiceNote> {
  const previous = locks.get(id) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const note = await getNote(id);
    await mutate(note);
    note.updatedAt = new Date().toISOString();
    await writeJsonAtomic(notePath(id), note);
    return note;
  });
  locks.set(id, next);
  try {
    return await next;
  } finally {
    if (locks.get(id) === next) locks.delete(id);
  }
}

export async function createAudioNote(bytes: Uint8Array, fileName: string, fallbackDate: string): Promise<VoiceNote> {
  const ext = path.extname(fileName).slice(1).toLowerCase();
  if (!AUDIO_TYPES[ext]) throw Object.assign(new Error(`"${fileName}" is not a supported audio file (ogg, opus, mp3, m4a, wav, webm).`), { status: 400 });
  const id = randomUUID();
  const now = new Date().toISOString();
  const recordedOn = dateFromFileName(fileName);
  const note: VoiceNote = {
    id,
    kind: 'audio',
    fileName: path.basename(fileName).slice(0, 200),
    audioFile: `audio.${ext}`,
    size: bytes.length,
    uploadedAt: now,
    updatedAt: now,
    ...(recordedOn ? { recordedOn } : {}),
    referenceDate: recordedOn ?? fallbackDate,
    status: 'queued',
  };
  await mkdir(noteDir(id), { recursive: true });
  await writeFile(path.join(noteDir(id), note.audioFile!), bytes);
  await writeJsonAtomic(notePath(id), note);
  return note;
}

export async function createTextNote(text: string, referenceDate: string, title: string): Promise<VoiceNote> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const note: VoiceNote = {
    id,
    kind: 'text',
    fileName: title.trim().slice(0, 200) || `Text report ${referenceDate}`,
    size: text.length,
    uploadedAt: now,
    updatedAt: now,
    referenceDate,
    status: 'done',
    transcript: text,
  };
  await mkdir(noteDir(id), { recursive: true });
  await writeJsonAtomic(notePath(id), note);
  return note;
}

export async function deleteNote(id: string): Promise<void> {
  await rm(noteDir(id), { recursive: true, force: true });
}

export function withParse(note: VoiceNote, result: ParseResult): void {
  note.items = result.items;
  note.skipped = result.skipped;
  note.itemsEdited = false;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const DEFAULT_CORRECTIONS = [
  { from: 'Nathaniel', to: 'Nathanael' },
  { from: 'Natanael', to: 'Nathanael' },
  { from: 'Hana', to: 'Hanna' },
];

export const voiceSettingsSchema = z.object({
  /** "auto" = best model already downloaded (GPU prefers the large ones). */
  model: z.string().trim().regex(/^[a-z0-9.-]{2,40}$/i).default('auto'),
  device: z.enum(['auto', 'cpu', 'cuda']).default('auto'),
  language: z.string().trim().regex(/^(?:auto|[a-z]{2})$/).default('en'),
  /** Extra words the speech model should expect (places, foods, medication names). */
  vocabulary: z.string().trim().max(500).default(''),
  /** Spelling fixes applied to every transcript before it is read ("Rachel" -> "Rahel"). */
  corrections: z.array(z.object({ from: z.string().trim().min(1).max(60), to: z.string().trim().max(60) })).max(200).default(DEFAULT_CORRECTIONS),
});
export type VoiceSettings = z.infer<typeof voiceSettingsSchema>;

const settingsPath = () => path.join(root(), 'settings.json');

export async function loadVoiceSettings(): Promise<VoiceSettings> {
  try {
    return voiceSettingsSchema.parse(JSON.parse(await readFile(settingsPath(), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return voiceSettingsSchema.parse({});
  }
}

export async function saveVoiceSettings(input: unknown): Promise<VoiceSettings> {
  const settings = voiceSettingsSchema.parse(input);
  await mkdir(root(), { recursive: true });
  await writeJsonAtomic(settingsPath(), settings);
  return settings;
}
