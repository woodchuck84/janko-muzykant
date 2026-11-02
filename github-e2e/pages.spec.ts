import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
const ROOT = '1fESe16CVAh9JBpNKw2_ucmKPAn7NbPtQ', FOLDER = 'application/vnd.google-apps.folder'
const pdf = readFileSync('data\\cache\\1K4dwGq7LdZaxMbY2kvzri-3ODJ7AbVwd.pdf')
const audio = readFileSync('data\\cache\\1YAk_fU0jbiUdAbUGBcGZEPTGK-g4cM09.m4a')
const tree = {
  [ROOT]: [{ id: 'event-folder123', name: 'Koncert GitHub', mimeType: FOLDER }],
  'event-folder123': [{ id: 'song-folder123', name: 'Piechota', mimeType: FOLDER }],
  'song-folder123': [{ id: 'audio-file123', name: 'B - Piechota.m4a', mimeType: 'audio/mp4' },
    { id: 'score-file123', name: 'Piechota.pdf', mimeType: 'application/pdf' }],
}
test('project-site links, API sync, service worker and offline materials stay inside base path', async ({ page, context }, info) => {
  const unexpected: string[] = []
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.hostname === '127.0.0.1' && !url.pathname.startsWith('/janko-test/')) unexpected.push(url.pathname)
  })
  await page.route('https://www.googleapis.com/drive/v3/files**', route => {
    const url = new URL(route.request().url())
    expect(route.request().method()).toBe('GET')
    if (url.pathname.endsWith('/audio-file123')) return route.fulfill({ contentType: 'audio/mp4', body: audio })
    if (url.pathname.endsWith('/score-file123')) return route.fulfill({ contentType: 'application/pdf', body: pdf })
    const folder = url.searchParams.get('q')!.match(/^'([^']+)'/)![1]
    return route.fulfill({ json: { files: tree[folder as keyof typeof tree] ?? [] } })
  })
  await page.goto('./')
  await expect(page.locator('#release')).toContainText('APK 0.1.7')
  await expect(page.locator('#apk')).toHaveAttribute('href', 'https://github.com/personal-fixture/janko-test/releases/latest/download/Janko-Muzykant-debug.apk')
  await expect(page.getByRole('link', { name: 'Otwórz aplikację web' })).toHaveAttribute('href', '/janko-test/app/')
  if (process.env.JANKO_SCREENSHOTS) await page.screenshot({ path: `${process.env.JANKO_SCREENSHOTS}\\github-pages-${info.project.name}.png`, fullPage: true })
  const manifest = await (await page.request.get('manifest.webmanifest')).json()
  expect(manifest.start_url).toBe('/janko-test/app/')
  expect(manifest.scope).toBe('/janko-test/')
  expect(manifest.icons.every((icon: { src: string }) => icon.src.startsWith('/janko-test/'))).toBe(true)
  await page.getByRole('link', { name: 'Otwórz aplikację web' }).click()
  await page.getByLabel('Mój głos', { exact: true }).selectOption('B')
  await page.getByRole('button', { name: 'Synchronizuj Drive (tylko odczyt)' }).click()
  await expect(page.locator('.phone-song')).toContainText('Piechota')
  await page.locator('.phone-song').click()
  await page.getByRole('button', { name: 'Pobierz materiały na telefon' }).click()
  await expect(page.getByText('2/2 plików na telefonie')).toBeVisible()
  await expect(page.locator('.score-panel canvas')).toBeVisible()
  await page.locator('#player-details').getByRole('button', { name: 'Odtwórz', exact: true }).click()
  await expect.poll(() => page.locator('.persistent-player audio').evaluateAll(nodes => Math.max(...nodes.map(audio => audio.currentTime)))) .toBeGreaterThan(0.1)
  await page.locator('.persistent-player').getByRole('button', { name: 'Pauza', exact: true }).click()
  expect(await page.evaluate(async () => (await navigator.serviceWorker.ready).scope)).toBe('http://127.0.0.1:8790/janko-test/')
  await page.getByRole('button', { name: 'Wróć do biblioteki' }).click()
  await context.setOffline(true)
  await page.reload()
  await expect(page.locator('.phone-song')).toContainText('Piechota')
  await page.locator('.phone-song').click()
  await expect(page.locator('.score-panel canvas')).toBeVisible()
  await page.locator('#player-details').getByRole('button', { name: 'Odtwórz', exact: true }).click()
  await expect.poll(() => page.locator('.persistent-player audio').evaluateAll(nodes => Math.max(...nodes.map(audio => audio.currentTime)))) .toBeGreaterThan(0.1)
  expect(unexpected).toEqual([])
})
