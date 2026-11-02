import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'],
    manifest: {
      name: 'Janko Muzykant — pracownia chóralna',
      short_name: 'Janko',
      description: 'Twoja osobista przestrzeń do nauki śpiewu w chórze.',
      theme_color: '#294c3b',
      background_color: '#f6f4ee',
      display: 'standalone',
      id: '/',
      start_url: '/',
      scope: '/',
      icons: [
        { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ]
    },
    workbox: {
      globPatterns: ['**/*.{js,mjs,css,html,svg,png,webmanifest}'],
      maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      navigateFallbackDenylist: [/^\/api\//],
      runtimeCaching: [{
        urlPattern: /\/api\/(library|config|planning\/state)(\?.*)?$/,
        handler: 'NetworkFirst',
        options: { cacheName: 'janko-library', networkTimeoutSeconds: 4, cacheableResponse: { statuses: [200] } }
      }, {
        urlPattern: /\/api\/(files|practice)\//,
        handler: 'CacheFirst',
        options: { cacheName: 'janko-materials', rangeRequests: true,
          cacheableResponse: { statuses: [200] }, expiration: { maxEntries: 150, purgeOnQuotaError: true } }
      }]
    }
  })],
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8000' } },
  build: { rollupOptions: { output: { manualChunks: {
    notation: ['opensheetmusicdisplay'], pdf: ['pdfjs-dist']
  } } } }
})
