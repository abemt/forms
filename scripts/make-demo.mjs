// Portfolio demo made from FICTIONAL data only: a Daily Progress Note template for a
// made-up individual (built from the bundled layout with every identifying line
// replaced), a 3-day staff workbook, fake staff signatures, and the forms the app
// generates from them - packaged, audited for client data, and previewed.
//   node scripts/make-demo.mjs inputs
//   node scripts/make-demo.mjs run [--api http://localhost:8797] [--data demo/data]
//   node scripts/make-demo.mjs preview
// `run` needs a SEPARATE server whose DATA_DIR is --data, never the client's server/data:
//   cd server; $env:DATA_DIR='..\demo\data'; $env:PORT='8797'; $env:ENGINE='local'; node dist/index.js
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { Packer } from 'docx';
import { PDFDocument, PDFRef } from 'pdf-lib';
import { buildDocument } from './build-entry-workbook.mjs';
import { mergeDocxFiles } from './merge-docx-forms.mjs';
import { docxParagraphs, parseForm680Spec } from '../server/dist/services/docxTemplate.js';
import { extractPdfPages } from '../server/dist/services/pdfText.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEMO = path.join(ROOT, 'demo');
const SOURCE_TEMPLATE = path.join(ROOT, 'server', 'assets', 'form680-default.docx');
const TEMPLATE = path.join(DEMO, 'Demo_Daily_Progress_Note_Template.docx');
const WORKBOOK = path.join(DEMO, 'Demo_Daily_Log_Entry_March2026.docx');
const SIGNATURES = path.join(DEMO, 'signatures');
const OUTPUT = path.join(DEMO, 'output');
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const AGENCY = 'Sunrise Community Living (Demo)';
const STAFF = {
  weekdayDay: { name: 'Maria Lopez', font: 'Freestyle Script' },
  weekdayEvening: { name: 'David Kim', font: 'Brush Script MT' },
  night: { name: 'Grace Okafor', font: 'Lucida Handwriting' },
  weekend: { name: 'Sam Carter', font: 'Segoe Script' },
};

// Anything from the client's real records. The audit fails if any output contains one.
const FORBIDDEN = [
  /\bsteven?\b/i, /lavin/i, /45198/, /jerrell/i, /\bwright\b/i, /\b9566\b/, /\bhanna\b/i, /rahel/i, /tafesse/i,
  /nathan(?:a|ie)el/i, /yohannes/i, /abdela/i, /kierra/i, /crump/i, /beziye/i, /joy group/i, /garden ridge/i,
  /chesterfield/i, /23832/, /467-8366/, /\(804\)/, /sl community/i, /inner vision/i, /yorktown/i, /diabet/i,
  /epilep/i, /seizure/i, /glucometer/i, /cholesterol/i, /hypertension/i, /\bgout\b/i, /insulin/i, /metformin/i,
  /tadele/i,
];

// Template edits, matched against each paragraph's ORIGINAL text (whitespace collapsed).
// A string rewrites the paragraph, null deletes it, 'ROW' deletes its table row and the
// TYPE OF SUPPORTS row below it. Every rule must match once, so layout drift fails loudly.
const TEMPLATE_RULES = [
  [/^Joy Group Home, INC\.$/, AGENCY],
  [/^5801 Garden Ridge Rd\b/, '123 Example Avenue, Springfield'],
  [/^\(804\) 467-8366$/, 'Fictional sample - no real person, staff member or provider'],
  [/^Form § ?680$/, 'Sample form'],
  [/^Name:\s/, 'Name:  Jordan Rivera'],
  [/^ID:\s/, 'ID: 10101 '],
  [/^Outcome 2:/, 'Outcome 2: Jordan wants to be an active member of his community and enjoy recreational activities such as walks, the library and local events. (Weekly)'],
  [/^Activity Statement: Steve goes out\b/, 'Activity Statement: Jordan goes out into the community weekly.'],
  [/^Outcome 4:/, 'Outcome 4: Jordan will become more independent with cooking and meal planning. (Daily)'],
  [/^Skill Building:/, 'Skill Building: Jordan learns to use kitchen appliances safely and to prepare simple, balanced meals.'],
  [/^Activity Statement: Steve improves\b/, 'Activity Statement: Jordan practises his cooking skills and helps prepare a meal every day.'],
  [/^Identified Risk 1:/, 'Identified Risk 1: Choking (Daily)'],
  [/^Identified Risk 2:/, 'Identified Risk 2: Dehydration (Daily)'],
  [/^Potential Risk 1:/, 'Potential Risk 1: Fall with Injury (Routine as needed)'],
  [/^- Has diagnosis of diabetes or congestive\b/, '- Has had a fall in the past'],
  [/^Potential Risk 2:/, 'Potential Risk 2: Pressure Injury (Routine as needed)'],
  [/^- Has a diagnosis of any neurologic disorder\b/, '- Sits for long periods during the day'],
  [/^etc\.\)$/, null],
  [/^- Has experienced impaired consciousness\b/, null],
  [/^Potential Risk 3:/, 'Potential Risk 3: Bowel Obstruction (Routine as needed)'],
  [/^- Has experienced a fall or fall with injury\b/, '- Takes a medication that can cause constipation'],
  [/^- Has been diagnosed with a seizure disorder\b/, null],
  [/^- Takes more than 4 medications\b/, null],
  [/^- Experiences fatigue and weakness\b/, null],
  [/^Potential Risk 4:/, 'Potential Risk 4: Sepsis (Routine as needed)'],
  [/^- Has diagnosis of any neurological disorder\b/, '- Has had repeated chest infections'],
  [/^- Is prescribed psychiatric\b/, null],
  [/^Potential Risk 5:/, 'ROW'],
  [/^Routine Support 1:/, 'Routine Support 1: Adaptive equipment/DME (Inhaler spacer) (Daily)'],
  [/^Routine Support 11:/, 'Routine Support 11: medical #1— his providers support Jordan with asthma and seasonal allergies. Staff will remind Jordan to use his inhaler as prescribed. Staff will follow any related protocols. (Daily)'],
];

