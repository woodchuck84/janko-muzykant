import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './style.css'
import './mobile.css'
import { setSession, type Session } from './session'

async function clearOfflineCache() {
  if ('serviceWorker' in navigator) {
    for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister()
  }
  if ('caches' in window) {
    for (const key of await caches.keys()) if (key.startsWith('janko-') || key.startsWith('workbox-')) await caches.delete(key)
  }
}
async function logout(session: Session) {
  const response = await fetch('/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': session.csrf ?? '' } })
  if (!response.ok) throw new Error('Nie udało się wylogować. Spróbuj ponownie.')
  await clearOfflineCache()
  window.location.assign('/')
}
async function start() {
  const response = await fetch('/api/session', { cache: 'no-store' }).catch(error => {
    if (!['localhost', '127.0.0.1'].includes(window.location.hostname)) throw error
    return new Response(JSON.stringify({ hosted: false, user_id: 'local', email: null, admin: true, csrf: null }))
  })
  if (response.status === 401) { window.location.assign('/auth/login'); return }
  if (!response.ok) throw new Error('Nie można sprawdzić sesji. Sprawdź połączenie i odśwież stronę.')
  const session = await response.json() as Session
  setSession(session)
  if (session.hosted) await clearOfflineCache()
  else registerSW({ immediate: true })
  ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode>
    {session.hosted && <div className="hosted-account">
      <span>{session.email} · {session.admin ? 'Administrator' : 'Chórzysta'}</span>
      <button onClick={() => { void logout(session).catch(error => window.alert(String(error))) }}>Wyloguj</button>
    </div>}
    <App />
  </React.StrictMode>)
}
void start().catch(error => {
  const root = document.getElementById('root')!
  const message = document.createElement('p')
  message.textContent = String(error)
  const retry = document.createElement('button')
  retry.textContent = 'Spróbuj ponownie'
  retry.onclick = () => window.location.reload()
  root.replaceChildren(message, retry)
})
