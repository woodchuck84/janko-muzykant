import { expect, test } from '@playwright/test'

function audioFixture() {
  const sampleRate = 22050, samples = sampleRate * 30, bytes = Buffer.alloc(44 + samples * 2)
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28)
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36)
  bytes.writeUInt32LE(samples * 2, 40)
  for (let index = 0; index < samples; index++) bytes.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * 440 / sampleRate) * 5000), 44 + index * 2)
  return `data:audio/wav;base64,${bytes.toString('base64')}`
}

for (const viewport of [
  { name: 'phone', width: 390, height: 844, mobile: true },
  { name: 'desktop', width: 1440, height: 1000, mobile: false },
]) test(`player queue selects and plays songs, seeks, repeats, and follows automatic progression on ${viewport.name}`, async ({ page }) => {
  await page.setViewportSize({ width: viewport.width, height: viewport.height })
  const recording = audioFixture()
  const song = (id: string, name: string) => ({
    id, name, event_ids: ['event'], files: [{
      id: `${id}-audio`, song_id: id, event_id: 'event', name: `${name} · Alt I`,
      kind: 'audio', part: 'AI', slow: false, full: false, section: '', cached: false,
      url: recording, drive_url: null,
    }],
  })
  const songs = [song('first', 'Pierwszy'), song('second', 'Drugi'), ...Array.from({ length: 10 }, (_, index) => ({
    id: `extra-${index}`, name: `Dodatkowy ${index + 1}`, event_ids: ['event'], files: [],
  }))]
  const library = { events: [{ id: 'event', name: 'Koncert' }], songs, other: [], last_sync: null }
  await page.route('**/api/session', route => route.fulfill({ json: { hosted: false, user_id: 'fixture', email: null, admin: true, csrf: null } }))
  await page.route('**/api/library', route => route.fulfill({ json: library }))
  await page.route('**/api/config', route => route.fulfill({ json: { root_id: 'root', client_id: '', connected: false, last_sync: null, sync: { running: false, message: '', warnings: [], folders: 0, files: 0 } } }))
  await page.route('**/api/planning/state*', route => route.fulfill({ json: {
    part: 'AI', today: '2025-01-01', statuses: [],
    sessions: { today_seconds: 0, streak_days: 0, total_seconds: 0, last_days: [], by_song: {}, recent: [] },
    dates: [], upcoming: [], setlists: [{ event_id: 'event', song_ids: songs.map(item => item.id) }], changes: [], calendar: null,
  } }))
  await page.goto('/')
  await expect(page.getByRole('button', { name: /Pierwszy/ })).toBeVisible()
  await page.getByLabel('Filtr wydarzeń').selectOption('event')
  await page.getByLabel('Mój głos').selectOption('AI')
  if (viewport.mobile) {
    const nav = page.getByRole('navigation', { name: 'Nawigacja telefonu' })
    await nav.getByRole('button', { name: 'Utwory' }).click()
  } else {
    await page.getByRole('button', { name: /Pierwszy/ }).click()
    await page.locator('.persistent-player .queue-button').click()
  }
  let queue = page.getByRole('dialog', { name: 'Utwory' })
  await expect(queue.locator('.queue-row')).toHaveCount(songs.length)
  await expect(queue.locator('.queue-row').first()).toContainText('Pierwszy')
  const lastRow = queue.locator('.queue-row').last()
  await lastRow.scrollIntoViewIfNeeded()
  await expect.poll(() => queue.locator('.queue-list').evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await queue.getByRole('button', { name: /Drugi/ }).click()
  await expect(page).toHaveURL(/song=second/)
  const dock = page.locator('.persistent-player')
  const controls = dock.locator('.player-controls')
  const audio = dock.locator('audio').first()
  await expect.poll(() => audio.evaluate(element => !element.paused && element.currentTime > 0)).toBe(true)
  await controls.getByRole('button', { name: 'Pauza' }).click()
  await controls.locator('.repeat-button').click()
  await expect(controls.locator('.repeat-button')).toHaveAttribute('aria-pressed', 'true')
  if (viewport.mobile) {
    await controls.getByRole('button', { name: 'Pokaż dodatkowe sterowanie' }).click()
    await expect(controls.getByLabel('Pozycja nagrania')).toBeVisible()
    await controls.getByRole('button', { name: 'Ukryj dodatkowe sterowanie' }).click()
  } else {
    await expect(page.locator('#player-details').getByLabel('Pozycja nagrania')).toBeVisible()
  }
  await audio.evaluate(async element => new Promise<void>(resolve => {
    element.addEventListener('seeked', () => resolve(), { once: true })
    element.currentTime = 20
  }))
  await controls.getByRole('button', { name: 'Przewiń 10 sekund wstecz' }).click()
  await expect.poll(() => audio.evaluate(element => element.currentTime)).toBeCloseTo(10, 0)
  await controls.getByRole('button', { name: 'Przewiń 10 sekund do przodu' }).click()
  await expect.poll(() => audio.evaluate(element => element.currentTime)).toBeCloseTo(20, 0)
  await controls.getByRole('button', { name: /Otwórz listę utworów/ }).click()
  queue = page.getByRole('dialog', { name: 'Utwory' })
  await queue.getByRole('button', { name: /Pierwszy/ }).click()
  await expect(page).toHaveURL(/song=first/)
  await expect.poll(() => audio.evaluate(element => !element.paused && element.currentTime > 0)).toBe(true)
  await audio.evaluate(element => {
    element.currentTime = element.duration - 0.1
    element.dispatchEvent(new Event('ended'))
  })
  await expect(page).toHaveURL(/song=second/)
  await expect(page.locator('.song-heading h1')).toHaveText('Drugi')
})
