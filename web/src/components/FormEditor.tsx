import { useMemo } from 'react';
import type { FieldValue, ShiftDetail, TemplateFieldInfo } from '../types';
import { FieldInput } from './FieldInput';

interface Props {
  shift: ShiftDetail;
  fields: TemplateFieldInfo[];
  values: Record<string, FieldValue>;
  onChange: (field: string, value: FieldValue) => void;
}

type Block =
  | { kind: 'checkboxes'; fields: TemplateFieldInfo[] }
  | { kind: 'single'; field: TemplateFieldInfo };

/** Group consecutive checkboxes into grids; render other fields full width. */
function buildBlocks(fields: TemplateFieldInfo[]): Block[] {
  const blocks: Block[] = [];
  for (const field of fields) {
    if (field.type === 'checkbox') {
      const last = blocks[blocks.length - 1];
      if (last && last.kind === 'checkboxes') last.fields.push(field);
      else blocks.push({ kind: 'checkboxes', fields: [field] });
    } else {
      blocks.push({ kind: 'single', field });
    }
  }
  return blocks;
}

export function FormEditor({ shift, fields, values, onChange }: Props) {
  const blocks = useMemo(() => buildBlocks(fields), [fields]);
  const assignmentByField = useMemo(() => {
    const map = new Map(shift.assignments.map((a) => [a.field, a]));
    return map;
  }, [shift.assignments]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Extracted from the report
        </h3>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-slate-500">Date</dt>
            <dd className="font-medium text-slate-800">{shift.date || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Shift</dt>
            <dd className="font-medium text-slate-800">{shift.shift || '—'}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs text-slate-500">Provider</dt>
            <dd className="font-medium text-slate-800">{shift.provider || '—'}</dd>
          </div>
          <div className="col-span-2 sm:col-span-4">
            <dt className="text-xs text-slate-500">Observed mood</dt>
            <dd className="font-medium text-slate-800">{shift.mood || '—'}</dd>
          </div>
        </dl>
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium text-indigo-600">
            Show source narrative
          </summary>
          <p className="mt-2 whitespace-pre-wrap rounded-lg bg-white p-3 text-xs leading-relaxed text-slate-600">
            {shift.narrative}
          </p>
        </details>
      </div>

      {shift.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h3 className="text-sm font-semibold text-amber-800">
            Warnings for this form ({shift.warnings.length})
          </h3>
          <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-xs text-amber-700">
            {shift.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {blocks.map((block, i) =>
        block.kind === 'checkboxes' ? (
          <div key={i} className="grid grid-cols-1 gap-x-4 rounded-xl border border-slate-200 p-3 sm:grid-cols-2 lg:grid-cols-3">
            {block.fields.map((f) => (
              <FieldInput
                key={f.name}
                field={f}
                value={values[f.name]}
                assignment={assignmentByField.get(f.name)}
                onChange={(v) => onChange(f.name, v)}
              />
            ))}
          </div>
        ) : (
          <FieldInput
            key={block.field.name}
            field={block.field}
            value={values[block.field.name]}
            assignment={assignmentByField.get(block.field.name)}
            onChange={(v) => onChange(block.field.name, v)}
          />
        ),
      )}
    </div>
  );
}
