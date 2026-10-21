import { useCallback, useState, type DragEvent, type ChangeEvent } from 'react';

interface Props {
  label: string;
  description: string;
  file: File | undefined;
  onFile: (file: File | undefined) => void;
  optional?: boolean;
  /** Accepted extensions (lowercase, with dot). Defaults to [".pdf"]. */
  extensions?: string[];
  /** Human label for the accepted types, e.g. "PDF or Word (.docx)". */
  typeLabel?: string;
}

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export function UploadDropzone({
  label,
  description,
  file,
  onFile,
  optional,
  extensions = ['.pdf'],
  typeLabel = 'PDF',
}: Props) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string>();

  const acceptAttr = extensions.flatMap((ext) => [MIME_BY_EXT[ext] ?? '', ext]).filter(Boolean).join(',');

  const accept = useCallback(
    (candidate: File | undefined) => {
      setError(undefined);
      if (!candidate) return;
      const name = candidate.name.toLowerCase();
      const ok = extensions.some((ext) => name.endsWith(ext) || candidate.type === MIME_BY_EXT[ext]);
      if (!ok) {
        setError(`Only ${typeLabel} files are accepted.`);
        return;
      }
      onFile(candidate);
    },
    [onFile, extensions, typeLabel],
  );

  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragging(false);
    accept(e.dataTransfer.files?.[0]);
  };

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    accept(e.target.files?.[0] ?? undefined);
    e.target.value = '';
  };

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-slate-800">{label}</span>
        {optional && <span className="text-xs font-medium text-slate-400">optional</span>}
      </div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-5 text-center transition ${
          dragging
            ? 'border-indigo-500 bg-indigo-50'
            : file
              ? 'border-emerald-400 bg-emerald-50/60'
              : 'border-slate-300 bg-slate-50 hover:border-indigo-400 hover:bg-indigo-50/40'
        }`}
      >
        <input type="file" aria-label={label} accept={acceptAttr} className="sr-only" onChange={onChange} />
        {file ? (
          <>
            <svg className="h-7 w-7 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            <span className="max-w-full truncate text-sm font-medium text-emerald-800">{file.name}</span>
            <span className="text-xs text-emerald-700">{(file.size / 1024 / 1024).toFixed(2)} MB — click or drop to replace</span>
          </>
        ) : (
          <>
            <svg className="h-7 w-7 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
            </svg>
            <span className="text-sm font-medium text-slate-600">
              Choose {typeLabel}
            </span>
            <span className="text-xs text-slate-400">{description}</span>
          </>
        )}
      </label>
      {error && <p className="mt-1.5 text-xs font-medium text-rose-600">{error}</p>}
    </div>
  );
}
