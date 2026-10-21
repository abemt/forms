import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';

/**
 * Turns any staff signature image (PNG or JPEG — sniffed by content, since
 * phone exports are often JPEGs with a .png name) into a clean PNG stamp: ink
 * only, background transparent, tightly cropped around the signature.
 *
 * Handles both already-transparent PNGs (just trimmed) and phone photos of a
 * signature on paper — ruled lines, shadows and stray marks elsewhere on the
 * page are dropped by keeping only the densest band of dark ink.
 */

const MAX_OUTPUT_WIDTH = 900;

interface Raster {
  width: number;
  height: number;
  data: Buffer; // RGBA
}

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function decode(bytes: Uint8Array): Raster {
  let buf = Buffer.from(bytes);
  if (isJpeg(buf)) {
    const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 512 });
    return { width: img.width, height: img.height, data: Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength) };
  }
  // Phone exports often append metadata after IEND, which pngjs rejects.
  const iend = buf.indexOf(Buffer.from('IEND', 'ascii'));
  if (iend > 0 && iend + 8 < buf.length) buf = buf.subarray(0, iend + 8);
  const png = PNG.sync.read(buf);
  return { width: png.width, height: png.height, data: png.data };
}

function encode(r: Raster): Uint8Array {
  const png = new PNG({ width: r.width, height: r.height });
  r.data.copy(png.data);
  return new Uint8Array(PNG.sync.write(png));
}

function hasTransparency(r: Raster): boolean {
  const { data } = r;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
  return false;
}

function luminance(data: Buffer, i: number): number {
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
}

/**
 * Per-pixel ink opacity (0-255). Transparent PNGs use their own alpha (only
 * where the pixel is dark). Photos are judged against their LOCAL paper colour
 * (a wide box blur), so uneven lighting and shadows do not read as ink; the
 * darkest strokes define the ink colour, and everything else on the page must
 * match it — a blue-lined pad under black ink, or grey rules under blue ink,
 * drop out. Ruled lines are also their own neighbourhood along the row, so
 * they lose contrast there while strokes keep it. Faint pixels count only when
 * they connect to a solid stroke (hysteresis), which removes paper texture.
 */
