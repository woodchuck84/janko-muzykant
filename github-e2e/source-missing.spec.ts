import { expect, test } from '@playwright/test'
test('unconfigured public site explains Windows library setup without disabling APK download', async ({ page }) => {
  test.skip(process.env.JANKO_EXPECT_MISSING_SOURCE !== 'true', 'Requires a no-source GitHub build.')
  await page.goto('./')
  await expect(page.locator('#drive-source-notice')).toContainText('biblioteka Drive nie jest jeszcze gotowa')
  await expect(page.locator('#apk')).toHaveAttribute('href', /github\.com\/woodchuck84\/janko-muzykant\/releases\/latest\/download/)
  await page.getByRole('link', { name: 'Otwórz aplikację web' }).click()
  await expect(page.getByRole('alert')).toContainText('Dystrybutor nie skonfigurował źródła Drive')
})
