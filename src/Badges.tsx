import { Check, CloudDownload, FileMusic, Headphones, Music2, Turtle } from 'lucide-react'
import { isMyPart } from './api'
import type { Material, Part, Song } from './types'

export default function Badges({ song, part }: { song: Song; part: Part }) {
  const has = (kind: Material['kind']) => song.files.some(f => f.kind === kind)
  const mine = song.files.some(f => f.kind === 'audio' && isMyPart(f.part, part))
  return <div className="badges">
    {has('pdf') && <span><FileMusic size={13}/> Nuty</span>}
    {mine && <span className="my-badge"><Headphones size={13}/> Mój głos</span>}
    {song.files.some(f => f.slow && isMyPart(f.part, part)) && <span><Turtle size={13}/> Wolniej</span>}
    {song.files.some(f => f.full) && <span><Music2 size={13}/> Cały chór</span>}
    {has('musicxml') && <span className="my-badge"><Check size={13}/> MusicXML</span>}
    {song.files.length > 0 && song.files.every(f => f.cached) && <span><CloudDownload size={13}/> Lokalnie</span>}
    {!song.files.length && <span className="missing-badge">Brak dostępnych plików</span>}
  </div>
}
