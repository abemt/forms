#!/usr/bin/env python3
"""Build "SL 3rd Residential Quarterly 3.15.2026-6.14.2026.docx" from the
2nd-quarterly template, applying the April-June milestone updates.

Also converts the floating final-questions table to an inline table: in the
source template it is absolutely positioned, which clips questions 2-5 and
overlaps the page-15 footer when rendered.

Usage: python3 scripts/build-quarterly-q3.py
"""
import copy
from docx import Document
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph

SRC = 'SL 2nd Residential Quarterly 12.15.2025-3.14.2026 (1).docx'
OUT = 'SL 3rd Residential Quarterly 3.15.2026-6.14.2026.docx'

doc = Document(SRC)
paras = [Paragraph(c, doc) for c in doc.element.body.iter() if c.tag == qn('w:p')]


def set_text(p, text):
    runs = p.runs
    if not runs:
        p.add_run(text)
        return
    runs[0].text = text
    for r in runs[1:]:
        r.text = ''


def flip_boxes(p, states):
    i = 0
    for r in p.runs:
        out = []
        for ch in r.text:
            if ch in '\u2610\u2612':
                ch = '\u2612' if states[i] == 'x' else '\u2610'
                i += 1
            out.append(ch)
        r.text = ''.join(out)
    if i != len(states):
        raise RuntimeError(f'expected {len(states)} boxes, found {i}: "{p.text[:60]}"')


def find_para(prefix):
    for p in paras:
        if p.text.strip().startswith(prefix):
            return p
    raise RuntimeError(f'anchor not found: {prefix[:60]}')


# ---- 1) status triples ------------------------------------------------------
import re
OPT = re.compile(r'^[\u2610\u2612]\s*(Achieved|On track|Limited or no progress)$')
triples = []
cur = {}
for p in paras:
    m = OPT.match(p.text.strip())
    if not m:
        continue
    label = m.group(1)
    if label == 'Achieved':
        cur = {}
        triples.append(cur)
    cur[label] = p
assert len(triples) == 20, f'expected 20 status groups, got {len(triples)}'

# All sections On track this quarter (communication upgraded per case-manager
# engagement about employment).
new_states = ['On track'] * 20
for t, want in zip(triples, new_states):
    for label, p in t.items():
        flip_boxes(p, ['x' if label == want else 'o'])

# ---- 2) narrative rewrites ---------------------------------------------------
REWRITES = [
 ('Throughout this reporting period, staff encouraged Steve to participate in community activities',
  'Throughout this reporting period, Steve made meaningful progress toward becoming an active member of his '
  'community. He participated in community outings and recreational activities that he enjoys with staff '
  'support, including walks, shopping trips, and other preferred activities. Steve also set his own weekly '
  'routine and chose to stay home at the group home every Wednesday to rest and work on his indoor hobbies '
  'and household projects, which staff respected as his personal choice. Steve has begun talking with staff '
  'and his case manager about finding a job, and the team plans to support him with seeking employment '
  'during the next quarter.', []),
 ('Throughout this reporting period, Steve continued learning basic kitchen skills',
  'Throughout this reporting period, Steve made significant progress with cooking and meal preparation. For '
  'the entire three months, Steve cooked meals for himself with staff nearby for safety and encouragement. '
  'He prepared his own food, followed simple recipes, and practiced safe kitchen habits. Steve\u2019s confidence '
  'in the kitchen has grown noticeably, and he continues to build meal-planning skills with staff guidance.', []),
 ('Throughout this reporting period, staff encouraged Steve to increase his daily water intake',
  'Throughout this reporting period, Steve made a major improvement in his daily fluid choices. He '
  'substituted soda with water and now takes his medications with water instead of soda. Staff continued to '
  'offer water regularly and praised his healthier choices. Steve\u2019s daily water intake has increased, and '
  'this improvement also supports his diabetic diet. No signs or symptoms of dehydration were observed '
  'during this reporting period.', []),
 ('Throughout this reporting period, Steve continued to demonstrate the ability to communicate',
  'Throughout this reporting period, Steve communicated his wants, needs, and preferences effectively '
  'in daily situations at home and in the community. He regularly talks with staff about his daily '
  'routine and choices, and he communicates directly with his case manager about his goals, including '
  'his interest in finding a job. Steve expressed himself clearly during appointments, outings, and '
  'conversations with his team, and he needed only occasional reminders from staff to express himself '
  'clearly in higher-stimulation situations.',
  ['However, staff continued to provide intermittent verbal reminders',
   'Steve is able to communicate his wants and needs all the time']),
 ('Throughout this reporting period, staff continued to provide medication administration support',
  'Throughout this reporting period, staff continued to provide medication administration support in '
  'accordance with physician orders and established protocols. Steve received medications as prescribed '
  'with no reported refusals or adverse concerns. Steve now takes his medications with water instead of '
  'soda, which supports his overall health. Staff ensured medications were administered safely and '
  'documented appropriately. No concerns have been reported.',
  ['Staff ensured medications were administered safely']),
 ('Throughout this reporting period, Steve participated in housekeeping tasks when prompted',
  'Throughout this reporting period, Steve showed increased independence with housekeeping. He kept his '
  'living space organized, including organizing his DVD player and DVD collection at home. The home is '
  'well organized, and Steve took pride in maintaining his space with fewer staff prompts. Staff continued '
  'to provide encouragement and occasional reminders as needed.',
  ['While Steve demonstrated willingness to participate', 'Steve helps with housekeeping tasks when told by staff']),
 ('Throughout this reporting period, Steve participated in laundry routines with staff support',
  'Throughout this reporting period, Steve started doing his own laundry. He sorted, washed, and folded his '
  'clothing with minimal staff reminders and demonstrated increased independence with the full laundry '
  'routine. Staff continued to encourage him and provided support only as needed.',
  ['Staff continued to reinforce independence by encouraging step-by-step']),
 ('Throughout this reporting period, Steve participated in community shopping outings with staff support. He engaged in selecting personal items',
  'Throughout this reporting period, Steve participated in community shopping outings with staff support '
  'and used his own saved and earned money to make purchases. He bought a shelf for his clothes, a guitar '
  'accessory, DVD games, and a T-shirt. Steve engaged in selecting his items, handled transactions with '
  'staff guidance, and demonstrated appropriate behavior in community settings.',
  ['Staff provided supervision and assistance as needed to ensure safety']),
 ('Throughout this reporting period, Steve continued to build foundational skills in meal preparation',
  'Throughout this reporting period, Steve cooked for himself consistently for the entire quarter. He '
  'participated in planning simple meals, preparing food safely with staff supervision, and cleaning up '
  'afterward. Steve\u2019s independence with meal preparation increased significantly, and staff continued to '
  'support him with menu planning and safe kitchen practices.',
  ['Steve remains in the learning phase']),
 ('Throughout this reporting period, Steve continued to require full staff support with all aspects of budgeting',
  'Throughout this reporting period, Steve made outstanding progress with budgeting and money management. '
  'He managed to save $140, which he used to buy a shelf for his clothes and a guitar accessory. Steve also '
  'earned money by working for his cousin and used his earnings to buy DVD games and a T-shirt. On average, '
  'Steve now saves about $285 of his approximately $600 in monthly funds, which is a major accomplishment '
  'this quarter. The home is organized, and Steve is thinking about finding work with the support of his '
  'case manager. Staff continued to support him during purchases and with planning his savings goals.',
  ['Steve has not yet demonstrated independent money management']),
]
for anchor, new_text, blanks in REWRITES:
    set_text(find_para(anchor), new_text)
    for b in blanks:
        set_text(find_para(b), '')

