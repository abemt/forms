# Operator guide — Form §680 AutoNotes

Everything you need to run the monthly and quarterly paperwork yourself, with no developer
involved. Technical details are in [README.md](README.md); project history and verified
behaviour are in [memory.md](memory.md).

## 1. Start the app

1. Double-click `start-joyform.cmd` (or run `npm start` inside this folder). It builds nothing;
   it starts the already-built server on http://localhost:8787 and keeps all saved reports
   (`JOB_TTL_HOURS=0`).
2. Open http://localhost:8787 in Edge or Chrome.
3. Close the black window to stop the app. Data lives in `server\data` — see section 9.

Requirements already on this PC: Node.js (`C:\Program Files\nodejs`), LibreOffice
(`C:\Program Files\LibreOffice\program\soffice.exe`, used for template rendering and PDFs) and the
voice-note engine (`tools\whisper`, installed by `setup-voice.cmd`).
No internet connection and no AI key are needed; everything runs on the built-in rule engine.

If the code ever changes: `npm install`, then `npm run build`, then start again.

## 2. The six tabs

| Tab | Use it for |
| --- | --- |
| **Daily reports** | Upload a filled Daily Log Entry workbook (Word) or a shift-log PDF → analyse → review → export Form §680 daily notes. Also downloads a blank workbook for any month. |
| **Log writer** | Type the key events the house manager reports; the app writes the whole workbook (routine + events) and can start the daily report from it directly. |
| **Voice notes** | Add her voice messages (or paste a typed message). They are transcribed on this PC, split into day / person / shift sentences and sent into the Log writer. |
| **Quarterly reports** | Fill the residential quarterly Word template from selected daily reports, review, export Word/PDF/ZIP. |
| **Existing files** | Re-package forms that already exist (Word/PDF/ZIP) into print files, optionally converting fillable PDFs to Word. |
| **Saved reports** | Reopen any earlier daily report (review again or make new print files). |

## 3. Monthly routine — from the house manager's messages

This is the path used for September 2026 and the one to use from now on. Her **voice notes** go
through 3A first and then continue at step 5 of 3B; typed key events use 3B alone.

### 3A. Her voice notes (Voice notes tab)

One-time setup per PC (already done on this one): double-click `setup-voice.cmd`. It needs internet
once (about 2 GB: a private Python, the speech engine and the `medium.en` speech model in
`tools\whisper`). The tab then says **Speech engine ready (… NVIDIA GPU)**. Without an NVIDIA card it
still works on the processor, only slower.

1. **Save her voice messages as files.** Telegram Desktop: right-click the voice message → *Save As*.
   For a whole week or month at once: open her chat → ⋮ → *Export chat history* → tick only
   *Voice messages*; the export folder has `voice_messages\audio_…ogg` files. Telegram and WhatsApp
   file names contain the recording date, which the app reads.
2. **Voice notes → Add voice notes** → choose one or many files → **Add and transcribe**. The
   "Today" date is only used for files without a date in their name. Status goes *queued →
   transcribing → done*; on this PC a minute of speech takes well under a minute. A typed message
   (SMS, e-mail) goes into **Or paste a typed report** with the date she sent it.
3. **Open** each note and check it — this replaces texting me:
   - Play the audio and correct misheard words in **Transcript** → **Save transcript and read again**.
     Wrong names every time? Add a **spelling fix** under *Voice settings* (e.g. Natanael →
     Nathanael), or another name for a resident under Log writer → Routine settings → **Name aliases**.
     Places, foods and medicines she uses go into *Voice settings* → *Extra words to expect*.
   - Under **What goes into the log**, every sentence has a **date**, **person** (Steve, Jerrell or
     Both), **shift** and the documentation wording; the grey "heard:" line is what she actually said
     and hovering it shows why that date and shift were chosen. Fix any of them, untick sentences
     that are not for the log (instructions to staff, questions, other people), **Save changes**.
   - How it decides: a spoken date ("September 15th", "the 15th", "yesterday", "the next day",
     "on Monday") moves the following sentences to that day; otherwise the note's date is used.
     Clock times and words pick the shift: morning/afternoon/program → day box, evening/dinner →
     evening box, night/overnight/slept → overnight box; nothing said → day box.
   - Red tags (medical, behavior, incident) set Medical / Behavioral / Serious Incident = **Yes** on
     that form. Keep them only when that is what happened.
4. **Send to Log writer**: tick the finished notes (or **Select all finished**) → **Send to Log
   writer**. Each note is written into Steve's and Jerrell's drafts for the month(s) it talks about.
   Sending a note again replaces its earlier sentences (no duplicates); deleting a note removes them.
   Her transcript is stored in the draft's **Report as received** as the record of what she said.
