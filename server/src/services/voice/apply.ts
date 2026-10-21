import { buildDefaultDraft, loadDraft, loadSettings, personForProfile, saveDraft, slotsForTopics } from '../logWriter/writer.js';
import type { ShiftKind, WriterDraft, WriterEvent } from '../logWriter/types.js';
import { PROFILES, type ProfileId } from '../profiles.js';
import { classifySentence, parseTranscript, textFor, type VoiceItem, type VoicePerson } from './parse.js';
import { getNote, loadVoiceSettings, transcriptOf, updateNote, withParse, type VoiceNote } from './store.js';

/** The individuals voice notes can be about, with the spellings to recognise. */
export async function voicePeople(): Promise<VoicePerson[]> {
  return Promise.all(
    PROFILES.map(async (profile) => {
      const [settings, { person }] = await Promise.all([loadSettings(profile.id), personForProfile(profile.id)]);
      const aliases = [...new Set([person.given, ...settings.aliases])].filter((alias) => alias && alias.toLowerCase() !== person.first.toLowerCase());
      return { id: profile.id, first: person.first, aliases };
    }),
  );
}

/** (Re)reads the note's transcript into dated items. */
export async function analyzeNote(note: VoiceNote): Promise<void> {
  const [people, settings] = await Promise.all([voicePeople(), loadVoiceSettings()]);
  withParse(note, parseTranscript(transcriptOf(note), { referenceDate: note.referenceDate, people, corrections: settings.corrections }));
}

/** After a reviewer edits an item's text, its topics, moods and flags follow the new wording. */
export function reclassify(item: VoiceItem): VoiceItem {
  const { topics, moods, flags, program } = classifySentence(item.text);
  return { ...item, topics, moods, flags, ...(program && item.people.length === 1 ? { program } : { program: undefined }) };
}

const sourceOf = (note: VoiceNote) => `voice:${note.id}`;
const blockRe = (id: string) => new RegExp(`=== Voice note [^\\n]*\\[id:${id}\\] ===\\n[\\s\\S]*?\\n=== end ===\\n?`);

function upsertTranscriptBlock(sourceNotes: string, note: VoiceNote): string {
  const block = `=== Voice note ${note.fileName} - about ${note.referenceDate} [id:${note.id}] ===\n${transcriptOf(note).trim()}\n=== end ===\n`;
  if (blockRe(note.id).test(sourceNotes)) return sourceNotes.replace(blockRe(note.id), block);
  return `${sourceNotes.trimEnd()}${sourceNotes.trim() ? '\n\n' : ''}${block}`;
}

/** Writes the notes' items for one person and month into that draft; earlier output of the same notes is replaced. */
export function mergeIntoDraft(base: WriterDraft, profileId: string, notes: VoiceNote[], people: VoicePerson[], isNew: boolean): WriterDraft {
  const ids = new Set(notes.map(sourceOf));
  const events: WriterEvent[] = base.events.filter((event) => !(event.source && ids.has(event.source)));
  const days: number[] = [];
  let sourceNotes = base.sourceNotes;
  for (const note of notes) {
    const items = (note.items ?? []).filter((item) => !item.excluded && item.people.includes(profileId) && item.date.startsWith(base.month));
    if (items.length === 0) {
      sourceNotes = sourceNotes.replace(blockRe(note.id), '');
      continue;
    }
    sourceNotes = upsertTranscriptBlock(sourceNotes, note);
    const groups = new Map<string, { day: number; shift: ShiftKind; texts: string[]; topics: Set<string>; moods: string[] }>();
    const program = new Map<number, 'attended' | 'home'>();
    const group = (day: number, shift: ShiftKind) => {
      const key = `${day}|${shift}`;
      if (!groups.has(key)) groups.set(key, { day, shift, texts: [], topics: new Set(), moods: [] });
      return groups.get(key)!;
    };
    for (const item of items) {
      const day = Number(item.date.slice(8, 10));
      days.push(day);
      const g = group(day, item.shift);
      g.texts.push(textFor(item, profileId, people));
      item.topics.forEach((topic) => g.topics.add(topic));
      // "Steve played with Jerrell and he was happy": the mood is Steve's, not Jerrell's.
      const moods = !item.subject || item.subject === profileId ? item.moods : [];
      for (const mood of moods) if (!g.moods.includes(mood)) g.moods.push(mood);
      if (item.moodAllDay && item.shift === 'day') for (const mood of moods) if (!group(day, 'evening').moods.includes(mood)) group(day, 'evening').moods.push(mood);
      if (item.program && item.people.length === 1) program.set(day, program.get(day) === 'home' ? 'home' : item.program);
    }
    for (const g of groups.values()) {
      events.push({
        id: `v-${note.id.slice(0, 8)}-${g.day}-${g.shift}`,
        day: g.day,
        shift: g.shift,
        kind: 'voice',
        place: '',
        details: g.texts.join('\n'),
        withHousemate: false,
        mood: g.moods.slice(0, 3).join(', '),
        slots: slotsForTopics([...g.topics], g.shift),
        source: sourceOf(note),
      });
    }
    for (const [day, value] of program) {
      events.push({ id: `v-${note.id.slice(0, 8)}-${day}-program`, day, shift: 'day', kind: value === 'home' ? 'home' : 'program', place: '', details: '', withHousemate: false, mood: '', source: sourceOf(note) });
    }
  }
  let { fromDay, toDay } = base;
  if (days.length) {
    const min = Math.min(...days);
    const max = Math.max(...days);
    [fromDay, toDay] = isNew ? [min, max] : [Math.min(fromDay, min), Math.max(toDay, max)];
  }
  return {
    ...base,
    events: events.sort((a, b) => a.day - b.day),
    fromDay,
    toDay,
    sourceNotes,
    // Drafts built from voice notes default to scheduled care around what was reported.
    routineLevel: base.routineLevel ?? 'essentials',
  };
}

