# Form §680 AutoNotes

Local application for **Form §680 daily notes, reviewed-file printing, and residential quarterly reports** for Steven and Jerrell. Upload staff logs, review extracted values, then download Word, printable PDF, or both. Read [memory.md](memory.md) for current architecture, validation, and operating limits. **Non-technical operators: start with [OPERATOR-GUIDE.md](OPERATOR-GUIDE.md)** (monthly routine, print batches, backups) and launch the app with `start-joyform.cmd`.

```
May2026_Forms.zip
├── Editable/            fillable AcroForm PDFs (text fields, checkboxes, radio buttons)
│   ├── Form001.pdf
│   ├── Form002.pdf
│   └── …
├── PDF/                 flattened print copies
│   └── Form001.pdf
└── Word/                individual Word copies
    └── Form001.docx
```

## How it works

1. **Daily reports** — select Steven or Jerrell, download a blank monthly entry workbook if needed, then upload a filled Word/PDF log. Each person has a separate saved daily Word template; replacement templates are checked against the selected identity.
2. **Extraction** — the server reads every page and extracts each shift (date, shift time, assigned provider, observed mood, full narrative). Two engines are available (see *Engines* below): the default **built-in rule engine** (offline, free) or an optional **AI engine**.
3. **Field mapping** — each shift is mapped onto the template's AcroForm fields: mood checkboxes (synonyms understood — *upbeat → Happy*, *easygoing → Calm*, *chatty → Outgoing*), support sections (hydration → Dehydration risk, insulin → Medication support, cooking → Outcome 4, outings → Outcome 2, laundry/housekeeping → Routine supports, taxi → Transportation, seizure monitoring → Risk 2, night checks → overnight documentation), activities, yes/no questions and the verbatim narrative.
4. **Review** — inspect each form and edit values. New site uploads default to evidence-only mapping. Optional routine draft defaults are unverified, clearly flagged, and require review; missing clinical facts must not be invented.
5. **Print files** — choose Word, PDF, or both; individual forms, one file per month, or small date batches. Four days per batch is the default. Date filters and a printed-through date allow resuming with an optional last-day check file. Downloads are manual and include a form/date/shift index. Duplex section starts do not configure the printer: select double-sided/long-edge in its print dialog.

**Saved reports** reopens persisted daily jobs without re-uploading. Changing print grouping does not re-run the note engine. Exports snapshot input files before processing so later report edits cannot mix revisions.

**Log writer** turns the house manager's key events (a day, a week or a month at a time) into a Daily Log Entry workbook: reported events are placed in the right shift boxes, while configured schedules produce separate review warnings rather than claims that care occurred. Only the reported day range is written. Drafts and per-person routine settings (staff roster, program schedule, medication times, weekly items, health reminders) are saved under `DATA_DIR/log-writer`. The preview flags wording the form mapper misreads and missing completion details; boxes can be edited by hand. "Create daily report" writes the workbook and starts the normal analyse → review → export flow with unsupported fields left for staff review.

**Voice notes** takes the house manager's voice messages (Telegram/WhatsApp OGG, MP3, M4A, WAV, …; one day or a whole month per file) or pasted text. Audio is transcribed on this machine by [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (`scripts/transcribe.py`, model `medium.en` by default, NVIDIA GPU when present, otherwise CPU) — no audio leaves the PC and no key is needed. The transcript is split into sentences with a date (spoken dates, "yesterday", "the next day", weekdays, else the file-name date), people (names + aliases, "both"), a shift (clock times and day-part words) and tags (topics, moods, program attendance, medical/behavior/incident flags), and rewritten as third-person past-tense documentation. Every sentence can be corrected before it is sent. "Send to Log writer" writes the sentences into each person's draft as `voice` events that replace the routine lines they cover (source-tagged, so re-sending replaces instead of duplicating) and stores the transcript in the draft's source notes. Voice drafts default to the *essentials* routine level. The Log writer preview warns when its day range overlaps days that already have forms in a saved daily report.

