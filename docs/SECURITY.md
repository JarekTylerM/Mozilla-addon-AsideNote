# AsideNotes — karta bezpieczeństwa

Dokument dla działów IT i bezpieczeństwa oceniających rozszerzenie przed
dopuszczeniem do użytku w firmie. Każde twierdzenie ma wskazany sposób
sprawdzenia; najważniejsze są dodatkowo pilnowane automatycznym testem
(`tests/security-surface.test.mjs`) — zmiana, która by je złamała, nie
przejdzie `npm test`.

**W skrócie:** AsideNotes to lokalny notatnik w panelu bocznym Firefoksa.
Nie widzi stron, które użytkownik odwiedza, nie łączy się z siecią, nie
uruchamia kodu spoza paczki i nie ma przez co przyjąć poleceń z zewnątrz.
Notatki leżą w profilu Firefoksa w postaci niezaszyfrowanej — to jedyne
istotne ryzyko i jest opisane niżej razem z zaleceniami.

---

## 1. Uprawnienia

| Uprawnienie | Po co | Czego NIE daje |
|---|---|---|
| `storage` | zapis notatek w `browser.storage.local` profilu | dostępu do danych innych rozszerzeń ani stron |
| `alarms` | przypomnienia o terminach zadań | — |
| `notifications` | systemowe powiadomienie przy przypomnieniu | — |

Rozszerzenie **nie ma**: uprawnień do adresów (`<all_urls>`, `*://*/*`),
`tabs`, `history`, `cookies`, `bookmarks`, `webRequest`, `downloads`,
`clipboardRead`, uprawnień opcjonalnych. Nie ma też `content_scripts`,
`web_accessible_resources` ani `externally_connectable`.

Co z tego wynika:
- **nie może czytać ani zmieniać treści stron** — nie ma czym się do nich wstrzyknąć;
- **nie zna adresów otwartych kart** ani historii przeglądania;
- **strony internetowe nie mogą się z nim komunikować** — nie wystawia żadnego punktu wejścia.

*Jak sprawdzić:* `manifest.json`, klucz `permissions`; w Firefoksie
`about:addons` → AsideNotes → Uprawnienia.

## 2. Brak komunikacji sieciowej

- W kodzie nie ma `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`,
  `EventSource` ani WebRTC.
- Niezależnie od kodu blokuje to przeglądarka: polityka CSP rozszerzenia
  zawiera `connect-src 'none'`, a obrazy są ograniczone do
  `img-src 'self' data:` (żadnych „pikseli śledzących”). Nawet gdyby ktoś
  znalazł sposób na wstrzyknięcie skryptu, Firefox nie pozwoli mu wysłać
  danych na zewnątrz.
- Krój pisma Lexend jest w paczce — nic nie jest pobierane z CDN.
- Manifest deklaruje `data_collection_permissions: ["none"]`; brak telemetrii.

Jedyny ruch sieciowy, jaki może wywołać rozszerzenie, to otwarcie linku z
notatki **po kliknięciu przez użytkownika** — w nowej karcie, z
`rel="noopener noreferrer"`, czyli tak samo jak kliknięcie linku na
dowolnej stronie.

*Jak sprawdzić:* `manifest.json` → `content_security_policy`; podczas
pracy `about:debugging` → AsideNotes → Zbadaj → zakładka Sieć (pusta).

## 3. Brak zdalnego i dynamicznego kodu

- CSP: `script-src 'self'` (bez `unsafe-eval`, bez `unsafe-inline`),
  `object-src 'none'`, `base-uri 'none'`, `frame-src 'none'`,
  `worker-src 'none'`, `form-action 'none'`.
- Brak `eval`, `new Function`, `setTimeout` z tekstem; wszystkie importy
  są lokalne.
- Zero zależności uruchomieniowych: paczka zawiera wyłącznie własny kod
  JS/CSS/HTML, tłumaczenia, ikony i font. `devDependencies`
  (TypeScript, jsdom, Prettier) służą tylko do testów i nie trafiają do
  paczki. Skrypt budujący (`build.mjs`) używa wyłącznie wbudowanych
  modułów Node.js.
- Kod źródłowy jest otwarty (MPL-2.0); wersja z AMO jest podpisana przez
  Mozillę.

