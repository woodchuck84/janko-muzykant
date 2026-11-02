# Score intelligence setup (Phase 2)

`backend/scores.py` turns a choir score into a practice timeline, an analysis of your part and an
instrumental guide WAV. Google Drive stays read-only: source files are only read, and all outputs go
to paths the backend chooses (for example `data/omr-*`, `data/generated`).

```
PDF --(Audiveris OMR, optional)--> MusicXML (.mxl/.musicxml) --> analyze() / synthesize()
```

The best input is a **MusicXML export from Sibelius** (File > Export > MusicXML). Ask the conductor
for it. OMR output is useful, but always check it against the PDF.

## Python dependencies

These are already in `requirements.txt`: `music21`, `numpy` and `pymupdf`. `pymupdf` is optional and
only used by `inspect_pdf`. Install them into the project venv:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pytest backend\tests\test_scores.py -q
```

## Audiveris (PDF -> MusicXML)

Audiveris is optional. If it is missing, `convert_pdf` raises `EngineMissingError`
(`code = "omr_engine_missing"`) with a setup hint. The app can still show the PDF and the
`inspect_pdf` text.

`convert_pdf` looks for the engine in this order:

1. The `AUDIVERIS_COMMAND` environment variable. The value is split like a shell command (on Windows,
   quoted paths with spaces work). Extra arguments are allowed:
   ```powershell
   $env:AUDIVERIS_COMMAND = '"C:\Program Files\Audiveris\Audiveris.exe"'
   ```
2. `audiveris` / `Audiveris` on `PATH`.
3. A local, project-only copy under `data\tools\` (searched up to 5 folders deep). For example
   `data\tools\Audiveris\Audiveris\Audiveris.exe`, extracted from the official
   `Audiveris-<ver>-windowsConsole-x86_64.msi` without a system install:
   ```powershell
   msiexec /a Audiveris-5.11.0-windowsConsole-x86_64.msi /qn TARGETDIR="$PWD\data\tools\Audiveris"
   ```
4. Standard install folders (`%ProgramFiles%\Audiveris\Audiveris.exe`, `/opt/audiveris/bin`, the macOS app).

What a conversion runs:
`<engine> -batch -export -output <output_dir> <pdf>`. It runs with no shell and a timeout from
`AUDIVERIS_TIMEOUT` (default 900 s). Stdout and stderr go to `<stem>.audiveris.stdout.log` and
`<stem>.audiveris.stderr.log` in the output folder. If the engine exits non-zero or produces no
`.mxl`, `ScoreError(code="omr_failed")` includes the end of stderr.

`audiveris_status()` reports whether the engine can be found, without running it.

**Real check (Piechota, 4-page Sibelius PDF):** Audiveris 5.11 converted it in about 45 s. Known problems:

- The 3 staves came out as unnamed `Voice` parts.
- The tempo mark (q=100) and the lyrics were not recognised.
- There were multirest warnings.
- The parts disagree on bar positions.

`analyze` flags all of these in `warnings`. It refuses to guess S/A/B for unnamed parts and returns
`suggested_part_id` instead.

In the app, MusicXML staff metadata loads before analysis; for a PDF use
**Odczytaj linie partytury** first. Select **Linia w partyturze** using its
top-to-bottom position, identifier and range, checked against the PDF.
The same explicit selection is used by analysis, WAV generation and the
generated Coaching guide. Unnamed polyphonic/divisi staves require corrected
MusicXML with individually named voice parts; a staff ID alone is insufficient.
For monophonic unnamed SAB/SATB layouts the UI preselects a suggested staff,
but requires confirmation against the score before either action is enabled.
For B, a staff with an F clef is preferred; if none exists, the bottom staff
is suggested. The user can still select a different staff. This does not infer
divisi or establish a singer's vocal classification from a clef.

Generated WAVs never leave the computer or modify Drive. The default directory
is `data\generated` inside the project, or `<JANKO_DATA>\generated` when configured.
The generation result shows the exact absolute path and a WAV download link.

## API (`import scores`)

| Function | Returns |
|---|---|
| `inspect_pdf(path)` | `{path, file_size, page_count, metadata, pages:[{number,text,char_count,image_count,width,height}], text, has_text_layer, text_truncated, omr:{available,...}, warnings}`. Factual only, with no musical analysis. |
| `convert_pdf(path, output_dir)` | `Path` to the produced `.mxl` |
| `load_score(path)` | `music21.stream.Score` from `.xml` / `.musicxml` / `.mxl` |
| `list_parts(path)` | `[{id, name, code}]`. `code` is the detected voice, e.g. `SI`, `A`, `S/A`, or `null` |
| `inspect_parts(path, part)` | `{parts:[{id,name,code,staff,range,multiple_lines}], automatic_part_id, suggested_part_id}`. Inspection does not require successful selection; an ambiguous/unnamed voice returns `null` for automatic selection. Layout suggestions require explicit confirmation. |
| `analyze(path, part='SI', part_id=None, tempo_factor=1, transpose=0)` | dict, see below |
| `synthesize(path, output_path, part='SI', part_id=None, tempo_factor=1, transpose=0, include_bass=False)` | `Path` to a mono 16-bit 22.05 kHz WAV |

Errors are `ScoreError(message, code, hint, details)`. Use `.to_dict()` for JSON.
Subclasses:

- `EngineMissingError`
- `PartSelectionError`, which has `available_parts` and possibly `suggested_part_id`.

Other codes: `not_found`, `invalid_file`, `invalid_score`, `unsupported_format`, `unsafe_archive`,
`file_too_large`, `score_too_large`, `invalid_parameter`, `invalid_part`, `empty_part`,
`omr_failed`, `omr_timeout`.

### `analyze` result

```jsonc
{
  "title": "...",                          // extra
  "parts": [{"id": "P1", "name": "Soprano I", "code": "SI"}],
  "selected_part": {"id": "P1", "name": "Soprano I"},
  "requested_part": "SI",
  "warning": null,                         // part-selection warning (also first in warnings)
  "range": {"low": "G4", "high": "G5", "low_midi": 67, "high_midi": 79},
  "tempo": 60,                             // initial quarter-note BPM x tempo_factor
  "tempos": [{"bar": 3, "beat": 1, "time": 16.0, "bpm": 120}],   // extra: tempo changes
  "tempo_factor": 1, "transpose": 0,       // extra
  "duration": 20.0,                        // seconds, whole score incl. repeats
  "notes": [{"time": 1.0, "duration": 1.0, "midi": 67, "pitch": "G4", "bar": 1, "beat": 2,
             "lyric": "La",
             "offset": 1.0,                // extra: quarter offset in the WRITTEN score (no repeats) = OSMD timestamp*4
             "playback_offset": 9.0,       // extra: quarter offset after repeat expansion
             "quarter_length": 1.0, "pass": 0}],   // extra; pass = repeat pass (0 = first)
  "bars": [{"number": 3, "difficulty": 60, "reasons": ["leap of a perfect octave (G4 to G5)"],
            "start_offset": 8.0, "end_offset": 12.0, "time": 16.0}],   // offsets: written score
  "breaths": [{"bar": 1, "beat": 4, "reason": "punctuation ',' ...", "time": 3.0, "playback_offset": 3.0}],
  "entrances": [{"bar": 1, "beat": 2, "pitch": "G4", "cue": "while Baritone sing G3 ...", "time": 1.0,
                 "cue_part": "Baritone"}],
  "lyrics": [{"bar": 1, "beat": 2, "text": "La", "time": 1.0}],
  "warnings": ["..."]
}
```

How the timeline is built:

- **Repeats:** repeat barlines and volta brackets are expanded with music21. If expansion fails, the
  score plays once and a warning is added.
- **Tempo:** metronome marks and `<sound tempo>` are used, including mid-score changes. If there is
  no mark, the timeline assumes 100 BPM and says so in a warning.
- **Rhythm:** rests and ties are honoured, and tied notes are merged into one note. Grace notes are
  skipped. Fermatas and rit./accel. are **not** modelled.
- **Lyrics:** syllables are hyphenated (`glo-`, `ry.`). On a repeat pass, verse *n* is used if it exists.
- **Beats:** `beat` is 1-based in the time signature's beat unit. Pickup bars are padded so the
  first note gets its real beat.
- **Transposition:** `transpose` shifts `midi`, `pitch`, `range`, the entrance pitches and the audio.
  The rendered score still shows the written key unless the frontend transposes it, and `analyze`
  adds a warning about this.

### Voice matching

Part names are matched in Polish, Latin, English and German forms, as words or abbreviations:
Soprano / Sopran / S, Alto / Alt / A, Tenor / T, Bass / Bas / Baritone / Baryton / B, with I/II/1/2
for divisi. Staves labelled for several voices (`Alt I/II`, `Soprano/Alto`) are recognised too.

1. If exactly one dedicated part matches (e.g. `SII` -> "Soprano II"), it is used with no warning.
2. If the voice shares a staff with others, the upper or lower notes (chord top/bottom, or voice 1/2)
   are used, with a warning.
3. If `SI`/`SII` is requested but the score only has "Soprano", the combined part is used, taking the
   upper/lower note where the staff divides. A warning is added.
4. If several parts match, or you ask for `S` when the score has SI and SII, `PartSelectionError` is
   raised with `available_parts`. Pass `part_id` to choose one.
5. If no part matches (or all parts are unnamed, e.g. OMR `Voice`), `PartSelectionError` is raised.
   Unnamed SAB/SATB scores also get a `suggested_part_id` hint.

`part_id` accepts the MusicXML part id (`P1`) or the music21 `part.id` / part name.

### Analysis heuristics

These are transparent rules, not AI guesses. Each bar's `reasons` lists what contributed:

- **Difficulty** (0-100 per bar, first pass):
  - leaps of a 4th or more (bigger for a tritone, 6th or octave)
  - accidentals outside the key signature
  - fast notes (under 0.35 s at the selected tempo)
  - dotted rhythms, tuplets and syncopation
  - dense notes
  - notes at the top or bottom of your range
  - divisi
- **Breaths:**
  - every rest inside the line
  - lyric punctuation (`, . ; : ! ?` and `…`)
  - an optional catch breath after the longest note when a phrase runs over 10 s
- **Entrances:** your first note after at least one beat of rest. The cue names the other part's note
  that is sounding (or that came last within 4 beats), the interval to your note, and the parts
  entering together.

## Practice audio

`synthesize` renders **an instrumental guide, not sung lyrics**:

- **Your line** is a soft "oo"-like tone with a light piano onset.
- **With `include_bass=True`**, the bass/baritone line is added quietly in a piano-like tone. If no
  part is named bass/baritone, the lowest other part is used instead.

The timing is the `analyze` timeline (`tempo_factor`, `transpose`). Output is written atomically.

## Limits

| Limit | Value |
|---|---|
| MusicXML size | 25 MB |
| `.mxl` uncompressed size | 60 MB total, max 500 entries |
| Compression ratio | 100:1 for entries over 1 MB (zip-bomb guard) |
| Encrypted or path-traversal archives | rejected |
| DTD `<!ENTITY>` | rejected |
| PDF size | 200 MB; text read from 300 pages / 500k characters |
| Measures | 5,000 |
| Notes per part | 20,000 |
| Generated audio | 900 s (about 40 MB WAV) |
| `tempo_factor` | 0.25-4 |
| `transpose` | -24..24 |

Parsed scores are cached in memory (8 most recent files, keyed by path, mtime and size).