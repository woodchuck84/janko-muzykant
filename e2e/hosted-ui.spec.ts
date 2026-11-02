import { expect, test } from '@playwright/test'

test('hosted choir UI scopes preferences and explains administrator and online boundaries', async ({ page }) => {
  // Backend OAuth and authorization are exercised against fake Google in test_hosted.py.
  let user = 'alice'
  await page.route('**/api/session', route => route.fulfill({ json: {
    hosted: true, user_id: `test-${user}`, email: `${user}@example.com`, admin: false, csrf: 'fake-csrf'
  } }))
  await page.goto('/')
  await expect(page.locator('.hosted-account')).toContainText('alice@example.com')
  await expect(page.getByRole('button', { name: 'Synchronizuj Drive' })).toBeDisabled()
  await page.getByLabel('Mój głos', { exact: true }).selectOption('B')
  expect(await page.evaluate(() => localStorage.getItem('account.test-alice.janko.part'))).toBe('B')
  expect(await page.evaluate(() => localStorage.getItem('janko.part'))).toBeNull()
  expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then(values => values.length))).toBe(0)
  await page.getByRole('button', { name: 'Ustawienia i połączenie' }).click()
  await expect(page.getByRole('dialog')).toContainText('Tokeny dostępu pozostają wyłącznie na serwerze')
  await expect(page.getByRole('dialog')).toContainText('tryb chóru wymaga internetu')
  await expect(page.getByRole('button', { name: 'Rozłącz Google' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Zamknij ustawienia' }).click()
  await page.goto('/?song=b66a67c3f13dd000ff0b')
  await page.getByRole('button', { name: 'Analiza i generowanie', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Importuj MusicXML', exact: true })).toBeDisabled()
  await expect(page.getByText(/Przewodnik instrumentalny powstaje na serwerze chóru/)).toBeVisible()
  await page.getByRole('button', { name: 'Plan i postępy', exact: true }).first().click()
  await expect(page.getByRole('button', { name: 'Odczytaj kalendarz PDF' })).toBeDisabled()
  user = 'bob'
  await page.reload()
  await expect(page.locator('.hosted-account')).toContainText('bob@example.com')
  await expect(page.getByLabel('Mój głos', { exact: true })).toHaveValue('AI')
  expect(await page.evaluate(() => localStorage.getItem('account.test-alice.janko.part'))).toBe('B')
})
