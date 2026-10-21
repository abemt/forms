import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileAudio, Mic, Play, RefreshCw, Save, Send, Settings2, Trash2, Type, Upload } from 'lucide-react';
import type { AppliedDraft, ProfileId, VoiceEngineStatus, VoiceItem, VoiceNote, VoiceNoteSummary, VoiceSettings } from '../types';
import {
  addTextReport,
  applyVoiceNotes,
  createWriterJob,
  deleteVoiceNote,
  getVoiceNote,
  getVoiceSettings,
  getVoiceStatus,
  getWriterDraft,
  listVoiceNotes,
  reanalyzeVoiceNote,
  retranscribeVoiceNote,
  saveVoiceSettings,
  updateVoiceNote,
  uploadVoiceNotes,
  voiceAudioUrl,
} from '../api';

interface Props {
  onOpenWriter: (target: { profileId: ProfileId; month: string }) => void;
  onJobCreated: (id: string) => void;
}

const PEOPLE: { id: ProfileId; name: string }[] = [
  { id: 'steven', name: 'Steve' },
  { id: 'jerrell', name: 'Jerrell' },
];
const SHIFT_LABEL: Record<VoiceItem['shift'], string> = { day: 'Day 8am-4pm', evening: 'Evening 4pm-12am', night: 'Overnight 12am-8am' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: 'auto', label: 'Automatic (best model already downloaded)' },
  { value: 'medium.en', label: 'medium.en - accurate, English (1.5 GB)' },
  { value: 'large-v3-turbo', label: 'large-v3-turbo - more accurate, needs the GPU (1.6 GB download)' },
  { value: 'large-v3', label: 'large-v3 - most accurate, needs the GPU (3 GB download)' },
  { value: 'small.en', label: 'small.en - fast, less accurate (0.5 GB download)' },
];
const ACCEPT = '.ogg,.oga,.opus,.mp3,.m4a,.mp4,.aac,.wav,.webm,.flac,.amr';

const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const fmtDuration = (seconds?: number) => (seconds ? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}` : '');
const monthLabel = (month: string) => `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
const personLabel = (people: string[]) => (people.length > 1 ? 'Both' : PEOPLE.find((p) => p.id === people[0])?.name ?? people[0]);

