import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'
const base = process.env.VITE_BASE_PATH || '/'
if (!/^\/(?:[\w.-]+\/)*$/.test(base)) throw new Error('VITE_BASE_PATH must be an absolute directory path ending in /.')

export default defineConfig({
  root: 'web-standalone',
  base,
  publicDir: '../public',
  define: { 'import.meta.env.VITE_JANKO_PLATFORM': JSON.stringify('web-standalone'),
    'import.meta.env.VITE_GOOGLE_DRIVE_API_KEY': JSON.stringify('') },
  plugins: [{ name: 'standalone-local-fonts', enforce: 'pre', transform(source, id) {
    if (id.replaceAll('\\', '/').endsWith('/src/style.css'))
      return source.replace(/^@import[^\n]*fonts\.googleapis\.com[^\n]*\r?\n/m, '')
  } }, react(), VitePWA({
    registerType: 'prompt',
    manifest: {
      name: 'Janko Muzykant — Vox Apostoli', short_name: 'Janko', lang: 'pl',
      description: 'Samodzielna pracownia chóralna — materiały publiczne Google Drive, prywatne ćwiczenie na urządzeniu.',
      theme_color: '#294c3b', background_color: '#f6f4ee', display: 'standalone',
      id: `${base}app/`, start_url: `${base}app/`, scope: base,
      icons: [{ src: `${base}icon-192.png`, sizes: '192x192', type: 'image/png' },
        { src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png' },
        { src: `${base}icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' }],
    },
    workbox: { clientsClaim: true, skipWaiting: false, maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      globPatterns: ['**/*.{js,mjs,css,html,svg,png,webmanifest}'],
      globIgnores: ['downloads/**'],
      navigateFallback: `${base}app/index.html`, navigateFallbackDenylist: [/\/api\//, /\/downloads\//, /\/version\.json$/, /\/__janko_files\//],
      runtimeCaching: [{ urlPattern: /\/__janko_files\//, handler: 'CacheOnly',
        options: { cacheName: base === '/' ? 'janko-public-files' : `janko-public-files${base}`, rangeRequests: true } }],
    },
  })],
  resolve: { alias: [{ find: /^pdfjs-dist$/, replacement: fileURLToPath(new URL('./node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url)) },
    { find: /^pdfjs-dist\/build\/pdf\.worker\.min\.mjs(?=\?|$)/, replacement: fileURLToPath(new URL('./node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url)) }] },
  build: { outDir: '../dist-web', emptyOutDir: true, rollupOptions: {
    input: { landing: fileURLToPath(new URL('./web-standalone/index.html', import.meta.url)),
      app: fileURLToPath(new URL('./web-standalone/app/index.html', import.meta.url)) },
    output: { manualChunks: { notation: ['opensheetmusicdisplay'], pdf: ['pdfjs-dist'] } },
  } },
})
