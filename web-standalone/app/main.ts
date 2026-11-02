import { registerSW } from 'virtual:pwa-register'
import '../standalone.css'
async function start() {
  if (!('serviceWorker' in navigator)) throw new Error('Ta przeglądarka nie obsługuje offline PWA. Użyj aktualnego Chrome lub Edge.')
  let rejectRegistration: (error: Error) => void = () => {}
  const failure = new Promise<never>((_, reject) => { rejectRegistration = reject })
  const update = registerSW({ immediate: true,
    onRegisterError(error: Error) { rejectRegistration(error) },
    onNeedRefresh() {
      window.jankoPwaUpdate = () => { void update(true) }
      window.dispatchEvent(new CustomEvent('janko-pwa-update', { detail: window.jankoPwaUpdate }))
    },
  })
  let timer = 0
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error('Nie uruchomiono obsługi offline. Sprawdź HTTPS, połączenie i uprawnienia pamięci witryny')), 30000)
  })
  try {
    await Promise.race([failure, timeout, (async () => {
      await navigator.serviceWorker.ready
      if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }))
    })()])
  } finally { clearTimeout(timer) }
  await import('../../android-ui/main')
}
void start().catch(error => {
  const root = document.getElementById('root')!
  root.textContent = `Nie można uruchomić PWA: ${error.message}. Odśwież stronę online w Chrome lub Edge.`
})
