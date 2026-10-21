/** Shared domain types for the Form 680 AutoNotes server. */
import type { Form680Spec } from './services/template680.js';

export type FieldType = 'text' | 'checkbox' | 'radio' | 'dropdown' | 'optionlist';

export interface TemplateFieldInfo {
  name: string;
  type: FieldType;
  /** Selectable options for radio / dropdown / optionlist fields. */
  options?: string[];
  /** True when a text field is multiline. */
  multiline?: boolean;
  /** Character limit for a text field, when the template defines one. */
  maxLength?: number;
  /** 1-based page number of the field's first widget. */
  page?: number;
}

export type FieldValue = string | boolean;

export interface FieldAssignment {
  field: string;
  value: FieldValue;
  /** Verbatim quote from the shift text justifying this assignment. */
  evidence?: string;
}

export interface ShiftRecord {
  /** 0-based position within the report (defines the form number). */
  index: number;
  date: string;
  shift: string;
  provider: string;
  mood: string;
  narrative: string;
  /** AI-produced, evidence-validated field assignments. */
  assignments: FieldAssignment[];
  /** Manual edits from the review screen. Overrides win over assignments. */
  overrides: Record<string, FieldValue>;
  warnings: string[];
}

export type JobStatus =
  | 'created'
  | 'processing'
  | 'review'
  | 'generating'
  | 'done'
  | 'failed';

export interface JobProgress {
  current: number;
  total: number;
}

export interface Job {
  id: string;
  profileId?: 'steven' | 'jerrell';
  completeRoutineFields?: boolean;
  createdAt: string;
  status: JobStatus;
  /** Human-readable stage line, e.g. "Analyzing shift 12 of 88...". */
  stage: string;
  progress: JobProgress;
  /** True when the job should generate + zip right after extraction. */
  autoGenerate: boolean;
  logFileName: string;
  templateFileName: string;
  /** 'builtin' when using the bundled Joy Group Home §680 template. */
  templateSource: 'builtin' | 'upload' | 'docx';
  /** Parsed §680 layout (builtin/docx templates) — enables Word printables. */
  form680Spec?: Form680Spec;
  templateFields: TemplateFieldInfo[];
  shifts: ShiftRecord[];
  errors: string[];
  warnings: string[];
  monthLabel?: string;
  zipName?: string;
  zipReady: boolean;
}

/** Compact snapshot pushed over SSE. */
export interface JobSummary {
  id: string;
  profileId?: 'steven' | 'jerrell';
  createdAt?: string;
  individualName?: string;
  logFileName?: string;
  monthLabel?: string;
  status: JobStatus;
  stage: string;
  progress: JobProgress;
  shiftsFound: number;
  formsCompleted: number;
  errors: string[];
  warningCount: number;
  zipName?: string;
  zipReady: boolean;
}

export interface ShiftDraft {
  date: string;
  shift: string;
  provider: string;
  mood: string;
  narrative: string;
}
