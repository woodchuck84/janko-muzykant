import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['src/**/*.test.ts', 'android-ui/**/*.test.ts', 'web-standalone/**/*.test.ts', 'functions/**/*.test.js'] } })
