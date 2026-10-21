// Jerrell "Jay" Wright — 2nd residential quarterly (ISP 1/23/2026–1/22/2027),
// header period 4/23/2026–7/22/2026. Jerrell was admitted 7/20/2026, so the only
// days at this provider inside the period are 7/20, 7/21 and 7/22/2026 — the
// three days Beziye asked for. Every statement below is drawn from the delivered
// July daily notes (job a2d73242, shifts 7/20–7/22); nothing after 7/22 is used.
//
// Runs against the live site API so the draft is saved in the Quarterly tab:
//   node scripts/quarterly-jerrell-2026q2.mjs [--base http://localhost:8787] [--reviewer "Name"]
//   node scripts/quarterly-jerrell-2026q2.mjs --reexport <draftId>   (re-render a saved draft as is)
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const base = `${option('--base', 'http://localhost:8787')}/api`;
const reviewer = option('--reviewer', 'Abem Tadele');

const TEMPLATE = path.join(root, 'JW Quarterly Template (1).docx');
const SOURCE_JOB = 'a2d73242-6601-4fab-8169-6e986a60ac3f'; // Jerrell July 2026 final daily notes
const OUT_NAME = 'JW 2nd Residential Quarterly 4.23.2026-7.22.2026';

const P = '7/20/2026 through 7/22/2026';

