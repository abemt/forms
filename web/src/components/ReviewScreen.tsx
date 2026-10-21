import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FieldValue, JobDetail, ShiftDetail } from '../types';
import { previewUrl, saveOverrides } from '../api';
import { FormEditor } from './FormEditor';

interface Props {
  job: JobDetail;
  onGenerate: () => void;
  onJobChanged: (job: JobDetail) => void;
  generating: boolean;
}

function formNumber(index: number): string {
  return `Form ${String(index + 1).padStart(3, '0')}`;
}

export function ReviewScreen({ job, onGenerate, onJobChanged, generating }: Props) {
  const [selected, setSelected] = useState(0);
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [previewNonce, setPreviewNonce] = useState(() => Date.now());
  const [showPreview, setShowPreview] = useState(true);

  const shift: ShiftDetail | undefined = job.shifts[selected];

  // Load the selected shift's merged values into the local editor state.
  useEffect(() => {
    if (!shift) return;
    setValues({ ...shift.values });
    setDirty(false);
    setSaveError(undefined);
    setPreviewNonce(Date.now());
  }, [shift?.index, job.id]);

  const valuesRef = useRef(values);
  valuesRef.current = values;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const persist = useCallback(
    async (shiftIndex: number, payload: Record<string, FieldValue>): Promise<boolean> => {
      setSaving(true);
      setSaveError(undefined);
      try {
        const result = await saveOverrides(job.id, shiftIndex, payload);
        const shifts = job.shifts.map((s) =>
          s.index === shiftIndex ? { ...s, overrides: result.overrides, values: result.values } : s,
        );
        onJobChanged({ ...job, shifts, status: 'review', zipReady: false });
        setDirty(false);
        setPreviewNonce(Date.now());
        return true;
      } catch (err) {
        setSaveError((err as Error).message);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [job, onJobChanged],
  );

  const selectShift = useCallback(
    async (index: number) => {
      if (index === selected) return;
      // Auto-save pending edits so nothing is lost while browsing forms.
      if (dirtyRef.current && shift) {
        const ok = await persist(shift.index, valuesRef.current);
        if (!ok) return;
      }
      setSelected(index);
    },
    [selected, shift, persist],
  );

  const onFieldChange = useCallback((field: string, value: FieldValue) => {
    setValues((v) => ({ ...v, [field]: value }));
    setDirty(true);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (dirtyRef.current && shift) {
      const ok = await persist(shift.index, valuesRef.current);
      if (!ok) return;
    }
    onGenerate();
  }, [shift, persist, onGenerate]);

  const totalWarnings = useMemo(
    () => job.shifts.reduce((acc, s) => acc + s.warnings.length, 0),
    [job.shifts],
  );

  if (!shift) return null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Action bar */}
      <div className="card mb-4 flex flex-wrap items-center gap-4 px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-slate-900">
            Review {job.shifts.length} generated forms
          </h2>
          <p className="truncate text-xs text-slate-500">
            {job.monthLabel ? `${job.monthLabel} — ` : ''}
            edit any field or checkbox, then export. Fields marked{' '}
            <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">AI</span>{' '}
            were filled from report evidence (hover to see the quote).
          </p>
        </div>
        {totalWarnings > 0 && (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
            {totalWarnings} warning{totalWarnings === 1 ? '' : 's'}
          </span>
        )}
        <button className="btn-secondary lg:hidden" onClick={() => setShowPreview((s) => !s)}>
          {showPreview ? 'Hide preview' : 'Show preview'}
        </button>
        <button className="btn-primary" onClick={handleGenerate} disabled={generating || saving}>
          {generating ? 'Generating…' : `Generate ${job.shifts.length} forms`}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row">
        {/* Form list */}
        <nav className="card max-h-40 shrink-0 overflow-y-auto p-2 md:max-h-none md:w-56">
          {job.shifts.map((s) => (
            <button
              key={s.index}
              onClick={() => void selectShift(s.index)}
              className={`mb-1 block w-full rounded-xl px-3 py-2 text-left transition ${
                s.index === selected ? 'bg-indigo-600 text-white shadow' : 'hover:bg-slate-100'
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className={`text-sm font-semibold ${s.index === selected ? '' : 'text-slate-800'}`}>
                  {formNumber(s.index)}
                </span>
                {s.warnings.length > 0 && (
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      s.index === selected ? 'bg-amber-300' : 'bg-amber-400'
                    }`}
                    title={`${s.warnings.length} warning(s)`}
                  />
                )}
              </span>
              <span className={`block truncate text-xs ${s.index === selected ? 'text-indigo-100' : 'text-slate-500'}`}>
                {s.date || 'Unknown date'}
              </span>
              <span className={`block truncate text-xs ${s.index === selected ? 'text-indigo-200' : 'text-slate-400'}`}>
                {s.shift || '—'}
              </span>
            </button>
          ))}
        </nav>

        {/* Editor */}
        <section className="card min-w-0 flex-1 overflow-y-auto p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-slate-900">
              {formNumber(shift.index)} — {shift.date} — {shift.shift}
            </h3>
            <div className="flex items-center gap-2">
              {dirty && <span className="text-xs font-medium text-amber-600">Unsaved changes</span>}
              {saveError && <span className="text-xs font-medium text-rose-600">{saveError}</span>}
              <button
                className="btn-secondary"
                disabled={!dirty || saving}
                onClick={() => void persist(shift.index, valuesRef.current)}
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
          <FormEditor shift={shift} fields={job.templateFields} values={values} onChange={onFieldChange} />
        </section>

        {/* Live PDF preview */}
        {showPreview && (
          <section className="card hidden w-[42%] shrink-0 flex-col overflow-hidden lg:flex">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Live PDF preview
              </span>
              <span className="text-[11px] text-slate-400">saved values only</span>
            </div>
            <iframe
              key={`${shift.index}-${previewNonce}`}
              title="Form preview"
              src={previewUrl(job.id, shift.index, previewNonce)}
              className="h-full w-full flex-1"
            />
          </section>
        )}
      </div>
    </div>
  );
}
