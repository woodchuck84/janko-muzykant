import type { Part } from './types'
import { personalKey } from './session'

export interface Recording {
  id: string; songId: string; part: Part; created: string; blob: Blob; duration: number;
  offset: number; referenceId: string | null; referenceSpeed: number
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(personalKey('janko-recordings'), 1)
    request.onupgradeneeded = () => request.result.createObjectStore('takes', { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('Nie można otworzyć lokalnej bazy nagrań. Sprawdź tryb prywatny i miejsce na dysku.'))
  })
}
async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction('takes', mode)
    const request = operation(tx.objectStore('takes'))
    tx.oncomplete = () => { db.close(); resolve(request.result) }
    tx.onerror = () => { db.close(); reject(new Error('Nie udało się zapisać / odczytać nagrania. Pamięć przeglądarki może być pełna.')) }
    tx.onabort = () => { db.close(); reject(new Error('Zapis nagrania został przerwany. Zwolnij miejsce lub pobierz plik nagrania.')) }
  })
}
export async function saveRecording(recording: Recording) {
  if (recording.blob.size > 40 * 1024 * 1024) throw new Error('Nagranie przekracza limit 40 MB. Pobierz je na dysk zamiast zapisywać w przeglądarce.')
  await transaction('readwrite', store => store.put(recording))
}
export async function listRecordings(songId: string, part: Part) {
  const items = await transaction<Recording[]>('readonly', store => store.getAll())
  return items.filter(item => item.songId === songId && item.part === part).sort((a, b) => b.created.localeCompare(a.created))
}
export async function deleteRecording(id: string) { await transaction('readwrite', store => store.delete(id)) }