// match = regex on the row title (outcome / risk / ticked routine support)
const ROWS = [
  {
    match: /goes out in the community weekly/,
    status: 'On track',
    text:
      'Jerrell moved into Joy Group Home on 7/20/2026, so this review covers his first three days in the home ' +
      `(${P}). Staff spent 7/20 and 7/21 helping him settle in, and on 7/22/2026 he went out for a walk around ` +
      'the block with staff before lunch. Jerrell also told staff on 7/20 and 7/21 that he would like to start a ' +
      'day program like his housemate as soon as possible, and staff explained that the house manager is arranging ' +
      'his enrollment. Staff will continue to offer Jerrell a community outing of his choice every week.',
  },
  {
    match: /budgets his money weekly/,
    status: 'On track',
    text:
      `This review covers only Jerrell's first three days in the home (${P}). During these days staff focused on ` +
      'his move-in, orientation to the house and settling into his room, and no budgeting or spending activity was ' +
      'recorded. No gaps or barriers were identified. Staff will begin supporting Jerrell to plan his weekly ' +
      'spending money for community activities in the next reporting period.',
  },
  {
    match: /^Fall with Injury/,
    status: 'On track',
    text:
      `From ${P} staff monitored Jerrell as he moved his belongings into his room, moved about the home, showered ` +
      'each evening and took a walk around the block with staff on 7/22/2026. Overnight staff completed bed checks. ' +
      'No falls and no injuries were reported during this period.',
  },
  {
    match: /^Bowel Obstruction/,
    status: 'On track',
    text:
      `From ${P} Jerrell ate regular meals, including fruit with his lunch on 7/20, a banana with breakfast on 7/21 ` +
      'and a smoothie with dinner on 7/22. Staff offered water throughout the day shifts and he drank water. No ' +
      'constipation, abdominal discomfort or other concerns related to bowel obstruction were reported during this period.',
  },
  {
    match: /^Self-Harm/,
    status: 'On track',
    text:
      `No self-harm and no statements about hurting himself were reported from ${P}. Jerrell's mood was recorded as ` +
      'excited and a little nervous on his move-in day and as content, friendly, happy, talkative and relaxed on 7/21 ' +
      'and 7/22. Staff reminded him on his first evening that staff are available overnight if he needs anything, and ' +
      'overnight staff checked on him regularly.',
  },
  {
    match: /^Elopement/,
    status: 'On track',
    text:
      `On 7/20/2026 staff reviewed the house rules and emergency exits with Jerrell. From ${P} he stayed home while ` +
      'his housemate attended day support, and his only outing was a walk around the block with staff on 7/22/2026. ' +
      'No attempts to leave the home without staff were reported during this period.',
  },
  {
    match: /^Lack of Safety Awareness/,
    status: 'On track',
    text:
      'On 7/20/2026 staff went over the house rules, the emergency exits and the safety rules of the house with ' +
      'Jerrell and answered his questions, and showed him how the shower works. On 7/22/2026 staff reminded him to be ' +
      `careful with the hot pan while he heated leftovers for lunch. No injuries were reported from ${P}.`,
  },
  {
    match: /^Suicidal ideations/,
    status: 'On track',
    text:
      `No suicidal statements or ideation were reported from ${P}. Jerrell engaged with his housemate and staff over ` +
      'meals, conversations, a movie and a game, drew in his sketchbook, and his recorded moods were excited and a ' +
      'little nervous on move-in day and content, friendly, happy, talkative and relaxed on 7/21 and 7/22.',
  },
  {
    match: /^Bathing$/,
    status: 'On track',
    text:
      `Jerrell showered before bed each evening from ${P} and put on clean clothes afterwards. On his first evening ` +
      'staff showed him how the shower works; on 7/21 and 7/22 he showered independently.',
  },
  {
    match: /^Communication support$/,
    status: 'On track',
    text:
      `From ${P} Jerrell asked staff questions about the house rules and about starting a day program, and staff ` +
      'answered him and explained that the house manager is arranging his enrollment. He got to know his housemate ' +
      'through conversations over dinner and in the living room, where they found they both like movies, and he ' +
      'showed staff his drawings.',
  },
  {
    match: /^Dressing$/,
    status: 'On track',
    text:
      'Jerrell picked out his clothes and got dressed without help from staff on the mornings of 7/21/2026 and ' +
      '7/22/2026, and he put on clean clothes after his shower each evening. No physical help with dressing was needed.',
  },
  {
    match: /^Personal appearance$/,
    status: 'On track',
    text:
      'Jerrell brushed his teeth on 7/21/2026 and shaved on 7/22/2026 after verbal reminders from staff, and he wore ' +
      'clean clothes each day. Staff will continue to use verbal reminders to support his grooming.',
  },
  {
    match: /^Medication use$/,
    status: 'On track',
    text:
      "On 7/20/2026 Jerrell's medications and paperwork were checked in and locked in the medication cabinet; no " +
      'medication was due during his move-in shift. Staff administered his evening medications at 8:00 PM on 7/20, ' +
      '7/21 and 7/22/2026 and his morning medications at 9:00 AM on 7/21 and 7/22/2026 as prescribed, and Jerrell ' +
      'took them without any problem. No missed doses, refusals or medication errors were reported.',
  },
  {
    match: /^Housekeeping$/,
    status: 'On track',
    text:
      'With staff help Jerrell unpacked his clothes and set up his room on 7/20/2026. On 7/21/2026 he made his bed ' +
      'and tidied his room and cleared his plate after dinner, and on 7/22/2026 he washed his breakfast dishes and put ' +
      'them away. He completed these tasks independently.',
  },
  {
    match: /^Laundry$/,
    status: 'On track',
    text:
      'Jerrell moved in on 7/20/2026 and staff helped him unpack his clothes and set up his room. No laundry was ' +
      `recorded from ${P}, his first three days in the home. Staff will support Jerrell with his weekly laundry ` +
      'routine in the next reporting period.',
  },
  {
    match: /^Shopping$/,
    status: 'On track',
    text:
      `No shopping trips were recorded from ${P}, Jerrell's first three days in the home. Staff will support Jerrell ` +
      'with shopping for his own items and groceries in the next reporting period.',
  },
  {
    match: /^Meal planning/,
    status: 'On track',
    text:
      "On his move-in day (7/20/2026) staff prepared Jerrell's lunch (a sandwich and fruit) and he had dinner with his " +
      'housemate and staff; on 7/21 staff showed him where everything is in the kitchen. From 7/21/2026 Jerrell prepared ' +
      'his own breakfast (cereal and a banana; toast and eggs), lunch (a sandwich; heated leftovers) and dinner (a ' +
      'sandwich and a smoothie) with staff nearby, and he ate dinner at the table with his housemate and staff on 7/20 ' +
      'and 7/21. Staff offered water throughout the day shifts.',
  },
  {
    match: /^Banking\/money management$/,
    status: 'On track',
    text:
      `No banking or money-management activity was recorded from ${P}, Jerrell's first three days in the home. Staff ` +
      'will begin supporting Jerrell with managing his spending money in the next reporting period.',
  },
  {
    match: /^Medical appointments$/,
    status: 'On track',
    text:
      `No medical appointments took place from ${P}. Jerrell's medications and paperwork were checked in on his ` +
      'admission day, 7/20/2026, and staff will support him with his medical appointments as they are scheduled.',
  },
  {
    match: /^Transportation$/,
    status: 'On track',
    text:
      `No transportation to appointments or community outings was recorded from ${P}; Jerrell's only outing was a ` +
      'walk around the block with staff on 7/22/2026. Staff will provide transportation for his community activities ' +
      'and appointments as they are scheduled.',
  },
  {
    match: /^Crisis plan$/,
    status: 'On track',
    text:
      'On 7/20/2026 staff reviewed the house rules, emergency exits and safety rules with Jerrell and reminded him that ' +
      'staff are available overnight if he needs anything. No behavioral crisis occurred and the crisis plan did not ' +
      `need to be used from ${P}.`,
  },
  {
    match: /^Medical #1: Gout/,
    status: 'On track',
    text:
      `From ${P} Jerrell's medications were given as prescribed, staff offered water throughout the day shifts, and he ` +
      'ate regular meals. No gout flare-ups, joint pain or swelling were reported during this period.',
  },
  {
    match: /^Behavioral #1: Emotional Outburst/,
    status: 'On track',
    text:
      `No emotional outbursts were reported from ${P}. Jerrell was recorded as excited and a little nervous on his ` +
      'move-in day and as content, friendly, happy, talkative and relaxed on 7/21 and 7/22. His housemate welcomed ' +
      'him, helped him set up his TV and Xbox and played a game with him, and Jerrell attended the house meeting on ' +
      '7/21/2026 to go over the rules and regulations of the house.',
  },
];

