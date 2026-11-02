import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowLeft, ArrowRight, BookOpen, CalendarDays, Check, ChevronDown, CloudDownload, FileMusic, Headphones, LibraryBig, Music2, Search, Settings2, ShieldCheck, X } from 'lucide-react'
import ScorePlayback from '../src/ScorePlayback'
import { claimAudio, playAudio } from '../src/playbackClock'
import { useAudioPosition } from '../src/useAudioPosition'
import QueuePlayer, { type PlaybackRequest } from '../src/QueuePlayer'
import SongPlaybackControl from '../src/SongPlaybackControl'
import DistributionNotice, { DISTRIBUTION_VERSION } from '../src/DistributionNotice'
import ScoreViewer from '../src/ScoreViewer'
import CoachingPanel, { type CoachGuide } from '../src/CoachingPanel'
import Badges from '../src/Badges'
import { isMyPart } from '../src/api'
import { eventPool, missingMaterials, minutes, preferredAudio, practiceDay, practiceHistory, type PracticeEntry } from '../src/practice'
import PhoneProgress, { LABELS } from './PhoneProgress'
import PhoneCalendar from './PhoneCalendar'
import { PART_LABELS, PARTS, type Analysis, type Library, type Material, type Part, type Song } from '../src/types'
import { setSession } from '../src/session'
import { Drive, fileUrl, isStandaloneWeb, type Account } from './native'
import { material, syncLibrary, mergeLibraries, type PhoneLibrary } from './library'
import { analyzeXML, base64, decodeMusicXML, inspect, pitchName, suggestion, wavBytes } from './score'
import '../src/style.css'
import '../src/mobile.css'
import '../src/planning.css'
import './phone.css'

interface PhoneState {
  library: PhoneLibrary | null; part: Part; progress: Record<string, string>; dates: Record<string, string>
  programs: Record<string, string[]>; seen: string[]; news: { id: string; name: string }[]
  guides: Record<string, CoachGuide>; selections: Record<string, { staff: string; voice: string }>
  timers: Record<string, number | null>; practiceSeconds: Record<string, number>
  practiceLog: PracticeEntry[]
}
const fresh = (): PhoneState => ({ library: null, part: 'AI', progress: {}, dates: {}, programs: {}, seen: [], news: [], guides: {}, selections: {}, timers: {}, practiceSeconds: {}, practiceLog: [] })
const code = (error: unknown) => error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
const message = (error: unknown) => {
  const known: Record<string, string> = {
    AUTH_CONFIG_ERROR: 'Google zgłosił błąd konfiguracji OAuth. Sprawdź rejestrację Android: pakiet com.jankomuzykant.app oraz SHA-1 podpisu podane poniżej.',
    AUTH_INTERRUPTED: 'Google zamknął logowanie bez wyniku. Nie wiadomo, czy było to anulowanie, błąd konfiguracji czy problem telefonu. Jeśli nie zamknąłeś okna: sprawdź konfigurację Google poniżej i aktualizację Usług Google Play.',
    AUTH_RESULT_MISSING: 'Google nie zwrócił wyniku logowania. Sprawdź konfigurację OAuth i Usługi Google Play.',
    AUTH_PERMISSION_DENIED: 'Nie udzielono prawa odczytu Drive. Przy logowaniu zaakceptuj dostęp tylko do odczytu Dysku Google.',
    AUTH_LAUNCH_ERROR: 'Nie można otworzyć natywnego logowania Google. Zaktualizuj Usługi Google Play i sprawdź, czy konto Google jest dodane w ustawieniach telefonu.',
    CANCELLED: 'Google zgłosił anulowanie logowania. Spróbuj ponownie i nie zamykaj okna wyboru konta/zgody. Jeśli niczego nie anulowałeś, sprawdź konfigurację poniżej.',
    SIGN_IN_REQUIRED: 'Ten folder lub plik nie jest dostępny publicznie. Opcjonalne logowanie pomoże tylko kontu, które już ma prawo odczytu. APK nie przekazuje niczyich uprawnień.',
    PUBLIC_UNAVAILABLE: 'Google nie udostępnił czytelnej listy/pliku publicznego (możliwa zmiana strony albo dodatkowe potwierdzenie). Spróbuj opcjonalnego logowania; inne dostępne materiały pozostają w bibliotece.',
    API_KEY_REQUIRED: 'Opcjonalny tryb Drive API wymaga klucza wpisanego przy budowaniu APK przez dystrybutora. Domyślny odczyt publicznej strony nie wymaga klucza.',
    API_KEY_INVALID: 'Google odrzucił klucz API. Dystrybutor musi sprawdzić Drive API i ograniczenia klucza (pakiet/SHA-1), a następnie przebudować APK. Użytkownicy nie konfigurują kluczy.',
    ACCESS_DENIED: 'To konto Google nie może odczytać tego pliku lub folderu. Logowanie nie nadaje nowych uprawnień; inne dostępne materiały pozostają w bibliotece.',
    SERVICE_UNAVAILABLE: 'Google Drive jest chwilowo niedostępny lub ogranicza liczbę zapytań. Dane telefonu pozostają zapisane. Spróbuj ponownie później.',
    AUTH_SERVICE_ERROR: 'Usługa logowania Google jest chwilowo niedostępna. Dane telefonu pozostają zapisane. Sprawdź Google Play Services i spróbuj ponownie.',
  }
  const detail = error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)
  const status = detail.match(/\((?:Google status|Android result) -?\d+\)/)?.[0]
  return known[code(error)] ? `${known[code(error)]}${status ? ` ${status}` : ''}` : detail
}
function GoogleSetup() {
  if (isStandaloneWeb) return <section className="panel"><h3>Samodzielna PWA · materiały publiczne</h3><p>Pliki są pobierane z publicznego źródła Drive API lub przez skonfigurowane proxy Cloudflare, a analiza MusicXML i ćwiczenia działają na tym urządzeniu. PWA nie obsługuje logowania Google ani rozpoznawania PDF. Prywatne materiały wymagają APK i konta z istniejącym dostępem. Dane PWA należą do tego profilu przeglądarki; nie są łączone z kontem APK.</p></section>
  return <details className="panel"><summary>Pomoc: konfiguracja logowania Google</summary>
    <p>APK {DISTRIBUTION_VERSION} · Tryb bez logowania korzysta z publicznych folderów bez konfiguracji. OAuth jest opcją dla kont, które już mają dostęp do pozostałych plików.</p><p>Android OAuth: <strong>com.jankomuzykant.app</strong></p>
    <p>SHA-1 podpisu tej paczki testowej:<br/><code>7B:22:1B:6B:CF:08:F8:D4:0F:DC:8E:9D:3D:97:36:BA:38:26:1B:56</code></p>
    <p>W Google Cloud: włącz Google Drive API, utwórz klienta OAuth typu Android dla powyższego pakietu i SHA-1, skonfiguruj ekran zgody oraz dodaj używane konto do użytkowników testowych, jeśli projekt jest w trybie testowym. Zakresy: openid, email i drive.readonly. Aplikacja nie wymaga wpisania sekretu.</p>
    <p>Na telefonie: dodaj konto Google, zaktualizuj Usługi Google Play, zaakceptuj odczyt Drive. Konto musi mieć dostęp do folderu chóru. Administrator Google Workspace może blokować zgodę — wtedy potrzebne jest dopuszczenie aplikacji przez administratora.</p>
    <p>Nie przesyłaj tokenów ani haseł. Gdy problem pozostaje, zanotuj widoczny kod/status błędu i czy okno Google faktycznie się otworzyło. Szczegóły: docs\ANDROID.md w folderze aplikacji.</p>
  </details>
}
async function clearBrowserAccount(id: string) {
  const prefix = `account.${id}.`
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i)!
    if (key.startsWith(prefix)) localStorage.removeItem(key)
  }
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(prefix + 'janko-recordings')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(new Error('Nie można usunąć nagrań. Zamknij i uruchom aplikację ponownie.'))
    request.onblocked = () => reject(new Error('Baza nagrań jest używana. Zamknij Coaching i spróbuj ponownie.'))
  })
  if (localStorage.getItem('janko.android.account') === id) localStorage.removeItem('janko.android.account')
}

