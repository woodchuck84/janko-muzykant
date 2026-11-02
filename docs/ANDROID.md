# Janko Muzykant — hybrydowy Android 0.1.7 / APK

Dystrybucja APK i Windows PWA z jednego linku: [DISTRIBUTION.md](DISTRIBUTION.md).
Wersja 0.1.7 / kod 8 dodaje sprawdzanie `version.json` strony dystrybucji.
Dystrybutor ustawia `VITE_JANKO_DISTRIBUTION_URL` przed `npm run android:apk`;
bez znanego adresu przyszłej strony kontrola aktualizacji nie działa automatycznie.
Adres można też wpisać w aplikacji w „Aktualizacje APK”. Zachowany podpis.

One-link APK/PWA distribution and owner setup: [DISTRIBUTION.md](DISTRIBUTION.md).
Version 0.1.7 / code 8 adds update notices from the distribution site's `version.json`.
Set `VITE_JANKO_DISTRIBUTION_URL` before building to configure all APK recipients;
without a known site address automatic checks cannot discover a future domain.
The existing signing identity is preserved.

## Polski

**Po instalacji aplikacja otwiera bibliotekę bez logowania. Członkowie chóru nie
konfigurują Google Cloud, kluczy ani OAuth.** Wybierz „Synchronizuj Drive (tylko
odczyt)”, a następnie pobierz materiały utworu na telefon.

To samodzielny APK: interfejs, PDF, odtwarzanie, MusicXML, generowanie WAV i pamięć
działają na telefonie, bez komputera, FastAPI lub Proxmox. Google Drive jest tylko
źródłem danych. Aplikacja nie zmienia plików ani udostępniania.
Roman nie musi być właścicielem Drive i aplikacja nie wymaga uprawnień zapisu.

### Dwa tryby dostępu

**Domyślnie: publiczne materiały, bez klucza i OAuth.** Wykorzystujemy ten sam
publiczny widok Google, który działał w wersji komputerowej:
`https://drive.google.com/embeddedfolderview?id=...`, pobieranie `uc?export=download`
oraz eksport publicznych Google Docs do tekstu. Żadne konto nie jest używane.
Widoczne są tylko pliki/foldery udostępnione publicznie przez ich właściciela.
**Nie ma ograniczenia do członków chóru.** Rozdanie APK nie przekazuje dostępu do
prywatnych materiałów. Nie zmieniaj udostępniania Drive na potrzeby aplikacji.

Ten widok jest stroną HTML, **nie stabilnym, wersjonowanym API**. Parser wymaga
znanego formatu `.flip-entries`/`.flip-entry`; nieznanego HTML nie traktuje jako
pustej biblioteki. Limity: 12 MiB HTML, 1000 folderów, 8 poziomów podfolderów.
Pobieranie: do 150 MiB, maksymalnie 5 przekierowań, wyłącznie HTTPS na znane
domeny Google; bez cookies, tokenów, rozwiązywania CAPTCHA i omijania zgody.
Strony potwierdzenia pobrania lub brak publicznego widoku mają widoczny komunikat
przy pliku/folderze. **Pusty folder publiczny może zawierać niewidoczne prywatne
pliki** — wskazujemy tę niepewność, nie udajemy rozpoznania prywatnej zawartości.
Google może zmienić stronę lub ograniczyć pobieranie; wtedy potrzebna będzie
aktualizacja parsera albo opcjonalny dostęp przez API/logowanie.

**Opcjonalnie: „Zaloguj przez Google”.** Natywny AuthorizationClient korzysta
z `drive.readonly`, `openid`, `email`. Nie ma OAuth w WebView, sekretu w APK ani
tokenów w JavaScript. Logowanie nie nadaje praw dostępu: działa tylko dla kont,
które już mogą czytać odpowiedni folder/pliki. Po logowaniu synchronizuj ponownie.
Publiczne i dodatkowe dostępne materiały są łączone po ID, bez duplikatów.
Przy powrocie do trybu publicznego dane konta są usuwane; dane publiczne pozostają.

### Paczka i aktualizacje

Pakiet `com.jankomuzykant.app`, wersja **0.1.7 / kod 8**, Android 7.0 / API 24+.
Usługi Google Play są potrzebne do opcjonalnego logowania, nie do publicznego odczytu.
Instalator: **`C:\Users\roman\OneDrive\AI_DEV\Janko Muzykant\Janko-Muzykant-debug.apk`**.
Instaluj jako aktualizację bez odinstalowania poprzedniego APK — podpis jest ten sam.

Budowanie wymaga Node 22+, JDK 21, SDK Android 36 i zaakceptowanych licencji:

