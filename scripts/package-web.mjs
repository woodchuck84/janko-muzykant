import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
const github = process.env.VITE_JANKO_GITHUB === 'true'
if (github) {
  const repo = process.env.GITHUB_REPOSITORY
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('GITHUB_REPOSITORY is required (owner/repo).')
  const url = `https://github.com/${repo}/releases/latest/download/`
  // CI downloads version.json and APK from the same existing release; never signs an APK.
  const release = JSON.parse((await readFile('release-version.json', 'utf8')).replace(/^\uFEFF/, ''))
  const apk = await readFile('release.apk')
  if (!Number.isInteger(release.versionCode) || !/^[a-f0-9]{64}$/i.test(release.sha256) ||
      createHash('sha256').update(apk).digest('hex') !== release.sha256.toLowerCase() ||
      release.apkUrl !== `${url}Janko-Muzykant-debug.apk`) throw new Error('Release APK/version/hash mismatch.')
  const source = await readFile('src/DistributionNotice.tsx', 'utf8')
  if (release.apkVersion !== source.match(/DISTRIBUTION_VERSION = '([^']+)'/)?.[1] ||
      release.versionCode !== Number(source.match(/ANDROID_VERSION_CODE = (\d+)/)?.[1]))
    throw new Error('Build source version does not match latest release. Publish the matching release first.')
  await writeFile('dist-web/version.json', JSON.stringify({ ...release, webVersion: release.apkVersion }, null, 2) + '\n')
  await writeFile('dist-web/.nojekyll', '')
  console.log(`GitHub Pages package for ${repo}; APK verified against release SHA-256.`)
  process.exit(0)
}
const apk = await readFile('Janko-Muzykant-debug.apk')
// Prevent metadata from advertising a version other than the packaged APK.
const bytes = apk.length
if (bytes > 25 * 1024 * 1024) throw new Error('APK exceeds the Cloudflare Pages 25 MiB asset limit.')
const metadata = await readFile('android/app/build.gradle', 'utf8')
const apkVersion = metadata.match(/versionName "([^"]+)"/)?.[1]
const versionCode = Number(metadata.match(/versionCode (\d+)/)?.[1])
const version = await readFile('src/DistributionNotice.tsx', 'utf8')
const webVersion = version.match(/DISTRIBUTION_VERSION = '([^']+)'/)?.[1]
if (!apkVersion || !versionCode || !webVersion || apkVersion !== webVersion) throw new Error('Version metadata does not match.')
const built = JSON.parse((await readFile('Janko-Muzykant-apk.json', 'utf8')).replace(/^\uFEFF/, ''))
if (built.apkVersion !== apkVersion || built.versionCode !== versionCode ||
  built.sha256 !== createHash('sha256').update(apk).digest('hex'))
  throw new Error('APK does not match the recorded build version/hash. Run npm run android:apk first.')
await mkdir(path.join('dist-web', 'downloads'), { recursive: true })
await copyFile('Janko-Muzykant-debug.apk', path.join('dist-web', 'downloads', 'Janko-Muzykant-debug.apk'))
await writeFile(path.join('dist-web', 'version.json'), JSON.stringify({ webVersion, apkVersion, versionCode,
  sha256: createHash('sha256').update(apk).digest('hex'), apkUrl: '/downloads/Janko-Muzykant-debug.apk', bytes }, null, 2) + '\n')
const proxy = process.env.VITE_JANKO_DRIVE_PROXY_URL ? new URL(process.env.VITE_JANKO_DRIVE_PROXY_URL) : null
if (proxy && proxy.protocol !== 'https:') throw new Error('Configured external proxy requires HTTPS.')
const headers = (await readFile('web-standalone/_headers', 'utf8')).replace("connect-src 'self';",
  `connect-src 'self' https://www.googleapis.com${proxy ? ` ${proxy.origin}` : ''};`)
await writeFile(path.join('dist-web', '_headers'), headers)
await writeFile(path.join('dist-web', '_routes.json'), JSON.stringify({ version: 1, include: ['/api/*'], exclude: [] }))
console.log(`Packaged PWA ${webVersion} and APK ${apkVersion}; sha256 ${createHash('sha256').update(apk).digest('hex')}`)
