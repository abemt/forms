import { useEffect, useState } from 'react';
import { FolderOpen, RefreshCw } from 'lucide-react';
import { listJobs } from '../api';
import type { JobSummary } from '../types';

export function ReportHistory({ onOpen }: { onOpen: (id: string) => void }) {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [profile, setProfile] = useState('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = async () => { setBusy(true); setError(''); try { setJobs(await listJobs()); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); } };
  useEffect(() => { void load(); }, []);
  const visible = jobs.filter((job) => profile === 'all' || job.profileId === profile);
  return <section className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Saved Daily Reports</h2><div className="flex gap-2"><select className="input" aria-label="Filter individual" value={profile} onChange={(event) => setProfile(event.target.value)}><option value="all">All individuals</option><option value="steven">Steven</option><option value="jerrell">Jerrell</option></select><button className="btn-secondary p-2" title="Refresh reports" aria-label="Refresh reports" disabled={busy} onClick={() => void load()}><RefreshCw size={18} className={busy ? 'animate-spin' : ''} /></button></div></div>
    {error && <p role="alert" className="text-sm text-rose-800">{error}</p>}
    {!busy && !visible.length && <p className="py-10 text-center text-slate-500">No saved reports.</p>}
    <ul className="divide-y divide-slate-200">{visible.map((job) => <li key={job.id} className="flex flex-wrap items-center gap-4 py-4"><div className="min-w-0 flex-1"><h3 className="break-words text-sm font-semibold">{job.individualName ?? job.logFileName ?? 'Report'}</h3><p className="mt-1 text-xs text-slate-500">{job.monthLabel ?? job.createdAt?.slice(0, 10)} / {job.shiftsFound} forms / {job.status}</p></div><button className="btn-secondary" onClick={() => onOpen(job.id)}><FolderOpen size={16} />Open</button></li>)}</ul>
  </section>;
}