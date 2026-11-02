import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './mobile-e2e', testMatch: '**/*.spec.ts', timeout: 60000, workers: 1,
  use: { ...devices['Pixel 7'], baseURL: 'http://127.0.0.1:5174', headless: true },
  webServer: { command: 'npx vite --config vite.android.config.ts --host 127.0.0.1 --port 5174 --strictPort',
    url: 'http://127.0.0.1:5174', reuseExistingServer: false },
  reporter: 'list'
})
