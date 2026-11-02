import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 180000,
  expect: { timeout: 20000 },
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:8000', viewport: { width: 1440, height: 1000 }, headless: true },
  projects: [
    { name: 'chromium', testIgnore: '**/phone.spec.ts', use: { browserName: 'chromium' } },
    { name: 'android', testMatch: '**/phone.spec.ts', use: { ...devices['Pixel 7'] } },
    { name: 'iphone', testMatch: '**/phone.spec.ts', use: { ...devices['iPhone 14'], browserName: 'webkit' } }
  ],
  reporter: 'list'
})
