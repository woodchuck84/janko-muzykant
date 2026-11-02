# Choir Practice App – Analysis & Proposal

## 1. What is in the Drive (read-only analysis)

**Structure:** `Season → Event (concert/competition) → Song → files`

| Event | Songs | Status |
|---|---|---|
| 7.11 Piława | 10 songs | only 2 folders have files (rest are empty / likely shortcuts) |
| 8.11 Wrocław | 13 songs | most complete – 10 songs with full sets |
| Konkurs w Poznaniu | Krakowiak, Kto cię wołał, Laudate Dominum, Rota | folders visible but empty to anonymous access |
| Politechnika | Chochlik, Contrapunto bestiale, Gaude Mater Polonia, Gaudeamus igitur, Kum i kuma | Contrapunto split into pages + animal voices |
| Emisja głosu | 2 Google Docs (19.09, 17.10) | not publicly exportable |
| Root | *Podział głosów* (Google Doc), season calendar PDF | readable |

**File naming convention (very consistent → easy to parse automatically):**

| Pattern | Meaning |
|---|---|
| `S - <song>.m4a`, `A - …`, `B - …` | rehearsal track for Soprano / Alto / Baritone(Bass) |
| `SI`, `SII`, `AI`, `AII` | divided parts (Soprano I/II, Alto I/II) |
| `… wolniej.m4a` | slower practice version |
| `K_<song>.mp3` | full reference recording ("koncert") |
| `<song> - chór.pdf`, `N. <song>.pdf` | choir score |

**Scores:** exported from **Sibelius 24** as *vector* PDFs (no scanned images), SAB layout (Soprano / Alto / Baritone), Polish/Latin lyrics split into syllables, tempo markings (e.g. ♩=70, ♩=80), dynamics. Arrangers: F. Kozłowski, J. Szewczyk.
→ This is the best possible case for Optical Music Recognition (OMR), and an even better case for simply **asking the conductor for MusicXML exports** (one click in Sibelius: *File → Export → MusicXML*).

**Calendar PDF:** text-extractable – events, dates, venues, conductors (Piława 7.11, Wrocław 8.11, Poznań 13–14.11, Politechnika 28.11, kolędy 17.01, Cantica Mariae 23.05, season end in June).

**Voice split doc:** lists who sings SI/SII/AI/AII → the app can preselect "your part".

---

## 2. Core application (MVP)

1. **Drive sync** – Google Drive API (read-only scope `drive.readonly`), cache files locally for offline practice.
2. **Library browser** – Events → Songs → available material, with badges: 🎼 score · 🎧 my part · 🐢 slow version · 🎤 full recording · ✅ MusicXML.
3. **Song page**
   - PDF score viewer (zoom, page turn, dark mode).
   - Player for each part track with: speed control (pitch-preserving), A–B loop, bookmarks ("bar 17"), volume per track.
   - **Mixer mode**: play my part loud + others quiet (or mute my part = "karaoke" mode) – possible because all parts are separate files of the same length.
4. **"My part" profile** – choose S I / S II / A I / A II / B once; every song opens on your track.

## 3. "Analyze the score and generate how it should be sung"

Pipeline: `PDF → (OMR) → MusicXML → playback/visualization/analysis`

| Step | Tool options |
|---|---|
| PDF → MusicXML | **Best:** MusicXML from Sibelius (ask the conductor). **Automatic:** Audiveris (open-source OMR, good on clean vector PDFs), oemer (Python, ML). Expect manual fixes of a few % of notes. |
| Rendering | OpenSheetMusicDisplay / Verovio (in browser, with cursor following playback) |
| Playback & synthesis | Tone.js / soundfonts; isolate voice, change tempo, transpose |
| Analysis | music21 (Python): range of your part, hardest intervals, breath points, repeated sections |
| Sung lyrics | Synthesized singing with lyrics (e.g. DiffSinger/Synthesizer V-style engines) – experimental; piano/"oo" voice is reliable |