5. **Open in Log writer** and continue with 3B step 5 (preview, save, create the daily report).
   Her sentences replace the routine lines they cover; **Show where each line came from** colours
   them (green = her report, blue = typed event, grey = routine, yellow = your edit). **How much
   routine wording to add** controls review flags for configured schedules: *Reported details +
   scheduled-care gaps*, *Reported details + all configured routine gaps*, or *only what was
   reported*. A warning says completion is not documented; it does not say care was omitted.
6. **Do not write days twice.** If the preview's yellow box says days "already have daily notes in
   a saved report", raise **Write from day** past them (for September: 10) before creating the daily
   report. This happens when a note mentions an earlier day ("yesterday").

What she should say to get detailed, correct notes (send her this list): the date first
("Monday, September 15th"); who ("Steve …", "Jerrell …", "both of them …"); the time of day; what
he did, where and with whom; how he seemed (happy, calm, tired, upset); meals, medication
problems, appointments, visitors and anything unusual in plain words. One message per day is
ideal; weekly or monthly messages work if every day starts with its date.

### 3B. Key events typed by you (Log writer tab)

1. **Log writer** → pick the individual and the month. Set **Write from day** and **Through day**
   to the days she has reported (e.g. 1–9). Nothing after "Through day" is written — never
   invent future days.
2. Paste her message into **Report as received** (kept with the draft as your evidence of
   what you were told).
3. Add **Program closures** for holidays (e.g. 7 – Labor Day).
4. Add one **Key event** per thing she reported:
   - *Outing* — beach, park, church, event (Where + what he did there).
   - *Meal out* — restaurant, pick the meal.
   - *Shopping*, *Appointment* (type, provider, outcome), *Visitor*, *Cooked a meal*, *Laundry*, *Chore*.
   - *Away* — he was not at the house (family visit). The whole day is written as out of facility.
   - *Home day* — he skipped the program.
   - *Incident or behavior* / *Other note* — exact sentences, written the way they should appear.
   - Tick **"<housemate> was along"** when both men went; then add the same event on the
     other man's draft so both logs agree.
   - Leave **Shift** on "Let the app place it" unless she told you the time of day.
5. **Preview the month.** Read the assumptions box (yellow) — these are things you must
   confirm with her (which box an outing landed in, whether the housemate went, etc.).
   Fix wording warnings (⚠) by editing the event or the box text. You can edit any box
   directly; edits are saved with the draft.
6. **Save draft.** When her next message arrives, come back, raise **Through day**, add the new
   events, preview again. The routine for the new days is filled automatically.
7. When a batch (or the month) is agreed: **Create daily report from this.** The app writes
   the workbook, analyses it and stops at **Review**. Check each form (the routine-completion
   policy fills every field; incident wording sets the Yes answers), then **Generate**.
8. **Export** print files (section 5). Repeat steps 1–8 for the other individual.

Wording that the form reader misreads — the preview warns about these, avoid them in events:
"talked about" (reads as a plan), "day off"/"stayed home" next to the program name (reads as a
declined outing), "trip" (fall-risk section), "sore/pain/hurt/sick" (Medical Complaints = Yes),
"upset/argued/yelled/refused" (Behavioral Difficulty = Yes), "hospital/911/police/incident report"
(Serious Incident = Yes), "with his family / family visit" (whole shift becomes out of facility).
Use them only when that is exactly what happened.

### Routine settings (button at the top of Log writer)

