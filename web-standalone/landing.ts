import './landing.css'
import { validApkUrl } from '../src/distribution'
const base = import.meta.env.BASE_URL
const sourceMissing = import.meta.env.VITE_JANKO_GITHUB === 'true' &&
  !import.meta.env.VITE_GOOGLE_DRIVE_API_KEY && !import.meta.env.VITE_JANKO_DRIVE_PROXY_URL
const root = document.getElementById('root')!
root.innerHTML = `<header><img src="/icon-192.png" alt="Trzej rozśpiewani chórzyści Vox Apostoli" width="104" height="104"/><div><span class="eyebrow">VOX APOSTOLI · TWOJA PRACOWNIA CHÓRALNA</span><h1>Posłuchaj. Powtórz.<br/>Zaśpiewaj.</h1></div></header>
<p class="lead">Janko Muzykant — nuty, nagrania i spokojne ćwiczenie własnej partii. Na telefonie i komputerze, bez uruchamiania własnego serwera.</p>
<div class="cards"><section id="android"><span class="eyebrow">ANDROID</span><h2>Chór w Twojej kieszeni</h2><p>Samodzielna aplikacja APK. Materiały i ćwiczenia zostają na telefonie.</p><a class="button" id="apk" href="/downloads/Janko-Muzykant-debug.apk" download>Pobierz APK</a><p id="release" role="status">Odczyt wersji instalatora…</p><details><summary>Jak zainstalować i zaktualizować?</summary><ol><li>Pobierz APK i otwórz plik w telefonie.</li><li>Gdy Android poprosi, zezwól tej przeglądarce lub aplikacji Pliki na instalację z tego źródła. Nie wyłączaj Play Protect.</li><li>Potwierdź instalację. Potem możesz cofnąć zgodę dla tego źródła.</li><li>Nową wersję instaluj na poprzednią — nie odinstalowuj jej, aby zachować dane. Wymagany jest ten sam podpis.</li></ol><p>APK jest podpisanym wydaniem testowym, poza Google Play. Pobieraj tylko z linku przekazanego przez Romana. Android 7.0+.</p><h3>SHA-256 pliku APK</h3><code id="sha">Ładowanie…</code></details></section>
<section id="windows"><span class="eyebrow">WINDOWS · CHROME / EDGE</span><h2>Twoja pracownia na komputerze</h2><p>Otwórz PWA i zainstaluj ją z przeglądarki. Bez Pythona, Dockera, Proxmox i pliku EXE.</p><a class="button" href="/app/">Otwórz aplikację web</a><details open><summary>Jak zainstalować na Windows?</summary><ol><li>Otwórz aplikację w aktualnym Chrome lub Edge.</li><li>W menu ⋮/… wybierz „Zainstaluj aplikację” lub „Aplikacje → Zainstaluj tę witrynę jako aplikację”. Możesz też użyć ikony instalacji na pasku adresu.</li><li>Uruchamiaj Janko z menu Start. Zsynchronizuj bibliotekę i pobierz materiały, których potrzebujesz offline.</li></ol><p>Jeśli opcja instalacji nie jest dostępna, aplikacja działa także w zwykłej karcie. Pierwsze otwarcie wymaga internetu.</p></details></section></div>
<section class="boundaries"><h2>Ważne przed pierwszą próbą</h2><p>Domyślnie odczytywane są tylko publiczne materiały Google Drive. Udostępnienie aplikacji nie przekazuje Twoich uprawnień i nie ogranicza dostępu do członków chóru. Drive nigdy nie jest modyfikowany.</p><p>PWA pobiera publiczne materiały przez ograniczone proxy na Cloudflare; operator Cloudflare przesyła te pliki. Ćwiczenia, analiza MusicXML, generowanie WAV, nagrania i postępy pozostają w tej przeglądarce. Nie synchronizują się automatycznie z APK ani innym komputerem. PWA: do 25 MiB na plik.</p><p>Prywatne materiały wymagają istniejących uprawnień i opcjonalnego logowania w APK. PWA nie obsługuje logowania Google. Obie wersje samodzielne nie rozpoznają PDF → nuty (OMR) — użyj MusicXML. Mikrofon wymaga zgody i HTTPS; odtwarzanie po zablokowaniu ekranu nie jest gwarantowane.</p><p>Usunięcie danych przeglądarki usuwa pobrania i postępy PWA. Nie używaj trybu incognito do trwałego ćwiczenia.</p></section><footer>Janko Muzykant · małe kroki, wspólne brzmienie.</footer>`
for (const element of root.querySelectorAll<HTMLAnchorElement | HTMLImageElement>('a[href^="/"],img[src^="/"]')) {
  const attribute = element.tagName === 'IMG' ? 'src' : 'href'
  element.setAttribute(attribute, base + element.getAttribute(attribute)!.slice(1))
}
root.querySelector('.boundaries p:nth-of-type(2)')!.textContent =
  'PWA pobiera publiczne materiały przez Google Drive API lub skonfigurowane proxy Cloudflare (w tym wariancie Cloudflare przesyła pliki). Ćwiczenia, analiza MusicXML, generowanie WAV, nagrania i postępy pozostają w tej przeglądarce. Nie synchronizują się automatycznie z APK ani innym komputerem. PWA: do 25 MiB na plik.'
document.getElementById('apk')!.removeAttribute('href')
if (sourceMissing) {
  const warning = document.createElement('p')
  warning.id = 'drive-source-notice'
  warning.setAttribute('role', 'status')
  warning.textContent = 'Windows PWA: biblioteka Drive nie jest jeszcze gotowa. Dystrybutor musi skonfigurować źródło publicznych plików (Drive API lub własne proxy) i opublikować stronę ponownie. Instalator Android działa niezależnie i korzysta z publicznego Drive bez tego ustawienia.'
  document.querySelector('#windows h2')!.after(warning)
}
if (/android/i.test(navigator.userAgent)) document.getElementById('android')!.classList.add('recommended')
else document.getElementById('windows')!.classList.add('recommended')
void fetch(`${base}version.json`, { cache: 'no-store' }).then(async response => {
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const release = await response.json() as { apkVersion: string; sha256: string; apkUrl: string }
  if (!/^[a-f0-9]{64}$/i.test(release.sha256) || !validApkUrl(release.apkUrl)) throw new Error('Nieprawidłowe dane wydania')
  document.getElementById('apk')!.setAttribute('href', release.apkUrl)
  document.getElementById('release')!.textContent = `APK ${release.apkVersion} · aktualizacja bez odinstalowania`
  document.getElementById('sha')!.textContent = release.sha256
}).catch(error => {
  document.getElementById('release')!.textContent = `Nie odczytano danych wydania: ${error.message}. Sprawdź połączenie.`
  document.getElementById('apk')!.removeAttribute('href')
})