function ScoreLab({ song, part, state, update, cache }: {
  song: Song; part: Part; state: PhoneState; update: (patch: Partial<PhoneState>) => void
  cache: (file: Material) => Promise<Material>
}) {
  const sources = song.files.filter(file => file.kind === 'musicxml'), key = `${song.id}.${part}`
  const [source, setSource] = useState(state.guides[key]?.analysis.source_id || sources[0]?.id || '')
  const [xml, setXml] = useState(''), [staff, setStaff] = useState(''), [voice, setVoice] = useState('1')
  const [tempo, setTempo] = useState(state.guides[key]?.analysis.tempo ?? 100), [transpose, setTranspose] = useState(state.guides[key]?.transpose ?? 0)
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(''), [error, setError] = useState('')
  const [analysis, setAnalysis] = useState<Analysis | null>(null), [guide, setGuide] = useState<CoachGuide | null>(state.guides[key] ?? null)
  const [position, setPosition] = useState(0)
  const guideAudio = useRef<HTMLAudioElement>(null)
  useAudioPosition(guideAudio, setPosition, guide?.url ?? '')
  const parts = xml ? inspect(xml) : []
  function invalidate() {
    setGuide(null); setAnalysis(null); setPosition(0)
    if (state.guides[key]) {
      const guides = { ...state.guides }; delete guides[key]; update({ guides })
    }
  }
  async function load(id: string) {
    setBusy('Odczyt MusicXML na telefonie…'); setError(''); invalidate(); setXml('')
    try {
      const selected = sources.find(item => item.id === id)
      if (!selected) throw new Error('Najpierw pobierz lub zaimportuj MusicXML.')
      const file = await cache(selected)
      const response = await fetch(file.url)
      if (!response.ok) throw new Error('Nie można odczytać lokalnego MusicXML.')
      const content = decodeMusicXML(new Uint8Array(await response.arrayBuffer()))
      const all = inspect(content), saved = state.selections[`${key}.${id}`]
      const selectedId = saved && all.some(item => item.id === saved.staff) ? saved.staff : suggestion(all, part)
      setXml(content); setStaff(selectedId)
      const choices = all.find(item => item.id === selectedId)?.line_choices ?? []
      const savedChoice = saved?.voice && (saved.voice.startsWith('voice:') || saved.voice === 'upper' || saved.voice === 'lower') ? saved.voice : saved?.voice ? `voice:${saved.voice}` : ''
      setVoice(choices.some(choice => choice.id === savedChoice) ? savedChoice : choices.length === 1 ? choices[0].id : ''); setConfirmed(false)
    } catch (error) { setError(message(error)) }
    finally { setBusy('') }
  }
  async function importScore() {
    setBusy('Import lokalnego MusicXML…'); setError('')
    try {
      const entry = await Drive.importXml()
      const file = { ...material(entry, song.id, song.event_ids[0]), cached: true, url: fileUrl(entry) }
      update({ library: { ...state.library!, songs: state.library!.songs.map(item => item.id === song.id ?
        { ...item, files: [...item.files.filter(item => item.id !== file.id), file] } : item) } })
      setSource(file.id); setXml(''); invalidate()
    } catch (error) { setError(message(error)) }
    finally { setBusy('') }
  }
  function analyze() {
    if (!confirmed) throw new Error('Sprawdź nuty i potwierdź pięciolinię.')
    if (!voice) throw new Error('Wybierz melodię wewnątrz pięciolinii i sprawdź ją z PDF.')
    const policy = voice === 'upper' || voice === 'lower' ? voice : undefined
    const result = { ...analyzeXML(xml, staff, policy ? parts.find(item => item.id === staff)!.voices[0] : voice, part, tempo, transpose, policy), source_id: source }
    setAnalysis(result)
    update({ selections: { ...state.selections, [`${key}.${source}`]: { staff, voice } } })
    return result
  }
  async function generate() {
    setBusy('Generowanie WAV na telefonie…'); setError('')
    try {
      await new Promise(resolve => setTimeout(resolve, 30))
      const result = analyze()
      const bytes = wavBytes(result)
      const saved = await Drive.saveGenerated({ base64: base64(bytes), name: `guide-${Date.now()}.wav` })
      const value = { analysis: result, url: fileUrl(saved), tempoFactor: 1, transpose }
      setGuide(value); update({ guides: { ...state.guides, [key]: value } })
    } catch (error) { setError(message(error)) }
    finally { setBusy('') }
  }
  return <div className="phone-stack">
    <section className="panel"><h2>Analiza na telefonie</h2>
      <p>PDF możesz przeglądać, lecz ten APK <strong>nie rozpoznaje automatycznie nut ze skanu/PDF</strong>. Audiveris z komputera nie działa tu. Użyj MusicXML z Drive albo lokalnego eksportu z Sibeliusa. Nic nie jest wysyłane do serwera ani usług AI.</p>
      <button className="secondary" disabled={!!busy} onClick={() => void importScore()}>Importuj MusicXML / MXL z telefonu</button>
      <label>MusicXML<select value={source} onChange={event => { setSource(event.target.value); setXml(''); setConfirmed(false); invalidate() }}><option value="">Wybierz plik…</option>{sources.map(file => <option key={file.id} value={file.id}>{file.name}</option>)}</select></label>
      <button disabled={!source || !!busy} className="primary" onClick={() => void load(source)}>Odczytaj pięciolinie</button>
      {!!parts.length && <>
        <label>Pięciolinia<select value={staff} onChange={event => { setStaff(event.target.value); const choices = parts.find(item => item.id === event.target.value)?.line_choices ?? []; setVoice(choices.length === 1 ? choices[0].id : ''); setConfirmed(false); invalidate() }}>{parts.map((item, index) => <option key={item.id} value={item.id}>{index + 1} od góry · {item.name} · {item.bass ? 'klucz F · ' : ''}{item.low === null ? 'brak nut' : `${pitchName(item.low)}–${pitchName(item.high!)}`}</option>)}</select></label>
        <label>Melodia wewnątrz pięciolinii<select aria-label="Melodia wewnątrz pięciolinii" value={voice} onChange={event => { setVoice(event.target.value); setConfirmed(false); invalidate() }}><option value="">Wybierz po sprawdzeniu PDF…</option>{parts.find(item => item.id === staff)?.line_choices.map(choice => <option key={choice.id} value={choice.id}>{choice.name}{choice.range ? ` · ${choice.range.low}–${choice.range.high}` : ''}</option>)}</select></label>
        <p className="muted">Wybór głosu lub górnej/dolnej nuty nie naprawia OMR. Brakujących taktów nie uzupełniamy i nie zgadujemy partii B.</p>
        <label className="checkbox"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/> Sprawdzono nuty: to moja linia. Sugestia nie rozpoznaje automatycznie divisi.</label>
      </>}
      <label>Stałe tempo (ćwierćnuty / minutę)<input type="number" min={30} max={240} value={tempo} onChange={event => { setTempo(Number(event.target.value)); invalidate() }}/></label>
      <label>Transpozycja<select value={transpose} onChange={event => { setTranspose(Number(event.target.value)); invalidate() }}>{Array.from({ length: 25 }, (_, i) => i - 12).map(value => <option key={value} value={value}>{value > 0 ? '+' : ''}{value} półtonów</option>)}</select></label>
      <p className="notice">Zapisane takty kolejno, bez rozwijania repetycji, volt, D.C./D.S., fermat i zmian tempa. Stałe tempo ustaw samodzielnie. Wielogłos wymaga świadomego wyboru; niezależne nakładające się nuty bez rozdzielenia pozostają nieobsługiwane.</p>
      <div className="action-row"><button className="primary" disabled={!confirmed || !!busy} onClick={() => { try { setError(''); analyze() } catch (error) { setError(message(error)) } }}>Analizuj</button><button className="secondary" disabled={!confirmed || !!busy} onClick={() => void generate()}>Generuj WAV</button></div>
      {busy && <p role="status">{busy}</p>}{error && <p className="error" role="alert">{error}</p>}
    </section>
    {guide && <section className="panel"><h3>Przewodnik instrumentalny</h3><p>Zapisany prywatnie na telefonie, nie na Drive. To nuty syntetyczne, nie śpiew z tekstem.</p><audio ref={guideAudio} controls src={guide.url} onPlay={event => claimAudio([event.currentTarget])} onTimeUpdate={event => setPosition(event.currentTarget.currentTime)} onSeeked={event => setPosition(event.currentTarget.currentTime)}/><p>Otwórz Coaching, aby ćwiczyć frazy i porównać wysokość.</p></section>}
    {analysis && <><section className="panel"><h3>Zakres {analysis.range.low} — {analysis.range.high}</h3><p>{analysis.selected_part.name} · {Math.round(analysis.duration)} s · {analysis.tempo} BPM</p><div className="heatmap">{analysis.bars.map(bar => <span key={bar.number} title={bar.reasons.join(', ')}>Takt {bar.number}: {bar.difficulty}/100</span>)}</div><h3>Oddechy</h3>{analysis.breaths.map((breath, index) => <p key={index}>Takt {breath.bar}, miara {breath.beat}: {breath.reason}</p>)}<h3>Tekst</h3><p>{analysis.lyrics.map(item => item.text).join(' · ') || 'Brak tekstu w pliku.'}</p></section><ScorePlayback songId={song.id} xml={xml} analysis={analysis} position={position} transpose={transpose} onSeek={guide ? time => { const audio = guideAudio.current; if (audio) { claimAudio([audio]); audio.currentTime = time; setPosition(time); void playAudio(audio).catch(error => setError(message(error))) } } : undefined}/></>}
  </div>
}

