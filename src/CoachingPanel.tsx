import { useEffect, useRef, useState } from 'react'
import { AudioLines, Brain, Download, Ear, Mic, MicOff, Music2, Pause, Play, Repeat2, Square, Trash2, Wind } from 'lucide-react'
import { errorMessage, isMyPart, timeLabel } from './api'
import { userStorage as localStorage } from './session'
import { centsFrom, detectPitch, intervalPairs, maskedLyric, midiFrequency, phraseBounds, pitchName, targetAt } from './pitch'
import type { Pitch } from './pitch'
import { deleteRecording, listRecordings, saveRecording } from './recordings'
import type { Recording } from './recordings'
import type { Analysis, Part, Song } from './types'
import './coaching.css'

export interface CoachGuide { analysis: Analysis; url: string; tempoFactor: number; transpose: number }
export function guideKey(songId: string, part: Part) { return `janko.coach.${songId}.${part}` }
interface Trace { midi: number | null; target: number; }
interface Feedback { matched: number; detected: number; frames: number }
const intervals = ['Unison', 'Sekunda mała', 'Sekunda wielka', 'Tercja mała', 'Tercja wielka', 'Kwarta', 'Tryton', 'Kwinta', 'Seksta mała', 'Seksta wielka', 'Septyma mała', 'Septyma wielka', 'Oktawa']

