import { describe, expect, it } from 'vitest'
import { calendarDates } from './calendar'

describe('on-device calendar text extraction', () => {
  it('extracts numeric choir calendar dates with source context, without inferring year from title', () => {
    const dates = calendarDates('Kalendarz 2026_2027. Koncert: 20.09.25 oraz Msza: 18.10.25 (niedziela)', 2)
    expect(dates.map(date => date.date)).toEqual(['2025-09-20', '2025-10-18'])
    expect(dates[0].page).toBe(2)
    expect(dates[0].excerpt).toContain('Koncert')
  })
  it('checks real month lengths and ignores incomplete dates or times', () => {
    expect(calendarDates('29.02.2024 29.02.2025 31.04.2026 12.00 8.11 1 maja', 1).map(date => date.date)).toEqual(['2024-02-29'])
  })
  it('supports ISO and spaced PDF text without duplicate ISO matches', () => {
    expect(calendarDates('2026-11-08, 08 . 11 . 26', 1).map(date => date.date)).toEqual(['2026-11-08', '2026-11-08'])
  })
})
