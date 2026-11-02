import { describe, expect, it } from 'vitest'
import { centsFrom, detectPitch, intervalPairs, maskedLyric, midiFrequency, phraseBounds, pitchName, targetAt } from './pitch'
import type { NoteEvent } from './types'

function signal(hz: number, amplitude = 0.2, harmonic = false) {
  return Float32Array.from({ length: 4096 }, (_, i) =>
    amplitude * Math.sin(2 * Math.PI * hz * i / 48000) + (harmonic ? amplitude * 1.2 * Math.sin(4 * Math.PI * hz * i / 48000) : 0))
}
const notes: NoteEvent[] = [
  { time: 1, duration: 1, midi: 60, pitch: 'C4', bar: 1, beat: 1, lyric: 'la' },
  { time: 3, duration: 1, midi: 64, pitch: 'E4', bar: 2, beat: 1, lyric: 'te' },
  { time: 5, duration: 1, midi: 67, pitch: 'G4', bar: 3, beat: 1, lyric: 'la' }
]
describe('microphone pitch measurement', () => {
  it.each([82.41, 130.81, 220, 440, 880])('detects %s Hz within 10 cents', hz => {
    const result = detectPitch(signal(hz), 48000)
    expect(result).not.toBeNull()
    expect(Math.abs(1200 * Math.log2(result!.hz / hz))).toBeLessThan(10)
  })
  it('rejects silence and quiet noise', () => {
    expect(detectPitch(new Float32Array(4096), 48000)).toBeNull()
    expect(detectPitch(signal(440, 0.001), 48000)).toBeNull()
    const noise = Float32Array.from({ length: 4096 }, (_, i) => ((Math.sin(i * 12.9898) * 43758.5453) % 1) * 0.2)
    expect(detectPitch(noise, 48000)).toBeNull()
  })
  it('tracks fundamental when second harmonic is louder', () => {
    expect(Math.abs(detectPitch(signal(220, 0.15, true), 48000)!.midi - 57)).toBeLessThan(0.1)
  })
})
describe('coaching helpers', () => {
  it('uses actual timed target notes and rests', () => {
    expect(targetAt(notes, 0)).toBeUndefined()
    expect(targetAt(notes, 1.5)?.midi).toBe(60)
    expect(targetAt(notes, 2)).toBeUndefined()
    expect(centsFrom(60.25, 60)).toBe(25)
  })
  it('provides explicit phrase bounds and lyric masking', () => {
    expect(phraseBounds(notes, 1, 2, 6)).toEqual({ start: 1, end: 5 })
    expect(() => phraseBounds(notes, 4, 5, 6)).toThrow()
    expect(maskedLyric('Gaude', 'initials')).toBe('G…')
    expect(maskedLyric('Gaude', 'hidden')).toBe('•••')
    expect(intervalPairs(notes).map(p => p.interval)).toEqual([4, 3])
    expect(phraseBounds([...notes, ...notes.map(n => ({ ...n, time: n.time + 6 }))], 1, 2, 12)).toEqual({ start: 1, end: 5 })
    expect(midiFrequency(69)).toBe(440)
    expect(pitchName(60)).toBe('C4')
  })
})