```powershell
npm ci
npm run android:apk
```

`Build-Android.ps1` buduje/synchronizuje interfejs i APK, a po sukcesie kopiuje
paczkę do folderu projektu. Wybiera lokalny JDK 21 z
`android\.tools\jdk21\jdk-21.0.13+9`, jeśli `JAVA_HOME` wskazuje starszą wersję;
SDK domyślnie `%LOCALAPPDATA%\Android\Sdk`. Na Windows tymczasowe wyniki Gradle
są poza OneDrive: `%LOCALAPPDATA%\JankoMuzykant\android-build\<hash-folderu>\app\`.
Skrypt zawsze kopiuje gotowy APK do głównego folderu projektu. Również kompletny
zestaw zasobów WebView jest kopiowany do `web-assets` w tym katalogu cache;
Gradle/lint nie skanują zastępczych plików OneDrive. Używaj `npm run android:apk`
po zmianach interfejsu. Klucz podpisu nie został przeniesiony.

To **debug-signed APK do testów**, nie wydanie Google Play. Zachowaj
`%USERPROFILE%\.android\debug.keystore` poza repozytorium. Inny podpis uniemożliwi
aktualizację i wymaga osobnej rejestracji OAuth. Nie dodawaj kluczy/haseł do Git.

```text
SHA-1: 7B:22:1B:6B:CF:08:F8:D4:0F:DC:8E:9D:3D:97:36:BA:38:26:1B:56
SHA-256: EE:35:DA:3E:8D:F8:60:2A:31:46:6B:FC:C7:F5:59:91:4D:EC:C6:D2:58:1F:9E:C8:63:EE:B8:95:4C:84:82:10
```

### Jednorazowa konfiguracja Romana (tylko opcje)

**Publiczny odczyt domyślny nie wymaga żadnej konfiguracji Google Cloud.**

Opcjonalny klucz API (alternatywny publiczny dostęp przez oficjalne Drive API):

1. W swoim projekcie Google Cloud włącz **Google Drive API** i utwórz klucz API.
2. Ogranicz klucz do **Google Drive API** i aplikacji Android:
   `com.jankomuzykant.app` plus powyższy SHA-1 podpisu.
3. Wpisz klucz lokalnie w ignorowanym `android\local.properties`:
   `janko.driveApiKey=...` (przykład `android\local.properties.example`), albo ustaw
   `JANKO_DRIVE_API_KEY` w środowisku budowania. Następnie `npm run android:apk`.
   Nie przesyłaj klucza w czacie i nie dodawaj go do repozytorium.
4. APK z kluczem korzysta z Drive API zamiast HTML. Natywne żądania GET zawierają
   nagłówki `X-Goog-Api-Key`, `X-Android-Package` i `X-Android-Cert`.

**Klucz w APK jest możliwy do wydobycia**, nawet jeśli nie przekazujemy go do JS.
Ograniczenia API/pakietu i limity kwot są konieczne, ale nie są ochroną członkostwa
ani pełną ochroną przed fałszowaniem nagłówków klienta REST. Klucz nie nadaje
uprawnień do prywatnych plików. Tryb API z prawdziwym kluczem pozostaje niesprawdzony,
dopóki Roman go nie skonfiguruje.

Opcjonalne Google OAuth:

1. W swoim projekcie Google Cloud włącz Drive API; skonfiguruj Google Auth Platform.
2. Dodaj zakresy `openid`, `email`, `https://www.googleapis.com/auth/drive.readonly`.
3. Utwórz klienta OAuth **Android**: pakiet `com.jankomuzykant.app`, SHA-1 powyżej.
   Nie potrzeba `client_secret`, web client ID ani pliku `google-services.json`.
4. Dla osób bez dopisywania do listy testowej ustaw odbiorców zewnętrznych i status
   **In production**. Bez weryfikacji Google użytkownicy mogą zobaczyć ostrzeżenie
   „aplikacja niezweryfikowana”; jeśli Google pozwala kontynuować, robią to świadomie.
   Zakres `drive.readonly` jest ograniczony: dla niezweryfikowanej aplikacji może
   obowiązywać limit **około 100 nowych użytkowników**. Produkcja nie usuwa tego
   limitu ani wymogów weryfikacji. Administrator Workspace/Google może zablokować
   dostęp całkowicie. Do szerszej dystrybucji potrzebna może być weryfikacja Google.
5. Alternatywny status Testing wymaga listy użytkowników testowych i nie spełnia
   celu „każdy odbiorca bez konfiguracji”. Nie wybieraj go dla zwykłej dystrybucji.
