# Wdrożenie / Deployment

## Polski

### Stan gotowości

Hostowane logowanie Google, sesje serwerowe, obowiązkowa lista dozwolonych
adresów, kontrola dostępu administratora, CSRF i izolacja danych są
zaimplementowane. Automatyczne testy obejmują integrację z atrapą Google OAuth;
nie potwierdza to konfiguracji ani działania z prawdziwym projektem Google.
Właściciel musi sam skonfigurować OAuth, Drive i domenę oraz zweryfikować
wdrożenie. Nie udostępniaj aplikacji publicznie, dopóki konfiguracja nie jest
uzupełniona i sprawdzona. Compose domyślnie ustawia `JANKO_HOSTED=true` i
wiąże port wyłącznie z `127.0.0.1`; Cloudflare Tunnel jest jedyną opisaną drogą
publiczną. Nie wystawiaj bezpośrednio portu 8000 do sieci.

**Sprawdzone lokalnie:** zbudowano rzeczywisty obraz Docker i uruchomiono
zdrową usługę Compose na `127.0.0.1:8000`, bez tunelu. Próby HTTP w trybie
hostowanym z testową konfiguracją OAuth i testowymi sesjami potwierdziły
blokowanie niezalogowanych, ciasteczka Secure, state/PKCE, CSRF, izolację
postępów, import administratora oraz analizę/generowanie WAV i zakresy bajtów.
Testy obejmują 77 testów backendu na Windows i w obrazie Linux, 14 frontendowych
i 17 scenariuszy E2E. Najnowszy pełny przebieg miał jedno przerwane okno
WebKit; ponowiony zestaw wszystkich trzech scenariuszy iPhone przeszedł.
Sprawdzono także `Audiveris -batch -help` w odbudowanym obrazie jako użytkownik
10001; nie wymaga GTK ani serwera ekranu. Nie oznacza to walidacji każdego PDF.
Pełna próba OMR na zapisanym PDF „Piechota” również utworzyła `.mxl`;
MusicXML zawierał trzy pięciolinie, w tym wykrytą linię z kluczem basowym.
**Nie sprawdzono na żywo:** kont Google właściciela, Cloudflare Tunnel ani
serwera Proxmox. Nie utworzono kont i nie wdrożono aplikacji na serwerze.

### Zalecany układ: Proxmox → Debian VM → Docker Compose

1. Utwórz aktualną maszynę wirtualną Debian 12/13; dla początkujących VM jest
   bezpieczniejsza i prostsza niż kontener systemowy LXC. Jeśli mimo to
   wybierzesz LXC, Docker zwykle wymaga włączenia `nesting=1` i `keyctl=1`;
   zmienia to model izolacji. Unikaj uprzywilejowanego LXC i sprawdź dokumentację
   Proxmox dla swojej wersji. Przydziel co najmniej 4 vCPU, 6 GB RAM (limit
   kontenera to 4 GB) i miejsce na dane chóru. Audiveris może na chwilę mocno
   obciążyć CPU i pamięć.
2. Zainstaluj Docker Engine i wtyczkę Docker Compose według oficjalnej instrukcji
   dla Debiana: <https://docs.docker.com/engine/install/debian/>. Nie instaluj
   przypadkowych skryptów z nieoficjalnych stron.
3. Skopiuj projekt do VM, przejdź w terminalu do katalogu projektu i utwórz
   prywatny plik konfiguracji:

   ```sh
   cp .env.example .env
   chmod 600 .env
   ```

4. Do próby wyłącznie lokalnej ustaw w `.env` **`JANKO_HOSTED=false`**,
   pozostaw pola OAuth i Cloudflare puste i nie włączaj profilu `tunnel`.
   Dla hostingu pozostaw `true` i najpierw uzupełnij konfigurację opisaną
   poniżej — bez danych OAuth i administratora aplikacja odmawia startu.
   Zbuduj i uruchom:

   ```sh
   docker compose up -d --build
   docker compose ps
   docker compose logs --tail=100 app
   ```

   Otwórz `http://127.0.0.1:8000` na samej VM albo użyj bezpiecznego tunelu SSH
   tylko do testowania na własnym komputerze. Port jest związany wyłącznie z
   adresem loopback VM. `Start.bat` i lokalny start Windows pozostają bez zmian.

