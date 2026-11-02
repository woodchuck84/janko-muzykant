import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const ROOT = '1fESe16CVAh9JBpNKw2_ucmKPAn7NbPtQ', FOLDER = 'application/vnd.google-apps.folder'
const pdf = readFileSync('data\\cache\\1K4dwGq7LdZaxMbY2kvzri-3ODJ7AbVwd.pdf')
const audio = readFileSync('data\\cache\\1YAk_fU0jbiUdAbUGBcGZEPTGK-g4cM09.m4a')
const xml = readFileSync('backend\\tests\\fixtures\\practice.musicxml')
const trees: Record<string, { id: string; name: string; mimeType: string }[]> = {
  [ROOT]: [{ id: 'event-folder123', name: 'Koncert PWA', mimeType: FOLDER }],
  'event-folder123': [{ id: 'song-folder123', name: 'Piechota PWA', mimeType: FOLDER }],
  'song-folder123': [
    { id: 'score-file123', name: 'Piechota.pdf', mimeType: 'application/pdf' },
    { id: 'audio-file123', name: 'B - Piechota.m4a', mimeType: 'audio/mp4' },
    { id: 'xml-file12345', name: 'Piechota.musicxml', mimeType: 'application/xml' },
  ],
}
test('download page publishes the real signed APK hash, version and install instructions', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#release')).toContainText('APK 0.1.7')
  const response = await page.request.get('/version.json')
  expect(response.headers()['cache-control']).toBe('no-store')
  expect(response.headers()['access-control-allow-origin']).toBe('*')
  const release = await response.json()
  expect(release.sha256).toBe(createHash('sha256').update(readFileSync('Janko-Muzykant-debug.apk')).digest('hex'))
  expect((await page.request.get(release.apkUrl)).status()).toBe(200)
  await expect(page.getByRole('link', { name: 'Pobierz APK', exact: true })).toHaveAttribute('href', release.apkUrl)
  await expect(page.getByRole('link', { name: 'Otwórz aplikację web' })).toHaveAttribute('href', '/app/')
  await expect(page.getByRole('heading', { name: 'Twoja pracownia na komputerze' })).toBeVisible()
})
test('PWA shows a new release without silently interrupting practice', async ({ page }) => {
  let versionCode = 9
  await page.route('**/version.json', route => route.fulfill({ json: {
    webVersion: versionCode === 9 ? '0.1.8' : '0.1.6', apkVersion: '0.1.8', versionCode, sha256: 'a'.repeat(64),
    apkUrl: '/downloads/Janko-Muzykant-debug.apk',
  } }))
  await page.goto('/app/')
  await expect(page.getByText('Dostępna nowa wersja', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Odśwież aplikację po zapisaniu ćwiczenia' })).toBeVisible()
  versionCode = 7
  await page.locator('.distribution-notice summary').click()
  await page.getByRole('button', { name: 'Sprawdź aktualizacje' }).click()
  await expect(page.getByText('Dostępna nowa wersja', { exact: true })).toHaveCount(0)
})
test('browser storage, playback, local MusicXML and offline startup need only the public proxy', async ({ page, context }) => {
  const api: string[] = []
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) api.push(new URL(request.url()).pathname) })
  await page.route('**/api/drive?*', async route => {
    const url = new URL(route.request().url()), id = url.searchParams.get('id')!
    expect(route.request().method()).toBe('GET')
    if (url.searchParams.get('op') === 'list') return route.fulfill({ json: { files: trees[id] ?? [] } })
    if (id === 'score-file123') return route.fulfill({ contentType: 'application/pdf', body: pdf })
    if (id === 'audio-file123') return route.fulfill({ contentType: 'audio/mp4', body: audio })
    return route.fulfill({ contentType: 'application/xml', body: xml })
  })
  await page.goto('/app/')
  await expect(page.getByRole('button', { name: 'Synchronizuj Drive (tylko odczyt)' })).toBeEnabled()
  await expect(page.getByRole('button', { name: /Zaloguj przez Google/ })).toHaveCount(0)
  await page.getByLabel('Mój głos', { exact: true }).selectOption('B')
  await page.getByRole('button', { name: 'Synchronizuj Drive (tylko odczyt)' }).click()
  await expect(page.locator('.phone-song')).toContainText('Piechota PWA')
  await page.locator('.phone-song').click()
  await page.getByRole('button', { name: 'Pobierz materiały na telefon' }).click()
  await expect(page.getByText('3/3 plików na telefonie')).toBeVisible()
  await expect(page.locator('.score-panel canvas')).toBeVisible()
  await page.locator('#player-details').getByRole('button', { name: 'Odtwórz', exact: true }).click()
  await expect(page.locator('.persistent-player').getByRole('button', { name: 'Pauza', exact: true })).toBeVisible()
  await page.locator('.persistent-player').getByRole('button', { name: 'Pauza', exact: true }).click()
  await page.getByRole('button', { name: 'Analiza', exact: true }).click()
  await page.getByRole('button', { name: 'Odczytaj pięciolinie' }).click()
  await expect(page.getByRole('combobox', { name: 'Pięciolinia', exact: true })).toHaveValue('P4')
  await page.getByLabel(/Sprawdzono nuty/).check()
  await page.getByRole('button', { name: 'Generuj WAV', exact: true }).click()
  await expect(page.getByText('Zakres G2 — G3')).toBeVisible()
  const guide = page.locator('.phone-stack audio')
  await guide.evaluate(audio => audio.play())
  await expect.poll(() => guide.evaluate(audio => audio.currentTime)).toBeGreaterThan(0.1)
  await guide.evaluate(audio => audio.pause())
  expect(api.every(url => url === '/api/drive')).toBe(true)
  await page.getByRole('button', { name: 'Wróć do biblioteki' }).click()
  // State is written through IndexedDB; reload while offline also checks SW-cached JS/PDF workers.
  await expect.poll(() => page.evaluate(async () => (await caches.open('janko-public-files')).keys().then(keys => keys.length))).toBeGreaterThanOrEqual(4)
  await context.setOffline(true)
  await page.reload()
  await expect(page.locator('.phone-song')).toContainText('Piechota PWA')
  await expect(page.getByText(/Offline: tylko wcześniej pobrane/)).toBeVisible()
  await page.locator('.phone-song').click()
  await expect(page.locator('.score-panel canvas')).toBeVisible()
  const cached = await page.evaluate(async () => {
    const urls = await (await caches.open('janko-public-files')).keys()
    const audio = urls.find(url => url.url.includes('audio-file123'))!
    const response = await fetch(audio.url, { headers: { Range: 'bytes=0-63' } })
    return { status: response.status, size: (await response.arrayBuffer()).byteLength }
  })
  expect(cached).toEqual({ status: 206, size: 64 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth))
  await context.setOffline(false)
})