6. Użytkownik wybiera konto i udziela odczytu. Konto musi już mieć dostęp do Drive;
   ani Roman, ani aplikacja nie muszą zmieniać cudzych uprawnień.

### Dane, offline, funkcje i ograniczenia

Pliki, WAV i postępy są w prywatnych katalogach
`files/accounts/<hash-konta>/downloads/`, `generated/` i `state.json`.
Tryb publiczny ma oddzielną przestrzeń `anonymous-choir`, osobną od każdego konta.
Publiczne metadane są przenoszone po logowaniu, **nie ścieżki cache/nagrania/postępy**.
Konto Google identyfikujemy po `sub`; metadane sesji szyfruje Keystore AES-GCM;
token jest tylko w pamięci procesu. Backup Android jest wyłączony.
Nagrania są w prywatnym IndexedDB WebView, osobno dla każdego konta/trybu.
Zmiana/wylogowanie konta usuwa jego lokalne dane. Nie usuwa konta Google ani
globalnej zgody. Cofnięcia dostępu nie można natychmiast wykryć offline.
Boot/wznowienie i online pobieranie sprawdzają dostęp; offline służy tylko do
wcześniej pobranych materiałów. Błąd publicznego folderu nie usuwa danych telefonu.

Dostępne: PDF, per-part audio/mikser, tempo bez zmiany wysokości, A–B/zakładki,
MusicXML/MXL, wybór pięciolinii/voice, analiza, SVG/kursor, instrumentalny WAV,
Coaching/mikrofon/nagrania/rozgrzewki/pamięć, ręczna gotowość/datowanie/program.
Brak OMR PDF na Androidzie. Generator czyta zapisane takty przy stałym tempie:
bez repetycji/volt/D.C./D.S./fermat/zmian tempa; pomija przednutki. Wielogłos wymaga
świadomego wyboru wykrytego voice lub obsługiwanej górnej/dolnej nuty akordu;
nierozstrzygalne nakładanie nadal blokuje generację. Kalendarz PDF odczytuje pełne daty liczbowe z warstwy
tekstowej; nie rozpoznaje skanów, nazw miesięcy ani nie dopowiada brakującego roku.
Potwierdzenie i przypisanie do wydarzenia są obowiązkowe. Raport braków dotyczy
tylko widocznych materiałów. Stoper zapisuje czas dla utworu/głosu, przeżywa
przejście do innej zakładki i restart; pojedyncza sesja ma limit 4 godzin.
Program przechodzi do kolejnych nagrań, gdy aplikacja pozostaje otwarta; pętla A–B
lub „Cały utwór” wstrzymuje przejście. Nie ma usługi odtwarzania w tle/na zablokowanym ekranie.
Fizyczny mikrofon i prawdziwe Google OAuth wymagają testów na telefonie.

### Nowe w 0.1.4: stały odtwarzacz i nuty

Odtwarzacz pozostaje aktywny w bibliotece, analizie, Coachingu, planie i ustawieniach.
Przejście na stronę innego utworu nie przerywa słuchania; „Odtwarzaj ten utwór”
świadomie zmienia nagranie. Poprzedni/następny i koniec nagrania korzystają z puli
wybranego wydarzenia, z zapisaną kolejnością programu; bez wydarzenia — wszystkie
utwory. Wyszukiwanie nie zawęża puli. Koniec puli zatrzymuje odtwarzanie.
Brak własnej partii daje komunikat i zatrzymanie, a nie inny głos lub pełny chór.
S i A mogą służyć odpowiednim podziałom I/II.

„Cały utwór” powtarza całe nagranie. A oznacza początek, B koniec fragmentu;
„Pętla” powtarza A–B. Włączenie jednego trybu wyłącza drugi. Ręczna zmiana
utworu resetuje te ustawienia. Stan utrzymuje się między ekranami w aplikacji,
ale nie obiecujemy odtwarzania po zablokowaniu telefonu lub zamknięciu procesu.

W Analizie MusicXML wybrana linia ma podświetlanie i kliknięcie nuty do odtwarzania.
WAV i nuty korzystają z tych samych czasów syntezy; nie zmierzono opóźnienia
głośnika/Bluetooth. Ekran podaje pokrycie mapy: nie obiecujemy podświetlania
zdarzeń bez potwierdzonego odpowiednika graficznego.
PDF bez MusicXML nie ma wiarygodnej mapy pojedynczych nut.
Dla istniejącego nagrania można włączyć „Próbuj z nagraniem ze stałego odtwarzacza
(kalibracja)”: wybrać nutę, zatrzymać nagranie w jej wejściu, zaznaczyć punkt 1,
powtórzyć dla późniejszej nuty i punktu 2. To **liniowe przybliżenie tylko pomiędzy
punktami**, dla tego nagrania w bieżącym ekranie analizy; nie rozpoznawanie
wykonania. Rubato, repetycje i różne tempo wewnątrz odcinka rozjeżdżają mapę.
Kalibruj krótkie fragmenty i porównuj ze słuchu, nie zakładaj dokładnego dopasowania.

