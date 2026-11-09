# AsideNotes

**A lightweight notepad in the browser sidebar.** Rich-text notes and tasks, always one keystroke away — no account, no server, no telemetry.

![Firefox 120+](https://img.shields.io/badge/Firefox-120%2B-FF7139?logo=firefoxbrowser&logoColor=white)
![Manifest V2](https://img.shields.io/badge/Manifest-V2-blue)
![License MPL-2.0](https://img.shields.io/badge/License-MPL--2.0-brightgreen)
![No telemetry](https://img.shields.io/badge/telemetry-none-success)

AsideNotes lives in the Firefox sidebar. Everything you write stays in `browser.storage.local` on your own machine. The extension declares `data_collection_permissions: ["none"]` and requests exactly three permissions: `storage`, `alarms`, `notifications`.

---

## Features

**Notes and tasks in one list.** A task is a note with a due date, an optional time, a reminder, and a recurrence rule. Toggle a note into a task and back at any time.

**Rich-text editor** with a slash menu (`/`), inline markdown shortcuts, and 16 block commands: headings, bullet/numbered/checklist lists, toggle lists, code blocks, quotes, links, and five callout styles (Note, Tip, Important, Warning, Caution). Escape a marker with `\` to keep it literal.

**Markdown round-trip.** `Alt+K` copies a note as Markdown; pasting Markdown back converts it to formatting — headings, lists (nested, numbered, task), quotes, callouts, fenced code, inline emphasis and links. Conversion only fires when the text actually opens a block, and never inside a code block. Tables and images stay literal: neither is in the sanitiser whitelist (see [Security model](#security-model)).

**Quick capture** from the toolbar popup or the sidebar — a single input that parses natural language, with a live preview of what you are about to create:

| You type | You get |
|---|---|
| `Buy milk` | a note |
| `!Buy milk` | a task |
| `!Call Ann tomorrow 15:00` | a task, due tomorrow at 15:00 |
| `!Standup daily` | a task that repeats daily |
| `!!Ship the release` | an **important** task — due today, and marked in progress |
| `!>Refactor parser` | a task marked **in progress**, due today |
| `!!>Hotfix` | the same as `!!` — important already implies in progress |
| `Weekend idea #home` | a note with the tag **home** — created if it does not exist yet |
| `!"version 6/15"` | a task with literal text: quotes switch off date and tag parsing |

Dates are locale-aware: English recognises `tomorrow`, `today`, `in 3 days`, weekday names (`on friday`, `every tuesday`) and `MM/DD`; Polish recognises `jutro`, `dziś`/`dzisiaj`, `pojutrze`, `za 3 dni`, inflected weekday names (`w środę`, `co wtorek`) and `DD.MM`. An invalid date (`30.02`) or time (`25:99`) is deliberately *not* matched — the text stays in the title so you can see it wasn't understood, rather than being silently misread.

**Tags** with colours, filtering, and search across titles and content.

**Reminders** via `alarms` + desktop `notifications`, with recurrence: daily, weekly, monthly, yearly, or a custom set of weekdays.

**Two screens** — the list fills the panel; an open note gets the whole panel too, and `←` or `Esc` takes you back. **Zen mode** (tasks only), collapsible sections (Today, To catch up, Done…), and per-note cursor resume — reopen a note and the caret is where you left it.

**Trash** — deleted notes are recoverable for 30 days (up to 50 items), then auto-expire.

**Import / export** to JSON, with a backup snapshot taken automatically before any import so the operation is reversible.

**Readable typeface option.** Settings → Appearance lets you switch the whole interface from the system font to **Lexend**, a typeface designed for reading fluency — wider letter spacing and more distinct letter shapes, which can help with dyslexia, low vision and eye strain. The font ships inside the package (latin + latin-ext subsets, ~74 KB); nothing is ever fetched from a CDN, so switching it leaks no request.

**Bilingual UI** — English and Polish, 515 translated strings each.

---

## Install from source

There is no addons.mozilla.org listing yet, so load it as a temporary extension:

```bash
git clone https://github.com/JarekTylerM/Mozilla-addon-AsideNote.git
cd Mozilla-addon-AsideNote
```

```bash
npm run build:dev   # → dist-dev/
```

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on…**
3. Select `dist-dev/manifest.json`.

This test build has its own add-on ID, so its notes are **separate** from an installed AsideNotes, and both can run side by side. It is called **AsideNotes DEV**, has an orange icon and a DEV stripe, and uses `Alt+Shift+W` / `Alt+Shift+A`. It is unloaded when Firefox closes.

Do not load `manifest.json` from the repo root while you use the installed add-on: it has the same ID, replaces the installed version and works on the same notes. The sidebar shows a warning if that happens.

To keep the test build installed permanently, sign it through AMO as a self-distributed add-on:

1. `npm run build:self` creates `asidenotes-dev-<version>.zip` and adds the version to `updates/asidenotes-dev.json`.
2. Upload the ZIP on AMO, choosing **On your own**, and download the signed `.xpi`.
3. Publish it as `asidenotes-dev-<version>.xpi` in a GitHub release tagged `dev-v<version>`, and commit the updates file to `main`. Installed copies then update themselves.

Every upload needs a higher `version` in `manifest.json`.

To build a distributable package:

```bash
npm install
node build.mjs      # → dist/ and asidenotes-<version>.zip
```

Requires **Firefox 120+** (`strict_min_version`).

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Alt+Shift+Q` | Toggle the sidebar |
| `Alt+Shift+S` | Open quick capture |
| `Ctrl+B` / `Ctrl+I` / `Ctrl+U` | Bold / italic / underline |
| `Ctrl+Shift+X` | Strikethrough |
| ``Ctrl+` `` | Inline code |
| `Ctrl+K` | Insert link |
| `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` | Undo / redo / redo |
| `Ctrl+S` | Save now (autosave runs anyway) |

In quick capture, `Enter` adds the item; `Shift+Enter` adds it **and** opens it in the sidebar.

---

## Development

Vanilla ES modules, zero frameworks, no bundler. TypeScript is used as a *type checker over JavaScript* (`checkJs`, JSDoc annotations, per-file `// @ts-check`) — there is no `.ts` source and nothing is transpiled.

Three gates must be green before any change lands:

```bash
npm test           # 696 tests, plain Node — no test framework
npm run typecheck  # tsc --noEmit, strict, checkJs
node build.mjs     # minify + package
```

`tests/run.mjs` regenerates the `tests/*.mjs` mirrors from `scripts/*.js` on every run, so the suite always exercises current source. Those mirrors are gitignored — never edit them by hand.

### Layout

```
scripts/
  storage.js     ← the only module that touches browser.storage.local
  sanitize.js    ← the only definition of the tag/attribute whitelist
  notes.js       ← note model, list rendering, selection
  editor*.js     ← editor core, toolbar, slash menu, markdown, paste
  app.js         ← sidebar bootstrap and shared state
  panel.js       ← settings, tags, trash, import/export
  parser.js      ← quick-capture natural-language parser (shared)
  quick-capture-*.js ← capture item factory, typing preview, syntax help (shared)
background.js    ← event page: alarms, notifications, commands
```

`storage.js` and `sanitize.js` are deliberate chokepoints. Persistence and sanitisation each have exactly one implementation; if you find yourself writing a second one, that's the bug.

### Data model

Notes carry a `schemaVersion` (currently **3**). `loadNotes()` migrates older data forward through `migrateNotes()` and re-persists it. Import runs through the same migration path, so a JSON export from an older version restores cleanly. Every load also passes through a defensive type-normalisation step that survives hand-edited storage.

---

## Security model

> Evaluating AsideNotes for company use? See **[docs/SECURITY.md](docs/SECURITY.md)** (Polish) — permissions, network isolation, residual risk and enterprise deployment, each claim with a way to verify it and guarded by `tests/security-surface.test.mjs`.

Content is sanitised **on write**, not only on import — so whatever reaches storage is already clean. `selectNote()` re-sanitises on read anyway, as defence in depth against storage tampering via devtools.

`sanitizeHTML()` parses into a detached `DOMParser` document (an `<img onerror=…>` never fires), then reduces anything outside the whitelist to its text content:

`P DIV BR SPAN H1 H2 H3 STRONG B EM I U S STRIKE UL OL LI BLOCKQUOTE CODE PRE A HR DETAILS SUMMARY`

Attributes are whitelisted per tag, so no `on*` handler can survive. `<a href>` is validated and forced to `rel`/`target`. Recursion depth is capped at 60 levels to keep hostile markup from overflowing the stack.

Hard limits (all in `sanitize.js`):

| Limit | Value |
|---|---|
| Note content | 50 KB |
| Note title | 200 chars |
| Tag name | 50 chars |
| Paste (raw HTML, pre-sanitise) | 200 KB |
| Notes per import | 2 000 |
| Tags per import | 500 |

These exist for memory-safety and DoS reasons. Treat them as load-bearing.

---

## Contributing

Keep the three gates green. `editor.js`, `notes.js`, `panel.js` and `app.js` have **no runtime tests** — they are UI modules driven by the DOM, and a green suite does not cover them. Changes there need manual verification in `about:debugging → Inspect sidebar`.

---

## License

Licensed under the **Mozilla Public License 2.0** — see [LICENSE](LICENSE).

The bundled **Lexend** typeface is © 2018 The Lexend Project Authors and is distributed under the **SIL Open Font License 1.1** — see [assets/fonts/OFL.txt](assets/fonts/OFL.txt). It is redistributed unmodified.

---

<details>
<summary><b>🇵🇱 Wersja polska</b></summary>

<br>

**Lekki notatnik w panelu bocznym przeglądarki.** Notatki i zadania z formatowaniem, zawsze o jeden skrót klawiszowy stąd — bez konta, bez serwera, bez telemetrii.

Wszystko, co napiszesz, zostaje w `browser.storage.local` na Twoim komputerze. Rozszerzenie deklaruje `data_collection_permissions: ["none"]` i prosi dokładnie o trzy uprawnienia: `storage`, `alarms`, `notifications`.

## Funkcje

**Notatki i zadania na jednej liście.** Zadanie to notatka z terminem, opcjonalną godziną, przypomnieniem i regułą powtarzania. Notatkę można w każdej chwili zamienić w zadanie i z powrotem.

**Edytor rich-text** z menu ukośnika (`/`), skrótami markdown w locie i 16 komendami blokowymi: nagłówki, listy punktowane/numerowane/checklisty, listy zwijane, bloki kodu, cytaty, linki i pięć rodzajów callout (Notatka, Wskazówka, Ważne, Ostrzeżenie, Uwaga).

**Szybkie dodawanie** z popupu na pasku narzędzi albo z panelu bocznego — jedno pole, które rozumie język naturalny, z podglądem tego, co zaraz powstanie:

| Wpisujesz | Dostajesz |
|---|---|
| `Kup mleko` | notatkę |
| `!Kup mleko` | zadanie |
| `!Zadzwoń do Ani jutro 15:00` | zadanie na jutro, 15:00 |
| `!Standup codziennie` | zadanie powtarzane codziennie |
| `!!Wypuść wydanie` | zadanie **ważne** — termin dziś, oznaczone też jako w trakcie |
| `!>Refaktor parsera` | zadanie **w trakcie**, termin dziś |
| `!!>Hotfix` | to samo co `!!` — ważne już oznacza w trakcie |
| `Pomysł na weekend #dom` | notatkę z tagiem **dom** — tag powstanie, jeśli go jeszcze nie ma |
| `!"wersja 1.10"` | zadanie z dosłownym tekstem: cudzysłów wyłącza szukanie dat i tagów |

Daty zależą od języka: polski rozpoznaje `jutro`, `dziś`/`dzisiaj`, `pojutrze`, `za 3 dni`, odmienione nazwy dni (`w środę`, `co wtorek`) i `DD.MM`; angielski — `tomorrow`, `today`, `in 3 days`, nazwy dni (`on friday`, `every tuesday`) i `MM/DD`. Niepoprawna data (`30.02`) lub godzina (`25:99`) **celowo nie jest dopasowywana** — fragment zostaje w tytule, żebyś zobaczył, że nie został zrozumiany. To lepsze niż ciche zrozumienie źle.

**Tagi** z kolorami, filtrowaniem i wyszukiwaniem po tytułach i treści.

**Przypomnienia** przez `alarms` + powiadomienia systemowe, z powtarzaniem: codziennie, co tydzień, co miesiąc, co rok lub we własnym zestawie dni tygodnia.

**Dwa ekrany** — lista wypełnia panel; otwarta notatka też dostaje cały panel, a `←` lub `Esc` wraca na listę. **Tryb zen** (tylko zadania), zwijane sekcje (Dziś, Do nadrobienia, Zrobione…) oraz wznawianie pozycji kursora — otwierasz notatkę i karetka stoi tam, gdzie ją zostawiłeś.

**Kosz** — usunięte notatki można odzyskać przez 30 dni (do 50 elementów), potem wygasają automatycznie.

**Import / eksport** do JSON. Przed każdym importem automatycznie zapisywana jest migawka danych, więc operacja jest odwracalna.

**Dwujęzyczny interfejs** — polski i angielski, po 515 przetłumaczonych ciągów.

## Instalacja ze źródeł

Wtyczki nie ma jeszcze na addons.mozilla.org, więc załaduj ją tymczasowo:

```bash
npm run build:dev   # → dist-dev/
```

1. Otwórz `about:debugging#/runtime/this-firefox`.
2. Kliknij **Załaduj tymczasowy dodatek…**
3. Wskaż `dist-dev/manifest.json`.

Ta wersja testowa ma własny identyfikator, więc jej notatki są **oddzielone** od zainstalowanego AsideNotes i obie mogą działać naraz. Nazywa się **AsideNotes DEV**, ma pomarańczową ikonę i pasek DEV oraz skróty `Alt+Shift+W` / `Alt+Shift+A`. Znika po zamknięciu Firefoksa.

Nie ładuj `manifest.json` z katalogu głównego, gdy używasz zainstalowanego dodatku: ma ten sam identyfikator, zastępuje zainstalowaną wersję i pracuje na tych samych notatkach. Panel boczny ostrzeże, jeśli tak się stanie.

Aby mieć wersję testową zainstalowaną na stałe, podpisz ją w AMO jako dodatek dystrybuowany samodzielnie:

1. `npm run build:self` tworzy `asidenotes-dev-<wersja>.zip` i dopisuje wersję do `updates/asidenotes-dev.json`.
2. Wyślij ZIP na AMO, wybierając **Na własną rękę**, i pobierz podpisany plik `.xpi`.
3. Opublikuj go jako `asidenotes-dev-<wersja>.xpi` w wydaniu GitHuba z tagiem `dev-v<wersja>`, a plik aktualizacji zacommituj do `main`. Zainstalowane kopie zaktualizują się same.

Każde wysłanie wymaga wyższego `version` w `manifest.json`.

Paczka do dystrybucji: `npm install && node build.mjs`.

Wymaga **Firefoksa 120+**.

## Skróty klawiszowe

| Skrót | Działanie |
|---|---|
| `Alt+Shift+Q` | Pokaż/ukryj panel boczny |
| `Alt+Shift+S` | Otwórz szybkie dodawanie |
| `Ctrl+B` / `Ctrl+I` / `Ctrl+U` | Pogrubienie / kursywa / podkreślenie |
| `Ctrl+Shift+X` | Przekreślenie |
| ``Ctrl+` `` | Kod w linii |
| `Ctrl+K` | Wstaw link |
| `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` | Cofnij / ponów / ponów |
| `Ctrl+S` | Zapisz teraz (autozapis i tak działa) |

W szybkim dodawaniu `Enter` dodaje element, a `Shift+Enter` dodaje **i** otwiera go w panelu.

## Rozwój

Czyste moduły ES, zero frameworków, bez bundlera. TypeScript służy jako *sprawdzacz typów nad JavaScriptem* (`checkJs`, adnotacje JSDoc, `// @ts-check` per plik) — nie ma źródeł `.ts` i nic nie jest transpilowane.

Trzy bramki muszą być zielone przed każdą zmianą:

```bash
npm test           # 696 testów, czysty Node — bez frameworka testowego
npm run typecheck  # tsc --noEmit, strict, checkJs
node build.mjs     # minifikacja + paczka
```

`tests/run.mjs` przy każdym uruchomieniu regeneruje mirrory `tests/*.mjs` z `scripts/*.js`, więc suite zawsze testuje aktualne źródła. Mirrory są w `.gitignore` — nigdy ich nie edytuj ręcznie.

`storage.js` i `sanitize.js` to celowe wąskie gardła. Persystencja i sanityzacja mają dokładnie po jednej implementacji; jeśli piszesz drugą — to jest ten bug.

## Model bezpieczeństwa

> Ocena do użytku w firmie: **[docs/SECURITY.md](docs/SECURITY.md)** — uprawnienia, izolacja od sieci, ryzyko rezydualne i wdrożenie przez polityki Firefoksa; każde twierdzenie ze sposobem weryfikacji.

Treść jest sanityzowana **przy zapisie**, nie tylko przy imporcie — dane w storage są zawsze czyste. `selectNote()` sanityzuje ponownie przy odczycie, jako defense-in-depth na wypadek manipulacji storage przez devtools.

`sanitizeHTML()` parsuje w odłączonym dokumencie `DOMParser` (`<img onerror=…>` nigdy nie wystrzeli), a wszystko spoza whitelisty redukuje do `textContent`. Atrybuty są na białej liście per tag, więc żaden handler `on*` nie przejdzie. Głębokość rekurencji ograniczona do 60 poziomów.

Twarde limity (`sanitize.js`): treść 50 KB, tytuł 200 znaków, nazwa tagu 50 znaków, wklejanie 200 KB, import 2 000 notatek / 500 tagów. Istnieją z powodów pamięciowych i anty-DoS. Traktuj je jako nośne.

## Współtworzenie

Trzymaj trzy bramki zielone. `editor.js`, `notes.js`, `panel.js` i `app.js` **nie mają testów runtime** — zielony suite ich nie pokrywa. Zmiany tam wymagają ręcznego sprawdzenia w `about:debugging → Inspect sidebar`.

## Licencja

Na licencji **Mozilla Public License 2.0** — zobacz [LICENSE](LICENSE).

</details>
