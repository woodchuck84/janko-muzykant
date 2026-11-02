import { useEffect, useRef, useState } from 'react'
import { ArrowDownUp, AudioLines, FileUp, Music2, Play, Sparkles, Wind } from 'lucide-react'
import ScorePlayback from './ScorePlayback'
import { claimAudio, playAudio } from './playbackClock'
import { useAudioPosition } from './useAudioPosition'
import { ApiError, api, errorMessage, post, timeLabel } from './api'
import { getSession, userStorage as localStorage } from './session'
import type { Analysis, Material, Part, Song, ScoreInfo } from './types'
import { guideKey } from './CoachingPanel'

interface PracticeFile { url: string; local_path: string; filename: string }

export default function AnalysisPanel({ song, part, onRefresh }: { song: Song; part: Part; onRefresh: () => Promise<void> }) {
  const sources = song.files.filter(f => f.kind === 'musicxml' || f.kind === 'pdf')
  const [sourceId, setSourceId] = useState(sources.find(f => f.kind === 'musicxml')?.id ?? sources[0]?.id ?? '')
  const [partId, setPartId] = useState('')
  const [lineId, setLineId] = useState('')
  const [scoreInfo, setScoreInfo] = useState<ScoreInfo | null>(null)
  const [requestedSource, setRequestedSource] = useState('')
  const [inspectionVersion, setInspectionVersion] = useState(0)
  const [reading, setReading] = useState(false)
  const [tempo, setTempo] = useState(1)
  const [transpose, setTranspose] = useState(0)
  const [includeBass, setIncludeBass] = useState(false)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [audioUrl, setAudioUrl] = useState('')
  const [practiceFile, setPracticeFile] = useState<PracticeFile | null>(null)
  const [position, setPosition] = useState(0)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [omr, setOmr] = useState<{ message: string; pdf?: { pages?: number; text?: string } } | null>(null)
  const [notice, setNotice] = useState('')
  const upload = useRef<HTMLInputElement>(null)
  const audio = useRef<HTMLAudioElement>(null)
  useAudioPosition(audio, setPosition, audioUrl)
  const body = { part, part_id: partId || (lineId ? scoreInfo?.automatic_part_id : null), line_id: lineId || null, file_id: scoreInfo?.source_id ?? sourceId, tempo_factor: tempo, transpose, include_bass: includeBass }
  const cacheKey = `janko.analysis.${song.id}.${part}.${sourceId}.${partId}.${lineId}.${tempo}.${transpose}`
  const selectionKey = `janko.staff.${song.id}.${sourceId}.${part}`
  const selectedStaff = scoreInfo?.parts.find(p => p.id === (partId || scoreInfo.automatic_part_id))
  const previewStaff = selectedStaff ?? scoreInfo?.parts.find(p => p.id === (scoreInfo.automatic_part_id || scoreInfo.suggested_part_id))
  const source = sources.find(f => f.id === sourceId)
  const scorePdf = source?.kind === 'pdf' ? source : sources.find(f => f.kind === 'pdf' && f.section === source?.section)
  const needsSelection = !!scoreInfo && !partId && !scoreInfo.automatic_part_id
  const ambiguousStaff = !!selectedStaff && selectedStaff.multiple_lines && !lineId
  const canRun = !!scoreInfo && !reading && !busy && !needsSelection && !ambiguousStaff

  useEffect(() => {
    setAnalysis(null); setAudioUrl(''); setPracticeFile(null); setPosition(0); setError(''); setOmr(null)
    audio.current?.pause()
  }, [part, sourceId, partId, lineId, tempo, transpose, includeBass])

  useEffect(() => {
    let cancelled = false
    function restoreSelection(info: ScoreInfo) {
      setScoreInfo(info)
      const saved = localStorage.getItem(selectionKey)
      if (saved && info.parts.some(p => p.id === saved)) {
        setPartId(saved)
        const savedLine = localStorage.getItem(`${selectionKey}.line`)
        if (savedLine && info.parts.find(p => p.id === saved)?.line_choices?.some(choice => choice.id === savedLine)) setLineId(savedLine)
      }
    }
    setScoreInfo(null); setPartId(''); setLineId(''); setReading(false)
    if (!sourceId || (sources.find(f => f.id === sourceId)?.kind !== 'musicxml' && requestedSource !== sourceId)) return
    setReading(true); setError(''); setOmr(null)
    void post<ScoreInfo>(`/api/songs/${song.id}/score-info`, { file_id: sourceId, part }).then(info => {
      if (cancelled) return
      try {
        restoreSelection(info)
        localStorage.setItem(`${selectionKey}.info`, JSON.stringify(info))
      } catch { setNotice('Nie można zapamiętać listy linii. Wybierz linię ponownie po otwarciu aplikacji.') }
    }).catch(err => {
      if (cancelled) return
      showScoreError(err)
      if (err instanceof TypeError) {
        try {
          const cached = localStorage.getItem(`${selectionKey}.info`)
          if (cached) {
            restoreSelection(JSON.parse(cached) as ScoreInfo)
            setNotice('Lista linii z pamięci przeglądarki. Dostępne są zapisane analizy; generowanie wymaga serwera lokalnego.')
          }
        } catch { setError('Nie można odczytać listy linii offline.') }
      }
    }).finally(() => { if (!cancelled) setReading(false) })
    return () => { cancelled = true }
  }, [sourceId, part, requestedSource, inspectionVersion, selectionKey, song.id])

  function showScoreError(err: unknown) {
    const detail = err instanceof ApiError ? err.detail : null
    if (detail && typeof detail === 'object' && 'code' in detail && detail.code === 'omr_required' && 'message' in detail) {
      const pdf = 'pdf' in detail && detail.pdf && typeof detail.pdf === 'object' ? detail.pdf : null
      setOmr({ message: String(detail.message), pdf: pdf ? {
        pages: 'pages' in pdf && typeof pdf.pages === 'number' ? pdf.pages : undefined,
        text: 'text' in pdf && typeof pdf.text === 'string' ? pdf.text : undefined
      } : undefined })
    } else if (detail && typeof detail === 'object' && 'error' in detail && detail.error === 'part_selection') {
      setError('Nie można jednoznacznie rozpoznać Twojej melodii. Wybierz właściwą linię z listy powyżej i sprawdź ją z PDF. Wielogłos w nienazwanej linii wymaga poprawionego MusicXML z osobno nazwanymi głosami.')
    } else setError(errorMessage(err))
  }

  function chooseStaff(id: string) {
    setPartId(id); setLineId('')
    try {
      if (id) localStorage.setItem(selectionKey, id)
      else localStorage.removeItem(selectionKey)
      localStorage.removeItem(`${selectionKey}.line`)
      localStorage.removeItem(guideKey(song.id, part))
      setNotice('Wybrana linia dotyczy analizy i generowania. Wygeneruj nowy przewodnik, aby użyć jej w coachingu.')
    } catch { setError('Nie można zapamiętać linii lub usunąć poprzedniego wzorca coachingu. Sprawdź pamięć przeglądarki.') }
  }
  function chooseLine(id: string) {
    setLineId(id)
    try {
      if (id) localStorage.setItem(`${selectionKey}.line`, id)
      else localStorage.removeItem(`${selectionKey}.line`)
      localStorage.removeItem(guideKey(song.id, part))
    } catch { setError('Nie można zapamiętać wyboru melodii. Sprawdź pamięć przeglądarki.') }
  }

  async function runAnalysis(generate = false) {
    if (!canRun) return
    setBusy(generate ? 'Generowanie nagrania…' : 'Analiza partytury…'); setError(''); setOmr(null); setNotice('')
    try {
      const result = await post<Analysis>(`/api/songs/${song.id}/analyze`, body)
      setAnalysis(result)
      try { localStorage.setItem(cacheKey, JSON.stringify(result)) }
      catch { setNotice('Analiza gotowa, ale brak miejsca na jej zapis w przeglądarce.') }
      if (generate) {
        const practice = await post<PracticeFile>(`/api/songs/${song.id}/practice`, body)
        // A complete fetch makes range-based audio playback available to the offline service worker.
        const response = await fetch(practice.url)
        if (!response.ok) throw new Error('Nie można zapisać wygenerowanego nagrania.')
        if (!getSession()?.hosted && 'caches' in window) await (await caches.open('janko-materials')).put(practice.url, response.clone())
        setAudioUrl(practice.url); setPracticeFile(practice); setPosition(0)
        try { localStorage.setItem(guideKey(song.id, part), JSON.stringify({ analysis: result, url: practice.url, tempoFactor: tempo, transpose })) }
        catch { setNotice('Nie udało się zapamiętać wzorca coachingu. Zwolnij miejsce w przeglądarce i wygeneruj go ponownie.') }
      }
      await onRefresh()
    } catch (err) {
      showScoreError(err)
      if (err instanceof TypeError) {
        try {
          const cached = localStorage.getItem(cacheKey)
          if (cached) { setAnalysis(JSON.parse(cached) as Analysis); setNotice('Wyświetlono wcześniej zapisaną analizę. Nowe nagrania wymagają działającego serwera lokalnego.') }
        } catch { setError('Nie można odczytać zapisanej analizy offline.') }
      }
    } finally { setBusy('') }
  }

  async function importScore(file: File) {
    setBusy('Import MusicXML…'); setError('')
    try {
      const form = new FormData(); form.append('file', file)
      const result = await api<{ id: string }>(`/api/songs/${song.id}/musicxml`, { method: 'POST', body: form })
      await onRefresh(); setSourceId(result.id); setOmr(null); setAnalysis(null)
      setNotice(getSession()?.hosted ? 'MusicXML zapisany na serwerze chóru. Google Drive nie został zmodyfikowany.' : 'MusicXML zapisany tylko na tym komputerze. Google Drive nie został zmodyfikowany.')
    } catch (err) { setError(errorMessage(err)) }
    finally { setBusy(''); if (upload.current) upload.current.value = '' }
  }

  const currentNote = analysis?.notes.findLast(n => n.time <= position && n.time + n.duration >= position)
  return <div className="analysis-workspace">
    <section className="panel analysis-controls"><div className="panel-heading"><span className="eyebrow"><Sparkles size={16}/> POZNAJ SWOJĄ PARTIĘ</span><span className="small-tag">Etap 2</span></div>
      <h2>Od nut do pewnego wejścia.</h2>
      <p className="muted">Najlepszy rezultat daje MusicXML wyeksportowany z Sibeliusa. PDF rozpoznajemy {getSession()?.hosted ? 'na serwerze chóru' : 'lokalnie'} przez Audiveris — bez wysyłania do usług AI.</p>
      <div className="analysis-form">
        <label>Źródło partytury<select aria-label="Źródło analizy" disabled={!!busy || reading} value={sourceId} onChange={e => { setSourceId(e.target.value); setPartId(''); setRequestedSource('') }}><option value="">Wybierz lub zaimportuj…</option>{sources.map(f => <option value={f.id} key={f.id}>{f.kind === 'musicxml' ? 'MusicXML' : 'PDF'} · {f.name}{f.section ? ` · ${f.section}` : ''}</option>)}</select></label>
        <label>Linia w partyturze<select aria-label="Linia do analizy" aria-describedby="staff-help" disabled={!scoreInfo || reading || !!busy} value={partId || scoreInfo?.suggested_part_id || ''} onChange={e => chooseStaff(e.target.value)}><option value="">{scoreInfo?.automatic_part_id ? `Automatycznie: ${part} · ${scoreInfo.automatic_part_id}` : 'Wybierz linię po sprawdzeniu nut…'}</option>{scoreInfo?.parts.map((p, index) => <option key={p.id} value={p.id}>Pięciolinia {p.staff}{index === 0 ? ' (górna)' : index === scoreInfo.parts.length - 1 ? ' (dolna)' : ' (od góry)'} · {p.id} · {p.name}{p.range ? ` · ${p.range.low}–${p.range.high}` : ' · brak nut'}{p.multiple_lines ? ' · wielogłos / divisi' : ''}</option>)}</select></label>
        {selectedStaff?.multiple_lines && <label>Melodia wewnątrz pięciolinii<select aria-label="Melodia wewnątrz pięciolinii" value={lineId} disabled={reading || !!busy} onChange={e => chooseLine(e.target.value)}><option value="">Wybierz świadomie po sprawdzeniu PDF…</option>{selectedStaff.line_choices?.map(choice => <option key={choice.id} value={choice.id}>{choice.name}{choice.range ? ` · ${choice.range.low}–${choice.range.high}` : ''}</option>)}</select></label>}
        <label>Tempo<select aria-label="Tempo generowania" value={tempo} onChange={e => setTempo(Number(e.target.value))}><option value={0.6}>60% · powoli</option><option value={0.75}>75% · ćwiczenie</option><option value={1}>100% · oryginalne</option><option value={1.15}>115% · szybciej</option></select></label>
        <label>Transpozycja<select aria-label="Transpozycja" value={transpose} onChange={e => setTranspose(Number(e.target.value))}>{Array.from({ length: 25 }, (_, i) => i - 12).map(n => <option key={n} value={n}>{n > 0 ? '+' : ''}{n} półtonów{n === 0 ? ' · oryginał' : ''}</option>)}</select></label>
      </div>
      {previewStaff && <p className="staff-preview">{!partId && !scoreInfo?.automatic_part_id ? 'Proponowana' : 'Wybrana'} pięciolinia {previewStaff.staff} od góry · <strong>{previewStaff.id} · {previewStaff.name}</strong> · {previewStaff.range ? `zakres ${previewStaff.range.low} — ${previewStaff.range.high}` : 'brak nut'}{scorePdf && <> · <a href={scorePdf.url} target="_blank" rel="noreferrer">Sprawdź oryginalny PDF</a></>}</p>}
      <p className="muted" id="staff-help">Linie są uporządkowane od góry partytury. Nazwa „Voice” po OMR nie określa głosu B ani podziału I/II. Sprawdź identyfikator, zakres i oryginalny PDF; nie przypisujemy głosu na podstawie kolejności lub zakresu.</p>
      {!scoreInfo && !reading && <button className="secondary" disabled={!sourceId || !!busy} onClick={() => { setRequestedSource(sourceId); setInspectionVersion(n => n + 1) }}>Odczytaj linie partytury</button>}
      {reading && <p className="notice" role="status"><span className="spinner small"/> Odczytywanie linii… PDF może wymagać kilku minut lokalnego OMR.</p>}
      {needsSelection && <p className="notice" role="status">Nie można jednoznacznie dopasować głosu {part}. Wybierz linię powyżej przed analizą lub generowaniem nagrania.</p>}
      {needsSelection && scoreInfo?.suggested_part_id && <div className="notice"><p>Wstępnie wskazano {scoreInfo.suggested_part_id} dla {part}{part === 'B' ? previewStaff?.bass_clef ? ' na podstawie klucza basowego (F).' : ' jako dolną pięciolinię, ponieważ nie znaleziono klucza basowego (F).' : `, zakładając typowy układ ${scoreInfo.parts.length === 3 ? 'S–A–B' : 'S–A–T–B'} od góry.`} To tylko sugestia, nie rozpoznanie głosu ani podziału I/II. Sprawdź PDF i potwierdź lub wybierz inną pięciolinię.</p><button className="secondary" onClick={() => { if (scoreInfo.suggested_part_id) chooseStaff(scoreInfo.suggested_part_id) }}>Potwierdź wskazaną pięciolinię</button></div>}
      {selectedStaff?.multiple_lines && <p className="notice" role="status">Wykryto kilka melodii lub akord. Wybierz wewnętrzny głos albo górną/dolną nutę akordu, porównując z PDF. To nie rozpoznaje automatycznie podziału B ani nie naprawia OMR; brakujące takty nie zostaną uzupełnione. {ambiguousStaff ? 'Wybór jest wymagany przed analizą i generowaniem.' : 'Analiza i nagranie użyją dokładnie tego wyboru.'}</p>}
      <p className="muted">{getSession()?.hosted ? 'Przewodnik instrumentalny powstaje na serwerze chóru w /data/generated (trwały wolumin Docker). Nie trafia na Google Drive. Możesz pobrać własną kopię WAV.' : 'Przewodnik instrumentalny powstaje tylko lokalnie: domyślnie data\\generated w folderze projektu, lub generated w katalogu JANKO_DATA. Nie wysyłamy go na Google Drive. Po wygenerowaniu zobaczysz pełną ścieżkę i link pobrania.'}</p>
      <label className="checkbox"><input type="checkbox" checked={includeBass} onChange={e => setIncludeBass(e.target.checked)}/> Dodaj linię basu do nagrania ćwiczebnego</label>
      <div className="action-row"><button className="primary" disabled={!canRun} onClick={() => void runAnalysis()}><Sparkles size={17}/> Analizuj partyturę</button><button className="secondary" disabled={!canRun} onClick={() => void runAnalysis(true)}><AudioLines size={17}/> Generuj nagranie</button><button className="secondary" disabled={!!busy || reading || getSession()?.admin === false} title={getSession()?.admin === false ? 'Import wykonuje administrator chóru' : undefined} onClick={() => upload.current?.click()}><FileUp size={17}/> Importuj MusicXML</button></div>
      <input hidden ref={upload} type="file" accept=".musicxml,.xml,.mxl" onChange={e => { const file = e.target.files?.[0]; if (file) void importScore(file) }}/>
      {busy && <p className="notice"><span className="spinner small"/> {busy} {sources.find(f => f.id === sourceId)?.kind === 'pdf' ? 'Rozpoznawanie PDF może potrwać kilka minut.' : ''}</p>}
      {notice && <p className="notice">{notice}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {omr && <div className="omr-message"><h3>Potrzebny MusicXML lub lokalny OMR</h3><p>{omr.message}</p><p>PDF został odczytany{omr.pdf?.pages ? ` (${omr.pdf.pages} stron)` : ''}, ale sam tekst PDF nie wystarcza do wiarygodnego odtworzenia melodii.</p><p>Poproś dyrygenta: <strong>Sibelius → File → Export → MusicXML</strong>, a następnie użyj przycisku Importuj MusicXML. Instrukcja instalacji Audiveris jest w dokumentacji aplikacji.</p>{omr.pdf?.text && <details><summary>Tekst wykryty w PDF (nie jest transkrypcją nut)</summary><pre>{omr.pdf.text.slice(0, 4000)}</pre></details>}</div>}
    </section>
    {analysis && <>
      {(analysis.warning || analysis.warnings.length > 0 || transpose !== 0) && <div className="notice">{analysis.warning}{analysis.warnings.map((w, i) => <p key={i}>{w}</p>)}{transpose !== 0 && <p>Nagranie i analiza są transponowane o {transpose} półtonów. Partytura poniżej pozostaje w oryginalnej tonacji.</p>}</div>}
      <div className="analysis-stats"><div className="panel"><ArrowDownUp/><span>Zakres Twojej linii</span><strong>{analysis.range.low} — {analysis.range.high}</strong><small>{analysis.selected_part.name}</small></div><div className="panel"><Music2/><span>Tempo / długość</span><strong>{Math.round(analysis.tempo)} BPM</strong><small>{timeLabel(analysis.duration)} · {analysis.bars.length} taktów w odtworzeniu</small></div><div className="panel"><Wind/><span>Miejsca na oddech</span><strong>{analysis.breaths.length}</strong><small>Sugestie, nie polecenia dyrygenta</small></div></div>
      {audioUrl && <section className="panel generated-audio"><h3><Play size={18}/> Twoja linia — przewodnik instrumentalny</h3><p className="muted">To syntezowane dźwięki nut, nie śpiew z tekstem. Sylaby możesz śledzić poniżej.</p>{practiceFile && <p className="local-output">{getSession()?.hosted ? 'Zapisano na serwerze chóru, bez wysyłania na Drive:' : 'Zapisano tylko na tym komputerze, bez wysyłania na Drive:'}<br/><code>{practiceFile.local_path}</code><br/><a href={practiceFile.url} download={practiceFile.filename}>Pobierz przewodnik WAV</a> · pobrana kopia trafi do folderu wybranego w przeglądarce.</p>}<audio ref={audio} controls src={audioUrl} onTimeUpdate={e => setPosition(e.currentTarget.currentTime)} onSeeked={e => setPosition(e.currentTarget.currentTime)} onError={() => setError('Nie można odtworzyć wygenerowanego nagrania. Wygeneruj je ponownie z działającym serwerem.')}/><div className="current-note">{currentNote ? <>Takt {currentNote.bar} · <strong>{currentNote.pitch}</strong> · {currentNote.lyric || '—'}</> : 'Pauza / przygotuj oddech'}</div></section>}
      <ScorePlayback songId={song.id} analysis={analysis} position={position} transpose={transpose} onSeek={audioUrl ? time => { if (audio.current) { claimAudio([audio.current]); audio.current.currentTime = time; setPosition(time); void playAudio(audio.current).catch(err => setError(errorMessage(err))) } } : undefined}/>
      <section className="panel difficulty-panel"><h3>Mapa trudności</h3><p className="muted">Heurystyka 0–100: skoki interwałowe, chromatyka i krótkie wartości. Kliknij takt, aby odtworzyć go w nagraniu.</p><div className="heatmap">{analysis.bars.map((bar, index) => <button key={`${bar.number}-${index}`} style={{ backgroundColor: bar.difficulty > 65 ? '#c26a4e' : bar.difficulty > 30 ? '#dcbf78' : '#bbd0bf' }} title={`Takt ${bar.number}: ${bar.difficulty}/100 — ${bar.reasons.join(', ')}`} onClick={() => { const note = analysis.notes.find(n => n.bar === bar.number); if (note && audio.current) { audio.current.currentTime = note.time; setPosition(note.time) } }}>{bar.number}<small>{bar.difficulty}</small></button>)}</div></section>
      <div className="analysis-detail-grid"><section className="panel"><h3><Wind size={18}/> Oddechy i wejścia</h3>{analysis.breaths.slice(0, 40).map((breath, i) => <p className="cue" key={`b${i}`}><span>Takt {breath.bar} · {breath.beat}</span>{breath.reason}</p>)}{analysis.entrances.slice(0, 40).map((entrance, i) => <p className="cue" key={`e${i}`}><span>Takt {entrance.bar} · {entrance.pitch}</span>{entrance.cue}</p>)}</section><section className="panel"><h3>Tekst przy nutach</h3><p className="muted">Sylaby z MusicXML. Wymowa: łacińskie „ae/oe” → „e”, „c” przed e/i → „cz”, „gn” → „ń” (tradycja kościelna; uzgodnij z dyrygentem).</p><div className="lyrics">{analysis.lyrics.length ? analysis.lyrics.map((lyric, index) => <span key={index} title={`Takt ${lyric.bar}, miara ${lyric.beat}`}>{lyric.text}<small>{lyric.bar}:{lyric.beat}</small></span>) : <p>Brak tekstu w tym MusicXML.</p>}</div></section></div>
    </>}
  </div>
}

export function sourceBadge(file: Material) { return file.kind === 'musicxml' ? 'MusicXML' : 'PDF' }