export interface AppliedDraft {
  profileId: ProfileId;
  month: string;
  fromDay: number;
  toDay: number;
  voiceEvents: number;
  days: number[];
}

/** Sends finished notes into the Log writer drafts of every person and month they mention. */
export async function applyNotes(noteIds: string[]): Promise<AppliedDraft[]> {
  const notes = await Promise.all(noteIds.map((id) => getNote(id)));
  const ready = notes.filter((note) => note.status === 'done' && note.items);
  if (ready.length === 0) throw Object.assign(new Error('None of the selected notes is transcribed yet.'), { status: 409 });
  const people = await voicePeople();
  const targets = new Set<string>();
  const perNote = new Map<string, Set<string>>();
  for (const note of ready) {
    const keys = new Set<string>();
    for (const item of note.items ?? []) {
      if (item.excluded) continue;
      for (const person of item.people) keys.add(`${person}|${item.date.slice(0, 7)}`);
    }
    perNote.set(note.id, keys);
    // Drafts that held this note before but no longer match its items get cleaned too.
    for (const key of [...keys, ...(note.appliedTo ?? [])]) targets.add(key);
  }
  const results: AppliedDraft[] = [];
  for (const key of [...targets].sort()) {
    const [profileId, month] = key.split('|') as [ProfileId, string];
    if (!PROFILES.some((profile) => profile.id === profileId)) continue;
    const existing = await loadDraft(profileId, month);
    const merged = mergeIntoDraft(existing ?? buildDefaultDraft(profileId, month), profileId, ready, people, !existing);
    await saveDraft(merged);
    const mine = merged.events.filter((event) => event.kind === 'voice');
    results.push({
      profileId,
      month,
      fromDay: merged.fromDay,
      toDay: merged.toDay,
      voiceEvents: mine.length,
      days: [...new Set(mine.map((event) => event.day))].sort((a, b) => a - b),
    });
  }
  const now = new Date().toISOString();
  for (const note of ready) {
    await updateNote(note.id, (n) => {
      n.appliedAt = now;
      n.appliedTo = [...(perNote.get(note.id) ?? [])].sort();
    });
  }
  return results.filter((result) => result.voiceEvents > 0 || [...perNote.values()].some((keys) => keys.has(`${result.profileId}|${result.month}`)));
}

/** Removes a note's sentences from every draft it was written into. */
export async function removeNoteFromDrafts(note: VoiceNote): Promise<void> {
  for (const key of note.appliedTo ?? []) {
    const [profileId, month] = key.split('|');
    const draft = await loadDraft(profileId, month);
    if (!draft) continue;
    await saveDraft({
      ...draft,
      events: draft.events.filter((event) => event.source !== sourceOf(note)),
      sourceNotes: draft.sourceNotes.replace(blockRe(note.id), ''),
    });
  }
}
