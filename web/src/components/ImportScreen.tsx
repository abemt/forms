import { useEffect, useState } from 'react';
import { FolderOpen, LoaderCircle, Upload } from 'lucide-react';
import type { PrintCollection, ProfileId } from '../types';
import { getPrintCollection, importPrintFiles, listPrintCollections } from '../api';
import { ExportPanel } from './ExportPanel';

export function ImportScreen() {
  const [profile, setProfile] = useState<ProfileId>('steven');
  const [files, setFiles] = useState<File[]>([]);
  const [convert, setConvert] = useState(false);
  const [record, setRecord] = useState<PrintCollection>();
  const [history, setHistory] = useState<Awaited<ReturnType<typeof listPrintCollections>>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { listPrintCollections().then(setHistory).catch((reason: Error) => setError(reason.message)); }, []);
  const submit = async () => {
    setBusy(true); setError('');
    try { setRecord(await importPrintFiles(profile, files, convert)); setHistory(await listPrintCollections()); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };
  return <section className="mx-auto max-w-4xl space-y-6"><h2 className="text-xl font-semibold">Print Existing Files</h2>
    <div className="grid gap-5 sm:grid-cols-2"><label className="text-sm font-medium">Individual<select className="input mt-1" disabled={busy} value={profile} onChange={(event) => { setProfile(event.target.value as ProfileId); setRecord(undefined); setFiles([]); }}><option value="steven">Steven (Steve)</option><option value="jerrell">Jerrell Wright</option></select></label><label className="text-sm font-medium">Individual forms or monthly ZIP<input className="input mt-1" key={profile} type="file" multiple accept=".pdf,.docx,.zip" disabled={busy} onChange={(event) => { setFiles(Array.from(event.target.files ?? [])); setRecord(undefined); }} /></label></div>
    <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={convert} disabled={busy} onChange={(event) => setConvert(event.target.checked)} />Create Word copies of compatible fillable PDFs</label>
    {convert && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Word conversion can change layout and signature fonts. PDFs containing images require their original Word copies.</p>}
    <button className="btn-primary" disabled={busy || !files.length} onClick={() => void submit()}>{busy ? <LoaderCircle size={18} className="animate-spin" /> : <Upload size={18} />}{busy ? 'Importing files...' : 'Import reviewed files'}</button>
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {record && <div className="space-y-4"><h3 className="text-base font-semibold">{record.label} / {record.forms.length} imported forms</h3>{record.warnings.map((warning, index) => <p className="text-sm text-amber-900" key={index}>{warning}</p>)}<ExportPanel key={record.id} collection defaultFormat={record.forms.every((form) => form.wordFile) ? 'word' : 'pdf'} job={{ id: record.id, status: 'done', errors: [], shifts: record.forms }} /></div>}
    <div className="border-t border-slate-200 pt-5"><h3 className="mb-3 text-base font-semibold">Saved Imports</h3><ul className="divide-y divide-slate-200">{history.filter((item) => item.profileId === profile).map((item) => <li className="flex items-center justify-between gap-3 py-3" key={item.id}><p className="text-sm">{item.label} / {item.forms} forms / {item.createdAt.slice(0, 10)}</p><button className="btn-secondary" disabled={busy} onClick={() => { setError(''); void getPrintCollection(item.id).then(setRecord).catch((reason: Error) => setError(reason.message)); }}><FolderOpen size={16} />Open</button></li>)}</ul></div>
  </section>;
}