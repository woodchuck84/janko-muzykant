import { useEffect, useRef, useState } from 'react'
import Player from './Player'
import { preferredAudio } from './practice'
import { errorMessage } from './api'
import { PART_LABELS, type Part, type Song } from './types'
import './playback.css'

export interface PlaybackRequest { id: string; play: boolean; revision: number }
export default function QueuePlayer({ songs, pool, part, request, prepare, detailId, detailSongId, onOpenSong, onCurrent, onPlayingChange }: {
  songs: Song[]; pool: string[]; part: Part; request: PlaybackRequest | null
  prepare?: (song: Song, part: Part) => Promise<Song>; detailId: string | null; detailSongId?: string | null
  onOpenSong: (id: string) => void; onCurrent?: (id: string) => void; onPlayingChange?: (id: string, playing: boolean) => void
}) {
  const [current, setCurrent] = useState<Song | null>(null)
  const [autoplay, setAutoplay] = useState(false)
  const [playToken, setPlayToken] = useState(0)
  const [error, setError] = useState(''), [loading, setLoading] = useState(false)
  const revision = useRef(0)
  const selectedSong = useRef<string | null>(null)
  const previousPart = useRef(part)
  const latest = useRef({ songs, prepare, part }); latest.current = { songs, prepare, part }
  async function select(id: string, play: boolean) {
    const version = ++revision.current
    const snapshot = latest.current
    const song = snapshot.songs.find(item => item.id === id)
    setError('')
    if (!song) { setLoading(false); setError('Utwór nie jest już dostępny w bibliotece.'); return }
    selectedSong.current = id
    const file = preferredAudio(song, snapshot.part)
    if (!file) {
      setLoading(false)
      setAutoplay(false)
      setCurrent({ ...song, files: [] }); onCurrent?.(id)
      setError(`„${song.name}”: brak nagrania ${PART_LABELS[snapshot.part]}. Nie podstawiamy innej partii ani nagrania chóru. Wybierz następny utwór lub wygeneruj tę linię.`)
      return
    }
    setLoading(true); setAutoplay(false)
    setCurrent(null)
    try {
      const prepared = snapshot.prepare ? await snapshot.prepare(song, snapshot.part) : song
      if (version !== revision.current) return
      setCurrent(prepared); setAutoplay(play); setPlayToken(value => value + 1); onCurrent?.(id)
    } catch (err) {
      if (version !== revision.current) return
      setCurrent({ ...song, files: [] }); onCurrent?.(id)
      setError(`Nie można przygotować „${song.name}”: ${errorMessage(err)}`)
    } finally { if (version === revision.current) setLoading(false) }
  }
  useEffect(() => {
    if (request) void select(request.id, request.play)
    return () => { revision.current++ }
  }, [request?.revision])
  useEffect(() => {
    if (previousPart.current === part) return
    previousPart.current = part
    if (selectedSong.current) void select(selectedSong.current, false)
  }, [part])
  useEffect(() => {
    if (!current || loading) return
    const updated = songs.find(song => song.id === current.id)
    if (updated) setCurrent(prepare ? { ...updated, files: updated.files.filter(file => file.cached) } : updated)
  }, [songs])
  const index = current ? pool.indexOf(current.id) : -1
  const detailSong = detailSongId ? songs.find(song => song.id === detailSongId) : undefined
  function move(offset: number, play: boolean) {
    const next = index + offset
    if (index < 0 || next < 0 || next >= pool.length) return
    void select(pool[next], play)
  }
  if (!current && !loading && !error) return null
  return <div className="persistent-player">
    {loading && <p role="status" className="notice">Przygotowanie nagrania…</p>}
    {error && <p role="alert" className="error queue-error">{error}</p>}
    {current && <Player key={current.id} song={current} part={part} autoPlay={autoplay} autoPlayToken={playToken}
      detailId={detailId} onComplete={() => move(1, true)} onPlayingChange={playing => onPlayingChange?.(current.id, playing)}
      queue={{ previous: index > 0 ? playing => move(-1, playing) : undefined,
        next: index >= 0 && index < pool.length - 1 ? playing => move(1, playing) : undefined,
        label: index < 0 ? 'Utwór poza wybraną pulą' : `${index + 1} / ${pool.length}`,
        open: () => onOpenSong(current.id), pageSong: detailSong,
        playPageSong: detailSong ? () => { void select(detailSong.id, true) } : undefined }}/> }
  </div>
}
