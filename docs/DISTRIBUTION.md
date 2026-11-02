# Dystrybucja / Distribution: Android APK + Windows PWA

## GitHub Pages — zalecana publikacja z GitHub Releases (PL)

Docelowe repozytorium: **woodchuck84/janko-muzykant**; strona:
`https://woodchuck84.github.io/janko-muzykant/`. To adres docelowy, a stan wdrożenia
sprawdza się w Actions. [Pierwszy workflow zakończył się sukcesem](https://github.com/woodchuck84/janko-muzykant/actions/runs/41542201890).
[APK 0.1.7 / kod 8 jest w Releases](https://github.com/woodchuck84/janko-muzykant/releases/tag/v0.1.7),
z zachowanym podpisem aktualizacji. SHA-256:
`69f68cb224ff9c90750d3a13e2853cecc4b55ee119eb7b8181e361a3ad3d904a`.
**Nie skonfigurowano jeszcze źródła Drive dla Windows PWA.** Instalacja PWA jest
dostępna, ale synchronizacja biblioteki wymaga klucza/proxy i ponownego buildu.
Strona główna i aplikacja jawnie to komunikują. APK czyta publiczny Drive niezależnie.
Publikacja jest autoryzowana wyłącznie na koncie osobistym.
Nie używaj konta służbowego do tej aplikacji. Jeśli środowisko narzuca token służbowy,
usuń `GH_TOKEN` i `GITHUB_TOKEN` z bieżącego procesu, ustaw
`GH_CONFIG_DIR=$env:USERPROFILE\.config\gh-janko-personal` i
`GIT_CONFIG_GLOBAL=$env:GH_CONFIG_DIR\gitconfig`, a następnie sprawdź login.
Skrypt blokuje nazwy kont zawierające `volvo` (chyba że świadomie podasz `-Force`),
wyświetla aktywny login i wymaga dwukrotnego wskazania własnego `owner/repository`.
Nie przełącza kont za Ciebie. Repozytorium i kod będą **publiczne**, ponieważ to
wariant darmowego GitHub Pages. Dane chóru, pobrania, nagrania, JDK, `.env`, klucze
podpisu i APK nie są commitowane. Przed wysłaniem przejrzyj kod i zakres publikacji.

### Roman: dokładnie krok po kroku

1. Zainstaluj Git, GitHub CLI, Node.js 22.12+ (LTS), JDK 21 i Android SDK.
   W folderze projektu wykonaj `npm ci`.
2. Zaloguj **konto osobiste**: `gh auth login --hostname github.com --web`.
   Jeśli konta są już zapisane, użyj
   `gh auth switch --hostname github.com --user TWOJ-OSOBISTY-LOGIN`.
   Sprawdź `gh api user --jq .login`; nie kontynuuj z kontem Volvo.
   Do utworzenia repo/workflow potrzebne są uprawnienia repo i workflow;
   jeśli GitHub odrzuci push workflow, użyj `gh auth refresh -h github.com -s workflow`.
3. W swoim Google Cloud Console utwórz projekt, włącz **Google Drive API**,
   utwórz **API key** (nie OAuth client). W ograniczeniach aplikacji wybierz
   **Websites / HTTP referrers**, dopisz `https://TWOJ-LOGIN.github.io/*`,
   a w ograniczeniach API wybierz **Google Drive API** i tylko tę usługę.
   Drive API nie wymaga płatnego konta billing do tego wariantu; obowiązują kwoty
   i limity API. Nic nie zmieniaj w źródłowym Drive ani jego udostępnieniu.
4. Uruchom:

   ```powershell
   .\Publish-GitHub.ps1 -Repository TWOJ-LOGIN/janko-muzykant
   # albo npm run github:publish -- -Repository TWOJ-LOGIN/janko-muzykant
   ```

   Potwierdź dokładną nazwę repo. Klucz Drive wklej dopiero do **ukrytego promptu**
   skryptu. Nie wpisuj go w poleceniu, czacie, kodzie ani `.env.example`.
   Skrypt zapisze repozytoryjny Actions secret `VITE_GOOGLE_DRIVE_API_KEY`.
   Możesz też ustawić go ręcznie: GitHub → repo → Settings → Secrets and variables
   → Actions → New repository secret. Zmienna repo o tej samej nazwie też jest obsługiwana.
5. Skrypt tworzy publiczne repo (lub używa potwierdzonego publicznego repo),
   buduje APK **lokalnie dotychczasowym keystore** z właściwym adresem aktualizacji,
   konfiguruje pomocnika poświadczeń Git przez `gh auth setup-git` dla github.com,
   wysyła `main` bez force-push, włącza Pages/Actions, publikuje APK i `version.json`
   jako Release i uruchamia workflow. W Actions APK **nie jest budowany ani podpisywany**.
   Nigdy nie przesyłaj `%USERPROFILE%\.android\debug.keystore`.
6. Poczekaj na zielony workflow „Publish standalone app to GitHub Pages”.
   Sprawdź `gh run list --repo TWOJ-LOGIN/janko-muzykant --workflow pages.yml`.
   Dopiero po sukcesie otwórz i rozsyłaj:
   `https://TWOJ-LOGIN.github.io/janko-muzykant/`.
   Pierwszy push może wyprzedzić upload Release; workflow czeka do 2 minut,
   a skrypt dodatkowo uruchamia go ręcznie po przesłaniu obu plików.
   W razie błędu popraw przyczynę i uruchom workflow ponownie w Actions.

**Klucz API jest publiczny w wynikowym JavaScript z założenia.** Actions secret
chroni przed przypadkowym commitem, nie ukrywa klucza przed odbiorcami.
Ograniczenia referrera i usługi są niezbędne. Nie stosuj klucza do innych API.
Odbiorcy nie konfigurują Google Cloud, nie logują się i nie dostają Twoich uprawnień.

### Dlaczego potrzebny jest klucz albo proxy?

GitHub Pages serwuje tylko pliki; nie uruchomi Functions/Pythona. Zwykłe strony
publicznego Drive i ich pobrania blokują odczyt przez CORS. Wariant Pages używa
oficjalnego Drive API v3: `files.list` z `'<folder>' in parents`, paginacją oraz
`files.get?alt=media` (Docs: eksport TXT). Wszystkie operacje to GET, bez OAuth
i cookies. Publiczny root i kolejne foldery tworzą lokalną listę dozwolonych ID;
dowolny obcy ID nie jest odczytywany przez aplikację. Ta lista po stronie klienta
nie jest granicą bezpieczeństwa Google: publiczny klucz nie nadaje uprawnień do plików.
Rozmiar pobieranego strumienia jest ograniczony do 25 MiB, także bez Content-Length.

**Dostęp do rzeczywistego folderu przez Drive API + key pozostaje niezweryfikowany,
ponieważ nie udostępniono klucza.** Udostępnianie linkiem/resourceKey i ograniczenia
Google mogą powodować błąd lub pustą listę mimo działania publicznego widoku HTML.
Nie zgłaszamy tego wariantu jako sprawdzonego na żywych plikach. UI pokazuje
brak konfiguracji/odmowę/kwotę, nie próbuje obchodzić uprawnień.

Alternatywa: zachowane proxy Cloudflare. Własny Worker można opublikować poleceniami
`npx wrangler login` i `npx wrangler deploy --config wrangler.proxy.toml`
(wymaga własnego konta Cloudflare). Następnie ustaw w repo Actions **variable**
`VITE_JANKO_DRIVE_PROXY_URL` na pełny URL Workera, np.
`https://janko-drive-public.TWOJA-SUBDOMENA.workers.dev/`, i uruchom workflow ponownie.
Można też wskazać istniejącą trasę `https://TWOJ-PROJEKT.pages.dev/api/drive`.
Proxy ma pierwszeństwo przed kluczem. `Publish-GitHub.ps1 -DriveProxyUrl URL`
ustawia tę zmienną. Repozytoryjna zmienna jest publicznym adresem, nie tokenem.
Worker zachowuje serwerową weryfikację całej ścieżki od root, limity i tylko GET;
CORS dopuszcza odczyt publicznych plików. Prywatne pliki nadal wymagają APK/OAuth.
Dotychczasowe `Deploy-Web.ps1` i Cloudflare Pages pozostają dostępne.

### Późniejsze wydania, limity i weryfikacja

Podnieś zgodnie wersję/kod Androida i stałe `src/DistributionNotice.tsx`,
zacommituj źródła, uruchom skrypt bez `-ReleaseOnly`, aby wysłać zmieniony `main`.
Tryb `.\Publish-GitHub.ps1 -Repository TWOJ-LOGIN/janko-muzykant -ReleaseOnly`
jest dla ponownego zbudowania/publikacji wydania, gdy lokalny HEAD już odpowiada
zdalnemu `main`. Nie wysyła źródeł i nie przestawia konfiguracji. Istniejący Release
wymaga osobnego potwierdzenia `REPLACE` przed podmianą plików. Potwierdź, że to
zamierzone: zwykła aktualizacja instalacji wymaga wyższego `versionCode`.

APK pobierany jest z
`https://github.com/OWNER/REPO/releases/latest/download/Janko-Muzykant-debug.apk`.
Strona budowana w Actions pobiera z tego samego Release APK i `version.json`,
sprawdza SHA-256 oraz zgodność wersji ze źródłami, a publikuje jedynie statyczną
stronę i metadane. Nie kopiuje APK do Pages ani nie przesyła klucza podpisu.
Ścieżki ikon, manifestu, service workera, aplikacji i aktualizacji uwzględniają
`/<repo>/`. Dane poprzedniego hostingu nie przenoszą się automatycznie.
Na Pages nie ma `_headers`, `_routes.json` ani Functions; nie kontrolujemy własnych
nagłówków Cache-Control/CSP. Metadane aktualizacji są żądane bez cache.

GitHub Pages ma miękki limit transferu ok. **100 GB/miesiąc** i limit rozmiaru
witryny ok. **1 GB**; sprawdź aktualną dokumentację GitHub. Plik APK jest w Releases,
nie w repo ani witrynie. Drive API ma oddzielne kwoty projektu/użytkownika;
nie włączaj płatnych rozszerzeń tylko na potrzeby aplikacji.
Pozostają ograniczenia publicznych plików, 25 MiB/plik, pamięci przeglądarki,
braku OMR i logowania w PWA oraz niegwarantowanej pracy w tle opisane niżej.

Lokalne testy pod `/janko-test/` obejmują stronę, manifest, zakres SW, publiczny
adapter API z mockami, audio/PDF offline i brak odwołań do korzenia hosta.
Nie zastępują próby z rzeczywistym kluczem/referrerem po publikacji.
Skrypt publikujący ma sprawdzoną składnię i blokadę konta. Wynik zdalnego buildu
i publikacji sprawdź w repozytorium, w zakładce Actions; lokalny test go nie zastępuje.

## GitHub Pages + Releases (EN)

The authorized publication target is the personal repository
`woodchuck84/janko-muzykant`, with Pages at
`https://woodchuck84.github.io/janko-muzykant/`. The initial Pages workflow succeeded
and Android 0.1.7 / code 8 is available in Releases with the existing update signature.
**Windows Drive sync remains unconfigured** until the distributor supplies a
restricted API key or their own proxy and rebuilds Pages. The installable PWA and
homepage explain this; native Android public Drive reads are independent.
Use only your personal account and confirm it with `gh api user --jq .login`;
clear injected work-account tokens and use the isolated personal CLI configuration.
`Publish-GitHub.ps1 -Repository PERSONAL-USER/janko-muzykant` displays the active
account, rejects `volvo` names unless deliberately overridden with `-Force`, and
requires exact repository confirmation. Code will become public. Review it first.

Create your own Google Cloud project, enable Drive API, create an API key restricted
to HTTP referrer `https://PERSONAL-USER.github.io/*` and **Drive API only**.
No OAuth or billing account is needed for this public-read setup; API quotas apply.
Enter the key only in the publisher's secure prompt (or set Actions secret/variable
`VITE_GOOGLE_DRIVE_API_KEY`). It is intentionally visible in the built JS: secret
storage prevents source commits, not client access. Recipients need no setup.

The script builds/signs the APK locally with the existing keystore and the correct
project-site update URL; it never uploads the key. It pushes clean `main`, enables
Actions-based Pages, uploads APK + SHA-256/version metadata to Releases and requests
the Pages workflow. Actions verifies the release APK/hash/version and deploys a
static subpath site; it never builds or signs Android. Wait for a successful run,
then share `https://PERSONAL-USER.github.io/janko-muzykant/`.
Future source versions must be committed/pushed; `-ReleaseOnly` requires the same
clean HEAD already on remote main and confirms overwriting an existing release.

Pages cannot run the Cloudflare function. Public Drive API v3 key-based CORS reads
are implemented with pagination, root ancestry validation and bounded downloads.
**Live Drive API access is unverified without a real key**; link/resource-key rules
may prevent it. The fallback is the retained GET-only Cloudflare Worker
(`wrangler.proxy.toml`) or existing Pages `/api/drive`, configured by repository
variable `VITE_JANKO_DRIVE_PROXY_URL`. Proxy takes precedence over key.
With neither configured the app shows an explicit distributor-configuration error.
Only public content is accessible; no permission transfer and no Drive writes.

Subpath desktop/phone tests cover landing links, manifest/SW scope and offline
PDF/audio using mocked API responses. Check Actions for the remote workflow result.
Pages soft bandwidth is typically 100 GB/month, site size about 1 GB; confirm current
GitHub limits. APK stays in Releases. Drive quotas are separate. Browser storage,
25 MiB/material, no PWA OAuth/OMR and background-playback limits still apply.

## PL — jeden link dla chóru

Strona Cloudflare Pages oferuje instalator Android i samodzielną PWA dla Windows.
Nie jest to wersja FastAPI uruchomiona w internecie. Użytkownik Windows otwiera
`/app/` w Chrome/Edge i wybiera instalację aplikacji w menu przeglądarki; nie
potrzebuje Pythona ani własnego serwera. Android pobiera APK ze strony głównej.
Instalację i aktualizację opisano także na stronie, wraz z wersją i SHA-256 APK.
Android 7.0+; na Windows zalecany aktualny Chrome/Edge. Nie ma instalatora EXE/MSI.

### Roman: przygotowanie i pierwsza publikacja

W folderze projektu, z Node.js 22.12+ (zalecany aktualny LTS), JDK 21 i Android SDK:

```powershell
npm ci
npx wrangler login
npx wrangler pages project create NAZWA-PROJEKTU --production-branch main
```

Wybierz własną unikalną nazwę Pages (małe litery, cyfry, myślniki). Zaloguj się
we własnej przeglądarce do Cloudflare. Nie podawaj tokenów ani haseł w czacie.
Nie jest wymagany GitHub ani dostęp do własności Drive.

Znając przydzielony adres Pages, przygotuj APK ze wspólnym adresem aktualizacji:

```powershell
$env:VITE_JANKO_DISTRIBUTION_URL = 'https://NAZWA-PROJEKTU.pages.dev'
npm run android:apk
$env:JANKO_PAGES_PROJECT = 'NAZWA-PROJEKTU'
npm run web:deploy
```

Skrypt `Deploy-Web.ps1` buduje PWA, sprawdza wersję i skrót APK względem metadanych
rzeczywistego buildu Gradle, kopiuje instalator i generuje `version.json`, po czym
wykonuje bezpośredni upload `wrangler pages deploy`. Alternatywnie:
`.\Deploy-Web.ps1 -ProjectName NAZWA-PROJEKTU`.
Adres Pages i nazwa projektu powyżej to **placeholdery**, nie istniejący wdrożony serwis.
Jeśli Cloudflare zaoferuje logowanie lub wybór konta, wykonaj je samodzielnie.
Sam skrypt nie loguje się i nie tworzy konta.

Rozsyłaj adres główny `https://NAZWA-PROJEKTU.pages.dev/`. Odbiorcy nie konfigurują
Cloudflare, API keys ani OAuth. Udostępnianie aplikacji nie przekazuje Twoich
uprawnień Google. Domyślnie dostępne są tylko materiały publiczne.

Weryfikacja bez publikacji i bez logowania:

```powershell
npm run android:apk
npm run web:build
npm run web:dev
# http://127.0.0.1:8788/ oraz http://127.0.0.1:8788/app/
# Ctrl+C kończy serwer testowy
```

Można także użyć `.\Deploy-Web.ps1 -Local`. Zwykły statyczny serwer plików nie
obsłuży proxy. Wymagany jest Cloudflare Pages Functions lub lokalny Wrangler.
Lokalny HTTP działa tylko na adresie loopback; instalacja produkcyjna i mikrofon
wymagają HTTPS. `npm run web:test:e2e` sprawdza Windows i telefon na lokalnym
Pages; `npm test` obejmuje testy granic proxy.

### Co jest publikowane i jak aktualizować

- `dist-web\` zawiera stronę, `/app/`, service worker, ikony,
  `downloads\Janko-Muzykant-debug.apk`, `version.json` i reguły nagłówków.
- `functions\api\drive.js` jest jedyną funkcją; `_routes.json` kieruje do Functions
  wyłącznie `/api/*`. Nie przesyłaj `data`, repozytorium, kluczy podpisu ani `.env`.
- Aktualny build to **0.1.7 / code 8**. Przyszłe wydanie wymaga zgodnego podniesienia
  wersji w `android\app\build.gradle` oraz `src\DistributionNotice.tsx`, ponownego
  `npm run android:apk` i `npm run web:deploy`. Nie edytuj SHA-256 ręcznie.
- Zachowaj bezpieczną kopię `%USERPROFILE%\.android\debug.keystore` poza projektem.
  Dotychczasowy podpis pozwala instalować APK na starszy bez odinstalowania.
  Jest to dystrybucja testowa, nie wydanie Google Play; zachowaj Play Protect.
  Zmiana podpisu wymaga odinstalowania i usuwa lokalne dane.
- PWA i APK odczytują `version.json` bez cookies. APK musi znać adres:
  zmienna buildu `VITE_JANKO_DISTRIBUTION_URL` ustawia go dla wszystkich odbiorców;
  bez niej obecny APK nie zna przyszłej domeny. Adres można także wpisać raz
  w „Aktualizacje APK”. PWA używa własnego pochodzenia.
- Komunikat „Dostępna nowa wersja” nie instaluje APK automatycznie.
  PWA prosi o odświeżenie po zapisaniu ćwiczenia i aktywuje oczekujący service worker.
  Zamknij inne stare okna aplikacji, jeśli nadal pokazują poprzednią wersję.

### Drive, limity, prywatność

Proxy wykonuje tylko GET do Google: publiczny `embeddedfolderview`, pobranie
`uc?export=download`, eksport publicznego dokumentu jako TXT oraz znane
potwierdzenie dużego pliku `download-form` (również GET, ten sam identyfikator).
Nie używa kont, cookies Google, kluczy ani operacji zapisu. Brak publicznego
dostępu jest jawnie zgłaszany. Parser HTML nie jest oficjalnym stabilnym API:
zmiana formatu przez Google może wymagać aktualizacji; nie obchodzimy logowania.

Dozwolony root: `1fESe16CVAh9JBpNKw2_ucmKPAn7NbPtQ`. Każdy identyfikator musi
być osiągalny po zweryfikowanej liście rodziców od tego root; ścieżka dostarczona
przez klienta sama w sobie nie jest autoryzacją. Listy serwera są cache'owane do
5 minut. Nie jest to mechanizm kontroli członkostwa. To, co jest publiczne,
może pobrać każdy znający stronę. Nie rozszerzaj proxy na dowolne adresy/ID.

Limit pliku proxy/PWA: **25 MiB**, strony HTML: 4 MiB, folderu: 2000 pozycji,
ścieżki rodziców: 12. APK zachowuje dotychczasowe większe limity (150 MiB).
Strona Pages dopuszcza pliki statyczne maks. 25 MiB; pakowanie odrzuci większy APK.
Pobrania są buforowane do limitu przed zwróceniem, nie przekazujemy uciętego pliku.
Limity na IP: 30 pobrań lub 240 list/minutę **na aktywną instancję Workera**.
Jest to ograniczenie best-effort, nie globalny atomowy licznik. Można w Cloudflare
dodatkowo skonfigurować wiązanie Rate Limiting `DRIVE_RATE_LIMIT` (240/60 s) lub
reguły WAF, jeśli plan je udostępnia. Zweryfikuj dostępność przed poleganiem na nich.
Kod nie zapisuje treści plików ani nazw użytkowników w logach; IP służy wyłącznie
krótkotrwałemu licznikowi. Nie włączaj logowania treści odpowiedzi w Cloudflare.

**Cloudflare przenosi publiczne pliki**, mimo że analiza i ćwiczenia są lokalne.
Functions korzystają z limitów Workers danego planu (na darmowym planie typowo
100 000 wywołań/dzień i ograniczony CPU; sprawdź aktualny cennik Cloudflare).
To nie jest nieograniczony darmowy backend. Zbyt duży ruch lub ograniczenia
Google mogą czasowo zatrzymać synchronizację. Statyczna strona i pobrane lokalnie
materiały nie wymagają działającego FastAPI/Proxmox.

### Offline i różnice względem Start.bat

PWA przechowuje metadane/postępy w IndexedDB i materiały/WAV w Cache API.
Service worker obsługuje również żądania zakresowe audio. Po pierwszym otwarciu
online pobierz konkretne materiały przyciskiem „Zapisz offline”; sama synchronizacja
nie pobiera wszystkich plików. Powrót do aplikacji offline korzysta z ostatniej
biblioteki. Nie można wtedy sprawdzić cofnięcia publicznego dostępu.

Dane należą do profilu przeglądarki, nie synchronizują się z APK ani komputerami;
czyszczenie danych strony, tryb prywatny lub automatyczne zwolnienie pamięci może
je usunąć. Nie traktuj ich jako jedynej kopii ważnych nagrań. Publiczna przestrzeń
PWA jest osobna od kont/plików APK i od wersji desktopowej.
W ustawieniach można usunąć lokalne dane trybu publicznego.

PWA współdzieli z APK bibliotekę, PDF/audio, stały odtwarzacz, pętle, mikser,
zakładki, analizę i syntezę MusicXML, coaching, nagrania i planowanie.
PWA **nie ma logowania Google**; do prywatnych plików użyj APK i konta z już
nadaną zgodą (opcjonalna konfiguracja OAuth opisana w ANDROID.md).
Ani PWA, ani APK nie wykonują Audiveris/Python OMR; to nadal funkcja Start.bat.
Przewodnik gra kolejno zapisane takty ze stałym tempem, nie interpretuje
repetycji/fermat/zmian tempa. Mikrofon wymaga zgody, słuchawki poprawiają pomiar;
działanie w tle i po blokadzie ekranu zależy od systemu i nie jest gwarantowane.
PWA używa systemowych krojów pisma bez zewnętrznych usług fontów.
Start.bat, dokumentacja Proxmox i pełna wersja FastAPI pozostają bez zmian.

## EN — operating the shared distribution site

The Cloudflare Pages homepage serves the Android APK and links to `/app/`, an
installable standalone PWA for Windows Chrome/Edge. No Python, EXE, local server
or Proxmox is required by recipients. APK installation/update guidance and the
actual SHA-256 are shown on the homepage. Install updates over the existing APK
with the same signing key; do not uninstall or disable Play Protect.

Owner setup: run `npm ci`, `npx wrangler login`, then
`npx wrangler pages project create YOUR-PROJECT --production-branch main`.
Use the assigned HTTPS domain in `$env:VITE_JANKO_DISTRIBUTION_URL`, run
`npm run android:apk`, set `$env:JANKO_PAGES_PROJECT` and run `npm run web:deploy`.
This is direct upload, not a GitHub integration. Keep the existing debug keystore
safe; never upload it. This is still a debug-signed test distribution, not Play Store.
No remote deployment is implied by a successful local test.

For local verification use `npm run web:build` then `npm run web:dev`
(`http://127.0.0.1:8788/`). `Deploy-Web.ps1 -Local` also builds and starts Wrangler.
Do not use a plain file server: `/api/drive` requires Pages Functions.
`npm run web:test:e2e` covers desktop and phone; `npm test` covers proxy boundaries.
Publish only generated `dist-web` and the Functions, never local `data`, secrets or keys.
The package script checks actual Gradle-produced version/hash metadata before
copying the root APK and generating `version.json`.

Both platforms check `version.json` for updates. PWA uses its own origin; APK
needs the owner-supplied build URL or a one-time URL entry in update settings.
Until a real domain is selected, the current APK cannot discover that future URL.
Increase versions in `android/app/build.gradle` and `src/DistributionNotice.tsx`
together, rebuild APK, then deploy again. Version 0.1.7 is Android code 8.
PWA refreshes only on confirmation; APK installation remains user-controlled.

The GET-only proxy verifies every ancestor from the fixed choir root, never
trusting a caller's ID/path alone. It lists public HTML folders, downloads public
files and exports public Docs text, including the recognized same-file GET
confirmation form. It has no Google credentials and cannot write to Drive.
Unknown/private content fails explicitly. Public HTML is not a stable Google API.
Server listings may be cached for 5 minutes. This is not membership authorization.

Limits: 25 MiB/file (APK keeps 150 MiB), 4 MiB HTML, 2000 items/folder, 12 ancestors.
Per-IP best-effort **per-isolate**, not globally atomic, limits are 30 downloads or
240 lists/minute. An optional Cloudflare `DRIVE_RATE_LIMIT` binding or plan-specific
WAF rule can reinforce them; check plan support. Workers free-plan quotas/CPU
limits apply, typically 100,000 calls/day, subject to Cloudflare pricing changes.
Cloudflare transmits public files; application code does not log file contents.
Never enable response-body logging. No user accounts or API keys are needed.

IndexedDB holds PWA metadata/progress; Cache API holds downloaded materials/WAV.
The service worker supports offline startup and audio ranges. Sync lists metadata;
download individual songs before going offline. Browser storage eviction, clearing
site data or private mode can remove local work. Data is isolated to this browser
profile, separate from APK accounts, and not synchronized across devices.

PWA reuses the APK's on-device MusicXML/rendering/WAV, player/mixer/loops/bookmarks,
coaching/recording and planning UI. It has no Google OAuth; private Drive access
requires the APK with existing permission and optional owner OAuth setup.
Neither standalone platform runs PDF OMR/Python; use the preserved Start.bat
edition for that. Generated guides use fixed tempo and written bar order.
Microphone requires HTTPS and permission; background/lock-screen playback is not
guaranteed. Local system fonts avoid runtime external font requests.
