// Ad-hoc check: clean every signature PNG and write previews to %TEMP%.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { cleanSignaturePng } from '../server/dist/services/signatureImage.js';

const dir = path.resolve('server/data/signatures');
for (const f of await readdir(dir)) {
  if (!/\.(png|jpe?g)$/i.test(f)) continue;
  const raw = new Uint8Array(await readFile(path.join(dir, f)));
  const t0 = Date.now();
  const clean = cleanSignaturePng(raw);
  const w = (clean[16] << 24) | (clean[17] << 16) | (clean[18] << 8) | clean[19];
  const h = (clean[20] << 24) | (clean[21] << 16) | (clean[22] << 8) | clean[23];
  const out = path.join(os.tmpdir(), `sig-clean-${f.replace(/\.[^.]+$/, '')}.png`);
  await writeFile(out, clean);
  console.log(`${f}: ${raw.length}B -> ${clean.length}B, ${w}x${h}px, ${Date.now() - t0}ms -> ${out}`);
}
