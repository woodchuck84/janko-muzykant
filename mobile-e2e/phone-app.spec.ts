import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const xml = readFileSync(path.join('backend', 'tests', 'fixtures', 'practice.musicxml'), 'utf8')
  .replaceAll(/<part-name>[^<]+<\/part-name>/g, '<part-name>Voice</part-name>')
const pdf = readFileSync(path.join('data', 'cache', '1K4dwGq7LdZaxMbY2kvzri-3ODJ7AbVwd.pdf'))
const audio = readFileSync(path.join('data', 'cache', '1YAk_fU0jbiUdAbUGBcGZEPTGK-g4cM09.m4a'))
const calendar = readFileSync(path.join('data', 'cache', '1RUbElY5q773AMqRD-mg34iML73t0Zx3G.pdf'))
const screenshotDir = process.env.JANKO_SCREENSHOTS
const plugin = `
export const ROOT_ID='root-folder';
export const isStandaloneWeb=false;
export const fileUrl=file=>file.url;
const account={id:sessionStorage.getItem('test-account')||'google-sub-fixture',email:'choir-fixture@example.com',lastVerified:Date.now()};
const F='application/vnd.google-apps.folder';
const tree={'root-folder':[{id:'event-folder',name:'Koncert',mimeType:F},{id:'calendar',name:'Kalendarz 2026_2027.pdf',mimeType:'application/pdf'}],
'event-folder':[{id:'song-folder',name:'Piechota',mimeType:F}],
'song-folder':[{id:'pdf',name:'Piechota.pdf',mimeType:'application/pdf'},
{id:'audio',name:'B - Piechota.m4a',mimeType:'audio/mp4'},
{id:'xml',name:'Piechota.musicxml',mimeType:'application/xml'}]};
let state=localStorage.getItem('test-native-state.'+account.id);let signed=sessionStorage.getItem('test-signed')==='yes';
export const Drive={
initialize:async()=>({account:signed?account:null}),
connect:async()=>{const code=sessionStorage.getItem('test-connect-error');if(code)throw Object.assign(Error('(Google status 10)'),{code});signed=true;sessionStorage.setItem('test-signed','yes');return{account}},
verify:async()=>{if(sessionStorage.getItem('test-delay'))await new Promise(r=>setTimeout(r,1000));const code=sessionStorage.getItem('test-error');if(code)throw Object.assign(Error(code),{code});if(!signed)throw Error('Not connected');return{account}},
list:async({folderId})=>({files:tree[folderId]||[]}),
download:async({id})=>{if(sessionStorage.getItem('test-download-delay'))await new Promise(r=>setTimeout(r,1500));return{path:id,url:id==='pdf'?'/fixture.pdf':id==='calendar'?'/fixture-calendar.pdf':id==='audio'?'/fixture.m4a':'/fixture.musicxml'}},
readState:async()=>({state}),writeState:async value=>{state=value.state;localStorage.setItem('test-native-state.'+account.id,state)},
saveGenerated:async({base64})=>({path:'private/generated/guide.wav',url:'data:audio/wav;base64,'+base64}),
importXml:async()=>({id:'local-import',name:'Import.musicxml',mimeType:'application/xml',path:'xml',url:'/fixture.musicxml'}),
requestMicrophone:async()=>({granted:true}),
signOut:async()=>{signed=false;state=null;sessionStorage.removeItem('test-signed');localStorage.removeItem('test-native-state.'+account.id)}
};`
async function fixtures(page: Page) {
  await page.route('**/native.ts', route => route.fulfill({ contentType: 'application/javascript', body: plugin }))
  await page.route('**/fixture.pdf', route => route.fulfill({ contentType: 'application/pdf', body: pdf }))
  await page.route('**/fixture.m4a', route => route.fulfill({ contentType: 'audio/mp4', body: audio }))
  await page.route('**/fixture.musicxml', route => route.fulfill({ contentType: 'application/xml', body: xml }))
  await page.route('**/fixture-calendar.pdf', route => route.fulfill({ contentType: 'application/pdf', body: calendar }))
}
async function noOverflow(page: Page) {
  for (const width of [360, 393, 430]) {
    await page.setViewportSize({ width, height: 852 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  }
}
test('APK checks the configured distribution site and links a newer installer', async ({ page }) => {
  await fixtures(page)
  await page.route('https://choir.example/version.json', route => route.fulfill({
    headers: { 'Access-Control-Allow-Origin': '*' }, json: {
      webVersion: '0.1.8', apkVersion: '0.1.8', versionCode: 9, sha256: 'a'.repeat(64),
      apkUrl: '/downloads/Janko-Muzykant-debug.apk',
    },
  }))
  await page.goto('/')
  await page.locator('.distribution-notice summary').click()
  await page.getByLabel('Strona dystrybucji (HTTPS)').fill('https://choir.example')
  await page.getByRole('button', { name: 'Sprawdź aktualizacje' }).click()
  await expect(page.getByText('Dostępna nowa wersja', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Pobierz aktualizację APK' })).toHaveAttribute('href', 'https://choir.example/')
})
test('changing voice during a download cancels stale playback preparation', async ({ page }) => {
  await fixtures(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Połącz Google Drive', exact: true }).click()
  await page.getByLabel('Mój głos', { exact: true }).selectOption('B')
  await page.getByRole('button', { name: 'Synchronizuj Drive (tylko odczyt)' }).click()
  await expect(page.locator('.phone-song')).toContainText('Piechota')
  await page.evaluate(() => sessionStorage.setItem('test-download-delay', 'yes'))
  await page.locator('.phone-song').click()
  await expect(page.locator('.persistent-player')).toContainText('Przygotowanie nagrania')
  await page.getByLabel('Mój głos', { exact: true }).selectOption('SII')
  await expect(page.locator('.persistent-player [role=alert]')).toContainText('brak nagrania Sopran II')
  await page.waitForTimeout(2000)
  await expect(page.locator('.persistent-player [role=alert]')).toContainText('brak nagrania Sopran II')
  await expect(page.locator('.persistent-player [role=status]')).toHaveCount(0)
  await expect(page.locator('.persistent-player').getByRole('button', { name: 'Odtwórz', exact: true })).toBeDisabled()
})
test('APK update checks preserve the GitHub project path and accept the release asset URL', async ({ page }) => {
  await fixtures(page)
  await page.route('https://personal.example/janko/version.json', route => route.fulfill({ json: {
    webVersion: '0.1.8', apkVersion: '0.1.8', versionCode: 9, sha256: 'a'.repeat(64),
    apkUrl: 'https://github.com/personal-user/janko/releases/latest/download/Janko-Muzykant-debug.apk',
  } }))
  await page.goto('/')
  await page.locator('.distribution-notice summary').click()
  await page.getByLabel('Strona dystrybucji (HTTPS)').fill('https://personal.example/janko/')
  await page.getByRole('button', { name: 'Sprawdź aktualizacje' }).click()
  await expect(page.getByText('Dostępna nowa wersja', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Pobierz aktualizację APK' })).toHaveAttribute('href', 'https://personal.example/janko/')
})
test('bundled Android UI syncs authorized materials and renders/synthesizes locally without any API server', async ({ page }) => {
  const apiRequests: string[] = []
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()) })
  await fixtures(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Połącz Google Drive', exact: true }).click()
  await page.getByLabel('Mój głos', { exact: true }).selectOption('B')
  await page.getByRole('button', { name: 'Synchronizuj Drive (tylko odczyt)' }).click()
  await expect(page.locator('.phone-song')).toContainText('Piechota')
  await noOverflow(page)
  await page.locator('.phone-song').click()
  await expect(page.locator('.score-panel canvas')).toBeVisible()
  await expect(page.locator('.persistent-player .player-controls')).toHaveCSS('position', 'fixed')
  const title = await page.locator('.persistent-player .dock-track').boundingBox()
  const titleButton = await page.locator('.persistent-player .dock-track button').boundingBox()
  expect(titleButton!.height).toBeGreaterThanOrEqual(44)
  expect(titleButton!.y + titleButton!.height).toBeLessThanOrEqual(title!.y + title!.height + 1)
  await page.getByRole('button', { name: 'Postęp i czas ćwiczenia' }).click()
  await page.getByRole('button', { name: 'Zacznij ćwiczenie' }).click()
  await expect(page.getByRole('button', { name: 'Zakończ i zapisz' })).toBeVisible()
  await page.waitForTimeout(1100)
  await page.getByRole('button', { name: 'Zakończ i zapisz' }).click()
  await expect(page.getByText(/Zapisano .* ćwiczenia na telefonie/)).toBeVisible()
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('test-native-state.google-sub-fixture')!).practiceLog?.[0]?.seconds ?? 0)).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Postęp i czas ćwiczenia' }).click()
  await page.getByRole('button', { name: 'Pobierz materiały na telefon' }).click()
  await expect(page.getByText('3/3 plików na telefonie')).toBeVisible()
  await expect(page.locator('.score-panel canvas')).toBeVisible()
  await page.locator('.persistent-player').getByRole('button', { name: 'Odtwórz', exact: true }).click()
  await expect(page.locator('.persistent-player').getByRole('button', { name: 'Pauza', exact: true })).toBeVisible()
  await page.locator('.persistent-player').getByRole('button', { name: 'Pauza', exact: true }).click()
  await noOverflow(page)
  await page.locator('footer').scrollIntoViewIfNeeded()
  const dock = await page.locator('.persistent-player .player-controls').boundingBox()
  const nav = await page.getByRole('navigation', { name: 'Nawigacja telefonu' }).boundingBox()
  expect(dock!.y + dock!.height).toBeLessThanOrEqual(nav!.y + 1)
  await page.getByRole('button', { name: 'Wybierz mój głos' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Bas / baryton', exact: true }).click()
  await expect(page.getByLabel('Mój głos', { exact: true })).toHaveValue('B')
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'android-app-score-fixture.png'), fullPage: true })
  await page.getByRole('button', { name: 'Analiza', exact: true }).click()
  await expect(page.getByText(/nie rozpoznaje automatycznie nut/)).toBeVisible()
  await page.getByRole('button', { name: 'Odczytaj pięciolinie' }).click()
  await expect(page.getByRole('combobox', { name: 'Pięciolinia', exact: true })).toHaveValue('P4')
  await page.getByLabel(/Sprawdzono nuty/).check()
  await page.getByRole('button', { name: 'Generuj WAV', exact: true }).click()
  await expect(page.getByText('Zakres G2 — G3')).toBeVisible()
  await expect(page.locator('.phone-notation svg').first()).toBeVisible()
  await noOverflow(page)
  await expect(page.getByRole('alert')).toHaveCount(0)
  const guideAudio = page.locator('.phone-stack audio')
  await guideAudio.evaluate(audio => audio.play())
  await expect.poll(() => guideAudio.evaluate(audio => audio.currentTime)).toBeGreaterThan(0.1)
  await guideAudio.evaluate(audio => audio.pause())
  await expect(page.locator('.score-note-link').first()).toBeVisible()
  const note = page.locator('.score-note-link[data-note-time]').nth(2)
  const noteTime = Number(await note.getAttribute('data-note-time'))
  await note.click()
  await expect.poll(() => guideAudio.evaluate(audio => audio.currentTime)).toBeGreaterThanOrEqual(noteTime)
  await expect(page.locator('.score-note-active')).not.toHaveCount(0)
  await guideAudio.evaluate(audio => audio.pause())
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'android-app-analysis-fixture.png'), fullPage: true })
  await page.getByRole('button', { name: 'Coaching', exact: true }).click()
  await expect(page.getByText(/Cel z partii P4/)).toBeVisible()
  await noOverflow(page)
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'android-app-coaching-fixture.png'), fullPage: true })
  await page.getByRole('button', { name: 'Analiza', exact: true }).click()
  await page.getByRole('button', { name: 'Odczytaj pięciolinie' }).click()
  await expect(page.getByRole('heading', { name: 'Przewodnik instrumentalny' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Coaching', exact: true }).click()
  await expect(page.getByText(/Cel z partii P4/)).toHaveCount(0)
  await page.getByRole('button', { name: 'Plan', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Brakujące materiały' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Mój tydzień' })).toBeVisible()
  await expect(page.locator('.phone-practice-week>div')).toHaveCount(7)
  await expect(page.getByText(/Łącznie dla Bas \/ baryton: [1-9]/)).toBeVisible()
  await page.getByRole('button', { name: 'Odczytaj daty z PDF', exact: true }).click()
  await expect(page.getByText(/Znaleziono \d+ dat/)).toBeVisible()
  await page.getByLabel('Przypisz do wydarzenia').selectOption('event-folder')
  await page.getByText(/Lista dat z kontekstem/).click()
  await page.getByRole('button', { name: 'Potwierdź 2025-09-20', exact: true }).first().click()
  await expect(page.getByText('Zapisano Twoją datę: 2025-09-20.', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('test-native-state.google-sub-fixture')!).dates['event-folder'])).toBe('2025-09-20')
  await page.getByRole('button', { name: 'Odtwarzaj program', exact: true }).click()
  await expect.poll(() => page.locator('.player audio').evaluateAll(nodes => nodes.some(audio => !audio.paused && audio.currentTime > 0.1))).toBe(true)
  await page.locator('.player audio').first().evaluate(audio => audio.dispatchEvent(new Event('ended')))
  await expect(page.getByRole('button', { name: 'Pauza', exact: true })).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('combobox', { name: 'Postęp Piechota' }).selectOption('concert')
  await noOverflow(page)
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'android-app-planning-fixture.png'), fullPage: true })
  await page.getByRole('button', { name: 'Ustawienia', exact: true }).click()
  await expect(page.getByText(/Usunięcie danych usuwa lokalną bibliotekę/)).toBeVisible()
  await noOverflow(page)
  page.on('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Wyloguj i usuń dane konta', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Połącz Google Drive', exact: true })).toBeVisible()
  expect(apiRequests).toEqual([])
})

