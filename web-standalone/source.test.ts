import { describe, expect, it, vi } from 'vitest'
import { PublicDriveSource, ROOT, limitedBlob } from './source'
const folder = 'child-folder-123', file = 'audio-file-123', F = 'application/vnd.google-apps.folder'
const mock = () => vi.fn<typeof fetch>(async input => {
  const url = new URL(String(input))
  if (url.pathname.endsWith(`/${file}`)) return new Response('audio', { headers: { 'content-type': 'audio/mp4' } })
  const child = url.searchParams.get('q')?.includes(folder)
  return Response.json({ files: child ? [{ id: file, name: 'B - Piechota.m4a', mimeType: 'audio/mp4' }] :
    [{ id: folder, name: 'Koncert', mimeType: F }] })
})
describe('official public Drive API source', () => {
  it('uses GET-only key-based requests and verifies nested ancestry before media', async () => {
    const fetcher = mock(), source = new PublicDriveSource('fixture-key', '', fetcher)
    expect(await (await source.request('download', file, [ROOT, folder])).text()).toBe('audio')
    for (const [url, options] of fetcher.mock.calls) {
      expect(new URL(String(url)).hostname).toBe('www.googleapis.com')
      expect(new URL(String(url)).searchParams.get('key')).toBe('fixture-key')
      expect(options?.method).toBe('GET'); expect(options?.credentials).toBe('omit')
    }
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
  it('follows pages including an empty first page with a next token', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ files: [], nextPageToken: 'next' }))
      .mockResolvedValueOnce(Response.json({ files: [{ id: folder, name: 'Koncert', mimeType: F }] }))
    const source = new PublicDriveSource('fixture-key', '', fetcher)
    expect((await (await source.request('list', ROOT, [])).json()).files).toHaveLength(1)
    expect(new URL(String(fetcher.mock.calls[1][0])).searchParams.get('pageToken')).toBe('next')
  })
  it('rejects unknown IDs, forged parents, nonfolders and invalid paths', async () => {
    for (const [op, id, path] of [
      ['download', file, []], ['download', 'foreign-file123', [ROOT]],
      ['download', file, [ROOT, 'foreign-folder123']], ['list', file, [ROOT, folder]],
      ['list', ROOT, [ROOT]], ['download', file, [ROOT, ROOT]], ['write', file, [ROOT, folder]],
    ] as [string, string, string[]][]) {
      await expect(new PublicDriveSource('fixture-key', '', mock()).request(op, id, path)).rejects.toThrow()
    }
  })
  it('handles quota, permission/resource-key restrictions and missing configuration explicitly', async () => {
    for (const [status, code] of [[403, 'PUBLIC_UNAVAILABLE'], [404, 'PUBLIC_UNAVAILABLE'], [429, 'RATE_LIMITED'], [500, 'SERVICE_UNAVAILABLE']] as const) {
      await expect(new PublicDriveSource('fixture-key', '', async () => new Response('', { status })).request('list', ROOT, []))
        .rejects.toMatchObject({ code })
    }
    await expect(new PublicDriveSource('', '', mock()).request('list', ROOT, [])).rejects.toMatchObject({ code: 'SOURCE_NOT_CONFIGURED' })
  })
  it('rejects oversized declared and streamed media', async () => {
    await expect(limitedBlob(new Response('tiny', { headers: { 'content-length': String(26 * 1024 * 1024) } }))).rejects.toMatchObject({ code: 'TOO_LARGE' })
    await expect(limitedBlob(new Response(new Uint8Array(25 * 1024 * 1024 + 1)))).rejects.toMatchObject({ code: 'TOO_LARGE' })
    expect(await (await limitedBlob(new Response('audio'))).text()).toBe('audio')
  })
})
