import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { cleanSignaturePng } from './signatureImage.js';

const log = createLogger('signatures');

/** Cleaned stamps per file, invalidated when the PNG changes on disk. */
const cleanCache = new Map<string, { key: string; bytes: Uint8Array }>();

/**
 * Staff signature images. Drop a PNG or JPEG per staff member into
 * `<dataDir>/signatures/` named after them (e.g. "Hanna Tafesse.png" or
 * "hanna-tafesse.jpg"). When a shift's assigned provider matches a file, the
 * image is cleaned up (cropped, background removed) and stamped onto the
 * Staff Signature area of every generated form — no manual signing needed.
 * No match -> the usual typed initials are used.
 */

export function signaturesDir(): string {
  return path.join(config.dataDir, 'signatures');
}

export async function ensureSignaturesDir(): Promise<void> {
  await fs.mkdir(signaturesDir(), { recursive: true });
}

/** "Hanna Tafesse, DSP" -> "hannatafesse"; "hanna-tafesse.png" -> "hannatafesse". */
function normalizeName(raw: string): string {
  return nameTokens(raw).join('');
}

const ROLE_WORDS = new Set(['dsp', 'qidp', 'idp', 'rn', 'lpn', 'cna', 'dcw', 'dsw', 'hha', 'pca', 'staff', 'caregiver']);

/** Lower-case name words without role suffixes: "Natanael DSP" -> ["natanael"]. */
function nameTokens(raw: string): string[] {
  return raw
    .replace(/\.(png|jpe?g)$/i, '')
    .split(',')[0]
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t && !ROLE_WORDS.has(t));
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

const similarity = (a: string, b: string): number =>
  a && b ? 1 - levenshtein(a, b) / Math.max(a.length, b.length) : 0;

/**
 * How well a signature file name matches a provider name (0..1). Exact and
 * containment matches score highest; otherwise spelling variants of the
 * first/last name ("Natanael" ~ "Nathaniel", "Hana" ~ "Hanna") still match.
 */
function matchScore(provider: string, fileName: string): number {
  const p = normalizeName(provider);
  const f = normalizeName(fileName);
  if (!p || !f) return 0;
  if (p === f) return 1;
  if (p.length >= 4 && f.length >= 4 && (p.includes(f) || f.includes(p))) return 0.9;
  const pt = nameTokens(provider);
  const ft = nameTokens(fileName);
  const first = similarity(pt[0], ft[0]);
  if (first < 0.7) return 0;
  // Only a first name to go on ("Natanael DSP"): accept a close spelling.
  if (pt.length < 2 || ft.length < 2) return first >= 0.75 ? first : 0;
  const last = similarity(pt[pt.length - 1], ft[ft.length - 1]);
  return last >= 0.7 ? (first + last) / 2 : 0;
}

/** Find the signature image for a provider name; null when none matches. */
export async function signatureForProvider(provider: string): Promise<Uint8Array | null> {
  if (!normalizeName(provider ?? '')) return null;

  let files: string[];
  try {
    files = await fs.readdir(signaturesDir());
  } catch {
    return null;
  }

  // Best-scoring image wins; below 0.7 nothing is close enough to be safe.
  let partial: string | undefined;
  let best = 0.7;
  for (const f of files.filter((f) => /\.(png|jpe?g)$/i.test(f))) {
    const score = matchScore(provider, f);
    if (score >= best) {
      best = score;
      partial = f;
    }
  }
  if (!partial) return null;

  const file = path.join(signaturesDir(), partial);
  try {
    const stat = await fs.stat(file);
    const key = `${stat.mtimeMs}|${stat.size}`;
    const cached = cleanCache.get(file);
    if (cached && cached.key === key) return cached.bytes;
    const raw = new Uint8Array(await fs.readFile(file));
    let clean: Uint8Array;
    try {
      clean = cleanSignaturePng(raw);
    } catch (err) {
      log.warn(`signature image "${partial}" could not be cleaned (${(err as Error).message}); using it as-is`);
      clean = raw;
    }
    cleanCache.set(file, { key, bytes: clean });
    log.info(`signature image "${partial}" prepared for provider "${provider}"`);
    return clean;
  } catch (err) {
    log.warn(`could not read signature image "${partial}": ${(err as Error).message}`);
    return null;
  }
}
