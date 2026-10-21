import { useState } from 'react';
import type { DailyInput, HealthInfo, ProfileId } from '../types';
import { UploadDropzone } from './UploadDropzone';
import { Download } from 'lucide-react';

interface Props {
  health: HealthInfo | undefined;
  busy: boolean;
  error: string | undefined;
  onStart: (input: DailyInput) => void;
}

export function UploadScreen({ health, busy, error, onStart }: Props) {
  const [profileId, setProfileId] = useState<ProfileId>('steven');
  const [saveTemplate, setSaveTemplate] = useState(true);
  const [completeRoutineFields, setCompleteRoutineFields] = useState(false);
  const [workbookMonth, setWorkbookMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [logFile, setLogFile] = useState<File>();
  const [templateFile, setTemplateFile] = useState<File>();
  const [autoGenerate, setAutoGenerate] = useState(false);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="card p-8">
        <h2 className="text-lg font-semibold text-slate-900">Create Daily Progress Notes</h2>
        <p className="mt-1 text-sm text-slate-500">
          Upload a monthly shift log. Every shift in the report becomes one completed, editable
          Form §680 — checkboxes, supports and narratives included.
        </p>

        {health && health.engine === 'local' && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <strong>Free local mode.</strong> Shifts are extracted and mapped with the built-in rule
            engine. Routine draft defaults, when enabled, require staff verification.
          </div>
        )}
        {health && health.engine === 'ai' && !health.aiConfigured && (
          <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
            <strong>AI engine selected but not configured.</strong> Set <code className="font-mono">AI_API_KEY</code> in
            the server environment (see <code className="font-mono">.env.example</code>) and restart, or set{' '}
            <code className="font-mono">ENGINE=local</code> for the free rule-based mode.
          </div>
        )}

        <div className="mt-6 space-y-5">
          <label className="block text-sm font-medium">Individual<select className="input mt-1" disabled={busy} value={profileId} onChange={(event) => { setProfileId(event.target.value as ProfileId); setTemplateFile(undefined); setLogFile(undefined); }}><option value="steven">Steven (Steve)</option><option value="jerrell">Jerrell Wright</option></select></label>
          <div className="flex flex-wrap items-end gap-3"><label className="text-sm font-medium">Blank workbook month<input className="input mt-1" type="month" value={workbookMonth} min={profileId === 'jerrell' ? '2026-07' : '2000-01'} onChange={(event) => setWorkbookMonth(event.target.value)} /></label><a className="btn-secondary" href={`/api/templates/${profileId}/workbook.docx?month=${encodeURIComponent(workbookMonth)}`}><Download size={16} />Blank workbook</a></div>
          <UploadDropzone
            label="Monthly Shift Log (PDF or Word .docx)"
            description="The report containing all shifts for the month — the filled Daily Log Entry workbook (.docx) uploads directly"
            file={logFile}
            onFile={setLogFile}
            extensions={['.pdf', '.docx']}
            typeLabel="PDF or Word (.docx)"
          />
          <UploadDropzone
            label="Replacement daily template (Word)"
            description={`${profileId === 'steven' ? 'Steven' : 'Jerrell'}: saved daily template selected`}
            file={templateFile}
            onFile={setTemplateFile}
            optional
            extensions={['.docx']}
            typeLabel="Word (.docx)"
          />
          <p className="-mt-2 text-xs text-slate-400">
            <a
              href={`/api/templates/${profileId}/daily.docx`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 font-medium text-indigo-600 hover:underline"
            >
              <Download size={15} /> Download current template
            </a>
          </p>

          {templateFile && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={saveTemplate} onChange={(event) => setSaveTemplate(event.target.checked)} />Save as this person's daily template</label>}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={completeRoutineFields} onChange={(event) => { setCompleteRoutineFields(event.target.checked); setAutoGenerate(false); }} />Include unverified routine draft defaults</label>
          {completeRoutineFields && <p role="note" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Routine defaults are not observations from the log. Staff confirmation is required.</p>}

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-4 hover:bg-slate-50">
            <input
              type="checkbox"
              checked={autoGenerate}
              disabled={completeRoutineFields}
              onChange={(e) => setAutoGenerate(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span>
              <span className="block text-sm font-medium text-slate-800">
                Fully automatic (skip review)
              </span>
              <span className="block text-xs text-slate-500">
                Generate and zip all forms immediately after analysis — one click, no manual editing.
              </span>
            </span>
          </label>

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              {error}
            </div>
          )}

          <button
            className="btn-primary w-full py-3 text-base"
            disabled={!logFile || busy}
            onClick={() => logFile && onStart({ log: logFile, template: templateFile, autoGenerate, profileId, saveTemplate, completeRoutineFields })}
          >
            {busy ? 'Uploading…' : 'Start processing'}
          </button>
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-slate-400">
        Staff review required before filing or signing.
      </p>
    </div>
  );
}
