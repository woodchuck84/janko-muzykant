import { test, expect } from '@playwright/test'
import path from 'node:path'

const screenshots = process.env.JANKO_SCREENSHOTS
test.use({ actionTimeout: 20000 })
interface Song { id: string; name: string; files: { id: string; kind: string; part: string | null; slow: boolean; url: string }[] }
interface PlanningState {
  statuses: { song_id: string; status: string }[]
  setlists: { event_id: string; song_ids: string[]; custom: boolean }[]
  dates: { event_id: string; date: string; source?: string; excerpt?: string }[]
  sessions: { today_seconds: number }
  upcoming: { event_id: string; days_until: number }[]
}
const concertId = '1vK1jee6NUlVO3oIJoFzqzNSmR8BlPkLg'
test('real calendar confirmation, readiness persistence, setlist ordering and continuous playback', async ({ page, request }) => {
  const lib = await (await request.get('/api/library')).json() as { songs: Song[] }
  const piechota = lib.songs.find(s => s.name === 'Piechota')!, rota = lib.songs.find(s => s.name === 'Rota')!
  const prior = await (await request.get('/api/planning/state?part=AI')).json() as PlanningState
  const previousStatus = prior.statuses.find(item => item.song_id === piechota.id)?.status ?? 'none'
  const previousOrder = prior.setlists.find(item => item.event_id === concertId)
  const previousDate = prior.dates.find(item => item.event_id === concertId)
  try {
    await request.post('/api/planning/date', { data: { event_id: concertId, date: null } })
    await page.goto(`/?song=${piechota.id}`)
    await page.getByLabel('Mój głos', { exact: true }).selectOption('AI')
    await expect(page.getByTestId('song-progress')).toBeVisible()
    await page.getByTestId('song-progress-status').getByRole('button', { name: /Śpiewam z pamięci/ }).click()
    await expect.poll(async () => {
      const state = await (await request.get('/api/planning/state?part=AI')).json() as PlanningState
      return state.statuses.find(item => item.song_id === piechota.id)?.status
    }).toBe('memory')
    await page.reload()
    await expect(page.getByTestId('song-progress-status').getByRole('button', { name: /Śpiewam z pamięci/ })).toHaveAttribute('aria-pressed', 'true')
    await page.goto('/?view=planning')
    await page.getByRole('button', { name: 'Odczytaj kalendarz PDF', exact: true }).click()
    await expect(page.getByTestId('planning-candidates')).toBeVisible()
    await expect(page.getByTestId('planning-candidates')).not.toHaveAttribute('open', '')
    await page.getByTestId('planning-candidates-summary').click()
    await expect(page.getByTestId('planning-candidates-show-past')).not.toBeChecked()
    await expect(page.getByTestId('planning-candidate').filter({ hasText: 'data minęła' })).toHaveCount(0)
    await page.getByTestId('planning-candidates-show-past').check()
    await expect(page.getByTestId('planning-candidate').filter({ hasText: 'data minęła' })).not.toHaveCount(0)
    await page.getByTestId('planning-candidates-show-past').uncheck()
    const wroclaw = page.getByTestId('planning-candidate').filter({ hasText: 'PDF, str. 1' }).filter({ hasText: '8 listopada 2026' }).first()
    await expect(wroclaw).toContainText('08.11.26')
    await wroclaw.getByTestId('planning-candidate-event').selectOption(concertId)
    await wroclaw.getByTestId('planning-candidate-confirm').click()
    await expect.poll(async () => {
      const state = await (await request.get('/api/planning/state?part=AI')).json() as PlanningState
      return state.dates.find(item => item.event_id === concertId)?.date
    }).toBe('2026-11-08')
    await page.getByTestId('planning-candidates-summary').click()
    await expect(page.getByRole('heading', { name: 'Najbliższe wydarzenia' })).toBeVisible()
    await request.post('/api/planning/setlist', { data: { event_id: concertId, song_ids: [piechota.id, rota.id] } })
    const rotaAudio = rota.files.find(file => file.kind === 'audio' && file.part === 'A' && !file.slow)!
    expect((await request.get(rotaAudio.url, { timeout: 120000 })).ok()).toBeTruthy()
    await page.reload()
    await page.getByTestId('planning-program-select').selectOption(concertId)
    await expect(page.getByTestId('planning-program-row')).toHaveCount(2)
    await page.getByTestId('planning-program-row').first().getByRole('button', { name: 'W dół', exact: true }).click()
    await page.getByTestId('planning-program-save').click()
    await expect.poll(async () => {
      const state = await (await request.get('/api/planning/state?part=AI')).json() as PlanningState
      return state.setlists.find(item => item.event_id === concertId)?.song_ids
    }).toEqual([rota.id, piechota.id])
    await page.getByRole('button', { name: 'Odtwarzaj program', exact: true }).click()
    const player = page.locator('.persistent-player')
    await expect.poll(() => player.locator('audio').evaluateAll(nodes => nodes.some(audio => !audio.paused && audio.currentTime > 0.2))).toBe(true)
    await player.locator('audio').evaluateAll(nodes => { const audio = nodes.find(audio => !audio.paused)!; audio.currentTime = audio.duration - 0.1 })
    await expect(player).toContainText('Piechota')
    await expect.poll(() => player.locator('audio').evaluateAll(nodes => nodes.some(audio => !audio.paused && audio.currentTime > 0.1))).toBe(true)
    await player.getByRole('button', { name: 'Pauza', exact: true }).click()
    await expect(page.getByRole('heading', { name: /Brakujące materiały/ })).toBeVisible()
    await request.post('/api/planning/progress', { data: { song_id: piechota.id, part: 'AI', status: previousStatus } })
    await request.post('/api/planning/setlist', { data: { event_id: concertId, song_ids: previousOrder?.custom ? previousOrder.song_ids : null } })
    await page.reload()
    await expect(page.getByRole('button', { name: 'Odtwarzaj program', exact: true })).toBeVisible()
    if (screenshots) {
      await page.screenshot({ path: path.join(screenshots, 'planning.png') })
      await page.getByRole('button', { name: 'Odtwarzaj program', exact: true }).click()
      await player.locator('.player-controls').screenshot({ path: path.join(screenshots, 'setlist.png') })
    }
  } finally {
    await request.post('/api/planning/progress', { data: { song_id: piechota.id, part: 'AI', status: previousStatus } })
    await request.post('/api/planning/setlist', { data: { event_id: concertId, song_ids: previousOrder?.custom ? previousOrder.song_ids : null } })
    if (previousDate) await request.post('/api/planning/date', { data: previousDate })
  }
})

test('practice timer survives tab navigation and saves real elapsed seconds', async ({ page, request }) => {
  const lib = await (await request.get('/api/library')).json() as { songs: Song[] }
  const song = lib.songs.find(s => s.name === 'Piechota')!
  const before = await (await request.get('/api/planning/state?part=AI')).json() as PlanningState
  await page.goto(`/?song=${song.id}`)
  await page.getByLabel('Mój głos', { exact: true }).selectOption('AI')
  await page.getByRole('button', { name: 'Zacznij ćwiczenie', exact: true }).click()
  await page.waitForTimeout(1100)
  await page.getByRole('button', { name: 'Coaching', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: 'Zakończ i zapisz', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Zacznij ćwiczenie', exact: true })).toBeVisible()
  await expect.poll(async () => (await (await request.get('/api/planning/state?part=AI')).json() as PlanningState).sessions.today_seconds).toBeGreaterThan(before.sessions.today_seconds)
})

test('planning mobile view remains within viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?view=planning')
  await expect(page.getByRole('heading', { name: 'Plan i postępy', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})