export function VoiceScreen({ onOpenWriter, onJobCreated }: Props) {
  const [status, setStatus] = useState<VoiceEngineStatus>();
  const [notes, setNotes] = useState<VoiceNoteSummary[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string>();
  const [open, setOpen] = useState<VoiceNote>();
  const [transcript, setTranscript] = useState('');
  const [items, setItems] = useState<VoiceItem[]>([]);
  const [itemsDirty, setItemsDirty] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [uploadDate, setUploadDate] = useState(today);
  const [textReport, setTextReport] = useState('');
  const [textDate, setTextDate] = useState(today);
  const [textTitle, setTextTitle] = useState('');
  const [applied, setApplied] = useState<AppliedDraft[]>();
  const [settings, setSettings] = useState<VoiceSettings>();
  const [showSettings, setShowSettings] = useState(false);
  const [monthFilter, setMonthFilter] = useState('all');
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const refreshList = useCallback(async () => setNotes(await listVoiceNotes()), []);
  const loadNote = useCallback(async (id: string) => {
    const note = await getVoiceNote(id);
    setOpen(note);
    setTranscript(note.editedTranscript ?? note.transcript ?? '');
    setItems(note.items ?? []);
    setItemsDirty(false);
  }, []);

  useEffect(() => {
    void getVoiceStatus().then(setStatus).catch((reason: Error) => setError(reason.message));
    void getVoiceSettings().then(setSettings).catch(() => undefined);
    void refreshList().catch((reason: Error) => setError(reason.message));
  }, [refreshList]);

  // While anything is being transcribed, keep the list (and the open note) current.
  const working = notes.some((n) => n.status === 'queued' || n.status === 'transcribing');
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => {
      void refreshList();
      void getVoiceStatus().then(setStatus);
    }, 2500);
    return () => clearInterval(timer);
  }, [working, refreshList]);
  useEffect(() => {
    if (!openId) return;
    const row = notes.find((n) => n.id === openId);
    if (row && row.status === 'done' && open && open.status !== 'done') void loadNote(openId);
  }, [notes, openId, open, loadNote]);

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

  const months = useMemo(() => [...new Set(notes.flatMap((n) => (n.dates.length ? n.dates : [n.referenceDate]).map((d) => d.slice(0, 7))))].sort(), [notes]);
  const visible = notes.filter((n) => monthFilter === 'all' || (n.dates.length ? n.dates : [n.referenceDate]).some((d) => d.startsWith(monthFilter)));
  const finishedSelected = [...selected].filter((id) => notes.find((n) => n.id === id)?.status === 'done');

  const doUpload = () =>
    run('upload', async () => {
      const created = await uploadVoiceNotes(files, uploadDate);
      setFiles([]);
      await refreshList();
      setNotice(`${created.length} voice note${created.length === 1 ? '' : 's'} added. Transcription runs in the background on this computer.`);
      void getVoiceStatus().then(setStatus);
    });
  const doAddText = () =>
    run('text', async () => {
      const note = await addTextReport(textReport, textDate, textTitle);
      setTextReport('');
      setTextTitle('');
      await refreshList();
      setOpenId(note.id);
      await loadNote(note.id);
    });
  const doApply = (ids: string[]) =>
    run('apply', async () => {
      const result = await applyVoiceNotes(ids);
      setApplied(result.drafts);
      await refreshList();
      setNotice('Sent to the Log writer. Open a draft to preview it, or create the daily report directly.');
    });
  const doCreateReport = (target: AppliedDraft) =>
    run(`job-${target.profileId}-${target.month}`, async () => {
      const draft = await getWriterDraft(target.profileId, target.month);
      const { id } = await createWriterJob(draft);
      onJobCreated(id);
    });
  const openNote = (id: string) =>
    run('open', async () => {
      setOpenId(id);
      await loadNote(id);
    });
  const saveTranscript = () =>
    run('transcript', async () => {
      if (open?.itemsEdited && !confirm('Re-reading the transcript replaces the sentence edits you made below. Continue?')) return;
      const note = await updateVoiceNote(open!.id, { transcript });
      setOpen(note);
      setItems(note.items ?? []);
      setItemsDirty(false);
      await refreshList();
    });
  const saveReferenceDate = (referenceDate: string) =>
    run('date', async () => {
      if (open?.itemsEdited && !confirm('Changing the date re-reads the note and replaces your sentence edits. Continue?')) return;
      const note = await updateVoiceNote(open!.id, { referenceDate });
      setOpen(note);
      setItems(note.items ?? []);
      setItemsDirty(false);
      await refreshList();
    });
  const saveItems = () =>
    run('items', async () => {
      const note = await updateVoiceNote(open!.id, { items });
      setOpen(note);
      setItems(note.items ?? []);
      setItemsDirty(false);
      await refreshList();
      setNotice(open?.appliedTo?.length ? 'Saved. Press "Send to Log writer" again to update the drafts.' : 'Saved.');
    });
  const reread = () =>
    run('reanalyze', async () => {
      if (!confirm('Read the transcript again from scratch? Your sentence edits are replaced.')) return;
      const note = await reanalyzeVoiceNote(open!.id);
      setOpen(note);
      setItems(note.items ?? []);
      setItemsDirty(false);
      await refreshList();
    });
  const retranscribe = (id: string) =>
    run('retranscribe', async () => {
      if (!confirm('Transcribe this voice note again? The current transcript and edits are discarded.')) return;
      await retranscribeVoiceNote(id);
      await refreshList();
      if (openId === id) await loadNote(id);
    });
  const remove = (id: string) =>
    run('delete', async () => {
      if (!confirm('Delete this note? Its sentences are also removed from the Log writer drafts.')) return;
      await deleteVoiceNote(id);
      if (openId === id) {
        setOpenId(undefined);
        setOpen(undefined);
      }
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await refreshList();
    });
  const doSaveSettings = () =>
    run('settings', async () => {
      setSettings(await saveVoiceSettings(settings!));
      setNotice('Voice settings saved. New transcriptions use them; press "Read again" on a note to apply new spelling fixes.');
    });

  const setItem = (id: string, patch: Partial<VoiceItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    setItemsDirty(true);
  };
  const byDate = useMemo(() => {
    const groups = new Map<string, VoiceItem[]>();
    for (const item of items) groups.set(item.date, [...(groups.get(item.date) ?? []), item]);
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  const engine = status?.engine;
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900"><Mic size={18} /> Voice notes</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              Add the house manager's voice notes (Telegram .ogg files, any length - a day, a week or a month) or paste a typed report.
              They are transcribed on this computer, split into dates, people and shifts, and sent into the Log writer, which writes the
              workbook and the daily notes. Nothing leaves this PC and no AI key is used.
            </p>
          </div>
          <button className="btn-secondary" onClick={() => setShowSettings((v) => !v)}><Settings2 size={16} />Voice settings</button>
        </div>
        {engine && (
          engine.ok ? (
            <p className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              <CheckCircle2 size={16} /> Speech engine ready (faster-whisper {engine.fasterWhisper}; model{engine.models.length === 1 ? '' : 's'}: {engine.models.join(', ') || 'none yet'};{' '}
              {engine.cudaDevices && engine.cudaLibraries ? 'NVIDIA GPU' : 'CPU'}).
              {status?.queue.running && <span className="font-semibold">Working: {status.queue.message ?? `transcribing with ${status.queue.model ?? 'the model'} on ${status.queue.device ?? '...'}`}</span>}
            </p>
          ) : (
            <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold">Voice transcription is not installed on this computer.</p>
              <p className="mt-1">{engine.error}</p>
              <p className="mt-1">You can still paste typed reports below. After running <code>setup-voice.cmd</code>, press "Check again".</p>
              <button className="btn-secondary mt-3" onClick={() => void run('status', async () => setStatus(await getVoiceStatus(true)))}><RefreshCw size={16} />Check again</button>
            </div>
          )
        )}
      </div>

      {showSettings && settings && (
        <div className="card p-6">
          <h3 className="text-base font-semibold text-slate-900">Voice settings</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-medium text-slate-600 sm:col-span-2">Speech model<select className="input mt-1" value={settings.model} onChange={(e) => setSettings({ ...settings, model: e.target.value })}>{MODEL_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}{engine?.models.includes(m.value) ? ' - downloaded' : ''}</option>)}</select></label>
            <label className="text-xs font-medium text-slate-600">Run on<select className="input mt-1" value={settings.device} onChange={(e) => setSettings({ ...settings, device: e.target.value as VoiceSettings['device'] })}><option value="auto">Automatic (GPU if available)</option><option value="cuda">NVIDIA GPU only</option><option value="cpu">CPU only</option></select></label>
          </div>
          <label className="mt-3 block text-xs font-medium text-slate-600">Extra words to expect (places, foods, medicines, people)<textarea className="input mt-1 h-16" placeholder="e.g. Yorktown Beach, Riverside, Chick-fil-A, Depakote" value={settings.vocabulary} onChange={(e) => setSettings({ ...settings, vocabulary: e.target.value })} /></label>
          <div className="mt-4">
            <p className="text-xs font-medium text-slate-600">Spelling fixes (applied to every transcript before it is read)</p>
            <div className="mt-2 space-y-2">
              {settings.corrections.map((c, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <input className="input w-48" value={c.from} placeholder="heard as" onChange={(e) => setSettings({ ...settings, corrections: settings.corrections.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)) })} />
                  <span className="text-slate-400">→</span>
                  <input className="input w-48" value={c.to} placeholder="write as" onChange={(e) => setSettings({ ...settings, corrections: settings.corrections.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)) })} />
                  <button className="btn-secondary" aria-label="Remove spelling fix" onClick={() => setSettings({ ...settings, corrections: settings.corrections.filter((_, j) => j !== i) })}><Trash2 size={15} /></button>
                </div>
              ))}
              <button className="btn-secondary" onClick={() => setSettings({ ...settings, corrections: [...settings.corrections, { from: '', to: '' }] })}>Add spelling fix</button>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">Other spellings of the individuals' names ("Jay", "Jarrell") are set per person in Log writer → Routine settings → Name aliases.</p>
          <div className="mt-4 flex justify-end"><button className="btn-primary" disabled={Boolean(busy)} onClick={doSaveSettings}><Save size={16} />Save voice settings</button></div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-6">
          <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900"><FileAudio size={17} />Add voice notes</h3>
          <input className="mt-3 block w-full text-sm" type="file" multiple accept={ACCEPT} onChange={(e) => setFiles([...(e.target.files ?? [])])} />
          {files.length > 0 && <p className="mt-2 text-xs text-slate-500">{files.length} file{files.length === 1 ? '' : 's'} selected: {files.map((f) => f.name).join(', ')}</p>}
          <label className="mt-3 block text-xs font-medium text-slate-600">"Today" for files without a date in their name<input className="input mt-1 w-48" type="date" value={uploadDate} onChange={(e) => setUploadDate(e.target.value)} /></label>
          <p className="mt-2 text-xs text-slate-500">Telegram names voice files with the recording date, which is used automatically. If she says the date in the note ("September 15th ..."), that date wins.</p>
          <button className="btn-primary mt-4" disabled={files.length === 0 || Boolean(busy)} onClick={doUpload}><Upload size={16} />{busy === 'upload' ? 'Uploading...' : 'Add and transcribe'}</button>
        </div>
        <div className="card p-6">
          <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900"><Type size={17} />Or paste a typed report</h3>
          <textarea className="input mt-3 h-28" placeholder="Paste the message exactly as she sent it..." value={textReport} onChange={(e) => setTextReport(e.target.value)} />
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="text-xs font-medium text-slate-600">Date it was sent<input className="input mt-1" type="date" value={textDate} onChange={(e) => setTextDate(e.target.value)} /></label>
            <label className="text-xs font-medium text-slate-600">Title (optional)<input className="input mt-1" value={textTitle} onChange={(e) => setTextTitle(e.target.value)} /></label>
          </div>
          <button className="btn-primary mt-4" disabled={textReport.trim().length < 3 || Boolean(busy)} onClick={doAddText}><Save size={16} />Add report</button>
        </div>
      </div>

      <div className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-slate-900">Notes ({visible.length})</h3>
          <div className="flex flex-wrap items-center gap-2">
            <select className="input w-44" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}><option value="all">All months</option>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>
            <button className="btn-secondary" onClick={() => setSelected(new Set(visible.filter((n) => n.status === 'done').map((n) => n.id)))}>Select all finished</button>
            <button className="btn-primary" disabled={finishedSelected.length === 0 || Boolean(busy)} onClick={() => doApply(finishedSelected)}><Send size={16} />{busy === 'apply' ? 'Sending...' : `Send ${finishedSelected.length || ''} to Log writer`}</button>
          </div>
        </div>
        {visible.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">No notes yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-500"><tr><th className="p-2" /><th className="p-2">Note date</th><th className="p-2">File</th><th className="p-2">Length</th><th className="p-2">Status</th><th className="p-2">Days in it</th><th className="p-2">Sent to</th><th className="p-2" /></tr></thead>
              <tbody>
                {visible.map((n) => (
                  <tr key={n.id} className={`border-t border-slate-100 ${openId === n.id ? 'bg-indigo-50' : ''}`}>
                    <td className="p-2"><input type="checkbox" aria-label={`Select ${n.fileName}`} checked={selected.has(n.id)} onChange={(e) => setSelected((prev) => { const next = new Set(prev); if (e.target.checked) next.add(n.id); else next.delete(n.id); return next; })} /></td>
                    <td className="p-2 whitespace-nowrap">{fmtDate(n.referenceDate)}</td>
                    <td className="p-2"><span className="flex items-center gap-1">{n.kind === 'audio' ? <FileAudio size={14} /> : <Type size={14} />}{n.fileName}</span></td>
                    <td className="p-2">{fmtDuration(n.duration)}</td>
                    <td className="p-2">
                      {n.status === 'done' && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">{n.itemCount} sentences</span>}
                      {n.status === 'queued' && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">waiting</span>}
                      {n.status === 'transcribing' && <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">transcribing {Math.round((n.progress ?? 0) * 100)}%</span>}
                      {n.status === 'failed' && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700" title={n.error}>failed</span>}
                    </td>
                    <td className="p-2 text-xs">{n.dates.length ? `${fmtDate(n.dates[0])}${n.dates.length > 1 ? ` - ${fmtDate(n.dates.at(-1)!)} (${n.dates.length})` : ''}` : ''}</td>
                    <td className="p-2 text-xs">{(n.appliedTo ?? []).map((key) => { const [p, m] = key.split('|'); return `${PEOPLE.find((x) => x.id === p)?.name ?? p} ${monthLabel(m)}`; }).join(', ')}</td>
                    <td className="p-2 whitespace-nowrap text-right">
                      <button className="text-xs font-semibold text-indigo-700 hover:underline" onClick={() => openNote(n.id)}>Open</button>
                      {n.kind === 'audio' && (n.status === 'failed' || n.status === 'done') && <button className="ml-3 text-xs font-semibold text-slate-600 hover:underline" onClick={() => retranscribe(n.id)}>Transcribe again</button>}
                      <button className="ml-3 text-xs font-semibold text-rose-700 hover:underline" onClick={() => remove(n.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {notice && <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
        {error && <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800" role="alert">{error}</p>}
        {applied && applied.length > 0 && (
          <div className="mt-4 space-y-2">
            {applied.map((a) => (
              <div key={`${a.profileId}-${a.month}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm">
                <span><strong>{PEOPLE.find((p) => p.id === a.profileId)?.name}</strong> - {monthLabel(a.month)}: days {a.fromDay}-{a.toDay} written, {a.voiceEvents} shift box{a.voiceEvents === 1 ? '' : 'es'} with her details</span>
                <span className="flex gap-2">
                  <button className="btn-secondary" onClick={() => onOpenWriter({ profileId: a.profileId, month: a.month })}>Open in Log writer</button>
                  <button className="btn-primary" disabled={Boolean(busy)} onClick={() => doCreateReport(a)}><Play size={16} />{busy === `job-${a.profileId}-${a.month}` ? 'Starting...' : 'Create daily report'}</button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {open && (
        <div className="card p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">{open.fileName}</h3>
              <p className="text-xs text-slate-500">{open.kind === 'audio' ? `${fmtDuration(open.duration)} · ${open.model ?? ''} ${open.device ? `on ${open.device}` : ''}` : 'Typed report'}{open.recordedOn ? ` · recorded ${fmtDate(open.recordedOn)}` : ''}</p>
            </div>
            <label className="text-xs font-medium text-slate-600">"Today" in this note<input className="input mt-1 w-44" type="date" value={open.referenceDate} onChange={(e) => e.target.value && saveReferenceDate(e.target.value)} /></label>
          </div>
          {open.kind === 'audio' && <audio className="mt-3 w-full" controls preload="none" src={voiceAudioUrl(open.id)} />}
          {open.status !== 'done' ? (
            <p className="mt-4 text-sm text-slate-500">{open.status === 'failed' ? `Transcription failed: ${open.error}` : 'Transcribing... this panel updates when it is finished.'}</p>
          ) : (
            <>
              <label className="mt-4 block text-sm font-medium text-slate-700">
                Transcript {open.editedTranscript !== undefined && <span className="text-xs font-normal text-indigo-700">(corrected by you)</span>}
                <textarea className="input mt-1 h-40 text-sm leading-relaxed" value={transcript} onChange={(e) => setTranscript(e.target.value)} />
              </label>
              <p className="mt-1 text-xs text-slate-500">Fix any misheard words here (listen with the player above), then read it again. Say or add dates like "September 15th" to move sentences to other days.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button className="btn-secondary" disabled={Boolean(busy) || transcript === (open.editedTranscript ?? open.transcript ?? '')} onClick={saveTranscript}><Save size={16} />Save transcript and read again</button>
                <button className="btn-secondary" disabled={Boolean(busy)} onClick={reread}><RefreshCw size={16} />Read again</button>
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-slate-900">What goes into the log ({items.filter((i) => !i.excluded).length} sentences)</h4>
                <span className="flex gap-2">
                  <button className="btn-secondary" disabled={!itemsDirty || Boolean(busy)} onClick={saveItems}><Save size={16} />Save changes</button>
                  <button className="btn-primary" disabled={itemsDirty || Boolean(busy)} onClick={() => doApply([open.id])}><Send size={16} />Send this note to Log writer</button>
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">Check the day, person and shift of each sentence. Untick a sentence to leave it out. Red tags will set Medical / Behavioral / Serious Incident to Yes on that form.</p>
              <div className="mt-3 space-y-5">
                {byDate.map(([date, list]) => (
                  <div key={date}>
                    <p className="text-sm font-bold text-slate-800">{fmtDate(date)}</p>
                    <div className="mt-2 space-y-2">
                      {list.map((item) => (
                        <div key={item.id} className={`rounded-xl border p-3 ${item.excluded ? 'border-slate-200 opacity-50' : item.flags.length ? 'border-rose-300' : 'border-slate-200'}`}>
                          <div className="grid gap-2 lg:grid-cols-[auto_150px_110px_150px_1fr]">
                            <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!item.excluded} onChange={(e) => setItem(item.id, { excluded: !e.target.checked })} />Use</label>
                            <input className="input" type="date" aria-label="Date" value={item.date} onChange={(e) => e.target.value && setItem(item.id, { date: e.target.value, dateReason: 'set by you' })} />
                            <select className="input" aria-label="Person" value={item.people.length > 1 ? 'both' : item.people[0]} onChange={(e) => setItem(item.id, { people: e.target.value === 'both' ? PEOPLE.map((p) => p.id) : [e.target.value] })}>
                              {PEOPLE.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                              <option value="both">Both</option>
                            </select>
                            <select className="input" aria-label="Shift" value={item.shift} onChange={(e) => setItem(item.id, { shift: e.target.value as VoiceItem['shift'], shiftReason: 'set by you' })}>
                              {(Object.keys(SHIFT_LABEL) as VoiceItem['shift'][]).map((s) => <option key={s} value={s}>{SHIFT_LABEL[s]}</option>)}
                            </select>
                            <textarea className="input h-16 text-sm" aria-label="Sentence" value={item.text} onChange={(e) => setItem(item.id, { text: e.target.value })} />
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px]">
                            <span className="text-slate-400" title={`date: ${item.dateReason}; shift: ${item.shiftReason}`}>heard: "{item.original}"</span>
                            {item.moods.map((m) => <span key={m} className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800">mood: {m}</span>)}
                            {item.program && <span className="rounded-full bg-sky-100 px-2 py-0.5 font-semibold text-sky-800">{item.program === 'home' ? 'home day' : 'went to program'}</span>}
                            {item.topics.filter((t) => t !== 'program').map((t) => <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{t}</span>)}
                            {item.flags.map((f) => <span key={f} className="flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-800"><AlertTriangle size={11} />{f}</span>)}
                            <span className="ml-auto text-slate-500">{personLabel(item.people)} · {SHIFT_LABEL[item.shift]}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {(open.skipped?.length ?? 0) > 0 && (
                <details className="mt-4 text-xs text-slate-500">
                  <summary className="cursor-pointer">{open.skipped!.length} part{open.skipped!.length === 1 ? '' : 's'} left out (greetings, dates on their own, fillers)</summary>
                  <ul className="mt-2 list-disc space-y-0.5 pl-5">{open.skipped!.map((s, i) => <li key={i}>{s}</li>)}</ul>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
