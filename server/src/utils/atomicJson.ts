import { randomUUID } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';

export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), 'utf8');
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(temporary, file);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt >= 6 || (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY')) throw error;
        await setTimeout(20 * 2 ** attempt);
      }
    }
  } finally { await rm(temporary, { force: true }).catch(() => undefined); }
}