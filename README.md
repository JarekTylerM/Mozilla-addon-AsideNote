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

**Rich-text editor** with a slash menu (`/`), inline markdown shortcuts, and 16 block commands: headings, bullet/numbered/checklist lists, toggle lists, code blocks, quotes, links, and five callout styles (Note, Tip, Important, Warning, Caution).

**Quick capture** from the toolbar popup — a single input that parses natural language:

| You type | You get |
|---|---|
| `Buy milk` | a note |
| `!Buy milk` | a task |
| `!Call Ann tomorrow 15:00` | a task, due tomorrow at 15:00 |
| `!!Ship the release` | an **important** task |
| `!>Refactor parser` | a task marked **in progress** |
| `!!>Hotfix` | important **and** in progress |

Dates are locale-aware: English recognises `tomorrow`, `today`, weekday names and `MM/DD`; Polish recognises `jutro`, `dziś`/`dzisiaj`, weekday names and `DD.MM`. An invalid date (`30.02`) or time (`25:99`) is deliberately *not* matched — the text stays in the title so you can see it wasn't understood, rather than being silently misread.

**Tags** with colours, filtering, and search across titles and content.

**Reminders** via `alarms` + desktop `notifications`, with recurrence: daily, weekly, monthly, yearly, or a custom set of weekdays.

**Focus mode**, **zen mode** (tasks only), collapsible sections (Today, Overdue, Done…), and per-note cursor resume — reopen a note and the caret is where you left it.

**Trash** — deleted notes are recoverable for 30 days (up to 50 items), then auto-expire.

**Import / export** to JSON, with a backup snapshot taken automatically before any import so the operation is reversible.

**Bilingual UI** — English and Polish, 481 translated strings each.

---

## Install from source

There is no addons.mozilla.org listing yet, so load it as a temporary extension:

```bash
git clone https://github.com/JarekTylerM/Mozilla-addon-AsideNote.git
cd Mozilla-addon-AsideNote
```

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on…**
3. Select `manifest.json` from the repo root.

The extension is unloaded when Firefox closes. To build a distributable package:

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
npm test           # 487 tests, plain Node — no test framework
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
background.js    ← event page: alarms, notifications, commands
```

`storage.js` and `sanitize.js` are deliberate chokepoints. Persistence and sanitisation each have exactly one implementation; if you find yourself writing a second one, that's the bug.

### Data model

Notes carry a `schemaVersion` (currently **3**). `loadNotes()` migrates older data forward through `migrateNotes()` and re-persists it. Import runs through the same migration path, so a JSON export from an older version restores cleanly. Every load also passes through a defensive type-normalisation step that survives hand-edited storage.

---

## Security model

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

---

<details>
<summary><b>🇵🇱 Wersja polska</b></summary>

<br>

**Lekki notatnik w panelu bocznym przeglądarki.** Notatki i zadania z formatowaniem, zawsze o jeden skrót klawiszowy stąd — bez konta, bez serwera, bez telemetrii.

Wszystko, co napiszesz, zostaje w `browser.storage.local` na Twoim komputerze. Rozszerzenie deklaruje `data_collection_permissions: ["none"]` i prosi dokładnie o trzy uprawnienia: `storage`, `alarms`, `notifications`.

## Funkcje

**Notatki i zadania na jednej liście.** Zadanie to notatka z terminem, opcjonalną godziną, przypomnieniem i regułą powtarzania. Notatkę można w każdej chwili zamienić w zadanie i z powrotem.

**Edytor rich-text** z menu ukośnika (`/`), skrótami markdown w locie i 16 komendami blokowymi: nagłówki, listy punktowane/numerowane/checklisty, listy zwijane, bloki kodu, cytaty, linki i pięć rodzajów callout (Notatka, Wskazówka, Ważne, Ostrzeżenie, Uwaga).

**Szybkie dodawanie** z popupu na pasku narzędzi — jedno pole, które rozumie język naturalny:

| Wpisujesz | Dostajesz |
|---|---|
| `Kup mleko` | notatkę |
| `!Kup mleko` | zadanie |
| `!Zadzwoń do Ani jutro 15:00` | zadanie na jutro, 15:00 |
| `!!Wypuść wydanie` | zadanie **ważne** |
| `!>Refaktor parsera` | zadanie **w trakcie** |
| `!!>Hotfix` | ważne **i** w trakcie |

Daty zależą od języka: polski rozpoznaje `jutro`, `dziś`/`dzisiaj`, nazwy dni tygodnia i `DD.MM`; angielski — `tomorrow`, `today`, nazwy dni i `MM/DD`. Niepoprawna data (`30.02`) lub godzina (`25:99`) **celowo nie jest dopasowywana** — fragment zostaje w tytule, żebyś zobaczył, że nie został zrozumiany. To lepsze niż ciche zrozumienie źle.

**Tagi** z kolorami, filtrowaniem i wyszukiwaniem po tytułach i treści.

**Przypomnienia** przez `alarms` + powiadomienia systemowe, z powtarzaniem: codziennie, co tydzień, co miesiąc, co rok lub we własnym zestawie dni tygodnia.

**Tryb skupienia**, **tryb zen** (tylko zadania), zwijane sekcje (Dziś, Zaległe, Zrobione…) oraz wznawianie pozycji kursora — otwierasz notatkę i karetka stoi tam, gdzie ją zostawiłeś.

**Kosz** — usunięte notatki można odzyskać przez 30 dni (do 50 elementów), potem wygasają automatycznie.

**Import / eksport** do JSON. Przed każdym importem automatycznie zapisywana jest migawka danych, więc operacja jest odwracalna.

**Dwujęzyczny interfejs** — polski i angielski, po 481 przetłumaczonych ciągów.

## Instalacja ze źródeł

Wtyczki nie ma jeszcze na addons.mozilla.org, więc załaduj ją tymczasowo:

1. Otwórz `about:debugging#/runtime/this-firefox`.
2. Kliknij **Załaduj tymczasowy dodatek…**
3. Wskaż `manifest.json` z katalogu głównego repo.

