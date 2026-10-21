// Builds the 4th quarterly review ("SL 4th Residential Quarterly
// 6.15.2026-8.31.2026.docx") from the 3rd quarterly, the same way the 3rd was
// built from the 2nd (scripts/build-quarterly-q3.py): header period + quarter
// box, status boxes, every "Status description" narrative, the five closing
// questions and the completion date. Table geometry, fonts, footers, the
// outcome definitions and their start/end dates are left untouched.
//
//   node scripts/build-quarterly-q4.mjs
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { CONTENT } from './quarterly-q4-content.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'SL 3rd Residential Quarterly 3.15.2026-6.14.2026.docx');
const OUT = path.join(ROOT, `SL 4th Residential Quarterly ${CONTENT.period.fileTag}.docx`);

const BOX = { on: '\u2612', off: '\u2610' };
const PARA_RE = /<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
const RUN_RE = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
const TEXTISH_RE = /<w:t(?: [^>]*)?>[^<]*<\/w:t>|<w:t\/>|<w:tab\/>|<w:br\/>/g;

const decode = (s) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const encode = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const textOf = (xml) =>
  decode(
    (xml.match(/<w:t(?: [^>]*)?>[^<]*<\/w:t>|<w:tab\/>/g) ?? [])
      .map((t) => (t === '<w:tab/>' ? '\t' : t.replace(/<[^>]+>/g, '')))
      .join(''),
  );
const paras = (xml) => xml.match(PARA_RE) ?? [];
const runs = (xml) => xml.match(RUN_RE) ?? [];

/** Replace a run's text content with a single <w:t>. */
function setRunText(run, text) {
  const stripped = run.replace(TEXTISH_RE, '');
  return stripped.replace(/<\/w:r>$/, `<w:t xml:space="preserve">${encode(text)}</w:t></w:r>`);
}

/** First run keeps its formatting and gets the text; the others are emptied. */
function setParaText(p, text) {
  const rs = runs(p);
  if (rs.length === 0) {
    const open = p.endsWith('/>') ? p.replace(/\/>$/, '>') + '</w:p>' : p;
    return open.replace(/<\/w:p>$/, `<w:r><w:t xml:space="preserve">${encode(text)}</w:t></w:r></w:p>`);
  }
  let i = 0;
  return p.replace(RUN_RE, (r) => (i++ === 0 ? setRunText(r, text) : r.replace(TEXTISH_RE, '')));
}

/** Copy of `template` paragraph carrying `text` (pPr + first run's rPr preserved). */
function cloneWithText(template, text) {
  return setParaText(template, text);
}

/** Flip the ☐/☒ glyphs of a paragraph in order; `states` = 'x' | 'o' per box. */
function flipBoxes(p, states) {
  let i = 0;
  const out = p.replace(RUN_RE, (r) =>
    r.replace(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g, (m, t) => {
      const flipped = t.replace(/[\u2610\u2612]/g, () => {
        if (i >= states.length) throw new Error(`more boxes than states in "${textOf(p).slice(0, 60)}"`);
        return states[i++] === 'x' ? BOX.on : BOX.off;
      });
      return m.replace(t, flipped);
    }),
  );
  if (i !== states.length) throw new Error(`expected ${states.length} boxes, found ${i}: "${textOf(p).slice(0, 60)}"`);
  return out;
}

/** Replace the paragraph list of a cell (keeps <w:tcPr>). */
function replaceCellParas(tc, newParas) {
  const first = tc.search(PARA_RE);
  const head = tc.slice(0, first);
  return head + newParas.join('') + '</w:tc>';
}

// ---------------------------------------------------------------------------
const zip = new AdmZip(await readFile(SRC));
let doc = zip.getEntry('word/document.xml').getData().toString('utf8');
const trs = doc.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) ?? [];
if (trs.length !== 27) throw new Error(`expected 27 table rows, found ${trs.length}`);

