// Diff two mapping snapshots: which fields changed, with examples.
import { readFile } from 'node:fs/promises';
const [a, b] = process.argv.slice(2);
const A = JSON.parse(await readFile(a, 'utf8'));
const B = JSON.parse(await readFile(b, 'utf8'));
const byField = new Map();
let changedShifts = 0;
for (let i = 0; i < A.shifts.length; i++) {
  const x = A.shifts[i], y = B.shifts[i];
  const ax = new Map(x.assignments.map((s) => [s.field, s]));
  const ay = new Map(y.assignments.map((s) => [s.field, s]));
  let changed = false;
  for (const f of new Set([...ax.keys(), ...ay.keys()])) {
    const va = ax.get(f), vb = ay.get(f);
    const same = va && vb && va.value === vb.value && (va.evidence ?? '') === (vb.evidence ?? '');
    if (same) continue;
    changed = true;
    const e = byField.get(f) ?? { count: 0, example: null };
    e.count++;
    if (!e.example) e.example = { shift: `${x.date} ${x.shift}`, before: va ? String(va.value).slice(0, 120) : '(absent)', after: vb ? String(vb.value).slice(0, 120) : '(absent)' };
    byField.set(f, e);
  }
  if (JSON.stringify(x.warnings) !== JSON.stringify(y.warnings)) {
    changed = true;
    const e = byField.get('(warnings)') ?? { count: 0, example: null };
    e.count++;
    if (!e.example) e.example = { shift: `${x.date} ${x.shift}`, before: x.warnings.join(' | ').slice(0, 160), after: y.warnings.join(' | ').slice(0, 160) };
    byField.set('(warnings)', e);
  }
  if (changed) changedShifts++;
}
console.log(`shifts with differences: ${changedShifts}/${A.shifts.length}; fills equal: ${JSON.stringify(A.fills) === JSON.stringify(B.fills)}`);
for (const [f, e] of [...byField].sort((p, q) => q[1].count - p[1].count)) {
  console.log(`\n${f}  (${e.count} shifts)  e.g. ${e.example.shift}`);
  console.log(`   before: ${e.example.before}`);
  console.log(`   after : ${e.example.after}`);
}
