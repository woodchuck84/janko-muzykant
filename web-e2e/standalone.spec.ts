import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
const ROOT = '1fESe16CVAh9JBpNKw2_ucmKPAn7NbPtQ', FOLDER = 'application/vnd.google-apps.folder'
const xml = readFileSync(path.join('backend', 'tests', 'fixtures', 'practice.musicxml'), 'utf8')
  .replaceAll(/<part-name>[^<]+<\/part-name>/g, '<part-name>Voice</part-name>')
function pdfFixture(text: string) {
  const content = `BT /F1 14 Tf 50 700 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ]
  let document = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(document))
    document += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(document)
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(document)
}
function audioFixture() {
  const sampleRate = 22050, samples = sampleRate * 120, bytes = Buffer.alloc(44 + samples * 2)
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28)
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36)
  bytes.writeUInt32LE(samples * 2, 40)
  for (let index = 0; index < samples; index++) bytes.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * 440 / sampleRate) * 5000), 44 + index * 2)
  return bytes
}
const pdf = pdfFixture('Piechota · próba'), audio = audioFixture()
const trees: Record<string, { id: string; name: string; mimeType: string }[]> = {
  [ROOT]: [{ id: 'event-folder123', name: 'Koncert PWA', mimeType: FOLDER }],
  'event-folder123': [{ id: 'song-folder123', name: 'Piechota PWA', mimeType: FOLDER }],
  'song-folder123': [
    { id: 'score-file123', name: 'Piechota.pdf', mimeType: 'application/pdf' },
    { id: 'audio-file123', name: 'B - Piechota.wav', mimeType: 'audio/wav' },
    { id: 'xml-file12345', name: 'Piechota.musicxml', mimeType: 'application/xml' },
  ],
}
test('download page publishes the real signed APK hash, version and install instructions', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#release')).toContainText('APK 0.1.8')
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
  let versionCode = 10
  await page.route('**/version.json', route => route.fulfill({ json: {
    webVersion: versionCode === 10 ? '0.1.9' : '0.1.7', apkVersion: versionCode === 10 ? '0.1.9' : '0.1.7', versionCode, sha256: 'a'.repeat(64),
    apkUrl: '/downloads/Janko-Muzykant-debug.apk',
  } }))
  await page.goto('/app/')
  await expect(page.getByText('Dostępna nowa wersja', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Odśwież aplikację po zapisaniu ćwiczenia' })).toBeVisible()
  versionCode = 8
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
    if (id === 'audio-file123') return route.fulfill({ contentType: 'audio/wav', body: audio })
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
