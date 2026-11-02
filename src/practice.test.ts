import { describe, expect, it } from 'vitest'
import { missingMaterials, minutes, preferredAudio, practiceHistory, eventPool } from './practice'
import type { Material, Song } from './types'

const audio = (id: string, part: string, slow = false): Material => ({
  id, part, slow, kind: 'audio', name: id, full: false, section: '', cached: false,
  url: '', drive_url: null, event_id: null, song_id: 'song'
})
describe('shared browser and APK practice helpers', () => {
  it('uses event membership and program order, never search or another event', () => {
    const songs = ['a', 'b', 'c'].map((id, i) => ({ id, name: id, files: [], event_ids: [i === 2 ? 'two' : 'one'] }))
    expect(eventPool(songs, 'one', ['c', 'b', 'b'])).toEqual(['b', 'a'])
    expect(eventPool(songs, 'all')).toEqual(['a', 'b', 'c'])
    expect(eventPool(songs, 'missing')).toEqual([])
  })
  it('prefers exact divisi and normal tempo, then the combined voice', () => {
    const song: Song = { id: 'song', name: 'Song', event_ids: [], files: [audio('slow', 'AI', true), audio('shared', 'A'), audio('exact', 'AI')] }
    expect(preferredAudio(song, 'AI')?.id).toBe('exact')
    expect(preferredAudio({ ...song, files: song.files.slice(0, 2) }, 'AI')?.id).toBe('shared')
    expect(preferredAudio({ ...song, files: [audio('choir', 'full'), audio('soprano', 'S')] }, 'B')).toBeUndefined()
  })
  it('reports only known missing material categories, not private sharing assumptions', () => {
    const song: Song = { id: 'song', name: 'Song', event_ids: [], files: [audio('alto', 'A')] }
    expect(missingMaterials(song, 'AI')).toEqual(['nuty', 'wolniejsza wersja', 'nagranie całego chóru'])
    expect(missingMaterials({ ...song, files: [] }, 'B')).toEqual(['brak jakichkolwiek plików'])
  })
  it('formats persisted practice durations', () => {
    expect(minutes(3)).toBe('3 s')
    expect(minutes(120)).toBe('2 min')
    expect(minutes(3660)).toBe('1 h 1 min')
  })
  it('keeps voice-specific daily history and yesterday-based streaks', () => {
    const log = [
      { song: 'song', part: 'B' as const, day: '2026-10-30', seconds: 60 },
      { song: 'song', part: 'B' as const, day: '2026-10-31', seconds: 120 },
      { song: 'song', part: 'AI' as const, day: '2026-11-01', seconds: 300 }
    ]
    const bass = practiceHistory(log, 'B', '2026-11-01')
    expect(bass.todaySeconds).toBe(0)
    expect(bass.streak).toBe(2)
    expect(bass.days).toHaveLength(7)
    expect(practiceHistory(log, 'AI', '2026-11-01').todaySeconds).toBe(300)
  })
})
