import type { Form680Spec } from '../template680.js';

/**
 * The individual a form is about, as the notes refer to him or her. Derived
 * from the template's "Name:" line so every default sentence, warning and
 * file name follows the person whose template was uploaded.
 */
export interface Person {
  /** Everyday name used in prose: the quoted nickname if present, else the first name. */
  first: string;
  /** Given (formal) first name as printed, e.g. "Steven". */
  given: string;
  /** Full name as printed on the template. */
  full: string;
  /** Regex alternation matching any spelling of the name in notes (lower-case source). */
  namePattern: string;
}

const FALLBACK: Person = { first: 'the individual', given: 'the individual', full: '', namePattern: 'the individual' };

/** "Steven “Steve” Lavinus" -> Steve; "Jerrell Wright" -> Jerrell. */
export function personFromSpec(spec: Pick<Form680Spec, 'individualName'> | undefined): Person {
  const full = spec?.individualName?.trim() ?? '';
  if (!full) return FALLBACK;
  const nick = full.match(/[“"']\s*([A-Za-z][A-Za-z.'-]*)\s*[”"']/);
  const tokens = full.replace(/[“”"'].*?[“”"']/g, ' ').split(/[\s,]+/).filter((t) => /^[A-Za-z]/.test(t));
  const firstName = tokens[0] ?? '';
  const first = nick?.[1] ?? firstName ?? FALLBACK.first;
  const names = [...new Set([nick?.[1], firstName].filter((n): n is string => Boolean(n)))];
  return {
    first,
    given: firstName || first,
    full,
    // Allow trailing letters so "Steve" also covers "Steven"/"Steve's" in notes.
    namePattern: names.map((n) => escapeRegex(n.toLowerCase()) + '\\w*').join('|') || FALLBACK.namePattern,
  };
}

/** Fill "{name}" / "{Name}" / "{given}" placeholders in default wording. */
export function withName(text: string, person: Person): string {
  return text
    .replace(/\{given\}/g, person.given)
    .replace(/\{Name\}/g, capitalize(person.first))
    .replace(/\{name\}/g, person.first);
}

/** Build a regex from a source string containing "{name}" placeholders. */
export function nameRegex(source: string, person: Person, flags = 'i'): RegExp {
  return new RegExp(source.replace(/\{name\}/g, `(?:${person.namePattern})`), flags);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
