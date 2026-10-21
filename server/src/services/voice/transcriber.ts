import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createLogger } from '../../logger.js';
import { loadSettings } from '../logWriter/writer.js';
import { PROFILES } from '../profiles.js';
import { analyzeNote, voicePeople } from './apply.js';
import { listNotes, loadVoiceSettings, updateNote, audioPath, type VoiceNote } from './store.js';

const execute = promisify(execFile);
const log = createLogger('voice');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const SCRIPT = path.join(ROOT, 'scripts', 'transcribe.py');
export const MODELS_DIR = process.env.WHISPER_MODELS_DIR ? path.resolve(process.env.WHISPER_MODELS_DIR) : path.join(ROOT, 'tools', 'whisper', 'models');

export interface EngineStatus {
  ok: boolean;
  python?: string;
  fasterWhisper?: string;
  cudaDevices?: number;
  cudaLibraries?: boolean;
  models: string[];
  error?: string;
  checkedAt: string;
}

function pythonCandidates(): string[] {
  const list: string[] = [];
  if (process.env.WHISPER_PYTHON) list.push(process.env.WHISPER_PYTHON);
  list.push(path.join(ROOT, 'tools', 'whisper', 'python', 'python.exe'));
  list.push(path.join(ROOT, 'tools', 'whisper', 'venv', 'bin', 'python'));
  if (process.platform !== 'win32') list.push('python3');
  return list;
}

function jsonLines(text: string): Record<string, unknown>[] {
  return text
    .split(/\r?\n/)
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return undefined;
      }
    })
    .filter((event): event is Record<string, unknown> => Boolean(event));
}

let cached: { at: number; status: EngineStatus } | undefined;

/** Is the offline speech-to-text engine installed? Cached for a minute. */
export async function engineStatus(force = false): Promise<EngineStatus> {
  if (!force && cached && Date.now() - cached.at < 60_000) return cached.status;
  let error = 'Voice transcription is not installed yet. Double-click setup-voice.cmd in the joy-form folder once (needs internet), then restart the app.';
  for (const python of pythonCandidates()) {
    if (path.isAbsolute(python) && !existsSync(python)) continue;
    try {
      const { stdout } = await execute(python, [SCRIPT, '--check', '--models-dir', MODELS_DIR], { cwd: ROOT, timeout: 90_000, windowsHide: true });
      const check = jsonLines(stdout).find((event) => event.event === 'check');
      if (!check) continue;
      if (!check.ok) {
        error = String(check.error ?? error);
        continue;
      }
      const status: EngineStatus = {
        ok: true,
        python,
        fasterWhisper: String(check.fasterWhisper ?? ''),
        cudaDevices: Number(check.cudaDevices ?? 0),
        cudaLibraries: Boolean(check.cudaLibraries),
        models: Array.isArray(check.models) ? (check.models as string[]) : [],
        checkedAt: new Date().toISOString(),
      };
      if (status.models.length === 0) status.error = 'No speech model is downloaded yet; the first transcription downloads one (needs internet).';
      cached = { at: Date.now(), status };
      return status;
    } catch (reason) {
      error = `Voice engine check failed: ${(reason as Error).message}`;
    }
  }
  const status: EngineStatus = { ok: false, models: [], error, checkedAt: new Date().toISOString() };
  cached = { at: Date.now(), status };
  return status;
}

/** Names and places the speech model should spell correctly. Never includes misspellings. */
export async function whisperPrompt(vocabulary: string): Promise<string> {
  const people = await voicePeople();
  const settings = await Promise.all(PROFILES.map((profile) => loadSettings(profile.id)));
  const staff = [...new Set(settings.flatMap((s) => Object.values(s.roster)).map((name) => name.replace(/,.*$/, '').trim()))];
  const programs = [...new Set(settings.map((s) => s.program.name).filter((name) => name && name !== 'day support'))];
  const residents = people.map((p) => p.first).join(' and ');
  return [`Daily report from the group home about ${residents}.`, staff.length ? `Staff: ${staff.join(', ')}.` : '', programs.join(', '), 'Day program, medications, dinner.', vocabulary]
    .filter(Boolean)
    .join(' ')
    .slice(0, 700);
}

export interface QueueState {
  running: boolean;
  current?: string;
  model?: string;
  device?: string;
  message?: string;
}

class TranscriptionQueue {
  state: QueueState = { running: false };
  private busy = false;

  kick(): void {
    void this.run().catch((error: Error) => {
      log.error(`transcription queue: ${error.message}`);
      this.state = { running: false, message: error.message };
      this.busy = false;
    });
  }

