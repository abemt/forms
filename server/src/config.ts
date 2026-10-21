import 'dotenv/config';
import path from 'node:path';

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const config = {
  port: int('PORT', 8787),
  dataDir: path.resolve(process.cwd(), process.env.DATA_DIR ?? './data'),
  maxUploadMb: int('MAX_UPLOAD_MB', 50),
  pdfConcurrency: Math.max(1, int('PDF_CONCURRENCY', 6)),
  jobTtlHours: int('JOB_TTL_HOURS', 0),
  webDist: path.resolve(process.cwd(), process.env.WEB_DIST ?? '../web/dist'),
  /**
   * Processing engine:
   *  - "local": built-in rule engine, no AI, zero cost (never calls out).
   *  - "ai":    OpenAI-compatible provider (requires AI_API_KEY).
   *  - "auto":  "ai" when a provider is configured, otherwise "local".
   */
  engine: (['local', 'ai', 'auto'].includes(process.env.ENGINE ?? '')
    ? process.env.ENGINE
    : 'auto') as 'local' | 'ai' | 'auto',
  /**
   * Optional boxed "Shift Narrative (Progress Notes)" area carrying the
   * staff's own notes. OFF by default: auditors check forms against the
   * agency's blank template, which has no such section. NARRATIVE_SECTION=on
   * adds it to both the PDF and the Word output.
   */
  narrativeSection: process.env.NARRATIVE_SECTION === 'on',
  /**
   * Complete shift boxes staff left completely blank: as out-of-facility
   * forms when the surrounding notes show the individual was away, otherwise
   * as routine shifts from the completion policy. FILL_BLANK_SHIFTS=off skips
   * them (they are still listed in the job warnings).
   */
  fillBlankShifts: process.env.FILL_BLANK_SHIFTS !== 'off',
  ai: {
    apiKey: process.env.AI_API_KEY ?? '',
    baseUrl: (process.env.AI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, ''),
    model: process.env.AI_MODEL ?? 'gpt-4o-mini',
    concurrency: Math.max(1, int('AI_CONCURRENCY', 4)),
    maxRetries: int('AI_MAX_RETRIES', 3),
    timeoutMs: Math.max(10_000, int('AI_TIMEOUT_MS', 120_000)),
  },
} as const;

/** True when an AI provider is usable (key set, or keyless local endpoint). */
export function aiAvailable(): boolean {
  return Boolean(config.ai.apiKey) || /localhost|127\.0\.0\.1/.test(config.ai.baseUrl);
}

/** The engine that will actually be used for processing. */
export function resolveEngine(): 'local' | 'ai' {
  if (config.engine === 'local') return 'local';
  if (config.engine === 'ai') return 'ai';
  return aiAvailable() ? 'ai' : 'local';
}

export type AppConfig = typeof config;