What the analysis can produce for **your** part:
- Vocal range (lowest/highest note) vs. your comfortable range; highlight risky notes.
- Difficulty heatmap per bar (large leaps, chromatic notes, fast rhythms, divisi).
- Suggested breathing places (rests, phrase ends, punctuation in lyrics).
- Entrance cues: "you start after the altos on beat 3, your first note is D".
- Lyric sheet with syllables aligned to notes + pronunciation help for Latin (*Gaude Mater*, *Gaudeamus*, *Tantum ergo*, *O salutaris*, *Laudate Dominum*).
- Generated practice audio: your line only, your line + bass, slow/normal tempo, transposed.

## 4. Learning features (singing education)

- **Pitch trainer with microphone** – real-time pitch detection (Web Audio + YIN/CREPE), shows your pitch line over the target notes; score per phrase (% in tune, cents off, timing).
- **Record & compare** – record yourself over the accompaniment, play back mixed with the reference.
- **Phrase drill** – app loops a 2–4 bar fragment, gradually speeds it up from "wolniej" to concert tempo.
- **Starting-note button** – plays the first note / chord of a song (like a pitch pipe) – very useful before rehearsals.
- **Memorization mode** – progressively hides lyrics/notes (full → first letters → none).
- **Ear training** – intervals and chords drawn from the actual repertoire, harmony hold ("hold your note while the app plays the other parts").
- **Voice warm-ups** – exercises from the *Emisja głosu* sessions turned into guided routines with timer (breathing, sirens, lip trills, scales in your range).
- **Progress tracking** – per song: "listened / can sing with score / can sing from memory / ready for concert"; streaks and practice minutes.

## 5. Extra feature ideas (based on the analysis)

1. **Concert countdown** – calendar PDF parsed into events; "Wrocław in 8 days – 3 songs not ready" with a suggested daily practice plan.
2. **Setlist mode** – play the concert program in order (Wrocław 8.11 has 13 songs) to practice transitions and endurance.
3. **Missing-material report** – app detects songs without your part / without score / without slow version (e.g. Piława folders are empty, Krakowiak/Matko Najświętsza/Tantum ergo have no files) → message to the conductor.
4. **Song deduplication across events** – same song appears in multiple events (*Rota*, *Kto cię wołał*, *Pierwsza brygada*…) → one practice history, linked to all events.
5. **Divisi helper** – for SI/SII/AI/AII songs (*Contrapunto*, *Gaude Mater*) show which line is yours, based on *Podział głosów*.
6. **Contrapunto "animal voices"** – special mode for the onomatopoeic parts (Kot, Kukułka, Pies, Sowa) with rhythm-only practice.
7. **Lyrics & meaning** – translations of Latin texts and historical context of the patriotic songs (helps expression).
8. **Pronunciation coach** – Latin church pronunciation rules applied automatically to lyrics.
9. **Section sync** – share recordings with your section leader for feedback (optional).
10. **Mobile/PWA** – installable on phone, offline, works with headphones on the way to rehearsal.
11. **Notifications** – new files on Drive ("new slow version of Łączko zielona").
12. **AI assistant per song** – ask "where do I breathe in bar 12?" or "what is the hardest part for alto II?" using the MusicXML analysis.

## 6. Recommended technology

- **Web app / PWA** (works on PC and phone): React + TypeScript + Vite.
- **Backend** (small): Python FastAPI – Drive sync, OMR job (Audiveris), music21 analysis, caching.
- Storage: local folder `C:\Users\roman\OneDrive\AI_DEV\<project>` + SQLite for metadata/progress.

## 7. Suggested phases

| Phase | Scope |
|---|---|
| 1 – MVP | Drive sync, library browser, PDF viewer, part player (speed, loop, mixer), "my part" |
| 2 – Score intelligence | MusicXML import (export or OMR), rendered score with cursor, range/difficulty analysis, generated practice audio |
| 3 – Coaching | Microphone pitch feedback, record & compare, phrase drill, warm-ups |
| 4 – Planning | Calendar, concert countdown, setlists, progress & notifications |

## 8. Things to know / decide

- Some Drive folders (Poznań, parts of Piława, Emisja głosu docs) are not readable anonymously → the app should log in with your Google account (read-only).
- Ask the conductor whether Sibelius `.sib`/MusicXML files can be shared – it removes OMR errors entirely.
- Rehearsal tracks are copyrighted arrangements – keep the app for personal/choir use.