test('phone playback survives tabs/settings and repeats or stops at a missing voice instead of substituting', async ({ page }) => {
  await fixtures(page)
  const expanded = plugin + `
tree['event-folder'].push({id:'rota-folder',name:'Rota',mimeType:F},{id:'missing-folder',name:'Bez basu',mimeType:F});
tree['rota-folder']=[{id:'audio2',name:'B - Rota.m4a',mimeType:'audio/mp4'}];
tree['missing-folder']=[{id:'s-only',name:'S - Bez basu.m4a',mimeType:'audio/mp4'}];
const download=Drive.download; Drive.download=async options=>options.id==='audio2'?{path:'audio2',url:'/fixture.m4a'}:download(options);`
  await page.route('**/native.ts', route => route.fulfill({ contentType: 'application/javascript', body: expanded }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Połącz Google Drive', exact: true }).click()
  await page.getByLabel('Mój głos', { exact: true }).selectOption('B')
  await page.getByRole('button', { name: 'Synchronizuj Drive (tylko odczyt)' }).click()
  await page.locator('.phone-song').filter({ hasText: 'Piechota' }).click()
  const player = page.locator('.persistent-player')
  const module = page.locator('#player-details')
  const pageControl = page.locator('.song-page-actions .song-playback-button')
  await expect(module.getByRole('heading', { name: 'Posłuchaj. Powtórz. Zaśpiewaj.' })).toBeVisible()
  await expect(module.getByRole('button', { name: 'Z chórem' })).toBeVisible()
  await expect(pageControl).toHaveAttribute('aria-label', 'Odtwórz Piechota')
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'song-page-player-android.png'), fullPage: true })
  await pageControl.click()
  await expect.poll(() => player.locator('audio').evaluateAll(nodes => nodes.some(audio => !audio.paused && audio.currentTime > 0.2))).toBe(true)
  await expect(pageControl).toHaveAttribute('aria-label', 'Pauza Piechota')
  await player.getByRole('button', { name: 'Pauza', exact: true }).click()
  await expect(pageControl).toHaveAttribute('aria-label', 'Odtwórz Piechota')
  await expect(module.getByRole('button', { name: 'Odtwórz', exact: true })).toBeVisible()
  await module.getByRole('button', { name: 'Odtwórz', exact: true }).click()
  await expect(pageControl).toHaveAttribute('aria-label', 'Pauza Piechota')
  await page.getByRole('button', { name: 'Biblioteka', exact: true }).first().click()
  await page.locator('.phone-song').filter({ hasText: 'Rota' }).click()
  await expect(module).toContainText('Aktualnie odtwarzane: Piechota')
  await expect(module.getByRole('button', { name: 'Odtwórz Rota', exact: true })).toBeVisible()
  await module.getByRole('button', { name: 'Odtwórz Rota', exact: true }).click()
  await expect(module).toContainText('Aktualnie odtwarzane: Rota')
  await expect(page.locator('.song-page-actions .song-playback-button')).toHaveAttribute('aria-label', 'Pauza Rota')
  await page.getByRole('button', { name: 'Biblioteka', exact: true }).first().click()
  await page.locator('.phone-song').filter({ hasText: 'Piechota' }).click()
  await expect(module.getByRole('button', { name: 'Odtwórz Piechota', exact: true })).toBeVisible()
  await module.getByRole('button', { name: 'Odtwórz Piechota', exact: true }).click()
  await expect(module).toContainText('Aktualnie odtwarzane: Piechota')
  await expect.poll(() => player.locator('audio').evaluateAll(nodes => nodes.filter(audio => !audio.paused && audio.currentTime > 0.1).length === 1)).toBe(true)
  await page.getByRole('button', { name: 'Analiza', exact: true }).click()
  await page.getByRole('button', { name: 'Plan', exact: true }).click()
  await page.getByRole('button', { name: 'Ustawienia', exact: true }).click()
  await expect(player.getByRole('button', { name: 'Pauza', exact: true })).toBeVisible()
  await player.getByRole('button', { name: 'Cały utwór', exact: true }).click()
  await player.locator('audio').evaluateAll(nodes => { const audio = nodes.find(audio => !audio.paused)!; audio.currentTime = audio.duration - 0.1 })
  await expect.poll(() => player.locator('audio').evaluateAll(nodes => nodes.some(audio => !audio.paused && audio.currentTime < 2))).toBe(true)
  await player.getByRole('button', { name: 'Cały utwór', exact: true }).click()
  await player.getByRole('button', { name: 'Następny utwór', exact: true }).click()
  await expect(player).toContainText('Rota')
  await expect.poll(() => player.locator('audio').evaluateAll(nodes => nodes.some(audio => !audio.paused && audio.currentTime > 0.1))).toBe(true)
  // All-song order is alphabetic; use previous twice to reach the known missing part.
  await player.getByRole('button', { name: 'Poprzedni utwór', exact: true }).click()
  await expect(player).toContainText('Piechota')
  await player.getByRole('button', { name: 'Poprzedni utwór', exact: true }).click()
  await expect(player.getByRole('alert')).toContainText('brak nagrania Bas / baryton')
  await expect(player.getByRole('button', { name: 'Odtwórz', exact: true })).toBeDisabled()
  await expect(player.locator('audio')).toHaveCount(0)
  await noOverflow(page)
})

