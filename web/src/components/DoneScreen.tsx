import type { JobDetail } from '../types';
import { downloadUrl } from '../api';
import { ExportPanel } from './ExportPanel';

interface Props {
  job: JobDetail;
  onBackToReview: () => void;
  onStartOver: () => void;
}

export function DoneScreen({ job, onBackToReview, onStartOver }: Props) {
  const warningCount = job.shifts.reduce((acc, s) => acc + s.warnings.length, 0);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
        <svg className="h-9 w-9 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
      </div>
      <h2 className="mt-4 text-xl font-bold text-slate-900">Finished.</h2>
      <p className="mt-1 text-sm text-slate-500">{job.stage}</p>

      <dl className="mx-auto mt-6 grid max-w-md grid-cols-3 gap-3">
        <div className="rounded-xl bg-slate-50 p-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Forms</dt>
          <dd className="mt-1 text-2xl font-bold text-slate-900">{job.shifts.length}</dd>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Warnings</dt>
          <dd className={`mt-1 text-2xl font-bold ${warningCount > 0 ? 'text-amber-600' : 'text-slate-900'}`}>
            {warningCount}
          </dd>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Errors</dt>
          <dd className={`mt-1 text-2xl font-bold ${job.errors.length > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
            {job.errors.length}
          </dd>
        </div>
      </dl>

      <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 text-left text-xs text-slate-600">
        <p className="font-semibold text-slate-700">{job.zipName}</p>
        <p className="mt-1 font-mono">
          Editable/Form001.pdf … Form{String(job.shifts.length).padStart(3, '0')}.pdf — fillable AcroForm PDFs
          <br />
          PDF/ — printable PDFs; Word/ — individual Word forms (newly generated bundles)
        </p>
      </div>

      {job.errors.length > 0 && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-left">
          <p className="text-sm font-semibold text-rose-800">Errors</p>
          <ul className="mt-1 list-inside list-disc text-xs text-rose-700">
            {job.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <ExportPanel key={job.id} job={job} />
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <a className="btn-primary px-8 py-3 text-base" href={downloadUrl(job.id)}>
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Original individual-files ZIP
        </a>
        <button className="btn-secondary" onClick={onBackToReview}>
          Back to review
        </button>
        <button className="btn-secondary" onClick={onStartOver}>
          Process another report
        </button>
      </div>
    </div>
  );
}