const MONTH = { name: 'March', year: 2026, days: 7, firstDay: 5 };
const THU = 'March 05, 2026 (Thursday)';
const FRI = 'March 06, 2026 (Friday)';
const SAT = 'March 07, 2026 (Saturday)';

// Staff-style notes, one activity per line. Wording follows the mapper cues recorded in
// memory.md (e.g. "took X out", "together with his housemate", "played his guitar").
const FILL = {
  [THU]: {
    day: {
      mood: 'Happy, Friendly',
      notes: [
        'Jordan got up at 7:30 AM and took a shower with verbal reminders.',
        'He helped make oatmeal and toast for breakfast in the kitchen.',
        'Morning medications were given at 8:00 AM as prescribed, including his inhaler with the spacer.',
        'Staff drove Jordan to his day program at 9:00 AM.',
        'He came home at 2:30 PM.',
        'He relaxed in his room with his music.',
        'Staff offered water and juice throughout the shift.',
      ].join('\n'),
    },
    evening: {
      mood: 'Content, Calm',
      notes: [
        'Jordan helped cook spaghetti for dinner and set the table.',
        'He did his laundry and folded his clothes with one reminder.',
        'Evening medications were given at 8:00 PM as prescribed.',
        'He relaxed and watched TV in the living room.',
        'He played a board game together with his housemate Chris.',
        'Staff offered fluids during the evening.',
        'Jordan got ready for bed at 10:00 PM and was asleep by 10:30 PM.',
      ].join('\n'),
    },
    night: {
      mood: 'Calm',
      notes: [
        'Jordan slept through the night.',
        'Staff completed bed checks every hour and his breathing was quiet and even.',
        'He woke at 6:45 AM and rested in bed until the end of the shift.',
      ].join('\n'),
    },
  },
  [FRI]: {
    day: {
      mood: 'Excited, Outgoing',
      notes: [
        'Jordan showered and got dressed with reminders.',
        'He ate cereal and a banana for breakfast.',
        'Morning medications were given at 8:00 AM as prescribed.',
        'He relaxed in his room with his music until 10:00 AM.',
        'Staff took Jordan out to the public library and he picked out two books.',
        'Staff drove him home for lunch and he made a turkey sandwich.',
        'Staff offered water throughout the shift.',
      ].join('\n'),
    },
    evening: {
      mood: 'Happy',
      notes: [
        'Jordan helped make tacos for dinner in the kitchen.',
        'Evening medications were given at 8:00 PM as prescribed.',
        'He spent some quiet time drawing in his sketchbook.',
        'He played cards together with his housemate Chris.',
        'He wiped the kitchen table and took out the trash.',
        'Staff offered fluids during the evening.',
      ].join('\n'),
    },
    night: {
      mood: 'Calm',
      notes: [
        'Jordan was asleep for most of the shift.',
        'Staff completed hourly bed checks.',
        'He woke at 3:00 AM for a drink of water and went back to sleep.',
      ].join('\n'),
    },
  },
  [SAT]: {
    day: {
      mood: 'Excited, Friendly',
      notes: [
        'Jordan got up at 9:00 AM and relaxed on the couch watching TV.',
        'He made pancakes for breakfast with staff prompts.',
        'Morning medications were given at 9:00 AM as prescribed.',
        'Staff took Jordan out grocery shopping at the supermarket and he picked out fruit and snacks for the week.',
        'He paid at the register with his own money and counted his change.',
        'Staff drove him home and he helped put the groceries away.',
        'Staff offered water throughout the day.',
      ].join('\n'),
    },
    evening: {
      mood: 'Content, Calm',
      notes: [
        'Jordan went for a walk around the neighborhood park with staff.',
        'He helped cook chicken and rice for dinner.',
        'Evening medications were given at 8:00 PM as prescribed.',
        'He played his guitar in the living room before bed.',
        'Staff offered fluids during the evening.',
      ].join('\n'),
    },
    night: {
      mood: 'Calm',
      notes: [
        'Jordan slept well through the night.',
        'Staff completed bed checks every hour.',
        'He was still asleep at the end of the shift.',
      ].join('\n'),
    },
  },
};

