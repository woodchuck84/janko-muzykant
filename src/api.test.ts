import { describe, expect, it } from 'vitest'
import { isMyPart, timeLabel } from './api'

describe('practice helpers', () => {
  it('uses base voices but never the sibling divisi', () => {
    expect(isMyPart('S', 'SI')).toBe(true)
    expect(isMyPart('SI', 'SI')).toBe(true)
    expect(isMyPart('SII', 'SI')).toBe(false)
    expect(isMyPart('AII', 'AI')).toBe(false)
    expect(isMyPart('A', 'AII')).toBe(true)
    expect(isMyPart(null, 'B')).toBe(false)
  })
  it('formats playback times', () => {
    expect(timeLabel(125.9)).toBe('2:05')
    expect(timeLabel(Infinity)).toBe('0:00')
  })
})