// Narrative paragraph used as the formatting template for every status text.
const templatePara = (() => {
  for (const tr of trs) {
    if (!/Steven wants to be an active member/.test(textOf(tr))) continue;
    const cell = (tr.match(/<w:tc[ >][\s\S]*?<\/w:tc>/g) ?? [])[1];
    const ps = paras(cell);
    const label = ps.findIndex((p) => /^Status description:/.test(textOf(p).trim()));
    return ps[label + 1];
  }
  throw new Error('template narrative paragraph not found');
})();

let rowsDone = 0;
let statusBoxes = 0;
const edited = new Map();

for (const tr of trs) {
  const cells = tr.match(/<w:tc[ >][\s\S]*?<\/w:tc>/g) ?? [];
  if (cells.length !== 3) continue;
  const firstText = textOf(cells[0]);
  const spec = CONTENT.rows.find((r) => r.match.test(firstText));
  if (!spec) continue;
  if (!/Status description/.test(textOf(cells[1]))) throw new Error(`row "${firstText.slice(0, 40)}" has no status cell`);

  // ---- status cell: boxes + narrative --------------------------------------
  const ps = paras(cells[1]);
  const out = [];
  let labelSeen = false;
  let narrativeWritten = false;
  for (const p of ps) {
    const t = textOf(p).trim();
    const opt = t.match(/^[\u2610\u2612]\s*(Achieved|On track|Limited or no progress)$/);
    if (opt) {
      out.push(flipBoxes(p, [opt[1] === spec.status ? 'x' : 'o']));
      statusBoxes++;
      continue;
    }
    if (!labelSeen && /^Status description:/.test(t)) {
      labelSeen = true;
      // Keep only the label in this paragraph (the Sepsis row carried its text here).
      let seenLabel = false;
      out.push(
        p.replace(RUN_RE, (r) => {
          if (seenLabel) return r.replace(TEXTISH_RE, '');
          if (/Status description:/.test(textOf(r))) seenLabel = true;
          return r;
        }),
      );
      continue;
    }
    if (labelSeen && !narrativeWritten) {
      out.push(cloneWithText(templatePara, spec.text));
      narrativeWritten = true;
      continue;
    }
    if (labelSeen) {
      out.push(p.replace(RUN_RE, (r) => r.replace(TEXTISH_RE, ''))); // trailing spacer paragraphs
      continue;
    }
    out.push(p);
  }
  if (!labelSeen) throw new Error(`no "Status description:" label in row "${firstText.slice(0, 40)}"`);
  if (!narrativeWritten) out.push(cloneWithText(templatePara, spec.text));
  const newStatusCell = replaceCellParas(cells[1], out);

  // ---- plan-change cell ----------------------------------------------------
  const pps = paras(cells[2]);
  const pout = [];
  let describeSeen = false;
  let describeWritten = false;
  for (const p of pps) {
    const t = textOf(p).trim();
    if (/^[\u2610\u2612]\s*Yes/.test(t)) { pout.push(flipBoxes(p, [spec.planChange ? 'x' : 'o'])); continue; }
    if (/^[\u2610\u2612]\s*No/.test(t)) { pout.push(flipBoxes(p, [spec.planChange ? 'o' : 'x'])); continue; }
    if (/^If yes, describe:/.test(t)) { describeSeen = true; pout.push(p); continue; }
    if (describeSeen && spec.planChange && !describeWritten) {
      pout.push(cloneWithText(templatePara, spec.planChange));
      describeWritten = true;
      continue;
    }
    pout.push(p);
  }
  if (spec.planChange && !describeWritten) pout.push(cloneWithText(templatePara, spec.planChange));
  const newPlanCell = replaceCellParas(cells[2], pout);

  edited.set(tr, tr.replace(cells[1], newStatusCell).replace(cells[2], newPlanCell));
  rowsDone++;
}
if (rowsDone !== 20) throw new Error(`edited ${rowsDone} outcome/support rows, expected 20`);
if (statusBoxes !== 60) throw new Error(`flipped ${statusBoxes} status boxes, expected 60`);

