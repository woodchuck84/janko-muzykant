import { isMyPart } from './api'
import { PART_LABELS, type Material, type Part, type Song } from './types'

export function preferredAudio(song: Song, part: Part): Material | undefined {
  const audio = song.files.filter(f => f.kind === 'audio')
  return audio.find(f => f.part === part && !f.slow) ?? audio.find(f => isMyPart(f.part, part) && !f.slow) ??
    audio.find(f => f.part === part) ?? audio.find(f => isMyPart(f.part, part))
}
export function eventPool(songs: Song[], event: string, order: string[] = []) {
  const available = songs.filter(song => !event || event === 'all' || song.event_ids.includes(event))
  return [...new Set([...order.filter(id => available.some(song => song.id === id)), ...available.map(song => song.id)])]
}

export function missingMaterials(song: Song, part: Part) {
  if (!song.files.length) return ['brak jakichkolwiek plików']
  const missing: string[] = []
  if (!song.files.some(f => f.kind === 'audio' && isMyPart(f.part, part))) missing.push(`nagranie: ${PART_LABELS[part]}`)
  if (!song.files.some(f => f.kind === 'pdf' || f.kind === 'musicxml')) missing.push('nuty')
  if (!song.files.some(f => f.kind === 'audio' && f.slow && isMyPart(f.part, part))) missing.push('wolniejsza wersja')
  if (!song.files.some(f => f.kind === 'audio' && f.full)) missing.push('nagranie całego chóru')
  return missing
}

export function minutes(seconds: number) {
  if (seconds < 60) return `${seconds} s`
  const h = Math.floor(seconds / 3600), m = Math.round((seconds % 3600) / 60)
  return h ? `${h} h ${m} min` : `${m} min`
}

export interface PracticeEntry { song: string; part: Part; day: string; seconds: number }
export function practiceDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function practiceHistory(entries: PracticeEntry[], part: Part, today = practiceDay()) {
  const totals = new Map<string, number>()
  for (const entry of entries.filter(entry => entry.part === part)) totals.set(entry.day, (totals.get(entry.day) ?? 0) + entry.seconds)
  const date = new Date(`${today}T12:00:00`)
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(date); day.setDate(day.getDate() - 6 + index)
    const key = practiceDay(day)
    return { day: key, seconds: totals.get(key) ?? 0 }
  })
  let streak = 0
  if (!totals.get(today)) date.setDate(date.getDate() - 1)
  while ((totals.get(practiceDay(date)) ?? 0) > 0) { streak++; date.setDate(date.getDate() - 1) }
  return { todaySeconds: totals.get(today) ?? 0, streak, days }
}
