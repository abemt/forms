import AdmZip from 'adm-zip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { Document as XmlDocument, Element as XmlElement, Node as XmlNode } from '@xmldom/xmldom';
import { calendarDate } from './exportPlan.js';
import type { ProfileId } from './profiles.js';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WORD14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const CHECKS = /[\u2610\u2611\u2612]/g;

export interface QuarterlyField {
  id: string;
  group: string;
  label: string;
  type: 'text' | 'choice' | 'date';
  value: string;
  options?: string[];
}

export interface QuarterlySpec {
  individualName: string;
  fields: QuarterlyField[];
}

type Setter = (value: string) => void;

function descendants(element: XmlElement | XmlDocument, localName: string): XmlElement[] {
  return Array.from(element.getElementsByTagNameNS(WORD, localName));
}

function children(element: XmlElement, localName: string): XmlElement[] {
  return Array.from(element.childNodes).filter((child): child is XmlElement => child.nodeType === 1 && child.localName === localName && child.namespaceURI === WORD);
}

function textOf(element: XmlElement): string {
  return descendants(element, 't').map((node) => node.textContent ?? '').join('');
}

function replaceVisible(element: XmlElement, start: number, length: number, value: string): void {
  let offset = 0;
  let inserted = false;
  for (const node of descendants(element, 't')) {
    const text = node.textContent ?? '';
    const end = offset + text.length;
    if (end > start && offset < start + length) {
      const prefix = text.slice(0, Math.max(0, start - offset));
      const suffix = text.slice(Math.max(0, start + length - offset));
      node.textContent = `${prefix}${inserted ? '' : value}${suffix}`;
      node.setAttribute('xml:space', 'preserve');
      inserted = true;
    }
    offset = end;
  }
  if (!inserted) throw new Error('Quarterly metadata location could not be updated.');
}

function setParagraph(paragraph: XmlElement, value: string): void {
  const document = paragraph.ownerDocument!;
  const runProperties = descendants(paragraph, 'rPr')[0]?.cloneNode(true);
  for (const child of Array.from(paragraph.childNodes)) {
    if (!(child.nodeType === 1 && child.localName === 'pPr')) paragraph.removeChild(child);
  }
  const run = document.createElementNS(WORD, 'w:r');
  if (runProperties) run.appendChild(runProperties);
  for (const [index, line] of value.split('\n').entries()) {
    if (index) run.appendChild(document.createElementNS(WORD, 'w:br'));
    const text = document.createElementNS(WORD, 'w:t');
    text.setAttribute('xml:space', 'preserve');
    text.appendChild(document.createTextNode(line));
    run.appendChild(text);
  }
  paragraph.appendChild(run);
}

function readChoice(element: XmlElement, options: string[]): string {
  for (const paragraph of descendants(element, 'p')) {
    const text = textOf(paragraph);
    const matches = [...text.matchAll(CHECKS)];
    for (const [index, match] of matches.entries()) {
      const label = text.slice(match.index! + 1, matches[index + 1]?.index).trim();
      const option = options.find((candidate) => label.toLowerCase().startsWith(candidate.toLowerCase()));
      if (option && match[0] !== '\u2610') return option;
    }
  }
  return '';
}

function setChoice(element: XmlElement, options: string[], value: string): void {
  const paragraphs = element.localName === 'p' ? [element] : descendants(element, 'p');
  for (const paragraph of paragraphs) {
    const text = textOf(paragraph);
    const matches = [...text.matchAll(CHECKS)];
    const states = matches.map((match, index) => {
      const label = text.slice(match.index! + 1, matches[index + 1]?.index).trim();
      const option = options.find((candidate) => label.toLowerCase().startsWith(candidate.toLowerCase()));
      return option ? option === value : undefined;
    });
    let cursor = 0;
    for (const node of descendants(paragraph, 't')) {
      node.textContent = (node.textContent ?? '').replace(CHECKS, (glyph) => {
        const state = states[cursor++];
        if (state === undefined) return glyph;
        let parent: XmlNode | null = node.parentNode;
        while (parent && parent !== paragraph) {
          if (parent.nodeType === 1 && parent.localName === 'sdt') {
            for (const checked of Array.from((parent as XmlElement).getElementsByTagNameNS(WORD14, 'checked'))) checked.setAttributeNS(WORD14, 'w14:val', state ? '1' : '0');
            break;
          }
          parent = parent.parentNode;
        }
        return state ? '\u2612' : '\u2610';
      });
    }
  }
}