**Existing files** imports individual Word/PDF forms or ZIPs and uses the same print controls. Compatible fillable PDFs can transfer their existing values to Word; formatting and signature-font appearance may change. PDFs containing images require their original Word copies for Word export. Original uploaded files are preserved. Previously merged Word documents and flat PDFs without readable date/shift fields are not supported by this import path.

**Quarterly reports** accepts the residential quarterly Word layout with reporting-period header, status-description/plan-change cells, and closing questions. Steven's existing quarterly is a starting template; upload Jerrell's own quarterly template once and save it for later. New-quarter drafts clear old conclusions and completion details. Selected daily jobs supply dated source excerpts, not invented conclusions. A reviewer enters statuses/narratives and confirms the draft before Word/PDF/ZIP export. Existing-copy mode preserves the original Word document byte-for-byte and disallows edits.

## Engines — zero-cost by default

| Engine | Cost | Network | How it works |
| --- | --- | --- | --- |
| `local` *(default)* | **$0** | none — fully offline | Deterministic rule engine: line-based shift parser + curated synonym/keyword tables (moods, support sections, support levels, activities). |
| `ai` *(optional)* | provider fees | OpenAI-compatible API | LLM semantic extraction & mapping for unusual report wording. |

Set `ENGINE=local`, `ENGINE=ai`, or `ENGINE=auto` (default — uses `ai` only when an `AI_API_KEY` is configured, otherwise `local`). **With no `.env` at all, the app runs entirely free.** Both engines feed the exact same evidence validator, review UI and PDF generator.

### Anti-hallucination by design

Mapped assignments carry source evidence and pass an evidence validator. The optional legacy routine completion policy adds draft defaults without evidence; those fields are not observations and must be checked by staff. Existing saved reports are not remapped during export. The software does not verify clinical truth or replace staff approval.

### Performance

- Shifts are analyzed with configurable parallelism (`AI_CONCURRENCY`; the local engine is near-instant).
- PDFs are generated in parallel (`PDF_CONCURRENCY`).
- Every AI response is cached on disk by content hash — re-running the same report never repeats an AI call. (The local engine needs no cache and never makes network calls.)
- Live progress via Server-Sent Events: shifts found, current shift being analyzed, PDFs generated, errors.

## Tech stack

| Layer     | Technology |
|-----------|------------|
| Frontend  | React 18, TypeScript, Tailwind CSS, Vite |
| Backend   | Node.js 20+, Express, TypeScript (ESM) |
| PDF       | `pdf-lib` (AcroForm creation/filling/flattening), `pdfjs-dist` (text extraction) |
| AI        | Any OpenAI-compatible chat-completions API (OpenAI, Azure, OpenRouter, Groq, Together, local Ollama/LM Studio) |
| Packaging | `archiver` (ZIP), npm workspaces monorepo, Docker |

