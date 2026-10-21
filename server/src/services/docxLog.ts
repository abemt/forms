import AdmZip from 'adm-zip';
import { createLogger } from '../logger.js';
import { decodeXml } from './docxTemplate.js';

const log = createLogger('docx-log');

/**
 * Reads a Word (.docx) shift log — e.g. the filled "Daily Log Entry"
 * workbook — straight from its XML and turns it into the line-oriented text
 * pages the shift extractor expects. No LibreOffice round-trip needed.
 *
 * Table rows are flattened so a label cell and its value cell form ONE line
 * ("Assigned Provider: Hanna Tafesse, DSP"); single-cell rows (the notes
 * box) keep one line per paragraph. Untouched boxes leave just their label
 * ("Observed Mood:"), which the extractor already treats as empty.
 */

type Block =
  | { kind: 'para'; text: string; pageBreakBefore: boolean; pageBreakAfter: boolean }
  | { kind: 'row'; cells: string[][] };

const TAG = /<(\/)?(w:tbl|w:tr|w:tc|w:p)(?=[\s>/])([^>]*)>/g;
const RUN = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:t\s*\/>|<w:(br|cr)(\s[^>]*)?\/>|<w:tab\s*\/>/g;

function paragraphOf(xml: string): Extract<Block, { kind: 'para' }> {
  const pPr = xml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? '';
  const pageBreakBefore =
    /<w:pageBreakBefore(?:\s[^>]*)?\/?>/.test(pPr) && !/<w:pageBreakBefore[^>]*w:val="(?:0|false)"/.test(pPr);
  let text = '';
  let pageBreakAfter = false;
  for (const m of xml.matchAll(RUN)) {
    if (m[0].startsWith('<w:t')) {
      if (m[1] !== undefined) text += decodeXml(m[1]);
      // `<w:t/>` and `<w:tab/>`: empty text / a tab
      else if (m[0].startsWith('<w:tab')) text += ' ';
    } else {
      if (/w:type="page"/.test(m[3] ?? '')) pageBreakAfter = true;
      text += '\n';
    }
  }
  return { kind: 'para', text, pageBreakBefore, pageBreakAfter };
}

/** Walk the document body into paragraphs and table rows, in order. */
export function docxBlocks(xml: string): Block[] {
  const blocks: Block[] = [];
  let tblDepth = 0;
  let pDepth = 0;
  let pStart = -1;
  let row: string[][] | null = null;
  let cell: string[] | null = null;

  const emitParagraph = (para: Extract<Block, { kind: 'para' }>): void => {
    if (cell) cell.push(para.text);
    else blocks.push(para);
  };

  for (const m of xml.matchAll(TAG)) {
    const closing = m[1] === '/';
    const name = m[2];
    const selfClosing = m[3].trimEnd().endsWith('/');
    switch (name) {
      case 'w:tbl':
        tblDepth += closing ? -1 : 1;
        break;
      case 'w:tr':
        if (tblDepth !== 1) break;
        if (closing) {
          if (row) blocks.push({ kind: 'row', cells: row });
          row = null;
        } else {
          row = [];
        }
        break;
      case 'w:tc':
        if (tblDepth !== 1) break;
        if (closing) {
          if (row && cell) row.push(cell);
          cell = null;
        } else {
          cell = [];
        }
        break;
      case 'w:p':
        if (selfClosing) {
          emitParagraph({ kind: 'para', text: '', pageBreakBefore: false, pageBreakAfter: false });
        } else if (!closing) {
          if (pDepth === 0) pStart = m.index ?? 0;
          pDepth++;
        } else {
          pDepth = Math.max(0, pDepth - 1);
          if (pDepth === 0 && pStart >= 0) {
            emitParagraph(paragraphOf(xml.slice(pStart, m.index)));
            pStart = -1;
          }
        }
        break;
    }
  }
  return blocks;
}

// Bullet glyphs pasted into the notes (Word's Symbol-font bullet, •, dashes…)
// are decoration, not text.
const LEADING_BULLET = /^[\uF0B7\u2022\u25AA\u25E6\u2023\u00B7\u2043\u2013\u2014*\-]+\s*/;
const clean = (s: string): string =>
  s.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim().replace(LEADING_BULLET, '').trim();

/** Text pages (one string per page, lines separated by \n) for a .docx log. */
export function docxLogPages(bytes: Uint8Array): string[] {
  let xml: string;
  try {
    const entry = new AdmZip(Buffer.from(bytes)).getEntry('word/document.xml');
    if (!entry) throw new Error('word/document.xml not found');
    xml = entry.getData().toString('utf8');
  } catch (err) {
    throw new Error(`The shift log is not a readable Word (.docx) document: ${(err as Error).message}`);
  }
  // Drop legacy fallbacks of drawings/text boxes so their text is not doubled.
  xml = xml.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, '');

  const pages: string[][] = [[]];
  const current = (): string[] => pages[pages.length - 1];
  const newPage = (): void => {
    if (current().length > 0) pages.push([]);
  };
  const pushLines = (text: string): void => {
    for (const line of text.split('\n')) {
      const t = clean(line);
      if (t) current().push(t);
    }
  };

  for (const block of docxBlocks(xml)) {
    if (block.kind === 'para') {
      if (block.pageBreakBefore) newPage();
      pushLines(block.text);
      if (block.pageBreakAfter) newPage();
      continue;
    }
    const cells = block.cells.map((paras) => paras.map(clean).filter(Boolean));
    if (cells.length <= 1) {
      for (const line of cells[0] ?? []) current().push(line);
    } else {
      const line = cells.map((c) => c.join(' ')).join(' ').trim();
      if (line) current().push(line);
    }
  }

  const result = pages.map((lines) => lines.join('\n')).filter((p) => p.length > 0);
  log.info(`read ${result.length} page(s) of text from Word shift log`);
  return result;
}
