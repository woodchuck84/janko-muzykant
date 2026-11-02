import type { Entry } from '../android-ui/native'
export const ROOT = '1fESe16CVAh9JBpNKw2_ucmKPAn7NbPtQ'
const FOLDER = 'application/vnd.google-apps.folder'
const LIMIT = 25 * 1024 * 1024
const fail = (code: string, message: string): never => { throw Object.assign(new Error(message), { code }) }
export async function limitedBlob(response: Response, limit = LIMIT) {
  const message = limit === LIMIT ? 'PWA: plik przekracza 25 MiB. Użyj APK.' : 'Lista Drive przekracza 4 MiB.'
  if (Number(response.headers.get('content-length')) > limit) return fail('TOO_LARGE', message)
  if (!response.body) return fail('PUBLIC_UNAVAILABLE', 'Pusta odpowiedź pliku.')
  const reader = response.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > limit) { await reader.cancel(); return fail('TOO_LARGE', message) }
      chunks.push(new Uint8Array(value))
    }
  } finally { reader.releaseLock() }
  return new Blob(chunks, { type: response.headers.get('content-type') || 'application/octet-stream' })
}
/** Public API key is intentionally browser-visible; restrict it by HTTP referrer and API. */
export class PublicDriveSource {
  private listings = new Map<string, { until: number; files: Entry[] }>()
  constructor(private key: string, private proxy: string, private fetcher: typeof fetch = fetch) {}
  private async get(url: string) {
    let response: Response
    const fetcher = this.fetcher
    try { response = await fetcher(url, { method: 'GET', credentials: 'omit',
      referrerPolicy: this.key && !this.proxy ? 'strict-origin' : 'no-referrer', signal: AbortSignal.timeout(45000) }) }
    catch { return fail('NETWORK_ERROR', 'Nie można połączyć się ze źródłem Drive. Sprawdź internet i konfigurację źródła.') }
    if (!response.ok) {
      if ([401, 403, 404].includes(response.status)) return fail('PUBLIC_UNAVAILABLE',
        'Nie można odczytać publicznie. Sprawdź udostępnienie pliku, resourceKey oraz ograniczenia klucza API/referrera. Prywatne pliki wymagają APK i konta z dostępem.')
      if (response.status === 429) return fail('RATE_LIMITED', 'Limit zapytań Drive. Spróbuj później.')
      if (response.status === 413) return fail('TOO_LARGE', 'PWA: materiał przekracza limit rozmiaru.')
      return fail('SERVICE_UNAVAILABLE', `Źródło Drive: HTTP ${response.status}. Sprawdź konfigurację i limity API.`)
    }
    return response
  }
  private async list(folder: string) {
    const cached = this.listings.get(folder)
    if (cached && cached.until > Date.now()) return cached.files
    const files: Entry[] = [], seen = new Set<string>()
    let token = ''
    do {
      const query = new URLSearchParams({ key: this.key, q: `'${folder}' in parents and trashed = false`,
        fields: 'nextPageToken,files(id,name,mimeType)', pageSize: '1000' })
      if (token) query.set('pageToken', token)
      const response = await this.get(`https://www.googleapis.com/drive/v3/files?${query}`)
      const value = JSON.parse(await (await limitedBlob(response, 4 * 1024 * 1024)).text()) as { files?: Entry[]; nextPageToken?: string }
      if (!Array.isArray(value.files) || value.files.some(file => !/^[\w-]{10,120}$/.test(file.id) || typeof file.name !== 'string' || typeof file.mimeType !== 'string'))
        return fail('PUBLIC_UNAVAILABLE', 'Nieprawidłowa odpowiedź listy Drive.')
      files.push(...value.files)
      if (files.length > 2000) return fail('TOO_LARGE', 'Folder przekracza limit 2000 elementów.')
      token = value.nextPageToken ?? ''
      if (token && seen.has(token)) return fail('PUBLIC_UNAVAILABLE', 'Nieprawidłowa paginacja Drive.')
      seen.add(token)
    } while (token)
    this.listings.set(folder, { until: Date.now() + 300000, files })
    return files
  }
  async request(op: string, id: string, path: string[]) {
    if (!/^[\w-]{10,120}$/.test(id) || !['list', 'download'].includes(op) || path.length > 12 ||
      path.some(parent => !/^[\w-]{10,120}$/.test(parent)) || new Set(path).size !== path.length)
      return fail('INVALID_INPUT', 'Nieprawidłowa ścieżka Drive.')
    if (id === ROOT ? path.length > 0 || op !== 'list' : path[0] !== ROOT)
      return fail('OUTSIDE_ROOT', 'Element nie należy do biblioteki chóru.')
    if (this.proxy) {
      const url = new URL(this.proxy, window.location.origin)
      if (url.origin !== window.location.origin && url.protocol !== 'https:') return fail('INVALID_INPUT', 'Proxy musi używać HTTPS.')
      url.search = new URLSearchParams({ op, id, path: path.join(',') }).toString()
      return this.get(url.href)
    }
    if (!this.key) return fail('SOURCE_NOT_CONFIGURED',
      'Dystrybutor nie skonfigurował źródła Drive. Ustaw VITE_GOOGLE_DRIVE_API_KEY lub VITE_JANKO_DRIVE_PROXY_URL i opublikuj ponownie. Odbiorcy nie muszą nic konfigurować.')
    let item: Entry = { id: ROOT, name: 'Chór', mimeType: FOLDER }, parent = ROOT
    for (let index = 1; index <= path.length; index++) {
      const target = index === path.length ? id : path[index]
      const found = (await this.list(parent)).find(file => file.id === target)
      if (!found || index < path.length && found.mimeType !== FOLDER) return fail('OUTSIDE_ROOT', 'Element nie należy do biblioteki chóru.')
      item = found; parent = target
    }
    if (op === 'list') {
      if (item.mimeType !== FOLDER) return fail('INVALID_INPUT', 'Element nie jest folderem.')
      return Response.json({ files: await this.list(id) })
    }
    if (item.mimeType === FOLDER) return fail('INVALID_INPUT', 'Folder nie jest plikiem.')
    const query = new URLSearchParams({ key: this.key })
    const doc = item.mimeType === 'application/vnd.google-apps.document'
    if (doc) query.set('mimeType', 'text/plain')
    else query.set('alt', 'media')
    return this.get(`https://www.googleapis.com/drive/v3/files/${id}${doc ? '/export' : ''}?${query}`)
  }
}
