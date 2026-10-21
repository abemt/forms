/** Types mirrored from the server API. */

export type FieldType = 'text' | 'checkbox' | 'radio' | 'dropdown' | 'optionlist';

export interface TemplateFieldInfo {
  name: string;
  type: FieldType;
  options?: string[];
  multiline?: boolean;
  maxLength?: number;
  page?: number;
}

export type FieldValue = string | boolean;

export interface FieldAssignment {
  field: string;
  value: FieldValue;
  evidence?: string;
}

export interface ShiftDetail {
  index: number;
  date: string;
  shift: string;
  provider: string;
  mood: string;
  narrative: string;
  assignments: FieldAssignment[];
  overrides: Record<string, FieldValue>;
  warnings: string[];
  values: Record<string, FieldValue>;
}

export type JobStatus = 'created' | 'processing' | 'review' | 'generating' | 'done' | 'failed';

export interface JobSummary {
  id: string;
  profileId?: ProfileId;
  individualName?: string;
  createdAt?: string;
  monthLabel?: string;
  logFileName?: string;
  status: JobStatus;
  stage: string;
  progress: { current: number; total: number };
  shiftsFound: number;
  formsCompleted: number;
  errors: string[];
  warningCount: number;
  zipName?: string;
  zipReady: boolean;
}

export interface JobDetail extends JobSummary {
  autoGenerate: boolean;
  completeRoutineFields?: boolean;
  logFileName: string;
  templateFileName: string;
  templateSource: 'builtin' | 'upload' | 'docx';
  templateFields: TemplateFieldInfo[];
  monthLabel?: string;
  warnings: string[];
  shifts: ShiftDetail[];
}

export interface HealthInfo {
  ok: boolean;
  engine: 'local' | 'ai';
  aiConfigured: boolean;
  model: string;
}

export type ProfileId = 'steven' | 'jerrell';
export interface ProfileInfo {
  id: ProfileId;
  name: string;
  dailyTemplate: boolean;
  quarterlyTemplate: boolean;
}

/** Log Writer: key events + routine -> filled Daily Log Entry workbook. */
export type WriterShift = 'auto' | 'day' | 'evening' | 'night';
export type WriterEventKind = 'outing' | 'meal_out' | 'shopping' | 'appointment' | 'visit' | 'away' | 'holiday' | 'home' | 'cooked' | 'laundry' | 'chore' | 'incident' | 'note' | 'voice' | 'program';
export interface WriterEvent {
  id: string;
  day: number;
  shift: WriterShift;
  kind: WriterEventKind;
  place: string;
  details: string;
  meal?: 'breakfast' | 'lunch' | 'dinner';
  withHousemate: boolean;
  mood: string;
  slots?: string[];
  source?: string;
}
export type RoutineLevel = 'full' | 'essentials' | 'none';
export interface WriterDraft {
  profileId: ProfileId;
  month: string;
  fromDay: number;
  toDay: number;
  closures: { day: number; reason: string }[];
  events: WriterEvent[];
  overrides: Record<string, { mood?: string; notes?: string }>;
  sourceNotes: string;
  routineLevel?: RoutineLevel;
}
export interface WriterRoster {
  weekdayDay: string;
  weekdayEvening: string;
  weekdayNight: string;
  weekendDay: string;
  weekendEvening: string;
  weekendNight: string;
}
export interface WriterSettings {
  roster: WriterRoster;
  program: { name: string; days: number[]; leaveTime: string; returnTime: string; attends: boolean };
  housemateProgramDays: number[];
  laundryDay: number | null;
  medTimes: { morning: string; evening: string };
  weekly: { fridayMeeting: boolean; sundayMoney: boolean; saturdayGrocery: boolean };
  health: { seizureChecks: boolean; diabetes: boolean; gout: boolean; bowelWatch: boolean };
  housemate: string;
  interests: string[];
  aliases: string[];
}
export type LineSource = 'routine' | 'event' | 'voice' | 'edited';
export interface WriterBox {
  day: number;
  date: string;
  weekday: string;
  shift: 'day' | 'evening' | 'night';
  shiftLabel: string;
  provider: string;
  mood: string;
  notes: string;
  lines: { text: string; source: LineSource }[];
  eventLines: number;
  voiceLines: number;
  warnings: string[];
  edited: boolean;
}
export interface WriterPreview {
  profileId: ProfileId;
  individualName: string;
  month: string;
  monthName: string;
  year: number;
  fromDay: number;
  toDay: number;
  boxes: WriterBox[];
  assumptions: string[];
}

