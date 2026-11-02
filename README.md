# Janko Muzykant

A Polish-language choir practice app with local and hosted modes: React + TypeScript + Vite PWA, FastAPI,
SQLite, music21 and Audiveris. Implements phases 1 and 2 of the agreed proposal.
**Google Drive is read-only.** All imports, recognition results, audio and metadata
are stored on the app's computer/server (FastAPI edition) or privately on the device
(standalone Android/PWA editions); there is no upload, edit or delete operation against Drive.
Phases 3 and 4 add singing coaching and local practice planning.

For Proxmox + Docker + Cloudflare Tunnel, Google sign-in, member access and backups,
see the [deployment guide](docs/DEPLOY.md) (Polish and English). Hosted mode is
online-only and requires owner-supplied Google/Cloudflare configuration.

## One-link Android and Windows distribution

**Published on the personal account:** [install/download page](https://woodchuck84.github.io/janko-muzykant/),
[Android 0.1.7 release](https://github.com/woodchuck84/janko-muzykant/releases/tag/v0.1.7)
and [successful initial Pages workflow](https://github.com/woodchuck84/janko-muzykant/actions/runs/41542201890).
**Windows Drive sync is not configured yet:** the distributor must add a restricted
Drive API key or their own Cloudflare proxy and rebuild Pages. The homepage and
PWA show this limitation; Android's native public Drive access is independent.
Use **personal**, not work, GitHub credentials for future updates via the guarded
`Publish-GitHub.ps1` / `npm run github:publish`.
The [step-by-step PL/EN instructions](docs/DISTRIBUTION.md#github-pages--zalecana-publikacja-z-github-releases-pl)
explain the public repository, one-time referrer-restricted Drive API key (or optional
Cloudflare proxy), local APK signing and the final link to share.
Live Drive API access remains unverified until a key is supplied; GitHub Pages is static-only.

The new standalone Windows PWA and Android APK can be distributed from one
Cloudflare Pages homepage. Recipients install the PWA from Chrome/Edge or download
the APK; no local server is needed. See [distribution setup (PL/EN)](docs/DISTRIBUTION.md)
for `npm run web:deploy`, the owner's one-time Cloudflare login/project setup,
local Pages testing, update URL configuration, quotas and offline/privacy limits.
The site has not been published merely by building locally. PWA public Drive reads
use a restricted GET-only Pages Function; analysis and practice stay on-device.
PWA has no Google sign-in or PDF OMR. `Start.bat` and Proxmox remain available.

## Standalone hybrid Android APK

The hybrid Android edition bundles the shared React phone interface and processes MusicXML on the
phone, without this computer, FastAPI or hosting. **It starts without login**,
reading publicly shared Drive materials using the same key-free public folder
view as the desktop edition. Optional native Google authorization with
`drive.readonly` can read additional materials only for accounts already granted
access. Downloads, generated WAVs, progress and recordings stay in app-private
storage, separately for guest mode and each Google account. See the bilingual
[Android guide](docs/ANDROID.md) for installing the debug test APK, required
optional Google Android OAuth/API-key setup, signing fingerprints and privacy rules.

Version 0.1.7 matches the approved phone design: branded library/cards/badges,
four-item navigation and a fixed touch-friendly player above the bottom menu.
It supports PDF/audio practice, mixer, loops/bookmarks,
MusicXML staff/voice selection, analysis/rendering/instrumental WAV synthesis,
microphone coaching, private recordings, warm-ups and personal planning.
**It does not perform PDF-to-MusicXML recognition on Android.** Import MusicXML
instead. Musical repeats/voltas, D.C./D.S., fermatas and tempo changes are not
interpreted; the guide uses written bar order and a user-selected fixed tempo.
It also includes a private practice timer, daily history/streak, missing-material
report, confirmed numeric dates extracted from text PDFs and automatic foreground
setlist progression. Scanned/ambiguous calendar dates require manual entry;
background/lock-screen playback is not guaranteed.
Physical microphone and Google account authorization require handset validation.

Build with JDK 21 and Android SDK 36 configured, then `npm run android:apk`.
The installer is copied directly into this project folder as
**`Janko-Muzykant-debug.apk`** by `Build-Android.ps1` after a successful build.
On Windows, native build outputs are outside OneDrive under
`%LOCALAPPDATA%\JankoMuzykant\android-build\<checkout-hash>\app\outputs\apk\debug\`.
Version 0.1.7 / code 8 preserves the prior debug signature for in-place updates and keeps
login optional. **Default public access needs no Google Cloud setup**. Optional
OAuth or the API-key alternative requires one-time setup by the APK distributor,
not individual choir members. Public folder HTML is not a stable API; format
changes/confirmation pages are reported, not silently treated as files.
This is the user-selected debug-signed test build; release signing/Google Play
publication is a separate step. Public access has no membership restriction.
Neither installing the APK nor logging in transfers private Drive permissions.
The app never modifies Drive sharing.

The original Vox Apostoli-inspired icon shows three joyful singers, a musical
note and a shared VA songbook in forest green and cream (not the choir's official
logo). Android adaptive/themed/legacy icons, splash and PWA/Apple icons share the
source `public\choir-icon.svg`. Regenerate assets with `npm run icons:generate`
using the project's Playwright Chromium installation.

## Start on Windows

Prerequisites: **Python 3.12+**, **Node.js 20.19+** (or 22.12+), internet for the first
dependency installation and reading uncached Drive files.

**Ordinary startup: double-click `Start.bat` in the project folder.** It calls
`Start.ps1`, opens your browser, and keeps the local server running in its window.
If this version is already running, another double-click simply opens the
existing app. If startup fails, the window stays open so you can read the error.
Close the first server window or press Ctrl+C to stop. The launcher checks that
an occupied port belongs to Janko; it does not stop other applications.

Alternatively, open PowerShell in this project folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\Start.ps1
```

This installs dependencies if missing, builds the frontend, starts the backend and
opens **http://127.0.0.1:8000**. Keep the PowerShell window open; Ctrl+C stops the
server. Both frontend and API are served from the same process/port. If port 8000
is occupied, use the already-running Janko instance or stop that instance first.
This Windows launcher binds only to the local computer, not the network.

The initial implementation has already read the live public repertoire into
`data\library.sqlite3`. On a new copy, click **Wczytaj koncert we Wrocławiu** for a
small first sync, or **Synchronizuj Drive** to read all events.

## Phone layout and installation

The phone layout activates automatically at widths up to 680 px; desktop stays
unchanged. The library becomes a compact **single-column list**. Bottom navigation
opens **Biblioteka**, **Plan i postępy**, **Mój głos**, and **Ustawienia**.
On a song page, **Postęp i czas ćwiczenia** expands the readiness/timer controls.
The three practice tabs remain visible as you scroll.

In **Nuty i nagrania**, a compact player above the bottom navigation keeps
play/pause, position, speed and **A / B / Pętla** available while reading.
The score fits the screen width. Spread two fingers to zoom (50–250%); pan inside
the score when enlarged. At 100% or smaller, swipe horizontally to change page.
**↔** fits the score to width again; page buttons remain available. Mixer sliders
have thumb-sized targets, and **(i)** opens on tap. Changing the practice tab
stops that tab's microphone/drill, but the persistent repertoire player continues.

## Persistent playback and score seeking (web + APK)

The bottom player keeps its current recording, position, speed, loop and mixer
when opening another tab, song, library, planning or settings screen.
Opening another song does not silently replace the playing one: use
**Odtwarzaj ten utwór** or previous/next. The pool is all songs in the selected
event (saved program order first), or all library songs without an event;
search text does not shorten it. End-of-track advances to the next song.
The last song stops. A missing recording for the selected voice stops with a
message; there is no automatic substitution with another part or full choir.
Combined S/A recordings can serve their corresponding divisi.

**Cały utwór** repeats the entire current recording and prevents automatic
progression. **A** marks a fragment start, **B** its end; **Pętla** repeats that
fragment. The two repeat modes are mutually exclusive. Previous/next remain
intentional song changes, resetting the song's repeat/fragment settings.
This is in-app continuity, not an Android foreground audio service: operating
system suspension/lock-screen playback is still not guaranteed.

MusicXML analysis now renders clickable notes in both editions. Generated WAV
uses the same event timestamps as highlighting and note seeking. This is a
nominal synthesized timing map, not a measured audio-device latency guarantee;
the UI reports partial graphical matches instead of claiming every event is
highlighted. PDF-only scores do not have a clickable note map. For an existing recording,
enable **Próbuj z nagraniem ze stałego odtwarzacza (kalibracja)** in Analysis,
select a note and pause the recording at that entrance, then mark point 1.
Repeat for a later note/entrance and point 2. Highlighting and seeking use a
linear approximation **only between those anchors**, for that song/track and
current analysis screen. Rubato, repeats and tempo changes can drift; calibrate
short fragments. There is no automatic waveform/score alignment.

**“Jak to na wojence ładnie”, B:** the PDF contains the bass, but its cached
Audiveris result is incorrectly layered. Staff P3 has voice 1 (173 events,
G2–E5, missing bars 12/14 and an implausible high ending) and voice 2 (only bars
12/14, G2–D3). These are not two trustworthy complete bass alternatives.
The staff selection remains, with an explicit **Melodia wewnątrz pięciolinii**
choice for detected voices or supported upper/lower chord lines. Nothing is
guessed, merged or filled into missing bars. This enables inspection/generation
of a chosen line, **not correction of faulty OMR**. A checked/corrected MusicXML
with named parts is needed for a reliable complete B guide. Android can import
that MusicXML/MXL locally, but still does not recognize PDF.

**Install:** Android Chrome → menu ⋮ → **Install app / Add to Home screen**;
iPhone Safari → **Share → Add to Home Screen**, with **Open as Web App** enabled
when offered. Settings contains these instructions and, on supported Chromium
browsers, an install button when the browser offers installation.
PNG app icons, an Apple touch icon, a scoped standalone manifest and safe-area
padding are included. Installation requires a first online visit over **HTTPS**
(localhost is trusted only on the same device). In **local mode**, save each
song offline **on the phone itself** before using it without a connection.
Hosted mode disables service-worker/private-material caches: a Home Screen
shortcut works, but requires Internet and a signed-in member account.

**Not deployed yet:** `127.0.0.1:8000` on a phone refers to the phone, not this PC.
The Windows launcher still binds only to this computer. Hosted configuration and
access control are provided separately in the [deployment guide](docs/DEPLOY.md);
no owner domain or server has been deployed. Do not expose the no-login local
mode publicly.
Browser-local voice choices, recordings and bookmarks do not automatically
transfer from your PC to your phone.

Automated checks use Pixel 7 Chromium and iPhone 14 WebKit emulation, including
360–430 px layouts, playback, gesture handlers and no page-level horizontal
overflow. They cannot verify native Home Screen installation, real multitouch,
physical microphone quality, notches/browser bars or background playback on an
actual handset. Playwright's **Windows WebKit lacks Web Audio** in this environment:
its unsupported-audio message is tested rather than claiming successful synthesized
tones there. Actual current iOS Safari supports Web Audio, but still requires a
user gesture/permission and a real-device check. Browser/PWA suspension may stop
audio; keep the app foreground while practising.

## Singing coaching (phase 3)

Each song now has a **Coaching** tab:

- **Microphone pitch feedback:** click **Włącz mikrofon** and allow access. Wear
  headphones; otherwise the microphone may measure your speakers. The tuner
  detects a single fundamental frequency with YIN (65–1200 Hz), displays the
  nearest note, cents relative to the target, a recent pitch trace, and the
  proportion of detected samples within ±50 cents. Silence/noise is not scored
  as an accurate pitch; voice coverage is displayed separately.
- **Against your part:** first generate a guide in **Analiza i generowanie**.
  Coaching remembers that MusicXML analysis, voice, tempo, transposition and
  generated audio. Play this guide to compare with its actual note timeline.
  Original rehearsal audio is available as a reference, but it is **not**
  automatically aligned to MusicXML: choosing it uses the fixed tuner target.
  Use the latency correction field for your hardware. OMR errors also affect
  target accuracy; validate the MusicXML first.
- **Record & compare:** enable the microphone, play the reference through
  headphones, and click **Nagraj próbę**. Only the microphone is recorded.
  Stopped takes are saved in browser IndexedDB, scoped to song and your voice;
  you can replay, download or delete individual takes. Choose the same reference
  and **Porównaj równocześnie** to hear your take beside it with separate volume
  controls. Recording start position/speed are retained; manual offset adjustment
  compensates for approximate synchronization. Maximum 10 minutes / 40 MB.
- **Phrase drill:** choose start/end seconds or a bar range from the generated
  guide, then loop it. Each repetition can increase speed by 5%/10% up to 100%
  of that selected recording, with pitch preserved. Bar ranges select the first
  written occurrence; repeats/OMR may require manual adjustment.
- **Starting note:** **Dźwięk początkowy** sounds your guide's first note, or the
  selected tuner note when there is no guide.
- **Memorization:** display all MusicXML syllables, first letters, or hidden
  syllables; independently hide the note names. Missing lyrics are reported,
  never invented. The practice strip is capped at 1,000 note cells.
- **Warm-ups:** a two-minute guided sequence of gentle breathing, humming,
  small sirens and a short scale; tones start on the adjustable tuner note.
  These are general exercises, **not** a fabricated transcription of the choir's
  private “Emisja głosu” documents. Stay in a comfortable register and stop for
  pain, dizziness or fatigue.
- **Ear training:** name intervals drawn from the generated part (or simple
  preset intervals without MusicXML); practise holding a note against a fifth.

**Browser limitations:** microphone requires a secure context (localhost counts),
permission and actual input hardware. Current Chrome/Edge are recommended;
Firefox may record Ogg/Opus, Chromium WebM/Opus, and Safari MP4. Recording playback
compatibility varies between browsers. Pitch detection is monophonic and
approximate, can make octave errors, and is not a medical or professional
assessment. The app does not claim an objective full-performance timing score.
Changing tab/song/voice stops microphone tracks and recording; finished takes
remain local. Browser storage can be erased/evicted: download important takes.
Background/suspended tabs may interrupt audio and timer accuracy.

## Everyday use

1. Select **Mój głos**: Sopran I, Sopran II, Alt I, Alt II or Bas/baryton.
   Your choice is remembered in this browser. A shared S/A track is used for its
   divisi when there is no exact SI/SII/AI/AII track; the sibling divisi is not
   silently substituted.
2. Browse events or search a song. Material badges show PDF, your line, slower
   recording, full choir recording and MusicXML. Matching song names are
   deduplicated across events; original filenames and split-page sections remain
   visible in the recording selector.
3. Open **Nuty i nagrania**. PDF supports zoom, pages and dark mode. Select a track,
   change speed without changing pitch, set A then B and enable **Pętla**.
   Label bookmarks (for example “takt 17”) at the current recording position.
   Bookmarks are per song/recording because alternate recordings may have
   different timing.
4. **Z chórem** puts your line forward and others quietly in the background;
   **Bez mojego** mutes your line. Individual volume sliders remain available.
   The **(i)** icon beside **Mikser chóru** explains both modes on hover, keyboard
   focus or tap. It mixes separate existing S/A/B rehearsal files, **not** voices
   extracted from a full-choir recording.
   Mixer tracks must share the same starting point, tempo variant and section;
   drift correction is not musical time-stretch alignment of different performances.
5. **Zapisz offline** downloads the song's materials to the computer and browser.
   The app reports inaccessible files individually. Browser storage is
   quota-limited and may be cleared by the browser. Install the PWA through
   Chrome/Edge's install menu after loading it online.

## Practice planning (phase 4)

Open **Plan i postępy** from the library, sidebar, or the mobile **Plan** link.

- **Per-song readiness:** choose Wysłuchane, Śpiewam z nut, Śpiewam z pamięci, or
  Gotowe na koncert. Readiness is independent for each song and voice. These are
  your own assessments, not automatic microphone scores.
- **Practice timer:** on a song page start its timer and use **Zakończ i zapisz**
  to store elapsed practice time in SQLite. The running timer survives leaving
  the page in the same browser. Save explicitly: closing the app does not
  secretly upload or count a completed practice session. The dashboard shows
  daily totals, a 14-day history, and a consecutive-day streak.
- **Calendar/countdown:** **Odczytaj kalendarz PDF** reads the real season PDF
  from Drive or its local cache, extracts date candidates and displays source
  excerpts. Choose the correct event and confirm a date; you can also enter or
  clear a date manually. Dates are never committed based solely on extraction.
  The document includes non-concert dates and even older year entries, so
  confirm the year and event carefully. Upcoming confirmed events show days
  remaining and songs not yet marked concert-ready.
- **Setlists:** select an event, arrange its songs with move up/down buttons,
  remove or add library songs, then **Zapisz kolejność**. The initial alphabetical
  order is explicitly **not** claimed to be the conductor's program order.
  **Odtwarzaj program** plays the selected voice's normal rehearsal recording,
  advancing through songs, with previous/next/pause controls. Missing or
  inaccessible tracks produce visible errors; prepare material offline before
  a long session.
- **Missing materials:** the selected event lists songs lacking a score, your
  rehearsal line, a slower version or a complete choir recording.
- **New materials:** synchronization compares against previous local metadata
  and records newly added or modified remote files. Review and acknowledge the
  list in Plan. An optional browser permission button enables notifications
  while the planning page is open; blocked/unsupported permissions are
  reported. The app does not poll Drive or push notifications when closed.
  Anonymous listings may not expose modification timestamps or sizes, so
  changes to contents under the same file ID can require authenticated sync
  before being detectable.

All progress, event dates, setlist order, session history and change notifications
are app-side SQLite data. Hosted progress/setlists/seen state are scoped to the
member; library/calendar are shared. Google Drive remains untouched. In local
mode, saved planning views are available through the PWA cache offline;
changing progress/date/order requires the running server. Hosted mode requires
Internet. If a timer save fails, the timer remains available to retry.

## Score intelligence

Open **Analiza i generowanie**:

- Prefer a MusicXML file already alongside the PDF. You can also **Importuj
  MusicXML** (`.musicxml`, `.xml`, `.mxl`) from your computer. This import changes
  **only local storage**, never Google Drive. Ask the conductor for
  **Sibelius → File → Export → MusicXML** when possible.
- If only PDF exists, the app runs **local Audiveris OMR**. Without Audiveris,
  it shows an actionable setup message and genuine PDF metadata/text rather
  than inventing a melody. See [OMR and score setup](docs/SCORE_SETUP.md).
- Analysis of the selected voice includes vocal range, heuristic bar difficulty,
  rest/phrase-based breath suggestions, entrance cues and note-aligned lyrics.
  Staves are read **before** analysis: MusicXML loads its staff list automatically;
  for a PDF click **Odczytaj linie partytury** (this may run local OMR).
  **Linia w partyturze** shows each staff's position from the top, identifier,
  name and pitch range. If names are generic (e.g. all `Voice`) or ambiguous,
  choose the actual staff after checking the original PDF. Staff order and range
  are clues, not a reliable voice assignment. The app does not guess B or I/II.
  For unnamed three/four-staff scores it preselects a **suggestion** based on
  typical SAB/SATB order. **Potwierdź wskazaną pięciolinię** accepts that suggestion
  only after you check it; otherwise select the correct staff. It never silently
  treats this layout assumption as a recognized voice or divisi assignment.
  For **Bas / baryton**, the suggestion prefers a staff with an **F (bass) clef**;
  if none is present, it uses the bottom staff. Confirmation and manual selection
  remain unchanged; a clef alone is not proof of the singer's vocal classification.
  The choice is remembered per song/source/voice and used for **both** analysis
  and generation. Generate a new guide after changing it to update Coaching.
  An unnamed staff containing multiple voices/divisi requires corrected MusicXML
  with separately named parts; choosing a staff alone cannot identify its melody.
- Generate a **synthesized instrumental guide**, isolated line or line + bass,
  at normal/slow tempo and with semitone transposition. This is **not a sung
  vocal performance** and does not synthesize lyrics. An OpenSheetMusicDisplay
  score and cursor follow generated playback.
  WAV files stay **on the app's computer/server**, never on Google Drive: locally by default in
  `C:\Users\roman\OneDrive\AI_DEV\Janko Muzykant\data\generated`.
  If `JANKO_DATA` is configured, the actual directory is
  `<JANKO_DATA>\generated` instead. After generation the UI displays the exact
  local file path and **Pobierz przewodnik WAV** link; a downloaded copy goes to
  the browser's chosen download folder. Generated filenames are hashed `.wav`
  names, reused for identical settings.
  The project folder is inside OneDrive on this computer; Windows/OneDrive may
  independently sync it according to your settings. The application itself
  does not upload generated files to Google Drive or another service.
- Audio and analysis can be transposed; the displayed MusicXML remains in its
  original written key, clearly indicated in the interface.
- Lyrics are taken from MusicXML, not inferred from a recording. Basic Latin
  pronunciation reminders are educational hints; follow your conductor.

**OMR is not ground truth.** The live Piechota PDF was recognized and analyzed
successfully, but Audiveris reported rhythm/multirest issues. Verify the resulting
notes, repeats and text against the PDF, preferably correcting MusicXML in
MuseScore/Sibelius before learning it. Breath and difficulty suggestions are
heuristics, not musical instructions or vocal-health advice.

## Optional Google OAuth (read-only, local mode)

The following describes the Windows/local mode only. Hosted mode always requires
server-validated Google sign-in and an explicit administrator/member allowlist;
its OAuth client secret and access/refresh credentials stay server-side in
SQLite under `/data`. Configure its HTTPS `/auth/callback` using the
[deployment guide](docs/DEPLOY.md), not these local browser-token instructions.

Local public-folder mode requires no API key or account. Some Google Docs, private
folders and shortcuts may require your choir account.

1. In your Google Cloud project enable **Google Drive API**.
2. Configure the OAuth consent screen for personal/testing use; add your own
   account as a test user. Request only
   `https://www.googleapis.com/auth/drive.readonly`.
3. Create an OAuth client of type **Web application**. Authorized JavaScript
   origins: `http://127.0.0.1:8000`, `http://localhost:8000` (and
   `http://127.0.0.1:5173` / `http://localhost:5173` only if using Vite development).
   Google Identity Services uses a browser token flow, so no client secret belongs
   in this local browser-token flow and no local callback server route is required.
4. Start with your client ID:

```powershell
.\Start.ps1 -GoogleClientId "YOUR_CLIENT_ID.apps.googleusercontent.com"
```

5. Open **Ustawienia i połączenie → Zaloguj do Google — tylko odczyt**, then sync.
   The server validates that the token includes `drive.readonly` and rejects
   broader Drive scopes. In local mode, tokens live in server memory only, expire normally and
   are discarded by disconnect/restart. Login has not been tested against a
   private account because no OAuth client/credentials were supplied.

Drive requests are restricted to Google's listing/download/export GET endpoints.
An expired or inaccessible session produces a visible error; previously cached
files remain available. Anonymous listings cannot reliably distinguish empty
folders from restricted folders. Failed/incomplete syncs preserve prior metadata;
complete event reads remove stale remote records locally.

## Offline and privacy

- `data\library.sqlite3`: events, songs, material metadata and sync timestamp.
- `data\cache`: downloaded originals and locally imported MusicXML.
- `data\generated`: OMR output and WAV practice audio.
- `data\tools`: optional locally extracted Audiveris installation.
- Voice profile/bookmarks and saved analyses: this browser's local storage.
- App shell/PDF worker/library/materials: PWA service worker caches in local mode only.

**The following offline behavior applies only to local mode.** Hosted mode
disables the service worker and private-material browser caches and requires an
Internet connection; browser recordings/preferences remain local per user.
Hosted sessions and OAuth access/refresh credentials are persisted server-side
in SQLite, so `/data` and `.env` backups are sensitive.

With no internet, the local server can serve saved materials and generate practice
from cached MusicXML. If the server is also stopped, the installed PWA can display
its saved library and play browser-cached originals; **new sync, import, analysis
and generation require a running local server**. Last successful analyses can be
read from browser storage when a matching analysis request cannot reach the
server. A newly generated audio guide must be cached before offline playback.
Do not clear browser storage if you want to retain bookmarks.

Microphone recordings remain in your browser profile, not the project folder or
Google Drive. Only an explicit download saves a recording as an ordinary file.

The project folder is under **OneDrive**. Local caches and rehearsal files may be
synced by OneDrive under your existing configuration. To keep downloaded
materials outside OneDrive, set an absolute data directory before starting:

```powershell
$env:JANKO_DATA = "$env:LOCALAPPDATA\JankoMuzykant"
.\Start.ps1
```

The app itself has no analytics and sends no scores to AI services. Google OAuth,
Drive reads and optional Google-hosted fonts are the only external browser
services. Use choir materials only with the rights/permission you already have;
do not expose this local server publicly.

## Development and verification

```powershell
# Backend (terminal 1)
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000

# Frontend with hot reload (terminal 2)
npm run dev

# Checks
.\.venv\Scripts\python.exe -m pytest backend\tests -q
npm test
npm run build

# Browser integration: requires a running production server, synced Piechota,
# and configured Audiveris or a real MusicXML next to the score
npx playwright install chromium webkit
npm run test:e2e
# Phone-only checks (Pixel 7 Chromium + iPhone 14 WebKit)
npm run test:e2e -- phone.spec.ts
```

The E2E suite exercises the real repertoire, PDF rendering, playable audio,
pitch-preserving speed settings, A–B controls, bookmarks, mixer/karaoke,
score analysis, instrumental generation, rendered MusicXML and offline reload,
microphone feedback, permission-denied messaging, local take persistence/deletion,
recording/reference comparison, gradual phrase speed, warm-ups, ear questions,
memorization, confirmed calendar dates, program ordering/continuous playback,
readiness and saved practice timers. Phone checks cover library/voice/settings,
the score's swipe/pinch handlers, the fixed touch player, mixer, analysis,
Coaching, planning and setlist playback, at 360–430 px without page-level overflow.
Microphone browser checks use a generated 440 Hz input file; they verify the
browser capture/detection path, **not** the accuracy of your physical microphone
or your singing. Those depend on your equipment, room and permissions.
Screenshots can be directed to a folder using `JANKO_SCREENSHOTS`.

The folder is initialized as a Git repository. Dependencies, originals, generated
files, tokens and personal cache are excluded from Git. Keep the original agreed
proposal and Drive crawl for reference; the crawl is not used as fake live data.

## Deliberately not included

Human-sounding sung-lyric synthesis remains experimental. External sharing,
automatic synchronization of browser recordings/preferences, and server push
notifications while the app is closed are not implemented. Hosted accounts share
server-held progress across devices, but browser-local recordings do not transfer.