5. Zatrzymanie i aktualizacja:

   ```sh
   docker compose down
   docker compose up -d --build
   ```

   `docker compose down` nie usuwa woluminu `janko-data`. **Nie używaj**
   `docker compose down -v`, jeśli chcesz zachować dane.

### Konfiguracja dostępu hostowanego

- Ustaw `JANKO_HOSTED=true` i `JANKO_PUBLIC_URL` na docelowy adres HTTPS, np.
  `https://chor.example.org`. Potrzebujesz własnej domeny zarządzanej przez
  Cloudflare, skonfigurowanej z przypisaną Public Hostname.
- `GOOGLE_CLIENT_ID` i `GOOGLE_CLIENT_SECRET` otrzymasz w Google Cloud Console
  dla klienta OAuth typu **Web application**. Dodaj dozwolone źródło
  `https://chor.example.org` oraz URI przekierowania
  `https://chor.example.org/auth/callback`. Używaj wyłącznie zakresu
  `drive.readonly`; skonfiguruj ekran zgody, dodaj użytkowników testowych albo
  opublikuj aplikację zgodnie z polityką Google. Weryfikacja OAuth/Drive może
  wymagać dodatkowych kroków. Skonfiguruj dokładny callback wymagany przez
  wyświetloną w aplikacji konfigurację OAuth; sprawdź ten adres w Google Cloud
  Console.
- `JANKO_DRIVE_ROOT_ID` to identyfikator folderu głównego Google Drive.
  `JANKO_ADMIN_EMAILS` to rozdzielona przecinkami lista administratorów
  (synchronizacja, kalendarz i import). `JANKO_ALLOWED_EMAILS` może ograniczyć
  dostęp do wskazanych adresów. Dodanie członka wymaga dodania jego e-maila do
  odpowiedniej listy oraz udostępnienia mu materiałów w Google Drive.
- Dostęp zawsze wymaga adresu z `JANKO_ADMIN_EMAILS` lub
  `JANKO_ALLOWED_EMAILS` — nie ma trybu publicznego. Dodaj jawnie wszystkich
  członków chóru, nawet jeśli folder Drive jest publiczny. Zwykły członek z
  `JANKO_ALLOWED_EMAILS` musi również pomyślnie przejść sprawdzenie dostępu do
  folderu głównego. Tylko `JANKO_ADMIN_EMAILS` może ominąć odmowę 403/404
  podczas sprawdzania folderu (np. awaryjne konto administratora). Błąd
  upstream 5xx odmawia dostępu wszystkim i zwraca 502. Sam odczyt folderu nigdy
  nie wystarcza do zalogowania.
- Sesja ma maksymalnie 7 dni (`JANKO_SESSION_DAYS=7`). Członkostwo i dostęp do
  Drive są sprawdzane ponownie nie rzadziej niż co 15 minut. Usunięcie adresu z
  `JANKO_ALLOWED_EMAILS` odmawia dostępu przy następnym żądaniu po wczytaniu
  zmienionej konfiguracji (po edycji `.env` uruchom
  `docker compose up -d --force-recreate app`). Zmiana
  uprawnień Drive jest wykrywana przy ponownym sprawdzeniu.
- Poświadczenia OAuth (access i refresh tokens) są przechowywane
  wyłącznie po stronie serwera w SQLite na woluminie `/data`, nigdy w
  przeglądarce. Kopie zapasowe woluminu i `.env` są poufne; przechowuj je w
  zaszyfrowanym miejscu z ograniczonym dostępem.
- Biblioteka, cache, wygenerowane pliki i kalendarz są współdzielone.
  Postępy, setlista i stan „widziane” są przypisane do konta. Tylko
  administrator może synchronizować, zmieniać kalendarz i importować
  MusicXML; kontrolki te są wyłączone dla członków. OMR/generowanie mają
  ograniczenia współbieżności i liczby żądań, więc przy obciążeniu odczekaj.