Przykład „Jak to na wojence ładnie”: PDF ma bas, ale wynik OMR z komputera jest
błędnie rozwarstwiony. P3/voice 1 ma 173 zdarzenia G2–E5, brakuje taktów 12/14
i występuje nieprawidłowo wysokie zakończenie; voice 2 ma tylko takty 12/14 G2–D3.
Wybór „Melodia wewnątrz pięciolinii” pozwala świadomie odsłuchać wykrytą linię,
**nie naprawia nut i nie skleja brakujących taktów**. Do poprawnego kompletnego
basu potrzebny jest sprawdzony MusicXML. Na Androidzie importuj taki plik z telefonu;
nie ma OMR PDF ani automatycznego dostępu do plików cache z komputera.
173 zdarzenia dotyczą silnika komputerowego z rozwiniętą repetycją;
telefon generuje 149 zdarzeń w zapisanej kolejności, bez rozwijania repetycji.

### Nowe w 0.1.5: moduł odtwarzacza na stronie utworu

Na stronie utworu w bibliotece ponownie dostępny jest cały moduł
„Posłuchaj. Powtórz. Zaśpiewaj.”: wybór nagrania, sterowanie, tempo, powtarzanie,
mikser i zakładki. To druga powierzchnia sterująca **tym samym** odtwarzaczem —
nie tworzy dodatkowego źródła dźwięku. Sterowanie na stronie i w dolnym pasku
pokazuje wspólny stan. Gdy odtwarzacz ma inny utwór, przycisk strony przełącza na
oglądany utwór z wybranym głosem; pula wydarzenia i kolejność programu zostają
zachowane. Brak nagrania własnej partii nadal kończy się jawnym komunikatem.

### Nowe w 0.1.6: radosny chór Vox Apostoli

Nowa, autorska ikona przedstawia trzech śpiewających chórzystów, nutę i wspólny
śpiewnik z literami VA. Ciemna zieleń i krem pasują do aplikacji; nie jest to
oficjalne logo chóru. Android ma ikonę adaptacyjną z bezpiecznym marginesem,
wariant jednobarwny dla ikon tematycznych Android 13+, okrągłe i standardowe
bitmapy oraz spójny ekran startowy. PWA i ikona Apple korzystają z tego samego
projektu. Źródło: `public\choir-icon.svg`; odtworzenie zasobów:
`npm run icons:generate` (wymaga Chromium z Playwright).

Sprawdzono aktualizację APK 0.1.5 → 0.1.6 bez odinstalowania i nową okrągłą
ikonę w launcherze emulatora Android 16/API 36 oraz uruchomienie aplikacji.
Maski kwadratowa/zaokrąglona i wariant jednobarwny zostały sprawdzone w podglądzie
grafiki; nie testowano ikon tematycznych ani launcherów producentów na telefonach.

### Co oznacza wersja hybrydowa i porównanie ekranów

**Tak: APK jest aplikacją hybrydową — React działa we wbudowanym WebView,
a natywny Android obsługuje Drive, logowanie, pliki i mikrofon.** Nie otwiera
strony serwera ani Google OAuth wewnątrz WebView. Wygląd, ikony i style mobilne
pochodzą z wersji web; odtwarzacz, PDF, Coaching oraz znaczniki materiałów są
wspólnymi komponentami, nie oddzielnymi imitacjami. Biblioteka przywraca również
zieloną kartę powitalną z zaakceptowanego mockupu (obecny kompaktowy web ją ukrywa).