```
├── server/               Express API + processing pipeline
│   └── src/
│       ├── routes/       REST + SSE endpoints
│       ├── services/
│       │   ├── ai/       optional AI engine: client, shift extractor, field mapper (evidence validation)
│       │   ├── local/    default zero-cost engine: rule-based extractor + mapper
│       │   ├── logWriter/  key events + routine library → filled Daily Log Entry workbook
│       │   ├── voice/    voice notes: store, transcription queue, transcript parser, Log writer merge
│       │   ├── template680.ts   built-in fillable §680 AcroForm generator
│       │   ├── formFiller.ts    editable + flattened PDF filling
│       │   ├── jobManager.ts    job orchestration, persistence, SSE events
│       │   ├── pdfText.ts       PDF text extraction
│       │   ├── cache.ts         content-addressed AI response cache
│       │   └── zipper.ts        ZIP packaging
│       └── utils/
├── web/                  React frontend
│   └── src/
│       ├── components/   upload, progress, review/editor, done screens
│       └── hooks/        SSE job-event subscription
└── scripts/
    ├── e2e.mjs                    full end-to-end test (stub AI, real pipeline)
    ├── make-samples.mjs           generates a sample shift-log PDF
    ├── build-entry-workbook.mjs   generates monthly Daily Log Entry workbooks (.docx) staff fill in
    ├── site-workbook.mjs / site-workbook-fill.mjs   blank / filled workbooks for the server (roster-aware)
    ├── fill-september-2026.mjs    command-line predecessor of the Log writer (Sep 2026 events)
    ├── test-log-writer.mjs        real-HTTP check of the Log writer API (npm run test:writer)
    ├── transcribe.py              faster-whisper CLI used by the server (--check, --download, --jobs)
    ├── setup-voice.ps1            installs private Python 3.12 + faster-whisper (+ CUDA libs) + model into tools/whisper
    ├── make-test-voice.ps1 / wav-to-ogg.py   synthetic Telegram-style voice note for tests
    └── test-voice.mjs             real-HTTP voice check: transcribe → sentences → drafts → forms (npm run test:voice)
```

## Quick start

### Prerequisites

- Node.js >= 20. An AI provider key is needed only for the optional AI engine.
- LibreOffice is required for template-faithful rendering and quarterly PDFs. Set `SOFFICE_PATH` if it is not detected automatically. Word quarterly downloads remain available if PDF conversion fails.
- Voice notes (optional): run `setup-voice.cmd` once on Windows (internet once, ~2 GB into `tools/whisper`: embeddable Python 3.12, faster-whisper, NVIDIA cuBLAS/cuDNN when `nvidia-smi` exists, model `medium.en`). Elsewhere create `tools/whisper/venv` with `pip install faster-whisper` and run `python scripts/transcribe.py --models-dir tools/whisper/models --download medium.en`, or point `WHISPER_PYTHON` at any Python that has faster-whisper. Without it, pasted text reports still work.
- This app has no authentication; keep it local or behind an authenticated private gateway. Do not expose clinical documents on a public port.

### 1. Run (production)

```bash
npm install
npm run build
npm start          # serves API + frontend on http://localhost:8787 — free local engine
```

### 2. Run (development)

```bash
npm install
npm run dev
```

- Frontend (with hot reload): http://localhost:5173
- API: http://localhost:8787

### 3. Optional: enable the AI engine

```bash
cp .env.example .env
# set AI_API_KEY (and AI_BASE_URL/AI_MODEL if not using OpenAI), then restart
```

### 4. Try it without real data

```bash
npm run make-samples   # writes samples/Sample_ShiftLog_May2026.pdf (9 shifts)
```

Upload the sample at http://localhost:8787.

## Docker

```bash
docker compose up --build   # zero-config: runs the free local engine
```

The app is served on http://localhost:8787. Uploads, caches and generated ZIPs persist in the `form680-data` volume. To use the AI engine instead, `cp .env.example .env` and set `AI_API_KEY` first. The image does not contain the voice-transcription engine (`tools/` is excluded); the Voice notes tab then accepts pasted text only.

Plain Docker:

```bash
docker build -t form680-autonotes .
docker run -d -p 8787:8787 -v form680-data:/app/data form680-autonotes            # local engine ($0)
docker run -d -p 8787:8787 -e AI_API_KEY=sk-... -v form680-data:/app/data form680-autonotes   # AI engine
```

## Configuration