/** Voice notes: offline transcription -> dated sentences -> Log writer drafts. */
export interface VoiceItem {
  id: string;
  date: string;
  people: string[];
  shift: 'day' | 'evening' | 'night';
  text: string;
  original: string;
  topics: string[];
  moods: string[];
  moodAllDay?: boolean;
  program?: 'attended' | 'home';
  flags: ('health' | 'behavior' | 'incident')[];
  dateReason: string;
  shiftReason: string;
  excluded?: boolean;
}
export type VoiceNoteStatus = 'queued' | 'transcribing' | 'done' | 'failed';
export interface VoiceNoteSummary {
  id: string;
  kind: 'audio' | 'text';
  fileName: string;
  size: number;
  uploadedAt: string;
  updatedAt: string;
  recordedOn?: string;
  referenceDate: string;
  status: VoiceNoteStatus;
  progress?: number;
  error?: string;
  model?: string;
  device?: string;
  duration?: number;
  itemCount: number;
  dates: string[];
  appliedAt?: string;
  appliedTo?: string[];
}
export interface VoiceNote extends Omit<VoiceNoteSummary, 'itemCount' | 'dates'> {
  transcript?: string;
  editedTranscript?: string;
  items?: VoiceItem[];
  skipped?: string[];
  itemsEdited?: boolean;
}
export interface VoiceEngineStatus {
  engine: { ok: boolean; python?: string; fasterWhisper?: string; cudaDevices?: number; cudaLibraries?: boolean; models: string[]; error?: string };
  queue: { running: boolean; current?: string; model?: string; device?: string; message?: string };
}
export interface VoiceSettings {
  model: string;
  device: 'auto' | 'cpu' | 'cuda';
  language: string;
  vocabulary: string;
  corrections: { from: string; to: string }[];
}
export interface AppliedDraft {
  profileId: ProfileId;
  month: string;
  fromDay: number;
  toDay: number;
  voiceEvents: number;
  days: number[];
}
export interface DailyInput {
  log: File;
  template?: File;
  profileId: ProfileId;
  saveTemplate: boolean;
  completeRoutineFields: boolean;
  autoGenerate: boolean;
}
export interface ExportOptions {
  format: 'word' | 'pdf' | 'both';
  layout: 'individual' | 'merged' | 'parts';
  daysPerPart: number;
  duplex: boolean;
  fromDate?: string;
  toDate?: string;
  printedThrough?: string;
  includeBoundary: boolean;
  includePrinted: boolean;
}
export interface ExportRecord {
  id: string;
  sourceId: string;
  label: string;
  status: 'queued' | 'building' | 'done' | 'failed';
  options: ExportOptions;
  error?: string;
  artifacts: { name: string; format: 'word' | 'pdf'; fromDate: string; toDate: string; forms: number; pages?: number; check: boolean; alreadyPrinted: boolean }[];
}

export interface QuarterlyField {
  id: string;
  group: string;
  label: string;
  type: 'text' | 'choice' | 'date';
  value: string;
  options?: string[];
}
export interface QuarterlyReport {
  id: string;
  profileId: ProfileId;
  createdAt: string;
  updatedAt: string;
  mode: 'new' | 'copy';
  templateName: string;
  status: 'review' | 'building' | 'done' | 'failed';
  spec: { individualName: string; fields: QuarterlyField[] };
  values: Record<string, string>;
  sources: { jobId: string; date: string; shift: string; topic: string; text: string }[];
  reviewer?: string;
  reviewedAt?: string;
  pdfReady?: boolean;
  warning?: string;
}
export interface QuarterlySummary {
  id: string;
  profileId: ProfileId;
  individualName: string;
  updatedAt: string;
  status: QuarterlyReport['status'];
  periodStart: string;
  periodEnd: string;
}
export interface QuarterlyInput {
  profileId: ProfileId;
  mode: 'new' | 'copy';
  periodStart: string;
  periodEnd: string;
  quarter: string;
  sourceJobIds: string[];
  saveTemplate: boolean;
}

export interface PrintCollection {
  id: string;
  profileId: ProfileId;
  label: string;
  createdAt: string;
  warnings: string[];
  forms: { index: number; date: string; shift: string; provider: string; originalName: string; wordFile?: string; pdfFile?: string }[];
}
