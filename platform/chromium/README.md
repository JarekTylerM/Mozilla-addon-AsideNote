# AsideNotes dla Chrome i Edge (Chromium)

Ten katalog to **adapter**, nie kopia kodu. Cały kod rozszerzenia (`scripts/`,
`styles/`, `sidebar.html`, `popup.html`, `background.js`, `_locales/`) jest
wspólny i leży w korzeniu repo. Tutaj są tylko różnice Chromium, które build
dokleja do paczki.

```
platform/chromium/
├── manifest.mjs            manifest.json (Firefox MV2) → MV3 dla Chrome/Edge
├── runtime/
│   ├── browser-shim.js     globalne `browser` nad `chrome` + sidebarAction → sidePanel
│   └── background-sw.js    service worker: shim + wspólny background.js
└── _locales/<język>/       nadpisania tekstów, które mówią "Firefox"/"about:addons"
```

## Budowanie

```bash
npm run build:chromium
```

Wynik: `dist-chromium/` i `asidenotes-chromium-X.Y.Z.zip` (ta sama paczka idzie
do Chrome Web Store i do Edge Add-ons).

Wersja do testów lokalnych (bez minifikacji, nazwa „AsideNotes DEV”):

```bash
npm run build:chromium:dev
```

Ładowanie: `chrome://extensions` albo `edge://extensions` → włącz **Tryb
dewelopera** → **Załaduj rozpakowane** → wskaż `dist-chromium-dev/`. Po każdej
zmianie przebuduj i kliknij ↻ przy rozszerzeniu.

Skróty: wydanie Alt+Shift+Q (panel) i Alt+Shift+S (szybkie dodawanie), DEV
Alt+Shift+D i Alt+Shift+K — inne, żeby obie wersje mogły działać obok siebie.

**„nie ustawiony” przy skrócie**: Chromium przydziela sugerowany skrót tylko
przy instalacji i tylko wtedy, gdy nikt go nie zajmuje (inne rozszerzenie,
starsza wersja AsideNotes, skrót samej przeglądarki — Edge rezerwuje m.in.
Alt+Shift+A, B, C, P, R, W, X, Z). Zwolniony później skrót NIE zostanie
przydzielony sam. Naprawa: ustaw go w `edge://extensions/shortcuts`
(`chrome://extensions/shortcuts`) albo usuń rozszerzenie i załaduj ponownie.

Panel boczny otwierasz ikoną panelu bocznego przeglądarki (Chrome: ikona obok
paska adresu, Edge: pasek boczny), skrótem Alt+Shift+Q albo Shift+Enter
w szybkim dodawaniu.

## Co różni Chromium od Firefoksa (i gdzie to jest obsłużone)

| Firefox (wspólny kod)                  | Chrome / Edge                          | Gdzie                       |
|----------------------------------------|----------------------------------------|-----------------------------|
| Manifest V2                            | tylko Manifest V3                      | `manifest.mjs`              |
| `browser.*`                            | `chrome.*` (w MV3 też Promise)         | `browser-shim.js`           |
| `sidebar_action`, `sidebarAction.*`    | `side_panel`, `chrome.sidePanel`       | `manifest.mjs`, shim        |
| `sidebarAction.toggle()`               | brak — shim śledzi otwarte panele portem i zamyka je przez `window.close()` | shim |
| `browser_action` + `theme_icons`       | `action` (bez ikon zależnych od motywu)| `manifest.mjs`              |
| `_execute_browser_action`              | `_execute_action`                      | `manifest.mjs`, shim        |
| background `scripts` (event page)      | `service_worker`                       | `background-sw.js`          |
| CSP jako tekst                         | `{ extension_pages: … }`               | `manifest.mjs`              |
| `browser_specific_settings.gecko.id`   | ID nadaje sklep (z klucza publicznego) | —                           |
| `about:addons` → skróty                | `chrome://extensions/shortcuts`        | `_locales/`                 |

Znane ograniczenia:

- **Kliknięcie powiadomienia** nie zawsze otworzy panel: Chromium pozwala na
  `sidePanel.open()` tylko w geście użytkownika i przy znanym oknie. Wpis i tak
  zostaje zaznaczony (`_pendingSelectId`), gdy użytkownik otworzy panel.
- **Rozpoznanie wersji DEV** (`scripts/build-flavor.js`) patrzy na ID z `-dev@`,
  którego w Chromium nie ma — wersja DEV różni się tylko nazwą.
- **Dane nie przechodzą między przeglądarkami.** Każda przeglądarka ma własne
  `storage.local`; przenoszenie przez Eksport/Import w ustawieniach.

## Publikacja w Chrome Web Store

1. **Konto dewelopera**: <https://chrome.google.com/webstore/devconsole> — konto
   Google, jednorazowa opłata rejestracyjna 5 USD, weryfikacja e-maila. Dla
   firmy lepiej założyć konto na adres firmowy / grupę (przekazywanie własności
   jest kłopotliwe). Wymagane dane kontaktowe i — przy publikacji jako
   „trader” (UE, DSA) — dane firmy.
2. **Nowy element** → wgraj `asidenotes-chromium-X.Y.Z.zip`.
3. **Karta w sklepie** (Store listing): opis, kategoria (Productivity),
   język(i), ikona 128×128, **min. 1 zrzut ekranu 1280×800 lub 640×400**,
   opcjonalnie kafelek promocyjny 440×280.
