import fs from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from '../utils/text.js';
import { createLogger } from '../logger.js';

const log = createLogger('cache');

/**
 * Content-addressed JSON cache on disk. Used to avoid duplicate AI calls:
 * extraction results are keyed by the log PDF hash + model, mapping results by
 * template hash + shift hash + model. Re-processing the same report is free.
 */
export class DiskCache {
  constructor(private readonly dir: string) {}

  private fileFor(key: string): string {
    return path.join(this.dir, `${sha256(key)}.json`);
  }

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const raw = await fs.readFile(this.fileFor(key), 'utf8');
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    try {
      await fs.mkdir(this.dir, { recursive: true });
      const file = this.fileFor(key);
      const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
      await fs.writeFile(tmp, JSON.stringify(value), 'utf8');
      await fs.rename(tmp, file);
    } catch (err) {
      log.warn(`cache write failed: ${(err as Error).message}`);
    }
  }
}
