import { useEffect, useRef, useState } from 'react'
import { OpenSheetMusicDisplay, Pitch, VexFlowGraphicalNote } from 'opensheetmusicdisplay'
import type { Analysis } from './types'
import { errorMessage } from './api'
import { calibration, soundingNote, type SyncAnchor } from './scoreTiming'
import { seekRecording, usePlaybackClock } from './playbackClock'
import './scorePlayback.css'

export default function ScorePlayback({ songId, analysis, xml, position, transpose = 0, onSeek }: {
  songId: string; analysis: Analysis; xml?: string; position: number; transpose?: number
  onSeek?: (time: number) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const graphical = useRef<{ element: SVGElement; notes: Analysis['notes']; source: VexFlowGraphicalNote }[]>([])
  const [error, setError] = useState(''), [mapped, setMapped] = useState(0)
  const [mappedEvents, setMappedEvents] = useState(0)
  const [recording, setRecording] = useState(false), [selectedNote, setSelectedNote] = useState(0)
  const [anchors, setAnchors] = useState<{ track: string; first?: SyncAnchor; second?: SyncAnchor }>({ track: '' })
  const clock = usePlaybackClock()
  const matches = clock.song === songId && !!clock.track
  const mapping = anchors.first && anchors.second && anchors.track === clock.track ? calibration(anchors.first, anchors.second) : null
  const inInterval = !!mapping && !!anchors.first && !!anchors.second && clock.time >= anchors.first.audio && clock.time <= anchors.second.audio
  const scoreTime = recording ? inInterval ? mapping!.scoreTime(clock.time) : -1 : position
  const current = soundingNote(analysis.notes, scoreTime)
  const seek = useRef({ onSeek, recording, mapping, clock, songId, scoreTime, anchors })
  seek.current = { onSeek, recording, mapping, clock, songId, scoreTime, anchors }
  useEffect(() => {
    if (!container.current) return
    let cancelled = false
    setError(''); setMapped(0); setMappedEvents(0)
    const osmd = new OpenSheetMusicDisplay(container.current, { autoResize: false, backend: 'svg', drawTitle: true, followCursor: false })
    async function render() {
      let content = xml
      if (!content) {
        const response = await fetch(analysis.musicxml_url)
        if (!response.ok) throw new Error(`MusicXML: HTTP ${response.status}`)
        const buffer = await response.arrayBuffer(), bytes = new Uint8Array(buffer)
        await osmd.load(bytes[0] === 0x50 && bytes[1] === 0x4b ? new Blob([buffer]) : new TextDecoder().decode(buffer))
      } else await osmd.load(content)
      if (cancelled) return
      osmd.render()
      const entries: typeof graphical.current = []
      for (const measures of osmd.GraphicSheet.MeasureList) for (const measure of measures) {
        // OSMD leaves holes for hidden staves and condensed multi-measure rests.
        if (!measure?.ParentStaff) continue
        if (measure.ParentStaff.ParentInstrument.IdString !== analysis.selected_part.id) continue
        const bar = measure.parentSourceMeasure.MeasureNumberXML
        for (const staff of measure.staffEntries) for (const voice of staff.graphicalVoiceEntries) for (const note of voice.notes) {
          if (!(note instanceof VexFlowGraphicalNote) || note.sourceNote.isRest()) continue
          const pitch = note.sourceNote.Pitch
          // OSMD exposes XML octave minus OctaveXmlDifference.
          const midi = pitch.FundamentalNote + (pitch.Octave + 1 + Pitch.OctaveXmlDifference) * 12 + pitch.AccidentalHalfTones
          const beat = staff.relInMeasureTimestamp.RealValue * 4 + 1
          const events = analysis.notes.filter(event => event.bar === bar &&
            Math.abs(event.beat - beat) < 0.02 && event.midi === midi + transpose)
          if (!events.length) continue
          const element = note.getSVGGElement()
          if (!element) continue
          element.classList.add('score-note-link')
          element.setAttribute('data-note-time', String(events[0].time))
          element.setAttribute('role', 'button'); element.setAttribute('tabindex', '0')
          element.setAttribute('aria-label', `Takt ${events[0].bar}, ${events[0].pitch}. Odtwórz od nuty.`)
          const activate = () => {
            const state = seek.current
            const event = [...events].sort((a, b) => Math.abs(a.time - state.scoreTime) - Math.abs(b.time - state.scoreTime))[0]
            if (state.recording) {
              if (!state.mapping || !state.anchors.first || !state.anchors.second ||
                  event.time < state.anchors.first.score || event.time > state.anchors.second.score) {
                setError('Ta nuta jest poza skalibrowanym odcinkiem. Ustaw dwa punkty obejmujące ten fragment.'); return
              }
              seekRecording(state.songId, state.clock.track, state.mapping.audioTime(event.time))
            } else if (state.onSeek) state.onSeek(event.time)
            else setError('Najpierw wygeneruj nagranie, aby odtwarzać od nuty.')
          }
          element.addEventListener('click', activate)
          element.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate() } })
          entries.push({ element, notes: events, source: note })
        }
      }
      graphical.current = entries; setMapped(entries.length)
      setMappedEvents(new Set(entries.flatMap(entry => entry.notes)).size)
    }
    void render().catch(err => { if (!cancelled) setError(`Nie można powiązać nut z MusicXML: ${errorMessage(err)}`) })
    return () => { cancelled = true; graphical.current = []; osmd.clear() }
  }, [xml, analysis, transpose])
  useEffect(() => {
    graphical.current.forEach(entry => {
      const active = !!current && entry.notes.includes(current)
      entry.element.classList.toggle('score-note-active', active)
      entry.source.setColor(active ? '#cd6338' : '#263d30', { applyToNoteheads: true, applyToStem: false, applyToBeams: false })
      entry.element.setAttribute('aria-pressed', String(active))
    })
  }, [current, mapped])
  function mark(which: 'first' | 'second') {
    if (!matches) { setError('Uruchom nagranie tego utworu w stałym odtwarzaczu.'); return }
    const anchor = { score: analysis.notes[selectedNote].time, audio: clock.time }
    const next = { ...(anchors.track === clock.track ? anchors : { track: clock.track }), [which]: anchor }
    try {
      if (next.first && next.second) calibration(next.first, next.second)
      setAnchors(next); setError('')
    } catch (err) { setError(errorMessage(err)) }
  }
  return <section className="panel score-playback">
    <h3>MusicXML · śledzenie i kliknięcie nuty</h3>
    <p className="muted">Wygenerowany WAV korzysta z tych samych czasów nut. Kliknij podświetlaną linię, aby odtwarzać od nuty. Pauzy nie są podświetlane; przy repetycji wybieramy najbliższe bieżącemu czasowi wystąpienie. OMR trzeba sprawdzić z PDF.</p>
    <label className="checkbox"><input type="checkbox" checked={recording} onChange={event => { setRecording(event.target.checked); setError('') }}/> Próbuj z nagraniem ze stałego odtwarzacza (kalibracja)</label>
    {recording && <div className="score-calibration"><p>To <strong>przybliżenie tylko między dwoma punktami</strong>, nie automatyczne rozpoznanie wykonania. Wybierz nutę, zatrzymaj nagranie w jej wejściu i zaznacz punkt. Powtórz dalej. Rubato, repetycje i inne tempo wewnątrz odcinka powodują rozjazd — kalibruj krótszy fragment.</p>
      <label>Nuta do punktu<select aria-label="Nuta do kalibracji" value={selectedNote} onChange={event => setSelectedNote(Number(event.target.value))}>{analysis.notes.map((note, index) => <option key={index} value={index}>Takt {note.bar} · {note.beat} · {note.pitch} · {note.time.toFixed(2)} s</option>)}</select></label>
      <button className="secondary" onClick={() => mark('first')}>Zaznacz punkt 1 teraz</button><button className="secondary" onClick={() => mark('second')}>Zaznacz punkt 2 teraz</button>
      <p role="status">{anchors.first ? `Punkt 1: nuty ${anchors.first.score.toFixed(2)} s / audio ${anchors.first.audio.toFixed(2)} s. ` : ''}{anchors.second ? `Punkt 2: nuty ${anchors.second.score.toFixed(2)} s / audio ${anchors.second.audio.toFixed(2)} s. ` : ''}{mapping ? inInterval ? 'Kalibracja przybliżona aktywna.' : 'Poza skalibrowanym odcinkiem — bez podświetlania.' : 'Ustaw dwa punkty dla tego samego nagrania.'}</p>
    </div>}
    <p className="muted">{mapped ? `${mapped} znaków nut powiązanych z ${mappedEvents}/${analysis.notes.length} zdarzeniami audio. ${mappedEvents < analysis.notes.length ? 'Częściowa mapa: pozostałe zdarzenia nie mają potwierdzonego podświetlenia.' : ''}` : 'Brak potwierdzonego powiązania nut — odtwarzanie kliknięciem pozostaje niedostępne.'}{current ? ` Teraz: takt ${current.bar}, ${current.pitch}.` : ' Pauza / brak powiązanego czasu.'}</p>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="rendered-score phone-notation" ref={container}/>
  </section>
}
