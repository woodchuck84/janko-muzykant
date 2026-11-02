import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
const base = process.env.VITE_BASE_PATH || '/janko-test/'
const root = path.resolve('dist-web')
const types = { '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css',
  '.html': 'text/html;charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png' }
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (!url.pathname.startsWith(base)) { res.writeHead(404).end(); return }
    let file = path.resolve(root, '.' + path.sep + decodeURIComponent(url.pathname.slice(base.length)))
    if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403).end(); return }
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html')
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
    res.end(await readFile(file))
  } catch { res.writeHead(404).end() }
}).listen(8790, '127.0.0.1', () => console.log(`Static Pages preview: http://127.0.0.1:8790${base}`))
