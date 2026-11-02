import { lazy, Suspense, useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, CalendarDays, Check, ChevronDown, CloudDownload, FileMusic, Headphones, Leaf, LibraryBig, ListMusic, LockKeyhole, Music2, Search, Settings2, ShieldCheck, Sparkles, Wifi, WifiOff, X } from 'lucide-react'
import { api, errorMessage, isMyPart, post } from './api'
import { getSession, userStorage as localStorage } from './session'
import type { Config, Library, Part, Song } from './types'
import { PART_LABELS, PARTS } from './types'
import QueuePlayer, { type PlaybackRequest } from './QueuePlayer'
import SongPlaybackControl from './SongPlaybackControl'
import Badges from './Badges'
import { eventPool } from './practice'
const ScoreViewer = lazy(() => import('./ScoreViewer'))
const AnalysisPanel = lazy(() => import('./AnalysisPanel'))
const CoachingPanel = lazy(() => import('./CoachingPanel'))
const PlanningPanel = lazy(() => import('./PlanningPanel'))
const SongProgress = lazy(() => import('./PlanningPanel').then(module => ({ default: module.SongProgress })))

declare global {
  interface Window {
    google?: { accounts: { oauth2: { initTokenClient: (options: {
      client_id: string; scope: string; callback: (response: { access_token?: string; error?: string; error_description?: string }) => void;
      error_callback: (error: { type?: string }) => void;
    }) => { requestAccessToken: () => void } } } }
  }
}

const emptyLibrary: Library = { events: [], songs: [], other: [], last_sync: null }
interface InstallPrompt extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