| Ekran / funkcja | Telefon APK | Różnica względem lokalnego web |
|---|---|---|
| Biblioteka | Ten sam znak Janko, kolory, karta powitalna, statystyki, wyszukiwanie, filtr i znaczniki Nuty/Mój głos/Wolniej/Cały chór/Lokalnie | Natywny odczyt Drive i pamięć telefonu, zamiast FastAPI i dysku komputera |
| Nawigacja / głos | Biblioteka, Plan i postępy, Mój głos, Ustawienia; wybór głosu w oknie; bez przewijania poziomego | Ustawienia telefonu mają informacje o natywnym dostępie; pasek systemowy i klawiatura Android nie zasłaniają interfejsu |
| Nuty / nagrania | Wspólny PDF z gestami i wspólny dolny odtwarzacz, tempo, A–B, zakładki, mikser i pomoc na dotyk | Pierwsze nuty i zgodne nagrania pobierają się przy otwarciu utworu; „Zapisz offline” pobiera resztę |
| Analiza / generowanie | MusicXML lub MXL z Drive albo import z telefonu; wybór pięciolinii, potwierdzenie, zakres, trudność, oddechy, tekst, SVG/kursor i lokalny WAV | Kod TypeScript na telefonie zastępuje Python/music21; to uproszczona analiza, nie identyczny silnik. Ograniczenia rytmiczne i repetycji podano powyżej |
| PDF → MusicXML | Nieobsługiwane w samodzielnym APK | Audiveris wymaga środowiska komputerowego; samo opakowanie HTML w APK nie przenosi tej usługi |
| Coaching | Wspólny ekran mikrofonu, nagrywania, porównania, fraz, rozgrzewek i pamięci | Wzorzec nutowy wymaga lokalnego MusicXML/WAV; nagrania są prywatne w telefonie |
| Plan / materiały | Potwierdzane daty z tekstu PDF, ręczne daty, odliczanie, kolejność programu, odtwarzanie, postęp, stoper, tydzień/seria ćwiczeń, raport braków i nowe pliki po sync | Daty i historia są osobiste na telefonie, nie współdzielone przez serwer; program działa na otwartym ekranie |
| Offline | Pobrane nuty, nagrania, importy i WAV pozostają na telefonie | Nie wymaga komputera; nowe pobrania i potwierdzenie dostępu wymagają internetu |

Przeglądarka Chrome i APK mają **odrębne sesje Google**. Logowanie do Drive w
Chrome nie przekazuje APK cookies ani uprawnień. Publiczne pliki działają bez
logowania; prywatne wymagają natywnego OAuth i konta, które już ma dostęp.
Jednorazowa konfiguracja aplikacji OAuth należy do dystrybutora, nie odbiorców APK.

Jeżeli niezbędne jest identyczne automatyczne OMR i pełna analiza music21,
opcją jest bezpieczny backend na komputerze/Proxmox. Telefon wysyłałby wtedy
żądanie do tego serwera, który musi być dostępny. **To tylko opcja, nie wdrożona
zależność**; obecny APK działa samodzielnie. Alternatywnie rozpoznaj PDF raz na
komputerze i prześlij gotowy MusicXML/MXL na telefon — bez zmieniania cudzych plików Drive.

### Sprawdzone w 0.1.4

Emulator Android odczytał rzeczywisty publiczny Drive: **21 utworów / 147
materiałów**, bez OAuth, klucza ani serwera aplikacji. Nagranie B „Piechoty”
zachowało ten sam element audio i rosnący czas w Analizie, Bibliotece, Planie
i Ustawieniach. Sprawdzono rzeczywisty powrót do początku po końcu nagrania
przy „Cały utwór”, a po wyłączeniu powtarzania automatyczne przejście do
„Pierwszej brygady”. Brak partii, granice puli i zmianę głosu w trakcie pobierania
sprawdzają testy UI.

Przez natywny wybór pliku zaimportowano istniejący desktopowy MXL „Wojence”,
bez wysyłania go na Drive. Potwierdzono wybór P3/voice 1, zakres G2–E5,
telefoniczny WAV oraz kliknięcie nuty i podświetlenie w prawdziwym WebView.
Po wyłączeniu radia Wi-Fi/danych, usunięciu tras sieciowych i restarcie finalnego
APK działały pobrane PDF/audio „Piechoty”, odczyt lokalnego MXL i generowanie WAV.
Finalny APK instalowano jako aktualizację; kod 5 i dotychczasowy certyfikat
podpisu zweryfikowano.

Pokrycie mapy dla badanego MXL: **169/173 zdarzeń desktop, 149/149 telefon**.
To pokrycie powiązań SVG/czasu, **nie miara poprawności muzycznej OMR ani
dokładności dopasowania nagrania chóru**. Test kalibracji sprawdza oznaczenie
punktów i przesunięcie czasu; rzeczywistej dokładności muzycznej nie zmierzono.
Testy: **37 JavaScript, 83 backend, 16 JVM, 19 web E2E, 6 hybrydowego telefonu**;
oba buildy i lint Android przechodzą. Scenariusze telefonu w Playwright używają
kontrolowanego mostka natywnego, niezależnie od opisanych wyżej realnych prób
emulatora. Brak testu na fizycznym telefonie, prawdziwego OAuth/API key i
mikrofonu sprzętowego. Drive pozostał wyłącznie do odczytu.

