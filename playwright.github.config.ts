import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './github-e2e', timeout: 60000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:8790/janko-test/', headless: true },
  projects: [
    { name: 'windows', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: { command: 'node scripts/serve-pages.mjs', url: 'http://127.0.0.1:8790/janko-test/', reuseExistingServer: false },
  reporter: 'list',
})