const dsp = (name) => `${name}, DSP`;
const PROVIDERS = {
  [THU]: { day: dsp(STAFF.weekdayDay.name), evening: dsp(STAFF.weekdayEvening.name), night: dsp(STAFF.night.name) },
  [FRI]: { day: dsp(STAFF.weekdayDay.name), evening: dsp(STAFF.weekdayEvening.name), night: dsp(STAFF.night.name) },
  [SAT]: { day: dsp(STAFF.weekend.name), evening: dsp(STAFF.weekend.name), night: dsp(STAFF.night.name) },
};

const INDIVIDUAL = {
  key: 'demo',
  filePrefix: 'Jordan',
  first: 'Jordan',
  agency: AGENCY,
  header: 'Individual Supported: Jordan Rivera | ID Number: 10101',
  info: 'Day program: Riverside Day Center, Monday to Thursday 9:00 AM - 2:30 PM. Every name and note in this workbook is fictional.',
  keywords:
    'meals and cooking, medications given (with times), fluids/water offered, personal hygiene, laundry/housekeeping chores, community outings (walk, store, park, library), shopping and money, transportation, day program, and overnight bed checks',
  roster: {
    weekdayDay: STAFF.weekdayDay.name,
    weekdayEvening: STAFF.weekdayEvening.name,
    weekdayNight: STAFF.night.name,
    weekendDay: STAFF.weekend.name,
    weekendEvening: STAFF.weekend.name,
    weekendNight: STAFF.night.name,
  },
};

// ---------------------------------------------------------------------------
// inputs: template, workbook, signatures
// ---------------------------------------------------------------------------
const collapse = (s) => s.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const wEls = (node, name) => Array.from(node.getElementsByTagNameNS(W, name));

function ancestor(node, localName) {
  let n = node.parentNode;
  while (n && !(n.namespaceURI === W && n.localName === localName)) n = n.parentNode;
  return n;
}

function nextElement(node) {
  let n = node.nextSibling;
  while (n && n.nodeType !== 1) n = n.nextSibling;
  return n;
}

function attached(node, doc) {
  let n = node;
  while (n && n !== doc) n = n.parentNode;
  return n === doc;
}

/** Rewrite a paragraph's text touching only the runs that change, so the rest keeps its formatting. */
function setParagraphText(tNodes, next) {
  const old = tNodes.map((t) => t.textContent).join('');
  let a = 0;
  while (a < old.length && a < next.length && old[a] === next[a]) a += 1;
  let b = 0;
  while (b < old.length - a && b < next.length - a && old[old.length - 1 - b] === next[next.length - 1 - b]) b += 1;
  const from = a;
  const to = old.length - b;
  const insert = next.slice(a, next.length - b);
  let pos = 0;
  let done = false;
  for (const t of tNodes) {
    const s = t.textContent;
    const start = pos;
    const end = pos + s.length;
    pos = end;
    const touches = from === to ? !done && from >= start && from <= end : start < to && end > from;
    if (!touches) continue;
    const cutFrom = Math.max(from, start) - start;
    const cutTo = Math.max(cutFrom, Math.min(to, end) - start);
    t.textContent = s.slice(0, cutFrom) + (done ? '' : insert) + s.slice(cutTo);
    t.setAttribute('xml:space', 'preserve');
    done = true;
  }
}

