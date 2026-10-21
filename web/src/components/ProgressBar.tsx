interface Props {
  current: number;
  total: number;
  indeterminate?: boolean;
}

export function ProgressBar({ current, total, indeterminate }: Props) {
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
      {indeterminate ? (
        <div className="h-full w-1/3 animate-pulse rounded-full bg-indigo-500" />
      ) : (
        <div
          className="h-full rounded-full bg-indigo-600 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      )}
    </div>
  );
}