### Sprawdzone wcześniej (0.1.3)

APK zainstalowano jako aktualizację w emulatorze Android, bez klucza API i bez
konta Google. Rzeczywisty Drive zsynchronizował **21 utworów / 147 materiałów**.
Dla „Piechoty” pobrano wszystkie 7 plików; PDF ma 4 strony, nuty wyświetlają się,
a czas odtwarzania nagrania rośnie. Po włączeniu trybu samolotowego i ponownym
uruchomieniu aplikacji pobrany PDF i audio nadal działają, z widocznym trybem offline.
Android używa zgodnych ze starszym WebView pakietów PDF.js legacy, także workera;
wersja komputerowa pozostaje bez zmian.

W wydaniu 0.1.3 porównano ekran po ekranie APK z web na Pixel 7/iPhone 14.
W rzeczywistym emulatorze odtworzono równocześnie trzy nagrania, sprawdzono
wyciszenie własnego głosu i pomoc miksera na dotyk. Import istniejącego MXL
„Piechoty” przez systemowy wybór pliku dał 182 nuty basu G2–G3 i prywatny WAV;
naprawiono filtrowanie MXL i zachowanie lokalnych importów po synchronizacji.
Rzeczywisty kalendarz z Drive dał 30 kandydatów dat, bez użycia serwera;
przypisanie 07.11.2026 do wydarzenia Piławy zapisano tylko w emulatorze.
Odtwarzanie programu również sprawdzono na realnym nagraniu. Stoper zachował
sesję po restarcie i zapisał ją w historii dnia. Ponowna synchronizacja zachowała
import MXL, sesję i osobistą datę. Finalny APK odtworzył nuty i nagranie basu
po restarcie w trybie samolotowym, bez błędów.

Testy: 30 JavaScript, 4 scenariusze telefonu, 16 JVM, lint Android i 17 web E2E.
Prawdziwe OAuth, wariant z kluczem API i fizyczny mikrofon nie były sprawdzane.
Dla domyślnego trybu publicznego **nie zostały żadne kroki Google Cloud**.

### Błędy

Nie zamieniamy błędów Google na „anulowanie”. Parsujemy każdy Intent wyniku,
zachowując status Google; pusty wynik to przerwanie/nieznana przyczyna.
Publiczny folder/pliki niedostępne: komunikat przy elemencie i opcjonalne logowanie.
Nieznany HTML/potwierdzenie pobrania: `PUBLIC_UNAVAILABLE`; klucz odrzucony:
`API_KEY_INVALID`; prywatny materiał: `SIGN_IN_REQUIRED`; błędy usług nie
usuwają danych. Ukrytych prywatnych elementów nie można wylistować anonimowo.

## English

### New in 0.1.6 / version code 7

The original choir icon features three joyful singers, a musical note and a
shared VA songbook in forest green and cream; it is not the choir's official
logo. Android adaptive/monochrome (Android 13+ themed icons)/legacy/round icons,
splash, PWA and Apple icons use the same source, `public\choir-icon.svg`.
Regenerate assets with `npm run icons:generate` using Playwright Chromium.
The package and existing debug signing identity remain unchanged for updates.
Verified an in-place 0.1.5 → 0.1.6 APK update, the circular launcher icon and app
startup on an Android 16/API 36 emulator. Square/rounded masks and monochrome
were inspected in generated previews, not vendor launchers or themed home icons
on physical phones.

### New in 0.1.4 / version code 5

The shared web/APK player keeps the same recording and state across tabs,
library, planning and settings. Opening another song does not replace playback;
use **Odtwarzaj ten utwór** or previous/next. The selected event defines the
queue, respecting saved program order; without an event it is the entire library,
independently of search text. Track end advances, queue end stops. Missing chosen
voice recordings stop with an explicit message, never another part/full mix;
combined S/A tracks may serve their corresponding divisi.

**Cały utwór** repeats the entire recording. A marks a fragment start, B its end;
**Pętla** repeats A–B. These modes are mutually exclusive and postpone automatic
progression. A deliberate song change resets them. This is cross-screen
foreground playback, not a background/lock-screen service.

MusicXML notes can be highlighted/clicked against generated WAV timestamps.
This is nominal synthesized timing, not measured speaker/Bluetooth latency.
The screen reports how many audio events have a confirmed graphical match;
faulty/complex scores may have a partial map, with no claimed highlighting of
unmatched events. PDF alone has no individual-note map.
For an existing recording, enable the calibration checkbox in Analysis, choose
a note and pause at its entrance, mark point 1, then repeat for a later note and
point 2. A linear approximation is used **only between the two anchors**, for
that track and analysis-screen session. Rubato/repeats/tempo changes can drift;
there is no automatic performance alignment. Mechanism tests do not establish
musical alignment accuracy on real rehearsal recordings.

