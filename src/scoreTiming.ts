import type { NoteEvent } from './types'
export interface SyncAnchor { score: number; audio: number }
export function calibration(first: SyncAnchor, second: SyncAnchor) {
  if (![first.score, first.audio, second.score, second.audio].every(Number.isFinite) ||
      second.score <= first.score || second.audio <= first.audio) throw new Error('Drugi punkt musi być późniejszy w nutach i nagraniu.')
  const rate = (second.audio - first.audio) / (second.score - first.score)
  if (rate < 0.25 || rate > 4) throw new Error('Punkty dają niewiarygodne tempo. Sprawdź takt i czas obu punktów.')
  return { rate, offset: first.audio - first.score * rate,
    scoreTime: (audio: number) => (audio - first.audio) / rate + first.score,
    audioTime: (score: number) => first.audio + (score - first.score) * rate }
}
export function soundingNote(notes: NoteEvent[], time: number) {
  return notes.findLast(note => note.time <= time + 0.001 && note.time + note.duration > time + 0.001)
}