function inkAlpha(r: Raster, useAlpha: boolean): Uint8Array {
  const { width, height, data } = r;
  const n = width * height;
  const out = new Uint8Array(n);
  if (useAlpha) {
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      const dark = Math.max(0, Math.min(1, (200 - luminance(data, i)) / 120));
      out[p] = Math.round(data[i + 3] * dark);
    }
    return out;
  }

  // Per-channel summed-area tables for fast local paper-colour means.
  const W = width + 1;
  const integral = [0, 1, 2].map(() => new Float64Array(W * (height + 1)));
  for (let y = 1; y <= height; y++) {
    const sums = [0, 0, 0];
    for (let x = 1; x <= width; x++) {
      const i = ((y - 1) * width + (x - 1)) * 4;
      for (let ch = 0; ch < 3; ch++) {
        sums[ch] += data[i + ch];
        integral[ch][y * W + x] = integral[ch][(y - 1) * W + x] + sums[ch];
      }
    }
  }
  const radius = Math.max(8, Math.round(Math.min(width, height) / 16));
  const boxMean = (t: Float64Array, x0: number, y0: number, x1: number, y1: number): number =>
    (t[y1 * W + x1] - t[y0 * W + x1] - t[y1 * W + x0] + t[y0 * W + x0]) / ((x1 - x0) * (y1 - y0));

  // How much darker than the surrounding paper each pixel is, per channel and
  // in luminance ("contrast").
  const dR = new Int16Array(n);
  const dG = new Int16Array(n);
  const dB = new Int16Array(n);
  const contrast = new Uint8Array(n);
  const hist = new Uint32Array(256);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width, x + radius + 1);
      const p = y * width + x;
      const i = p * 4;
      const r0 = boxMean(integral[0], x0, y0, x1, y1) - data[i];
      const g0 = boxMean(integral[1], x0, y0, x1, y1) - data[i + 1];
      const b0 = boxMean(integral[2], x0, y0, x1, y1) - data[i + 2];
      dR[p] = Math.round(r0);
      dG[p] = Math.round(g0);
      dB[p] = Math.round(b0);
      const c = Math.max(0, Math.min(255, Math.round(0.299 * r0 + 0.587 * g0 + 0.114 * b0)));
      contrast[p] = c;
      hist[c]++;
    }
  }
  const percentile = (q: number): number => {
    let acc = 0;
    const target = n * q;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= target) return v;
    }
    return 255;
  };
  const noise = percentile(0.85); // paper texture + JPEG noise
  const inkPeak = percentile(0.997); // darkest strokes
  if (inkPeak < noise + 12) return out; // nothing discernible

  // Ink colour: how the darkest strokes darken each channel per unit of
  // luminance. Any blend of that ink with paper darkens in the same ratio.
  let ur = 0, ug = 0, ub = 0;
  for (let p = 0; p < n; p++) {
    if (contrast[p] >= inkPeak) {
      ur += dR[p];
      ug += dG[p];
      ub += dB[p];
    }
  }
  const uLum = 0.299 * ur + 0.587 * ug + 0.114 * ub;
  ur /= uLum;
  ug /= uLum;
  ub /= uLum;
  const inkColoured = (p: number): boolean => {
    const c = contrast[p];
    const er = dR[p] - c * ur;
    const eg = dG[p] - c * ug;
    const eb = dB[p] - c * ub;
    return Math.sqrt(er * er + eg * eg + eb * eb) <= Math.max(12, 0.25 * c);
  };

  // Contrast against the same row only: a ruled line is its own neighbourhood
  // there, so it loses most of its contrast while pen strokes keep theirs.
  const R = Math.max(radius, Math.round(width / 8));
  const lineLike = new Uint8Array(n);
  const rowLum = new Float64Array(width + 1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rowLum[x + 1] = rowLum[x] + luminance(data, (y * width + x) * 4);
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (contrast[p] === 0) continue;
      const x0 = Math.max(0, x - R);
      const x1 = Math.min(width, x + R + 1);
      const hContrast = (rowLum[x1] - rowLum[x0]) / (x1 - x0) - luminance(data, p * 4);
      if (hContrast < contrast[p] * 0.5) lineLike[p] = 1;
    }
  }

  const WEAK = noise + (inkPeak - noise) * 0.2;
  const STRONG = noise + (inkPeak - noise) * 0.6;
  const state = new Uint8Array(n); // 0 paper, 1 faint candidate, 2 ink
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let p = 0; p < n; p++) {
    if (contrast[p] < WEAK || !inkColoured(p)) continue;
    if (contrast[p] >= STRONG) {
      state[p] = 2;
      queue[tail++] = p;
    } else {
      state[p] = 1;
    }
  }
  const neighbours = (p: number, visit: (q: number) => void): void => {
    const x = p % width;
    const y = (p - x) / width;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= width || (dx === 0 && dy === 0)) continue;
        visit(ny * width + nx);
      }
    }
  };
  // Ruled-line pixels drop out unless they hug a solid stroke (its soft edge).
  for (let p = 0; p < n; p++) {
    if (state[p] !== 1 || !lineLike[p]) continue;
    let nearStroke = false;
    neighbours(p, (q) => {
      if (state[q] === 2) nearStroke = true;
    });
    if (!nearStroke) state[p] = 0;
  }
  while (head < tail) {
    neighbours(queue[head++], (q) => {
      if (state[q] === 1) {
        state[q] = 2;
        queue[tail++] = q;
      }
    });
  }
  for (let p = 0; p < n; p++) {
    if (state[p] !== 2) continue;
    const t = Math.min(1, (contrast[p] - WEAK) / (STRONG - WEAK));
    out[p] = Math.round(255 * Math.sqrt(t));
  }
  return out;
}

/** Contiguous runs of `active` indices, bridging gaps up to `maxGap`. */
function runs(active: boolean[], maxGap: number): { start: number; end: number }[] {
  const result: { start: number; end: number }[] = [];
  let current: { start: number; end: number } | null = null;
  let gap = 0;
  for (let i = 0; i < active.length; i++) {
    if (active[i]) {
      if (current) current.end = i;
      else current = { start: i, end: i };
      gap = 0;
    } else if (current) {
      gap++;
      if (gap > maxGap) {
        result.push(current);
        current = null;
        gap = 0;
      }
    }
  }
  if (current) result.push(current);
  return result;
}

function sum(arr: ArrayLike<number>, from: number, to: number): number {
  let s = 0;
  for (let i = from; i <= to; i++) s += arr[i];
  return s;
}

