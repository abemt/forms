import { useCallback, useEffect, useRef, useState } from 'react';
import type { DailyInput, HealthInfo, JobDetail, JobSummary } from './types';
import { createJob, getHealth, getJob, startExtraction, startGeneration } from './api';
import { useJobEvents } from './hooks/useJobEvents';
import { UploadScreen } from './components/UploadScreen';
import { ProcessingPanel } from './components/ProcessingPanel';
import { ReviewScreen } from './components/ReviewScreen';
import { DoneScreen } from './components/DoneScreen';
import { ReportHistory } from './components/ReportHistory';
import { ClipboardList, FilePlus2, FolderInput, History, Mic, PenLine } from 'lucide-react';
import { QuarterlyScreen } from './components/QuarterlyScreen';
import { ImportScreen } from './components/ImportScreen';
import { LogWriterScreen } from './components/LogWriterScreen';
import { VoiceScreen } from './components/VoiceScreen';
import type { ProfileId } from './types';

type View = 'upload' | 'processing' | 'review' | 'generating' | 'done' | 'failed';

function viewForStatus(status: JobDetail['status']): View {
  switch (status) {
    case 'created':
    case 'processing':
      return 'processing';
    case 'review':
      return 'review';
    case 'generating':
      return 'generating';
    case 'done':
      return 'done';
    case 'failed':
      return 'failed';
    default:
      return 'upload';
  }
}

const STEPS: { key: View[]; label: string }[] = [
  { key: ['upload'], label: 'Upload' },
  { key: ['processing'], label: 'Analyze' },
  { key: ['review'], label: 'Review' },
  { key: ['generating', 'done', 'failed'], label: 'Export' },
];