- W trybie hostowanym cache przeglądarki plików prywatnych i service worker są
  wyłączone, aby wylogowanie nie pozostawiało starych materiałów do
  odczytu. Ikona PWA/Home Screen nadal może uruchamiać aplikację, ale hostowana
  wersja wymaga Internetu. Nagrania i preferencje przeglądarki pozostają lokalne
  dla użytkownika i przeglądarki.
- Sekrety OAuth i Cloudflare wpisuj wyłącznie do `.env` na serwerze z
  ograniczonymi uprawnieniami pliku; nie wysyłaj ich na czat, do repozytorium
  ani na zrzuty ekranu.

Cloudflare Tunnel ma opcjonalny profil `tunnel`, a token ustawia się jako
`CLOUDFLARE_TUNNEL_TOKEN` w `.env`. Po skonfigurowaniu i przetestowaniu OAuth,
list e-maili i HTTPS skonfiguruj w Cloudflare Public Hostname na
`http://app:8000`, a następnie uruchom:

```sh
docker compose --profile tunnel up -d
```

Nie włączaj tego profilu przed skonfigurowaniem uwierzytelniania i testem
wdrożenia. Alternatywą jest inny hosting z domeną i TLS, przy zachowaniu tych
samych wymagań logowania i autoryzacji.

### Dane, kopie zapasowe i sprawdzenie

**Długie operacje przez tunel:** rozpoznawanie PDF i synchronizacja wykonują
się w ramach jednego żądania HTTP. Cloudflare ma domyślny limit oczekiwania na
odpowiedź 125 sekund ([błąd 524](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/)).
Duży PDF lub pierwsza synchronizacja mogą go przekroczyć, nawet jeśli backend
nadal pracuje. Przy 504/524 odczekaj i spróbuj ponownie; preferuj gotowe
MusicXML od dyrygenta, wcześniej przetworzone partytury i synchronizację jednego
wydarzenia zamiast całej biblioteki. Nie sprawdzono długich operacji przez
prawdziwy tunel. Kolejka zadań asynchronicznych i odpytywanie o wynik to
przyszłe usprawnienie, nie część tego wdrożenia.

Kontener działa bez roota, z systemem plików tylko do odczytu. Wyjątki to
trwałe `/data` i ograniczony pamięcią `/tmp`. `/tmp` dopuszcza `exec`, ponieważ
Audiveris (JNA/JavaCPP) rozpakowuje tam i ładuje własne biblioteki natywne;
`noexec` uniemożliwia uruchomienie silnika OMR.

SQLite, pobrane pliki, wyniki OMR i wygenerowane nagrania trafiają do trwałego
woluminu Docker `janko-data` zamontowanego jako `/data`. Przed kopią zatrzymaj
aplikację, aby SQLite zakończył zapis, wykonaj kopię woluminu i uruchom ją
ponownie. Przykład archiwum na hoście (utwórz wcześniej katalog `backups`):

```sh
docker compose stop app
docker run --rm -v janko-muzykant_janko-data:/data:ro -v "$PWD/backups:/backup" alpine \
  tar -czf /backup/janko-data-$(date +%F-%H%M).tar.gz -C /data .
docker compose start app
```

Jeśli Compose nadał woluminowi inny prefiks projektu, sprawdź dokładną nazwę
przez `docker volume ls` i zastąp nią `janko-muzykant_janko-data`. Kopiuj `.env`
wyłącznie do bezpiecznego, zaszyfrowanego miejsca, nigdy do publicznego repozytorium.
Okresowo sprawdzaj logi i stan `docker compose ps`; `/api/health` to tylko
diagnostyka działania, nie kontrola uprawnień. OMR może błędnie odczytać nuty;
sprawdź wynik z oryginalnym PDF-em.

## English

### Readiness

