import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'

const songUrl = '/?song=b66a67c3f13dd000ff0b'
const screenshots = process.env.JANKO_SCREENSHOTS

async function fits(page: Page) {
  const original = page.viewportSize()!
  for (const width of new Set([original.width, 360, 430])) {
    await page.setViewportSize({ width, height: original.height })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `overflow at ${width}px`).toBeLessThanOrEqual(width)
  }
  await page.setViewportSize(original)
}

  test.describe('phone workflows', () => {
    test.use({ actionTimeout: 20000 })

    test('compact library, bottom navigation, voice selection and install assets', async ({ page, request }) => {
      const name = test.info().project.name
      await page.goto('/')
      const card = page.locator('.song-card').first()
      await expect(card).toBeVisible()
      const bounds = await card.boundingBox()
      expect(bounds!.width).toBeGreaterThan(page.viewportSize()!.width * 0.85)
      const firstTop = bounds!.y, nextTop = (await page.locator('.song-card').nth(1).boundingBox())!.y
      expect(nextTop).toBeGreaterThan(firstTop + bounds!.height)
      await fits(page)
      const nav = page.getByRole('navigation', { name: 'Nawigacja telefonu' })
      await expect(nav).toBeVisible()
      await nav.getByRole('button', { name: 'Wybierz mój głos' }).tap()
      await page.getByRole('dialog').getByRole('button', { name: 'Bas / baryton', exact: true }).tap()
      await expect(page.getByLabel('Mój głos', { exact: true })).toHaveValue('B')
      if (screenshots) await page.screenshot({ path: path.join(screenshots, `phone-${name}-library.png`) })
      await nav.getByRole('button', { name: 'Ustawienia', exact: true }).tap()
      await expect(page.getByRole('heading', { name: 'Zainstaluj na telefonie' })).toBeVisible()
      await fits(page)
      await page.getByRole('button', { name: 'Zamknij ustawienia' }).tap()
      const manifest = await (await request.get('/manifest.webmanifest')).json()
      expect(manifest.display).toBe('standalone')
      for (const size of ['192x192', '512x512']) {
        const icon = manifest.icons.find((item: { sizes: string }) => item.sizes === size)
        expect(icon).toBeTruthy()
        expect((await request.get(icon.src)).headers()['content-type']).toContain('image/png')
      }
      expect((await request.get('/apple-touch-icon.png')).ok()).toBe(true)
      await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/)
      await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBeGreaterThan(0)
    })

    test('score fits width with swipe/pinch, sticky player, loops and thumb mixer', async ({ page }) => {
      const name = test.info().project.name
      await page.goto(songUrl)
      await page.getByLabel('Mój głos', { exact: true }).selectOption('AI')
      const canvas = page.locator('.pdf-frame canvas')
      await expect(canvas).toBeVisible()
      await expect.poll(() => canvas.evaluate(node => node.width)).toBeGreaterThan(0)
      const frame = page.locator('.pdf-frame')
      expect((await canvas.boundingBox())!.width).toBeLessThanOrEqual((await frame.boundingBox())!.width)
      await fits(page)
      await frame.scrollIntoViewIfNeeded()
      await frame.evaluate(node => {
        // Safari does not expose a constructible Touch. Dispatch equivalent touch data to the real handlers.
        const dispatch = (type: string, touches: { clientX: number; clientY: number }[], changedTouches = touches) => {
          const event = new Event(type, { bubbles: true, cancelable: true })
          Object.defineProperties(event, { touches: { value: touches }, changedTouches: { value: changedTouches } })
          node.dispatchEvent(event)
        }
        dispatch('touchstart', [{ clientX: 270, clientY: 220 }])
        dispatch('touchmove', [{ clientX: 110, clientY: 220 }])
        dispatch('touchend', [], [{ clientX: 110, clientY: 220 }])
      })
      await expect(canvas).toHaveAttribute('aria-label', 'Partytura — strona 2')
      await frame.evaluate(node => {
        const touches = (x: number) => [{ clientX: 80, clientY: 180 }, { clientX: x, clientY: 180 }]
        const dispatch = (type: string, values: { clientX: number; clientY: number }[]) => {
          const event = new Event(type, { bubbles: true, cancelable: true })
          Object.defineProperties(event, { touches: { value: values }, changedTouches: { value: touches(240) } })
          node.dispatchEvent(event)
        }
        dispatch('touchstart', touches(180))
        dispatch('touchmove', touches(240))
        dispatch('touchend', [])
      })
      await expect(page.locator('.score-toolbar')).toContainText('160%')
      await fits(page)
      await page.getByRole('button', { name: 'Dopasuj partyturę do szerokości' }).tap()
      await expect(page.locator('.score-toolbar')).toContainText('100%')
      await page.getByRole('button', { name: 'Odtwórz', exact: true }).tap()
      await expect.poll(() => page.locator('.player audio').evaluateAll(nodes => nodes.some(node => !node.paused && node.currentTime > 0))).toBe(true)
      await page.getByRole('button', { name: 'Pauza', exact: true }).tap()
      await page.getByLabel('Pozycja nagrania').fill('5')
      await page.getByRole('button', { name: /^A —$/ }).tap()
      await page.getByLabel('Pozycja nagrania').fill('8')
      await page.getByRole('button', { name: /^B —$/ }).tap()
      await page.getByRole('button', { name: 'Pętla', exact: true }).tap()
      await page.getByLabel('Tempo ćwiczenia', { exact: true }).fill('0.75')
      await page.locator('footer').scrollIntoViewIfNeeded()
      const play = await page.getByRole('button', { name: 'Odtwórz', exact: true }).boundingBox()
      expect(play!.height).toBeGreaterThanOrEqual(44)
      expect(play!.y + play!.height).toBeLessThan(page.viewportSize()!.height - 64)
      await page.getByRole('button', { name: 'Z chórem', exact: true }).tap()
      expect((await page.getByLabel('Głośność A', { exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(32)
      await page.getByRole('button', { name: 'Jak działa mikser chóru?' }).tap()
      await expect(page.getByRole('tooltip')).toBeVisible()
      await fits(page)
      await page.getByRole('button', { name: 'Jak działa mikser chóru?' }).tap()
      await expect(page.getByRole('tooltip')).not.toBeVisible()
      await frame.scrollIntoViewIfNeeded()
      if (screenshots) await page.screenshot({ path: path.join(screenshots, `phone-${name}-score.png`) })
    })

    test('analysis, Coaching, planning and setlist remain usable without overflow', async ({ page }) => {
      const name = test.info().project.name
      await page.goto(songUrl)
      await page.getByLabel('Mój głos', { exact: true }).selectOption('B')
      await page.getByRole('button', { name: 'Analiza i generowanie', exact: true }).tap()
      await expect(page.getByLabel('Linia do analizy')).toBeEnabled()
      await page.getByRole('button', { name: 'Potwierdź wskazaną pięciolinię' }).tap()
      await page.getByRole('button', { name: 'Generuj nagranie', exact: true }).tap()
      await expect(page.locator('.generated-audio audio')).toBeVisible()
      await fits(page)
      if (screenshots) await page.screenshot({ path: path.join(screenshots, `phone-${name}-analysis.png`) })
      await page.getByRole('button', { name: 'Coaching', exact: true }).tap()
      await expect(page.getByLabel('Wzorzec coachingu')).toBeVisible()
      await page.getByRole('button', { name: 'Dźwięk początkowy', exact: true }).tap()
      if (await page.evaluate(() => typeof window.AudioContext === 'undefined')) {
        await expect(page.locator('.coaching-workspace [role="alert"]')).toContainText('nie obsługuje Web Audio')
      } else await expect(page.locator('.coaching-workspace [role="alert"]')).toHaveCount(0)
      await page.getByRole('button', { name: 'Rozpocznij rozgrzewkę', exact: true }).tap()
      await expect(page.getByRole('button', { name: 'Zatrzymaj rozgrzewkę', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Zatrzymaj rozgrzewkę', exact: true }).tap()
      await fits(page)
      await page.locator('.pitch-panel').evaluate(element => element.scrollIntoView({ block: 'start' }))
      if (screenshots) await page.screenshot({ path: path.join(screenshots, `phone-${name}-coaching.png`) })
      await page.getByRole('navigation', { name: 'Nawigacja telefonu' }).getByRole('button', { name: 'Plan i postępy' }).tap()
      await expect(page.getByRole('heading', { name: 'Plan i postępy', exact: true })).toBeVisible()
      await fits(page)
      if (screenshots) await page.screenshot({ path: path.join(screenshots, `phone-${name}-planning.png`) })
      await page.getByTestId('planning-program-select').selectOption('1vK1jee6NUlVO3oIJoFzqzNSmR8BlPkLg')
      await page.getByRole('button', { name: 'Odtwarzaj program', exact: true }).tap()
      await expect.poll(() => page.locator('.persistent-player audio').evaluateAll(nodes => nodes.some(audio => !audio.paused && audio.currentTime > 0))).toBe(true)
      await page.locator('.persistent-player').getByRole('button', { name: 'Pauza', exact: true }).tap()
      await fits(page)
      if (screenshots) await page.screenshot({ path: path.join(screenshots, `phone-${name}-setlist.png`) })
      await page.setViewportSize({ width: 360, height: 740 })
      await fits(page)
    })
  })