export default function App() {
  const [health, setHealth] = useState<HealthInfo>();
  const [job, setJob] = useState<JobDetail>();
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string>();
  const [generateRequested, setGenerateRequested] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showQuarterly, setShowQuarterly] = useState(false);
  const [showImports, setShowImports] = useState(false);
  const [showWriter, setShowWriter] = useState(false);
  const [showVoice, setShowVoice] = useState(false);
  const [writerTarget, setWriterTarget] = useState<{ profileId: ProfileId; month: string; at: number }>();
  const [reviewRequested, setReviewRequested] = useState(false);

  useEffect(() => {
    getHealth().then(setHealth).catch(() => setHealth({ ok: false, engine: 'local', aiConfigured: false, model: '' }));
    const saved = localStorage.getItem('joy-current-job');
    if (saved) getJob(saved).then(setJob).catch(() => localStorage.removeItem('joy-current-job'));
  }, []);

  const jobRef = useRef(job);
  jobRef.current = job;

  // Refresh the full job document whenever the status changes (SSE frames are
  // lightweight summaries; the full document carries shifts + field values).
  const refreshingRef = useRef(false);
  const refreshJob = useCallback(async (id: string) => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    try {
      const fresh = await getJob(id);
      setJob(fresh);
    } catch {
      /* transient */
    } finally {
      refreshingRef.current = false;
    }
  }, []);

  const onSummary = useCallback(
    (summary: JobSummary) => {
      const current = jobRef.current;
      if (!current || summary.id !== current.id) return;
      if (summary.status !== current.status) {
        void refreshJob(current.id);
      }
      setJob((prev) =>
        prev && prev.id === summary.id
          ? {
              ...prev,
              status: summary.status,
              stage: summary.stage,
              progress: summary.progress,
              shiftsFound: summary.shiftsFound,
              formsCompleted: summary.formsCompleted,
              errors: summary.errors,
              warningCount: summary.warningCount,
              zipName: summary.zipName ?? prev.zipName,
              zipReady: summary.zipReady,
            }
          : prev,
      );
      if (summary.status === 'review' || summary.status === 'done') {
        setGenerateRequested(false);
      }
    },
    [refreshJob],
  );

  useJobEvents(job?.id, onSummary);

  const handleStart = useCallback(
    async (input: DailyInput) => {
      setUploadBusy(true);
      setUploadError(undefined);
      try {
        const created = await createJob(input);
        setJob(created);
        localStorage.setItem('joy-current-job', created.id);
        setReviewRequested(false);
        await startExtraction(created.id);
      } catch (err) {
        setUploadError((err as Error).message);
        setJob(undefined);
      } finally {
        setUploadBusy(false);
      }
    },
    [],
  );

  const handleGenerate = useCallback(async () => {
    if (!jobRef.current) return;
    setReviewRequested(false);
    setGenerateRequested(true);
    try {
      await startGeneration(jobRef.current.id);
    } catch (err) {
      setGenerateRequested(false);
      alert((err as Error).message);
    }
  }, []);

  const handleStartOver = useCallback(() => {
    setJob(undefined);
    setUploadError(undefined);
    setGenerateRequested(false);
    setReviewRequested(false);
    localStorage.removeItem('joy-current-job');
  }, []);

  const view: View = reviewRequested && job?.status === 'done' ? 'review' : job ? viewForStatus(job.status) : 'upload';
  const activeStep = STEPS.findIndex((s) => s.key.includes(view));
  const showTool = (tool: 'daily' | 'writer' | 'voice' | 'quarterly' | 'imports' | 'history') => {
    setShowWriter(tool === 'writer');
    setShowVoice(tool === 'voice');
    setShowQuarterly(tool === 'quarterly');
    setShowImports(tool === 'imports');
    setShowHistory(tool === 'history');
  };
  const openJob = (id: string) => {
    void getJob(id)
      .then((result) => {
        setJob(result);
        setReviewRequested(false);
        localStorage.setItem('joy-current-job', id);
        showTool('daily');
      })
      .catch((reason: Error) => setUploadError(reason.message));
  };
  const dailyActive = !showHistory && !showQuarterly && !showImports && !showWriter && !showVoice;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow">
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 12-2.25 2.25m0 0-2.25-2.25m2.25 2.25V9m-4.5 12h12.75a1.125 1.125 0 0 0 1.125-1.125V9.75a9 9 0 0 0-9-9H5.625A1.125 1.125 0 0 0 4.5 1.875v18A1.125 1.125 0 0 0 5.625 21Z" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900">Form §680 AutoNotes</h1>
              <p className="text-xs text-slate-500">Daily Progress Notes, generated from your shift log</p>
            </div>
          </div>

          <ol className="hidden items-center gap-1 sm:flex">
            {STEPS.map((step, i) => (
              <li key={step.label} className="flex items-center">
                <span
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                    i === activeStep
                      ? 'bg-indigo-600 text-white'
                      : i < activeStep
                        ? 'bg-indigo-100 text-indigo-700'
                        : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {i + 1}. {step.label}
                </span>
                {i < STEPS.length - 1 && <span className="mx-1 h-px w-4 bg-slate-300" />}
              </li>
            ))}
          </ol>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
        <nav className="mb-7 flex flex-wrap gap-2 border-b border-slate-200 pb-3" aria-label="Report workspace"><button className={dailyActive ? 'btn-primary' : 'btn-secondary'} onClick={() => showTool('daily')}><FilePlus2 size={17} />Daily reports</button><button className={showWriter ? 'btn-primary' : 'btn-secondary'} onClick={() => showTool('writer')}><PenLine size={17} />Log writer</button><button className={showVoice ? 'btn-primary' : 'btn-secondary'} onClick={() => showTool('voice')}><Mic size={17} />Voice notes</button><button className={showQuarterly ? 'btn-primary' : 'btn-secondary'} onClick={() => showTool('quarterly')}><ClipboardList size={17} />Quarterly reports</button><button className={showImports ? 'btn-primary' : 'btn-secondary'} onClick={() => showTool('imports')}><FolderInput size={17} />Existing files</button><button className={showHistory ? 'btn-primary' : 'btn-secondary'} onClick={() => showTool('history')}><History size={17} />Saved reports</button></nav>
        {showVoice ? <VoiceScreen onJobCreated={openJob} onOpenWriter={(target) => { setWriterTarget({ ...target, at: Date.now() }); showTool('writer'); }} /> : showWriter ? <LogWriterScreen key={writerTarget?.at ?? 0} initial={writerTarget} onJobCreated={openJob} /> : showImports ? <ImportScreen /> : showQuarterly ? <QuarterlyScreen /> : showHistory ? <ReportHistory onOpen={openJob} /> : <>
        {view === 'upload' && (
          <UploadScreen health={health} busy={uploadBusy} error={uploadError} onStart={handleStart} />
        )}

        {view === 'processing' && job && (
          <><ProcessingPanel summary={job} title="Processing report" />{job.status === 'created' && <button className="btn-secondary mt-4" onClick={() => void startExtraction(job.id).catch((reason: Error) => setUploadError(reason.message))}>Resume analysis</button>}{uploadError && <p className="mt-3 text-sm text-rose-800" role="alert">{uploadError}</p>}</>
        )}

        {view === 'review' && job && (
          <div className="h-[calc(100vh-160px)]">
            <ReviewScreen
              job={job}
              onGenerate={handleGenerate}
              onJobChanged={setJob}
              generating={generateRequested}
            />
          </div>
        )}

        {view === 'generating' && job && <ProcessingPanel summary={job} title="Generating report files" />}

        {view === 'done' && job && (
          <DoneScreen
            job={job}
            onBackToReview={() => setReviewRequested(true)}
            onStartOver={handleStartOver}
          />
        )}

        {view === 'failed' && job && (
          <div className="card mx-auto w-full max-w-2xl p-8 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-rose-100">
              <svg className="h-9 w-9 text-rose-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 3.75h.008v.008H12v-.008ZM21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </div>
            <h2 className="mt-4 text-xl font-bold text-slate-900">Processing failed</h2>
            <ul className="mt-3 space-y-1 text-sm text-rose-700">
              {job.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
            <button className="btn-primary mt-6" onClick={handleStartOver}>
              Try again
            </button>
          </div>
        )}
        </>}
      </main>

      <footer className="border-t border-slate-200 bg-white py-3">
        <p className="text-center text-xs text-slate-400">
          Staff review required before filing or signing.
          {health?.engine === 'local'
            ? ' Engine: built-in rules (offline, $0).'
            : health?.model
              ? ` AI model: ${health.model}.`
              : ''}
        </p>
      </footer>
    </div>
  );
}