function keepTogether(row: XmlElement): void {
  const document = row.ownerDocument!;
  let properties = children(row, 'trPr')[0];
  if (!properties) {
    properties = document.createElementNS(WORD, 'w:trPr');
    const anchor = Array.from(row.childNodes).find((child): child is XmlElement => child.nodeType === 1 && child.localName !== 'tblPrEx') ?? null;
    row.insertBefore(properties, anchor);
  }
  if (!children(properties, 'cantSplit').length) properties.insertBefore(document.createElementNS(WORD, 'w:cantSplit'), properties.firstChild);
}

function narrative(cell: XmlElement, marker: RegExp): { value: string; set: Setter } {
  const paragraphs = descendants(cell, 'p');
  const anchor = paragraphs.findIndex((paragraph) => marker.test(textOf(paragraph).trim()));
  if (anchor < 0) throw new Error('Quarterly narrative label is missing.');
  const original = textOf(paragraphs[anchor]);
  const colon = original.indexOf(':');
  const prefix = original.slice(0, colon + 1);
  const value = [original.slice(colon + 1).trim(), ...paragraphs.slice(anchor + 1).map(textOf)].filter((text) => text.trim()).join('\n');
  return {
    value,
    set: (updated) => {
      setParagraph(paragraphs[anchor], prefix);
      let target = paragraphs[anchor + 1];
      if (!target) {
        target = cell.ownerDocument!.createElementNS(WORD, 'w:p');
        cell.appendChild(target);
      }
      setParagraph(target, updated);
      for (const paragraph of paragraphs.slice(anchor + 2)) setParagraph(paragraph, '');
    },
  };
}

function dateFromPrint(value: string): string {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const iso = match ? `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}` : value;
  if (!calendarDate(iso)) throw new Error(`Invalid quarterly date: ${value}`);
  return iso;
}

function dateForPrint(value: string): string {
  if (!calendarDate(value)) throw new Error('Use a valid quarterly date.');
  const [year, month, day] = value.split('-');
  return `${Number(month)}/${Number(day)}/${year}`;
}

