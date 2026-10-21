import { useEffect, useState } from 'react';
import { ArrowLeft, ClipboardCheck, Download, FolderOpen, LoaderCircle, Plus, Save } from 'lucide-react';
import type { JobSummary, ProfileId, ProfileInfo, QuarterlyInput, QuarterlyReport, QuarterlySummary } from '../types';
import { createQuarterlyReport, generateQuarterlyReport, getProfiles, getQuarterlyReport, listJobs, listQuarterlyReports, quarterlyDownloadUrl, saveQuarterlyReport } from '../api';
import { UploadDropzone } from './UploadDropzone';

export function QuarterlyScreen() {
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [history, setHistory] = useState<QuarterlySummary[]>([]);
  const [report, setReport] = useState<QuarterlyReport>();
  const [values, setValues] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState('Reporting Period');
  const [input, setInput] = useState<QuarterlyInput>({ profileId: 'steven', mode: 'new', periodStart: '', periodEnd: '', quarter: '1st', sourceJobIds: [], saveTemplate: true });
  const [template, setTemplate] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reviewer, setReviewer] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [sourceQuery, setSourceQuery] = useState('');

  const open = (loaded: QuarterlyReport) => {
    let restored = loaded.values;
    try {
      const draft = JSON.parse(sessionStorage.getItem(`joy-quarterly-draft:${loaded.id}`) ?? '{}') as Record<string, unknown>;
      if (loaded.mode !== 'copy') restored = { ...loaded.values, ...Object.fromEntries(Object.entries(draft).filter(([key, value]) => typeof value === 'string' && loaded.spec.fields.some((field) => field.id === key))) } as Record<string, string>;
    } catch { sessionStorage.removeItem(`joy-quarterly-draft:${loaded.id}`); }
    setReport(loaded); setValues(restored); setSelected('Reporting Period'); setConfirmed(false);
    setReviewer(loaded.reviewer ?? ''); localStorage.setItem('joy-quarterly', loaded.id);
  };
  useEffect(() => {
    Promise.all([getProfiles(), listJobs(), listQuarterlyReports()]).then(([profileList, jobList, quarterlyList]) => { setProfiles(profileList); setJobs(jobList); setHistory(quarterlyList); }).catch((reason: Error) => setError(reason.message));
    const saved = localStorage.getItem('joy-quarterly');
    if (saved) getQuarterlyReport(saved).then(open).catch(() => localStorage.removeItem('joy-quarterly'));
  }, []);
  useEffect(() => {
    if (report?.status !== 'building') return;
    const timer = window.setTimeout(() => { getQuarterlyReport(report.id).then((result) => { setReport(result); setError(''); }).catch((reason: Error) => { setError(reason.message); setReport({ ...report }); }); }, 1500);
    return () => window.clearTimeout(timer);
  }, [report, error]);

  const dirty = report && JSON.stringify(values) !== JSON.stringify(report.values);
  useEffect(() => {
    if (!report) return;
    const key = `joy-quarterly-draft:${report.id}`;
    if (dirty) sessionStorage.setItem(key, JSON.stringify(values));
  }, [report?.id, values, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const groups = [...new Set(report?.spec.fields.map((field) => field.group) ?? [])];
  const fields = report?.spec.fields.filter((field) => field.group === selected) ?? [];
  const running = busy || report?.status === 'building';
  const save = async () => {
    if (!report) return undefined;
    const saved = await saveQuarterlyReport(report.id, values);
    setReport(saved);
    sessionStorage.removeItem(`joy-quarterly-draft:${report.id}`);
    return saved;
  };
  const perform = async (action: () => Promise<void>) => { setBusy(true); setError(''); try { await action(); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); } };
  const leave = async () => {
    if (dirty) await save();
    setReport(undefined); localStorage.removeItem('joy-quarterly');
    setHistory(await listQuarterlyReports()); setProfiles(await getProfiles());
  };
  const searchWords = sourceQuery.toLowerCase().split(/\s+/).filter(Boolean);
  const sources = report?.sources.filter((source) => searchWords.every((word) => `${source.topic} ${source.date} ${source.text}`.toLowerCase().includes(word))).slice(0, 60) ?? [];

  return <section className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Quarterly Reports</h2>{report && <button className="btn-secondary" disabled={running} onClick={() => void perform(leave)}><ArrowLeft size={16} />All quarterlies</button>}</div>
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {!report ? <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); void perform(async () => open(await createQuarterlyReport(input, template))); }}>
        <fieldset disabled={busy} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Individual<select className="input mt-1" value={input.profileId} onChange={(event) => { setInput({ ...input, profileId: event.target.value as ProfileId, sourceJobIds: [] }); setTemplate(undefined); }}><option value="steven">Steven (Steve)</option><option value="jerrell">Jerrell Wright</option></select></label><label className="text-sm font-medium">Report type<select className="input mt-1" value={input.mode} onChange={(event) => setInput({ ...input, mode: event.target.value as QuarterlyInput['mode'] })}><option value="new">New quarterly review</option><option value="copy">Reprint existing report unchanged</option></select></label></div>
          <UploadDropzone label="Quarterly Word template or existing report" description={profiles.find((profile) => profile.id === input.profileId)?.quarterlyTemplate ? 'Saved quarterly template available' : 'No saved quarterly template for this person'} optional={profiles.find((profile) => profile.id === input.profileId)?.quarterlyTemplate} file={template} onFile={setTemplate} extensions={['.docx']} typeLabel="Word (.docx)" />
          {template && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={input.saveTemplate} onChange={(event) => setInput({ ...input, saveTemplate: event.target.checked })} />Save this person's quarterly template</label>}
          {input.mode === 'new' && <div className="grid gap-4 sm:grid-cols-3"><label className="text-sm font-medium">Period start<input className="input mt-1" type="date" required value={input.periodStart} onChange={(event) => setInput({ ...input, periodStart: event.target.value })} /></label><label className="text-sm font-medium">Period end<input className="input mt-1" type="date" required min={input.periodStart} value={input.periodEnd} onChange={(event) => setInput({ ...input, periodEnd: event.target.value })} /></label><label className="text-sm font-medium">Quarter<select className="input mt-1" value={input.quarter} onChange={(event) => setInput({ ...input, quarter: event.target.value })}>{['1st', '2nd', '3rd', '4th'].map((quarter) => <option key={quarter}>{quarter}</option>)}</select></label></div>}
          {input.mode === 'new' && <fieldset><legend className="mb-2 text-sm font-semibold">Source daily reports</legend><div className="max-h-52 space-y-2 overflow-y-auto border-y border-slate-200 py-3">{jobs.filter((job) => job.profileId === input.profileId && ['review', 'done'].includes(job.status)).map((job) => <label className="flex items-start gap-2 text-sm" key={job.id}><input type="checkbox" checked={input.sourceJobIds.includes(job.id)} onChange={(event) => setInput({ ...input, sourceJobIds: event.target.checked ? [...input.sourceJobIds, job.id] : input.sourceJobIds.filter((id) => id !== job.id) })} /><span>{job.monthLabel ?? job.logFileName} <span className="text-xs text-slate-500">/ {job.shiftsFound} forms / {job.id.slice(0, 8)}</span></span></label>)}</div></fieldset>}
          <button className="btn-primary" disabled={busy || (!template && !profiles.find((profile) => profile.id === input.profileId)?.quarterlyTemplate)} type="submit">{busy ? <LoaderCircle size={18} className="animate-spin" /> : <Plus size={18} />}{busy ? 'Opening template...' : 'Create quarterly draft'}</button>
        </fieldset>
      </form>
      <div className="space-y-3"><h3 className="text-base font-semibold">Saved Quarterlies</h3><ul className="divide-y divide-slate-200">{history.map((item) => <li key={item.id} className="flex items-start justify-between gap-3 py-3"><div className="min-w-0"><p className="break-words text-sm font-medium">{item.individualName}</p><p className="mt-1 text-xs text-slate-500">{item.periodStart} to {item.periodEnd} / {item.status}</p></div><button className="btn-secondary p-2" title="Open quarterly" aria-label={`Open quarterly ${item.periodStart}`} disabled={busy} onClick={() => void perform(async () => open(await getQuarterlyReport(item.id)))}><FolderOpen size={18} /></button></li>)}</ul>{!history.length && <p className="text-sm text-slate-500">No saved quarterly reports.</p>}</div>
    </div> : <>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-base font-semibold">{report.spec.individualName}</h3><p className="text-sm text-slate-500">{report.values.periodStart} to {report.values.periodEnd} / {report.status}{dirty ? ' / Unsaved changes' : ''}</p></div><button className="btn-secondary" disabled={!dirty || running || report.mode === 'copy'} onClick={() => void perform(async () => { await save(); })}><Save size={16} />Save draft</button></div>
      {report.mode === 'copy' && <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">Existing report: unchanged-copy mode.</p>}
      {report.warning && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{report.warning}</p>}
      <div className="grid items-start gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav className="max-h-56 overflow-y-auto border-b border-slate-200 pb-2 lg:max-h-[65vh] lg:border-b-0" aria-label="Quarterly sections">{groups.map((group) => <button key={group} className={`mb-1 block w-full break-words rounded-lg px-3 py-2 text-left text-sm ${selected === group ? 'bg-indigo-600 text-white' : 'text-slate-700 hover:bg-slate-100'}`} onClick={() => { setSelected(group); setSourceQuery(''); }}>{group}</button>)}</nav>
        <div className="min-w-0 space-y-5"><h3 className="break-words text-base font-semibold">{selected}</h3><fieldset disabled={running || report.mode === 'copy'} className="space-y-4">{fields.map((field) => <label className="block text-sm font-medium" key={field.id}>{field.label}{field.type === 'choice' ? <select className="input mt-1" value={values[field.id] ?? ''} onChange={(event) => { setValues({ ...values, [field.id]: event.target.value }); setConfirmed(false); }}><option value="">Not reviewed</option>{field.options?.map((option) => <option key={option}>{option}</option>)}</select> : field.type === 'date' ? <input className="input mt-1" type="date" value={values[field.id] ?? ''} onChange={(event) => { setValues({ ...values, [field.id]: event.target.value }); setConfirmed(false); }} /> : <textarea className="input mt-1 min-h-28" rows={field.id.endsWith('.summary') ? 8 : 3} value={values[field.id] ?? ''} onChange={(event) => { setValues({ ...values, [field.id]: event.target.value }); setConfirmed(false); }} />}</label>)}</fieldset>
          {report.sources.length > 0 && <details className="border-t border-slate-200 pt-4"><summary className="cursor-pointer text-sm font-semibold">Source notes ({report.sources.length})</summary><input className="input my-3" placeholder="Filter source notes" aria-label="Filter source notes" value={sourceQuery} onChange={(event) => setSourceQuery(event.target.value)} /><ul className="max-h-72 divide-y divide-slate-200 overflow-y-auto">{sources.map((source, index) => <li className="py-3 text-sm" key={`${source.jobId}-${source.date}-${index}`}><p className="text-xs text-slate-500">{source.date} / {source.shift} / {source.topic}</p><p className="mt-1 whitespace-pre-wrap">{source.text}</p></li>)}</ul></details>}
        </div>
      </div>
      <div className="space-y-4 border-t border-slate-200 pt-5"><div className="grid items-end gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Reviewer name<input className="input mt-1" value={reviewer} disabled={running} onChange={(event) => { setReviewer(event.target.value); setConfirmed(false); }} /></label><label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={confirmed} disabled={running} onChange={(event) => setConfirmed(event.target.checked)} />I reviewed the reporting dates, entries, and completion details.</label></div>
        <button className="btn-primary" disabled={running || !confirmed || reviewer.trim().length < 2} onClick={() => void perform(async () => { if (dirty) await save(); setReport(await generateQuarterlyReport(report.id, reviewer)); })}>{running ? <LoaderCircle size={18} className="animate-spin" /> : <ClipboardCheck size={18} />}{running ? 'Preparing quarterly...' : 'Generate quarterly files'}</button>
        {report.status === 'done' && !dirty && <div className="flex flex-wrap gap-3"><a className="btn-primary" href={quarterlyDownloadUrl(report.id, 'word')}><Download size={17} />Word</a>{report.pdfReady && <a className="btn-secondary" href={quarterlyDownloadUrl(report.id, 'pdf')}><Download size={17} />PDF</a>}<a className="btn-secondary" href={quarterlyDownloadUrl(report.id, 'zip')}><Download size={17} />All files (.zip)</a></div>}
      </div>
    </>}
  </section>;
}