const QUESTIONS = [
  {
    match: /any safety risks/,
    answer: 'No',
    text:
      `No new health or behavioral safety risks were identified from ${P}. Staff reviewed the house rules, emergency ` +
      'exits and safety rules with Jerrell on his move-in day and reminded him to be careful with the hot pan on ' +
      '7/22/2026. The potential risks already listed in his plan remain in place and are addressed in the sections above.',
  },
  {
    match: /changes to the plan or services/,
    answer: 'Yes',
    text:
      'Jerrell told staff on 7/20 and 7/21/2026 that he would like to start a day program like his housemate as soon ' +
      'as possible. Day support is part of his plan and the house manager is arranging his enrollment. No other ' +
      'changes to the plan or services were requested during this period.',
  },
  {
    match: /satisfied with all services/,
    answer: 'Yes',
    text:
      'Jerrell settled into his room, took part in meals, conversations, a movie and a game with his housemate and ' +
      'staff, and told staff what he wants (to start his day program). After his move-in day his moods were recorded ' +
      `as content, friendly, happy, talkative and relaxed. No complaints or dissatisfaction from Jerrell were recorded from ${P}.`,
  },
  {
    match: /Medicaid services in the plan implemented/,
    answer: 'No',
    text:
      "Residential services were provided from Jerrell's admission on 7/20/2026. Day support had not started as of " +
      '7/22/2026; Jerrell has asked to start as soon as possible and the house manager is arranging his enrollment.',
  },
  {
    match: /significant events/,
    answer: 'Yes',
    text:
      'Jerrell moved into Joy Group Home on 7/20/2026, arriving around 11:00 AM with his belongings. Staff oriented him ' +
      'to the home, helped him set up his room, checked in his medications and paperwork and completed his intake ' +
      'paperwork, and he attended the house meeting on 7/21/2026 to go over the rules and regulations of the house. No ' +
      `health events, injuries or incidents occurred from ${P}.`,
  },
];

