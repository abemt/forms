import { useEffect, useState } from 'react';
import { Download, FileDown, LoaderCircle } from 'lucide-react';
import type { ExportOptions, ExportRecord, JobDetail } from '../types';
import { createPrintExport, getPrintExport, printExportUrl } from '../api';

export function ExportPanel({ job, collection = false, defaultFormat = 'word' }: { job: Pick<JobDetail, 'id' | 'status' | 'errors'> & { shifts: { date: string }[] }; collection?: boolean; defaultFormat?: ExportOptions['format'] }) {
  const dates = job.shifts.map((shift) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(shift.date)) return shift.date;
    const date = new Date(shift.date);
    return Number.isFinite(date.getTime()) ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : '';
  }).filter(Boolean).sort();
  const [options, setOptions] = useState<ExportOptions>({ format: defaultFormat, layout: 'parts', daysPerPart: 4, duplex: true, includeBoundary: true, includePrinted: false });
  const [record, setRecord] = useState<ExportRecord>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const running = busy || record?.status === 'queued' || record?.status === 'building';

  useEffect(() => {
    let active = true;
    const saved = localStorage.getItem(`joy-export:${job.id}`);
    if (saved) getPrintExport(saved).then((result) => { if (active) { setRecord(result); setOptions(result.options); } }).catch(() => localStorage.removeItem(`joy-export:${job.id}`));
    return () => { active = false; };
  }, [job.id]);

  useEffect(() => {
    if (!record || !['queued', 'building'].includes(record.status)) return;
    const timer = window.setTimeout(() => {
      getPrintExport(record.id).then((result) => { setRecord(result); setError(''); }).catch((reason: Error) => { setError(reason.message); setRecord({ ...record }); });
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [record, error]);

  const update = (patch: Partial<ExportOptions>) => { setOptions((current) => ({ ...current, ...patch })); setRecord(undefined); setError(''); localStorage.removeItem(`joy-export:${job.id}`); };
  const build = async () => {
    setBusy(true); setError('');
    try {
      const result = await createPrintExport(job.id, options, collection);
      setRecord(result);
      localStorage.setItem(`joy-export:${job.id}`, result.id);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <section className="space-y-5 border-t border-slate-200 pt-6 text-left" aria-labelledby="export-heading">
      <h3 id="export-heading" className="text-lg font-semibold">Print Files</h3>
      <fieldset disabled={running} className="space-y-5">
        <div className="grid gap-5 md:grid-cols-2">
          <fieldset><legend className="mb-2 text-sm font-medium">File type</legend><div className="flex flex-wrap gap-2">{(['word', 'pdf', 'both'] as const).map((format) => <label key={format} className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm ${options.format === format ? 'border-indigo-500 bg-indigo-50 text-indigo-900' : 'border-slate-300'}`}><input type="radio" name="export-format" value={format} checked={options.format === format} onChange={() => update({ format })} />{format === 'word' ? 'Word' : format === 'pdf' ? 'PDF' : 'Both'}</label>)}</div></fieldset>
          <label className="block text-sm font-medium">Grouping<select className="input mt-2" value={options.layout} onChange={(event) => update({ layout: event.target.value as ExportOptions['layout'] })}><option value="parts">Small date batches</option><option value="merged">One file per month</option><option value="individual">Individual forms</option></select></label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {options.layout === 'parts' && <label className="text-sm font-medium">Days per part<input className="input mt-1" type="number" min={1} max={7} value={options.daysPerPart} onChange={(event) => update({ daysPerPart: Number(event.target.value) })} /></label>}
          <label className="text-sm font-medium">From<input className="input mt-1" type="date" min={dates[0]} max={dates.at(-1)} value={options.fromDate ?? ''} onChange={(event) => update({ fromDate: event.target.value })} /></label>
          <label className="text-sm font-medium">Through<input className="input mt-1" type="date" min={dates[0]} max={dates.at(-1)} value={options.toDate ?? ''} onChange={(event) => update({ toDate: event.target.value })} /></label>
          <label className="text-sm font-medium">Already printed through<input className="input mt-1" type="date" min={dates[0]} max={dates.at(-1)} value={options.printedThrough ?? ''} onChange={(event) => update({ printedThrough: event.target.value })} /></label>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={options.duplex} onChange={(event) => update({ duplex: event.target.checked })} />Double-sided: new sheet for each form</label>
        {options.printedThrough && <div className="flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={options.includeBoundary} onChange={(event) => update({ includeBoundary: event.target.checked })} />Separate last-day check file</label><label className="flex items-center gap-2"><input type="checkbox" checked={options.includePrinted} onChange={(event) => update({ includePrinted: event.target.checked })} />Include earlier printed dates</label></div>}
        {options.layout === 'merged' && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Whole-month documents can exceed home-printer capacity.</p>}
        <button className="btn-primary" disabled={running || job.status !== 'done' || job.errors.length > 0} onClick={() => void build()}>{running ? <LoaderCircle size={18} className="animate-spin" /> : <FileDown size={18} />}{running ? `Preparing files (${record?.artifacts.length ?? 0})...` : 'Prepare print files'}</button>
      </fieldset>
      {(error || record?.error) && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error || record?.error}</p>}
      {record?.status === 'done' && <div className="space-y-3">
        <a className="btn-primary" href={printExportUrl(record.id)}><Download size={18} />Download all print files (.zip)</a>
        <ul className="divide-y divide-slate-200 border-y border-slate-200">{record.artifacts.map((artifact, index) => <li key={artifact.name} className="flex items-start justify-between gap-3 py-3"><div className="min-w-0"><p className="break-all text-sm font-medium">{artifact.name}</p><p className="mt-1 text-xs text-slate-500">{artifact.forms} forms{artifact.pages ? ` / ${artifact.pages} pages` : ''}{artifact.check ? ' / Last-day check' : artifact.alreadyPrinted ? ' / Already printed' : ''}</p></div><a className="btn-secondary shrink-0 p-2" href={printExportUrl(record.id, index)} aria-label={`Download ${artifact.name}`} title="Download"><Download size={18} /></a></li>)}</ul>
      </div>}
    </section>
  );
}