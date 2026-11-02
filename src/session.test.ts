import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { personalKey, setSession } from './session'

afterEach(() => {
  setSession({ hosted: false, user_id: 'local', email: null, admin: true, csrf: null })
  vi.unstubAllGlobals()
})
describe('hosted account boundary', () => {
  it('keeps local keys unchanged and separates each choir account', () => {
    expect(personalKey('janko.part')).toBe('janko.part')
    setSession({ hosted: true, user_id: 'alice', email: 'alice@example.com', admin: false, csrf: 'alice-csrf' })
    expect(personalKey('janko.part')).toBe('account.alice.janko.part')
    setSession({ hosted: true, user_id: 'bob', email: 'bob@example.com', admin: false, csrf: 'bob-csrf' })
    expect(personalKey('janko.part')).toBe('account.bob.janko.part')
    expect(personalKey('janko-recordings')).toBe('account.bob.janko-recordings')
  })
  it('sends CSRF on mutations including multipart but never on reads', async () => {
    setSession({ hosted: true, user_id: 'alice', email: 'alice@example.com', admin: false, csrf: 'alice-csrf' })
    const fetch = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetch)
    await api('/api/library')
    expect((fetch.mock.calls[0][1].headers as Headers).has('X-CSRF-Token')).toBe(false)
    fetch.mockResolvedValue(new Response('{}'))
    await api('/api/songs/a/musicxml', { method: 'POST', body: new FormData() })
    const headers = fetch.mock.calls[1][1].headers as Headers
    expect(headers.get('X-CSRF-Token')).toBe('alice-csrf')
    expect(headers.has('Content-Type')).toBe(false)
  })
  it('explains a proxy timeout without claiming analysis succeeded', async () => {
    setSession({ hosted: true, user_id: 'alice', email: 'alice@example.com', admin: false, csrf: 'alice-csrf' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Cloudflare timeout</html>', { status: 524 })))
    await expect(api('/api/songs/a/analyze', { method: 'POST' })).rejects.toThrow('OMR dużego PDF')
  })
})
