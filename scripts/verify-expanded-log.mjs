#!/usr/bin/env node
/**
 * Verifies the expanded log end-to-end against the faithful template:
 * extract 81 shifts -> map each locally -> validate grounding -> assert
 * every template field is filled on every shift.
 *
 * Usage: node scripts/verify-expanded-log.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../server/dist/polyfill.js';
import { extractPdfPages } from '../server/dist/services/pdfText.js';
import { extractShiftsLocally } from '../server/dist/services/local/extractor.js';
import { mapShiftLocally } from '../server/dist/services/local/mapper.js';
import { validateAssignments } from '../server/dist/services/ai/fieldMapper.js';
import { buildTemplateFromDocx } from '../server/dist/services/docxTemplate.js';
import { inspectTemplate } from '../server/dist/services/templateInspector.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LOG_PDF = path.join(ROOT, 'Steven_May2026_Complete_Monthly_Log.pdf');
const TEMPLATE_DOCX = path.join(ROOT, 'server', 'assets', 'form680-default.docx');

async function main() {
  const templateBytes = await buildTemplateFromDocx(new Uint8Array(fs.readFileSync(TEMPLATE_DOCX)));
  const fields = await inspectTemplate(templateBytes);
  const textFields = fields.filter((f) => f.type === 'text');
  const radioFields = fields.filter((f) => f.type === 'radio' || f.type === 'dropdown');
  const shiftBoxes = fields.filter((f) => f.type === 'checkbox' && /^shift:/i.test(f.name));
  const moodBoxes = fields.filter((f) => f.type === 'checkbox' && /^mood:/i.test(f.name));
  console.log(
    `Template: ${fields.length} fields (${textFields.length} text, ${radioFields.length} radio/dd, ` +
      `${shiftBoxes.length} shift cb, ${moodBoxes.length} mood cb)`,
  );

  const logBytes = new Uint8Array(fs.readFileSync(LOG_PDF));
  const pages = await extractPdfPages(logBytes.slice());
  const shifts = extractShiftsLocally(pages);
  console.log(`Extracted shifts: ${shifts.length}`);
  if (shifts.length !== 81) {
    console.error('FAIL: expected exactly 81 shifts');
    process.exit(1);
  }

  const missingByField = new Map();
  const shiftProblems = [];
  let totalWarnings = 0;

  for (let i = 0; i < shifts.length; i += 1) {
    const shift = shifts[i];
    const { assignments, warnings } = validateAssignments(mapShiftLocally(shift, fields), shift, fields);
    totalWarnings += warnings.length;
    const byName = new Map(assignments.map((a) => [a.field, a]));
    const problems = [];

    for (const f of textFields) {
      const a = byName.get(f.name);
      if (!a || !String(a.value ?? '').trim()) {
        problems.push(`text empty: ${f.name}`);
        missingByField.set(f.name, (missingByField.get(f.name) ?? 0) + 1);
      }
    }
    for (const f of radioFields) {
      const a = byName.get(f.name);
      if (!a || !String(a.value ?? '').trim()) {
        problems.push(`radio unset: ${f.name}`);
        missingByField.set(f.name, (missingByField.get(f.name) ?? 0) + 1);
      }
    }
    const shiftChecked = shiftBoxes.filter((f) => byName.get(f.name)?.value === true);
    if (shiftChecked.length !== 1) problems.push(`shift cb count=${shiftChecked.length}`);
    const moodChecked = moodBoxes.filter((f) => byName.get(f.name)?.value === true);
    if (moodChecked.length < 1) problems.push('no mood cb');
    if (warnings.length) problems.push(`validation warnings: ${warnings.join(' | ')}`);

    if (problems.length) shiftProblems.push({ i, date: shift.date, shift: shift.shift, problems });
  }

  console.log(`Validation warnings total: ${totalWarnings}`);
  if (missingByField.size) {
    console.log('\nMissing fields (aggregated):');
    for (const [name, count] of [...missingByField.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${count.toString().padStart(3)}x  ${name}`);
    }
  }
  if (shiftProblems.length) {
    console.log(`\n${shiftProblems.length}/81 shifts with problems. First 3:`);
    for (const p of shiftProblems.slice(0, 3)) {
      console.log(`- #${p.i + 1} ${p.date} ${p.shift}`);
      for (const pr of p.problems.slice(0, 12)) console.log(`    ${pr}`);
    }
    process.exit(1);
  }
  console.log('\nPASS: all 81 shifts fully mapped — every text field, radio, shift + mood checkbox set, 0 dropped values.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