// ---- closing questions ------------------------------------------------------
let questionsDone = 0;
for (const tr of trs) {
  const cells = tr.match(/<w:tc[ >][\s\S]*?<\/w:tc>/g) ?? [];
  if (cells.length !== 4) continue;
  const q = CONTENT.questions.find((x) => x.match.test(textOf(cells[1])));
  if (!q) throw new Error(`unknown question row: "${textOf(cells[1]).slice(0, 50)}"`);
  const yn = paras(cells[2]).find((p) => /Yes/.test(textOf(p)) && /No/.test(textOf(p)));
  if (!yn) throw new Error(`yes/no paragraph missing for question ${q.match}`);
  const newYn = flipBoxes(yn, q.answer === 'Yes' ? ['x', 'o'] : ['o', 'x']);
  const dps = paras(cells[3]);
  const labelPara = dps.find((p) => textOf(p).trim().length > 0);
  // The cell text is "<label>: <last quarter's answer>"; keep only the label.
  const full = textOf(labelPara);
  const label = full.slice(0, full.indexOf(':') + 1);
  if (!label) throw new Error(`question label without colon: "${full.slice(0, 50)}"`);
  const newLabelPara = setParaText(labelPara, q.text ? `${label} ${q.text}` : label);
  // Only the answer paragraph stays in the cell: trailing empty paragraphs
  // spill onto the next page as an empty row fragment when the answer is long.
  const newAnswerCell = replaceCellParas(cells[3], [newLabelPara]);
  let newTr = tr.replace(cells[2], cells[2].replace(yn, newYn)).replace(cells[3], newAnswerCell);
  // Keep each question row on one page.
  newTr = /<w:trPr>/.test(newTr)
    ? newTr.replace('<w:trPr>', '<w:trPr><w:cantSplit/>')
    : newTr.replace(/^(<w:tr\b[^>]*>)((?:<w:tblPrEx>[\s\S]*?<\/w:tblPrEx>)?)/, '$1$2<w:trPr><w:cantSplit/></w:trPr>');
  edited.set(tr, newTr);
  questionsDone++;
}
if (questionsDone !== 5) throw new Error(`edited ${questionsDone} questions, expected 5`);

for (const [oldTr, newTr] of edited) doc = doc.replace(oldTr, newTr);

// ---- completion date ----------------------------------------------------------
{
  let n = 0;
  doc = doc.replace(PARA_RE, (p) => {
    if (!/^Completed by:/.test(textOf(p).trim())) return p;
    return p.replace(RUN_RE, (r) => {
      if (textOf(r) !== CONTENT.previous.completedDate) return r;
      n++;
      return setRunText(r, CONTENT.completedDate);
    });
  });
  if (n !== 1) throw new Error(`completion date replaced ${n} times`);
}
zip.updateFile('word/document.xml', Buffer.from(doc, 'utf8'));

// ---- header: quarter box + period -----------------------------------------------
{
  let fixed = 0;
  for (const e of zip.getEntries()) {
    if (!/^word\/header\d*\.xml$/.test(e.entryName)) continue;
    let xml = e.getData().toString('utf8');
    let changed = false;
    xml = xml.replace(PARA_RE, (p) => {
      if (!/quarterly review covers information/.test(textOf(p))) return p;
      let out = flipBoxes(p, CONTENT.period.quarterBoxes);
      let dates = 0;
      out = out.replace(RUN_RE, (r) => {
        const t = textOf(r);
        if (t === CONTENT.previous.periodStart) { dates++; return setRunText(r, CONTENT.period.start); }
        if (t === CONTENT.previous.periodEnd) { dates++; return setRunText(r, CONTENT.period.end); }
        return r;
      });
      if (dates !== 2) throw new Error(`header dates replaced ${dates} times`);
      changed = true;
      fixed++;
      return out;
    });
    if (changed) zip.updateFile(e.entryName, Buffer.from(xml, 'utf8'));
  }
  if (fixed !== 1) throw new Error(`header period paragraph fixed ${fixed} times`);
}

await writeFile(OUT, zip.toBuffer());
console.log(`Wrote ${OUT}`);
console.log(`rows: ${rowsDone}, status boxes: ${statusBoxes}, questions: ${questionsDone}, plan changes: ${CONTENT.rows.filter((r) => r.planChange).length}`);