All settings via environment variables (see `.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `ENGINE` | `auto` | `local` (built-in rules, offline, $0), `ai` (LLM), or `auto` (`ai` when configured, else `local`). |
| `AI_API_KEY` | — | API key for the AI engine. Not needed for the local engine or keyless local endpoints (`AI_BASE_URL` on localhost). |
| `AI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible base URL. |
| `AI_MODEL` | `gpt-4o-mini` | Chat model used for extraction and mapping. |
| `AI_CONCURRENCY` | `4` | Shifts analyzed in parallel. |
| `AI_MAX_RETRIES` | `3` | Retries per AI call on 429/5xx/network errors (exponential backoff). |
| `AI_TIMEOUT_MS` | `120000` | Per-request AI timeout. |
| `PORT` | `8787` | Server port. |
| `DATA_DIR` | `./data` | Uploads, job state, AI cache, generated output. |
| `MAX_UPLOAD_MB` | `50` | Max size per uploaded file. |
| `PDF_CONCURRENCY` | `6` | PDFs generated in parallel. |
| `JOB_TTL_HOURS` | `0` | Default: retain saved reports. A positive explicit value deletes older daily jobs on startup. |
| `WEB_DIST` | `../web/dist` | Path to built frontend (already set in Docker). |
| `WHISPER_PYTHON` | — | Python with faster-whisper for voice notes. Default: `tools/whisper/python/python.exe`, then `tools/whisper/venv/bin/python`, then `python3`. |
| `WHISPER_MODELS_DIR` | `tools/whisper/models` | Where speech models are stored/downloaded. |

## API reference

| Method & path | Description |
|---------------|-------------|
| `GET /api/health` | Health + active engine (`local`/`ai`). |
| `GET /api/jobs` | List saved daily reports. |
| `GET /api/templates/profiles` | Daily and quarterly template availability per person. |
| `GET /api/templates/:profile/workbook.docx?month=YYYY-MM` | Blank entry workbook for the selected person/month (staff names from the saved roster). |
| `GET/PUT /api/log-writer/settings/:profile` | Routine settings (roster, program, medication times, weekly items, health toggles, housemate, interests). |
| `GET/PUT /api/log-writer/drafts/:profile/:month` | Saved key-event draft for a person and month. |
| `POST /api/log-writer/preview` | Draft → every shift box as it would be written, with wording warnings and assumptions. |
| `POST /api/log-writer/workbook` | Draft → filled Daily Log Entry workbook (.docx download). |
| `POST /api/log-writer/jobs` | Draft → workbook → daily report job (saved template, routine completion on, stops at review). |
| `GET /api/voice/status` | Speech engine status (`?refresh=1` re-checks). |
| `GET/PUT /api/voice/settings` | Model, device, language, extra vocabulary, spelling fixes. |
| `GET/POST /api/voice/notes` | List notes / upload audio (multipart `files[]`, `referenceDate` fallback). |
| `POST /api/voice/notes/text` | Add a typed report `{text, referenceDate, title}`. |
| `GET/PATCH/DELETE /api/voice/notes/:id` | Read; update `referenceDate`, `transcript` (re-read) or reviewed `items`; delete (also removes its sentences from drafts). |
| `POST /api/voice/notes/:id/reanalyze` · `/retranscribe` · `GET …/audio` | Re-read the transcript, transcribe again, stream the audio. |
| `POST /api/voice/apply` | `{noteIds}` → write the notes into every person/month draft they mention. |
| `POST /api/exports` | Snapshot and queue Word/PDF exports of a completed job or imported collection. |
| `GET /api/exports/:id` | Export status and artifact list. |
| `GET /api/exports/:id/download?artifact=0` | ZIP, or a selected file when artifact is supplied. |
| `GET/POST /api/imports` | List/import previously reviewed forms; multipart files plus profileId and convertToWord. |
| `GET/POST /api/quarterly` | List/create quarterly drafts. |
| `GET/PATCH /api/quarterly/:id` | Read/update a quarterly draft. |
| `POST /api/quarterly/:id/generate` | Confirm reviewer and prepare Word/PDF/ZIP. |
| `GET /api/quarterly/:id/download?format=word` | Quarterly Word, PDF, or ZIP download. |
| `POST /api/jobs` | Create a job. Multipart: `log` (required, PDF or Word `.docx`), `template` (optional fillable PDF or Word `.docx`), `autoGenerate` (`"true"` to skip review). |
| `POST /api/jobs/:id/extract` | Start reading/extraction/mapping (202, async). |
| `GET /api/jobs/:id` | Full job state: status, stage, progress, shifts, per-shift field values, warnings, errors. |
| `GET /api/jobs/:id/events` | Server-Sent Events stream of live progress summaries. |
| `PATCH /api/jobs/:id/shifts/:index` | Save review edits: `{"overrides": {"Field Name": value}}` (string for text/radio, boolean for checkboxes). |
| `GET /api/jobs/:id/shifts/:index/preview.pdf` | Rendered PDF for one shift (`?flatten=1` for the print version). |
| `POST /api/jobs/:id/generate` | Generate all PDFs + ZIP (202, async). |
| `GET /api/jobs/:id/download` | Download the finished ZIP. |
| `GET /api/templates/builtin-680.pdf` | The built-in blank fillable §680 template. |

## Custom templates

Any **fillable PDF** (with AcroForm fields) can be uploaded as the template — shift data is mapped onto whatever text fields, checkboxes, radio groups and dropdowns it finds, using the field names and options as the guide. Templates without form fields are rejected with a clear error (a scan/flat PDF cannot be filled programmatically). When no template is uploaded, the built-in Form §680 — text fields, 40+ mood checkboxes, per-section support-type radio groups and documentation fields — is used.

A **Word `.docx`** §680 template can be uploaded directly too. Word exports flat PDFs (no form fields), so instead of asking you to convert it, the server parses the document — organisation header, name/ID, shift options, mood checklist, Outcome / Identified Risk / Potential Risk / Routine Support sections with their TYPE OF SUPPORTS options, and the end-of-shift yes/no questions — and rebuilds it as a genuinely fillable AcroForm PDF with the same field-naming conventions the mapper understands. Legacy binary `.doc` files are not supported; re-save them as `.docx` first.

## Testing

Current report workflows (no client data is modified):

```bash
npm run build
npm run test:reports
npm run test:site
npm run test:writer   # needs the server running on :8787; creates and removes one throwaway job
npm run test:voice    # needs the server + voice engine; synthetic voice note (Dec 2030) → forms, cleaned up afterwards
```

The site test uses a temporary data directory and localhost port. It exercises both profiles, workbooks, generation, imports, exports, and quarterly rendering. LibreOffice must be installed. Print-file validation cannot guarantee completion on every physical printer; use small batches and verify the last printed form.

A full end-to-end test drives the real pipeline twice — once against a deterministic stub AI server (AI engine path) and once with **no AI at all** (local engine path) — covering upload → extraction → mapping → review edit → preview → generation → ZIP verification, including AcroForm editability and flattening checks. No API key or network access is needed:

```bash
npm run build
npm run e2e
```

Type checking: `npm run typecheck`.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| *"AI engine selected but not configured"* banner | Set `AI_API_KEY` in `.env`, or set `ENGINE=local` (or just remove `ENGINE=ai`) to use the free rule engine. |
| Upload rejected: *template has no fillable form fields* | The uploaded template is a flat/scanned PDF (Word's PDF export does this). Upload the original Word `.docx` instead — it is converted to a fillable PDF automatically — or export a fillable PDF, or omit the template to use the built-in §680. |
| AI calls time out | Increase `AI_TIMEOUT_MS`; large chunks + slow models can exceed the default. |
| 429 rate limits from the provider | Lower `AI_CONCURRENCY`; retries with backoff are automatic. |
| Fields left blank on some forms | By design: no verifiable evidence was found in that shift's text. Check the per-form warnings in the review screen and fill manually if needed. |
| Re-running the same report is instant | Expected — AI responses are content-cached in `DATA_DIR/cache`. Delete that folder to force fresh calls. |
