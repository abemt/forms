// Ad-hoc review of a snapshot-mapping JSON: one line per shift with the
// decisions that matter (mood boxes, outcome types, yes/no answers, activities).
import { readFile } from 'node:fs/promises';

const [file, mode = 'summary'] = process.argv.slice(2);
const snap = JSON.parse(await readFile(file, 'utf8'));
const get = (s, name) => s.assignments.find((a) => a.field === name)?.value;
const yes = (s, name) => /^yes$/i.test(String(get(s, name) ?? ''));

if (mode === 'check') {
  // Sanity rules for a generated workbook: flags anything that reads wrong on the form.
  const problems = [];
  const weeks = new Map();
  for (const s of snap.shifts) {
    const id = `${s.date} ${s.shift}`;
    const types = s.assignments.filter((a) => / - Support Type$/.test(a.field));
    for (const t of types) if (/^Choose not to/i.test(String(t.value))) problems.push(`${id}: ${t.field} = ${t.value}`);
    for (const n of ['Individual Activity', 'Group Activity']) {
      const v = String(get(s, n) ?? '');
      if (/day (?:support|program)|incident|fight|hit Steve|enrollment/i.test(v)) problems.push(`${id}: ${n} reads "${v.slice(0, 90)}"`);
    }
    const moods = s.assignments.filter((a) => /^Mood: /.test(a.field) && a.value === true).map((a) => a.field.slice(6));
    if (moods.includes('Calm') && moods.some((m) => /Anger|Agitation|Irritability/.test(m))) problems.push(`${id}: contradictory moods ${moods.join(', ')}`);
    const community = types.find((t) => /^Outcome 2 - /.test(t.field));
    const week = s.date.replace(/, 2026.*/, '').replace(/\d+$/, (d) => String(Math.ceil(Number(d) / 7)));
    if (community && /out of facility/i.test(String(community.value))) weeks.set(week, (weeks.get(week) ?? 0) + 1);
    const desc = String(get(s, 'Mood Description') ?? '');
    if (/incident report|crisis plan|hit Steve/i.test(desc)) problems.push(`${id}: mood description reads "${desc.slice(0, 90)}"`);
    for (const a of s.assignments) {
      if (/ - Documentation$/.test(a.field) && /^(?:Outcome 2|Routine Support 8|Routine Support 12)/.test(a.field) && /fight|hit Steve|incident report|punched/i.test(String(a.value))) {
        problems.push(`${id}: ${a.field} reads "${String(a.value).slice(0, 90)}"`);
      }
    }
  }
  const flagged = (n) => snap.shifts.filter((s) => yes(s, n)).map((s) => `${s.date.replace(/, 2026/, '')} ${s.shift}`);
  console.log(`Medical Complaints yes: ${flagged('Medical Complaints').join('; ') || 'none'}`);
  console.log(`Behavioral Difficulty yes: ${flagged('Behavioral Difficulty').join('; ') || 'none'}`);
  console.log(`Serious Incident yes: ${flagged('Serious Incident').join('; ') || 'none'}`);
  console.log(`Community (Outcome 2) Out of Facility per week-of-month: ${[...weeks].map(([w, n]) => `${w}:${n}`).join(', ')}`);
  console.log(problems.length ? `PROBLEMS (${problems.length}):\n  ${problems.join('\n  ')}` : 'no problems found');
  process.exit(0);
}

for (const s of snap.shifts) {
  const moods = s.assignments.filter((a) => /^Mood: /.test(a.field) && a.value === true && a.field !== 'Mood: Other Checked').map((a) => a.field.slice(6));
  const other = get(s, 'Mood: Other');
  const types = s.assignments.filter((a) => / - Support Type$/.test(a.field)).map((a) => `${a.field.replace(/ - Support Type$/, '')}=${a.value}`);
  const outcome = types.filter((t) => /^Outcome/.test(t)).join(' | ');
  const q = ['Medication Received', 'Medical Complaints', 'Behavioral Difficulty', 'Serious Incident'].map((n) => `${n.split(' ')[0].slice(0, 3)}:${String(get(s, n) ?? '?').slice(0, 1)}`).join(' ');
  console.log(`${s.date} ${s.shift.padEnd(9)} ${s.provider.replace(/, DSP$/, '').padEnd(18)} moods=[${moods.join(', ')}${other ? ` +Other:${other}` : ''}] ${q}`);
  if (mode === 'full') {
    console.log(`   ${outcome}`);
    console.log(`   types: ${types.filter((t) => !/^Outcome/.test(t)).map((t) => t.replace(/ \(.*?\)/, '')).join('; ')}`);
    console.log(`   Individual: ${get(s, 'Individual Activity')}`);
    console.log(`   Group: ${get(s, 'Group Activity')}`);
    console.log(`   Community: ${get(s, 'Community Activity')}`);
    console.log(`   Mood desc: ${get(s, 'Mood Description')}`);
    for (const n of ['Medical Complaints', 'Behavioral Difficulty', 'Serious Incident']) if (yes(s, n)) console.log(`   ${n} YES: ${get(s, `${n} Explanation`)}`);
    if (s.warnings.length) console.log(`   warnings: ${s.warnings.join(' || ')}`);
  } else {
    console.log(`   ${outcome}`);
    for (const n of ['Medical Complaints', 'Behavioral Difficulty', 'Serious Incident']) if (yes(s, n)) console.log(`   ${n} YES: ${String(get(s, `${n} Explanation`)).slice(0, 160)}`);
  }
}
