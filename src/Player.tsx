import { useEffect, useId, useRef, useState } from 'react'
import { BookmarkPlus, Check, Headphones, Info, Pause, Play, Repeat2, RotateCcw, SlidersHorizontal, Volume2, SkipBack, SkipForward } from 'lucide-react'
import { createPortal } from 'react-dom'
import { preferredAudio } from './practice'
import { claimAudio, publishPlayback } from './playbackClock'
import { errorMessage, isMyPart, timeLabel } from './api'
import { userStorage as localStorage } from './session'
import type { Bookmark, Material, Part, Song } from './types'

type Mode = 'solo' | 'blend' | 'karaoke'

export default function Player({ song, part, autoPlay = false, autoPlayToken = 0, onComplete, detailId, queue, onPlayingChange }: {
  song: Song; part: Part; autoPlay?: boolean; autoPlayToken?: number; onComplete?: () => void; detailId?: string | null; onPlayingChange?: (playing: boolean) => void
  queue?: { previous?: (playing: boolean) => void; next?: (playing: boolean) => void; label: string; open: () => void; pageSong?: Song; playPageSong?: () => void }
}) {
  const tracks = song.files.filter(f => f.kind === 'audio')
  const preferred = preferredAudio(song, part)
  const [selectedId, setSelectedId] = useState(preferred?.id ?? '')
  const selected = tracks.find(f => f.id === selectedId) ?? preferred
  const [mode, setMode] = useState<Mode>('solo')
  const [mixerHelp, setMixerHelp] = useState(false)
  const mixerHelpId = useId()
  const [playing, setPlaying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [a, setA] = useState<number | null>(null)
  const [b, setB] = useState<number | null>(null)
  const [loop, setLoop] = useState(false)
  const [repeatSong, setRepeatSong] = useState(false)
  const [volumes, setVolumes] = useState<Record<string, number>>({})
  const [error, setError] = useState('')
  const [bookmarkLabel, setBookmarkLabel] = useState('')
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const audios = useRef(new Map<string, HTMLAudioElement>())
  const loadController = useRef<AbortController | null>(null)
  const playingRef = useRef(false)
  const [detailTarget, setDetailTarget] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setDetailTarget(null)
    if (!detailId) return
    const find = () => {
      const element = document.getElementById(detailId)
      if (element) { setDetailTarget(element); observer.disconnect() }
    }
    const observer = new MutationObserver(find)
    observer.observe(document.body, { childList: true, subtree: true }); find()
    return () => observer.disconnect()
  }, [detailId])
  const key = `janko.bookmarks.${song.id}.${selected?.id ?? ''}`

  useEffect(() => {
    try { setBookmarks(JSON.parse(localStorage.getItem(key) ?? '[]') as Bookmark[]) }
    catch { setError('Nie można odczytać zapisanych zakładek.'); setBookmarks([]) }
  }, [key])

  function saveBookmarks(items: Bookmark[]) {
    setBookmarks(items)
    try { localStorage.setItem(key, JSON.stringify(items)) }
    catch { setError('Brak miejsca na zapis zakładek w przeglądarce.') }
  }

  useEffect(() => {
    setSelectedId(preferred?.id ?? '')
  }, [part, preferred?.id])

  function pause() {
    loadController.current?.abort(); loadController.current = null
    audios.current.forEach(audio => audio.pause())
    playingRef.current = false
    setPlaying(false); setBusy(false); onPlayingChange?.(false)
  }
  useEffect(() => {
    const master = selected ? audios.current.get(selected.id) : undefined
    pause(); setTime(0); setDuration(master && Number.isFinite(master.duration) ? master.duration : 0); setA(null); setB(null); setLoop(false); setVolumes({}); setError('')
    audios.current.forEach(audio => { audio.currentTime = 0 })
  }, [selected?.id])
  useEffect(() => {
    const map = audios.current
    return () => { loadController.current?.abort(); map.forEach(audio => { audio.pause(); audio.removeAttribute('src'); audio.load() }); map.clear(); publishPlayback({ song: '', track: '', time: 0, duration: 0 }) }
  }, [])

  // A split-page/slow track must never mix with a different page or tempo variant.
  const candidates = selected ? tracks.filter(f => f.part && f.section === selected.section && f.slow === selected.slow) : []
  const distinct = candidates.filter((f, index) => candidates.findIndex(t => t.part === f.part) === index)
  const own = selected && isMyPart(selected.part, part) ? selected : distinct.find(f => f.part === part) ?? distinct.find(f => isMyPart(f.part, part))
  const compatible = distinct.filter(f => !own || !isMyPart(f.part, part) || f.id === own.id)
  const active: Material[] = mode === 'solo' || selected?.full || !selected?.part ? selected ? [selected] : [] :
    [selected, ...compatible.filter(f => f.id !== selected.id)]
  const activeIds = active.map(f => f.id).join(',')
  const defaultVolume = (track: Material) => mode === 'solo' ? 1 :
    isMyPart(track.part, part) ? mode === 'karaoke' ? 0 : 1 : mode === 'karaoke' ? 0.65 : 0.22

  useEffect(() => {
    audios.current.forEach((audio, id) => {
      audio.playbackRate = speed
      audio.preservesPitch = true
      const track = active.find(f => f.id === id)
      audio.volume = track ? volumes[id] ?? defaultVolume(track) : 0
      if (!track) audio.pause()
    })
  }, [speed, mode, activeIds, volumes, part])

  function seek(position: number) {
    const value = Math.max(0, Math.min(position, duration || position))
    audios.current.forEach(audio => {
      if (audio.readyState > 0) audio.currentTime = Math.min(value, Number.isFinite(audio.duration) ? audio.duration : value)
    })
    setTime(value)
    if (selected) publishPlayback({ song: song.id, track: selected.id, time: value, duration })
  }
  useEffect(() => {
    const seekRequest = (event: Event) => {
      const request = (event as CustomEvent<{ song: string; track: string; time: number }>).detail
      if (request.song === song.id && request.track === selected?.id) {
        seek(request.time)
        if (!playingRef.current) void play(request.time)
      }
    }
    window.addEventListener('janko-seek-recording', seekRequest)
    return () => window.removeEventListener('janko-seek-recording', seekRequest)
  }, [song.id, selected?.id, duration, time, busy])

  async function play(start = time) {
    if (busy) return
    if (playingRef.current) { pause(); return }
    const controller = new AbortController(); loadController.current = controller
    setBusy(true); setError('')
    try {
      await Promise.all(active.map(async track => {
        const audio = audios.current.get(track.id)
        if (!audio) throw new Error('Odtwarzacz nie jest gotowy.')
        if (audio.readyState < 2) {
          await new Promise<void>((resolve, reject) => {
            const timer = window.setTimeout(() => done(new Error('Pobieranie trwa zbyt długo. Zapisz utwór offline i spróbuj ponownie.')), 120000)
            const ready = () => done()
            const failed = () => done(new Error(`Nie można pobrać: ${track.name}. Sprawdź dostęp Google lub pamięć offline.`))
            const cancelled = () => done(new Error('Zmieniono nagranie podczas pobierania.'))
            function done(err?: Error) {
              clearTimeout(timer); audio!.removeEventListener('canplay', ready); audio!.removeEventListener('error', failed)
              controller.signal.removeEventListener('abort', cancelled)
              if (err) reject(err); else resolve()
            }
            audio.addEventListener('canplay', ready, { once: true }); audio.addEventListener('error', failed, { once: true })
            controller.signal.addEventListener('abort', cancelled, { once: true })
            audio.load()
          })
        }
        audio.currentTime = start >= duration && duration ? 0 : start
        audio.playbackRate = speed; audio.preservesPitch = true
        audio.volume = volumes[track.id] ?? defaultVolume(track)
      }))
      const master = selected ? audios.current.get(selected.id) : undefined
      if (controller.signal.aborted) return
      if (master && Number.isFinite(master.duration)) setDuration(master.duration)
      claimAudio(active.map(track => audios.current.get(track.id)!))
      await Promise.all(active.map(track => audios.current.get(track.id)!.play()))
      playingRef.current = true; setPlaying(true); onPlayingChange?.(true)
    } catch (err) { if (!controller.signal.aborted) { pause(); setError(errorMessage(err)) } }
    finally { if (!controller.signal.aborted) { loadController.current = null; setBusy(false) } }
  }

  useEffect(() => {
    if (autoPlay && selected && !playingRef.current) void play()
  }, [autoPlay, selected?.id, autoPlayToken])
  useEffect(() => {
    const command = (event: Event) => {
      const detail = (event as CustomEvent<{ songId: string; play: boolean }>).detail
      if (detail.songId !== song.id) return
      if (detail.play) { if (!playingRef.current) void play() }
      else pause()
    }
    window.addEventListener('janko-player-command', command)
    return () => window.removeEventListener('janko-player-command', command)
  }, [song.id, selected?.id, duration, time, busy, onPlayingChange])

  function updateTime(audio: HTMLAudioElement) {
    if (Number.isFinite(audio.duration) && audio.duration !== duration) setDuration(audio.duration)
    const now = audio.currentTime
    if (loop && a !== null && b !== null && b > a && now >= b) { seek(a); return }
    setTime(now)
    if (selected) publishPlayback({ song: song.id, track: selected.id, time: now, duration: audio.duration })
    if (mode !== 'solo' && playingRef.current) {
      active.forEach(track => {
        const other = audios.current.get(track.id)
        if (other && other !== audio && !other.paused && Math.abs(other.currentTime - now) > 0.12) other.currentTime = now
      })
    }
  }

  const heading = <>
    <div className="panel-heading"><span className="eyebrow"><Headphones size={15} /> POSŁUCHAJ. POWTÓRZ. ZAŚPIEWAJ.</span><span className="small-tag">Bez zmiany wysokości</span></div>
    <p className="player-song-label">Aktualnie odtwarzane: <strong>{song.name}</strong></p>
    <h2>Posłuchaj. Powtórz. Zaśpiewaj.</h2>
    {!preferred && <p className="notice">Brak nagrania Twojego głosu. Inny materiał możesz wybrać świadomie z listy; nie wybieramy go automatycznie.</p>}
    <label className="field-label" htmlFor="track">Nagranie</label>
    <select id="track" value={selected?.id} onChange={e => setSelectedId(e.target.value)} disabled={busy}>
      {tracks.map(f => <option key={f.id} value={f.id}>{f.name}{f.section ? ` · ${f.section}` : ''}</option>)}
    </select>
    <div className="now-track"><div className="voice-dot">{selected?.part ?? '♫'}</div><div><strong>{selected?.part ? `Linia ${selected.part}` : 'Nagranie referencyjne'}</strong><small>{selected?.slow ? 'Wersja wolniejsza' : 'Tempo oryginalne'} · {selected?.cached ? 'Zapisane lokalnie' : 'Google Drive'}</small></div></div>
    </>
  const controls = (onSongPage = false) => {
    const pageSong = onSongPage && queue?.pageSong?.id !== song.id ? queue?.pageSong : undefined
    const playLabel = pageSong ? `Odtwórz ${pageSong.name}` : playing ? 'Pauza' : 'Odtwórz'
    return <div className={`player-controls${onSongPage ? ' player-page-controls' : ''}`} aria-label={onSongPage ? 'Sterowanie próbą na stronie utworu' : 'Sterowanie próbą'}>
    <div className="dock-track">{queue ? <button className="text-button" onClick={queue.open}>{song.name}</button> : song.name} · {selected?.part ? `Linia ${selected.part}` : selected?.name ?? 'brak nagrania'} {queue && <small>{queue.label}</small>}</div>
    <div className="transport">
      {queue && <button className="icon-button" aria-label="Poprzedni utwór" disabled={!queue.previous || busy} onClick={() => queue.previous?.(playingRef.current)}><SkipBack size={18}/></button>}
      <button className="icon-button" aria-label="Od początku" onClick={() => seek(loop && a !== null ? a : 0)}><RotateCcw size={20}/></button>
      <button className="play-button" onClick={() => pageSong ? queue?.playPageSong?.() : void play()} disabled={busy || !pageSong && !selected} aria-label={playLabel}>{pageSong ? <Play fill="currentColor" /> : playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button>
      {queue && <button className="icon-button" aria-label="Następny utwór" disabled={!queue.next || busy} onClick={() => queue.next?.(playingRef.current)}><SkipForward size={18}/></button>}
      <div className="timeline"><input aria-label="Pozycja nagrania" type="range" min={0} max={duration || 1} step={0.05} value={Math.min(time, duration || 1)} onChange={e => seek(Number(e.target.value))}/><div><span>{busy ? 'Pobieranie…' : timeLabel(time)}</span><span>{timeLabel(duration)}</span></div></div>
    </div>
    <div className="speed-control"><label htmlFor={`speed-${onSongPage ? 'page' : 'dock'}`}>Tempo ćwiczenia</label><strong>{speed.toFixed(2)}×</strong><input id={`speed-${onSongPage ? 'page' : 'dock'}`} type="range" min={0.5} max={1.25} step={0.05} value={speed} onChange={e => setSpeed(Number(e.target.value))}/><div><span>Wolniej</span><button className="text-button" onClick={() => setSpeed(1)}>Oryginalne</button></div></div>
    <p className="loop-help">A = początek, B = koniec fragmentu do powtarzania. Ustaw je podczas słuchania. Pętla A–B zastępuje powtarzanie całego utworu.</p>
    <div className="loop-controls">
      <Repeat2 size={18}/><button onClick={() => { setA(time); if (b !== null && b <= time) { setB(null); setLoop(false) } }}>A {a !== null ? timeLabel(a) : '—'}</button>
      <button onClick={() => { if (a === null || time <= a + 0.1) setError('Najpierw ustaw A, a następnie B co najmniej 0,1 sekundy później.'); else { setB(time); setError('') } }}>B {b !== null ? timeLabel(b) : '—'}</button>
      <button className={loop ? 'active' : ''} aria-pressed={loop} disabled={a === null || b === null} onClick={() => { setLoop(!loop); if (!loop) { setRepeatSong(false); if (a !== null) seek(a) } }}>{loop ? <Check size={14}/> : null} Pętla</button>
      <button className="text-button" aria-label="Usuń pętlę" onClick={() => { setA(null); setB(null); setLoop(false) }}>×</button>
      <button className={repeatSong ? 'active' : ''} aria-pressed={repeatSong} onClick={() => { setRepeatSong(value => !value); setLoop(false) }}><Repeat2 size={14}/> Cały utwór</button>
    </div>
    </div>}
  const extras = <>
    <div className="mixer">
      <h3><SlidersHorizontal size={17}/> Mikser chóru <span className={`mixer-info${mixerHelp ? ' expanded' : ''}`}><button type="button" className="info-button" aria-label="Jak działa mikser chóru?" aria-describedby={mixerHelpId} aria-expanded={mixerHelp} onClick={() => setMixerHelp(value => !value)} onKeyDown={e => { if (e.key === 'Escape') { setMixerHelp(false); e.currentTarget.blur() } }}><Info size={17}/></button><span className="mixer-tooltip" role="tooltip" id={mixerHelpId}>Mikser łączy osobne, istniejące nagrania partii (np. S, A, B) tego samego utworu. <strong>Z chórem:</strong> Twój głos głośno, pozostałe ciszej — uczysz się swojej partii. <strong>Bez mojego:</strong> Twoja partia wyciszona — śpiewasz ją z pozostałymi głosami jak karaoke. Suwaki ustawiają głośność każdej partii. Nagrania muszą mieć zgodne tempo i moment rozpoczęcia; mikser nie wyrównuje ich automatycznie. Nie wydziela głosów z nagrania całego chóru.</span></span></h3>
      <div className="segmented">{([['solo', 'Mój głos'], ['blend', 'Z chórem'], ['karaoke', 'Bez mojego']] as const).map(([value, label]) => <button key={value} className={mode === value ? 'active' : ''} disabled={busy || value !== 'solo' && (!selected?.part || compatible.length < 2)} onClick={() => { pause(); setMode(value); setVolumes({}) }}>{label}</button>)}</div>
      <p className="muted">{mode === 'solo' ? 'Ćwicz pojedynczą linię melodyczną.' : mode === 'blend' ? 'Twój głos na pierwszym planie, pozostałe w tle.' : 'Zaśpiewaj swoją linię samodzielnie z pozostałymi głosami.'}</p>
      {mode !== 'solo' && active.map(f => <label className="volume-row" key={f.id}><Volume2 size={14}/><span>{f.part}</span><input aria-label={`Głośność ${f.part}`} type="range" min={0} max={1} step={0.01} value={volumes[f.id] ?? defaultVolume(f)} onChange={e => setVolumes({ ...volumes, [f.id]: Number(e.target.value) })}/></label>)}
      {mode !== 'solo' && <small className="muted">Nagrania muszą mieć wspólny początek; korekcja synchronizacji nie wyrównuje różnego wykonania.</small>}
    </div>
    <div className="bookmarks"><h3><BookmarkPlus size={17}/> Miejsca do powtórzenia</h3><div className="bookmark-input"><input aria-label="Nazwa zakładki" placeholder="np. takt 17 — wejście" value={bookmarkLabel} onChange={e => setBookmarkLabel(e.target.value)}/><button aria-label="Dodaj zakładkę" onClick={() => { saveBookmarks([...bookmarks, { time, label: bookmarkLabel.trim() || timeLabel(time) }]); setBookmarkLabel('') }}><BookmarkPlus size={18}/></button></div>
      {bookmarks.length === 0 ? <p className="muted">Zapisz trudny fragment i wróć do niego jednym kliknięciem.</p> : bookmarks.map((mark, index) => <div className="bookmark-row" key={`${mark.time}-${index}`}><button onClick={() => seek(mark.time)}>{mark.label}<small>{timeLabel(mark.time)}</small></button><button aria-label={`Usuń ${mark.label}`} onClick={() => saveBookmarks(bookmarks.filter((_, i) => i !== index))}>×</button></div>)}
    </div>
    </>
  return <section className={`player${detailId === undefined ? ' panel' : ''}`}>
    {detailId === undefined ? <>{heading}{controls()}{extras}</> : <>{detailTarget && createPortal(<section className="panel player-details">{heading}{queue?.pageSong && queue.pageSong.id !== song.id && <p className="notice">Aktywny odtwarzacz jest ustawiony na „{song.name}”. Przycisk Odtwórz {queue.pageSong.name} przełączy nagranie; pozostałe ustawienia poniżej dotyczą aktualnie aktywnego utworu.</p>}{controls(true)}{extras}</section>, detailTarget)}{controls()}</>}
    {error && <p role="alert" className="error">{error}</p>}
    {tracks.map(f => <audio key={f.id} ref={node => { if (node) audios.current.set(f.id, node); else audios.current.delete(f.id) }}
      src={f.url} preload={f.id === selected?.id ? 'metadata' : 'none'}
      onLoadedMetadata={e => { if (f.id === selected?.id) setDuration(e.currentTarget.duration) }}
      onDurationChange={e => { if (f.id === selected?.id && Number.isFinite(e.currentTarget.duration)) setDuration(e.currentTarget.duration) }}
      onTimeUpdate={e => { if (f.id === selected?.id) updateTime(e.currentTarget) }}
      onPause={() => { if (f.id === selected?.id) { playingRef.current = false; setPlaying(false); onPlayingChange?.(false) } }}
      onPlay={() => { if (f.id === selected?.id) { playingRef.current = true; setPlaying(true); onPlayingChange?.(true) } }}
      onEnded={() => { if (f.id === selected?.id) { if (loop && a !== null) {
        seek(a)
        void Promise.all(active.map(track => audios.current.get(track.id)?.play())).catch(err => { pause(); setError(errorMessage(err)) })
      } else if (repeatSong) {
        seek(0)
        void Promise.all(active.map(track => audios.current.get(track.id)?.play())).catch(err => { pause(); setError(errorMessage(err)) })
      } else { pause(); onComplete?.() } } }}
      onError={() => { if (f.id === selected?.id || playingRef.current && active.some(t => t.id === f.id)) { pause(); setError(`Nie można odczytać ${f.name}. Sprawdź połączenie lub zaloguj się do Google tylko do odczytu.`) } }}/>)}
  </section>
}
