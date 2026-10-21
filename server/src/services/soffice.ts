import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLogger } from '../logger.js';

const log = createLogger('soffice');
const execFileAsync = promisify(execFile);

let sofficePath: string | null | undefined;

/** Locate the LibreOffice binary once; null when not installed. */
export async function findSoffice(): Promise<string | null> {
  if (sofficePath !== undefined) return sofficePath;
  const candidates = [
    process.env.SOFFICE_PATH,
    'soffice',
    'libreoffice',
    // Standard Windows / macOS install locations (not on PATH by default).
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  ].filter((c): c is string => Boolean(c));
  for (const candidate of candidates) {
    try {
      if (path.isAbsolute(candidate)) await fs.access(candidate);
      else await execFileAsync(candidate, ['--version'], { timeout: 30_000 });
      sofficePath = candidate;
      log.info(`LibreOffice found: ${candidate}`);
      return sofficePath;
    } catch {
      /* try next candidate */
    }
  }
  sofficePath = null;
  log.warn('LibreOffice not found — exact-layout DOCX rendering unavailable');
  return sofficePath;
}

/** LibreOffice cannot run concurrently against one profile; serialize calls. */
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

/**
 * Render a .docx to a visually exact (flat) PDF using headless LibreOffice.
 * Throws when LibreOffice is unavailable or conversion fails.
 */
export async function convertDocxToPdfExact(docxBytes: Uint8Array): Promise<Uint8Array> {
  const binary = await findSoffice();
  if (!binary) throw new Error('LibreOffice (soffice) is not installed');

  return enqueue(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'form680-soffice-'));
    try {
      const input = path.join(dir, 'template.docx');
      await fs.writeFile(input, docxBytes);
      const profile = pathToFileURL(path.join(dir, 'profile')).href;
      await execFileAsync(
        binary,
        [
          `-env:UserInstallation=${profile}`,
          '--headless',
          '--norestore',
          '--convert-to',
          'pdf',
          '--outdir',
          dir,
          input,
        ],
        { timeout: 120_000 },
      );
      const out = path.join(dir, 'template.pdf');
      const bytes = new Uint8Array(await fs.readFile(out));
      log.info(`rendered docx -> pdf (${bytes.length} bytes)`);
      return bytes;
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
}
