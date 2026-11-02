import type { Account, Entry, LocalFile, NativeDrive } from '../android-ui/native'
import { PublicDriveSource, limitedBlob } from './source'
const ROOT = '1fESe16CVAh9JBpNKw2_ucmKPAn7NbPtQ'
const FOLDER = 'application/vnd.google-apps.folder'
const BASE = import.meta.env.BASE_URL
const CACHE = BASE === '/' ? 'janko-public-files' : `janko-public-files${BASE}`
const ID = 'web-public-choir'
const fail = (code: string, message: string): never => { throw Object.assign(new Error(message), { code }) }
interface Stored { key: string; value: string }
function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(BASE === '/' ? 'janko-web-public' : `janko-web-public${BASE}`, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('state', { keyPath: 'key' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('Nie można otworzyć lokalnej bazy przeglądarki.'))
  })
}
async function stateStore(key: string, value?: string) {
  const db = await database()
  try {
    return await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction('state', value === undefined ? 'readonly' : 'readwrite')
      const store = tx.objectStore('state')
      const request = value === undefined ? store.get(key) : store.put({ key, value })
      let found: Stored | undefined
      request.onsuccess = () => { if (value === undefined) found = request.result as Stored | undefined }
      tx.oncomplete = () => resolve(value ?? found?.value ?? null)
      tx.onerror = () => reject(new Error('Nie zapisano danych. Sprawdź wolne miejsce w przeglądarce.'))
      tx.onabort = () => reject(new Error('Przerwano zapis danych przeglądarki.'))
    })
  } finally { db.close() }
}
export class BrowserDrive implements NativeDrive {
  private source = new PublicDriveSource(import.meta.env.VITE_GOOGLE_DRIVE_API_KEY ?? '',
    import.meta.env.VITE_JANKO_DRIVE_PROXY_URL ?? (import.meta.env.VITE_JANKO_GITHUB === 'true' || import.meta.env.VITE_GOOGLE_DRIVE_API_KEY ? '' : `${BASE}api/drive`))
  private paths: Record<string, string[]> = { [ROOT]: [] }
  private account(): Account { return { id: ID, email: 'Publiczna biblioteka · ten profil przeglądarki', anonymous: true,
    lastVerified: Number(localStorage.getItem('janko.web.lastVerified') ?? 0) } }
  private async request(op: string, id: string) {
    if (!navigator.onLine) fail('NETWORK_ERROR', 'Brak internetu. Dostępne są wcześniej pobrane materiały.')
    const path = this.paths[id]
    if (!path) fail('PUBLIC_UNAVAILABLE', 'Najpierw zsynchronizuj bibliotekę, aby potwierdzić ścieżkę tego pliku.')
    return this.source.request(op, id, path)
  }
  async initialize() {
    const saved = await stateStore('paths')
    if (saved) this.paths = { ...JSON.parse(saved) as Record<string, string[]>, [ROOT]: [] }
    return { account: this.account() }
  }
  async connect(): Promise<{ account: Account }> {
    return fail('WEB_AUTH_UNAVAILABLE', 'W PWA dostępne są tylko materiały publiczne. Prywatne pliki: użyj opcjonalnego logowania w APK na Androidzie. Logowanie nie nadaje uprawnień.')
  }
  async verify() {
    await this.request('list', ROOT)
    localStorage.setItem('janko.web.lastVerified', String(Date.now()))
    return { account: this.account() }
  }
  async useAnonymous() { return { account: this.account() } }
  async list({ folderId }: { folderId: string }) {
    const payload = await (await this.request('list', folderId)).json() as { files: Entry[] }
    for (const entry of payload.files) this.paths[entry.id] = [...this.paths[folderId], folderId]
    await stateStore('paths', JSON.stringify(this.paths))
    return payload
  }
  private async save(blob: Blob, name: string, identity: string = crypto.randomUUID()): Promise<LocalFile> {
    const url = `${BASE}__janko_files/${ID}/${encodeURIComponent(identity)}/${encodeURIComponent(name)}`
    try {
      const cache = await caches.open(CACHE)
      await cache.put(url, new Response(blob, { headers: { 'Content-Type': blob.type || 'application/octet-stream',
        'Content-Length': String(blob.size) } }))
    } catch { fail('STORAGE_ERROR', 'Brak miejsca na plik. Zwolnij pamięć przeglądarki i pobierz ponownie.') }
    return { path: url, url }
  }
  async download({ id, name, mime }: { id: string; name: string; mime: string }) {
    const response = await this.request('download', id)
    const blob = await limitedBlob(response)
    if (blob.size > 25 * 1024 * 1024) fail('TOO_LARGE', 'PWA obsługuje pliki do 25 MiB. Większe pliki pobierz w APK lub wersji komputerowej.')
    return this.save(new Blob([blob], { type: response.headers.get('Content-Type') || mime }), name, id)
  }
  async readText({ path }: { path: string }) {
    const response = await (await caches.open(CACHE)).match(path)
    if (!response) return fail('STORAGE_ERROR', 'Plik lokalny zniknął. Pobierz go ponownie z biblioteki.')
    return { text: await response.text() }
  }
  async readState() { return { state: await stateStore(ID) } }
  async writeState({ state }: { state: string }) { await stateStore(ID, state) }
  async signOut() {
    await stateStore(ID, ''); await stateStore('paths', '{}'); await caches.delete(CACHE)
    this.paths = { [ROOT]: [] }
    localStorage.removeItem('janko.web.lastVerified')
  }
  async importXml(): Promise<Entry & LocalFile> {
    const file = await new Promise<File>((resolve, reject) => {
      const input = document.createElement('input')
      input.type = 'file'; input.accept = '.xml,.musicxml,.mxl'
      input.onchange = () => { input.remove(); input.files?.[0] ? resolve(input.files[0]) : reject(new Error('Nie wybrano pliku.')) }
      input.addEventListener('cancel', () => { input.remove(); reject(new Error('Anulowano import.')) }, { once: true })
      input.style.display = 'none'; document.body.append(input); input.click()
    })
    if (file.size > 12 * 1024 * 1024) fail('TOO_LARGE', 'MusicXML/MXL przekracza 12 MiB.')
    const id = `local-${crypto.randomUUID()}`
    return { ...await this.save(file, file.name, id), id, name: file.name, mimeType: 'application/xml' }
  }
  async saveGenerated({ base64, name }: { base64: string; name: string }) {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0))
    return this.save(new Blob([bytes], { type: 'audio/wav' }), name)
  }
  async requestMicrophone() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach(track => track.stop())
    return { granted: true }
  }
}
export { FOLDER }