/** Bounding box of the signature: densest horizontal ink band, then its columns. */
function signatureBox(alpha: Uint8Array, width: number, height: number): { x0: number; y0: number; x1: number; y1: number } | null {
  const rowInk = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    let s = 0;
    for (let x = 0, p = y * width; x < width; x++, p++) s += alpha[p];
    rowInk[y] = s / 255;
  }
  let maxRow = 0;
  for (const v of rowInk) if (v > maxRow) maxRow = v;
  if (maxRow < 2) return null;

  const rowActive = Array.from(rowInk, (v) => v >= Math.max(1.5, maxRow * 0.04));
  const bands = runs(rowActive, Math.max(2, Math.round(height * 0.02)));
  if (bands.length === 0) return null;
  const band = bands.reduce((best, b) => (sum(rowInk, b.start, b.end) > sum(rowInk, best.start, best.end) ? b : best));

  const colInk = new Float64Array(width);
  for (let y = band.start; y <= band.end; y++) {
    for (let x = 0, p = y * width; x < width; x++, p++) colInk[x] += alpha[p] / 255;
  }
  const colActive = Array.from(colInk, (v) => v >= 1);
  const spans = runs(colActive, Math.max(3, Math.round(width * 0.06)));
  if (spans.length === 0) return null;
  const total = sum(colInk, 0, width - 1);
  // Drop stray specks: keep spans holding at least 3% of the band's ink.
  const kept = spans.filter((s) => sum(colInk, s.start, s.end) >= total * 0.03);
  const use = kept.length > 0 ? kept : spans;
  const x0 = Math.min(...use.map((s) => s.start));
  const x1 = Math.max(...use.map((s) => s.end));

  // Re-fit rows to the kept columns so an unrelated mark in the band can't
  // pad it; a row needs more than a speck of ink to count.
  const rowInkIn = (y: number): number => {
    let ink = 0;
    for (let x = x0, p = y * width + x0; x <= x1; x++, p++) ink += alpha[p];
    return ink / 255;
  };
  let y0 = band.end;
  let y1 = band.start;
  for (let y = band.start; y <= band.end; y++) {
    if (rowInkIn(y) >= 1.5) {
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (y1 < y0) return null;
  // Follow thin stroke tips (tall loop apexes) that continue past the dense rows.
  while (y0 > 0 && rowInkIn(y0 - 1) >= 0.5) y0--;
  while (y1 < height - 1 && rowInkIn(y1 + 1) >= 0.5) y1++;
  return { x0, y0, x1, y1 };
}

function crop(r: Raster, alpha: Uint8Array, box: { x0: number; y0: number; x1: number; y1: number }, margin: number): Raster {
  const x0 = Math.max(0, box.x0 - margin);
  const y0 = Math.max(0, box.y0 - margin);
  const x1 = Math.min(r.width - 1, box.x1 + margin);
  const y1 = Math.min(r.height - 1, box.y1 + margin);
  const width = x1 - x0 + 1;
  const height = y1 - y0 + 1;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = ((y0 + y) * r.width + (x0 + x)) * 4;
      const dst = (y * width + x) * 4;
      data[dst] = r.data[src];
      data[dst + 1] = r.data[src + 1];
      data[dst + 2] = r.data[src + 2];
      data[dst + 3] = alpha[(y0 + y) * r.width + (x0 + x)];
    }
  }
  return { width, height, data };
}

/** Box-filter downscale by an integer factor (keeps stamps small in the PDFs). */
function downscale(r: Raster, factor: number): Raster {
  if (factor <= 1) return r;
  const width = Math.floor(r.width / factor);
  const height = Math.floor(r.height / factor);
  const data = Buffer.alloc(width * height * 4);
  const n = factor * factor;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let rs = 0, gs = 0, bs = 0, as = 0;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const i = ((y * factor + dy) * r.width + (x * factor + dx)) * 4;
          const a = r.data[i + 3];
          // Alpha-weighted colour so transparent pixels don't wash the ink out.
          rs += r.data[i] * a;
          gs += r.data[i + 1] * a;
          bs += r.data[i + 2] * a;
          as += a;
        }
      }
      const o = (y * width + x) * 4;
      data[o] = as ? Math.round(rs / as) : 0;
      data[o + 1] = as ? Math.round(gs / as) : 0;
      data[o + 2] = as ? Math.round(bs / as) : 0;
      data[o + 3] = Math.round(as / n);
    }
  }
  return { width, height, data };
}

export function cleanSignaturePng(bytes: Uint8Array): Uint8Array {
  const raster = decode(bytes);
  const useAlpha = hasTransparency(raster);
  const alpha = inkAlpha(raster, useAlpha);
  const box = signatureBox(alpha, raster.width, raster.height);
  // JPEGs must still be re-encoded: the PDF/DOCX writers only embed PNG.
  if (!box) return isJpeg(bytes) ? encode(raster) : bytes;
  const margin = Math.max(2, Math.round((box.y1 - box.y0) * 0.08));
  let out = crop(raster, alpha, box, margin);
  // Solid black ink for every stamp, whatever pen the photo was taken of.
  for (let i = 0; i < out.data.length; i += 4) {
    if (out.data[i + 3] > 0) {
      out.data[i] = 0;
      out.data[i + 1] = 0;
      out.data[i + 2] = 0;
    }
  }
  const factor = Math.ceil(out.width / MAX_OUTPUT_WIDTH);
  out = downscale(out, factor);
  return encode(out);
}
