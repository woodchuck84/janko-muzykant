import { beforeEach, describe, expect, it, vi } from 'vitest'
import { material, normalize, syncLibrary, FOLDER, mergeLibraries } from './library'
import { Drive, ROOT_ID } from './native'

vi.mock('./native', () => ({
  ROOT_ID: 'root-folder', Drive: { verify: vi.fn(), list: vi.fn() }
}))
beforeEach(() => vi.clearAllMocks())
describe('phone Drive library', () => {
  it('preserves divisi, tempo variants and normalized Polish song names', () => {
    const entry = material({ id: 'a', name: 'S II - Łączko zielona wolniej.m4a', mimeType: 'audio/mp4' }, 'song', 'event')
    expect(entry.part).toBe('SII'); expect(entry.slow).toBe(true)
    expect(normalize('1. Łączko zielona - chór')).toBe('laczko zielona')
  })
  it('reads seasons/events/songs and nested page sections using only the authorized native bridge', async () => {
    const folder = (id: string, name: string) => ({ id, name, mimeType: FOLDER })
    const tree = {
      [ROOT_ID]: [folder('season', '2026_2027')],
      season: [folder('event', 'Koncert')],
      event: [folder('song-folder', 'Piechota')],
      'song-folder': [folder('page', 'Druga strona')],
      page: [{ id: 'audio', name: 'B - Piechota.m4a', mimeType: 'audio/mp4' }]
    }
    vi.mocked(Drive.list).mockImplementation(async ({ folderId }) => ({ files: tree[folderId as keyof typeof tree] ?? [] }))
    const library = await syncLibrary(null, () => {})
    expect(Drive.verify).toHaveBeenCalledOnce()
    expect(library.events[0].id).toBe('event')
    expect(library.songs[0].files[0].section).toBe('Druga strona')
    expect(library.songs[0].files[0].part).toBe('B')
  })
  it('never replaces an existing library with anonymous access after denial', async () => {
    vi.mocked(Drive.verify).mockRejectedValueOnce(new Error('ACCESS_DENIED'))
    await expect(syncLibrary(null, () => {})).rejects.toThrow('ACCESS_DENIED')
    expect(Drive.list).not.toHaveBeenCalled()
  })
  it('continues public sync with explicit unavailable-folder notes', async () => {
    vi.mocked(Drive.verify).mockResolvedValueOnce({ account: { id: 'anonymous-choir', email: '', lastVerified: 0, anonymous: true } })
    vi.mocked(Drive.list).mockImplementation(async ({ folderId }) => {
      if (folderId === ROOT_ID) return { files: [{ id: 'event', name: 'Koncert', mimeType: FOLDER }] }
      if (folderId === 'event') return { files: [{ id: 'song', name: 'Niedostępna pieśń', mimeType: FOLDER }] }
      throw Object.assign(new Error('Requires sign-in'), { code: 'SIGN_IN_REQUIRED' })
    })
    const library = await syncLibrary(null, () => {})
    expect(library.songs).toHaveLength(1)
    expect(library.unavailable?.[0].name).toContain('Niedostępna pieśń')
    expect(library.unavailable?.[0].reason).toContain('Nie można odczytać publicznie')
  })
  it('merges public and account-visible metadata without duplicating or exposing guest cache paths', () => {
    const file = { ...material({ id: 'pdf', name: 'Nuty.pdf', mimeType: 'application/pdf' }, 'song', 'event'), cached: true, url: 'guest-private' }
    const library = { events: [{ id: 'event', name: 'Koncert' }], songs: [{ id: 'song', name: 'Pieśń', event_ids: ['event'], files: [file] }], other: [], last_sync: null }
    const merged = mergeLibraries(library, null)
    expect(merged.songs[0].files[0].cached).toBe(false)
    expect(merged.songs[0].files[0].url).toBe('')
    const personal = { ...library, songs: [{ ...library.songs[0], files: [{ ...file, url: 'account-private' }] }] }
    const full = mergeLibraries(library, personal)
    expect(full.events).toHaveLength(1)
    expect(full.songs[0].files).toHaveLength(1)
    expect(full.songs[0].files[0].url).toBe('account-private')
  })
})