async function buildTemplate() {
  const zip = new AdmZip(SOURCE_TEMPLATE);
  const doc = new DOMParser().parseFromString(zip.readAsText('word/document.xml'), 'text/xml');
  const used = new Set();
  for (const p of wEls(doc, 'p')) {
    if (!attached(p, doc)) continue;
    const tNodes = wEls(p, 't');
    const text = collapse(tNodes.map((t) => t.textContent).join(''));
    const index = TEMPLATE_RULES.findIndex(([re]) => re.test(text));
    if (index < 0) continue;
    used.add(index);
    const replacement = TEMPLATE_RULES[index][1];
    if (replacement === 'ROW') {
      const row = ancestor(p, 'tr');
      const typeRow = nextElement(row);
      if (!typeRow || typeRow.localName !== 'tr' || !/TYPE\s+OF\s+SUPPORTS/i.test(typeRow.textContent)) {
        throw new Error(`row after "${text.slice(0, 40)}" is not its TYPE OF SUPPORTS row`);
      }
      row.parentNode.removeChild(typeRow);
      row.parentNode.removeChild(row);
    } else if (replacement === null) {
      p.parentNode.removeChild(p);
    } else {
      setParagraphText(tNodes, replacement);
    }
  }
  const unused = TEMPLATE_RULES.filter((_, i) => !used.has(i)).map(([re]) => re.source);
  if (unused.length) throw new Error(`template rules matched nothing (layout changed?): ${unused.join(' | ')}`);

  let xml = new XMLSerializer().serializeToString(doc);
  if (!xml.startsWith('<?xml')) xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n${xml}`;
  zip.updateFile('word/document.xml', Buffer.from(xml, 'utf8'));
  const core = zip
    .readAsText('docProps/core.xml')
    .replace(/<dc:creator>[^<]*<\/dc:creator>/, '<dc:creator>Demo</dc:creator>')
    .replace(/<cp:lastModifiedBy>[^<]*<\/cp:lastModifiedBy>/, '<cp:lastModifiedBy>Demo</cp:lastModifiedBy>');
  zip.updateFile('docProps/core.xml', Buffer.from(core, 'utf8'));
  await mkdir(DEMO, { recursive: true });
  zip.writeZip(TEMPLATE);

  const spec = parseForm680Spec(docxParagraphs(new Uint8Array(await readFile(TEMPLATE))));
  if (spec.individualName !== 'Jordan Rivera' || spec.individualId !== '10101') {
    throw new Error(`template identity parsed as "${spec.individualName}" / "${spec.individualId}"`);
  }
  console.log(`template: ${path.relative(ROOT, TEMPLATE)} - ${spec.sections.length} sections, ${spec.moods.length} moods, ${spec.yesNoQuestions.length} questions`);
  for (const s of spec.sections) console.log(`  ${s.id}`);
}

async function buildWorkbook() {
  const bytes = await Packer.toBuffer(buildDocument(MONTH, FILL, PROVIDERS, INDIVIDUAL));
  await writeFile(WORKBOOK, bytes);
  console.log(`workbook: ${path.relative(ROOT, WORKBOOK)} (${Object.keys(FILL).length} days, 9 shift boxes)`);
}

function buildSignatures() {
  const script = path.join(ROOT, 'scripts', 'make-signature.ps1');
  for (const { name, font } of Object.values(STAFF)) {
    const out = path.join(SIGNATURES, `${name}.png`);
    const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Name', name, '-Out', out, '-Font', font], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`signature for ${name} failed: ${r.stderr || r.stdout}`);
  }
  console.log(`signatures: ${Object.values(STAFF).map((s) => s.name).join(', ')} -> ${path.relative(ROOT, SIGNATURES)}`);
}

// ---------------------------------------------------------------------------
// run: isolated server job -> packaged forms -> audit
// ---------------------------------------------------------------------------
async function api(base, route, init) {
  const res = await fetch(`${base}/api/jobs${route}`, init);
  const body = await res.json();
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${route} failed: ${JSON.stringify(body)}`);
  return body;
}