test('cached offline access is explicit, revoked access blocks, and another account has no personal library', async ({ page }) => {
  await fixtures(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Połącz Google Drive', exact: true }).click()
  await page.getByRole('button', { name: 'Synchronizuj Drive (tylko odczyt)' }).click()
  await expect(page.locator('.phone-song')).toContainText('Piechota')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('test-native-state.google-sub-fixture'))).not.toBeNull()
  await page.evaluate(() => sessionStorage.setItem('test-delay', 'yes'))
  await page.reload()
  await expect(page.getByText('Otwieranie danych urządzenia…')).toBeVisible()
  await expect(page.locator('.phone-song')).toHaveCount(0)
  await expect(page.locator('.phone-song')).toBeVisible()
  await page.evaluate(() => sessionStorage.removeItem('test-delay'))
  await page.evaluate(() => sessionStorage.setItem('test-error', 'NETWORK_ERROR'))
  await page.reload()
  await expect(page.getByText(/Offline: tylko wcześniej pobrane/)).toBeVisible()
  await expect(page.locator('.phone-song')).toBeVisible()
  await page.evaluate(() => sessionStorage.setItem('test-error', 'ACCESS_DENIED'))
  await page.reload()
  await expect(page.getByRole('button', { name: 'Połącz Google Drive', exact: true })).toBeVisible()
  await expect(page.locator('.phone-song')).toHaveCount(0)
  await page.evaluate(() => { sessionStorage.removeItem('test-error'); sessionStorage.setItem('test-account', 'second-account') })
  await page.reload()
  await expect(page.locator('.result-line')).toContainText('0 utworów')
  await expect(page.locator('.phone-song')).toHaveCount(0)
})

