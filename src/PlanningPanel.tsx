import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, Bell, BellRing, CalendarCheck, CalendarDays, Check, CheckCheck, Clock3, FileSearch, Flame, Headphones, ListMusic, Pause, Play, Plus, RotateCcw, Save, SkipBack, SkipForward, Square, Timer, Trash2, X } from 'lucide-react'
import { api, errorMessage, post, timeLabel } from './api'
import { getSession, userStorage as localStorage } from './session'
import type { Library, Part, Song } from './types'
import { PART_LABELS } from './types'
import './planning.css'
import { preferredAudio, missingMaterials, minutes } from './practice'
export { preferredAudio, missingMaterials, minutes } from './practice'

export type ReadinessStatus = 'listened' | 'with-score' | 'memory' | 'concert'
export const STATUSES: ReadinessStatus[] = ['listened', 'with-score', 'memory', 'concert']
export const STATUS_LABELS: Record<ReadinessStatus, string> = {
  listened: 'Wysłuchane', 'with-score': 'Śpiewam z nut', memory: 'Śpiewam z pamięci', concert: 'Gotowe na koncert'
}
export interface StatusRow { song_id: string; status: ReadinessStatus; updated_at: string }
export interface PracticeSummary {
  today_seconds: number; streak_days: number; total_seconds: number
  last_days: { day: string; seconds: number }[]; by_song: Record<string, number>
  recent: { id: number; song_id: string; part: string; seconds: number; day: string; created_at: string }[]
}
export interface EventDate { event_id: string; date: string; source: 'manual' | 'calendar' | 'folder'; excerpt: string | null; confirmed_at: string; days_until: number }
export interface Upcoming { event_id: string; name: string; date: string; days_until: number; song_count: number; not_ready: string[] }
export interface Setlist { event_id: string; song_ids: string[]; custom: boolean; order_note: string | null; updated_at: string | null; unlisted_song_ids: string[] }
export interface DriveChange {
  id: number; file_id: string; name: string; change: 'new' | 'modified'; song_id: string | null; event_id: string | null
  kind: string | null; part: string | null; slow: boolean; detected_at: string; song_name: string | null; event_name: string | null
}
export interface DateCandidate {
  id: string; source: 'pdf' | 'folder'; page: number | null; date: string; end_date: string | null; year_inferred: boolean
  match: string; excerpt: string; event_id: string | null; match_reason: string
}
export interface CalendarResult { file_id: string; name: string; extracted_at: string; pages: number; candidates: DateCandidate[]; downloaded?: boolean }
export interface PlanningState {
  part: Part; today: string; statuses: StatusRow[]; sessions: PracticeSummary; dates: EventDate[]
  upcoming: Upcoming[]; setlists: Setlist[]; changes: DriveChange[]; calendar: CalendarResult | null
}

const MAX_SESSION = 4 * 3600

export function usePlanningState(part: Part) {
  const [state, setState] = useState<PlanningState | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const reload = useCallback(async () => {
    try { setState(await api<PlanningState>(`/api/planning/state?part=${part}`)); setError('') }
    catch (err) { setError(`Nie można wczytać planu: ${errorMessage(err)}`) }
    finally { setLoading(false) }
  }, [part])
  useEffect(() => { setLoading(true); void reload() }, [reload])
  return { state, error, loading, reload, setError }
}