# ---- 3) final questions -------------------------------------------------------
q2 = find_para('Does the person or substitute decision-maker desire')
idx = paras.index(q2)
yn = None
for p in paras[idx + 1:idx + 6]:
    if '\u2610' in p.text and 'Yes' in p.text and 'No' in p.text:
        yn = p
        break
assert yn is not None
flip_boxes(yn, ['x', 'o'])
set_text(find_para('If yes, describe plans to address:'),
  'If yes, describe plans to address: Steve expressed a desire to find paid employment. He has started '
  'discussing this with his case manager, and the team plans to help him look for a job during the next '
  'quarter. Employment supports will be explored and added to his plan as appropriate.')
set_text(find_para('Describe how you know the response indicated'),
  'Describe how you know the response indicated and any plans to address dissatisfaction: Steve reported '
  'that he likes living at Joy Group Home and expressed pride in the progress he made this quarter. He '
  'proudly showed staff the shelf and the other items he purchased with his own savings and talked about '
  'enjoying cooking his own meals. No concerns or dissatisfaction were reported by Steve or his family '
  'during this reporting period.')

# ---- 4) dates -----------------------------------------------------------------
changed = 0
for p in paras:
    for r in p.runs:
        if '03/15/2026' in r.text:
            r.text = r.text.replace('03/15/2026', '06/15/2026')
            changed += 1
        if '9/15/2025' in r.text and 'Start date' in p.text:
            r.text = r.text.replace('9/15/2025', '4/1/2026')
            changed += 1
assert changed == 21, changed  # 1 completion date + 20 start dates

# ---- 5) header ----------------------------------------------------------------
fixed = False
for section in doc.sections:
    for hdr in (section.header, section.first_page_header, section.even_page_header):
        containers = list(hdr.paragraphs)
        for tbl in hdr.tables:
            for row in tbl.rows:
                for cell in row.cells:
                    containers.extend(cell.paragraphs)
        for p in containers:
            if 'quarterly review covers information' in p.text:
                flip_boxes(p, ['o', 'o', 'x', 'o'])
                for r in p.runs:
                    if '12/15/2025' in r.text:
                        r.text = r.text.replace('12/15/2025', '3/15/2026')
                    if '3/14/2026' in r.text:
                        r.text = r.text.replace('3/14/2026', '6/14/2026')
                fixed = True
assert fixed

# ---- 6) inline the floating final-questions table -----------------------------
# The questions table is absolutely positioned (w:tblpPr), which clips its
# overflow (questions 2-5) and overlaps the footer. Remove the positioning so
# the table flows naturally across pages.
inlined = 0
for tbl in doc.element.body.findall(qn('w:tbl')):
    tblPr = tbl.find(qn('w:tblPr'))
    if tblPr is None:
        continue
    flo = tblPr.find(qn('w:tblpPr'))
    if flo is not None:
        tblPr.remove(flo)
        ov = tblPr.find(qn('w:tblOverlap'))
        if ov is not None:
            tblPr.remove(ov)
        inlined += 1
print('floating tables inlined:', inlined)

doc.save(OUT)
print('saved:', OUT)