test('authorization failures explain interruption, configuration, cancellation and permission separately', async ({ page }) => {
  await fixtures(page)
  await page.goto('/')
  for (const [code, description] of [
    ['AUTH_INTERRUPTED', 'Google zamknął logowanie bez wyniku'],
    ['AUTH_CONFIG_ERROR', 'Google zgłosił błąd konfiguracji OAuth'],
    ['CANCELLED', 'Google zgłosił anulowanie logowania'],
    ['AUTH_PERMISSION_DENIED', 'Nie udzielono prawa odczytu Drive'],
    ['AUTH_LAUNCH_ERROR', 'Nie można otworzyć natywnego logowania Google'],
  ]) {
    await page.evaluate(code => sessionStorage.setItem('test-connect-error', code), code)
    await page.getByRole('button', { name: 'Połącz Google Drive', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText(description)
    await expect(page.locator('.phone-song')).toHaveCount(0)
  }
  await page.getByText('Pomoc: konfiguracja logowania Google', { exact: true }).click()
  await expect(page.getByText('com.jankomuzykant.app', { exact: true })).toBeVisible()
  await expect(page.getByText(/7B:22:1B:6B:CF:08/)).toBeVisible()
  await noOverflow(page)
})

test('anonymous startup needs no login and optional Google preserves separate guest state', async ({ page }) => {
  await fixtures(page)
  const hybrid = plugin.replace('const account=', 'let account=') + `
const guest={id:'anonymous-choir',email:'Bez logowania',lastVerified:Date.now(),anonymous:true};
Drive.initialize=async()=>{account=guest;state=localStorage.getItem('test-native-state.'+account.id);signed=true;return{account}};
Drive.connect=async()=>{account={id:'optional-account',email:'optional@example.com',lastVerified:Date.now()};state=null;return{account}};
Drive.useAnonymous=async()=>{account=guest;state=localStorage.getItem('test-native-state.'+account.id);return{account}};
tree['event-folder'].push({id:'private-folder',name:'Ukryta pieśń',mimeType:F});
Drive.list=async({folderId})=>{if(folderId==='private-folder'&&account.anonymous)throw Object.assign(Error('Private'),{code:'SIGN_IN_REQUIRED'});return{files:tree[folderId]||[]}};
Drive.download=async({id})=>{if(id==='audio'&&account.anonymous)throw Object.assign(Error('Private recording'),{code:'SIGN_IN_REQUIRED'});return{path:id,url:id==='pdf'?'/fixture.pdf':id==='calendar'?'/fixture-calendar.pdf':id==='audio'?'/fixture.m4a':'/fixture.musicxml'}};
`
  await page.route('**/native.ts', route => route.fulfill({ contentType: 'application/javascript', body: hybrid }))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Biblioteka chóru' })).toBeVisible()
  await expect(page.getByText('Bez logowania · materiały publiczne', { exact: true })).toBeVisible()
  await page.getByLabel('Mój głos', { exact: true }).selectOption('B')
  await page.getByRole('button', { name: 'Synchronizuj Drive (tylko odczyt)' }).click()
  await expect(page.getByText('Foldery wymagające sprawdzenia dostępu', { exact: true })).toBeVisible()
  await expect(page.locator('.phone-song').filter({ hasText: 'Piechota' })).toHaveCount(1)
  await page.locator('.phone-song').filter({ hasText: 'Piechota' }).click()
  await page.getByRole('button', { name: 'Pobierz materiały na telefon' }).click()
  await expect(page.getByText('2/3 plików na telefonie')).toBeVisible()
  await expect(page.getByText(/B - Piechota.m4a — Ten folder lub plik/)).toBeVisible()
  await page.getByRole('button', { name: 'Ustawienia', exact: true }).click()
  await page.getByRole('button', { name: 'Zaloguj przez Google (opcjonalnie)' }).click()
  await expect(page.getByRole('heading', { name: 'Google · dostęp tego konta' })).toBeVisible()
  await expect(page.getByLabel('Mój głos', { exact: true })).toHaveValue('AI')
  await page.getByRole('navigation', { name: 'Nawigacja telefonu' }).getByRole('button', { name: 'Biblioteka', exact: true }).click()
  await page.getByRole('button', { name: 'Synchronizuj Drive (tylko odczyt)' }).click()
  await expect(page.locator('.phone-song').filter({ hasText: 'Piechota' })).toHaveCount(1)
  page.on('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Ustawienia', exact: true }).click()
  await page.getByRole('button', { name: 'Korzystaj bez logowania' }).click()
  await expect(page.getByLabel('Mój głos', { exact: true })).toHaveValue('B')
  await expect(page.getByRole('heading', { name: 'Bez logowania · materiały publiczne' })).toBeVisible()
  await noOverflow(page)
})