export default function App() {
  const hostedMode = getSession()?.hosted ?? false
  const admin = getSession()?.admin ?? true
  const [library, setLibrary] = useState<Library>(emptyLibrary)
  const [config, setConfig] = useState<Config | null>(null)
  const [part, setPart] = useState<Part>(() => {
    try { const saved = localStorage.getItem('janko.part'); return PARTS.includes(saved as Part) ? saved as Part : 'AI' }
    catch { return 'AI' }
  })
  const [eventId, setEventId] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('song'))
  const [tab, setTab] = useState<'practice' | 'analysis' | 'coaching'>('practice')
  const [planning, setPlanning] = useState(() => new URLSearchParams(window.location.search).get('view') === 'planning')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [settings, setSettings] = useState(false)
  const [voiceMenu, setVoiceMenu] = useState(false)
  const [progressExpanded, setProgressExpanded] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null)
  const [online, setOnline] = useState(navigator.onLine)
  const [loading, setLoading] = useState(true)
  const [playback, setPlayback] = useState<PlaybackRequest | null>(null)
  const [playingSongId, setPlayingSongId] = useState('')
  const [playbackPlaying, setPlaybackPlaying] = useState(false)
  const [programs, setPrograms] = useState<Record<string, string[]>>({})
  const selected = library.songs.find(s => s.id === selectedId)
  useEffect(() => {
    if (selected && !playback) setPlayback({ id: selected.id, play: false, revision: 1 })
  }, [selected?.id, playback])
  useEffect(() => {
    if (!library.songs.length) return
    let active = true
    void api<{ setlists: { event_id: string; song_ids: string[] }[] }>(`/api/planning/state?part=${part}`).then(result => {
      if (!active) return
      const orders = Object.fromEntries(result.setlists.map(list => [list.event_id, list.song_ids]))
      setPrograms(orders)
      try { localStorage.setItem('janko.player.programs', JSON.stringify(orders)) }
      catch { setNotice('Kolejność odczytana; nie można zapisać jej do pamięci offline.') }
    }).catch(err => {
      if (!active) return
      try {
        const stored = localStorage.getItem('janko.player.programs')
        if (stored) setPrograms(JSON.parse(stored) as Record<string, string[]>)
      } catch { setError('Nie można odczytać kolejności programu z pamięci.') }
      setNotice(`Nie odczytano bieżącej kolejności programu: ${errorMessage(err)}. Użyto zapisanej lub alfabetycznej.`)
    })
    return () => { active = false }
  }, [library.last_sync, library.songs.length, part])

  useEffect(() => {
    const install = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPrompt) }
    const installed = () => setInstallPrompt(null)
    window.addEventListener('beforeinstallprompt', install)
    window.addEventListener('appinstalled', installed)
    return () => { window.removeEventListener('beforeinstallprompt', install); window.removeEventListener('appinstalled', installed) }
  }, [])
  useEffect(() => {
    if (!settings && !voiceMenu) return
    const previous = document.activeElement
    const node = document.querySelector<HTMLElement>('[role="dialog"]')
    const focusable = () => [...(node?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], select, input') ?? [])]
    focusable()[0]?.focus()
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') { setSettings(false); setVoiceMenu(false) }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus() }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); if (previous instanceof HTMLElement) previous.focus() }
  }, [settings, voiceMenu])

  async function refresh() {
    const [lib, cfg] = await Promise.all([api<Library>('/api/library'), api<Config>('/api/config')])
    setLibrary(lib); setConfig(cfg)
  }
  useEffect(() => {
    void refresh().catch(err => setError(`Nie można wczytać biblioteki: ${errorMessage(err)} Uruchom Start.ps1.`)).finally(() => setLoading(false))
    const onOnline = () => setOnline(navigator.onLine)
    window.addEventListener('online', onOnline); window.addEventListener('offline', onOnline)
    const pop = () => { const params = new URLSearchParams(window.location.search); setSelectedId(params.get('song')); setPlanning(params.get('view') === 'planning') }
    window.addEventListener('popstate', pop)
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOnline); window.removeEventListener('popstate', pop) }
  }, [])

  function openSong(id: string | null) {
    if (id && !playback) setPlayback({ id, play: false, revision: Date.now() })
    setSelectedId(id); setPlanning(false); setTab('practice'); setError(''); setNotice('')
    window.history.pushState({}, '', id ? `/?song=${id}` : '/'); window.scrollTo(0, 0)
  }
  function openPlanning() {
    setSelectedId(null); setPlanning(true); window.history.pushState({}, '', '/?view=planning'); window.scrollTo(0, 0)
  }
  function choosePart(value: Part) {
    setPart(value)
    try { localStorage.setItem('janko.part', value) }
    catch { setError('Nie można zapamiętać głosu w tej przeglądarce.') }
  }
  async function sync(eventOnly = false) {
    setBusy('Synchronizacja tylko do odczytu…'); setError(''); setNotice('')
    try {
      const result = await post<{ events: number; songs: number; files: number; warnings: string[]; new_materials: number }>('/api/sync',
        { root_id: config?.root_id, event_id: eventOnly ? '1vK1jee6NUlVO3oIJoFzqzNSmR8BlPkLg' : null })
      setWarnings(result.warnings); await refresh()
      setNotice(`Odczytano ${result.songs} utworów i ${result.files} plików. Nie zmodyfikowano Google Drive.${result.new_materials ? ` Nowe lub zmienione materiały: ${result.new_materials}. Zobacz Plan i postępy.` : ''}`)
    } catch (err) { setError(errorMessage(err)) }
    finally { setBusy('') }
  }
  async function saveOffline(song: Song) {
    setBusy('Zapisywanie materiałów offline…'); setError(''); setNotice('')
    try {
      const result = await post<{ cached: number; failed: { name: string; error: string }[] }>(`/api/songs/${song.id}/cache`, {})
      if (getSession()?.hosted) {
        await refresh()
        setNotice(`Zapisano na serwerze ${result.cached} plików. Tryb chóru wymaga internetu i logowania; nie zapisuje materiałów w pamięci offline przeglądarki.`)
        setWarnings(result.failed.map(f => `${f.name}: ${f.error}`))
        return
      }
      const browserErrors: string[] = []
      if ('caches' in window) {
        const cache = await caches.open('janko-materials')
        for (const file of song.files) {
          if (result.failed.some(f => f.name === file.name)) continue
          try {
            const response = await fetch(file.url)
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            await cache.put(file.url, response)
          } catch (err) { browserErrors.push(`${file.name}: ${errorMessage(err)}`) }
        }
      } else browserErrors.push('Ta przeglądarka nie obsługuje pamięci PWA. Pliki zapisano na komputerze.')
      await refresh(); setNotice(`Zapisano lokalnie ${result.cached} plików. ${browserErrors.length ? 'Nie wszystkie zapisano w przeglądarce.' : 'Utwór jest gotowy do ćwiczeń bez internetu.'}`)
      setWarnings([...result.failed.map(f => `${f.name}: ${f.error}`), ...browserErrors])
    } catch (err) { setError(errorMessage(err)) }
    finally { setBusy('') }
  }
  async function googleLogin() {
    setError('')
    if (!config?.client_id) { setError('Ustaw GOOGLE_CLIENT_ID według README i uruchom aplikację ponownie. Publiczne foldery działają bez logowania.'); return }
    try {
      if (!window.google) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script')
          script.src = 'https://accounts.google.com/gsi/client'; script.async = true
          script.onload = () => resolve(); script.onerror = () => reject(new Error('Nie można załadować logowania Google. Sprawdź internet.'))
          document.head.append(script)
        })
      }
      const client = window.google!.accounts.oauth2.initTokenClient({
        client_id: config.client_id, scope: 'https://www.googleapis.com/auth/drive.readonly',
        callback: response => {
          if (!response.access_token) { setError(response.error_description ?? response.error ?? 'Google nie udostępnił sesji.'); return }
          void post('/api/auth', { token: response.access_token }).then(refresh).catch(err => setError(errorMessage(err)))
        },
        error_callback: err => setError(`Logowanie Google nie powiodło się: ${err.type ?? 'okno logowania zamknięte'}`)
      })
      client.requestAccessToken()
    } catch (err) { setError(errorMessage(err)) }
  }

  const filtered = library.songs.filter(song => (eventId === 'all' || song.event_ids.includes(eventId)) && song.name.toLocaleLowerCase('pl').includes(search.toLocaleLowerCase('pl')))
  const totalAudio = library.songs.filter(s => s.files.some(f => isMyPart(f.part, part))).length
  const pool = eventPool(library.songs, eventId, programs[eventId])
  function requestPlayback(id: string, play = true) { setPlayback(value => ({ id, play, revision: (value?.revision ?? 0) + 1 })) }
  return <div className={`app-shell${playback ? ' has-practice-player' : ''}`}>
    <aside className="sidebar"><button className="brand" onClick={() => openSong(null)}><span className="brand-icon"><Music2 size={25}/></span><span>Janko<span className="brand-sub">MUZYKANT</span></span></button>
      <div className="sidebar-caption">TWOJA PRACOWNIA CHÓRALNA</div>
      <button className={`nav-link ${!selected && !planning ? 'active' : ''}`} onClick={() => openSong(null)}><LibraryBig size={19}/> Biblioteka <span>{library.songs.length}</span></button>
      <button className={`nav-link ${planning ? 'active' : ''}`} onClick={openPlanning}><CalendarDays size={19}/> Plan i postępy</button>
      <div className="sidebar-section"><span className="eyebrow">WYDARZENIA</span>{library.events.map(event => <button key={event.id} className={`event-link ${eventId === event.id ? 'active' : ''}`} onClick={() => { setEventId(event.id); openSong(null) }}><CalendarDays size={16}/><span>{event.name}</span></button>)}
      {library.events.length === 0 && <p className="muted">Wydarzenia pojawią się po synchronizacji.</p>}</div>
      <div className="sidebar-bottom"><div className="profile-card"><span className="voice-dot">{part}</span><div><strong>{PART_LABELS[part]}</strong><small>Twój zapamiętany głos</small></div></div><button className="nav-link" onClick={() => setSettings(true)}><Settings2 size={18}/> Ustawienia i połączenie</button><p className="readonly"><ShieldCheck size={14}/> Google Drive · tylko odczyt</p></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><BookOpen size={16}/> <button onClick={() => openSong(null)}>Biblioteka</button>{selected && <><span>/</span><span>{selected.name}</span></>}{planning && <span>/ Plan i postępy</span>}</div><div className="topbar-right"><button className="text-button mobile-planning" onClick={openPlanning}>Plan</button><span className={`connection ${!online ? 'offline' : ''}`}>{online ? <Wifi size={14}/> : <WifiOff size={14}/>} {online ? hostedMode ? 'Pracownia chóru' : 'Pracownia lokalna' : hostedMode ? 'Brak internetu' : 'Tryb offline'}</span><label className="part-picker"><span>Mój głos</span><select aria-label="Mój głos" value={part} onChange={e => choosePart(e.target.value as Part)}>{PARTS.map(p => <option key={p} value={p}>{PART_LABELS[p]}</option>)}</select><ChevronDown size={13}/></label></div></header>
      <main>
        {error && <div className="error banner" role="alert">{error}<button aria-label="Zamknij błąd" onClick={() => setError('')}><X size={16}/></button></div>}
        {notice && <div className="notice banner" role="status">{notice}<button aria-label="Zamknij komunikat" onClick={() => setNotice('')}><X size={16}/></button></div>}
        {busy && <div className="notice banner"><span className="spinner small"/>{busy}</div>}
        {warnings.length > 0 && <details className="warnings"><summary>{warnings.length} uwag o dostępie / pamięci offline</summary>{warnings.map((w, i) => <p key={i}>{w}</p>)}</details>}
        {planning ? <Suspense fallback={<div className="empty"><div className="spinner"/></div>}><PlanningPanel library={library} part={part} onOpenSong={openSong} onProgram={(event, ids) => { setEventId(event); setPrograms(value => ({ ...value, [event]: ids })); if (ids[0]) requestPlayback(ids[0]) }} onOrder={(event, ids) => setPrograms(value => ({ ...value, [event]: ids }))}/></Suspense> : selected ? <>
          <button className="back-link" onClick={() => openSong(null)}><ArrowLeft size={15}/> Wróć do biblioteki</button>
          <div className="song-heading"><div><span className="eyebrow">TWOJA KOLEJNA DOBRA PRÓBA</span><h1>{selected.name}</h1><Badges song={selected} part={part}/><p className="muted">{selected.event_ids.map(id => library.events.find(e => e.id === id)?.name).filter(Boolean).join(' · ')}</p></div><div className="song-page-actions"><SongPlaybackControl songId={selected.id} songName={selected.name} activeSongId={playingSongId} playing={playbackPlaying} onStart={() => requestPlayback(selected.id)}/><button className="secondary" disabled={!!busy || !selected.files.length} onClick={() => void saveOffline(selected)}><CloudDownload size={17}/> {hostedMode ? 'Zapisz na serwerze' : 'Zapisz offline'}</button></div></div>
          <div className={`progress-disclosure${progressExpanded ? ' expanded' : ''}`}><button className="phone-progress-toggle secondary" aria-expanded={progressExpanded} aria-controls="song-progress-content" onClick={() => setProgressExpanded(value => !value)}>Postęp i czas ćwiczenia <ChevronDown size={16}/></button><div id="song-progress-content"><Suspense fallback={null}><SongProgress key={`${selected.id}-${part}`} songId={selected.id} part={part}/></Suspense></div></div>
          <div className="tabs"><button className={tab === 'practice' ? 'active' : ''} onClick={() => setTab('practice')}><Headphones size={17}/> Nuty i nagrania</button><button className={tab === 'analysis' ? 'active' : ''} onClick={() => setTab('analysis')}><Sparkles size={17}/> Analiza i generowanie</button><button className={tab === 'coaching' ? 'active' : ''} onClick={() => setTab('coaching')}><Music2 size={17}/> Coaching</button><span>{selected.files.length} dostępnych materiałów</span></div>
          <Suspense fallback={<div className="empty"><div className="spinner"/><p>Otwieranie pracowni…</p></div>}>{tab === 'practice' ? <><div className="practice-workspace"><ScoreViewer key={selected.id} files={selected.files}/><div id="player-details"/></div><section className="panel materials"><h3><ListMusic size={18}/> Wszystkie materiały</h3>{selected.files.map(file => <div className="material-row" key={file.id}><span>{file.kind === 'audio' ? <Headphones size={17}/> : <FileMusic size={17}/>}</span><a href={file.url} target="_blank" rel="noreferrer">{file.name}<small>{file.section}</small></a><span className="small-tag">{file.cached ? 'Lokalnie' : file.kind.toUpperCase()}</span>{file.drive_url && <a href={file.drive_url} target="_blank" rel="noreferrer" className="text-button">Drive ↗</a>}</div>)}</section></> :
            tab === 'analysis' ? <AnalysisPanel key={`${selected.id}-${part}`} song={selected} part={part} onRefresh={refresh}/> : <CoachingPanel key={`${selected.id}-${part}`} song={selected} part={part}/>}</Suspense>
        </> : <>
          <section className="hero"><div><div className="eyebrow"><span className="live-dot"/> TWOJE MIEJSCE W CHÓRZE</div><h1>Dobry śpiew zaczyna się<br/>od spokojnej próby.</h1><p>Wszystkie nuty i nagrania w jednym miejscu.<br/>Znajdź utwór, posłuchaj swojej partii i śpiewaj pewniej.</p><button className="hero-link" onClick={() => { document.getElementById('song-search')?.focus() }}>Znajdź utwór do ćwiczenia <ArrowRight size={16}/></button></div><div className="hero-art" aria-hidden="true"><div className="staff">{[0, 1, 2, 3, 4].map(i => <i key={i} style={{ top: `${30 + i * 15}%` }}/>)}</div><span className="art-note n1">♪</span><span className="art-note n2">♫</span><span className="art-note n3">♪</span><span className="art-caption">VOX APOSTOLI<br/><small>małe kroki · wspólne brzmienie</small></span></div></section>
          <div className="library-stats"><div><span className="stat-icon"><ListMusic size={20}/></span><strong>{library.songs.length}</strong><span>utworów w bibliotece</span></div><div><span className="stat-icon"><Headphones size={20}/></span><strong>{totalAudio}</strong><span>z nagraniem Twojego głosu</span></div><div><span className="stat-icon"><CalendarDays size={20}/></span><strong>{library.events.length}</strong><span>wydarzeń i repertuarów</span></div></div>
          <div className="library-title"><div><span className="eyebrow">REPERTUAR</span><h2>Co dziś zaśpiewasz?</h2></div><div className="action-row"><button className="secondary" onClick={openPlanning}><CalendarDays size={17}/> Plan i postępy</button><button className="secondary" disabled={!!busy || !admin} title={!admin ? 'Synchronizację wykonuje administrator chóru' : undefined} onClick={() => void sync()}><CloudDownload size={17}/> Synchronizuj Drive</button></div></div>
          <div className="filters"><label className="search"><Search size={18}/><input id="song-search" placeholder="Szukaj utworu…" value={search} onChange={e => setSearch(e.target.value)}/>{search && <button aria-label="Wyczyść wyszukiwanie" onClick={() => setSearch('')}><X size={15}/></button>}</label><select aria-label="Filtr wydarzeń" value={eventId} onChange={e => setEventId(e.target.value)}><option value="all">Wszystkie wydarzenia</option>{library.events.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
          <div className="result-line"><span>{filtered.length} utworów · {eventId === 'all' ? 'Cały repertuar' : library.events.find(e => e.id === eventId)?.name}</span><span>{library.last_sync ? `Odczyt: ${new Date(library.last_sync).toLocaleDateString('pl')}` : 'Dostęp wyłącznie do odczytu'}</span></div>
          {loading ? <div className="empty"><div className="spinner"/><p>Wczytywanie biblioteki…</p></div> : library.songs.length === 0 ? <div className="panel empty"><LibraryBig size={42}/><h2>Zacznij od swojego repertuaru.</h2><p>Połącz publiczny folder Google Drive. Pliki pozostaną nietknięte.</p><button className="primary" disabled={!!busy} onClick={() => void sync(true)}><CloudDownload size={18}/> Wczytaj koncert we Wrocławiu</button></div> : filtered.length === 0 ? <div className="empty"><Search size={32}/><h3>Nie znaleziono utworu</h3><p>Zmień nazwę lub filtr wydarzenia.</p></div> : <div className="song-grid">{filtered.map((song, index) => <button className="song-card" key={song.id} onClick={() => openSong(song.id)}><div className="card-top"><span className="song-number">{String(index + 1).padStart(2, '0')}</span><span className="card-note"><Music2 size={24}/></span><ArrowRight size={17}/></div><h3>{song.name}</h3><p>{song.event_ids.length > 1 ? `${song.event_ids.length} wydarzenia` : library.events.find(e => e.id === song.event_ids[0])?.name}</p><Badges song={song} part={part}/><div className="card-bottom"><span>{song.files.length} materiałów</span><span>{song.files.length ? 'Otwórz próbę' : 'Sprawdź dostęp'} <ArrowRight size={13}/></span></div></button>)}</div>}
          {library.other.length > 0 && <details className="panel root-materials"><summary>Materiały ogólne · {library.other.length}</summary>{library.other.map(file => <a key={file.id} href={file.url} target="_blank" rel="noreferrer">{file.name}</a>)}</details>}
        </>}
        <footer><span><Leaf size={14}/> Jedna partia. Jeden krok bliżej wspólnego brzmienia.</span><span><ShieldCheck size={14}/> Twoje materiały pozostają Twoje.</span></footer>
        <QueuePlayer songs={library.songs} pool={pool} part={part} request={playback} onCurrent={id => { setPlayingSongId(id); setPlaybackPlaying(false) }} onPlayingChange={(_id, playing) => setPlaybackPlaying(playing)} onOpenSong={openSong}
          detailId={selected && tab === 'practice' && !planning ? 'player-details' : null}
          detailSongId={selected && tab === 'practice' && !planning ? selected.id : null}/>
      </main>
    </div>
    <nav className="phone-nav" aria-label="Nawigacja telefonu">
      <button aria-current={!selected && !planning ? 'page' : undefined} onClick={() => openSong(null)}><LibraryBig size={21}/><span>Biblioteka</span></button>
      <button aria-current={planning ? 'page' : undefined} onClick={openPlanning}><CalendarDays size={21}/><span>Plan i postępy</span></button>
      <button aria-label="Wybierz mój głos" onClick={() => setVoiceMenu(true)}><Headphones size={21}/><span>Mój głos · {part}</span></button>
      <button onClick={() => setSettings(true)}><Settings2 size={21}/><span>Ustawienia</span></button>
    </nav>
    {voiceMenu && <div className="modal-backdrop" onClick={() => setVoiceMenu(false)}><section className="panel modal voice-menu" role="dialog" aria-modal="true" aria-labelledby="voice-title" onClick={e => e.stopPropagation()}><button className="modal-close icon-button" aria-label="Zamknij wybór głosu" onClick={() => setVoiceMenu(false)}><X/></button><h2 id="voice-title">Twój głos w chórze</h2><p>Zapamiętamy go dla wszystkich utworów na tym urządzeniu.</p>{PARTS.map(value => <button className={value === part ? 'primary' : 'secondary'} aria-pressed={value === part} key={value} onClick={() => { choosePart(value); setVoiceMenu(false) }}>{PART_LABELS[value]}{value === part && <Check size={18}/>}</button>)}</section></div>}
    {settings && <div className="modal-backdrop" onClick={() => setSettings(false)}><section className="panel modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={e => e.stopPropagation()}>
      <button className="modal-close icon-button" aria-label="Zamknij ustawienia" onClick={() => setSettings(false)}><X/></button>
      <span className="eyebrow"><LockKeyhole size={16}/> BEZPIECZNE POŁĄCZENIE</span><h2 id="settings-title">Google Drive tylko do odczytu.</h2>
      <p>Aplikacja nigdy nie tworzy, edytuje ani usuwa plików na Google Drive.</p>
      {hostedMode ? <>
        <p>Tryb chóru wymaga logowania Google. Tokeny dostępu pozostają wyłącznie na serwerze, w prywatnej bazie sesji. Twoje postępy i programy ćwiczeń są osobiste; biblioteka, pliki i potwierdzony kalendarz są wspólne.</p>
        <p>Synchronizacja Drive, import MusicXML i potwierdzanie dat należą do administratora. Nagrania mikrofonowe pozostają w tej przeglądarce, oddzielnie dla każdego konta.</p>
      </> : <>
        <p>Publiczne materiały działają bez konta. Puste foldery i skróty mogą wymagać konta chóru. Logowanie używa wyłącznie zakresu <code>drive.readonly</code>; token nie jest zapisywany na dysku.</p>
        <button className="primary" onClick={() => { if (config?.connected) void api('/api/auth', { method: 'DELETE' }).then(refresh).catch(err => setError(errorMessage(err))); else void googleLogin() }}>{config?.connected ? 'Rozłącz Google' : 'Zaloguj do Google — tylko odczyt'}</button>
        <p className="muted">{config?.client_id ? 'Klient Google skonfigurowany.' : 'Opcjonalne logowanie: ustaw GOOGLE_CLIENT_ID zgodnie z README.'}</p>
      </>}
      <hr/><h3>Zainstaluj na telefonie</h3>
      {installPrompt && <button className="secondary" onClick={() => { void installPrompt.prompt().then(() => installPrompt.userChoice).then(() => setInstallPrompt(null)).catch(err => setError(`Nie można rozpocząć instalacji: ${errorMessage(err)}`)) }}>Zainstaluj aplikację</button>}
      <p>Android (Chrome): menu ⋮ → Dodaj do ekranu głównego / Zainstaluj aplikację. iPhone (Safari): Udostępnij → Do ekranu początkowego → Otwieraj jako aplikację. Instalacja i mikrofon wymagają HTTPS (lub localhost na tym samym urządzeniu). Adres 127.0.0.1 z komputera nie otworzy aplikacji na telefonie — potrzebny jest dostępny dla telefonu adres serwera.</p>
      <h3>Ćwiczenie offline</h3>
      <p>{hostedMode ? 'Ze względu na ochronę dostępu tryb chóru wymaga internetu. „Zapisz na serwerze” przyspiesza kolejne otwarcia, ale nie zapisuje materiałów w pamięci offline przeglądarki. Skrót na ekranie głównym działa online.' : 'Na stronie utworu wybierz „Zapisz offline”. Materiały są zapisywane na komputerze i w pamięci przeglądarki. Instalacja PWA wymaga otwarcia aplikacji przynajmniej raz online. Nowa analiza wymaga uruchomionego serwera aplikacji.'}</p>
    </section></div>}
  </div>
}