function isoDate(text) {
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return text.replace(/[^\w-]+/g, '');
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function copyPdf(from, to) {
  const pdf = await PDFDocument.load(await readFile(from), { updateMetadata: false });
  pdf.setTitle('Daily Progress Note - fictional demo');
  pdf.setAuthor('Demo');
  pdf.setSubject('Sample output with fictional data');
  pdf.setKeywords(['demo']);
  await writeFile(to, await pdf.save());
}

async function run(base, dataDir) {
  if (/:8787(?:\/|$)/.test(base)) throw new Error('refusing to use port 8787 (the client server); start a separate demo server');
  await api(base, '').catch((err) => {
    throw new Error(`no demo server at ${base} (${err.message}); start one with DATA_DIR=${dataDir}`);
  });
  await mkdir(path.join(dataDir, 'signatures'), { recursive: true });
  for (const f of await readdir(SIGNATURES)) await copyFile(path.join(SIGNATURES, f), path.join(dataDir, 'signatures', f));

  const form = new FormData();
  form.append('log', new Blob([await readFile(WORKBOOK)], { type: DOCX_MIME }), path.basename(WORKBOOK));
  form.append('template', new Blob([await readFile(TEMPLATE)], { type: DOCX_MIME }), path.basename(TEMPLATE));
  form.append('autoGenerate', 'true');
  form.append('completeRoutineFields', 'true');
  const created = await api(base, '', { method: 'POST', body: form });
  const outDir = path.join(dataDir, 'jobs', created.id, 'output');
  if (!existsSync(path.join(dataDir, 'jobs', created.id))) {
    throw new Error(`job ${created.id} is not in ${dataDir} - the server at ${base} uses a different DATA_DIR`);
  }
  await api(base, `/${created.id}/extract`, { method: 'POST' });

  let job;
  let generated = false;
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    job = await api(base, `/${created.id}`);
    process.stdout.write(`\r${job.status}: ${job.stage}                              `);
    if (job.status === 'review' && !generated) {
      generated = true;
      await api(base, `/${created.id}/generate`, { method: 'POST' });
      continue;
    }
    if (job.status === 'done' || job.status === 'failed') break;
  }
  console.log();
  if (job.status !== 'done') throw new Error(`job failed: ${JSON.stringify(job.errors)}`);

  await rm(OUTPUT, { recursive: true, force: true });
  const dirs = { pdf: path.join(OUTPUT, 'PDF'), word: path.join(OUTPUT, 'Word'), fillable: path.join(OUTPUT, 'Fillable PDF') };
  for (const d of Object.values(dirs)) await mkdir(d, { recursive: true });
  const words = [];
  for (const s of job.shifts) {
    const n = String(s.index + 1).padStart(3, '0');
    const stem = `Demo_Form${n}_${isoDate(s.date)}_${s.shift.replace(/\s+/g, '')}`;
    await copyPdf(path.join(outDir, 'Printable', `Form${n}.pdf`), path.join(dirs.pdf, `${stem}.pdf`));
    await copyPdf(path.join(outDir, 'Editable', `Form${n}.pdf`), path.join(dirs.fillable, `${stem}.pdf`));
    await copyFile(path.join(outDir, 'Printable', `Form${n}.docx`), path.join(dirs.word, `${stem}.docx`));
    words.push(path.join(dirs.word, `${stem}.docx`));
    console.log(`  Form${n} ${s.date} ${s.shift.padEnd(9)} ${s.provider.padEnd(20)} warnings: ${s.warnings.length}`);
  }
  const merged = path.join(OUTPUT, 'Demo_All_Forms_March_5-7_2026.docx');
  const r = mergeDocxFiles(words, merged);
  console.log(`merged Word: ${path.relative(ROOT, merged)} (${r.forms} forms, ${r.sections} sections)`);
  if (job.warnings.length) console.log('job warnings:', job.warnings);

  const failed = await audit();
  if (failed) process.exit(1);
}

// ---------------------------------------------------------------------------
// audit: no client data anywhere, PDFs print-safe
// ---------------------------------------------------------------------------
async function listFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full)));
    else if (/\.(docx|pdf)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

async function textOf(file) {
  if (/\.docx$/i.test(file)) {
    const xml = new AdmZip(file)
      .getEntries()
      .filter((e) => /\.(xml|rels)$/.test(e.entryName))
      .map((e) => e.getData().toString('utf8'))
      .join('\n');
    return { text: `${xml}\n${xml.replace(/<[^>]+>/g, '')}`, dangling: 0 };
  }
  const bytes = new Uint8Array(await readFile(file));
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const meta = [pdf.getTitle(), pdf.getAuthor(), pdf.getSubject(), pdf.getKeywords(), pdf.getCreator(), pdf.getProducer()];
  const values = pdf
    .getForm()
    .getFields()
    .map((f) => {
      if (typeof f.getText === 'function') return f.getText() ?? '';
      if (typeof f.getSelected === 'function') return [f.getSelected()].flat().join(' ');
      return '';
    });
  let dangling = 0;
  for (const page of pdf.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i += 1) {
      const ref = annots.get(i);
      if (ref instanceof PDFRef && pdf.context.lookup(ref) === undefined) dangling += 1;
    }
  }
  return { text: [...(await extractPdfPages(bytes)), ...meta, ...values].join('\n'), dangling };
}

