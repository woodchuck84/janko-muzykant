import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './web-e2e', timeout: 90000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:8788', headless: true },
  projects: [
    { name: 'windows', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: { command: 'npm run web:dev', url: 'http://127.0.0.1:8788', reuseExistingServer: true },
  reporter: 'list',
})