export default function CoachingPanel({ song, part, onBeforeMicrophone, localGuide }: {
  song: Song; part: Part; onBeforeMicrophone?: () => Promise<void>; localGuide?: CoachGuide | null
}) {
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [guide, setGuide] = useState<CoachGuide | null>(null)
  const [referenceId, setReferenceId] = useState('')
  const tracks = song.files.filter(f => f.kind === 'audio')
  const [microphone, setMicrophone] = useState(false)
  const [micBusy, setMicBusy] = useState(false)
  const [pitch, setPitch] = useState<Pitch | null>(null)
  const [fixedMidi, setFixedMidi] = useState(part === 'B' ? 55 : part.startsWith('A') ? 64 : 69)
  const [latency, setLatency] = useState(0)
  const [trace, setTrace] = useState<Trace[]>([])
  const [feedback, setFeedback] = useState<Feedback>({ matched: 0, detected: 0, frames: 0 })
  const [lastPhrase, setLastPhrase] = useState<Feedback | null>(null)
  const feedbackRef = useRef(feedback)
  feedbackRef.current = feedback
  const [recording, setRecording] = useState(false)
  const [takes, setTakes] = useState<Recording[]>([])
  const [takeId, setTakeId] = useState('')
  const [unsaved, setUnsaved] = useState<Recording | null>(null)
  const [recordedUrl, setRecordedUrl] = useState('')
  const [recordVolume, setRecordVolume] = useState(1)
  const [referenceVolume, setReferenceVolume] = useState(0.25)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [drill, setDrill] = useState(false)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(10)
  const [fromBar, setFromBar] = useState(1)
  const [toBar, setToBar] = useState(2)
  const [speed, setSpeed] = useState(0.6)
  const [step, setStep] = useState(0.05)
  const [repetitions, setRepetitions] = useState(0)
  const [memoryMode, setMemoryMode] = useState<'full' | 'initials' | 'hidden'>('full')
  const [notesHidden, setNotesHidden] = useState(false)
  const [warmup, setWarmup] = useState(-1)
  const [warmupSeconds, setWarmupSeconds] = useState(0)
  const [quiz, setQuiz] = useState<{ first: number; second: number; interval: number } | null>(null)
  const [answer, setAnswer] = useState<number | null>(null)
  const [compareOffset, setCompareOffset] = useState(0)
  const reference = useRef<HTMLAudioElement>(null)
  const takeAudio = useRef<HTMLAudioElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const micContext = useRef<AudioContext | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const frame = useRef(0)
  const alive = useRef(true)
  const micGeneration = useRef(0)
  const tones = useRef<AudioContext | null>(null)
  const oscillators = useRef<OscillatorNode[]>([])
  const recordingStart = useRef(0)
  const current = useRef({ guide, referenceId, fixedMidi, latency, drill, start, end, speed, step, recording })
  current.current = { guide, referenceId, fixedMidi, latency, drill, start, end, speed, step, recording }
  const take = unsaved?.id === takeId ? unsaved : takes.find(item => item.id === takeId)
  const usingGuide = !!guide && referenceId === guide.url
  const selectedTrack = tracks.find(item => item.id === referenceId)
  const referenceUrl = usingGuide ? guide.url : selectedTrack?.url
  const target = usingGuide ? targetAt(guide.analysis.notes, Math.max(0, position - latency / 1000))?.midi : fixedMidi
  const cents = pitch && target !== undefined ? centsFrom(pitch.midi, target) : null

  async function refreshTakes() {
    try { const items = await listRecordings(song.id, part); if (alive.current) setTakes(items) }
    catch (err) { if (alive.current) setError(errorMessage(err)) }
  }
  useEffect(() => {
    alive.current = true
    try {
      const saved = localGuide ? JSON.stringify(localGuide) : localStorage.getItem(guideKey(song.id, part))
      if (saved) {
        const parsed: CoachGuide = JSON.parse(saved)
        if (!parsed.analysis?.notes?.length || !localGuide && !parsed.url?.startsWith('/api/practice/')) throw new Error('Nieprawidłowy zapis przewodnika. Wygeneruj go ponownie w Analizie.')
        setGuide(parsed); setReferenceId(parsed.url)
        setFromBar(parsed.analysis.notes[0].bar); setToBar(parsed.analysis.notes[Math.min(8, parsed.analysis.notes.length - 1)].bar)
      } else {
        const preferred = tracks.find(f => f.part === part && !f.slow) ?? tracks.find(f => isMyPart(f.part, part) && !f.slow) ?? tracks[0]
        setReferenceId(preferred?.id ?? '')
      }
    } catch (err) { setError(errorMessage(err)) }
    void refreshTakes()
    return () => {
      alive.current = false
      stopMic()
      reference.current?.pause(); takeAudio.current?.pause()
      stopTones()
      if (tones.current) { void tones.current.close(); tones.current = null }
    }
  }, [song.id, part, localGuide])

  useEffect(() => {
    if (!take) { setRecordedUrl(''); return }
    const url = URL.createObjectURL(take.blob); setRecordedUrl(url); setCompareOffset(take.offset)
    return () => URL.revokeObjectURL(url)
  }, [take])
  useEffect(() => {
    if (reference.current) { reference.current.volume = referenceVolume; reference.current.playbackRate = speed; reference.current.preservesPitch = true }
    if (takeAudio.current) takeAudio.current.volume = recordVolume
  }, [referenceVolume, recordVolume, speed, referenceUrl])
  useEffect(() => {
    if (!recording) return
    const timer = window.setTimeout(() => { stopRecording(); setNotice('Zakończono nagranie po limicie 10 minut.') }, 600000)
    return () => clearTimeout(timer)
  }, [recording])
  useEffect(() => {
    if (warmup < 0) return
    const started = performance.now()
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((performance.now() - started) / 1000)
      if (elapsed >= 30) { setWarmup(warmup >= 3 ? -1 : warmup + 1); setWarmupSeconds(0) }
      else setWarmupSeconds(elapsed)
    }, 1000)
    return () => clearInterval(timer)
  }, [warmup])

  function stopTones() {
    oscillators.current.forEach(oscillator => { try { oscillator.stop() } catch (err) { if (!(err instanceof DOMException && err.name === 'InvalidStateError')) console.warn('Tone stop failed', err) } })
    oscillators.current = []
  }
  async function playTones(sequence: { midi: number; duration: number; offset: number }[]) {
    try {
      stopTones()
      if (!window.AudioContext) throw new Error('Ta przeglądarka nie obsługuje Web Audio. Otwórz aplikację w aktualnym Safari lub Chrome; nagrania wzorcowe nadal możesz odtwarzać odtwarzaczem.')
      const context = tones.current ?? new window.AudioContext()
      tones.current = context; await context.resume()
      if (!alive.current) return
      for (const item of sequence) {
        const oscillator = context.createOscillator(), gain = context.createGain()
        oscillator.type = 'sine'; oscillator.frequency.value = midiFrequency(item.midi)
        const when = context.currentTime + item.offset
        gain.gain.setValueAtTime(0, when); gain.gain.linearRampToValueAtTime(0.16, when + 0.03)
        gain.gain.setValueAtTime(0.16, when + Math.max(0.04, item.duration - 0.04))
        gain.gain.linearRampToValueAtTime(0, when + item.duration)
        oscillator.connect(gain); gain.connect(context.destination)
        oscillator.start(when); oscillator.stop(when + item.duration + 0.01)
        oscillators.current.push(oscillator)
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); oscillators.current = oscillators.current.filter(value => value !== oscillator) }
      }
    } catch (err) { setError(`Nie można odtworzyć dźwięku: ${errorMessage(err)}`) }
  }
  async function startMic() {
    if (micBusy || stream.current) return
    setMicBusy(true); setError('')
    const generation = ++micGeneration.current
    let acquired: MediaStream | null = null
    try {
      await onBeforeMicrophone?.()
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Mikrofon wymaga aktualnego Safari, Chrome, Edge lub Firefox oraz localhost lub HTTPS. Ta przeglądarka nie udostępnia mikrofonu.')
      if (!window.AudioContext) throw new Error('Trener wysokości wymaga Web Audio. Otwórz aplikację w aktualnej przeglądarce z obsługą dźwięku.')
      acquired = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false })
      if (!alive.current || generation !== micGeneration.current) { acquired.getTracks().forEach(track => track.stop()); return }
      stream.current = acquired
      const context = new AudioContext()
      micContext.current = context; await context.resume()
      if (!alive.current || generation !== micGeneration.current) { acquired.getTracks().forEach(track => track.stop()); await context.close(); return }
      const source = context.createMediaStreamSource(acquired), analyser = context.createAnalyser()
      analyser.fftSize = 4096; source.connect(analyser)
      const buffer = new Float32Array(analyser.fftSize)
      let last = 0
      setMicrophone(true); setTrace([]); setLastPhrase(null); setFeedback({ matched: 0, detected: 0, frames: 0 })
      acquired.getAudioTracks()[0]?.addEventListener('ended', () => {
        if (alive.current && stream.current) { stopMic(); setError('Mikrofon został odłączony lub przeglądarka odebrała dostęp.') }
      })
      function update(now: number) {
        if (!alive.current || generation !== micGeneration.current) return
        if (now - last >= 100) {
          last = now; analyser.getFloatTimeDomainData(buffer)
          const detected = detectPitch(buffer, context.sampleRate)
          setPitch(detected)
          const state = current.current
          const audio = reference.current
          const guideSelected = state.guide && state.referenceId === state.guide.url
          const aligned = guideSelected && audio && !audio.paused
          const note = aligned ? targetAt(state.guide!.analysis.notes, Math.max(0, audio!.currentTime - state.latency / 1000)) : null
          const expected = guideSelected ? note?.midi : state.fixedMidi
          if (expected !== undefined) {
            setTrace(items => [...items.slice(-179), { midi: detected?.midi ?? null, target: expected }])
            setFeedback(stats => ({
              frames: stats.frames + 1, detected: stats.detected + (detected ? 1 : 0),
              matched: stats.matched + (detected && Math.abs(centsFrom(detected.midi, expected)) <= 50 ? 1 : 0)
            }))
          }
        }
        frame.current = requestAnimationFrame(update)
      }
      frame.current = requestAnimationFrame(update)
    } catch (err) {
      acquired?.getTracks().forEach(track => track.stop()); stream.current = null
      if (micContext.current) { void micContext.current.close(); micContext.current = null }
      if (alive.current) setError(`Nie można uruchomić mikrofonu: ${errorMessage(err)} Sprawdź zgodę w ustawieniach przeglądarki.`)
    } finally { if (alive.current) setMicBusy(false) }
  }
  function stopRecording() {
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop()
    recorder.current = null
    if (alive.current) setRecording(false)
  }
  function stopMic() {
    micGeneration.current++
    cancelAnimationFrame(frame.current); stopRecording()
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null
    if (micContext.current) { void micContext.current.close(); micContext.current = null }
    if (alive.current) { setMicrophone(false); setPitch(null); setMicBusy(false) }
  }
  function startRecording() {
    if (!stream.current || recording) return
    setError(''); setNotice('')
    try {
      if (!window.MediaRecorder) throw new Error('Ta przeglądarka nie obsługuje MediaRecorder. Użyj aktualnego Chrome lub Edge.')
      const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(value => MediaRecorder.isTypeSupported(value))
      const capture = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined)
      recorder.current = capture
      const chunks: Blob[] = []
      let bytes = 0
      const offset = reference.current?.currentTime ?? 0
      const referenceSpeed = speed, capturedReference = referenceId || null
      capture.ondataavailable = event => {
        if (event.data.size) { chunks.push(event.data); bytes += event.data.size }
        if (bytes > 40 * 1024 * 1024 && capture.state !== 'inactive') { stopRecording(); setNotice('Osiągnięto limit 40 MB nagrania. Pobierz próbę na dysk.') }
      }
      capture.onerror = event => { stopRecording(); setError(`Nagrywanie przerwane: ${event.type}. Spróbuj ponownie.`) }
      capture.onstop = () => {
        const blob = new Blob(chunks, { type: capture.mimeType })
        if (!blob.size) { if (alive.current) setError('Nagranie jest puste. Sprawdź mikrofon.'); return }
        const item: Recording = { id: crypto.randomUUID(), songId: song.id, part, blob, duration: (performance.now() - recordingStart.current) / 1000,
          created: new Date().toISOString(), offset, referenceId: capturedReference, referenceSpeed }
        void saveRecording(item).then(async () => {
          if (alive.current) { await refreshTakes(); setTakeId(item.id); setNotice('Nagranie zapisano w przeglądarce — nic nie wysłano na Google Drive.') }
        }).catch(err => { if (alive.current) { setUnsaved(item); setTakeId(item.id); setError(`${errorMessage(err)} Możesz nadal pobrać nagranie.`) } })
      }
      capture.start(1000); recordingStart.current = performance.now(); setRecording(true)
    } catch (err) { setError(errorMessage(err)) }
  }
  function pauseReference() { reference.current?.pause(); takeAudio.current?.pause(); setPlaying(false); setDrill(false) }
  async function playReference(loopPhrase = false) {
    const audio = reference.current
    if (!audio || !referenceUrl) return
    setError('')
    try {
      if (loopPhrase && (!Number.isFinite(duration) || start < 0 || end <= start + 0.25 || end > duration + 0.1)) throw new Error('Ustaw poprawny fragment: koniec musi być później od początku i wewnątrz nagrania.')
      if (loopPhrase) { audio.currentTime = start; setRepetitions(0); setLastPhrase(null); setFeedback({ matched: 0, detected: 0, frames: 0 }) }
      audio.preservesPitch = true; audio.playbackRate = speed
      setDrill(loopPhrase); await audio.play(); setPlaying(true)
    } catch (err) { setDrill(false); setError(`Nie można odtworzyć wzorca: ${errorMessage(err)}`) }
  }
  function audioTime(audio: HTMLAudioElement) {
    setPosition(audio.currentTime)
    if (Number.isFinite(audio.duration)) setDuration(audio.duration)
    const state = current.current
    if (state.drill && audio.currentTime >= state.end) {
      if (microphone) { setLastPhrase(feedbackRef.current); setFeedback({ matched: 0, detected: 0, frames: 0 }) }
      const nextSpeed = Math.min(1, Math.round((audio.playbackRate + state.step) * 100) / 100)
      audio.currentTime = state.start; audio.playbackRate = nextSpeed; setSpeed(nextSpeed)
      setRepetitions(value => value + 1)
    }
  }
  async function compare() {
    if (!takeAudio.current || !take || !reference.current) return
    setError(''); setDrill(false)
    try {
      if (take.referenceId !== referenceId) throw new Error('Wybierz ten sam wzorzec, przy którym nagrano próbę. Dopiero wtedy porównuj równocześnie.')
      if (!Number.isFinite(compareOffset) || compareOffset < 0 || compareOffset >= (reference.current.duration || 0)) throw new Error('Początek porównania musi mieścić się w czasie nagrania wzorcowego.')
      takeAudio.current.currentTime = 0; takeAudio.current.playbackRate = 1
      reference.current.currentTime = compareOffset
      setSpeed(take.referenceSpeed); reference.current.playbackRate = take.referenceSpeed
      reference.current.preservesPitch = true
      await Promise.all([takeAudio.current.play(), reference.current.play()])
      setPlaying(true)
    } catch (err) { pauseReference(); setError(errorMessage(err)) }
  }
  function newQuiz() {
    const pairs = guide ? intervalPairs(guide.analysis.notes) : []
    const pair = pairs.length ? pairs[Math.floor(Math.random() * pairs.length)] :
      { first: fixedMidi, second: fixedMidi + [2, 3, 4, 5, 7, 12][Math.floor(Math.random() * 6)], interval: 0 }
    const value = { ...pair, interval: Math.abs(pair.second - pair.first) }
    setQuiz(value); setAnswer(null)
    void playTones([{ midi: value.first, duration: 0.8, offset: 0 }, { midi: value.second, duration: 0.8, offset: 1 }])
  }
  const warmups = [
    { title: 'Spokojny oddech', text: warmupSeconds % 8 < 3 ? 'Wygodny, cichy wdech. Nie unoś ramion.' : 'Łagodny wydech na „sss”, bez zatrzymywania oddechu.' },
    { title: 'Mruczenie', text: 'Lekkie „mmm” w wygodnym rejestrze. Rozluźnij szczękę. Nie zwiększaj siły.' },
    { title: 'Mała syrena', text: 'Ciche „ng” lub drganie warg. Płynnie tylko przez komfortowy zakres.' },
    { title: 'Krótka skala', text: 'Zaśpiewaj 1–2–3–2–1 na „nu”. Odtwórz wzorzec i dostosuj dźwięk początkowy.' }
  ]
  const graphMin = trace.length ? Math.min(...trace.map(t => t.target)) - 4 : fixedMidi - 4
  const graphMax = trace.length ? Math.max(...trace.map(t => t.target)) + 4 : fixedMidi + 4
  const y = (midi: number) => 160 - Math.max(0, Math.min(150, (midi - graphMin) / (graphMax - graphMin) * 150))
  const graphX = (index: number) => index / 179 * 600
  const voicedSegments: string[] = []; let segment = ''
  trace.forEach((point, index) => {
    if (point.midi === null) { if (segment) voicedSegments.push(segment); segment = '' }
    else segment += `${segment ? ' L' : 'M'}${graphX(index)},${y(point.midi)}`
  })
  if (segment) voicedSegments.push(segment)
  return <div className="coaching-workspace">
    <section className="panel coach-intro"><span className="eyebrow"><Mic size={16}/> COACHING · ETAP 3</span><h2>Posłuchaj siebie. Śpiewaj swobodniej.</h2>
      <p className="muted">Używaj słuchawek, aby mikrofon mierzył Twój głos, nie głośniki. Wysokość tonu jest wskazówką techniczną, nie oceną jakości śpiewu. Nagrania pozostają w tej przeglądarce.</p>
      {!guide && <p className="notice">Aby porównywać z nutami swojej partii, najpierw wygeneruj nagranie w „Analiza i generowanie”. Bez niego trener działa jako tuner na wybrany dźwięk; nie zgaduje melodii z plików audio.</p>}
      {guide && <p className="notice">Cel z partii {guide.analysis.selected_part.id} · {guide.tempoFactor * 100}% tempa · transpozycja {guide.transpose}. {guide.analysis.source_id.startsWith('omr-') ? 'Uwaga: OMR ma możliwe błędy. Sprawdź nuty przed traktowaniem wskazań jako wzorca.' : 'Cel pochodzi z wybranego MusicXML.'}</p>}
      {error && <p className="error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
    </section>
    <div className="coach-grid">
      <section className="panel pitch-panel"><h3><Mic size={18}/> Trener wysokości</h3><div className="action-row">
        <button className={microphone ? 'secondary' : 'primary'} disabled={micBusy} onClick={() => microphone ? stopMic() : void startMic()}>{microphone ? <MicOff size={16}/> : <Mic size={16}/>} {micBusy ? 'Oczekiwanie na zgodę…' : microphone ? 'Wyłącz mikrofon' : 'Włącz mikrofon'}</button>
        <button className="secondary" onClick={() => { setTrace([]); setLastPhrase(null); setFeedback({ matched: 0, detected: 0, frames: 0 }) }}>Nowa próba</button>
      </div><div className="pitch-values"><div><small>Twój dźwięk</small><strong>{pitch ? pitchName(pitch.midi) : '—'}</strong><span>{pitch ? `${pitch.hz.toFixed(1)} Hz` : microphone ? 'Zaśpiewaj jeden dźwięk' : 'Mikrofon wyłączony'}</span></div><div><small>Cel</small><strong>{target !== undefined ? pitchName(target) : 'Pauza'}</strong><span>{usingGuide ? 'Z wygenerowanej partii' : 'Stały dźwięk'}</span></div><div><small>Różnica</small><strong className={cents !== null && Math.abs(cents) <= 50 ? 'in-tune' : ''}>{cents === null ? '—' : `${cents > 0 ? '+' : ''}${Math.round(cents)} ¢`}</strong><span>{cents === null ? 'Brak pewnego tonu' : Math.abs(cents) <= 50 ? 'Blisko celu' : cents > 0 ? 'Wyżej niż cel' : 'Niżej niż cel'}</span></div></div>
        <svg className="pitch-graph" viewBox="0 0 600 180" role="img" aria-label="Historia wysokości głosu i docelowych nut"><line x1="0" y1="85" x2="600" y2="85" stroke="#d5dfcd"/><polyline points={trace.map((p, i) => `${graphX(i)},${y(p.target)}`).join(' ')} fill="none" stroke="#adc490" strokeWidth="5"/>{voicedSegments.map((path, i) => <path key={i} d={path} fill="none" stroke="#294c3b" strokeWidth="2.5"/>)}</svg>
        <div className="pitch-summary"><span>W granicach ±50 centów: <strong>{feedback.detected ? Math.round(feedback.matched / feedback.detected * 100) : '—'}%</strong> wykrytych próbek</span><span>Pokrycie głosem: <strong>{feedback.frames ? Math.round(feedback.detected / feedback.frames * 100) : '—'}%</strong></span></div>
        {lastPhrase && <p className="notice">Ostatnia powtórka: {lastPhrase.detected ? Math.round(lastPhrase.matched / lastPhrase.detected * 100) : '—'}% wykrytych tonów w granicach ±50¢ · pokrycie głosem {lastPhrase.frames ? Math.round(lastPhrase.detected / lastPhrase.frames * 100) : '—'}%. {usingGuide ? 'Porównanie z linią MusicXML.' : 'Tylko porównanie ze stałym dźwiękiem tunera, nie całą melodią.'}</p>}
        <p className="muted">Zielony: cel, ciemny: wykryty głos. Cisza i szum nie dostają punktów. Pomiar ok. 10 razy/s, zakres 65–1200 Hz; oktawy i hałas mogą powodować pomyłki.</p>
        <label className="coach-field">Dźwięk tunera / rozgrzewki<select aria-label="Dźwięk tunera" value={fixedMidi} onChange={e => setFixedMidi(Number(e.target.value))}>{Array.from({ length: 37 }, (_, i) => i + 43).map(n => <option key={n} value={n}>{pitchName(n)}</option>)}</select></label>
        <label className="coach-field">Korekcja opóźnienia mikrofonu (ms)<input aria-label="Opóźnienie mikrofonu" type="number" min={-1000} max={1000} step={50} value={latency} onChange={e => setLatency(Math.max(-1000, Math.min(1000, Number(e.target.value))))}/></label>
        <button className="secondary" onClick={() => void playTones([{ midi: guide?.analysis.notes[0]?.midi ?? fixedMidi, duration: 2, offset: 0 }])}><Music2 size={16}/> Dźwięk początkowy</button>
      </section>
      <section className="panel drill-panel"><h3><Repeat2 size={18}/> Wzorzec i ćwiczenie frazy</h3><label className="coach-field">Nagranie wzorcowe<select aria-label="Wzorzec coachingu" value={referenceId} disabled={recording} onChange={e => { pauseReference(); setReferenceId(e.target.value); setPosition(0); setDuration(0); setLastPhrase(null); setFeedback({ matched: 0, detected: 0, frames: 0 }) }}><option value="">Brak wzorca</option>{guide && <option value={guide.url}>Wygenerowana moja partia · cel z nut</option>}{tracks.map(track => <option key={track.id} value={track.id}>{track.name}</option>)}</select></label>
        {!usingGuide && guide && <p className="muted">Oryginalne nagranie może różnić się od nut czasowo. Pomiar odnosi się teraz do stałego dźwięku tunera, nie do melodii.</p>}
        {referenceUrl && <audio ref={reference} src={referenceUrl} preload="metadata" controls onTimeUpdate={e => audioTime(e.currentTarget)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onLoadedMetadata={e => { const value = e.currentTarget.duration; if (Number.isFinite(value)) { setDuration(value); setEnd(Math.min(10, value)) } }} onEnded={() => { if (current.current.drill) { eLoop() } else { setPlaying(false); stopRecording() } }} onError={() => { pauseReference(); setError('Nie można odczytać wzorca. Zapisz materiał offline lub wygeneruj go ponownie.') }}/>}
        <div className="action-row"><button className="primary" disabled={!referenceUrl} onClick={() => playing ? pauseReference() : void playReference()}>{playing ? <Pause size={15}/> : <Play size={15}/>} {playing ? 'Pauza wzorca' : 'Odtwórz wzorzec'}</button><span className="muted">{timeLabel(position)} / {timeLabel(duration)}</span></div>
        <div className="coach-two"><label className="coach-field">Początek (s)<input aria-label="Początek frazy" type="number" min={0} max={duration} step={0.1} value={start} disabled={recording || drill} onChange={e => setStart(Number(e.target.value))}/></label><label className="coach-field">Koniec (s)<input aria-label="Koniec frazy" type="number" min={0} max={duration} step={0.1} value={end} disabled={recording || drill} onChange={e => setEnd(Number(e.target.value))}/></label></div>
        {usingGuide && <><div className="coach-two"><label className="coach-field">Od taktu<input aria-label="Od taktu" type="number" value={fromBar} onChange={e => setFromBar(Number(e.target.value))}/></label><label className="coach-field">Do taktu<input aria-label="Do taktu" type="number" value={toBar} onChange={e => setToBar(Number(e.target.value))}/></label></div><button className="secondary" disabled={recording || drill} onClick={() => { try { const bounds = phraseBounds(guide.analysis.notes, fromBar, toBar, guide.analysis.duration); setStart(bounds.start); setEnd(bounds.end); setError('') } catch (err) { setError(errorMessage(err)) } }}>Ustaw frazę z taktów (pierwsze wykonanie)</button></>}
        <div className="coach-two"><label className="coach-field">Tempo ćwiczenia<select aria-label="Tempo frazy" value={speed} disabled={recording} onChange={e => setSpeed(Number(e.target.value))}>{Array.from({ length: 11 }, (_, i) => Math.round((0.5 + i * 0.05) * 100) / 100).map(value => <option key={value} value={value}>{Math.round(value * 100)}%</option>)}</select></label><label className="coach-field">Przyspieszenie / powtórkę<select aria-label="Przyspieszenie frazy" value={step} onChange={e => setStep(Number(e.target.value))}><option value={0}>Bez przyspieszania</option><option value={0.05}>+5%</option><option value={0.1}>+10%</option></select></label></div>
        <button className="secondary" disabled={!referenceUrl || recording || !duration} onClick={() => drill ? pauseReference() : void playReference(true)}><Repeat2 size={16}/>{drill ? 'Zatrzymaj frazę' : 'Ćwicz frazę w pętli'}</button>
        <p className="muted">Powtórzenia: {repetitions} · aktualne tempo {Math.round(speed * 100)}%. Tempo rośnie do 100% wybranego nagrania bez zmiany wysokości. Wolniejszy oryginał pozostaje wolniejszym oryginałem.</p>
      </section>
    </div>
    <section className="panel recording-panel"><h3><AudioLines size={18}/> Nagraj i porównaj</h3><p className="muted">Zapisujemy tylko mikrofon (bez wzorca). Odtwarzaj wzorzec przez słuchawki. Maksymalnie 10 minut jednej próby; format zależy od przeglądarki.</p><div className="action-row"><button className={recording ? 'secondary recording-active' : 'primary'} disabled={!microphone} onClick={() => recording ? stopRecording() : startRecording()}>{recording ? <Square size={15}/> : <Mic size={15}/>} {recording ? 'Zatrzymaj nagranie' : 'Nagraj próbę'}</button><span className="muted">{!microphone ? 'Najpierw włącz mikrofon.' : recording ? 'Nagrywanie tylko lokalne…' : 'Mikrofon gotowy.'}</span></div>
      <label className="coach-field">Twoje nagrania<select aria-label="Twoje nagrania" value={takeId} onChange={e => { takeAudio.current?.pause(); setTakeId(e.target.value) }}><option value="">Wybierz próbę…</option>{unsaved && <option value={unsaved.id}>Niezapisane — pobierz na dysk</option>}{takes.map(item => <option key={item.id} value={item.id}>{new Date(item.created).toLocaleString('pl')} · {timeLabel(item.duration)} · {Math.round(item.referenceSpeed * 100)}%</option>)}</select></label>
      {take && <><audio ref={takeAudio} controls src={recordedUrl} onEnded={() => { reference.current?.pause(); setPlaying(false) }} onError={() => setError('Nie można odtworzyć tej próby w bieżącej przeglądarce. Pobierz plik i spróbuj w przeglądarce, która go nagrała.')}/>
        <div className="coach-two"><label className="coach-field">Twój głos<input aria-label="Głośność nagrania" type="range" min={0} max={1} step={0.01} value={recordVolume} onChange={e => setRecordVolume(Number(e.target.value))}/></label><label className="coach-field">Wzorzec<input aria-label="Głośność wzorca" type="range" min={0} max={1} step={0.01} value={referenceVolume} onChange={e => setReferenceVolume(Number(e.target.value))}/></label></div>
        <label className="coach-field">Start wzorca przy początku próby (s)<input aria-label="Wyrównanie nagrania" type="number" step={0.05} min={0} max={duration} value={compareOffset} onChange={e => setCompareOffset(Number(e.target.value))}/></label>
        <div className="action-row"><button className="secondary" disabled={!referenceUrl || recording} onClick={() => void compare()}><Play size={16}/> Porównaj równocześnie</button><button className="secondary" onClick={pauseReference}><Pause size={16}/> Zatrzymaj porównanie</button><a className="secondary" href={recordedUrl} download={`Janko-${song.id}-${part}-${take.id}.${take.blob.type.includes('mp4') ? 'm4a' : take.blob.type.includes('ogg') ? 'ogg' : 'webm'}`}><Download size={16}/> Pobierz próbę</a><button className="secondary" onClick={() => { void deleteRecording(take.id).then(async () => { setTakeId(''); setUnsaved(null); await refreshTakes() }).catch(err => setError(errorMessage(err))) }}><Trash2 size={16}/> Usuń tę próbę</button></div>
        <p className="muted">Wyrównanie jest przybliżone: ręcznie skoryguj start, jeżeli sprzęt dodał opóźnienie. To odsłuch porównawczy, nie automatyczna ocena całego wykonania.</p>
      </>}
    </section>
    <div className="coach-grid"><section className="panel"><h3><Wind size={18}/> Łagodna rozgrzewka · 2 minuty</h3><p className="muted">Ogólne ćwiczenia, nie odczyt prywatnych notatek „Emisja głosu”. Śpiewaj tylko komfortowo; przerwij przy bólu, zawrotach głowy lub zmęczeniu.</p><div className="action-row"><button className="secondary" onClick={() => { if (warmup >= 0) { setWarmup(-1); stopTones() } else { setWarmup(0); setWarmupSeconds(0) } }}><Wind size={16}/>{warmup >= 0 ? 'Zatrzymaj rozgrzewkę' : 'Rozpocznij rozgrzewkę'}</button></div>
      {warmup >= 0 && <div className="warmup-stage"><strong>{warmup + 1}/4 · {warmups[warmup].title}</strong><p>{warmups[warmup].text}</p><progress max={30} value={warmupSeconds}/><span>{30 - warmupSeconds} s</span></div>}
      <div className="action-row"><button className="secondary" onClick={() => void playTones([0, 2, 4, 2, 0].map((interval, i) => ({ midi: fixedMidi + interval, duration: 0.8, offset: i * 0.9 })))}><Music2 size={16}/> Skala 1–2–3–2–1</button><button className="text-button" onClick={stopTones}>Wycisz wzorzec</button></div>
    </section><section className="panel"><h3><Ear size={18}/> Słuch i utrzymanie dźwięku</h3><p className="muted">{guide ? 'Interwały wybrane z Twojej partii.' : 'Podstawowe interwały na wybranym dźwięku.'} Posłuchaj dwóch nut i nazwij odległość.</p><button className="secondary" onClick={newQuiz}><Ear size={16}/> Nowe pytanie</button>{quiz && <><button className="text-button" onClick={() => void playTones([{ midi: quiz.first, duration: 0.8, offset: 0 }, { midi: quiz.second, duration: 0.8, offset: 1 }])}>Posłuchaj ponownie</button><div className="interval-options">{intervals.map((name, i) => <button key={name} className={answer === i ? 'active' : ''} disabled={answer !== null} onClick={() => setAnswer(i)}>{name}</button>)}</div>{answer !== null && <p className="notice">{answer === quiz.interval ? 'Tak!' : 'Spróbuj usłyszeć tę odległość jeszcze raz.'} {intervals[quiz.interval]} · {pitchName(quiz.first)} → {pitchName(quiz.second)}</p>}</>}
      <hr/><p className="muted">Utrzymaj pierwszy dźwięk, gdy pojawi się kwinta. Obserwuj tuner i śpiewaj cicho w słuchawkach.</p><button className="secondary" onClick={() => void playTones([{ midi: fixedMidi, duration: 4, offset: 0 }, { midi: fixedMidi + 7, duration: 2.5, offset: 1.5 }])}>Dźwięk + kwinta</button></section></div>
    <section className="panel"><h3><Brain size={18}/> Śpiewaj z pamięci</h3>{guide ? <><div className="action-row segmented">{(['full', 'initials', 'hidden'] as const).map(mode => <button key={mode} className={memoryMode === mode ? 'active' : ''} onClick={() => setMemoryMode(mode)}>{mode === 'full' ? 'Cały tekst' : mode === 'initials' ? 'Pierwsze litery' : 'Ukryj tekst'}</button>)}</div><label className="checkbox"><input type="checkbox" checked={notesHidden} onChange={e => setNotesHidden(e.target.checked)}/> Ukryj nazwy nut</label><div className="memory-notes">{guide.analysis.notes.slice(0, 1000).map((note, i) => <div key={i}><small>Takt {note.bar}</small><strong>{notesHidden ? '♪' : note.pitch}</strong><span>{maskedLyric(note.lyric || '—', memoryMode)}</span></div>)}</div>{!guide.analysis.lyrics.length && <p className="notice">Brak tekstu w źródłowym MusicXML. Ukrywanie tekstu nie odtwarza brakujących sylab.</p>}</> : <p className="muted">Wygeneruj przewodnik z MusicXML w Analizie, aby ćwiczyć tekst i nuty swojej linii.</p>}</section>
  </div>

  function eLoop() {
    const audio = reference.current
    if (!audio) return
    audio.currentTime = current.current.start
    void audio.play().catch(err => { setDrill(false); setPlaying(false); setError(errorMessage(err)) })
  }
}
