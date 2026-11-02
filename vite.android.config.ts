import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: 'android-ui',
  cacheDir: '..\\node_modules\\.vite-android',
  plugins: [react()],
  optimizeDeps: { exclude: [
    'pdfjs-dist',
    'pdfjs-dist/build/pdf.worker.min.mjs',
    'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  ] },
  // Android WebView may lack the new Uint8Array methods used by PDF.js.
  resolve: { alias: [
    { find: /^pdfjs-dist$/, replacement: fileURLToPath(new URL('./node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url)) },
    { find: /^pdfjs-dist\/build\/pdf\.worker\.min\.mjs(?=\?|$)/, replacement: fileURLToPath(new URL('./node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url)) },
  ] },
  build: { outDir: '..\\dist-android', emptyOutDir: true,
    rollupOptions: { output: { manualChunks: { notation: ['opensheetmusicdisplay'], pdf: ['pdfjs-dist'] } } } }
})