async function audit() {
  const files = [TEMPLATE, WORKBOOK, ...(existsSync(OUTPUT) ? await listFiles(OUTPUT) : [])];
  let hits = 0;
  let dangling = 0;
  for (const file of files) {
    const { text, dangling: d } = await textOf(file);
    dangling += d;
    for (const re of FORBIDDEN) {
      const m = text.match(re);
      if (m) {
        hits += 1;
        const at = Math.max(0, m.index - 40);
        console.log(`  LEAK ${path.relative(ROOT, file)}: ${re} ... ${text.slice(at, m.index + 40).replace(/\s+/g, ' ')}`);
      }
    }
  }
  console.log(`audit: ${files.length} files, ${hits} client-data hits, ${dangling} dangling PDF annotations`);
  return hits > 0 || dangling > 0;
}

// ---------------------------------------------------------------------------
// preview: 200 dpi PNGs for the portfolio (staff notes in, filled form out)
// ---------------------------------------------------------------------------
const SOFFICE = process.env.SOFFICE_PATH ?? 'C:\\Program Files\\LibreOffice\\program\\soffice.exe';

function soffice(args) {
  const r = spawnSync(SOFFICE, ['--headless', '--norestore', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`soffice ${args.join(' ')} failed: ${r.stderr}`);
}

async function pagePng(pdfPath, pageIndex, out) {
  const src = await PDFDocument.load(await readFile(pdfPath));
  const index = pageIndex < 0 ? src.getPageCount() + pageIndex : pageIndex;
  const single = await PDFDocument.create();
  const [page] = await single.copyPages(src, [index]);
  single.addPage(page);
  const tmp = path.join(path.dirname(out), `.tmp-${path.basename(out, '.png')}`);
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  await writeFile(path.join(tmp, 'page.pdf'), await single.save());
  const { width, height } = page.getSize();
  const px = (pt) => ({ type: 'long', value: String(Math.round((pt / 72) * 200)) });
  // PowerShell mangles these JSON quotes, so the filter is only ever passed from here.
  soffice(['--convert-to', `png:draw_png_Export:${JSON.stringify({ PixelWidth: px(width), PixelHeight: px(height) })}`, '--outdir', tmp, path.join(tmp, 'page.pdf')]);
  await copyFile(path.join(tmp, 'page.png'), out);
  await rm(tmp, { recursive: true, force: true });
}

async function preview() {
  const target = path.join(OUTPUT, 'preview');
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  const firstForm = path.join(OUTPUT, 'PDF', (await readdir(path.join(OUTPUT, 'PDF'))).sort()[0]);
  const tmp = path.join(target, '.tmp-workbook');
  await mkdir(tmp, { recursive: true });
  soffice(['--convert-to', 'pdf', '--outdir', tmp, WORKBOOK]);
  const workbookPdf = path.join(tmp, path.basename(WORKBOOK).replace(/\.docx$/i, '.pdf'));
  await pagePng(workbookPdf, 1, path.join(target, '1-Staff-notes-input.png'));
  await pagePng(firstForm, 0, path.join(target, '2-Filled-form-page-1.png'));
  await pagePng(firstForm, -1, path.join(target, '3-Filled-form-signature-page.png'));
  await rm(tmp, { recursive: true, force: true });
  console.log(`previews: ${(await readdir(target)).join(', ')}`);
}

// ---------------------------------------------------------------------------
const [command, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = rest.indexOf(name);
  return i > -1 ? rest[i + 1] : fallback;
};
if (command === 'inputs') {
  await buildTemplate();
  await buildWorkbook();
  buildSignatures();
  if (await audit()) process.exit(1);
} else if (command === 'run') {
  await run(flag('--api', 'http://localhost:8797'), path.resolve(ROOT, flag('--data', 'demo/data')));
} else if (command === 'preview') {
  await preview();
} else if (command === 'audit') {
  if (await audit()) process.exit(1);
} else {
  console.error('usage: node scripts/make-demo.mjs inputs | run [--api URL] [--data DIR] | preview | audit');
  process.exit(1);
}