4. **Prywatność** (Privacy practices) — obowiązkowe:
   - *Single purpose*: np. „Notatki i zadania w panelu bocznym przeglądarki”.
   - Uzasadnienie **każdego** uprawnienia: `storage` (zapis notatek lokalnie),
     `alarms` (przypomnienia o zadaniach), `notifications` (pokazanie
     przypomnienia), `sidePanel` (panel z notatkami).
   - Zbieranie danych: zaznacz, że rozszerzenie **nie zbiera** danych
     użytkownika (wszystko w `storage.local`, `connect-src 'none'`).
   - Remote code: **Nie** (brak zdalnego kodu — CSP `script-src 'self'`).
   - Link do polityki prywatności — wymagany, jeśli sklep uzna, że obsługujesz
     dane użytkownika; najprościej mieć krótką stronę „nie zbieramy danych”.
5. **Dystrybucja**: Publiczna / Niepubliczna (unlisted — tylko z linkiem) /
   Prywatna (tylko dla domeny Google Workspace lub listy testerów).
   Dla wewnętrznego użytku w firmie: *Unlisted* albo *Private*.
6. **Wyślij do weryfikacji.** Zwykle od kilku godzin do kilku dni; nowe konta
   i szerokie uprawnienia trwają dłużej. Nasze uprawnienia są wąskie.
7. **Aktualizacje**: podbij `version` w `manifest.json` (korzeń), przebuduj,
   w Dev Console → *Package* → *Upload new package* → wyślij. Wersja musi być
   wyższa od opublikowanej; użytkownicy dostają ją automatycznie.

Wskazówka: *Deferred publishing* pozwala przejść weryfikację i opublikować
ręcznie w wybranym momencie (np. równo z AMO).

## Publikacja w Microsoft Edge Add-ons

1. **Konto**: <https://partner.microsoft.com/dashboard/microsoftedge> — Partner
   Center, rejestracja w programie Microsoft Edge **bez opłat**. Konto
   indywidualne albo firmowe (firmowe wymaga weryfikacji firmy).
2. **Create new extension** → wgraj **ten sam** `asidenotes-chromium-X.Y.Z.zip`.
3. **Availability**: widoczność *Public* albo *Hidden* (tylko z linkiem),
   rynki (np. wszystkie).
4. **Properties**: kategoria (Productivity), link do polityki prywatności (jeśli
   wymagana), strona WWW / wsparcie, informacja czy zawiera treści dla
   dorosłych (nie).
5. **Store listings** (per język, `en` i `pl`): opis (min. 250 znaków), ikona
   300×300 (opcjonalna, inaczej 128 z paczki), **zrzuty ekranu 1280×800 lub
   640×480**, opcjonalnie kafelki promocyjne.
6. **Submit** z *Notes for certification* — warto opisać, jak przetestować
   (np. „Otwórz panel boczny ikoną, dodaj notatkę, ustaw zadanie z godziną”).
   Certyfikacja trwa zwykle do 7 dni roboczych.
7. **Aktualizacje**: *Update* → nowy pakiet → submit. Edge ma też API do
   automatycznej publikacji (Partner Center → *Publish API*), przydatne w CI.

Edge instaluje także rozszerzenia z Chrome Web Store (po zgodzie użytkownika),
ale własny wpis w Edge Add-ons jest lepszy: widoczność w sklepie Edge,
polityki IT (allowlista po ID z Edge Add-ons), brak ostrzeżenia „z innego
sklepu”.

### Wdrożenie wewnątrz firmy (bez publicznego sklepu)

- **Edge**: polityka grupy / Intune `ExtensionInstallForcelist` z ID z Edge
  Add-ons (wersja *Hidden* wystarczy). Można też hostować `.crx` samemu
  z `update_url`, ale wtedy trzeba podpisywać i utrzymywać plik aktualizacji.
- **Chrome**: `ExtensionInstallForcelist` z ID z Chrome Web Store (*Unlisted*
  albo *Private* dla domeny Workspace).

## Jak rozwijać kod pod kilka przeglądarek

**Jeden branch, jeden wspólny kod, adaptery per przeglądarka** — nie osobne
gałęzie git per przeglądarka. Gałęzie „firefox” / „chrome” rozjeżdżają się po
kilku tygodniach i każda poprawka trzeba przenosić cherry-pickiem.

Zasady:

1. **Funkcje piszesz raz, w korzeniu**, używając `browser.*` jak dotąd.
   Firefox działa natywnie, Chromium przez `browser-shim.js`.
2. **Różnice API trafiają do shimu**, nie do `if (isChrome)` rozsianych po
   `scripts/`. Jeśli potrzebujesz API, które działa inaczej (jak
   `sidebarAction`), dodaj je do `overrides` w `browser-shim.js`.
3. **Różnice manifestu** → `manifest.mjs`. Nie trzymaj drugiego
   `manifest.json` — wersja i uprawnienia zawsze z korzenia.
4. **Różnice tekstów** → `platform/chromium/_locales/<język>/messages.json`.
   Build nadpisuje tylko podane klucze i zatrzymuje się, jeśli klucz nie
   istnieje we wspólnym `_locales` (literówka nie przejdzie po cichu).
5. **Kolejna przeglądarka** (np. Safari, Opera): nowy katalog
   `platform/<nazwa>/` + gałąź `--target=<nazwa>` w `build.mjs`. Opera i Brave
   biorą paczkę Chromium bez zmian.
6. **Gdy różnica jest naprawdę w logice** (rzadko), przekaż ją przez
   możliwości, nie nazwę przeglądarki: np.
   `if (browser.sidebarAction?.toggle)` zamiast `if (isFirefox)`.
7. **Przed wydaniem** buduj obie paczki z tego samego commita:
   `npm run build` (AMO) i `npm run build:chromium` (Chrome + Edge), z tą samą
   `version`.
