# Decyzje przed wydaniem na AMO

Otwarte pozycje wymagające decyzji użytkownika. Nie są to bugi ani braki w kodzie —
to decyzje produktowe/publikacyjne. Do rozstrzygnięcia w czasie wyznaczonym przez autora.

Stan repo w chwili zapisu: 3 bramki zielone (`npm test` 696/696, `npm run typecheck` 0,
`node build.mjs` OK). Kod uznany za gotowy przez przegląd RELEASE-REVIEW; blokery wydania
są wyłącznie na tej liście.

---

## 1. Status wydania: Preview/beta czy wpis stabilny? — NIEODWRACALNE

**Stan obecny:**
- `manifest.json` → `version_name: "1.0.8 Preview"`
- `manifest.json` → gecko `id: "asidenotes-tyler-preview@addons.mozilla.org"`

**Opcje:**
- **A. Zostaw jako Preview/beta.** Jawny wpis wczesnej wersji. Zero zmian w manifeście.
- **B. Wydaj jako stabilny.** Usuń „Preview" z `version_name`, zmień gecko `id` na stabilne
  (np. `asidenotes@addons.mozilla.org`).

**Konsekwencja krytyczna opcji B:** zmiana gecko `id` tworzy **nowy wpis na AMO**.
Brak migracji istniejących instalacji, brak przeniesienia ocen/recenzji z wpisu preview.
Po wydaniu `id` **nie da się zmienić** bez kolejnego nowego wpisu.

**Rekomendacja:** świadomy wybór PRZED pierwszą publikacją. Jeśli preview był już gdziekolwiek
dystrybuowany i zebrał instalacje/oceny — opcja B je porzuca.

**Decyzja:** _(do uzupełnienia)_

---

## 2. Polityka prywatności — WYMAGANA przez AMO

AMO wymaga polityki prywatności nawet przy zerowym zbieraniu danych
(`data_collection_permissions: ["none"]` jest zadeklarowane w manifeście i zgodne z kodem —
brak telemetrii, brak sieci, jedyna persystencja to lokalny `storage.local`).

**Proponowana treść (jedno zdanie, do wklejenia w listingu AMO):**

> AsideNotes nie zbiera, nie przechowuje ani nie przesyła żadnych danych użytkownika.
> Wszystkie notatki i ustawienia pozostają lokalnie w `storage.local` przeglądarki,
> na urządzeniu użytkownika. Rozszerzenie nie komunikuje się z żadnym serwerem.

Wersja EN:

> AsideNotes does not collect, store, or transmit any user data. All notes and settings
> remain locally in the browser's `storage.local`, on the user's device. The extension
> does not communicate with any server.

**Decyzja:** zaakceptować powyższą treść / dostarczyć własną. _(do uzupełnienia)_

---

## 3. Opis sklepowy + zrzuty ekranu — DO DOSTARCZENIA

Nie ma w repozytorium. Nie generowano treści fikcyjnych.

**Do przygotowania na listing AMO:**
- **Opis sklepowy** (marketingowy, nie deweloperski — README jest techniczny).
  Sugerowany kąt: notatnik/planer w panelu bocznym, offline, prywatny, zaprojektowany
  pod umysły, które żyją w przeglądarce (ADHD/spektrum). Do napisania osobno.
- **Zrzuty ekranu** (min. 1, zalecane 3–4): lista notatek, edytor + slash menu,
  quick capture (popup), tryb zen. Do wykonania w działającym rozszerzeniu.
- **Kategoria:** Productivity. **Ikona sklepowa:** są ikony 48/128 w manifeście.

**Decyzja/akcja:** _(do uzupełnienia)_

---

## Zrobione w tej sesji (kontekst)

- Poprawka `tooltip.js`: podgląd notatki z `" · "` w treści nie jest już rozbijany na
  „etykietę · skrót" (split pomijany dla `variant=preview`). Wymaga ręcznej weryfikacji
  w Firefoksie (plik UI bez testów runtime).
- `clearLastBackupBeforeImport()` w `storage.js` — konsolidacja dostępu do `storage.local`
  (panel.js nie woła już `browser.storage.local.remove` bezpośrednio).
- `build.mjs` wyklucza `*.d.ts` z paczki (artefakt dev, nie należy do rozszerzenia).
