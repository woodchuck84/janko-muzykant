import { describe, expect, it } from 'vitest'
import { calibration, soundingNote } from './scoreTiming'
describe('score/audio timing', () => {
  it('maps both anchors and inverse seeking without claiming tempo tracking', () => {
    const mapping = calibration({ score: 10, audio: 14 }, { score: 30, audio: 38 })
    expect(mapping.rate).toBeCloseTo(1.2)
    expect(mapping.audioTime(20)).toBeCloseTo(26)
    expect(mapping.scoreTime(26)).toBeCloseTo(20)
  })
  it('rejects reversed, duplicate and impossible anchors', () => {
    expect(() => calibration({ score: 1, audio: 1 }, { score: 1, audio: 5 })).toThrow()
    expect(() => calibration({ score: 1, audio: 5 }, { score: 4, audio: 2 })).toThrow()
    expect(() => calibration({ score: 1, audio: 1 }, { score: 4, audio: 30 })).toThrow()
  })
  it('does not highlight a held note through a rest', () => {
    const notes = [{ time: 1, duration: 1, midi: 60, pitch: 'C4', bar: 1, beat: 1, lyric: '' }]
    expect(soundingNote(notes, 1.5)).toBe(notes[0])
    expect(soundingNote(notes, 2.5)).toBeUndefined()
  })
})
