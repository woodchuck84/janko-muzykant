export interface CalendarDate { date: string; excerpt: string; page: number }

export function calendarDates(text: string, page: number): CalendarDate[] {
  const found: { index: number; date: string }[] = []
  function add(index: number, year: number, month: number, day: number) {
    const value = new Date(Date.UTC(year, month - 1, day))
    if (year < 2000 || year > 2100 || value.getUTCFullYear() !== year ||
        value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) return
    found.push({ index, date: value.toISOString().slice(0, 10) })
  }
  for (const match of text.matchAll(/\b(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4}|\d{2})\b/g)) {
    const year = Number(match[3])
    add(match.index, year < 100 ? 2000 + year : year, Number(match[2]), Number(match[1]))
  }
  for (const match of text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) {
    add(match.index, Number(match[1]), Number(match[2]), Number(match[3]))
  }
  return found.sort((a, b) => a.index - b.index).map(item => ({
    date: item.date, page,
    excerpt: text.slice(Math.max(0, item.index - 70), item.index + 150).replace(/\s+/g, ' ').trim()
  }))
}
