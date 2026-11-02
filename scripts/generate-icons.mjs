import { chromium } from 'playwright'
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = path.join(root, 'public')
const res = path.join(root, 'android', 'app', 'src', 'main', 'res')
const source = await readFile(path.join(publicDir, 'choir-icon.svg'), 'utf8')
const artwork = source.match(/<g id="choir">([\s\S]*?)<\/g>/)?.[1]
if (!artwork) throw new Error('The icon source must contain the choir artwork group.')
const green = '#294c3b', cream = '#f6f4ee'
const monochrome = artwork.replace(/<path fill="#294c3b"[^>]*\/>/g, '')
const svg = (body, size = 108) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 108 108">${body}</svg>`
const glyph = (scale, body = artwork) => `<g transform="translate(54 54) scale(${scale}) translate(-54 -54)">${body}</g>`
const fullIcon = (round = false) => svg(`<${round ? 'circle cx="54" cy="54" r="54"' : 'rect width="108" height="108" rx="22"'} fill="${green}"/>${glyph(1.15)}`)
const maskable = svg(`<rect width="108" height="108" fill="${green}"/>${glyph(0.9)}`)
await writeFile(path.join(publicDir, 'icon.svg'), fullIcon() + '\n')

function vector(body) {
  const paths = [...body.matchAll(/<path\b([^>]+)\/>/g)].map(([, attrs]) => {
    const fill = attrs.match(/fill="([^"]+)"/)?.[1]
    const data = attrs.match(/\bd="([^"]+)"/)?.[1]
    if (!fill || !data) throw new Error('Icon paths must specify a fill and path data.')
    return `        <path android:fillColor="${fill}" android:fillType="${attrs.includes('fill-rule="evenodd"') ? 'evenOdd' : 'nonZero'}" android:pathData="${data}"/>`
  }).join('\n')
  return `<?xml version="1.0" encoding="utf-8"?>\n<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">\n    <group android:pivotX="54" android:pivotY="54" android:scaleX="0.8" android:scaleY="0.8">\n${paths}\n    </group>\n</vector>\n`
}
await writeFile(path.join(res, 'drawable-v24', 'ic_launcher_foreground.xml'), vector(artwork))
await writeFile(path.join(res, 'drawable', 'ic_launcher_monochrome.xml'), vector(monochrome.replaceAll(cream, '#ffffff')))
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 })
  async function png(body, size) {
    return Buffer.from(await page.evaluate(async ({ body, size }) => {
      const image = new Image()
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(body)}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      canvas.getContext('2d').drawImage(image, 0, 0, size, size)
      return canvas.toDataURL('image/png').split(',')[1]
    }, { body, size }), 'base64')
  }
  for (const [density, size] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
    const dir = path.join(res, `mipmap-${density}`)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'ic_launcher.png'), await png(fullIcon(), size))
    await writeFile(path.join(dir, 'ic_launcher_round.png'), await png(fullIcon(true), size))
    await writeFile(path.join(dir, 'ic_launcher_foreground.png'), await png(svg(glyph(0.8)), size * 108 / 48))
  }
  for (const [file, size, body] of [
    ['icon-192.png', 192, fullIcon()], ['icon-512.png', 512, fullIcon()],
    ['apple-touch-icon.png', 180, svg(`<rect width="108" height="108" fill="${green}"/>${glyph(1.15)}`)],
    ['icon-maskable-512.png', 512, maskable],
  ]) await writeFile(path.join(publicDir, file), await png(body, size))

  for (const dir of await readdir(res, { withFileTypes: true })) {
    if (!dir.isDirectory() || !dir.name.startsWith('drawable')) continue
    const splash = path.join(res, dir.name, 'splash.png')
    let bytes
    try { bytes = await readFile(splash) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
    const body = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${cream}"/><svg x="${(width - Math.min(width, height) * 0.3) / 2}" y="${(height - Math.min(width, height) * 0.3) / 2}" width="${Math.min(width, height) * 0.3}" height="${Math.min(width, height) * 0.3}" viewBox="0 0 108 108">${fullIcon().replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg></svg>`
    const rendered = await page.evaluate(async ({ body, width, height }) => {
      const image = new Image()
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(body)}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      canvas.getContext('2d').drawImage(image, 0, 0)
      return canvas.toDataURL('image/png').split(',')[1]
    }, { body, width, height })
    await writeFile(splash, Buffer.from(rendered, 'base64'))
  }
  const previewDir = process.env.JANKO_ICON_PREVIEW
  if (previewDir) {
    await mkdir(previewDir, { recursive: true })
    await writeFile(path.join(previewDir, 'vox-apostoli-icon-512.png'), await png(fullIcon(), 512))
    const data = body => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(body)}`
    await page.setContent(`<html><body style="margin:0;padding:40px;background:${cream};color:${green};font:20px system-ui"><h1 style="margin:0">Vox Apostoli · radosny chór</h1><p>Autorska ikona Janko Muzykant · Android / web</p><div style="display:flex;gap:32px;align-items:end">${[192, 96, 48, 32, 24].map(size => `<div style="text-align:center"><img width="${size}" height="${size}" src="${data(fullIcon())}"/><p>${size} px</p></div>`).join('')}</div><h2>Maski adaptacyjne · bezpieczny obszar</h2><div style="display:flex;gap:32px">${[['Koło', '50%'], ['Zaokrąglona', '24%'], ['Kwadrat', '0']].map(([label, radius]) => `<div style="text-align:center"><div style="width:160px;height:160px;border-radius:${radius};overflow:hidden;background:${green}"><img width="160" height="160" src="${data(svg(glyph(0.8)))}"/></div><p>${label}</p></div>`).join('')}<div style="text-align:center"><div style="width:160px;height:160px;border-radius:50%;background:#c9e6d5"><img width="160" height="160" src="${data(svg(glyph(0.8, monochrome.replaceAll(cream, green))))}"/></div><p>Monochrome</p></div></div><p>Trzy śpiewające postacie · wspólny śpiewnik VA · nuta</p></body></html>`)
    await page.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())))
    await page.screenshot({ path: path.join(previewDir, 'vox-apostoli-icon-sizes-and-masks.png'), fullPage: true })
  }
} finally {
  await browser.close()
}
console.log('Generated Android, splash and PWA choir icons from public\\choir-icon.svg.')
