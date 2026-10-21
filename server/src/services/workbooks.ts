import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { z } from 'zod';
import { docxParagraphs, parseForm680Spec } from './docxTemplate.js';
import { loadSettings } from './logWriter/writer.js';
import { profileTemplate, type ProfileId } from './profiles.js';

const execute = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export async function buildWorkbook(profile: ProfileId, month: string): Promise<Uint8Array> {
  z.string().regex(/^20\d{2}-(?:0[1-9]|1[0-2])$/).parse(month);
  if (profile === 'jerrell' && month < '2026-07') throw new Error('Jerrell was admitted in July 2026. Select July 2026 or later.');
  const spec = parseForm680Spec(docxParagraphs(await profileTemplate(profile, 'daily')));
  const { roster } = await loadSettings(profile);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'joy-workbook-'));
  try {
    const output = path.join(directory, 'workbook.docx');
    const rosterFile = path.join(directory, 'roster.json');
    await writeFile(rosterFile, JSON.stringify(roster));
    await execute(process.execPath, [path.join(root, 'scripts', 'site-workbook.mjs'), profile, month, output, spec.individualName, spec.individualId, rosterFile], { cwd: root, timeout: 30_000 });
    return new Uint8Array(await readFile(output));
  } finally { await rm(directory, { recursive: true, force: true }); }
}