function loadQuarterly(bytes: Uint8Array, profile: ProfileId) {
  const zip = new AdmZip(Buffer.from(bytes));
  const entries = zip.getEntries();
  if (entries.length > 2000 || entries.reduce((total, entry) => total + entry.header.size, 0) > 100 * 1024 * 1024) throw new Error('The Word template is too large to process.');
  const documents = new Map<string, XmlDocument>();
  for (const entry of entries.filter((item) => /^word\/(?:document|header\d*)\.xml$/.test(item.entryName))) {
    const xml = entry.getData().toString('utf8');
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('XML entity declarations are not supported.');
    documents.set(entry.entryName, new DOMParser().parseFromString(xml, 'text/xml'));
  }
  const body = documents.get('word/document.xml');
  if (!body) throw new Error('Upload a valid quarterly Word (.docx) template.');
  const fields: QuarterlyField[] = [];
  const setters = new Map<string, Setter>();
  const add = (field: QuarterlyField, set: Setter) => { fields.push(field); setters.set(field.id, set); };
  let individualName = '';
  for (const document of documents.values()) {
    for (const paragraph of descendants(document, 'p')) {
      const text = textOf(paragraph);
      const period = text.match(/quarterly review covers information from\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+through\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
      if (!period) continue;
      individualName = text.slice(0, text.search(CHECKS)).trim();
      const expected = profile === 'jerrell' ? /\bJerrell\b/i : /\bSteve(?:n)?\b/i;
      if (!expected.test(individualName)) throw new Error(`The quarterly template does not identify ${profile === 'jerrell' ? 'Jerrell' : 'Steven'}. Upload the correct person's template.`);
      for (const [id, label, printed] of [['periodStart', 'Reporting period start', period[1]], ['periodEnd', 'Reporting period end', period[2]]]) {
        add({ id, label, group: 'Reporting Period', type: 'date', value: dateFromPrint(printed) }, (value) => {
          const current = textOf(paragraph);
          const currentPeriod = current.match(/from\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+through\s+(\d{1,2}\/\d{1,2}\/\d{4})/i)!;
          const target = currentPeriod[id === 'periodStart' ? 1 : 2];
          const position = id === 'periodStart' ? current.indexOf(target, currentPeriod.index) : current.lastIndexOf(target);
          replaceVisible(paragraph, position, target.length, dateForPrint(value));
        });
      }
      const options = ['1st', '2nd', '3rd', '4th'];
      const container = paragraph.parentNode as XmlElement;
      add({ id: 'quarter', label: 'Quarter', group: 'Reporting Period', type: 'choice', options, value: readChoice(container, options) }, (value) => setChoice(paragraph, options, value));
    }
  }
  if (!individualName) throw new Error('No quarterly reporting-period header was found. Use the residential quarterly Word form.');
  for (const [index, row] of descendants(body, 'tr').entries()) {
    const cells = children(row, 'tc');
    if (cells.length === 3 && /Status description:/i.test(textOf(cells[1]))) {
      const titleParagraphs = descendants(cells[0], 'p').map(textOf).map((text) => text.trim()).filter(Boolean);
      const checkedSupport = titleParagraphs.find((text) => /^[\u2611\u2612]/.test(text) && !/Risk/.test(text));
      const title = checkedSupport?.replace(CHECKS, '').trim() ?? titleParagraphs.find((text) => !/^(Start date:|End date:|Select current)/i.test(text)) ?? `Support ${index}`;
      const group = title.slice(0, 220);
      const options = ['Achieved', 'On track', 'Limited or no progress'];
      add({ id: `row${index}.status`, label: 'Status', group, type: 'choice', options, value: readChoice(cells[1], options) }, (value) => setChoice(cells[1], options, value));
      const summary = narrative(cells[1], /^Status description:/i);
      add({ id: `row${index}.summary`, label: 'Status description', group, type: 'text', value: summary.value }, summary.set);
      const change = narrative(cells[2], /^If yes, describe:/i);
      add({ id: `row${index}.change`, label: 'Plan change needed?', group, type: 'choice', options: ['Yes', 'No'], value: readChoice(cells[2], ['Yes', 'No']) }, (value) => setChoice(cells[2], ['Yes', 'No'], value));
      add({ id: `row${index}.changeText`, label: 'Plan change description', group, type: 'text', value: change.value }, change.set);
    } else if (cells.length === 4 && /Yes/.test(textOf(cells[2])) && /No/.test(textOf(cells[2]))) {
      const group = textOf(cells[1]).trim();
      const explanation = narrative(cells[3], /:/);
      add({ id: `row${index}.answer`, label: 'Answer', group, type: 'choice', options: ['Yes', 'No'], value: readChoice(cells[2], ['Yes', 'No']) }, (value) => setChoice(cells[2], ['Yes', 'No'], value));
      // Short question rows split across pages once the explanation is filled in.
      add({ id: `row${index}.explanation`, label: 'Explanation', group, type: 'text', value: explanation.value }, (value) => { explanation.set(value); keepTogether(row); });
    }
  }
  for (const [index, paragraph] of descendants(body, 'p').entries()) {
    if (/^Completed by:/i.test(textOf(paragraph).trim())) add({ id: `completion${index}`, label: 'Completed by / signature / date', group: 'Completion', type: 'text', value: textOf(paragraph) }, (value) => setParagraph(paragraph, value));
  }
  if (!fields.some((field) => field.id.endsWith('.summary'))) throw new Error('No quarterly status-description cells were found.');
  return { zip, documents, spec: { individualName, fields }, setters };
}

export function inspectQuarterly(bytes: Uint8Array, profile: ProfileId): QuarterlySpec {
  return loadQuarterly(bytes, profile).spec;
}

export function fillQuarterly(bytes: Uint8Array, profile: ProfileId, values: Record<string, string>): Uint8Array {
  const { zip, documents, spec, setters } = loadQuarterly(bytes, profile);
  const known = new Map(spec.fields.map((field) => [field.id, field]));
  for (const [id, value] of Object.entries(values)) {
    const field = known.get(id);
    if (!field) throw new Error(`Unknown quarterly field: ${id}`);
    if (value.length > 20_000) throw new Error('A quarterly field is too long.');
    if (field.type === 'date' && !calendarDate(value)) throw new Error(`Invalid date: ${field.label}`);
    if (field.type === 'choice' && value && !field.options!.includes(value)) throw new Error(`Invalid choice: ${field.label}`);
  }
  const start = values.periodStart ?? known.get('periodStart')!.value;
  const end = values.periodEnd ?? known.get('periodEnd')!.value;
  if (start > end) throw new Error('Reporting period start must not follow end.');
  let changed = false;
  for (const field of spec.fields) {
    if (values[field.id] === undefined || values[field.id] === field.value) continue;
    setters.get(field.id)!(values[field.id]);
    changed = true;
  }
  if (!changed) return bytes;
  const serializer = new XMLSerializer();
  for (const [name, document] of documents) zip.updateFile(name, Buffer.from(serializer.serializeToString(document), 'utf8'));
  return new Uint8Array(zip.toBuffer());
}