Hosted Google sign-in, server-side sessions, a mandatory email allowlist,
administrator access controls, CSRF protection, and data isolation are
implemented. Automated tests cover the flow with a fake Google OAuth provider;
they do not verify configuration or behavior with a real Google project. The
owner must configure Google OAuth, Drive, and the domain, then verify the actual
deployment. Do not make the app public until those settings are complete and
checked. Compose defaults `JANKO_HOSTED=true` and binds only to `127.0.0.1`;
Cloudflare Tunnel is the documented route for public access. Never expose port
8000 directly to the network.

**Verified locally:** a real Docker image was built and the Compose app started
healthy on `127.0.0.1:8000`, without a tunnel. Hosted HTTP smoke checks using
test OAuth settings and seeded test sessions covered unauthenticated blocking,
Secure cookies, state/PKCE, CSRF, personal-progress isolation, administrator
import, score analysis/WAV generation, and byte ranges. Local suites passed:
77 backend tests on Windows and in the Linux image, 14 frontend tests, and
17 E2E scenarios. The latest full E2E run had one WebKit window closure;
rerunning all three iPhone scenarios passed.
`Audiveris -batch -help` also passed in the rebuilt image as UID 10001, without
GTK or a display server. This does not validate recognition of every PDF.
A full OMR run on the cached “Piechota” PDF also produced `.mxl`; inspection
found three staves, including a detected bass-clef staff.
**Not live-tested:** the owner's Google accounts, Cloudflare Tunnel, or a Proxmox
server. No accounts were created and no server deployment was performed.

### Recommended layout: Proxmox → Debian VM → Docker Compose

1. Create a current Debian 12/13 virtual machine. For a beginner, a VM is safer
   and simpler than a system LXC container. If you choose LXC, Docker commonly
   requires `nesting=1` and `keyctl=1`, which changes the isolation model. Avoid
   privileged LXC and check your Proxmox version's documentation. Allow at least
   4 vCPU, 6 GB RAM (the container is limited to 4 GB), and enough disk for choir
   material. Audiveris can briefly use substantial CPU and memory.
2. Install Docker Engine and the Docker Compose plugin using Docker's official
   Debian instructions: <https://docs.docker.com/engine/install/debian/>. Avoid
   unofficial installation scripts.
3. Copy the project to the VM, open a terminal in the project directory, and
   create a private configuration file:

   ```sh
   cp .env.example .env
   chmod 600 .env
   ```

4. For a strictly local test, set **`JANKO_HOSTED=false`** in `.env`, leave the
   OAuth and Cloudflare fields empty, and keep the `tunnel` profile disabled.
   For hosting, leave it `true` and first complete the configuration below;
   missing OAuth credentials or administrator email prevent startup.
   Build and start:

   ```sh
   docker compose up -d --build
   docker compose ps
   docker compose logs --tail=100 app
   ```

   Open `http://127.0.0.1:8000` on the VM itself, or use an SSH tunnel only for
   your own testing. The port is bound only to the VM's loopback interface.
   `Start.bat` and the existing Windows local start are unchanged.

5. Stop and update:

   ```sh
   docker compose down
   docker compose up -d --build
   ```

   `docker compose down` preserves the `janko-data` volume. **Do not use**
   `docker compose down -v` if you want to keep its data.

### Hosted-access configuration

- Set `JANKO_HOSTED=true` and `JANKO_PUBLIC_URL` to the final HTTPS address, e.g.
  `https://choir.example.org`. You need a domain managed by Cloudflare and a
  configured Public Hostname.
- Get `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from Google Cloud Console
  for an OAuth **Web application** client. Add the authorized origin
  `https://choir.example.org` and redirect URI
  `https://choir.example.org/auth/callback`. Request only the `drive.readonly`
  scope. Configure the consent screen, add test users, or publish the app
  according to Google's policies. OAuth/Drive verification may require extra
  steps. Configure the exact callback required by the OAuth setup displayed by
  the app, and verify that URL in Google Cloud Console.
- `JANKO_DRIVE_ROOT_ID` is the Google Drive root folder ID.
  `JANKO_ADMIN_EMAILS` is a comma-separated administrator list (sync, calendar,
  and import). `JANKO_ALLOWED_EMAILS` can restrict access to listed addresses.
  Onboard a member by adding their email to the appropriate list and sharing
  the choir materials with them in Google Drive.