Rozszerzenie znika po zamknięciu Firefoksa. Paczka do dystrybucji: `npm install && node build.mjs`.

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
npm test           # 487 testów, czysty Node — bez frameworka testowego
npm run typecheck  # tsc --noEmit, strict, checkJs
node build.mjs     # minifikacja + paczka
```

`tests/run.mjs` przy każdym uruchomieniu regeneruje mirrory `tests/*.mjs` z `scripts/*.js`, więc suite zawsze testuje aktualne źródła. Mirrory są w `.gitignore` — nigdy ich nie edytuj ręcznie.

`storage.js` i `sanitize.js` to celowe wąskie gardła. Persystencja i sanityzacja mają dokładnie po jednej implementacji; jeśli piszesz drugą — to jest ten bug.

## Model bezpieczeństwa

Treść jest sanityzowana **przy zapisie**, nie tylko przy imporcie — dane w storage są zawsze czyste. `selectNote()` sanityzuje ponownie przy odczycie, jako defense-in-depth na wypadek manipulacji storage przez devtools.

`sanitizeHTML()` parsuje w odłączonym dokumencie `DOMParser` (`<img onerror=…>` nigdy nie wystrzeli), a wszystko spoza whitelisty redukuje do `textContent`. Atrybuty są na białej liście per tag, więc żaden handler `on*` nie przejdzie. Głębokość rekurencji ograniczona do 60 poziomów.

Twarde limity (`sanitize.js`): treść 50 KB, tytuł 200 znaków, nazwa tagu 50 znaków, wklejanie 200 KB, import 2 000 notatek / 500 tagów. Istnieją z powodów pamięciowych i anty-DoS. Traktuj je jako nośne.

## Współtworzenie

Trzymaj trzy bramki zielone. `editor.js`, `notes.js`, `panel.js` i `app.js` **nie mają testów runtime** — zielony suite ich nie pokrywa. Zmiany tam wymagają ręcznego sprawdzenia w `about:debugging → Inspect sidebar`.

## Licencja

Na licencji **Mozilla Public License 2.0** — zobacz [LICENSE](LICENSE).

</details>
