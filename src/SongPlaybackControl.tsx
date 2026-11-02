import { Pause, Play } from 'lucide-react'

export default function SongPlaybackControl({ songId, songName, activeSongId, playing, onStart }: {
  songId: string; songName: string; activeSongId: string; playing: boolean; onStart: () => void
}) {
  const active = songId === activeSongId
  const label = active && playing ? `Pauza ${songName}` : `Odtwórz ${songName}`
  return <button className="primary song-playback-button" aria-label={label} onClick={() => {
    if (!active) onStart()
    else window.dispatchEvent(new CustomEvent('janko-player-command', { detail: { songId, play: !playing } }))
  }}>
    {active && playing ? <Pause size={18} fill="currentColor"/> : <Play size={18} fill="currentColor"/>}
    {active && playing ? 'Pauza' : active ? 'Wznów' : 'Odtwórz utwór'}
  </button>
}
