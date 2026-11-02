import { useEffect, type RefObject } from 'react'
import { claimAudio } from './playbackClock'
export function useAudioPosition(ref: RefObject<HTMLAudioElement | null>, update: (time: number) => void, source: string) {
  useEffect(() => {
    const audio = ref.current
    if (!audio) return
    let frame = 0
    const tick = () => {
      update(audio.currentTime)
      if (!audio.paused) frame = requestAnimationFrame(tick)
    }
    const play = () => { cancelAnimationFrame(frame); claimAudio([audio]); tick() }
    const stop = () => { cancelAnimationFrame(frame); update(audio.currentTime) }
    const seek = () => { cancelAnimationFrame(frame); tick() }
    audio.addEventListener('play', play); audio.addEventListener('pause', stop); audio.addEventListener('seeked', seek)
    return () => {
      cancelAnimationFrame(frame); audio.removeEventListener('play', play); audio.removeEventListener('pause', stop); audio.removeEventListener('seeked', seek)
      audio.pause()
    }
  }, [ref, update, source])
}
