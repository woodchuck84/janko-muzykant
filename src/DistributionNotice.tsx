import { useEffect, useState } from 'react'
import { validApkUrl } from './distribution'
export const DISTRIBUTION_VERSION = '0.1.7'
export const ANDROID_VERSION_CODE = 8
interface Release { webVersion: string; apkVersion: string; versionCode: number; sha256: string; apkUrl: string }
declare global { interface Window { jankoPwaUpdate?: () => void } }
function site(value: string) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('Podaj adres HTTPS strony dystrybucji, bez hasła i parametrów.')
  if (!/^\/(?:[\w.-]+\/?)*$/.test(url.pathname)) throw new Error('Nieprawidłowa ścieżka strony dystrybucji.')
  return `${url.origin}${url.pathname.replace(/\/$/, '')}`
}
export default function DistributionNotice({ web = false }: { web?: boolean }) {
  const [address, setAddress] = useState(() => localStorage.getItem('janko.distribution.url') ?? import.meta.env.VITE_JANKO_DISTRIBUTION_URL ?? '')
  const [release, setRelease] = useState<Release | null>(null), [status, setStatus] = useState('')
  const [install, setInstall] = useState<((() => Promise<void>)) | null>(null)
  const [reload, setReload] = useState<(() => void) | null>(() => window.jankoPwaUpdate ?? null)
  const origin = web ? `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}` : address
  async function check(manual = false) {
    if (!origin || !navigator.onLine) { if (manual) setStatus('Do sprawdzenia aktualizacji potrzebny jest internet i adres strony dystrybucji.'); return }
    try {
      const base = web ? origin : site(origin)
      const response = await fetch(`${base}/version.json`, { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(15000) })
      if (!response.ok) throw new Error(`Strona aktualizacji: HTTP ${response.status}.`)
      const value = await response.json() as Release
      if (!Number.isInteger(value.versionCode) || !/^[a-f0-9]{64}$/i.test(value.sha256) ||
        typeof value.webVersion !== 'string' || typeof value.apkVersion !== 'string' || !validApkUrl(value.apkUrl))
        throw new Error('Nieprawidłowy plik wersji na stronie dystrybucji.')
      setRelease(value)
      setStatus(manual ? 'Sprawdzono wersję na stronie dystrybucji.' : '')
    } catch (error) { setStatus(`Nie sprawdzono aktualizacji: ${error instanceof Error ? error.message : String(error)}`) }
  }
  useEffect(() => { void check() }, [origin])
  useEffect(() => {
    const prompt = (event: Event) => {
      event.preventDefault()
      const deferred = event as Event & { prompt: () => Promise<void> }
      setInstall(() => () => deferred.prompt())
    }
    const needRefresh = (event: Event) => setReload(() => (event as CustomEvent<() => void>).detail)
    window.addEventListener('beforeinstallprompt', prompt); window.addEventListener('janko-pwa-update', needRefresh)
    return () => { window.removeEventListener('beforeinstallprompt', prompt); window.removeEventListener('janko-pwa-update', needRefresh) }
  }, [])
  const newer = release && release.versionCode > ANDROID_VERSION_CODE
  return <section className="distribution-notice panel" aria-label="Instalacja i aktualizacje">
    {(newer || reload) && <p className="notice" role="status"><strong>Dostępna nowa wersja</strong> {web ? release?.webVersion : release?.apkVersion}.
      {web ? <button className="secondary" onClick={() => reload ? reload() : window.location.reload()}>Odśwież aplikację po zapisaniu ćwiczenia</button> :
        <a href={`${origin}/`} target="_blank" rel="noreferrer">Pobierz aktualizację APK</a>}</p>}
    <details><summary>{web ? 'Zainstaluj aplikację · wersja ' : 'Aktualizacje APK · wersja '}{DISTRIBUTION_VERSION}</summary>
      {web ? <><p>Windows: Chrome lub Edge → menu ⋮/… → Zainstaluj aplikację (lub Aplikacje → Zainstaluj tę witrynę jako aplikację). PWA nie wymaga serwera na komputerze.</p>
        {install && <button className="primary" onClick={() => void install().catch(error => setStatus(String(error)))}>Zainstaluj aplikację</button>}
        <a href={import.meta.env.BASE_URL}>Pobieranie APK i instrukcje</a></> :
        <label>Strona dystrybucji (HTTPS)<input type="url" value={address} placeholder="https://twoj-projekt.pages.dev" onChange={event => setAddress(event.target.value)} onBlur={() => {
          try { if (address) { const value = site(address); localStorage.setItem('janko.distribution.url', value); setAddress(value) }
            else localStorage.removeItem('janko.distribution.url')
          } catch (error) { setStatus(String(error)) }
        }}/></label>}
      <button className="secondary" onClick={() => void check(true)}>Sprawdź aktualizacje</button>
      {!web && !address && <p>Dystrybutor nie ustawił jeszcze adresu aktualizacji. Wpisz adres strony, z której otrzymałeś APK, albo pobieraj aktualizacje z przesyłanego linku.</p>}
      {status && <p role="status">{status}</p>}
    </details>
  </section>
}
