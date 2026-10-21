import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Eye, PenLine, Play, Plus, RotateCcw, Save, Settings2, Trash2 } from 'lucide-react';
import type { ProfileId, RoutineLevel, WriterBox, WriterDraft, WriterEvent, WriterEventKind, WriterPreview, WriterSettings } from '../types';
import { createWriterJob, downloadWriterWorkbook, getWriterDraft, getWriterSettings, previewWriterDraft, saveWriterDraft, saveWriterSettings } from '../api';

interface Props {
  onJobCreated: (id: string) => void;
  initial?: { profileId: ProfileId; month: string };
}

const KINDS: { value: WriterEventKind; label: string; place: string; hint: string }[] = [
  { value: 'outing', label: 'Outing (park, beach, church, event)', place: 'Where', hint: 'What he did there, e.g. "he walked the trail and enjoyed the fresh air"' },
  { value: 'meal_out', label: 'Meal out (restaurant)', place: 'Restaurant', hint: 'e.g. "he ordered a grilled chicken sandwich and chose water"' },
  { value: 'shopping', label: 'Shopping', place: 'Store', hint: 'What he bought / how he paid' },
  { value: 'appointment', label: 'Appointment (medical, dental, other)', place: 'Type, e.g. physical examination', hint: 'Provider and outcome, e.g. "the doctor completed the exam and a TB screening test was done"' },
  { value: 'visit', label: 'Visitor at the house', place: 'Who visited', hint: 'What they did' },
  { value: 'away', label: 'Away (family visit / not at the house)', place: 'With whom', hint: 'Optional detail, e.g. "picked up at 10:00 AM"' },
  { value: 'holiday', label: 'Program closed (holiday)', place: 'Holiday name', hint: 'Optional extra sentence' },
  { value: 'home', label: 'Home day (did not attend the program)', place: '', hint: 'Optional sentence, e.g. "Steve spent the day relaxing at home"' },
  { value: 'cooked', label: 'Cooked a meal', place: 'What he cooked', hint: 'e.g. "he portioned his plate and cleaned up"' },
  { value: 'laundry', label: 'Laundry', place: '', hint: 'Optional, e.g. "and folded everything on his own"' },
  { value: 'chore', label: 'Chore / house task', place: '', hint: 'e.g. "vacuumed the living room and wiped the counters"' },
  { value: 'incident', label: 'Incident or behavior (exact wording)', place: '', hint: 'Write exactly what happened; the form will flag it for review' },
  { value: 'note', label: 'Other note (exact wording)', place: '', hint: 'One or two plain sentences, written as they should appear' },
];
const SHIFTS: { value: WriterEvent['shift']; label: string }[] = [
  { value: 'auto', label: 'Let the app place it' },
  { value: 'day', label: 'Day 8am-4pm' },
  { value: 'evening', label: 'Evening 4pm-12am' },
  { value: 'night', label: 'Overnight 12am-8am' },
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PROFILE_NAMES: Record<ProfileId, string> = { steven: 'Steven (Steve)', jerrell: 'Jerrell Wright' };
const LEVELS: { value: RoutineLevel; label: string }[] = [
  { value: 'essentials', label: 'Reported details + review flags for scheduled care without completion evidence' },
  { value: 'full', label: 'Reported details + review flags for all configured routine schedules' },
  { value: 'none', label: 'Only what was reported' },
];
const SOURCE_STYLE: Record<WriterBox['lines'][number]['source'], string> = {
  voice: 'border-l-4 border-emerald-500 bg-emerald-50',
  event: 'border-l-4 border-indigo-500 bg-indigo-50',
  routine: 'border-l-4 border-slate-300',
  edited: 'border-l-4 border-amber-400 bg-amber-50',
};
const isVoiceEvent = (e: WriterEvent) => e.kind === 'voice' || Boolean(e.source?.startsWith('voice:'));

const newId = () => Math.random().toString(36).slice(2, 10);
const daysIn = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

export function LogWriterScreen({ onJobCreated, initial }: Props) {
  const [profileId, setProfileId] = useState<ProfileId>(initial?.profileId ?? 'steven');
  const [month, setMonth] = useState(() => initial?.month ?? new Date().toISOString().slice(0, 7));
  const [draft, setDraft] = useState<WriterDraft>();
  const [settings, setSettings] = useState<WriterSettings>();
  const [showSettings, setShowSettings] = useState(false);
  const [showSources, setShowSources] = useState(true);
  const [showVoiceEvents, setShowVoiceEvents] = useState(false);
  const [preview, setPreview] = useState<WriterPreview>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const total = daysIn(month);

  useEffect(() => {
    setPreview(undefined);
    setError(undefined);
    let cancelled = false;
    Promise.all([getWriterDraft(profileId, month), getWriterSettings(profileId)])
      .then(([loaded, loadedSettings]) => {
        if (cancelled) return;
        setDraft({ ...loaded, toDay: Math.min(loaded.toDay, daysIn(month)) });
        setSettings(loadedSettings);
      })
      .catch((reason: Error) => !cancelled && setError(reason.message));
    return () => {
      cancelled = true;
    };
  }, [profileId, month]);

  const update = useCallback((patch: Partial<WriterDraft>) => setDraft((prev) => (prev ? { ...prev, ...patch } : prev)), []);
  const updateEvent = (id: string, patch: Partial<WriterEvent>) => update({ events: draft!.events.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  const addEvent = () => {
    const last = draft!.events.at(-1);
    update({ events: [...draft!.events, { id: newId(), day: last?.day ?? draft!.fromDay, shift: 'auto', kind: 'outing', place: '', details: '', withHousemate: false, mood: '' }] });
  };

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setError(undefined);
    setNotice(undefined);
    try {
      await action();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const sortedDraft = useMemo(() => (draft ? { ...draft, events: [...draft.events].sort((a, b) => a.day - b.day) } : undefined), [draft]);

  const doPreview = () => run('preview', async () => setPreview(await previewWriterDraft(sortedDraft!)));
  const doSave = () =>
    run('save', async () => {
      await saveWriterDraft(sortedDraft!);
      setNotice('Draft saved. You can add the next report later and continue from here.');
    });
  const doDownload = () =>
    run('download', async () => {
      await saveWriterDraft(sortedDraft!);
      const { blob, filename } = await downloadWriterWorkbook(sortedDraft!);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    });
  const doCreateJob = () =>
    run('job', async () => {
      const { id } = await createWriterJob(sortedDraft!);
      onJobCreated(id);
    });
  const doSaveSettings = () =>
    run('settings', async () => {
      setSettings(await saveWriterSettings(profileId, settings!));
      setNotice('Routine settings saved for this individual.');
      setPreview(undefined);
    });

  const setOverride = (box: WriterBox, patch: { mood?: string; notes?: string }) => {
    const key = `${box.day}|${box.shift}`;
    const current = draft!.overrides[key] ?? {};
    update({ overrides: { ...draft!.overrides, [key]: { mood: patch.mood ?? current.mood ?? box.mood, notes: patch.notes ?? current.notes ?? box.notes } } });
    setPreview((prev) => prev && { ...prev, boxes: prev.boxes.map((b) => (b.day === box.day && b.shift === box.shift ? { ...b, ...patch, edited: true } : b)) });
  };
  const clearOverride = (box: WriterBox) => {
    const next = { ...draft!.overrides };
    delete next[`${box.day}|${box.shift}`];
    update({ overrides: next });
    setPreview(undefined);
  };

  if (!draft || !settings) return <div className="card p-8 text-sm text-slate-500">{error ?? 'Loading…'}</div>;

  const days = Array.from({ length: total }, (_, i) => i + 1);
  const byDay = new Map<number, WriterBox[]>();
  for (const box of preview?.boxes ?? []) byDay.set(box.day, [...(byDay.get(box.day) ?? []), box]);
  const warningCount = preview?.boxes.reduce((n, b) => n + b.warnings.length, 0) ?? 0;
  const manualEvents = draft.events.filter((e) => !isVoiceEvent(e));
  const voiceEvents = draft.events.filter(isVoiceEvent);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900"><PenLine size={18} /> Log writer</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              Type the key events the house manager reports (a day, a week or a month at a time). The app writes the full Daily Log Entry
              workbook — every shift box filled with the person's normal routine plus your events — so you can review it, download it, or
              turn it straight into Form §680 daily notes.
            </p>
          </div>
          <button className="btn-secondary" onClick={() => setShowSettings((v) => !v)}><Settings2 size={16} />Routine settings</button>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-sm font-medium">Individual<select className="input mt-1" value={profileId} onChange={(e) => setProfileId(e.target.value as ProfileId)}>{(Object.keys(PROFILE_NAMES) as ProfileId[]).map((id) => <option key={id} value={id}>{PROFILE_NAMES[id]}</option>)}</select></label>
          <label className="block text-sm font-medium">Month<input className="input mt-1" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></label>
          <label className="block text-sm font-medium">Write from day<input className="input mt-1" type="number" min={1} max={total} value={draft.fromDay} onChange={(e) => update({ fromDay: Math.max(1, Math.min(total, Number(e.target.value) || 1)) })} /></label>
          <label className="block text-sm font-medium">Through day (last reported)<input className="input mt-1" type="number" min={draft.fromDay} max={total} value={draft.toDay} onChange={(e) => update({ toDay: Math.max(draft.fromDay, Math.min(total, Number(e.target.value) || draft.fromDay)) })} /></label>
        </div>
        <p className="mt-2 text-xs text-slate-500">Only days {draft.fromDay}–{draft.toDay} are written. Days after the last report stay empty until the next report arrives — nothing is invented for the future.</p>

        <label className="mt-4 block text-sm font-medium">
          How much routine wording to add around the reported details
          <select className="input mt-1" value={draft.routineLevel ?? 'full'} onChange={(e) => update({ routineLevel: e.target.value as RoutineLevel })}>{LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}</select>
        </label>

        <label className="mt-5 block text-sm font-medium">
          Report as received (optional, kept with the draft for reference)
          <textarea className="input mt-1 h-24 font-mono text-xs" placeholder="Paste the house manager's message here so the wording you were given is on record…" value={draft.sourceNotes} onChange={(e) => update({ sourceNotes: e.target.value })} />
        </label>
      </div>

      {showSettings && <SettingsPanel settings={settings} onChange={setSettings} onSave={doSaveSettings} busy={busy === 'settings'} name={PROFILE_NAMES[profileId]} />}

      <div className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-slate-900">Program closures</h3>
          <button className="btn-secondary" onClick={() => update({ closures: [...draft.closures, { day: draft.fromDay, reason: '' }] })}><Plus size={16} />Add closure</button>
        </div>
        <p className="mt-1 text-sm text-slate-500">Holidays or days the day program was closed. Those days are written as home days.</p>
        {draft.closures.length > 0 && (
          <div className="mt-3 space-y-2">
            {draft.closures.map((closure, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <select className="input w-40" value={closure.day} onChange={(e) => update({ closures: draft.closures.map((c, j) => (i === j ? { ...c, day: Number(e.target.value) } : c)) })}>{days.map((d) => <option key={d} value={d}>{month}-{String(d).padStart(2, '0')}</option>)}</select>
                <input className="input flex-1" placeholder="Reason, e.g. Labor Day" value={closure.reason} onChange={(e) => update({ closures: draft.closures.map((c, j) => (i === j ? { ...c, reason: e.target.value } : c)) })} />
                <button className="btn-secondary" aria-label="Remove closure" onClick={() => update({ closures: draft.closures.filter((_, j) => j !== i) })}><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-slate-900">Key events ({manualEvents.length})</h3>
          <button className="btn-secondary" onClick={addEvent}><Plus size={16} />Add event</button>
        </div>
        <p className="mt-1 text-sm text-slate-500">One row per thing that happened. Unreported routine categories stay out of the notes and appear as review flags when their schedule is configured. Write details as plain sentences without "he said he would like to" or "talked about" — the app warns about wording the form misreads.</p>
        <div className="mt-4 space-y-3">
          {manualEvents.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">No typed events{voiceEvents.length ? ' — the voice-note sentences below are used' : ' yet — the month would be written entirely from the routine'}.</p>}
          {manualEvents.map((ev) => {
            const kind = KINDS.find((k) => k.value === ev.kind) ?? KINDS[KINDS.length - 1];
            return (
              <div key={ev.id} className="rounded-xl border border-slate-200 p-3">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
                  <label className="text-xs font-medium text-slate-600">Day<select className="input mt-1" value={ev.day} onChange={(e) => updateEvent(ev.id, { day: Number(e.target.value) })}>{days.map((d) => <option key={d} value={d}>{String(d).padStart(2, '0')} {WEEKDAYS[new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, d)).getUTCDay()]}</option>)}</select></label>
                  <label className="text-xs font-medium text-slate-600">Shift<select className="input mt-1" value={ev.shift} onChange={(e) => updateEvent(ev.id, { shift: e.target.value as WriterEvent['shift'] })}>{SHIFTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
                  <label className="text-xs font-medium text-slate-600 lg:col-span-2">Type<select className="input mt-1" value={ev.kind} onChange={(e) => updateEvent(ev.id, { kind: e.target.value as WriterEventKind })}>{KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select></label>
                  {(ev.kind === 'meal_out' || ev.kind === 'cooked') && <label className="text-xs font-medium text-slate-600">Meal<select className="input mt-1" value={ev.meal ?? (ev.kind === 'cooked' ? 'dinner' : 'lunch')} onChange={(e) => updateEvent(ev.id, { meal: e.target.value as WriterEvent['meal'] })}><option value="breakfast">Breakfast</option><option value="lunch">Lunch</option><option value="dinner">Dinner</option></select></label>}
                  <label className="text-xs font-medium text-slate-600">Mood (optional)<input className="input mt-1" placeholder="e.g. Happy, Excited" value={ev.mood} onChange={(e) => updateEvent(ev.id, { mood: e.target.value })} /></label>
                </div>
                <div className="mt-2 grid gap-2 lg:grid-cols-3">
                  {kind.place && <label className="text-xs font-medium text-slate-600">{kind.place}<input className="input mt-1" value={ev.place} onChange={(e) => updateEvent(ev.id, { place: e.target.value })} /></label>}
                  <label className={`text-xs font-medium text-slate-600 ${kind.place ? 'lg:col-span-2' : 'lg:col-span-3'}`}>Details<input className="input mt-1" placeholder={kind.hint} value={ev.details} onChange={(e) => updateEvent(ev.id, { details: e.target.value })} /></label>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  {settings.housemate ? <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={ev.withHousemate} onChange={(e) => updateEvent(ev.id, { withHousemate: e.target.checked })} />{settings.housemate} was along</label> : <span />}
                  <button className="text-xs font-medium text-rose-700 hover:underline" onClick={() => update({ events: draft.events.filter((e) => e.id !== ev.id) })}><Trash2 className="mr-1 inline" size={13} />Remove</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {voiceEvents.length > 0 && (
        <div className="card p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-slate-900">From voice notes and pasted reports ({voiceEvents.filter((e) => e.kind === 'voice').length} shift boxes)</h3>
            <button className="btn-secondary" onClick={() => setShowVoiceEvents((v) => !v)}>{showVoiceEvents ? 'Hide' : 'Show'}</button>
          </div>
          <p className="mt-1 text-sm text-slate-500">Written by the Voice notes tab. To change them, edit the note there and send it again; hand edits of a box below also work.</p>
          {showVoiceEvents && (
            <div className="mt-3 space-y-2">
              {voiceEvents.map((ev) => (
                <div key={ev.id} className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
                  <p className="text-xs font-semibold text-emerald-900">{month}-{String(ev.day).padStart(2, '0')} · {ev.kind === 'voice' ? SHIFTS.find((s) => s.value === ev.shift)?.label : ev.kind === 'home' ? 'home day' : 'went to the program'}{ev.mood && ` · mood: ${ev.mood}`}</p>
                  {ev.details && <p className="mt-1 whitespace-pre-line text-slate-800">{ev.details}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="card p-6">
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={Boolean(busy)} onClick={doPreview}><Eye size={16} />{busy === 'preview' ? 'Writing…' : 'Preview the month'}</button>
          <button className="btn-secondary" disabled={Boolean(busy)} onClick={doSave}><Save size={16} />{busy === 'save' ? 'Saving…' : 'Save draft'}</button>
          <button className="btn-secondary" disabled={Boolean(busy)} onClick={doDownload}><Download size={16} />{busy === 'download' ? 'Building…' : 'Download workbook (.docx)'}</button>
          <button className="btn-primary" disabled={Boolean(busy)} onClick={doCreateJob}><Play size={16} />{busy === 'job' ? 'Starting…' : 'Create daily report from this'}</button>
        </div>
        <p className="mt-2 text-xs text-slate-500">"Create daily report" writes the workbook, saves the draft and starts the normal analyze → review → export flow. Unsupported fields remain for staff review instead of receiving invented routine defaults.</p>
        {notice && <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
        {error && <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800" role="alert">{error}</p>}
      </div>

      {preview && (
        <div className="space-y-4">
          <div className="card p-6">
            <h3 className="text-base font-semibold text-slate-900">{preview.individualName} — {preview.monthName} {preview.fromDay}–{preview.toDay}, {preview.year} · {preview.boxes.length} shift boxes{warningCount > 0 && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">{warningCount} wording warning{warningCount === 1 ? '' : 's'}</span>}</h3>
            {preview.assumptions.length > 0 && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-semibold">Assumptions to confirm with the house manager</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">{preview.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
              </div>
            )}
            <p className="mt-3 text-xs text-slate-500">Edit any box directly below; edits are saved with the draft and used for the workbook. "Reset" returns a box to the generated wording.</p>
            <label className="mt-2 flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={showSources} onChange={(e) => setShowSources(e.target.checked)} />Show where each line came from: <span className="rounded bg-emerald-100 px-1">green = her report</span> <span className="rounded bg-indigo-100 px-1">blue = typed event</span> <span className="rounded bg-slate-100 px-1">grey = routine</span> <span className="rounded bg-amber-100 px-1">yellow = your edit</span></label>
          </div>
          {[...byDay.entries()].map(([day, boxes]) => (
            <div key={day} className="card p-5">
              <h4 className="text-sm font-bold text-slate-800">{boxes[0].date} ({boxes[0].weekday})</h4>
              <div className="mt-3 grid gap-4 lg:grid-cols-3">
                {boxes.map((box) => (
                  <div key={box.shift} className={`rounded-xl border p-3 ${box.warnings.length ? 'border-amber-300' : box.edited ? 'border-indigo-300' : 'border-slate-200'}`}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-700">{box.shiftLabel} · {box.provider.replace(/,\s*DSP$/, '')}</span>
                      <span className="text-slate-400">{box.voiceLines > 0 && `${box.voiceLines} reported`}{box.eventLines > 0 && ` ${box.eventLines} event`}{box.edited && ' · edited'}</span>
                    </div>
                    <label className="mt-2 block text-xs font-medium text-slate-600">Observed mood<input className="input mt-1" value={box.mood} onChange={(e) => setOverride(box, { mood: e.target.value })} /></label>
                    {showSources && !box.edited ? (
                      <div className="mt-2 space-y-1">
                        <p className="text-xs font-medium text-slate-600">Notes <button className="ml-1 font-normal text-indigo-700 hover:underline" onClick={() => setOverride(box, { notes: box.notes })}>edit</button></p>
                        {box.lines.map((line, i) => <p key={i} className={`rounded px-2 py-1 text-xs leading-relaxed text-slate-800 ${SOURCE_STYLE[line.source]}`}>{line.text}</p>)}
                      </div>
                    ) : (
                      <label className="mt-2 block text-xs font-medium text-slate-600">Notes<textarea className="input mt-1 h-56 text-xs leading-relaxed" value={box.notes} onChange={(e) => setOverride(box, { notes: e.target.value })} /></label>
                    )}
                    {box.warnings.length > 0 && <ul className="mt-2 space-y-1 text-xs text-amber-800">{box.warnings.map((w) => <li key={w}>⚠ {w}</li>)}</ul>}
                    {box.edited && <button className="mt-2 text-xs font-medium text-indigo-700 hover:underline" onClick={() => clearOverride(box)}><RotateCcw className="mr-1 inline" size={12} />Reset to routine</button>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsPanel({ settings, onChange, onSave, busy, name }: { settings: WriterSettings; onChange: (s: WriterSettings) => void; onSave: () => void; busy: boolean; name: string }) {
  const set = (patch: Partial<WriterSettings>) => onChange({ ...settings, ...patch });
  const toggleDay = (list: number[], day: number) => (list.includes(day) ? list.filter((d) => d !== day) : [...list, day].sort());
  const rosterField = (key: keyof WriterSettings['roster'], label: string) => (
    <label className="text-xs font-medium text-slate-600">{label}<input className="input mt-1" value={settings.roster[key]} onChange={(e) => set({ roster: { ...settings.roster, [key]: e.target.value } })} /></label>
  );
  return (
    <div className="card p-6">
      <h3 className="text-base font-semibold text-slate-900">Routine settings — {name}</h3>
      <p className="mt-1 text-sm text-slate-500">The normal schedule the writer fills in around your events. Staff names go on every shift box; the form signatures follow the names in the signatures folder.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rosterField('weekdayDay', 'Weekday 8am-4pm staff')}
        {rosterField('weekdayEvening', 'Weekday 4pm-12am staff')}
        {rosterField('weekdayNight', 'Weekday 12am-8am staff')}
        {rosterField('weekendDay', 'Weekend 8am-4pm staff')}
        {rosterField('weekendEvening', 'Weekend 4pm-12am staff')}
        {rosterField('weekendNight', 'Weekend 12am-8am staff')}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs font-medium text-slate-600 lg:col-span-2">Day program name<input className="input mt-1" placeholder="e.g. Inner Vision Day Support" value={settings.program.name} onChange={(e) => set({ program: { ...settings.program, name: e.target.value } })} /></label>
        <label className="text-xs font-medium text-slate-600">Leaves at<input className="input mt-1" value={settings.program.leaveTime} onChange={(e) => set({ program: { ...settings.program, leaveTime: e.target.value } })} /></label>
        <label className="text-xs font-medium text-slate-600">Back at<input className="input mt-1" value={settings.program.returnTime} onChange={(e) => set({ program: { ...settings.program, returnTime: e.target.value } })} /></label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
        <label className="flex items-center gap-2 font-medium text-slate-700"><input type="checkbox" checked={settings.program.attends} onChange={(e) => set({ program: { ...settings.program, attends: e.target.checked } })} />Attends the program (off = enrollment pending, stays home)</label>
        <span className="font-medium text-slate-600">Program days:</span>
        {WEEKDAYS.map((label, day) => <label key={day} className="flex items-center gap-1"><input type="checkbox" checked={settings.program.days.includes(day)} onChange={() => set({ program: { ...settings.program, days: toggleDay(settings.program.days, day) } })} />{label}</label>)}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs font-medium text-slate-600">Housemate's everyday name<input className="input mt-1" placeholder="blank = lives alone" value={settings.housemate} onChange={(e) => set({ housemate: e.target.value })} /></label>
        <label className="text-xs font-medium text-slate-600">Laundry day<select className="input mt-1" value={settings.laundryDay ?? ''} onChange={(e) => set({ laundryDay: e.target.value === '' ? null : Number(e.target.value) })}><option value="">No fixed day</option>{WEEKDAYS.map((label, day) => <option key={day} value={day}>{label}</option>)}</select></label>
        <label className="text-xs font-medium text-slate-600">Morning medications<input className="input mt-1" value={settings.medTimes.morning} onChange={(e) => set({ medTimes: { ...settings.medTimes, morning: e.target.value } })} /></label>
        <label className="text-xs font-medium text-slate-600">Evening medications<input className="input mt-1" value={settings.medTimes.evening} onChange={(e) => set({ medTimes: { ...settings.medTimes, evening: e.target.value } })} /></label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
        <span className="font-medium text-slate-600">Housemate's program days:</span>
        {WEEKDAYS.map((label, day) => <label key={day} className="flex items-center gap-1"><input type="checkbox" checked={settings.housemateProgramDays.includes(day)} onChange={() => set({ housemateProgramDays: toggleDay(settings.housemateProgramDays, day) })} />{label}</label>)}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs">
        <label className="flex items-center gap-2"><input type="checkbox" checked={settings.weekly.fridayMeeting} onChange={(e) => set({ weekly: { ...settings.weekly, fridayMeeting: e.target.checked } })} />Friday house meeting</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={settings.weekly.sundayMoney} onChange={(e) => set({ weekly: { ...settings.weekly, sundayMoney: e.target.checked } })} />Sunday savings / money check</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={settings.weekly.saturdayGrocery} onChange={(e) => set({ weekly: { ...settings.weekly, saturdayGrocery: e.target.checked } })} />Saturday grocery shopping</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={settings.health.seizureChecks} onChange={(e) => set({ health: { ...settings.health, seizureChecks: e.target.checked } })} />Overnight seizure checks</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={settings.health.diabetes} onChange={(e) => set({ health: { ...settings.health, diabetes: e.target.checked } })} />Diabetic diet reminders</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={settings.health.gout} onChange={(e) => set({ health: { ...settings.health, gout: e.target.checked } })} />Gout reminders</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={settings.health.bowelWatch} onChange={(e) => set({ health: { ...settings.health, bowelWatch: e.target.checked } })} />Bowel-regularity reminders</label>
      </div>
      <label className="mt-4 block text-xs font-medium text-slate-600">Interests (comma separated, used for free-time lines)<input className="input mt-1" value={settings.interests.join(', ')} onChange={(e) => set({ interests: e.target.value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12) })} /></label>
      <label className="mt-3 block text-xs font-medium text-slate-600">Name aliases (other spellings in voice notes and messages, comma separated)<input className="input mt-1" value={(settings.aliases ?? []).join(', ')} onChange={(e) => set({ aliases: e.target.value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20) })} /></label>
      <div className="mt-4 flex justify-end"><button className="btn-primary" disabled={busy} onClick={onSave}><Save size={16} />{busy ? 'Saving…' : 'Save settings'}</button></div>
    </div>
  );
}
