import type { FieldAssignment, FieldValue, TemplateFieldInfo } from '../types';

interface Props {
  field: TemplateFieldInfo;
  value: FieldValue | undefined;
  assignment: FieldAssignment | undefined;
  onChange: (value: FieldValue) => void;
}

/** Renders the right editor control for one template field. */
export function FieldInput({ field, value, assignment, onChange }: Props) {
  const evidence = assignment?.evidence;
  const aiBadge = assignment ? (
    <span
      title={evidence ? `AI evidence: "${evidence}"` : 'Filled by AI'}
      className="ml-1.5 inline-flex cursor-help items-center rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700"
    >
      AI
    </span>
  ) : null;

  if (field.type === 'checkbox') {
    return (
      <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
        />
        <span className="min-w-0 flex-1 truncate" title={field.name}>
          {field.name}
        </span>
        {aiBadge}
      </label>
    );
  }

  if (field.type === 'radio' || field.type === 'dropdown' || field.type === 'optionlist') {
    return (
      <div>
        <label className="mb-1 flex items-center text-xs font-semibold text-slate-600">
          {field.name}
          {aiBadge}
        </label>
        <select
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border-slate-300 bg-white text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
        >
          <option value="">— not selected —</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
    );
  }

  const text = typeof value === 'string' ? value : '';
  return (
    <div>
      <label className="mb-1 flex items-center text-xs font-semibold text-slate-600">
        {field.name}
        {aiBadge}
      </label>
      {field.multiline ? (
        <textarea
          value={text}
          rows={Math.min(8, Math.max(2, Math.ceil(text.length / 90)))}
          maxLength={field.maxLength}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border-slate-300 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
        />
      ) : (
        <input
          type="text"
          value={text}
          maxLength={field.maxLength}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border-slate-300 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
        />
      )}
    </div>
  );
}
