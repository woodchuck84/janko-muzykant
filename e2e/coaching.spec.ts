import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const microphoneFile = path.resolve('data', 'test-microphone.wav')
const screenshotDir = process.env.JANKO_SCREENSHOTS
test.use({ launchOptions: { args: [
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  `--use-file-for-fake-audio-capture=${microphoneFile}`
] } })
test.beforeAll(() => {
  const sampleRate = 48000, seconds = 30, samples = sampleRate * seconds
  const wav = Buffer.alloc(44 + samples * 2)
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28)
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / sampleRate) * 12000), 44 + i * 2)
  fs.mkdirSync(path.dirname(microphoneFile), { recursive: true }); fs.writeFileSync(microphoneFile, wav)
})
test.afterAll(() => fs.rmSync(microphoneFile, { force: true }))

async function openCoaching(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByLabel('Mój głos', { exact: true }).selectOption('AI')
  await page.locator('.song-card').filter({ has: page.getByRole('heading', { name: 'Piechota', exact: true }) }).click()
  await page.getByRole('button', { name: 'Coaching', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Trener wysokości' })).toBeVisible()
}
test('microphone feedback, local recording, gradual phrase drill and resource cleanup', async ({ page }) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    const streams: MediaStream[] = []
    Object.defineProperty(window, '__testStreams', { get: () => streams })
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await original(constraints); streams.push(stream); return stream
    }
  })
  const errors: string[] = []; page.on('pageerror', err => errors.push(err.message))
  await openCoaching(page)
  await page.getByLabel('Dźwięk tunera', { exact: true }).selectOption('69')
  await page.getByRole('button', { name: 'Włącz mikrofon', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Wyłącz mikrofon', exact: true })).toBeVisible()
  await expect.poll(() => page.locator('.pitch-values').innerText()).toContain('440.')
  await expect(page.locator('.pitch-values .in-tune')).toContainText('¢')
  await page.getByRole('button', { name: 'Nagraj próbę', exact: true }).click()
  await page.waitForTimeout(1600)
  await page.getByRole('button', { name: 'Zatrzymaj nagranie', exact: true }).click()
  await expect(page.getByLabel('Twoje nagrania').locator('option')).toHaveCount(2)
  await expect(page.locator('.recording-panel audio')).toBeVisible()
  await page.locator('.recording-panel audio').evaluate(audio => audio.play())
  await expect.poll(() => page.locator('.recording-panel audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(0.2)
  await page.locator('.recording-panel audio').evaluate(audio => audio.pause())
  await page.getByRole('button', { name: 'Porównaj równocześnie', exact: true }).click()
  await expect.poll(() => page.locator('.coaching-workspace audio').evaluateAll(audios => audios.filter(audio => !audio.paused).length)).toBe(2)
  await page.getByRole('button', { name: 'Zatrzymaj porównanie', exact: true }).click()
  await page.getByRole('button', { name: 'Dźwięk początkowy', exact: true }).click()
  await page.getByLabel('Początek frazy').fill('1')
  await page.getByLabel('Koniec frazy').fill('2')
  await page.getByLabel('Tempo frazy').selectOption('0.6')
  await page.getByRole('button', { name: 'Ćwicz frazę w pętli', exact: true }).click()
  await expect.poll(async () => Number(await page.getByLabel('Tempo frazy').inputValue())).toBeGreaterThan(0.6)
  await page.getByRole('button', { name: 'Zatrzymaj frazę', exact: true }).click()
  await page.getByRole('button', { name: 'Rozpocznij rozgrzewkę', exact: true }).click()
  await expect(page.locator('.warmup-stage')).toContainText('Spokojny oddech')
  await page.getByRole('button', { name: 'Zatrzymaj rozgrzewkę', exact: true }).click()
  await page.getByRole('button', { name: 'Nowe pytanie', exact: true }).click()
  await expect(page.locator('.interval-options button')).toHaveCount(13)
  await page.locator('.interval-options button').first().click()
  await expect(page.locator('.interval-options + .notice')).toBeVisible()
  if (screenshotDir) {
    await page.locator('.recording-panel').screenshot({ path: path.join(screenshotDir, 'recording.png') })
    await page.locator('.pitch-panel').screenshot({ path: path.join(screenshotDir, 'pitch.png') })
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: path.join(screenshotDir, 'coaching.png') })
  }
  await page.getByRole('button', { name: 'Nuty i nagrania', exact: true }).click()
  await expect.poll(() => page.evaluate(() => Reflect.get(window, '__testStreams').every((stream: MediaStream) => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true)
  await page.getByRole('button', { name: 'Coaching', exact: true }).click()
  await expect(page.getByLabel('Twoje nagrania').locator('option')).toHaveCount(2)
  await page.getByLabel('Twoje nagrania').selectOption({ index: 1 })
  await page.getByRole('button', { name: 'Usuń tę próbę', exact: true }).click()
  await expect(page.getByLabel('Twoje nagrania').locator('option')).toHaveCount(1)
  expect(errors).toEqual([])
})

test('microphone permission failure is actionable', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Permission denied', 'NotAllowedError') }
  })
  await openCoaching(page)
  await page.getByRole('button', { name: 'Włącz mikrofon', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Sprawdź zgodę')
  await expect(page.getByRole('button', { name: 'Włącz mikrofon', exact: true })).toBeEnabled()
})

test('score-based coaching guide and memorization', async ({ page, request }) => {
  const library = await (await request.get('/api/library')).json()
  const song = library.songs.find((item: { name: string }) => item.name === 'Piechota')
  const body = { part: 'AI', part_id: 'P2' }
  const response = await request.post(`/api/songs/${song.id}/analyze`, { data: body })
  expect(response.ok()).toBeTruthy()
  const analysis = await response.json()
  const practice = await (await request.post(`/api/songs/${song.id}/practice`, { data: body })).json()
  await page.goto('/')
  await page.evaluate(({ songId, analysis, url }) => localStorage.setItem(`janko.coach.${songId}.AI`, JSON.stringify({ analysis, url, tempoFactor: 1, transpose: 0 })),
    { songId: song.id, analysis, url: practice.url })
  await openCoaching(page)
  await expect(page.getByLabel('Wzorzec coachingu')).toHaveValue(practice.url)
  await page.getByRole('button', { name: 'Ukryj tekst', exact: true }).click()
  await expect(page.locator('.memory-notes>div').first().locator('span')).toHaveText('•••')
  await page.getByLabel('Ukryj nazwy nut').check()
  await expect(page.locator('.memory-notes>div').first().locator('strong')).toHaveText('♪')
  await page.getByRole('button', { name: 'Cały tekst', exact: true }).click()
  await page.getByLabel('Ukryj nazwy nut').uncheck()
  await page.getByRole('button', { name: 'Odtwórz wzorzec', exact: true }).click()
  await expect.poll(() => page.locator('.drill-panel audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(0.2)
  await page.getByRole('button', { name: 'Pauza wzorca', exact: true }).click()
})