For **“Jak to na wojence ładnie”, B**, the PDF has bass but the existing desktop
OMR is incorrectly layered. P3/voice 1 has 173 events, G2–E5, missing bars 12/14
and an implausibly high ending; voice 2 contains only bars 12/14, G2–D3. The new
explicit internal-voice/upper/lower choice permits inspection and guide generation
without guessing or filling gaps. It does **not** repair the score: checked,
named MusicXML is needed for a reliable complete bass. The APK can import the
desktop MXL locally, not recognize PDF or access a PC cache automatically.

Android builds stage WebView assets as well as native outputs outside OneDrive,
so lint/Gradle do not snapshot placeholder files. Use `npm run android:apk`
after UI changes; the installer still goes directly to the project root.

### New in 0.1.5 / version code 6

The complete **“Posłuchaj. Powtórz. Zaśpiewaj.”** module is available again on
each song page in the library: recording selection, transport, speed, repeat,
mixer and bookmarks. The page controls and fixed bottom player are two control
surfaces for the **same** player/audio source. They stay synchronized; starting
from a song page switches to that song and the selected voice while retaining
the current event/program queue. If the selected part is unavailable, the
existing explicit message is shown rather than substituting another recording.

**0.1.4 verification:** actual public sync on the emulator returned 21 songs /
147 materials. The same bass audio continued across Analysis, Library, Planning
and Settings; actual track end repeated or advanced Piechota → Pierwsza brygada.
The existing Wojence MXL was imported through the native picker, with explicit
P3/voice 1 selection, phone-local WAV and verified note click/highlight. After
disabling Wi-Fi/data, removing network routes and restarting the final APK,
cached PDF/audio and local MXL/WAV generation still worked. Update installation,
version code 5 and the unchanged signing certificate were verified.
The actual source mapped 169/173 desktop audio events and 149/149 phone events
(phone uses written order, desktop expands a repeat). **Mapping coverage is not
musical OMR correctness or measured rehearsal-recording alignment accuracy.**
37 JS, 83 backend, 16 JVM, 19 web E2E and six hybrid-phone scenarios pass, plus
both builds/Android lint. Phone Playwright scenarios mock the native bridge;
actual emulator checks above are separate. Real OAuth/API key, handset microphone,
speaker latency and lock-screen playback remain unverified.

Validated on an Android emulator using the actual Drive, without an API key or
Google account in 0.1.3: **21 songs / 147 materials**, all seven Piechota downloads,
four-page PDF rendering and advancing audio playback. Downloaded score/audio also
work after airplane mode and an app restart, with an explicit offline notice.
Android bundles both PDF.js legacy renderer and worker for older WebViews;
desktop rendering is unchanged. JavaScript tests, four phone scenarios, JVM tests
and Android lint pass. Real OAuth/API-key access and physical microphone testing
remain unverified. **No Google Cloud setup remains for default public access.**

**Anonymous mode is the default; recipients need no Cloud/OAuth/key setup.**
The APK uses the same key-free Google public `embeddedfolderview` HTML and
`uc?export=download`/public Docs text export as the desktop application.
Only publicly shared materials are visible. No choir membership restriction
exists; distributing an APK never transfers anyone's private Drive permissions.
Roman need not own the Drive and the app never changes files/sharing.

The public HTML view is **not a stable versioned API**. The bounded parser
rejects unexpected markup instead of silently claiming an empty folder.
Downloads follow at most five HTTPS redirects to known Google hosts only,
without cookies/tokens, CAPTCHA solving or confirmation bypass. Unknown pages
produce per-file/folder messages. Empty public listings can hide private content;
optional native Google sign-in only helps accounts that already have permission.
Sync after login to discover additional materials; IDs are deduplicated.

APK **0.1.3 / code 4**, `com.jankomuzykant.app`, Android 7/API 24+.
Use Node 22+, JDK 21/SDK 36 and `npm run android:apk`.
The distributable always lands at **`Janko-Muzykant-debug.apk` in the project root**.
The debug certificate above is unchanged; install as an update without uninstalling.
Retain `%USERPROFILE%\.android\debug.keystore`; Play/release signing is separate.

