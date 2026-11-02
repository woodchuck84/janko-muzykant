import { useSyncExternalStore } from 'react'
export interface PlaybackClock { song: string; track: string; time: number; duration: number }
let clock: PlaybackClock = { song: '', track: '', time: 0, duration: 0 }
const listeners = new Set<() => void>()
export function publishPlayback(value: PlaybackClock) { clock = value; listeners.forEach(listener => listener()) }
export function usePlaybackClock() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => clock)
}
export function seekRecording(song: string, track: string, time: number) {
  window.dispatchEvent(new CustomEvent('janko-seek-recording', { detail: { song, track, time } }))
}
export function claimAudio(elements: HTMLAudioElement[]) {
  document.querySelectorAll<HTMLAudioElement>('audio').forEach(audio => { if (!elements.includes(audio)) audio.pause() })
}
export async function playAudio(audio: HTMLAudioElement) {
  try { await audio.play() }
  catch (error) {
    // Pausing immediately after a score seek can cancel the pending play promise.
    if (error instanceof DOMException && error.name === 'AbortError' && audio.paused) return
    throw error
  }
}