- Access always requires an address in `JANKO_ADMIN_EMAILS` or
  `JANKO_ALLOWED_EMAILS`—there is no public-access mode. Explicitly add every
  choir member, even if the Drive folder is public. A regular member listed in
  `JANKO_ALLOWED_EMAILS` must also pass the Drive-root access check. Only an
  address in `JANKO_ADMIN_EMAILS` can override a 403/404 while checking the
  root (for example, an emergency/bootstrap administrator). An upstream 5xx
  denies everyone with a 502 response. Reading the root alone never grants
  sign-in.
- Sessions last at most 7 days (`JANKO_SESSION_DAYS=7`). Membership and Drive
  access are rechecked at least once every 15 minutes. Removing an address from
  `JANKO_ALLOWED_EMAILS` denies the next request after the updated configuration
  has been loaded (run `docker compose up -d --force-recreate app` after editing
  `.env`). Drive permission
  changes take effect when the next check runs.
- OAuth credentials (access and refresh tokens) are stored
  server-side in SQLite on the `/data` volume, never in the browser. Volume
  backups and `.env` are sensitive; keep them encrypted with restricted access.
- The library, cache, generated files, and calendar are shared. Progress,
  setlist, and “seen” state are account-specific. Only administrators can sync,
  edit the calendar, or import MusicXML; those controls are disabled for members.
  OMR/generation have concurrency and request limits, so wait and retry when busy.
- Hosted mode disables browser caching of private files and the service worker
  so sign-out does not leave stale materials readable. A PWA/Home Screen
  icon can still launch the app, but hosted use requires Internet. Recordings
  and browser preferences remain local to each user's browser.
- OAuth and Cloudflare tokens are secrets. Put them only in the server's `.env`
  with restrictive file permissions. Never put them in chat, source control, or
  screenshots.

Cloudflare Tunnel is an optional `tunnel` profile. Put its token in
`CLOUDFLARE_TUNNEL_TOKEN` in `.env`. Once the app is ready for public access,
configure a Cloudflare Public Hostname to `http://app:8000`, then run:

```sh
docker compose --profile tunnel up -d
```

Do not enable this profile until authentication is configured and the
deployment has been tested. Another hosting provider with a domain and TLS is
also possible, with the same sign-in and authorization requirements.

### Data, backups, and checks

**Long operations through the tunnel:** PDF recognition and synchronization
run within a single HTTP request. Cloudflare's default Proxy Read Timeout is
125 seconds ([error 524](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/)).
A large PDF or initial sync can exceed it even while the backend is still
working. On 504/524, wait and retry later; prefer ready-made MusicXML from the
conductor, preprocessed scores, and syncing individual events instead of the
entire library. Long operations have not been verified through a real tunnel.
An asynchronous job queue with polling is a future enhancement, outside this
deployment scope.

The container runs non-root with a read-only root filesystem. Exceptions are
persistent `/data` and memory-limited `/tmp`. `/tmp` allows `exec` because
Audiveris (JNA/JavaCPP) extracts and loads its native libraries there; `noexec`
prevents the OMR engine from starting.

SQLite, downloaded files, OMR results, and generated audio are stored in the
persistent Docker volume `janko-data`, mounted at `/data`. Before making a
backup, stop the app so SQLite can finish writes, archive the volume, and start
the app again. Example archive command on the host (create `backups` first):

```sh
docker compose stop app
docker run --rm -v janko-muzykant_janko-data:/data:ro -v "$PWD/backups:/backup" alpine \
  tar -czf /backup/janko-data-$(date +%F-%H%M).tar.gz -C /data .
docker compose start app
```

Compose may prefix the volume name with the project name; check it with
`docker volume ls` and replace `janko-muzykant_janko-data` if your project uses
a different name. Also copy `.env` to a secure, encrypted location, never to a
public repository. Periodically check logs and `docker compose ps`;
`/api/health` is a liveness check, **not an access-control check**. OMR is
automatic music recognition and can make mistakes; check its output against the
original PDF.