function App() {
  const [account, setAccount] = useState<Account | null>(null), [state, setState] = useState<PhoneState>(fresh)
  const [ready, setReady] = useState(false), [blocked, setBlocked] = useState(false), [offline, setOffline] = useState(false)
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [selected, setSelected] = useState(''), [screen, setScreen] = useState<'library' | 'plan' | 'settings'>('library')
  const [tab, setTab] = useState<'practice' | 'analysis' | 'coaching'>('practice'), [search, setSearch] = useState(''), [event, setEvent] = useState('')
  const [programIndex, setProgramIndex] = useState(0)
  const [playback, setPlayback] = useState<PlaybackRequest | null>(null)
  const [playingSongId, setPlayingSongId] = useState('')
  const [playbackPlaying, setPlaybackPlaying] = useState(false)
  const [voiceMenu, setVoiceMenu] = useState(false)
  const [fileProblems, setFileProblems] = useState<Record<string, string>>({})
  const writes = useRef<Promise<void>>(Promise.resolve()), active = useRef(true)
  const library = state.library, song = library?.songs.find(item => item.id === selected)
  const stateRef = useRef(state); stateRef.current = state
  const accountRef = useRef(account); accountRef.current = account
  useEffect(() => { if (song && !playback) requestPlayback(song.id, false) }, [song?.id, playback])
  useEffect(() => {
    if (!voiceMenu) return
    const previous = document.activeElement
    const dialog = document.querySelector<HTMLElement>('[role=dialog]')
    const buttons = () => Array.from(dialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])
    buttons()[0]?.focus()
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') setVoiceMenu(false)
      if (event.key !== 'Tab') return
      const items = buttons()
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus() }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); if (previous instanceof HTMLElement) previous.focus() }
  }, [voiceMenu])
  function openSong(id: string) {
    if (!playback) requestPlayback(id, false)
    setSelected(id); setScreen('library'); setTab('practice'); setError(''); setNotice('')
    window.scrollTo(0, 0)
  }
  useEffect(() => {
    if (!song || offline || blocked) return
    let cancelled = false
    const first = preferredAudio(song, state.part) ?? song.files.find(file => file.kind === 'audio')
    const needed = song.files.filter(file => file.kind === 'pdf' || file.kind === 'audio' && !!first &&
      (file.id === first.id || !!file.part && file.section === first.section && file.slow === first.slow))
    void (async () => {
      for (const file of needed) {
        if (cancelled) return
        try { await cache(file) }
        catch (error) {
          if (cancelled) return
          if (!['SIGN_IN_REQUIRED', 'PUBLIC_UNAVAILABLE', 'ACCESS_DENIED'].includes(code(error))) { setError(message(error)); return }
        }
      }
    })()
    return () => { cancelled = true }
  }, [selected, state.part, account?.id, offline, blocked])
  async function activate(value: Account) {
    setPlayback(null); setPlayingSongId(''); setPlaybackPlaying(false)
    await writes.current
    const previous = localStorage.getItem('janko.android.account')
    if (previous && previous !== value.id && previous !== 'anonymous-choir') await clearBrowserAccount(previous)
    setSession({ hosted: true, user_id: value.id, email: value.email, admin: false, csrf: null })
    let saved
    try { saved = await Drive.readState() }
    catch (error) {
      if (['AUTH_REQUIRED', 'ACCESS_DENIED', 'AUTH_PERMISSION_DENIED'].includes(code(error))) await clearBrowserAccount(value.id)
      throw error
    }
    const valueState = saved.state ? { ...fresh(), ...JSON.parse(saved.state) } as PhoneState : fresh()
    localStorage.setItem('janko.android.account', value.id)
    setAccount(value); setState(valueState); setSelected(''); setBlocked(false)
    setFileProblems({})
  }
  async function accessFailure(error: unknown) {
    if (['AUTH_REQUIRED', 'ACCESS_DENIED', 'AUTH_PERMISSION_DENIED'].includes(code(error))) {
      setBlocked(true)
      const current = accountRef.current
      await writes.current
      if (current) await clearBrowserAccount(current.id)
      setState(fresh())
    }
  }
  async function verify() {
    try { const result = await Drive.verify(); setAccount(result.account); setOffline(false); setBlocked(false) }
    catch (error) {
      if (code(error) === 'NETWORK_ERROR') { setOffline(true); return }
      setBlocked(accountRef.current?.anonymous !== true); setError(message(error))
      await accessFailure(error)
    }
  }
  useEffect(() => {
    void Drive.initialize().then(async result => {
      if (result.account) { await activate(result.account); await verify() }
      else {
        const previous = localStorage.getItem('janko.android.account')
        if (previous) await clearBrowserAccount(previous)
      }
    }).catch(error => setError(message(error))).finally(() => setReady(true))
    const resume = () => { if (document.visibilityState === 'visible' && active.current && accountRef.current) void verify().catch(error => setError(message(error))) }
    document.addEventListener('visibilitychange', resume)
    return () => { active.current = false; document.removeEventListener('visibilitychange', resume) }
  }, [])
  function update(patch: Partial<PhoneState>) {
    const next = { ...stateRef.current, ...patch }; stateRef.current = next; setState(next)
    const snapshot = JSON.stringify(next)
    writes.current = writes.current.then(() => Drive.writeState({ state: snapshot }))
      .catch(error => setError(`Nie zapisano postępów: ${message(error)}`))
  }
  function recordPractice(songId: string, started: number | null, seconds: number) {
    const current = stateRef.current, key = `${songId}.${current.part}`
    update({
      timers: { ...current.timers, [key]: started },
      practiceSeconds: { ...current.practiceSeconds, [key]: (current.practiceSeconds[key] ?? 0) + seconds },
      practiceLog: seconds ? [...current.practiceLog, { song: songId, part: current.part, day: practiceDay(), seconds }] : current.practiceLog
    })
  }
  async function connect() {
    setBusy('Logowanie Google i sprawdzanie folderu…'); setError('')
    try {
      await writes.current
      const publicLibrary = accountRef.current?.anonymous ? stateRef.current.library : null
      const result = await Drive.connect()
      await activate(result.account); setOffline(false)
      if (publicLibrary) {
        const personal = await Drive.readState()
        const saved: PhoneState | null = personal.state ? JSON.parse(personal.state) : null
        const library = mergeLibraries(publicLibrary, saved?.library ?? null)
        const next = { ...fresh(), ...saved, library }
        stateRef.current = next; setState(next)
        await Drive.writeState({ state: JSON.stringify(next) })
      }
      setNotice('Zalogowano. Synchronizuj ponownie, aby odczytać materiały dostępne temu kontu. Logowanie nie nadaje nowych uprawnień.')
    }
    catch (error) { setError(message(error)) }
    finally { setBusy('') }
  }
  async function usePublic() {
    if (accountRef.current && !accountRef.current.anonymous &&
        !window.confirm('Wrócić do trybu bez logowania? Prywatne pliki i dane zalogowanego konta zostaną usunięte; dane publiczne pozostaną.')) return
    setBusy('Otwieranie biblioteki publicznej…'); setError('')
    try {
      await writes.current
      const previous = accountRef.current
      const result = await Drive.useAnonymous()
      if (previous && !previous.anonymous) await clearBrowserAccount(previous.id)
      await activate(result.account); setOffline(false)
      await verify()
    } catch (error) { setError(message(error)) }
    finally { setBusy('') }
  }
  async function sync() {
    setBusy('Odczyt biblioteki Drive…'); setError('')
    try {
      const next = await syncLibrary(state.library, setBusy), known = new Set(state.library?.songs.flatMap(song => song.files.map(file => file.id)) ?? [])
      const added = state.library ? next.songs.flatMap(song => song.files).filter(file => !known.has(file.id)).map(file => ({ id: file.id, name: file.name })) : []
      // Local imports are personal; a read-only Drive sync must not remove them.
      for (const previous of state.library?.songs ?? []) {
        const imports = previous.files.filter(file => file.id.startsWith('local-'))
        if (!imports.length) continue
        const current = next.songs.find(item => item.id === previous.id)
        if (current) current.files.push(...imports.filter(file => !current.files.some(item => item.id === file.id)))
        else next.songs.push(previous)
      }
      update({ library: next, news: [...state.news, ...added] }); setOffline(false)
      setNotice(`Odczytano ${next.songs.length} utworów. Drive nie został zmieniony.`)
    } catch (error) { setError(message(error)); await accessFailure(error) }
    finally { setBusy('') }
  }
  async function cache(file: Material): Promise<Material> {
    file = stateRef.current.library?.songs.flatMap(song => song.files).find(item => item.id === file.id) ??
      stateRef.current.library?.other.find(item => item.id === file.id) ?? file
    if (file.cached && file.url) return file
    if (offline) throw new Error('Ten plik nie został jeszcze pobrany na telefon. Połącz się z internetem.')
    let saved
    const owner = accountRef.current?.id
    try { saved = await Drive.download({ id: file.id, name: file.name, mime: file.kind === 'document' ? 'text/plain' : '' }) }
    catch (error) {
      if (['SIGN_IN_REQUIRED', 'PUBLIC_UNAVAILABLE', 'ACCESS_DENIED'].includes(code(error))) {
        setFileProblems(current => ({ ...current, [file.id]: message(error) }))
        if (code(error) === 'ACCESS_DENIED') await verify()
      } else {
        await accessFailure(error)
      }
      throw error
    }
    if (accountRef.current?.id !== owner || !stateRef.current.library) throw new Error('Konto zmieniło się podczas pobierania. Otwórz utwór ponownie.')
    const result = { ...file, cached: true, url: fileUrl(saved) }
    const current = stateRef.current.library!
    update({ library: { ...current, songs: current.songs.map(song => ({ ...song, files: song.files.map(item => item.id === file.id ? result : item) })), other: current.other.map(item => item.id === file.id ? result : item) } })
    return result
  }
  async function downloadSong() {
    if (!song) return
    setError(''); setBusy('Pobieranie na telefon…')
    try {
      let missed = 0
      for (const file of song.files.filter(file => ['audio', 'pdf', 'musicxml'].includes(file.kind))) {
        setBusy(`Pobieranie ${file.name}…`)
        try { await cache(file) }
        catch (error) {
          if (!['SIGN_IN_REQUIRED', 'PUBLIC_UNAVAILABLE'].includes(code(error))) throw error
          missed++
        }
      }
      setNotice(missed ? `Dostępne materiały zapisano. ${missed} plików niedostępnych publicznie — szczegóły przy plikach.` : 'Materiały zapisano prywatnie na telefonie.')
    }
    catch (error) { setError(message(error)) }
    finally { setBusy('') }
  }
  async function signOut() {
    if (!window.confirm('Wylogować i usunąć pobrane materiały, postępy oraz nagrania tego konta z tego telefonu? Tej operacji nie można cofnąć.')) return
    setBusy('Usuwanie danych konta…'); setError('')
    try {
      await writes.current
      await Drive.signOut()
      if (account) await clearBrowserAccount(account.id)
      const result = await Drive.initialize()
      if (result.account) await activate(result.account)
      else { setAccount(null); setState(fresh()) }
      setSelected(''); setScreen('library'); setOffline(false); setBlocked(false)
    } catch (error) { setError(message(error)) }
    finally { setBusy('') }
  }
  const cachedSong = song ? { ...song, files: song.files.filter(file => file.cached) } : null
  const eventSongs = library?.songs.filter(song => !event || song.event_ids.includes(event)) ?? []
  const order = eventPool(library?.songs ?? [], event, state.programs[event])
  const currentProgram = library?.songs.find(song => song.id === order[programIndex])
  const history = practiceHistory(state.practiceLog, state.part)
  function requestPlayback(id: string, play = true) {
    setPlayback(value => ({ id, play, revision: (value?.revision ?? 0) + 1 }))
  }
  async function preparePlayback(item: Song, part: Part) {
    const identity = accountRef.current?.id
    const recording = preferredAudio(item, part)
    if (!recording) throw new Error(`${item.name}: brak nagrania ${PART_LABELS[part]}.`)
    if (offline && !recording.cached) throw new Error('To nagranie nie jest pobrane. Połącz się z internetem i zapisz je na telefonie.')
    await cache(recording)
    if (!offline) for (const file of item.files.filter(file => file.kind === 'audio' && file.part &&
      file.section === recording.section && file.slow === recording.slow && file.id !== recording.id)) {
      try { await cache(file) }
      catch (error) { setNotice(`Twoja partia jest gotowa, ale mikser nie ma materiału „${file.name}”: ${message(error)}`) }
    }
    if (accountRef.current?.id !== identity) throw new Error('Zmieniono konto podczas pobierania.')
    const updated = stateRef.current.library?.songs.find(song => song.id === item.id)
    return { ...item, files: (updated?.files ?? item.files).filter(file => file.cached) }
  }
  const filtered = eventSongs.filter(song => song.name.toLocaleLowerCase('pl').includes(search.toLocaleLowerCase('pl')))
  const ownAudio = library?.songs.filter(song => song.files.some(file => file.kind === 'audio' && isMyPart(file.part, state.part))).length ?? 0
  const dock = !!playback
  return <div className={`app-shell android-app${isStandaloneWeb ? ' web-standalone' : ''}${dock ? ' has-practice-player' : ''}`}>
    <aside className="sidebar"><button className="brand" aria-label="Janko Muzykant — biblioteka" onClick={() => { setSelected(''); setScreen('library'); window.scrollTo(0, 0) }}><span className="brand-icon"><Music2 size={25}/></span><span>Janko<span className="brand-sub">MUZYKANT</span></span></button></aside>
    <div className="main-shell">
    <header className="topbar"><div className="breadcrumb"><BookOpen size={16}/><button onClick={() => { setSelected(''); setScreen('library') }}>Biblioteka</button>{song && screen === 'library' && <><span>/</span><span>{song.name}</span></>}{screen === 'plan' && <span>/ Plan i postępy</span>}{screen === 'settings' && <span>/ Ustawienia</span>}</div><div className="topbar-right">{account && <label className="part-picker"><span>Mój głos</span><select aria-label="Mój głos" value={state.part} onChange={event => update({ part: event.target.value as Part })}>{PARTS.map(part => <option key={part} value={part}>{PART_LABELS[part]}</option>)}</select><ChevronDown size={13}/></label>}</div></header>
    <main>
      <DistributionNotice web={isStandaloneWeb}/>
      {!ready && <p role="status">Otwieranie danych urządzenia…</p>}
      {busy && <p className="notice" role="status">{busy}</p>}{error && <p className="error" role="alert">{error}</p>}{notice && <p className="notice">{notice}</p>}
      {ready && (screen === 'settings' || !account || blocked) && <section className="panel"><h3>{account?.anonymous ? 'Bez logowania · materiały publiczne' : 'Google · dostęp tego konta'}</h3>
        <p>Drive to tylko źródło do odczytu. Bez logowania nie ma ograniczenia do członków chóru. APK nie udostępnia prywatnych plików ani nie przekazuje Twoich uprawnień innym osobom.</p>
        {!isStandaloneWeb && (account?.anonymous || !account || blocked) && <button className="secondary" disabled={!!busy} onClick={() => void connect()}>Zaloguj przez Google (opcjonalnie)</button>}
        {(!account?.anonymous || blocked) && <button className="secondary" disabled={!!busy} onClick={() => void usePublic()}>Korzystaj bez logowania</button>}
      </section>}
      {ready && (!account || blocked) && <GoogleSetup/>}
      {ready && !!library?.unavailable?.length && screen === 'library' && !song && <details className="warnings" open><summary>Foldery wymagające sprawdzenia dostępu</summary>{library.unavailable.map(item => <p key={item.id}><strong>{item.name}</strong> — {item.reason}</p>)}</details>}
      {offline && <p className="notice">Offline: tylko wcześniej pobrane materiały. Ostatnie potwierdzenie dostępu: {account ? new Date(account.lastVerified).toLocaleString('pl') : '—'}. Cofnięcia dostępu nie można sprawdzić bez internetu.</p>}
      {ready && (!account || blocked) ? <section className="panel"><h1>Twój chór. Na Twoim urządzeniu.</h1><p>{isStandaloneWeb ? 'Publiczna biblioteka wymaga połączenia z internetem i działającego proxy strony dystrybucji. Prywatne foldery nie są dostępne w PWA.' : 'Zaloguj się kontem Google z dostępem do folderu chóru. Wyłącznie odczyt Drive. Bez komputera, Proxmox i serwera aplikacji.'}</p>{!isStandaloneWeb && <button className="primary" disabled={!!busy} onClick={() => void connect()}>Połącz Google Drive</button>}{account && <button className="secondary" disabled={!!busy} onClick={() => { setError(''); void verify().catch(error => setError(message(error))) }}>Sprawdź ponownie</button>}<p className="muted">Publiczny link Drive nie ogranicza dostępu do członków chóru. Aplikacja nie zmienia uprawnień.</p></section> : ready && account && <>
        {screen === 'settings' ? <section className="panel"><h1>Ustawienia urządzenia</h1><p>Konto/tryb: {account.email}</p><p>{isStandaloneWeb ? `PWA ${DISTRIBUTION_VERSION} · dane w tym profilu przeglądarki. Pobrania, WAV i postępy nie są synchronizowane z innymi urządzeniami ani kontami APK. Pamięć przeglądarki może zostać usunięta przez użytkownika lub system.` : `APK testowy ${DISTRIBUTION_VERSION} · Android · dane prywatne aplikacji. Publiczna biblioteka jest oddzielna od kont Google. Tokeny nie trafiają do JavaScript. Pobrania, WAV i postępy są oddzielne dla kont. Nagrania pozostają w prywatnej pamięci WebView tego konta.`}</p><p>Dostęp sprawdzamy przy połączeniu, wznowieniu i pobieraniu. Pliki dostępne offline nie mogą być zdalnie unieważnione natychmiast. Usunięcie danych usuwa lokalną bibliotekę.</p><p>Rozpoznawanie PDF → MusicXML wymaga wersji desktopowej Start.bat. Analiza i synteza MusicXML działają na urządzeniu, w stałym tempie i kolejności zapisanych taktów.</p><button className="secondary" disabled={!!busy} onClick={() => void verify()}>Sprawdź dostęp do Drive</button><button className="danger" disabled={!!busy} onClick={() => void signOut()}>{account.anonymous ? 'Usuń lokalne dane trybu publicznego' : 'Wyloguj i usuń dane konta'}</button><p className="muted">Aktualizacje APK muszą używać tego samego podpisu. Zmiana podpisu wymaga odinstalowania i usuwa dane.</p><GoogleSetup/></section> :
        screen === 'plan' ? <div className="phone-stack"><section className="panel"><h1>Plan i postępy</h1><label>Wydarzenie<select value={event} onChange={e => { setEvent(e.target.value); setProgramIndex(0) }}><option value="">Wszystkie utwory</option>{library?.events.map(event => <option key={event.id} value={event.id}>{event.name}</option>)}</select></label>
          {!!event && <label>Data koncertu (Twoja notatka)<input type="date" value={state.dates[event] ?? ''} onChange={e => update({ dates: { ...state.dates, [event]: e.target.value } })}/></label>}
          {event && state.dates[event] && <p>Do koncertu: {Math.ceil((new Date(state.dates[event] + 'T12:00:00').getTime() - Date.now()) / 86400000)} dni. Twoja potwierdzona data — sprawdź ją w źródłowym kalendarzu.</p>}
          <PhoneCalendar library={library} cache={cache} confirm={(eventId, date) => update({ dates: { ...state.dates, [eventId]: date } })}/>
          <section className="panel"><h3>Mój tydzień</h3><p>Dziś: {minutes(history.todaySeconds)} · Seria: {history.streak} dni</p><div className="phone-practice-week">{history.days.map(day => <div key={day.day}><span className="phone-practice-bar" style={{ height: `${Math.max(3, 60 * day.seconds / Math.max(1, ...history.days.map(item => item.seconds)))}px` }}/><small>{day.day.slice(5)}</small><strong>{minutes(day.seconds)}</strong></div>)}</div></section>
          <h3>Program ćwiczenia</h3><p className="muted">Początkowo alfabetycznie, nie według dyrygenta. Zmień kolejność strzałkami. „Odtwarzaj program” przechodzi do następnego nagrania; ekran aplikacji musi pozostać otwarty. Pętla A–B wstrzymuje przechodzenie dalej.</p>
          <button className="primary" disabled={!!busy || !order.length} onClick={() => requestPlayback(order[programIndex])}>Odtwarzaj program</button>
          {order.map((id, index) => { const song = library?.songs.find(song => song.id === id); if (!song) return null; return <div className="phone-program" key={id}><button onClick={() => { setSelected(id); setScreen('library'); setTab('practice') }}>{song.name}</button><select aria-label={`Postęp ${song.name}`} value={state.progress[`${id}.${state.part}`] ?? ''} onChange={e => update({ progress: { ...state.progress, [`${id}.${state.part}`]: e.target.value } })}>{Object.entries(LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><button disabled={index === 0} onClick={() => { const next = [...order]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; update({ programs: { ...state.programs, [event]: next } }) }}>↑</button><button disabled={index === order.length - 1} onClick={() => { const next = [...order]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; update({ programs: { ...state.programs, [event]: next } }) }}>↓</button></div> })}
          {currentProgram && <><h3>{programIndex + 1}. {currentProgram.name}</h3><p>Sterowanie odtwarzaniem jest dostępne stale na dole ekranu.</p><button className="secondary" disabled={programIndex === 0 || !!busy} onClick={() => setProgramIndex(index => index - 1)}>Poprzedni</button><button className="primary" disabled={programIndex >= order.length - 1 || !!busy} onClick={() => setProgramIndex(index => index + 1)}>Następny utwór</button></>}
        </section><section className="panel"><h3>Czas ćwiczenia</h3><p>Łącznie dla {PART_LABELS[state.part]}: {minutes(Object.entries(state.practiceSeconds).filter(([key]) => key.endsWith(`.${state.part}`)).reduce((sum, [, seconds]) => sum + seconds, 0))}</p></section><section className="panel"><h3>Brakujące materiały</h3><p className="muted">Raport dotyczy widocznej biblioteki. Niewidoczne prywatne pliki mogą istnieć na Drive.</p>{eventSongs.map(song => { const missing = missingMaterials(song, state.part); return missing.length ? <p key={song.id}><button className="text-button" onClick={() => openSong(song.id)}>{song.name}</button> — {missing.join(' · ')}</p> : null })}</section><section className="panel"><h3>Nowe materiały od synchronizacji</h3>{state.news.filter(item => !state.seen.includes(item.id)).map(item => <p key={item.id}>{item.name}</p>)}<button className="secondary" onClick={() => update({ seen: state.news.map(item => item.id) })}>Oznacz jako przeczytane</button></section></div> :
        song && cachedSong ? <><button className="back-link" onClick={() => { setSelected(''); window.scrollTo(0, 0) }}><ArrowLeft size={15}/> Wróć do biblioteki</button><div className="song-heading"><div><span className="eyebrow">TWOJA KOLEJNA DOBRA PRÓBA</span><h1>{song.name}</h1><Badges song={song} part={state.part}/></div><div className="song-page-actions"><SongPlaybackControl songId={song.id} songName={song.name} activeSongId={playingSongId} playing={playbackPlaying} onStart={() => requestPlayback(song.id)}/><button className="secondary" aria-label="Pobierz materiały na telefon" disabled={!!busy || offline} onClick={() => void downloadSong()}><CloudDownload size={17}/> Zapisz offline</button></div></div><p className="muted phone-cache-count">{song.files.filter(file => file.cached).length}/{song.files.length} plików na telefonie</p>
          <PhoneProgress key={`${song.id}.${state.part}`} status={state.progress[`${song.id}.${state.part}`] ?? ''} started={state.timers[`${song.id}.${state.part}`] ?? null} total={state.practiceSeconds[`${song.id}.${state.part}`] ?? 0} onStatus={value => update({ progress: { ...state.progress, [`${song.id}.${state.part}`]: value } })} onTimer={(started, seconds) => recordPractice(song.id, started, seconds)}/>
          <nav className="tabs phone-tabs"><button className={tab === 'practice' ? 'active' : ''} onClick={() => setTab('practice')} aria-pressed={tab === 'practice'}>Nuty i nagrania</button><button className={tab === 'analysis' ? 'active' : ''} aria-label="Analiza" onClick={() => setTab('analysis')} aria-pressed={tab === 'analysis'}>Analiza i generowanie</button><button className={tab === 'coaching' ? 'active' : ''} onClick={() => setTab('coaching')} aria-pressed={tab === 'coaching'}>Coaching</button></nav>
          {tab === 'practice' ? <><div className="practice-workspace"><ScoreViewer files={cachedSong.files}/><div id="player-details"/></div><section className="panel materials"><h3><FileMusic size={18}/> Wszystkie materiały</h3>{song.files.map(file => <div className="material-row" key={file.id}><span>{file.kind === 'audio' ? <Headphones size={17}/> : <FileMusic size={17}/>}</span><div><button className="text-button phone-material" disabled={!!busy || offline && !file.cached} onClick={() => { void cache(file).catch(error => setError(message(error))) }}>{file.name}</button>{fileProblems[file.id] && <span role="status"> — {fileProblems[file.id]}</span>}</div><span className="small-tag">{file.cached ? 'Lokalnie' : 'Pobierz'}</span></div>)}</section></> :
          tab === 'analysis' ? <ScoreLab key={`${song.id}.${state.part}`} song={song} part={state.part} state={state} update={update} cache={cache}/> :
          <CoachingPanel key={`${song.id}.${state.part}`} song={cachedSong} part={state.part} localGuide={state.guides[`${song.id}.${state.part}`] ?? null} onBeforeMicrophone={async () => { if (!(await Drive.requestMicrophone()).granted) throw new Error(isStandaloneWeb ? 'Zezwól na mikrofon w ustawieniach tej witryny w przeglądarce.' : 'Zezwól na mikrofon w ustawieniach Androida.') }}/>}
        </> : <>
          <section className="hero"><div><div className="eyebrow"><span className="live-dot"/> TWOJE MIEJSCE W CHÓRZE</div><h1>Dobry śpiew zaczyna się<br/>od spokojnej próby.</h1></div></section>
          <div className="library-stats"><div><strong>{library?.songs.length ?? 0}</strong><span>utworów w bibliotece</span></div><div><strong>{ownAudio}</strong><span>z nagraniem Twojego głosu</span></div><div><strong>{library?.events.length ?? 0}</strong><span>wydarzeń i repertuarów</span></div></div>
          <div className="library-title"><div><span className="eyebrow">REPERTUAR</span><h2>Co dziś zaśpiewasz?</h2></div><div className="action-row"><button className="secondary" onClick={() => { setScreen('plan'); window.scrollTo(0, 0) }}><CalendarDays size={17}/> Plan i postępy</button><button className="secondary" aria-label="Synchronizuj Drive (tylko odczyt)" disabled={!!busy || offline} onClick={() => void sync()}><CloudDownload size={17}/> Synchronizuj Drive</button></div></div>
          <div className="filters"><label className="search"><Search size={18}/><input id="song-search" type="search" aria-label="Szukaj" value={search} onChange={e => setSearch(e.target.value)} placeholder="Szukaj utworu…"/></label><select aria-label="Filtr wydarzeń" value={event} onChange={e => setEvent(e.target.value)}><option value="">Wszystkie wydarzenia</option>{library?.events.map(event => <option key={event.id} value={event.id}>{event.name}</option>)}</select></div>
          <div className="result-line"><span>{filtered.length} utworów · {event ? library?.events.find(item => item.id === event)?.name : 'Cały repertuar'}</span><span>{library?.last_sync ? `Odczyt: ${new Date(library.last_sync).toLocaleDateString('pl')}` : 'Dostęp wyłącznie do odczytu'}</span></div>
          {!library?.songs.length && <section className="panel empty"><LibraryBig size={42}/><h2>Biblioteka chóru</h2><p>{account.email} · 0 utworów. Wybierz synchronizację, aby wczytać publiczny repertuar.</p></section>}
          <div className="song-grid">{filtered.map((song, index) => <button className="song-card phone-song" key={song.id} onClick={() => openSong(song.id)}><div className="card-top"><span className="song-number">{String(index + 1).padStart(2, '0')}</span><span className="card-note"><Music2 size={24}/></span><ArrowRight size={17}/></div><h3>{song.name}</h3><p>{song.event_ids.length > 1 ? `${song.event_ids.length} wydarzenia` : library?.events.find(event => event.id === song.event_ids[0])?.name}</p><Badges song={song} part={state.part}/><div className="card-bottom"><span>{song.files.length} materiałów</span><span>Otwórz próbę <ArrowRight size={13}/></span></div></button>)}</div>
          {filtered.length === 0 && !!library?.songs.length && <p className="empty">Nie znaleziono utworu. Zmień nazwę lub filtr wydarzenia.</p>}
          <details className="phone-access"><summary><ShieldCheck size={14}/>{account.anonymous ? 'Bez logowania · materiały publiczne' : 'Google · dostęp tego konta'}</summary><p>Drive jest tylko źródłem odczytu. Bez logowania nie ma ograniczenia do członków chóru. Widać wyłącznie publiczne materiały; pusta lista nie wyklucza niewidocznych prywatnych plików. APK nie przekazuje Twoich uprawnień innym osobom.</p><button className="secondary" onClick={() => { setScreen('settings'); window.scrollTo(0, 0) }}>Połączenie i opcjonalne logowanie</button></details>
          <details className="panel root-materials"><summary>Pozostałe materiały · {library?.other.length ?? 0}</summary>{library?.other.map(file => <button className="secondary" key={file.id} onClick={() => { void cache(file).then(() => setNotice(`Pobrano ${file.name}`)).catch(error => setError(message(error))) }}>{file.cached ? '✓ ' : '↓ '}{file.name}</button>)}{!!library?.other.some(file => file.cached && file.kind === 'pdf') && <ScoreViewer files={library.other.filter(file => file.cached && file.kind === 'pdf')}/>}</details>
        </>}
      </>}
      <footer><span><ShieldCheck size={14}/> Google Drive · tylko odczyt</span><span>Twoja pracownia na telefonie.</span></footer>
      {ready && account && !blocked && <QueuePlayer key={account.id} songs={library?.songs ?? []} pool={order} part={state.part} request={playback}
        prepare={preparePlayback} onOpenSong={openSong}
        onCurrent={id => { setPlayingSongId(id); setPlaybackPlaying(false) }} onPlayingChange={(_id, playing) => setPlaybackPlaying(playing)}
        detailId={song && screen === 'library' && tab === 'practice' ? 'player-details' : null}
        detailSongId={song && screen === 'library' && tab === 'practice' ? song.id : null}/>}
    </main>
    </div>
    {ready && account && !blocked && <nav className="phone-nav" aria-label="Nawigacja telefonu"><button onClick={() => { setScreen('library'); setSelected(''); window.scrollTo(0, 0) }} aria-current={screen === 'library' && !song ? 'page' : undefined}><LibraryBig size={21}/><span>Biblioteka</span></button><button aria-label="Plan" onClick={() => { setScreen('plan'); setSelected(''); window.scrollTo(0, 0) }} aria-current={screen === 'plan' ? 'page' : undefined}><CalendarDays size={21}/><span>Plan i postępy</span></button><button aria-label="Wybierz mój głos" onClick={() => setVoiceMenu(true)}><Headphones size={21}/><span>Mój głos · {state.part}</span></button><button onClick={() => { setScreen('settings'); setSelected(''); window.scrollTo(0, 0) }} aria-current={screen === 'settings' ? 'page' : undefined}><Settings2 size={21}/><span>Ustawienia</span></button></nav>}
    {voiceMenu && <div className="modal-backdrop" onClick={() => setVoiceMenu(false)}><section className="panel modal voice-menu" role="dialog" aria-modal="true" aria-labelledby="voice-title" onClick={event => event.stopPropagation()}><button className="modal-close icon-button" aria-label="Zamknij wybór głosu" onClick={() => setVoiceMenu(false)}><X/></button><h2 id="voice-title">Twój głos w chórze</h2><p>Zapamiętamy go dla wszystkich utworów na tym urządzeniu, osobno dla każdego konta.</p>{PARTS.map(part => <button key={part} className={part === state.part ? 'primary' : 'secondary'} aria-pressed={part === state.part} onClick={() => { update({ part }); setVoiceMenu(false) }}>{PART_LABELS[part]}{part === state.part && <Check size={18}/>}</button>)}</section></div>}
  </div>
}
createRoot(document.getElementById('root')!).render(<App/>)
