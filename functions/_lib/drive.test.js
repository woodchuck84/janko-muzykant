import { describe, expect, it } from 'vitest'
import { ROOT, FOLDER, handleDrive, confirmation, boundedBytes } from './drive.js'
const child = 'child-folder-123', file = 'audio-file-123', foreign = 'foreign-file-123'
const html = entries => `<div class="flip-entries">${entries.map(([id, name, folder]) =>
  `<div class="flip-entry"><a href="https://drive.google.com/${folder ? 'drive/folders' : 'file/d'}/${id}"><div class="flip-entry-title">${name}</div></a></div>`).join('')}</div>`
const rootHTML = html([[child, 'Koncert', true]])
const childHTML = html([[file, 'B - Piechota.m4a']])
function fakeFetch(url, options) {
  expect(options.method).toBe('GET')
  if (url.includes(`embeddedfolderview?id=${ROOT}`)) return Promise.resolve(new Response(rootHTML))
  if (url.includes(`embeddedfolderview?id=${child}`)) return Promise.resolve(new Response(childHTML))
  if (url.includes(`uc?export=download&id=${file}`)) return Promise.resolve(new Response('audio', { headers: { 'content-type': 'audio/mp4' } }))
  throw Error('Unexpected Google request')
}
const request = (op, id, path = '') => new Request(`https://test/api/drive?op=${op}&id=${id}&path=${path}`)
describe('read-only public Drive proxy', () => {
  it('lists only root and verified reachable folders', async () => {
    const root = await handleDrive(request('list', ROOT), { fetcher: fakeFetch })
    expect((await root.json()).files[0].mimeType).toBe(FOLDER)
    const nested = await handleDrive(request('list', child, ROOT), { fetcher: fakeFetch })
    expect((await nested.json()).files[0].id).toBe(file)
  })
  it('downloads a file only after checking every parent', async () => {
    const response = await handleDrive(request('download', file, `${ROOT},${child}`), { fetcher: fakeFetch })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('audio')
  })
  it('refuses foreign IDs, forged ancestry, malformed IDs and nonfolders', async () => {
    for (const [op, id, path, status] of [['download', foreign, ROOT, 403], ['download', file, `${ROOT},${foreign}`, 403],
      ['download', file, '', 403], ['list', 'bad', ROOT, 400], ['list', file, `${ROOT},${child}`, 400]]) {
      expect((await handleDrive(request(op, id, path), { fetcher: fakeFetch })).status).toBe(status)
    }
  })
  it('refuses every non-GET before any upstream read', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'])
      expect((await handleDrive(new Request('https://test/api/drive', { method }), { fetcher: () => { throw Error('must not fetch') } })).status).toBe(405)
  })
  it('accepts only the known GET confirmation for the same file', () => {
    const form = `<form id="download-form" action="https://drive.usercontent.google.com/download">
      <input name="id" value="${file}"><input name="export" value="download"><input name="confirm" value="t"></form>`
    expect(confirmation(form, file)).toContain(`id=${file}`)
    expect(() => confirmation(form.replace(file, foreign), file)).toThrow()
    expect(() => confirmation(form.replace('drive.usercontent.google.com', 'evil.test'), file)).toThrow()
  })
  it('completes large-file confirmation without forwarding user credentials or changing file ID', async () => {
    const form = `<form id="download-form" action="https://drive.usercontent.google.com/download">
      <input name="id" value="${file}"><input name="export" value="download"><input name="confirm" value="t"></form>`
    let confirmed = false
    const response = await handleDrive(request('download', file, `${ROOT},${child}`), { fetcher: async (url, options) => {
      expect(options.method).toBe('GET')
      expect(options.headers.Cookie).toBeUndefined()
      expect(options.headers.Authorization).toBeUndefined()
      if (url.includes('/uc?')) return new Response(form, { headers: { 'content-type': 'text/html' } })
      if (url.startsWith('https://drive.usercontent.google.com/download')) {
        expect(new URL(url).searchParams.get('id')).toBe(file); confirmed = true
        return new Response('confirmed audio', { headers: { 'content-type': 'audio/mp4' } })
      }
      return fakeFetch(url, options)
    } })
    expect(confirmed).toBe(true)
    expect(await response.text()).toBe('confirmed audio')
  })
  it('rejects unknown listing HTML and over-limit content explicitly', async () => {
    const response = await handleDrive(request('list', ROOT), { fetcher: async () => new Response('<html>consent required</html>') })
    expect(response.status).toBe(403)
    await expect(boundedBytes(new Response('abcdef'), 3)).rejects.toThrow()
    const tooBig = await handleDrive(request('download', file, `${ROOT},${child}`), { fetcher: async (url, options) =>
      url.includes('/uc?') ? new Response('body', { headers: { 'content-length': String(25 * 1024 * 1024 + 1) } }) : fakeFetch(url, options) })
    expect(tooBig.status).toBe(413)
  })
  it('limits downloads to 30 per IP per minute within an isolate', async () => {
    for (let count = 1; count <= 31; count++) {
      const req = new Request(request('download', file, `${ROOT},${child}`), { headers: { 'CF-Connecting-IP': 'unit-rate-limit' } })
      const response = await handleDrive(req, { fetcher: fakeFetch })
      expect(response.status).toBe(count <= 30 ? 200 : 429)
    }
  })
  it('rejects redirects outside Google and rate-limiter refusal', async () => {
    const redirected = await handleDrive(request('list', ROOT), { fetcher: async () => new Response(null,
      { status: 302, headers: { Location: 'https://evil.test/' } }) })
    expect(redirected.status).toBe(502)
    const limited = await handleDrive(request('list', ROOT), { limiter: { limit: async () => ({ success: false }) } })
    expect(limited.status).toBe(429)
  })
})
