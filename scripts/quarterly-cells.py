#!/usr/bin/env python3
"""Emit table-cell geometry for the quarterly PDF as JSON (stdout).

For every narrative/describe region we output the enclosing cell rectangle
(top-left origin, PDF points), the y where the printed label ends, and the
printed text inside the region so it can be re-issued as an editable
AcroForm text field.

Regions emitted:
  - "Status description:" cells  -> field below the label
  - "If yes/no, describe..." / "Describe how..." cells:
      cells that also hold checkboxes (plan-change columns) -> below label
      cells without checkboxes (questions table)            -> whole cell
  - Outcome definition cells (Start/End date + prose, no checkboxes)
      -> field below the "End date:" line

Usage: python3 scripts/quarterly-cells.py <input.pdf>
"""
import json
import sys
import pymupdf

TOL = 1.5

LABELS = [
    'Status description:',
    'If yes, describe plans to address:',
    'If no, describe plans to address:',
    'If yes, describe risks',
    'Describe how you know the response indicated',
    'If yes, describe:',
]


def collect_lines(page):
    vlines, hlines = [], []
    for d in page.get_drawings():
        for item in d['items']:
            if item[0] == 'l':
                p1, p2 = item[1], item[2]
                if abs(p1.x - p2.x) < TOL:
                    vlines.append((p1.x, min(p1.y, p2.y), max(p1.y, p2.y)))
                elif abs(p1.y - p2.y) < TOL:
                    hlines.append((p1.y, min(p1.x, p2.x), max(p1.x, p2.x)))
            elif item[0] == 're':
                r = item[1]
                if r.height <= 2.5:
                    hlines.append(((r.y0 + r.y1) / 2, r.x0, r.x1))
                elif r.width <= 2.5:
                    vlines.append(((r.x0 + r.x1) / 2, r.y0, r.y1))
                else:
                    hlines.append((r.y0, r.x0, r.x1))
                    hlines.append((r.y1, r.x0, r.x1))
                    vlines.append((r.x0, r.y0, r.y1))
                    vlines.append((r.x1, r.y0, r.y1))
    return vlines, hlines


def cell_for(rect, vlines, hlines, page_rect):
    """Enclosing cell borders for a text rect (top-left origin)."""
    cy = (rect.y0 + rect.y1) / 2
    lefts = [x for x, y0, y1 in vlines if x <= rect.x0 + 2 and y0 - 2 <= cy <= y1 + 2]
    rights = [x for x, y0, y1 in vlines if x >= rect.x1 - 2 and y0 - 2 <= cy <= y1 + 2]
    left = max(lefts) if lefts else page_rect.x0
    right = min(rights) if rights else page_rect.x1
    cx = (left + right) / 2
    tops = [y for y, x0, x1 in hlines if y <= rect.y0 + 2 and x0 - 2 <= cx <= x1 + 2]
    bottoms = [y for y, x0, x1 in hlines if y >= rect.y1 - 2 and x0 - 2 <= cx <= x1 + 2]
    top = max(tops) if tops else page_rect.y0
    bottom = min(bottoms) if bottoms else page_rect.y1
    return left, top, right, bottom


def region_text(page, rect):
    raw = page.get_text('text', clip=pymupdf.Rect(*rect))
    lines = [ln.strip() for ln in raw.split('\n')]
    parts, buf = [], []
    for ln in lines:
        if ln:
            buf.append(ln)
        elif buf:
            parts.append(' '.join(buf))
            buf = []
    if buf:
        parts.append(' '.join(buf))
    return '\n'.join(parts).strip()