  private async run(): Promise<void> {
    if (this.busy) return;
    const pending = (await listNotes()).filter((note) => note.kind === 'audio' && note.status === 'queued');
    if (pending.length === 0) return;
    const engine = await engineStatus();
    if (!engine.ok || !engine.python) {
      this.state = { running: false, message: engine.error };
      return;
    }
    this.busy = true;
    this.state = { running: true, message: 'Starting the speech engine...' };
    const settings = await loadVoiceSettings();
    const dir = await mkdtemp(path.join(os.tmpdir(), 'joy-voice-'));
    const started = new Set<string>();
    const finished = new Set<string>();
    let stderr = '';
    try {
      const jobs = pending.map((note) => ({ id: note.id, audio: audioPath(note), out: path.join(dir, `${note.id}.json`) }));
      const jobsFile = path.join(dir, 'jobs.json');
      await writeFile(jobsFile, JSON.stringify(jobs));
      const prompt = await whisperPrompt(settings.vocabulary);
      const args = [SCRIPT, '--jobs', jobsFile, '--models-dir', MODELS_DIR, '--model', settings.model, '--device', settings.device, '--language', settings.language, '--prompt', prompt];
      log.info(`transcribing ${jobs.length} voice note(s)`);
      await new Promise<void>((resolve) => {
        const child = spawn(engine.python!, args, { cwd: ROOT, windowsHide: true });
        child.stderr.on('data', (chunk: Buffer) => {
          stderr = (stderr + chunk.toString()).slice(-4000);
        });
        const lines = readline.createInterface({ input: child.stdout });
        let chain = Promise.resolve();
        lines.on('line', (line) => {
          const event = jsonLines(line)[0];
          if (event) chain = chain.then(() => this.handle(event, dir, started, finished)).catch((error: Error) => log.error(`voice event: ${error.message}`));
        });
        child.on('error', (error) => {
          stderr += `\n${error.message}`;
        });
        child.on('close', () => {
          void chain.then(() => resolve());
        });
      });
    } finally {
      for (const note of pending) {
        if (finished.has(note.id)) continue;
        const reason = stderr.trim().split(/\r?\n/).slice(-3).join(' ') || 'The speech engine stopped before finishing this note.';
        await updateNote(note.id, (n) => {
          if (n.status === 'transcribing' || n.status === 'queued') {
            n.status = 'failed';
            n.error = reason;
          }
        }).catch(() => undefined);
      }
      await rm(dir, { recursive: true, force: true });
      this.busy = false;
      this.state = { ...this.state, running: false, current: undefined, message: undefined };
    }
    // Notes uploaded while this batch ran.
    if ((await listNotes()).some((note) => note.kind === 'audio' && note.status === 'queued')) this.kick();
  }

  private async handle(event: Record<string, unknown>, dir: string, started: Set<string>, finished: Set<string>): Promise<void> {
    const id = typeof event.id === 'string' ? event.id : undefined;
    switch (event.event) {
      case 'status':
      case 'warning':
        this.state = { ...this.state, message: String(event.message ?? '') };
        break;
      case 'model':
        this.state = { ...this.state, model: String(event.model), device: String(event.device), message: undefined };
        break;
      case 'start':
        if (!id) return;
        started.add(id);
        this.state = { ...this.state, current: id };
        await updateNote(id, (note) => {
          note.status = 'transcribing';
          note.progress = 0;
          delete note.error;
        });
        break;
      case 'progress':
        if (!id) return;
        await updateNote(id, (note) => {
          note.progress = Number(event.ratio ?? 0);
        });
        break;
      case 'done': {
        if (!id) return;
        const result = JSON.parse(await readFile(path.join(dir, `${id}.json`), 'utf8')) as {
          text: string;
          duration: number;
          model: string;
          device: string;
          segments: VoiceNote['segments'];
        };
        await updateNote(id, async (note) => {
          note.status = 'done';
          note.progress = 1;
          note.transcript = result.text;
          delete note.editedTranscript;
          note.segments = result.segments;
          note.duration = result.duration;
          note.model = result.model;
          note.device = result.device;
          await analyzeNote(note);
        });
        finished.add(id);
        log.info(`voice note ${id} transcribed (${result.duration}s audio, ${result.model} on ${result.device})`);
        break;
      }
      case 'error':
        if (!id) return;
        await updateNote(id, (note) => {
          note.status = 'failed';
          note.error = String(event.message ?? 'Transcription failed.');
        });
        finished.add(id);
        break;
      default:
        break;
    }
  }
}

export const transcriptionQueue = new TranscriptionQueue();

/** On startup: notes cut off by a restart go back in the queue. */
export async function initVoice(): Promise<void> {
  const notes = await listNotes();
  for (const note of notes.filter((n) => n.status === 'transcribing')) {
    await updateNote(note.id, (n) => {
      n.status = 'queued';
      n.progress = 0;
    });
  }
  if (notes.some((note) => note.kind === 'audio' && (note.status === 'queued' || note.status === 'transcribing'))) transcriptionQueue.kick();
}
