import { z } from 'zod';

export function calendarDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

const optionalDate = z.preprocess((value) => value === '' ? undefined : value, z.string().refine(calendarDate, 'Use a valid calendar date.').optional());

export const exportOptionsSchema = z.object({
  format: z.enum(['word', 'pdf', 'both']).default('word'),
  layout: z.enum(['individual', 'merged', 'parts']).default('parts'),
  daysPerPart: z.number().int().min(1).max(7).default(4),
  duplex: z.boolean().default(true),
  fromDate: optionalDate,
  toDate: optionalDate,
  printedThrough: optionalDate,
  includeBoundary: z.boolean().default(true),
  includePrinted: z.boolean().default(false),
}).refine((options) => !options.fromDate || !options.toDate || options.fromDate <= options.toDate, 'Start date must not follow end date.');

export type ExportOptions = z.infer<typeof exportOptionsSchema>;

export interface ExportForm {
  index: number;
  date: string;
  shift: string;
  provider: string;
  wordPath?: string;
  pdfPath?: string;
}

export interface ExportGroup {
  name: string;
  fromDate: string;
  toDate: string;
  forms: ExportForm[];
  check: boolean;
  alreadyPrinted: boolean;
}

export function isoFormDate(value: string): string {
  if (calendarDate(value)) return value;
  const match = value.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const month = match ? months.indexOf(match[1].toLowerCase()) + 1 : 0;
  const result = match && month ? `${match[3]}-${String(month).padStart(2, '0')}-${match[2].padStart(2, '0')}` : '';
  if (!calendarDate(result)) throw new Error(`Unrecognized form date: ${value}`);
  return result;
}

export function planExport(forms: ExportForm[], label: string, input: ExportOptions): ExportGroup[] {
  const options = exportOptionsSchema.parse(input);
  const selected = forms.map((form) => ({ ...form, date: isoFormDate(form.date) }))
    .filter((form) => (!options.fromDate || form.date >= options.fromDate) && (!options.toDate || form.date <= options.toDate))
    .filter((form) => !options.printedThrough || options.includePrinted || form.date > options.printedThrough || (options.includeBoundary && form.date === options.printedThrough))
    .sort((left, right) => left.date.localeCompare(right.date) || left.index - right.index);
  if (!selected.length) throw new Error('No forms fall within the selected dates.');
  const safeLabel = label.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80) || 'Report';
  const partitions = new Map<string, ExportForm[]>();
  for (const form of selected) {
    const status = options.printedThrough && form.date === options.printedThrough && options.includeBoundary ? 'check' : options.printedThrough && form.date <= options.printedThrough ? 'printed' : 'remaining';
    const key = `${form.date.slice(0, 7)}:${status}`;
    partitions.set(key, [...(partitions.get(key) ?? []), form]);
  }
  const groups: ExportGroup[] = [];
  for (const [key, partition] of partitions) {
    const dates = [...new Set(partition.map((form) => form.date))];
    const chunks = options.layout === 'individual' ? partition.map((form) => [form]) : options.layout === 'merged' ? [partition] :
      Array.from({ length: Math.ceil(dates.length / options.daysPerPart) }, (_, offset) => {
        const chunkDates = new Set(dates.slice(offset * options.daysPerPart, (offset + 1) * options.daysPerPart));
        return partition.filter((form) => chunkDates.has(form.date));
      });
    for (const chunk of chunks) {
      const fromDate = chunk[0].date;
      const toDate = chunk[chunk.length - 1].date;
      const check = key.endsWith(':check');
      const alreadyPrinted = key.endsWith(':printed');
      const range = fromDate === toDate ? fromDate : `${fromDate}_to_${toDate}`;
      const part = options.layout === 'individual' ? `Form${String(chunk[0].index + 1).padStart(3, '0')}` : `Part${String(groups.length + 1).padStart(2, '0')}`;
      groups.push({ name: `${safeLabel}_${part}_${range}${check ? '_CHECK_LAST_DAY' : alreadyPrinted ? '_ALREADY_PRINTED' : ''}`, fromDate, toDate, forms: chunk, check, alreadyPrinted });
    }
  }
  return groups;
}