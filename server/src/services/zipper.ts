import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';

/**
 * Zip a directory (recursively, preserving structure) into `outPath`.
 * The archive contains the directory's CONTENTS at the root, e.g.
 *   Editable/Form001.pdf
 *   Printable/Form001.pdf
 */
export async function zipDirectory(sourceDir: string, outPath: string, layout: 'preserve' | 'print' = 'preserve'): Promise<void> {
  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
    archive.on('warning', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false, (entry) => {
      if (layout === 'print' && entry.name.startsWith('Printable/')) {
        const folder = entry.name.endsWith('.docx') ? 'Word' : entry.name.endsWith('.pdf') ? 'PDF' : 'Printable';
        return { ...entry, name: entry.name.replace(/^Printable/, folder) };
      }
      return entry;
    });
    void archive.finalize().catch(reject);
  });
}
