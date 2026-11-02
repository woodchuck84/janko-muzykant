export const ROOT = '1fESe16CVAh9JBpNKw2_ucmKPAn7NbPtQ'
export const FOLDER = 'application/vnd.google-apps.folder'
const LIMIT = 25 * 1024 * 1024, HTML_LIMIT = 4 * 1024 * 1024
const idPattern = /^[A-Za-z0-9_-]{10,120}$/
const buckets = new Map()
class Failure extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code }
}
const fail = (status, code, message) => { throw new Failure(status, code, message) }
function validId(id) {
  if (!idPattern.test(id)) fail(400, 'INVALID_INPUT', 'Nieprawidłowy identyfikator Drive.')
  return id
}
function decode(text) {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (_, entity) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1))
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    }
    return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }[entity.toLowerCase()]
  })
}
const attribute = (tag, name) => decode(tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'))?.[1] ?? '')
export function parseFolder(html) {
  if (!/class=["'][^"']*\bflip-entries\b/.test(html) || /accounts\.google.*ServiceLogin|<form[^>]+accounts\.google/i.test(html))
    fail(403, 'PUBLIC_UNAVAILABLE', 'Folder nie udostępnia publicznej listy. Prywatne materiały wymagają APK i konta z dostępem.')
  const entries = []
  for (const segment of html.split(/<div\b(?=[^>]*class=["'][^"']*\bflip-entry\b(?!-))/i).slice(1)) {
    const anchor = segment.match(/<a\b[^>]*>/i)?.[0]
    const title = segment.match(/<div\b[^>]*class=["'][^"']*\bflip-entry-title\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]
    if (!anchor || title === undefined) fail(502, 'PUBLIC_UNAVAILABLE', 'Format listy Google zmienił się; potrzebna aktualizacja parsera.')
    let url
    try { url = new URL(attribute(anchor, 'href')) } catch { fail(502, 'PUBLIC_UNAVAILABLE', 'Nieznany odnośnik Google.') }
    if (url.protocol !== 'https:' || !['drive.google.com', 'docs.google.com'].includes(url.hostname))
      fail(502, 'PUBLIC_UNAVAILABLE', 'Nieznana domena pliku.')
    const id = validId(url.pathname.match(/\/(?:folders|d)\/([\w-]+)/)?.[1] ?? url.searchParams.get('id') ?? '')
    const name = decode(title.replace(/<[^>]*>/g, '')).trim()
    const mimeType = url.pathname.includes('/folders/') ? FOLDER : url.hostname === 'docs.google.com' ?
      'application/vnd.google-apps.document' : /\.pdf$/i.test(name) ? 'application/pdf' :
      /\.(m4a|mp3|wav|ogg|flac|aac)$/i.test(name) ? (/\.mp3$/i.test(name) ? 'audio/mpeg' : /\.wav$/i.test(name) ? 'audio/wav' : 'audio/mp4') :
      /\.(mxl|xml|musicxml)$/i.test(name) ? 'application/xml' : 'application/octet-stream'
    entries.push({ id, name, mimeType })
    if (entries.length > 2000) fail(413, 'TOO_LARGE', 'Folder przekracza limit 2000 elementów.')
  }
  return entries
}
function allowed(url) {
  return url.protocol === 'https:' && (!url.port || url.port === '443') && !url.username && !url.password &&
    (['drive.google.com', 'drive.usercontent.google.com', 'docs.google.com'].includes(url.hostname) ||
      url.hostname.endsWith('.googleusercontent.com'))
}
export async function boundedBytes(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) fail(413, 'TOO_LARGE', 'Materiał przekracza dozwolony rozmiar.')
  if (!response.body) fail(502, 'PUBLIC_UNAVAILABLE', 'Google zwrócił pustą odpowiedź.')
  const reader = response.body.getReader(), chunks = []
  let length = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.length
      if (length > limit) { await reader.cancel(); fail(413, 'TOO_LARGE', 'Materiał przekracza dozwolony rozmiar.') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
  return result
}
async function google(address, fetcher) {
  let url = new URL(address)
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (!allowed(url)) fail(502, 'PUBLIC_UNAVAILABLE', 'Niedozwolone przekierowanie Google.')
    const response = await fetcher(url.href, { method: 'GET', redirect: 'manual',
      headers: { 'User-Agent': 'JankoMuzykant-public-readonly/1.0' }, signal: AbortSignal.timeout(45000) })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location) fail(502, 'PUBLIC_UNAVAILABLE', 'Brak adresu przekierowania.')
      url = new URL(location, url); continue
    }
    if (!response.ok) fail(response.status === 429 ? 429 : 502, 'PUBLIC_UNAVAILABLE', `Google Drive: HTTP ${response.status}.`)
    return response
  }
  fail(502, 'PUBLIC_UNAVAILABLE', 'Zbyt wiele przekierowań Google.')
}
export function confirmation(html, id) {
  const form = html.match(/<form\b[^>]*id=["']download-form["'][^>]*>([\s\S]*?)<\/form>/i)
  if (!form) fail(403, 'PUBLIC_UNAVAILABLE', 'Google wymaga logowania lub innego potwierdzenia pobrania.')
  const url = new URL(attribute(form[0].match(/<form[^>]*>/i)[0], 'action'))
  if (!allowed(url) || url.hostname !== 'drive.usercontent.google.com' || url.pathname !== '/download')
    fail(502, 'PUBLIC_UNAVAILABLE', 'Nieobsługiwane potwierdzenie Google.')
  for (const input of form[1].matchAll(/<input\b[^>]*>/gi)) {
    const name = attribute(input[0], 'name')
    if (['id', 'export', 'confirm', 'uuid', 'at'].includes(name)) url.searchParams.set(name, attribute(input[0], 'value'))
  }
  if (url.searchParams.get('id') !== id || url.searchParams.get('export') !== 'download' || !url.searchParams.get('confirm'))
    fail(502, 'PUBLIC_UNAVAILABLE', 'Nieprawidłowe potwierdzenie pliku.')
  return url.href
}
function rate(ip, type) {
  const now = Date.now(), key = `${ip}:${type}`, period = 60000
  if (buckets.size > 10000) for (const [k, bucket] of buckets) if (now - bucket.start > period) buckets.delete(k)
  if (buckets.size > 10000) fail(429, 'RATE_LIMITED', 'Proxy jest zajęte. Spróbuj za minutę.')
  const bucket = buckets.get(key)
  if (!bucket || now - bucket.start >= period) { buckets.set(key, { start: now, count: 1 }); return }
  if (++bucket.count > (type === 'download' ? 30 : 240)) fail(429, 'RATE_LIMITED', 'Limit zapytań. Spróbuj za minutę.')
}
export async function handleDrive(request, { fetcher = fetch, cache, limiter } = {}) {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }
  try {
    if (request.method !== 'GET') return new Response('GET only', { status: 405, headers: { ...headers, Allow: 'GET' } })
    const url = new URL(request.url), op = url.searchParams.get('op'), id = validId(url.searchParams.get('id') ?? '')
    if (!['list', 'download'].includes(op)) fail(400, 'INVALID_INPUT', 'Nieznana operacja.')
    const ip = request.headers.get('CF-Connecting-IP') || 'local'
    if (limiter && !(await limiter.limit({ key: `${ip}:${op}` })).success) fail(429, 'RATE_LIMITED', 'Limit zapytań. Spróbuj za minutę.')
    rate(ip, op)
    const path = (url.searchParams.get('path') ?? '').split(',').filter(Boolean)
    if (path.length > 12 || path.some(value => !idPattern.test(value)) || new Set(path).size !== path.length)
      fail(400, 'INVALID_INPUT', 'Nieprawidłowa ścieżka folderów.')
    async function listing(folder) {
      const key = new Request(`https://janko-cache.invalid/folder/${ROOT}/${folder}`)
      const cached = cache && await cache.match(key)
      if (cached) return cached.json()
      const response = await google(`https://drive.google.com/embeddedfolderview?id=${folder}`, fetcher)
      const entries = parseFolder(new TextDecoder().decode(await boundedBytes(response, HTML_LIMIT)))
      if (cache) await cache.put(key, new Response(JSON.stringify(entries), { headers: { 'Cache-Control': 'public,max-age=300' } }))
      return entries
    }
    let item = { id: ROOT, name: 'Chór', mimeType: FOLDER }, parent = ROOT
    if (id === ROOT) {
      if (path.length || op !== 'list') fail(403, 'OUTSIDE_ROOT', 'Niedozwolony element.')
    } else {
      if (path[0] !== ROOT) fail(403, 'OUTSIDE_ROOT', 'Element nie należy do biblioteki chóru.')
      for (let index = 1; index <= path.length; index++) {
        const target = index === path.length ? id : path[index]
        item = (await listing(parent)).find(entry => entry.id === target)
        if (!item) fail(403, 'OUTSIDE_ROOT', 'Element nie należy do biblioteki chóru.')
        if (index < path.length && item.mimeType !== FOLDER) fail(403, 'OUTSIDE_ROOT', 'Nieprawidłowy folder nadrzędny.')
        parent = target
      }
    }
    if (op === 'list') {
      if (item.mimeType !== FOLDER) fail(400, 'INVALID_INPUT', 'Element nie jest folderem.')
      return Response.json({ files: await listing(id) }, { headers })
    }
    if (item.mimeType === FOLDER) fail(400, 'INVALID_INPUT', 'Folder nie jest plikiem.')
    const doc = item.mimeType === 'application/vnd.google-apps.document'
    let response = await google(doc ? `https://docs.google.com/document/d/${id}/export?format=txt` :
      `https://drive.google.com/uc?export=download&id=${id}`, fetcher)
    if ((response.headers.get('content-type') ?? '').includes('text/html')) {
      const html = new TextDecoder().decode(await boundedBytes(response, HTML_LIMIT))
      response = await google(confirmation(html, id), fetcher)
      if ((response.headers.get('content-type') ?? '').includes('text/html'))
        fail(403, 'PUBLIC_UNAVAILABLE', 'Google nie zwrócił pliku po potwierdzeniu.')
    }
    // Validate the entire bounded file before responding; never cache a truncated download.
    const bytes = await boundedBytes(response, LIMIT)
    return new Response(bytes, { headers: { ...headers, 'Content-Type': doc ? 'text/plain;charset=utf-8' : item.mimeType,
      'Content-Length': String(bytes.length), 'Content-Disposition': 'inline' } })
  } catch (error) {
    return Response.json({ code: error instanceof Failure ? error.code : 'SERVICE_UNAVAILABLE',
      message: error instanceof Failure ? error.message : 'Nie można połączyć się z Google. Spróbuj ponownie.' },
    { status: error instanceof Failure ? error.status : 502, headers })
  }
}