def main(path):
    doc = pymupdf.open(path)
    out = []
    for pno, page in enumerate(doc):
        vlines, hlines = collect_lines(page)
        words = page.get_text('words')
        boxes = [pymupdf.Rect(w[:4]) for w in words if w[4] in ('\u2610', '\u2612')]
        fields = []
        seen = set()

        def cell_has_checkbox(cell):
            c = pymupdf.Rect(*cell)
            return any(c.contains(b.tl) and c.contains(b.br) for b in boxes)

        def add(kind, label_rect, whole_cell):
            cell = cell_for(label_rect, vlines, hlines, page.rect)
            key = (round(cell[0]), round(cell[1]), round(cell[2]), round(cell[3]), whole_cell)
            if key in seen:
                return
            seen.add(key)
            pad = 3.0
            top = cell[1] + pad if whole_cell else label_rect.y1 + 1.5
            region = (cell[0] + pad, top, cell[2] - pad, cell[3] - pad)
            if region[3] - region[1] < 10:
                return
            fields.append({
                'kind': kind,
                'region': [round(v, 2) for v in region],
                'text': region_text(page, region),
            })

        for label in LABELS:
            for r in page.search_for(label):
                cell = cell_for(r, vlines, hlines, page.rect)
                has_box = cell_has_checkbox(cell)
                if label == 'Status description:':
                    add('status', r, whole_cell=False)
                elif has_box:
                    add('plan-desc', r, whole_cell=False)
                else:
                    add('question-desc', r, whole_cell=True)

        for r in page.search_for('End date:'):
            cell = cell_for(r, vlines, hlines, page.rect)
            if cell_has_checkbox(cell):
                continue
            region_probe = (cell[0] + 3, r.y1 + 1.5, cell[2] - 3, cell[3] - 3)
            if region_probe[3] - region_probe[1] < 10:
                continue
            # Skip title-only fragments of rows split across pages
            # (e.g. a lone "Dehydration" heading cell).
            if len(region_text(page, region_probe)) < 80:
                continue
            add('outcome', r, whole_cell=False)

        # Status-column narrative fragments that CONTINUE from a row started
        # on the previous page carry no "Status description:" label. Check the
        # topmost status-column cell of the page.
        col_sl = [x for x, *_ in vlines if 178 <= x <= 192]
        col_sr = [x for x, *_ in vlines if 468 <= x <= 485]
        if col_sl and col_sr:
            ys = sorted({round(y, 1) for y, x0, x1 in hlines if x0 <= 195 and x1 >= 465})
            for y1, y2 in zip(ys, ys[1:]):
                if y2 - y1 < 15:
                    continue
                le = [x for x, ya, yb in vlines if 178 <= x <= 192 and ya <= y1 + 3 and yb >= y2 - 3]
                ri = [x for x, ya, yb in vlines if 468 <= x <= 485 and ya <= y1 + 3 and yb >= y2 - 3]
                if le and ri:
                    cell = (max(le), y1, min(ri), y2)
                    txt = region_text(page, (cell[0] + 3, cell[1] + 3, cell[2] - 3, cell[3] - 3))
                    if (not cell_has_checkbox(cell) and txt
                            and 'Status description:' not in txt
                            and not txt.startswith('Status of outcome')):
                        fake = pymupdf.Rect(cell[0] + 3, cell[1] + 3, cell[2] - 3, cell[1] + 4)
                        add('status-cont', fake, whole_cell=True)
                break  # only the topmost row can be a continuation

        # Question-table answer cells that CONTINUE from the previous page
        # carry no label, so enumerate the right-hand column (vlines at
        # x~394 and x~568) directly; duplicates are dropped via `seen`.
        col_l = [x for x, *_ in vlines if 388 <= x <= 400]
        col_r = [x for x, *_ in vlines if 560 <= x <= 575]
        if col_l and col_r:
            ys = sorted({round(y, 1) for y, x0, x1 in hlines if x0 <= 400 and x1 >= 560})
            for y1, y2 in zip(ys, ys[1:]):
                if y2 - y1 < 25:
                    continue
                le = [x for x, ya, yb in vlines if 388 <= x <= 400 and ya <= y1 + 3 and yb >= y2 - 3]
                ri = [x for x, ya, yb in vlines if 560 <= x <= 575 and ya <= y1 + 3 and yb >= y2 - 3]
                if not le or not ri:
                    continue
                cell = (max(le), y1, min(ri), y2)
                if cell_has_checkbox(cell):
                    continue
                fake = pymupdf.Rect(cell[0] + 3, cell[1] + 3, cell[2] - 3, cell[1] + 4)
                add('question-desc', fake, whole_cell=True)

        out.append({'page': pno + 1, 'height': page.rect.height, 'fields': fields})
    json.dump(out, sys.stdout)


if __name__ == '__main__':
    main(sys.argv[1])