function dayLabel(days: number) {
  return days === 0 ? 'dziś' : days === 1 ? 'jutro' : `za ${days} dni`
}
function dateLabel(iso: string, end?: string | null) {
  const format = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('pl', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
  return end ? `${format(iso)} – ${format(end)}` : format(iso)
}

function timerKey(songId: string, part: Part) { return `janko.timer.${songId}.${part}` }
function readTimer(key: string): number | null {
  try { const value = Number(localStorage.getItem(key)); return Number.isFinite(value) && value > 0 ? value : null }
  catch { return null }
}

export function SongProgress({ songId, part }: { songId: string; part: Part }) {
  const { state, error, reload, setError } = usePlanningState(part)
  const key = timerKey(songId, part)
  const [started, setStarted] = useState<number | null>(() => readTimer(key))
  const [tick, setTick] = useState(Date.now())
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const status = state?.statuses.find(s => s.song_id === songId)?.status ?? null

  useEffect(() => { setStarted(readTimer(key)) }, [key])
  useEffect(() => {
    if (!started) return
    const id = window.setInterval(() => setTick(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [started])

  async function setStatus(value: ReadinessStatus) {
    setSaving(true); setNotice('')
    try { await post('/api/planning/progress', { song_id: songId, part, status: value === status ? 'none' : value }); await reload() }
    catch (err) { setError(`Nie zapisano postępu: ${errorMessage(err)}`) }
    finally { setSaving(false) }
  }
  function start() {
    const now = Date.now()
    try { localStorage.setItem(key, String(now)) }
    catch { setError('Przeglądarka nie pozwala zapamiętać stopera. Nie zamykaj tej strony podczas ćwiczenia.') }
    setStarted(now); setTick(now); setNotice('')
  }
  function discard() {
    try { localStorage.removeItem(key) } catch { /* nothing stored */ }
    setStarted(null); setNotice('Stoper wyzerowany — czas nie został zapisany.')
  }
  async function stop() {
    if (!started) return
    let seconds = Math.round((Date.now() - started) / 1000)
    if (seconds < 1) { discard(); return }
    const capped = seconds > MAX_SESSION
    if (capped) seconds = MAX_SESSION
    setSaving(true)
    try {
      await post('/api/planning/session', { song_id: songId, part, seconds })
      try { localStorage.removeItem(key) } catch { /* already saved on server */ }
      setStarted(null)
      setNotice(`Zapisano ${minutes(seconds)} ćwiczenia.${capped ? ' Sesję przycięto do 4 godzin — sprawdź, czy stoper nie został włączony przez pomyłkę.' : ''}`)
      await reload()
    } catch (err) { setError(`Nie zapisano czasu (stoper nadal działa, spróbuj ponownie): ${errorMessage(err)}`) }
    finally { setSaving(false) }
  }

  const elapsed = started ? Math.max(0, Math.round((tick - started) / 1000)) : 0
  const total = state?.sessions.by_song[songId] ?? 0
  return <section className="panel planning-song-progress" aria-label="Postęp utworu" data-testid="song-progress">
    <div className="planning-progress-head">
      <div><span className="eyebrow">MÓJ POSTĘP · {PART_LABELS[part].toUpperCase()}</span>
        <p className="planning-sub">{total ? `Łącznie ćwiczone: ${minutes(total)}` : 'Jeszcze bez zapisanego ćwiczenia.'}{state ? ` · Dziś: ${minutes(state.sessions.today_seconds)}` : ''}</p></div>
      <div className="planning-timer">
        <span className={`planning-clock ${started ? 'running' : ''}`}><Timer size={15}/> {timeLabel(elapsed)}</span>
        {started ? <>
          <button className="primary" disabled={saving} onClick={() => void stop()}><Square size={14}/> Zakończ i zapisz</button>
          <button className="icon-button" aria-label="Odrzuć pomiar" title="Odrzuć pomiar" disabled={saving} onClick={discard}><X size={15}/></button>
        </> : <button className="secondary" onClick={start}><Play size={14}/> Zacznij ćwiczenie</button>}
      </div>
    </div>
    <div className="planning-status-picker" role="group" aria-label="Poziom przygotowania" data-testid="song-progress-status">
      {STATUSES.map((value, index) => <button key={value} disabled={saving || !state}
        className={`${status === value ? 'active' : ''} ${status && STATUSES.indexOf(status) >= index ? 'reached' : ''}`}
        aria-pressed={status === value} onClick={() => void setStatus(value)}><span>{index + 1}</span>{STATUS_LABELS[value]}</button>)}
    </div>
    {started && <p className="planning-sub">Stoper działa także po zmianie zakładki — czas zapisze się dopiero po kliknięciu „Zakończ i zapisz”.</p>}
    {notice && <p className="planning-ok" role="status"><Check size={14}/> {notice}</p>}
    {error && <p className="planning-error" role="alert"><AlertTriangle size={14}/> {error}</p>}
  </section>
}

function SetlistPlayer({ songs, part, onOpenSong }: { songs: Song[]; part: Part; onOpenSong: (id: string) => void }) {
  const queue = useMemo(() => songs.map(song => ({ song, file: preferredAudio(song, part) })), [songs, part])
  const playable = queue.filter(item => item.file)
  const signature = playable.map(item => item.file!.id).join('|')
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState('')
  const audio = useRef<HTMLAudioElement>(null)
  const wantPlay = useRef(false)
  const current = playable[Math.min(index, Math.max(0, playable.length - 1))]

  useEffect(() => { wantPlay.current = false; audio.current?.pause(); setPlaying(false); setIndex(0) }, [signature])
  useEffect(() => () => { audio.current?.pause() }, [])
  useEffect(() => {
    const element = audio.current
    setTime(0); setDuration(0)
    if (!element || !current?.file || !wantPlay.current) return
    element.play().then(() => setPlaying(true)).catch(err => {
      wantPlay.current = false; setPlaying(false); setError(`Nie można odtworzyć „${current.file!.name}”: ${errorMessage(err)}`)
    })
  }, [current?.file?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function go(offset: number) {
    setError('')
    setIndex(value => Math.max(0, Math.min(playable.length - 1, value + offset)))
  }
  async function toggle() {
    const element = audio.current
    if (!element) return
    if (playing) { wantPlay.current = false; element.pause(); setPlaying(false); return }
    setError(''); wantPlay.current = true
    try { await element.play(); setPlaying(true) }
    catch (err) { wantPlay.current = false; setPlaying(false); setError(`Nie można odtworzyć „${current?.file?.name}”: ${errorMessage(err)}`) }
  }
  function ended() {
    if (index < playable.length - 1) setIndex(index + 1)
    else { wantPlay.current = false; setPlaying(false); setIndex(0) }
  }

  const skipped = queue.filter(item => !item.file)
  if (!current) return <div className="planning-player empty-player"><Headphones size={18}/> Żaden utwór z programu nie ma nagrania dla głosu {PART_LABELS[part]}.</div>
  return <div className="planning-player" data-testid="planning-player">
    <audio ref={audio} src={current.file!.url} preload="metadata" onEnded={ended}
      onTimeUpdate={e => setTime(e.currentTarget.currentTime)} onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
      onError={() => { wantPlay.current = false; setPlaying(false); setError(`Nie można wczytać „${current.file!.name}”. Sprawdź połączenie lub zapisz utwór offline, potem przejdź dalej.`) }}/>
    <div className="planning-player-controls">
      <button className="icon-button" aria-label="Poprzedni utwór" disabled={index === 0} onClick={() => go(-1)}><SkipBack size={18}/></button>
      <button className="planning-play" aria-label={playing ? 'Pauza' : 'Odtwarzaj program'} onClick={() => void toggle()}>{playing ? <Pause size={20}/> : <Play size={20}/>}</button>
      <button className="icon-button" aria-label="Następny utwór" disabled={index >= playable.length - 1} onClick={() => go(1)}><SkipForward size={18}/></button>
    </div>
    <div className="planning-player-info">
      <span className="eyebrow">PROGRAM · {index + 1} / {playable.length}</span>
      <button className="planning-link" onClick={() => onOpenSong(current.song.id)}>{current.song.name}</button>
      <small>{current.file!.name}{current.file!.slow ? ' · wolniej' : ''} · {timeLabel(time)} / {timeLabel(duration)}</small>
      <div className="planning-bar"><i style={{ width: `${duration ? Math.min(100, time / duration * 100) : 0}%` }}/></div>
    </div>
    {skipped.length > 0 && <p className="planning-sub planning-skip">Pominięte (brak nagrania głosu): {skipped.map(item => item.song.name).join(', ')}</p>}
    {error && <p className="planning-error planning-skip" role="alert"><AlertTriangle size={14}/> {error}</p>}
  </div>
}
export default function PlanningPanel({ library, part, onOpenSong, onProgram, onOrder }: {
  library: Library; part: Part; onOpenSong: (id: string) => void
  onProgram?: (event: string, ids: string[]) => void; onOrder?: (event: string, ids: string[]) => void
}) {
  const { state, error, loading, reload, setError } = usePlanningState(part)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [eventId, setEventId] = useState('')
  const [draft, setDraft] = useState<string[] | null>(null)
  const [dateDrafts, setDateDrafts] = useState<Record<string, string>>({})
  const [assign, setAssign] = useState<Record<string, string>>({})
  const [addSong, setAddSong] = useState('')
  const [showPast, setShowPast] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() => 'Notification' in window ? Notification.permission : 'unsupported')

  const songs = useMemo(() => new Map(library.songs.map(song => [song.id, song])), [library.songs])
  const events = useMemo(() => new Map(library.events.map(event => [event.id, event.name])), [library.events])
  const statusOf = useMemo(() => new Map((state?.statuses ?? []).map(s => [s.song_id, s.status])), [state])
  const selectedEvent = eventId || state?.upcoming[0]?.event_id || library.events[0]?.id || ''
  const setlist = state?.setlists.find(s => s.event_id === selectedEvent)
  const order = draft ?? setlist?.song_ids ?? []
  const orderedSongs = useMemo(() => order.map(id => songs.get(id)).filter((song): song is Song => !!song), [order, songs])
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(setlist?.song_ids ?? [])
  useEffect(() => {
    if (state) state.setlists.forEach(list => onOrder?.(list.event_id, list.song_ids))
  }, [state])

  useEffect(() => { setDraft(null); setAddSong('') }, [selectedEvent])
  useEffect(() => {
    if (!state || permission !== 'granted' || !state.changes.length) return
    let seen = 0
    try { seen = Number(localStorage.getItem('janko.notified-change') ?? 0) || 0 } catch { /* storage unavailable */ }
    const fresh = state.changes.filter(c => c.id > seen)
    if (!fresh.length) return
    try {
      new Notification('Janko Muzykant — nowe materiały', { body: fresh.slice(0, 3).map(c => `${c.change === 'new' ? 'Nowy' : 'Zmieniony'}: ${c.name}`).join('\n') + (fresh.length > 3 ? `\n…i ${fresh.length - 3} więcej` : ''), tag: 'janko-changes' })
      localStorage.setItem('janko.notified-change', String(Math.max(...fresh.map(c => c.id))))
    } catch (err) { setError(`Nie można wyświetlić powiadomienia: ${errorMessage(err)}`) }
  }, [state, permission, setError])

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label); setError(''); setNotice('')
    try { await action() }
    catch (err) { setError(errorMessage(err)) }
    finally { setBusy('') }
  }
  const saveDate = (id: string, date: string | null, source: 'manual' | 'calendar' | 'folder' = 'manual', excerpt: string | null = null) =>
    run('Zapisywanie daty…', async () => {
      await post('/api/planning/date', { event_id: id, date, source, excerpt })
      setDateDrafts(value => { const next = { ...value }; delete next[id]; return next })
      await reload(); setNotice(date ? `Potwierdzono datę: ${events.get(id) ?? 'wydarzenie'} — ${dateLabel(date)}.` : 'Usunięto datę wydarzenia.')
    })
  const readCalendar = () => run('Odczyt kalendarza PDF (tylko odczyt)…', async () => {
    const result = await post<CalendarResult>('/api/planning/calendar', {})
    await reload()
    setNotice(`Odczytano ${result.pages} str. z „${result.name}”${result.downloaded ? ' (pobrano i zapisano lokalnie)' : ' (kopia lokalna)'}: ${result.candidates.length} możliwych dat. Żadna data nie została zapisana bez Twojego potwierdzenia.`)
  })
  const saveSetlist = (ids: string[] | null) => run('Zapisywanie programu…', async () => {
    await post('/api/planning/setlist', { event_id: selectedEvent, song_ids: ids })
    setDraft(null); await reload(); setNotice(ids ? 'Zapisano kolejność programu.' : 'Przywrócono kolejność alfabetyczną.')
  })
  const setStatus = (songId: string, status: string) => run('Zapisywanie postępu…', async () => {
    await post('/api/planning/progress', { song_id: songId, part, status: status || 'none' }); await reload()
  })
  const acknowledge = (ids: number[] | null) => run('Oznaczanie jako przeczytane…', async () => {
    await post('/api/planning/changes/ack', { ids }); await reload()
  })
  async function askPermission() {
    if (!('Notification' in window)) return
    try { setPermission(await Notification.requestPermission()) }
    catch (err) { setError(`Przeglądarka odrzuciła prośbę o powiadomienia: ${errorMessage(err)}`) }
  }
  function move(index: number, offset: number) {
    const next = [...order]; const target = index + offset
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]; setDraft(next)
  }

  if (loading && !state) return <div className="empty"><div className="spinner"/><p>Wczytywanie planu…</p></div>
  if (!state) return <div className="panel planning-panel"><p className="planning-error" role="alert"><AlertTriangle size={14}/> {error || 'Brak danych planu.'}</p><button className="secondary" onClick={() => void reload()}><RotateCcw size={15}/> Spróbuj ponownie</button></div>

  const ready = library.songs.filter(s => statusOf.get(s.id) === 'concert').length
  const dateOf = new Map(state.dates.map(d => [d.event_id, d]))
  const candidates = state.calendar?.candidates ?? []
  const isPast = (c: DateCandidate) => (c.end_date ?? c.date) < state.today
  const pastCount = candidates.filter(isPast).length
  const pdfCount = candidates.filter(c => c.source === 'pdf').length
  const visibleCandidates = candidates.filter(c => showPast || !isPast(c))
    .sort((a, b) => Number(!a.event_id) - Number(!b.event_id) || a.date.localeCompare(b.date) || Number(a.source !== 'pdf') - Number(b.source !== 'pdf'))
  const suggestedCount = visibleCandidates.filter(c => c.event_id).length
  const maxDay = Math.max(1, ...state.sessions.last_days.map(d => d.seconds))
  const addable = library.songs.filter(s => !order.includes(s.id))
  const missingReport = orderedSongs.map(song => ({ song, missing: missingMaterials(song, part) })).filter(item => item.missing.length)

  return <div className="planning-panel">
    <div className="planning-title"><div><span className="eyebrow">PLAN · {PART_LABELS[part].toUpperCase()}</span><h1>Plan i postępy</h1><p className="planning-sub">Daty, program koncertów i Twoje przygotowanie. Wszystko zapisywane lokalnie, Google Drive tylko do odczytu.</p></div></div>
    {error && <div className="error banner" role="alert">{error}<button aria-label="Zamknij błąd" onClick={() => setError('')}><X size={16}/></button></div>}
    {notice && <div className="notice banner" role="status">{notice}<button aria-label="Zamknij komunikat" onClick={() => setNotice('')}><X size={16}/></button></div>}
    {busy && <div className="notice banner"><span className="spinner small"/>{busy}</div>}

    <div className="planning-stats">
      <div><span className="stat-icon"><Flame size={19}/></span><strong>{state.sessions.streak_days}</strong><span>{state.sessions.streak_days === 1 ? 'dzień' : 'dni'} z rzędu</span></div>
      <div><span className="stat-icon"><Clock3 size={19}/></span><strong>{minutes(state.sessions.today_seconds)}</strong><span>ćwiczenia dziś</span></div>
      <div><span className="stat-icon"><CheckCheck size={19}/></span><strong>{ready}/{library.songs.length}</strong><span>gotowych na koncert</span></div>
      <div><span className="stat-icon"><Bell size={19}/></span><strong>{state.changes.length}</strong><span>nowości na Drive</span></div>
    </div>
    <div className="panel planning-week" aria-label="Ćwiczenie w ostatnich 14 dniach">
      {state.sessions.last_days.map(day => <div key={day.day} title={`${day.day}: ${minutes(day.seconds)}`}><i style={{ height: `${Math.max(4, day.seconds / maxDay * 100)}%` }} className={day.seconds ? 'done' : ''}/><small>{new Date(`${day.day}T12:00:00`).toLocaleDateString('pl', { weekday: 'narrow' })}</small></div>)}
      <p className="planning-sub">Łącznie: {minutes(state.sessions.total_seconds)}. Mierz czas stoperem na stronie utworu.</p>
    </div>

    <section className="panel planning-section">
      <h3><CalendarCheck size={18}/> Najbliższe wydarzenia</h3>
      {state.upcoming.length === 0 ? <p className="planning-sub">Brak potwierdzonych dat. Odczytaj kalendarz PDF lub wpisz datę przy wydarzeniu poniżej.</p> :
        <div className="planning-countdown">{state.upcoming.map(item => <button key={item.event_id} className={`planning-count-card ${item.event_id === selectedEvent ? 'active' : ''}`} onClick={() => setEventId(item.event_id)}>
          <strong>{dayLabel(item.days_until)}</strong><span>{item.name}</span><small>{dateLabel(item.date)}</small>
          <em className={item.not_ready.length ? 'warn' : 'ok'}>{item.song_count === 0 ? 'Program pusty' : item.not_ready.length ? `${item.not_ready.length} z ${item.song_count} utworów jeszcze niegotowe` : 'Cały program gotowy'}</em>
        </button>)}</div>}
    </section>

    <section className="panel planning-section">
      <div className="planning-section-head"><h3><CalendarDays size={18}/> Daty wydarzeń</h3>
        <button className="secondary" disabled={!!busy || getSession()?.admin === false} onClick={() => void readCalendar()}><FileSearch size={16}/> Odczytaj kalendarz PDF</button></div>
      <p className="planning-sub">{getSession()?.hosted ? 'Kalendarz i potwierdzone daty są wspólne. Odczyt i potwierdzanie wykonuje administrator; Drive pozostaje tylko do odczytu.' : 'Daty są zapisywane wyłącznie po Twoim potwierdzeniu. Kalendarz jest pobierany z Drive tylko do odczytu i przechowywany lokalnie.'}</p>
      {library.events.length === 0 && <p className="planning-sub">Wydarzenia pojawią się po synchronizacji biblioteki.</p>}
      <div className="planning-dates">{library.events.map(event => {
        const saved = dateOf.get(event.id); const value = dateDrafts[event.id] ?? saved?.date ?? ''
        return <div className="planning-date-row" key={event.id}>
          <div><strong>{event.name}</strong>{saved ? <small>{dateLabel(saved.date)} · {saved.source === 'manual' ? 'wpisane ręcznie' : saved.source === 'calendar' ? 'potwierdzone z kalendarza PDF' : 'potwierdzone z nazwy folderu'}{saved.excerpt ? ` · „${saved.excerpt}”` : ''}</small> : <small className="warn">Data niepotwierdzona</small>}</div>
          <input type="date" aria-label={`Data: ${event.name}`} disabled={getSession()?.admin === false} value={value} onChange={e => setDateDrafts(d => ({ ...d, [event.id]: e.target.value }))}/>
          <button className="icon-button" aria-label="Zapisz datę" title="Zapisz datę" disabled={!!busy || !value || value === saved?.date || getSession()?.admin === false} onClick={() => void saveDate(event.id, value)}><Save size={16}/></button>
          <button className="icon-button" aria-label="Usuń datę" title="Usuń datę" disabled={!!busy || !saved || getSession()?.admin === false} onClick={() => void saveDate(event.id, null)}><Trash2 size={16}/></button>
        </div>
      })}</div>
      {state.calendar && <details className="planning-candidates" data-testid="planning-candidates">
        <summary data-testid="planning-candidates-summary">Możliwe daty z kalendarza: {candidates.length} (PDF: {pdfCount}, nazwy folderów: {candidates.length - pdfCount}) · „{state.calendar.name}” · odczyt {new Date(state.calendar.extracted_at).toLocaleString('pl')}</summary>
        {candidates.length > 0 && <div className="planning-candidate-filter">
          <label><input type="checkbox" data-testid="planning-candidates-show-past" checked={showPast} onChange={e => setShowPast(e.target.checked)}/> Pokaż także daty minione ({pastCount})</label>
          <span>Pokazano {visibleCandidates.length} z {candidates.length}{suggestedCount ? ` · najpierw ${suggestedCount} z sugerowanym wydarzeniem` : ''}. Nic nie jest zapisywane bez „Potwierdź datę”.</span>
        </div>}
        {candidates.length === 0 && <p className="planning-sub">Nie znaleziono dat w tekście PDF. Wpisz je ręcznie.</p>}
        {candidates.length > 0 && visibleCandidates.length === 0 && <p className="planning-sub">Brak nadchodzących dat. Zaznacz „Pokaż także daty minione”, aby zobaczyć wszystkie.</p>}
        {visibleCandidates.map(candidate => {
          const target = assign[candidate.id] ?? candidate.event_id ?? ''
          const confirmed = target && dateOf.get(target)?.date === candidate.date
          return <div className={`planning-candidate ${isPast(candidate) ? 'past' : ''}`} key={candidate.id} data-testid="planning-candidate" data-date={candidate.date} data-event-id={candidate.event_id ?? ''}>
            <div className="planning-candidate-date"><strong>{dateLabel(candidate.date, candidate.end_date)}</strong>
              <small>{candidate.source === 'pdf' ? `PDF, str. ${candidate.page}` : 'nazwa folderu'}{candidate.year_inferred ? ' · rok przyjęty z sezonu — sprawdź' : ''}{isPast(candidate) ? ' · data minęła' : ''}</small></div>
            <blockquote>„{candidate.excerpt}”</blockquote>
            <div className="planning-candidate-actions">
              <select aria-label="Przypisz do wydarzenia" data-testid="planning-candidate-event" value={target} onChange={e => setAssign(a => ({ ...a, [candidate.id]: e.target.value }))}>
                <option value="">— wybierz wydarzenie —</option>{library.events.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
              {candidate.match_reason && target === candidate.event_id && <small>Sugestia: {candidate.match_reason}</small>}
              <button data-testid="planning-candidate-confirm" className={confirmed ? 'secondary' : 'primary'} disabled={!!busy || !target || !!confirmed || getSession()?.admin === false} onClick={() => void saveDate(target, candidate.date, candidate.source === 'pdf' ? 'calendar' : 'folder', candidate.excerpt)}>{confirmed ? <><Check size={14}/> Potwierdzona</> : 'Potwierdź datę'}</button>
            </div>
          </div>
        })}
      </details>}
    </section>

    <section className="panel planning-section">
      <div className="planning-section-head"><h3><ListMusic size={18}/> Program koncertu</h3>
        <select aria-label="Wydarzenie programu" data-testid="planning-program-select" value={selectedEvent} onChange={e => setEventId(e.target.value)}>{library.events.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
      {!setlist ? <p className="planning-sub">Wybierz wydarzenie.</p> : <>
        {!setlist.custom && !dirty && <p className="planning-hint"><AlertTriangle size={14}/> {setlist.order_note}</p>}
        {setlist.custom && setlist.unlisted_song_ids.length > 0 && <p className="planning-hint">Nowe utwory w folderze wydarzenia, nieuwzględnione w programie: {setlist.unlisted_song_ids.map(id => songs.get(id)?.name).filter(Boolean).join(', ')}</p>}
        {onProgram ? <section className="planning-setlist-player"><p>Odtwarzanie pozostaje aktywne po zmianie strony. Strzałki stałego odtwarzacza wybierają utwory programu. Brak Twojej partii zatrzymuje kolejkę; pętla zatrzymuje automatyczne przejście.</p><button className="primary" disabled={!order.length} onClick={() => onProgram(selectedEvent, order)}>Odtwarzaj program</button></section> : <SetlistPlayer key={selectedEvent} songs={orderedSongs} part={part} onOpenSong={onOpenSong}/>}
        <ol className="planning-setlist" data-testid="planning-program">{orderedSongs.map((song, index) => {
          const missing = missingMaterials(song, part).filter(m => !m.startsWith('wolniejsza') && !m.startsWith('nagranie całego'))
          return <li key={song.id} data-testid="planning-program-row" data-song-id={song.id}>
            <span className="planning-num">{String(index + 1).padStart(2, '0')}</span>
            <div className="planning-song"><button className="planning-link" onClick={() => onOpenSong(song.id)}>{song.name}</button>
              <small>{state.sessions.by_song[song.id] ? `ćwiczone ${minutes(state.sessions.by_song[song.id])}` : 'jeszcze nie ćwiczone'}{missing.map(m => <span key={m} className="planning-missing">brak: {m}</span>)}</small></div>
            <select aria-label={`Postęp: ${song.name}`} className={`planning-status s-${statusOf.get(song.id) ?? 'none'}`} value={statusOf.get(song.id) ?? ''} disabled={!!busy} onChange={e => void setStatus(song.id, e.target.value)}>
              <option value="">Nie zaczęte</option>{STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select>
            <div className="planning-row-actions">
              <button className="icon-button" aria-label="W górę" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={15}/></button>
              <button className="icon-button" aria-label="W dół" disabled={index === orderedSongs.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15}/></button>
              <button className="icon-button" aria-label="Usuń z programu" onClick={() => setDraft(order.filter(id => id !== song.id))}><X size={15}/></button>
            </div>
          </li>
        })}</ol>
        {orderedSongs.length === 0 && <p className="planning-sub">Program jest pusty.</p>}
        <div className="planning-setlist-actions">
          <select aria-label="Dodaj utwór do programu" value={addSong} onChange={e => setAddSong(e.target.value)}><option value="">Dodaj utwór…</option>{addable.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <button className="secondary" disabled={!addSong} onClick={() => { setDraft([...order, addSong]); setAddSong('') }}><Plus size={15}/> Dodaj</button>
          <span/>
          {setlist.custom && <button className="secondary" disabled={!!busy} onClick={() => void saveSetlist(null)}><RotateCcw size={15}/> Kolejność alfabetyczna</button>}
          {dirty && <button className="secondary" onClick={() => setDraft(null)}>Anuluj zmiany</button>}
          <button className="primary" data-testid="planning-program-save" disabled={!!busy || !dirty} onClick={() => void saveSetlist(order)}><Save size={15}/> Zapisz kolejność</button>
        </div>
      </>}
    </section>

    <section className="panel planning-section">
      <h3><AlertTriangle size={18}/> Brakujące materiały · {events.get(selectedEvent) ?? 'program'}</h3>
      {missingReport.length === 0 ? <p className="planning-sub">{orderedSongs.length ? 'Każdy utwór programu ma komplet materiałów dla Twojego głosu.' : 'Brak utworów w programie.'}</p> :
        <ul className="planning-report">{missingReport.map(({ song, missing }) => <li key={song.id}><button className="planning-link" onClick={() => onOpenSong(song.id)}>{song.name}</button><span>{missing.join(' · ')}</span></li>)}</ul>}
    </section>

    <section className="panel planning-section">
      <div className="planning-section-head"><h3><BellRing size={18}/> Nowości na Google Drive</h3>
        <div className="planning-inline">
          {permission === 'default' && <button className="secondary" onClick={() => void askPermission()}><Bell size={15}/> Włącz powiadomienia przeglądarki</button>}
          {permission === 'granted' && <span className="small-tag">Powiadomienia włączone</span>}
          {permission === 'denied' && <span className="small-tag">Powiadomienia zablokowane w przeglądarce</span>}
          {state.changes.length > 0 && <button className="secondary" disabled={!!busy} onClick={() => void acknowledge(null)}><CheckCheck size={15}/> Oznacz wszystkie</button>}
        </div></div>
      <p className="planning-sub">Zmiany wykrywane przy synchronizacji (porównanie z poprzednim odczytem). Powiadomienia pokazują się tylko, gdy aplikacja jest otwarta.</p>
      {state.changes.length === 0 ? <p className="planning-sub">Brak nowych lub zmienionych plików od ostatniego przeglądu.</p> :
        <ul className="planning-changes" data-testid="planning-changes">{state.changes.map(change => <li key={change.id} data-testid="planning-change-row">
          <span className={`planning-change-tag ${change.change}`}>{change.change === 'new' ? 'Nowy' : 'Zmieniony'}</span>
          <div><strong>{change.name}</strong><small>{[change.song_name, change.event_name, change.slow ? 'wolniejsza wersja' : null, new Date(change.detected_at).toLocaleString('pl')].filter(Boolean).join(' · ')}</small></div>
          {change.song_id && songs.has(change.song_id) && <button className="text-button" onClick={() => onOpenSong(change.song_id!)}>Otwórz</button>}
          <button className="icon-button" aria-label="Oznacz jako przeczytane" disabled={!!busy} onClick={() => void acknowledge([change.id])}><Check size={15}/></button>
        </li>)}</ul>}
    </section>
  </div>
}