**Default public reading needs no owner steps.** Optional official anonymous
Drive API: Roman enables Drive API in his own Cloud project, creates an API key,
restricts it to Drive API + Android package/SHA-1, supplies it only via ignored
`android/local.properties` (`janko.driveApiKey`) or build environment
`JANKO_DRIVE_API_KEY`, and rebuilds. Native GET headers carry the key/package/
certificate; no real key is committed. **An embedded APK key is extractable**;
REST application headers can be spoofed, so restrictions/quotas mitigate abuse,
not membership protection. A key grants no private file access.
Real API-key mode remains unverified without a supplied key.

**Optional OAuth:** enable Drive API; configure consent with `openid`, `email`,
`drive.readonly`; register an Android client for the package/certificate SHA-1.
For ordinary recipients use External + **In production**, not a per-user Testing
list. An unverified application requesting restricted Drive scopes may show an
unverified-app warning and have an **approximately 100-new-user cap**; production
does not waive verification/limits. Google/Workspace administrators may prohibit
continuation. Verification may be required before broader distribution.
There is no client secret/web client ID to embed, no OAuth WebView, no token in JS.
Recipients only choose an already-authorized account and consent; permissions
are not granted by signing in or installing the APK.

Guest data is isolated from every Google account. Guest metadata, not private
cache paths/recordings/readiness, is merged after login. Account files/session are
app-private; identity is Keystore-encrypted, tokens process-memory only, Android
backup disabled. Sign-out/switch deletes that signed-in account's data, restoring
the separate guest library. Offline revocation is not immediate; downloaded
materials can be practiced offline after explicit connectivity failure.

**Hybrid means bundled React in an Android WebView plus native Drive, Google
authorization, private files and microphone integration — not a website pointing
at a PC.** This version reuses the web mobile styles and actual PDF, Player,
Coaching and badge components. The approved hero/library design, four-item
navigation and fixed player are restored; native insets keep system bars and
the keyboard out of the controls. Chrome sign-in cookies are not inherited:
public materials need no login, private materials need the user's own authorized
Google account and the distributor's one-time native OAuth registration.

| Screen / feature | Standalone APK vs local web |
|---|---|
| Library / settings | Shared phone design, cards/filter/badges/voice selection; native access and private phone storage replace server settings |
| Score / recordings | Shared gesture-enabled PDF and fixed audio player, mixer, A–B, bookmarks; initial score and suitable tracks automatically download |
| Analysis / WAV | Local MusicXML/MXL import, staff confirmation, SVG/cursor, range, difficulty, breathing/lyrics and instrumental WAV; TypeScript heuristics replace Python/music21 |
| Coaching | Shared microphone/recording/comparison/phrase/warm-up/memory UI; targets require local MusicXML/WAV |
| Planning | Private readiness/timer, weekly history/streak, missing-material report, new-file notices, manual/confirmed numeric PDF dates, countdown and foreground sequential program |
| Offline | Cached PDFs/audio, imports and guides work without the PC; new downloads/access checks require internet |

**Not equivalent to the desktop engine:** no automatic PDF-score OMR, musical
repeat/volta/DC/DS/fermata/tempo-change interpretation, or Android background
audio service. Calendar extraction reads full numeric dates from PDF text
(maximum 20 pages), never OCR/scans or inferred years; event/date confirmation
is mandatory. A–B loops postpone program advancement. Timers persist locally
and cap individual sessions at four hours. Handset microphone and real optional
OAuth still require live testing.

Full automatic Audiveris/music21 could be supplied by an **optional** secured
PC/Proxmox backend, but that is a proposal only: no server dependency or upload
was added. Alternatively, recognize once on a computer and import the resulting
MusicXML/MXL into the phone, without modifying the source Drive.

For 0.1.3 the actual emulator additionally verified three simultaneous rehearsal
tracks, own-part muting/tap help, native MXL picker import (Piechota: 182 bass
notes, G2–G3) and phone-local WAV, 30 real calendar date candidates and real
foreground program playback. A practice timer survived restart and saved daily
history; read-only resync retained the MXL, practice session and personal date.
The final APK also played cached score/bass audio after an airplane-mode restart.
Automated checks: 30 JavaScript, 16 JVM, four phone
flows, 17 web E2E, builds and Android lint. Phone scenarios use a mocked native
bridge; real emulator checks are listed separately above. Windows native builds
use `%LOCALAPPDATA%\JankoMuzykant\android-build\<checkout-hash>` outside OneDrive;
the distributable remains in the project root and the signing key is unchanged.

References:
[Authorization](https://developer.android.com/identity/authorization),
[unverified apps](https://support.google.com/cloud/answer/7454865),
[API key restrictions](https://cloud.google.com/api-keys/docs/add-restrictions-api-keys).