## 4. Obsługa treści wklejanej i zapisywanej

Notatki to HTML, więc główną klasą ryzyka jest wstrzyknięcie skryptu
(XSS) przez wklejoną treść. Warstwy ochrony:

1. **Sanityzacja przy zapisie i przy odczycie** (`scripts/sanitize.js`) —
   parsowanie w odłączonym dokumencie (`DOMParser`), biała lista tagów i
   atrybutów per tag; wszystko spoza listy zamieniane na sam tekst. Żaden
   atrybut `on*` nie przechodzi.
2. **Linki** — blokowane schematy `javascript:`, `data:`, `vbscript:`,
   `file:`, `blob:`, `about:`, `resource:`; wymuszone `target="_blank"` i
   `rel="noopener noreferrer"`.
3. **CSP** — nawet gdyby coś przeszło przez sanityzację, przeglądarka nie
   wykona skryptu inline ani handlera zdarzenia.
4. **Limity** (ochrona przed zawieszeniem przeglądarki): treść 50 KB,
   tytuł 200 znaków, wklejka 200 KB, import 2000 notatek / 500 tagów,
   głębokość zagnieżdżenia 60.

Komunikacja wewnętrzna (popup → tło) przyjmuje wiadomości wyłącznie od
samego rozszerzenia (`sender.id`) i waliduje identyfikatory wyrażeniem
regularnym przed zapisem.

## 5. Dane w spoczynku — ryzyko rezydualne

**Notatki nie są szyfrowane.** Leżą w profilu Firefoksa użytkownika, tak
jak historia przeglądania czy pamięć podręczna. Ma do nich dostęp każdy,
kto ma dostęp do tego profilu: inne konto z uprawnieniami administratora,
złośliwe oprogramowanie na stacji, kopia zapasowa profilu.

Rozszerzenie mówi o tym użytkownikowi wprost: ikona ostrzeżenia na dolnym
pasku i sekcja „Prywatność i bezpieczeństwo” w ustawieniach z prośbą, by
nie wpisywać haseł, kodów dostępu, PIN-ów ani danych logowania.

Pozostałe miejsca, w których treść notatki może wyjść poza profil —
wszystkie wyłącznie z inicjatywy użytkownika albo zgodnie z jego
ustawieniem:

| Kanał | Kiedy | Uwagi |
|---|---|---|
| Eksport JSON | przycisk „Eksportuj dane” | plik niezaszyfrowany, zapisywany tam, gdzie wskaże użytkownik |
| Schowek | „Kopiuj jako Markdown” / kopiowanie linku | tylko zapis do schowka, nigdy odczyt poza zdarzeniem wklejenia |
| Powiadomienie systemowe | przypomnienie o zadaniu | tytuł zadania widoczny na ekranie i w centrum powiadomień systemu |

## 6. Zalecenia wdrożeniowe

- **Instalacja i aktualizacje pod kontrolą IT** — polityki Firefoksa
  (GPO lub `policies.json`), klucz `ExtensionSettings`:
  ```json
  {
    "policies": {
      "ExtensionSettings": {
        "asidenotes-tyler@addons.mozilla.org": {
          "installation_mode": "force_installed",
          "install_url": "https://addons.mozilla.org/firefox/downloads/latest/<nazwa-na-AMO>/latest.xpi"
        }
      }
    }
  }
  ```
  `force_installed` uniemożliwia też przypadkowe odinstalowanie (które
  kasuje dane). Aby przypiąć wersję, `install_url` może wskazywać
  zweryfikowany plik `.xpi` na serwerze wewnętrznym.
- **Polityka treści:** notatnik nie jest miejscem na hasła ani dane
  sklasyfikowane — do tego służy firmowy menedżer haseł / repozytorium.
- **Stacje robocze:** szyfrowanie dysku (BitLocker) chroni profil
  Firefoksa, a więc i notatki, przy utracie sprzętu.
- **Kopie zapasowe** profilu Firefoksa obejmują notatki — traktuj je z tą
  samą klauzulą co resztę profilu.

## 7. Zgłaszanie podatności

Zgłoszenia przez prywatny kanał autora repozytorium (GitHub Security
Advisories lub kontakt podany w listingu AMO), nie przez publiczne
issue.
