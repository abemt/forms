import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import type { Form680Spec } from './template680.js';

export const PROFILES = [
  { id: 'steven', name: 'Steven (Steve)', template: 'form680-default.docx' },
  { id: 'jerrell', name: 'Jerrell Wright', template: 'form680-jerrell.docx' },
] as const;
export type ProfileId = typeof PROFILES[number]['id'];
export type ReportKind = 'daily' | 'quarterly';

export function profileId(value: unknown): ProfileId {
  if (value !== 'steven' && value !== 'jerrell') throw new Error('Select Steven or Jerrell.');
  return value;
}

export function profileForSpec(spec?: Form680Spec): ProfileId | undefined {
  if (/\bjerrell\b/i.test(spec?.individualName ?? '')) return 'jerrell';
  if (/\bsteven?\b/i.test(spec?.individualName ?? '')) return 'steven';
  return undefined;
}

export function assertProfile(spec: Form680Spec, selected: ProfileId): void {
  if (profileForSpec(spec) !== selected) throw new Error(`The daily template does not identify ${PROFILES.find((profile) => profile.id === selected)!.name}. Upload the correct template.`);
}

function savedPath(selected: ProfileId, kind: ReportKind): string {
  return path.join(config.dataDir, 'profiles', selected, `${kind}.docx`);
}

export async function profileTemplate(selected: ProfileId, kind: ReportKind): Promise<Uint8Array> {
  try {
    return new Uint8Array(await readFile(savedPath(selected, kind)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (kind === 'quarterly' && selected === 'jerrell') throw new Error('Upload a quarterly Word template for Jerrell first.');
  const filename = kind === 'quarterly' ? 'quarterly-steven.docx' : PROFILES.find((profile) => profile.id === selected)!.template;
  return new Uint8Array(await readFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets', filename)));
}

export async function saveProfileTemplate(selected: ProfileId, kind: ReportKind, bytes: Uint8Array): Promise<void> {
  const target = savedPath(selected, kind);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

export async function listProfiles() {
  return Promise.all(PROFILES.map(async (profile) => ({
    id: profile.id,
    name: profile.name,
    dailyTemplate: await profileTemplate(profile.id, 'daily').then(() => true, () => false),
    quarterlyTemplate: await profileTemplate(profile.id, 'quarterly').then(() => true, () => false),
  })));
}