import { createLogger } from '../logger.js';

const log = createLogger('pdf-text');

type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let pdfjsPromise: Promise<PdfJsModule> | undefined;

/** Lazily import pdf.js so the polyfill module always loads first. */
function pdfjs(): Promise<PdfJsModule> {
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

/** A single positioned text item (PDF user space, y = baseline). */
export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PdfTextPage {
  width: number;
  height: number;
  items: PdfTextItem[];
}

/**
 * Extract every text item of every page with its position. Used to anchor
 * AcroForm widgets onto an exact rendered layout.
 */
export async function extractPdfTextItems(bytes: Uint8Array): Promise<PdfTextPage[]> {
  const { getDocument, VerbosityLevel } = await pdfjs();
  const task = getDocument({
    data: bytes.slice(), // pdf.js detaches the buffer it receives
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: VerbosityLevel.ERRORS,
  });
  const doc = await task.promise;
  try {
    const pages: PdfTextPage[] = [];
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
      const page = await doc.getPage(pageNo);
      const content = await page.getTextContent();
      const items: PdfTextItem[] = [];
      for (const raw of content.items) {
        const item = raw as {
          str?: string;
          transform?: number[];
          width?: number;
          height?: number;
        };
        if (!item.str || !item.transform) continue;
        items.push({
          str: item.str,
          x: item.transform[4],
          y: item.transform[5],
          w: item.width ?? 0,
          h: item.height ?? 0,
        });
      }
      const view = (page as unknown as { view: number[] }).view;
      pages.push({ width: view[2] - view[0], height: view[3] - view[1], items });
    }
    return pages;
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}

/**
 * Extract the text of every page of a PDF, preserving line breaks.
 * Returns one string per page.
 */
export async function extractPdfPages(bytes: Uint8Array): Promise<string[]> {
  const { getDocument, VerbosityLevel } = await pdfjs();
  const task = getDocument({
    data: bytes.slice(), // pdf.js detaches the buffer it receives
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: VerbosityLevel.ERRORS,
  });
  const doc = await task.promise;
  try {
    const pages: string[] = [];
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
      const page = await doc.getPage(pageNo);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        text += item.str;
        if (item.hasEOL) text += '\n';
      }
      pages.push(text.trim());
    }
    log.info(`extracted text from ${pages.length} page(s)`);
    return pages;
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}
