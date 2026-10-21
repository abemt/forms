import { useEffect, useRef, useState } from 'react';
import type { JobSummary } from '../types';
import { ProgressBar } from './ProgressBar';

interface Props {
  summary: JobSummary;
  title: string;
}

/** Live processing panel: stage line, progress bar, counters and a stage log. */
export function ProcessingPanel({ summary, title }: Props) {
  const [stageLog, setStageLog] = useState<string[]>([]);
  const lastStage = useRef<string>('');
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (summary.stage && summary.stage !== lastStage.current) {
      lastStage.current = summary.stage;
      setStageLog((log) => [...log.slice(-199), summary.stage]);
    }
  }, [summary.stage]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [stageLog]);

  const { current, total } = summary.progress;
  const indeterminate = total === 0;

  return (
    <div className="card mx-auto w-full max-w-2xl p-8">
      <div className="mb-6 flex items-center gap-3">
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-indigo-600" />
        </span>
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      </div>

      <p className="mb-3 text-sm font-medium text-indigo-700">{summary.stage}</p>
      <ProgressBar current={current} total={total} indeterminate={indeterminate} />
      {!indeterminate && (
        <p className="mt-2 text-right text-xs font-medium text-slate-500">
          {current} / {total}
        </p>
      )}

      <dl className="mt-6 grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-slate-50 p-3 text-center">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Shifts found</dt>
          <dd className="mt-1 text-2xl font-bold text-slate-900">{summary.shiftsFound}</dd>
        </div>
        <div className="rounded-xl bg-slate-50 p-3 text-center">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Completed</dt>
          <dd className="mt-1 text-2xl font-bold text-emerald-600">{summary.formsCompleted}</dd>
        </div>
        <div className="rounded-xl bg-slate-50 p-3 text-center">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Errors</dt>
          <dd className={`mt-1 text-2xl font-bold ${summary.errors.length > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
            {summary.errors.length}
          </dd>
        </div>
      </dl>

      <div
        ref={logRef}
        className="mt-6 max-h-40 overflow-y-auto rounded-xl bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-300"
      >
        {stageLog.map((line, i) => (
          <div key={i} className={i === stageLog.length - 1 ? 'text-emerald-300' : ''}>
            {line}
          </div>
        ))}
      </div>

      {summary.errors.length > 0 && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4">
          <p className="text-sm font-semibold text-rose-800">Errors</p>
          <ul className="mt-1 list-inside list-disc text-sm text-rose-700">
            {summary.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