const COMPLETED = 'Completed by: Kierra Crump   (Signature) Kierra Crump       Date: 07/23/2026';

async function api(url, init) {
  const response = await fetch(`${base}${url}`, init);
  const body = response.headers.get('content-type')?.includes('json') ? await response.json() : await response.arrayBuffer();
  if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${url} -> ${response.status} ${JSON.stringify(body)}`);
  return body;
}
const json = (method, url, value) => api(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });

const reexport = option('--reexport');
let report;
if (reexport) {
  report = await api(`/quarterly/${reexport}`);
  console.log(`re-exporting saved draft ${report.id} (${report.spec.individualName}) without changing its values`);
} else {
  report = await createDraft();
}

async function createDraft() {
const form = new FormData();
form.append('options', JSON.stringify({ profileId: 'jerrell', mode: 'new', periodStart: '2026-04-23', periodEnd: '2026-07-22', quarter: '2nd', sourceJobIds: [SOURCE_JOB], saveTemplate: true }));
form.append('template', new Blob([await readFile(TEMPLATE)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), path.basename(TEMPLATE));
const report = await api('/quarterly', { method: 'POST', body: form });
console.log(`draft ${report.id}: ${report.spec.individualName}, ${report.sources.length} source excerpts from ${[...new Set(report.sources.map((s) => s.date))].join(', ')}`);

const values = { ...report.values };
const groups = [...new Set(report.spec.fields.map((field) => field.group))];
const used = new Set();
for (const row of ROWS) {
  const hits = groups.filter((group) => row.match.test(group));
  if (hits.length !== 1) throw new Error(`row ${row.match} matched ${hits.length} groups: ${hits.join(' | ')}`);
  const fields = report.spec.fields.filter((field) => field.group === hits[0]);
  const id = (suffix) => fields.find((field) => field.id.endsWith(suffix))?.id ?? (() => { throw new Error(`${hits[0]}: no ${suffix}`); })();
  values[id('.status')] = row.status;
  values[id('.summary')] = row.text;
  values[id('.change')] = 'No';
  values[id('.changeText')] = '';
  used.add(hits[0]);
}
for (const question of QUESTIONS) {
  const hits = groups.filter((group) => question.match.test(group));
  if (hits.length !== 1) throw new Error(`question ${question.match} matched ${hits.length}`);
  const fields = report.spec.fields.filter((field) => field.group === hits[0]);
  values[fields.find((field) => field.id.endsWith('.answer')).id] = question.answer;
  values[fields.find((field) => field.id.endsWith('.explanation')).id] = question.text;
  used.add(hits[0]);
}
for (const field of report.spec.fields) if (field.id.startsWith('completion')) { values[field.id] = COMPLETED; used.add(field.group); }
used.add('Reporting Period');
const untouched = groups.filter((group) => !used.has(group));
if (untouched.length) throw new Error(`template rows without content: ${untouched.join(' | ')}`);

await json('PATCH', `/quarterly/${report.id}`, { values });
return report;
}

await json('POST', `/quarterly/${report.id}/generate`, { reviewed: true, reviewer });
let final;
for (let attempt = 0; attempt < 120; attempt++) {
  final = await api(`/quarterly/${report.id}`);
  if (final.status === 'done' || final.status === 'failed') break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
if (final.status !== 'done') throw new Error(`export ${final.status}: ${final.warning ?? ''}`);
if (final.warning) console.warn(`warning: ${final.warning}`);
for (const [format, ext] of [['word', 'docx'], ['pdf', 'pdf']]) {
  if (format === 'pdf' && !final.pdfReady) { console.warn('PDF not produced'); continue; }
  const bytes = Buffer.from(await api(`/quarterly/${report.id}/download?format=${format}`));
  const out = path.join(root, 'server', 'data', `${OUT_NAME}.${ext}`);
  await writeFile(out, bytes);
  console.log(`wrote ${out} (${bytes.length} bytes)`);
}
console.log(`quarterly ${report.id} done; ${ROWS.length} rows, ${QUESTIONS.length} questions, quarter 2nd, period 4/23/2026-7/22/2026`);
