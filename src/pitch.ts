import type { NoteEvent } from './types'

export interface Pitch { hz: number; midi: number; confidence: number; rms: number }
export function midiFrequency(midi: number) { return 440 * 2 ** ((midi - 69) / 12) }
export function pitchName(midi: number) {
  const rounded = Math.round(midi)
  return `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][((rounded % 12) + 12) % 12]}${Math.floor(rounded / 12) - 1}`
}

/** YIN difference/normalization suppresses octave errors from stronger harmonics. */
export function detectPitch(samples: Float32Array, sampleRate: number): Pitch | null {
  if (sampleRate <= 0 || samples.length < 1024) return null
  let sum = 0, mean = 0
  for (const value of samples) { sum += value * value; mean += value }
  const rms = Math.sqrt(sum / samples.length)
  if (rms < 0.008) return null
  mean /= samples.length
  const maxLag = Math.min(Math.floor(sampleRate / 65), Math.floor(samples.length / 2) - 1)
  const minLag = Math.max(2, Math.floor(sampleRate / 1200))
  const difference = new Float64Array(maxLag + 1)
  const size = samples.length - maxLag
  let running = 0
  for (let lag = 1; lag <= maxLag; lag++) {
    let distance = 0
    for (let i = 0; i < size; i++) {
      const delta = (samples[i] - mean) - (samples[i + lag] - mean)
      distance += delta * delta
    }
    running += distance
    difference[lag] = running ? distance * lag / running : 1
  }
  let selected = -1
  for (let lag = minLag; lag < maxLag; lag++) {
    if (difference[lag] < 0.15) {
      while (lag + 1 <= maxLag && difference[lag + 1] < difference[lag]) lag++
      selected = lag; break
    }
  }
  if (selected < 0 || 1 - difference[selected] < 0.85) return null
  const previous = difference[Math.max(1, selected - 1)]
  const center = difference[selected]
  const next = difference[Math.min(maxLag, selected + 1)]
  const divisor = 2 * (2 * center - next - previous)
  const refined = selected + (divisor ? (next - previous) / divisor : 0)
  const hz = sampleRate / refined
  if (hz < 65 || hz > 1200) return null
  return { hz, midi: 69 + 12 * Math.log2(hz / 440), confidence: 1 - center, rms }
}

export function targetAt(notes: NoteEvent[], time: number): NoteEvent | undefined {
  return notes.findLast(n => n.time <= time && time < n.time + n.duration)
}
export function centsFrom(midi: number, targetMidi: number) { return (midi - targetMidi) * 100 }
export function intervalPairs(notes: NoteEvent[]) {
  return notes.slice(1).flatMap((note, index) => {
    const previous = notes[index]
    const distance = Math.abs(note.midi - previous.midi)
    return distance > 0 && distance <= 12 ? [{ first: previous.midi, second: note.midi, interval: distance }] : []
  })
}
export function phraseBounds(notes: NoteEvent[], fromBar: number, toBar: number, duration: number) {
  const starts = notes.filter(n => n.bar === fromBar)
  if (!starts.length || toBar < fromBar) throw new Error('Brak nut w wybranym początku frazy.')
  const start = starts[0].time
  const next = notes.find(n => n.time > start && (n.bar > toBar || n.bar < fromBar))
  const phrase = notes.filter(n => n.time >= start && (!next || n.time < next.time) && n.bar >= fromBar && n.bar <= toBar)
  const last = phrase.at(-1)
  if (!last) throw new Error('Wybrana fraza jest pusta.')
  return { start, end: Math.min(duration, next?.time ?? last.time + last.duration) }
}
export function maskedLyric(text: string, mode: 'full' | 'initials' | 'hidden') {
  return mode === 'full' ? text : mode === 'initials' ? `${text.charAt(0)}…` : '•••'
}