Per individual, saved on disk: staff roster for the six shift types, day program name/days/times,
whether he attends (off = enrollment pending, he stays home while the housemate leaves), housemate
name and program days, laundry day, medication times, Friday meeting / Sunday money / Saturday
grocery toggles, health reminders (seizure checks, diabetes, gout, bowels), interests. Change the
roster here when staff change — blank workbooks and written workbooks both follow it. Signature
images are matched by staff name: put `<First Last>.png/.jpg` in `server\data\signatures\`.

## 4. Monthly routine — from a workbook staff filled themselves

1. **Daily reports** → individual → **Blank workbook** for the month → send it to the house.
2. When it comes back filled: **Daily reports** → upload the `.docx` as the Monthly Shift Log.
   Tick **Include unverified routine draft defaults** if you want every field filled (that is
   what the delivered months used); leave it off for evidence-only forms.
3. **Start processing** → **Review** → **Generate** → export (section 5).

Blank shift boxes are completed automatically: as out-of-facility when the surrounding notes show
he was away, otherwise as routine shifts (listed in the job warnings).

## 5. Print files (what to send the house manager)

On the **Export** step (or **Saved reports** → open → export):

- **Format**: Word, PDF or both. Word files are what she prints at home; PDFs are the archive copy.
- **Layout**: individual forms, one merged file for the month, or **date batches** (default
  4 days ≈ 12 forms ≈ 84 pages — her printer chokes on whole months).
- **Date range** and **Printed through**: to resume after a printer stop, set the last day that
  printed; the app makes a "check your stack" file for that day and normal batches after it.
- **Duplex section starts**: keeps every form starting on a new sheet when printing double-sided
  (still select double-sided in the printer dialog).
- Every export ZIP has `INDEX.txt` (file → form → date → shift → staff).

Deliverable naming used so far: `<Person>_<Month>2026_Forms-FINAL.zip` (PDF/ + Word/) and
`parts\<Person>_<Month>2026\...` for the 4-day Word batches. Partial months carry the day range
(`Steven_September2026_Sep1-9_...`).

## 6. Quarterly reports

1. **Quarterly reports** → individual → new draft (the reporting dates and quarter number) or
   "unchanged copy" of an existing Word quarterly.
2. Choose the daily reports of the period as sources; their dated excerpts appear beside each
   status cell. Enter statuses, narratives, plan changes and the closing questions.
3. Enter the reviewer name, confirm, export Word/PDF/ZIP. Jerrell's quarterly template was saved
   on 2026-09-08; Steven's is built in. A new template can be uploaded and saved at any time.

## 7. Adding a new individual or a new template

- **New daily template for an existing person**: Daily reports → "Replacement daily template
  (Word)" → tick "Save as this person's daily template". The template must name the same person.
- **A third individual** is the one thing that still needs a developer: the profile list
  (`server/src/services/profiles.ts`) and the workbook names (`scripts/build-entry-workbook.mjs`)
  are fixed to Steven and Jerrell. The Log writer already contains a generic routine library
  (any name, health toggles) so the new person only needs the profile entry and a template.

## 8. Checks before sending anything

- Review screen: no warnings you cannot explain; Medical/Behavioral/Serious answers match what
  really happened; mood boxes ticked; staff names right.
- Open one Word file and one PDF from the export; check the signature sits on the line and the
  date is right.
- Print one batch first; if the printer stops, use **Printed through** to resume.
- Command-line audits (from this folder, `$env:DATA_DIR='server/data'`):
  `node scripts/audit-forms.mjs <jobId>` (empty fields, signatures),
  `node scripts/check-print-safe.mjs <jobId>` (Acrobat print safety),
  `node scripts/audit-docx.mjs <jobId>` (Word validity). Job ids are shown in Saved reports.

## 9. Backups and data

Everything is in `server\data`: `jobs\` (every daily report and its generated files),
`exports\`, `quarterly\`, `collections\`, `profiles\` (saved templates), `signatures\`,
`log-writer\` (drafts and routine settings), `voice\` (her voice files, transcripts and voice
settings), plus the FINAL ZIPs and print parts you produced.
Copy the whole folder to a backup drive after each month. Nothing is stored anywhere else.
`tools\whisper` (the speech engine) does not need a backup; `setup-voice.cmd` recreates it.

## 10. Troubleshooting

| Problem | What to do |
| --- | --- |
| Page does not load | The black window must be open. Start it again with `start-joyform.cmd`. Port 8787 must be free. |
| "LibreOffice not found" | Install LibreOffice or set `SOFFICE_PATH` in a `.env` file to `soffice.exe`. |
| Acrobat says "no pages selected" when printing a PDF | Fixed in the app (dangling annotations are removed). Re-export the files if they were made before 2026-09-05. |
| Printer stops in the middle of a batch | Export again with **Printed through** = the last day that printed. |
| Signature missing on a form | The staff name on the shift must match a file in `server\data\signatures\` (first and last name). |
| Wrong staff on the workbook | Log writer → Routine settings → roster. Blank workbooks and written workbooks follow it. |
| The form shows Medical/Behavioral/Serious = Yes unexpectedly | A word in the notes triggered it (see the list in section 3). Edit the event wording or the field on the Review screen. |
| Voice notes: "Speech engine not installed" | Run `setup-voice.cmd` once (internet needed), then **Check again** on the Voice notes tab. |
| Voice note stuck or "failed" | **Transcribe again** on that note. The file must play in a media player; OGG, OPUS, MP3, M4A, WAV, WEBM, FLAC and AMR are accepted. Typed text can always be pasted instead. |
| A sentence landed on the wrong day or person | Change its date/person in the note, or say/type the date in the transcript ("September 15th") and **Save transcript and read again**. Then **Send to Log writer** again. |
| Her sentence is missing from a form field | The form reader needs certain words (section 3 list): e.g. a shared activity needs "together" or "housemate". Reword the sentence in the note and send it again. |

Keep the app on this PC or another private machine. It has no login: never expose it to the internet.
