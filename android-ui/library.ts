import type { Library, Material, Song } from '../src/types'
import { Drive, ROOT_ID, type Entry } from './native'

export const FOLDER = 'application/vnd.google-apps.folder'
export interface PhoneLibrary extends Library {
  unavailable?: { id: string; name: string; reason: string }[]
}
export function mergeLibraries(publicLibrary: Library, personal: Library | null): PhoneLibrary {
  const songs = new Map<string, Song>()
  // Do not reuse guest file URLs/private caches in another account.
  for (const source of [publicLibrary, personal]) {
    for (const song of source?.songs ?? []) {
      const existing = songs.get(song.id)
      const files = song.files.map(file => source === publicLibrary ? { ...file, cached: false, url: '' } : file)
      songs.set(song.id, existing ? { ...song, event_ids: [...new Set([...existing.event_ids, ...song.event_ids])],
        files: [...new Map([...existing.files, ...files].map(file => [file.id, file])).values()] } : { ...song, files })
    }
  }
  return {
    events: [...new Map([...publicLibrary.events, ...(personal?.events ?? [])].map(event => [event.id, event])).values()],
    songs: [...songs.values()],
    other: [...new Map([...publicLibrary.other.map(file => ({ ...file, cached: false, url: '' })), ...(personal?.other ?? [])].map(file => [file.id, file])).values()],
    unavailable: (personal as PhoneLibrary | null)?.unavailable ?? [],
    last_sync: personal?.last_sync ?? publicLibrary.last_sync,
  }
}
const AUDIO = /\.(m4a|mp3|wav|ogg|flac|aac)$/i
export function normalize(name: string) {
  return name.toLowerCase().replace(/ł/g, 'l').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/^\s*\d+[.)]\s*/, '').replace(/\s*[-–]\s*chor\s*$/, '').replace(/[^a-z0-9]+/g, ' ').trim()
}
export function material(entry: Entry, song: string | null, event: string | null, section = ''): Material {
  const prefix = entry.name.match(/^\s*(S\s*II|S\s*I|A\s*II|A\s*I|S|A|B)\s*[-–_]/i)
  return { id: entry.id, song_id: song, event_id: event, name: entry.name,
    kind: AUDIO.test(entry.name) ? 'audio' : /\.pdf$/i.test(entry.name) ? 'pdf' :
      /\.(musicxml|xml|mxl)$/i.test(entry.name) ? 'musicxml' : 'document',
    part: prefix ? prefix[1].replace(/\s/g, '').toUpperCase() : null,
    slow: /\b(wolniej|slow)\b/i.test(entry.name), full: /^K[_ -]/i.test(entry.name),
    section, cached: false, url: '', drive_url: `https://drive.google.com/file/d/${entry.id}/view` }
}
export async function syncLibrary(previous: Library | null, progress: (text: string) => void): Promise<PhoneLibrary> {
  const session = await Drive.verify()
  const anonymous = session?.account.anonymous === true
  const unavailable: NonNullable<PhoneLibrary['unavailable']> = []
  const songs = new Map<string, Song>()
  const events: Library['events'] = []
  const other: Material[] = []
  const cached = new Map(previous?.songs.flatMap(song => song.files).concat(previous.other).map(file => [file.id, file]) ?? [])
  const visited = new Set<string>()
  async function list(id: string, name = id) {
    if (visited.has(id)) return []
    if (visited.size > 1000) throw new Error('Zbyt wiele folderów (limit 1000).')
    visited.add(id)
    try {
      const files = (await Drive.list({ folderId: id })).files
      if (anonymous && files.length === 0) unavailable.push({ id, name,
        reason: 'Folder pusty albo Google nie pokazuje zawartości publicznie. Logowanie może udostępnić więcej, ale nie nadaje uprawnień.' })
      return files
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      if (id !== ROOT_ID && ['SIGN_IN_REQUIRED', 'PUBLIC_UNAVAILABLE', 'ACCESS_DENIED'].includes(code)) {
        unavailable.push({ id, name, reason: 'Nie można odczytać publicznie. Spróbuj opcjonalnego logowania kontem, które już ma dostęp.' })
        if (!anonymous) unavailable[unavailable.length - 1].reason = 'Ten folder nie jest dostępny temu kontu Google. Logowanie nie nadaje uprawnień.'
        return []
      }
      throw error
    }
  }
  function add(entry: Entry, song: Song | null, event: string | null, section: string) {
    const parsed = material(entry, song?.id ?? null, event, section)
    const old = cached.get(entry.id)
    const file = old?.cached ? { ...parsed, url: old.url, cached: true } : parsed
    if (song) { if (!song.files.some(item => item.id === file.id)) song.files.push(file) }
    else other.push(file)
  }
  async function materials(folder: Entry, song: Song, event: string, section = '', depth = 0) {
    if (depth > 8) throw new Error('Przekroczono głębokość folderów partytury.')
    progress(`Odczyt: ${song.name}${section ? ' · ' + section : ''}`)
    for (const entry of await list(folder.id, `${song.name} · ${section || folder.name}`)) {
      if (entry.mimeType === FOLDER) await materials(entry, song, event, [section, entry.name].filter(Boolean).join(' / '), depth + 1)
      else add(entry, song, event, section)
    }
  }
  async function event(folder: Entry) {
    events.push({ id: folder.id, name: folder.name })
    for (const entry of await list(folder.id, folder.name)) {
      if (entry.mimeType !== FOLDER) { add(entry, null, folder.id, ''); continue }
      const key = normalize(entry.name)
      const song = songs.get(key) ?? { id: key, name: entry.name, files: [], event_ids: [] }
      if (!song.event_ids.includes(folder.id)) song.event_ids.push(folder.id)
      songs.set(key, song)
      await materials(entry, song, folder.id)
    }
  }
  for (const root of await list(ROOT_ID)) {
    if (root.mimeType !== FOLDER) { add(root, null, null, ''); continue }
    // The choir root contains seasons, whose children are events.
    const children = await list(root.id, root.name)
    const season = /20\d\d|sezon/i.test(root.name)
    if (season) {
      for (const child of children) {
        if (child.mimeType === FOLDER) await event(child)
        else add(child, null, null, root.name)
      }
    } else {
      // Reuse the already read folder without issuing another read.
      visited.delete(root.id)
      await event(root)
    }
  }
  return { events, songs: [...songs.values()].sort((a, b) => a.name.localeCompare(b.name, 'pl')), other,
    unavailable, last_sync: new Date().toISOString() }
}
