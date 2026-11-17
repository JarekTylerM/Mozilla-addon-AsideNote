// @ts-check
/* ══════════════════════════════════════════════════════════════
   quick-capture-core.js — współdzielona logika quick capture
   ──────────────────────────────────────────────────────────────
   Używane przez:
   - notes.js::quickCapture (sidebar)
   - popup.js (mikro-okno)

   Cel: jedna fabryka obiektu notatki/zadania z parsera. Wcześniej ta
   sama struktura była budowana ręcznie w dwóch miejscach i rozjeżdżała
   się (popup nie ustawiał części pól tak samo jak sidebar).

   Sam zapis do storage i planowanie alarmu zostają po stronie callera
   — sidebar i popup robią to różnie (sidebar: in-memory state + render,
   popup: bezpośredni zapis + sidebarAction). Tu jest tylko czysta
   fabryka: parsuje input → zwraca obiekt albo null.
   ══════════════════════════════════════════════════════════════ */

import { parseCapture } from './parser.js';

/**
 * Generator ID notatki. Date.now() + krótki losowy suffix — eliminuje
 * kolizje przy bardzo szybkim wstawianiu (ten sam ms).
 * @returns {string}
 */
export function newNoteId() {
  return Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

/**
 * Termin zadania wynikający z capture.
 *
 * Reguła: `!!` (ważne) i `!>` (w trakcie) bez jawnej daty dostają termin
 * na dziś — oznaczenie priorytetu bez terminu nie miałoby gdzie wylądować
 * na liście. Jawna data zawsze wygrywa.
 *
 * Wydzielone, bo tę samą regułę musi znać podgląd (quick-capture-preview.js);
 * gdy siedziała inline w buildItemFromCapture, podgląd pokazywał zadanie
 * bez terminu, a powstawało zadanie na dziś.
 *
 * @param {{ isUrgent: boolean, isInProgress: boolean, due: number|null }} capture
 * @param {number} [now] znacznik czasu (wstrzykiwalny dla testów)
 * @returns {number|null}
 */
export function captureDue({ isUrgent, isInProgress, due }, now = Date.now()) {
  if (due) return due;
  if (!isUrgent && !isInProgress) return due ?? null;
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Czy element z capture ma zostać zasiany do focusIds ("w trakcie").
 *
 * Reguła: ważne LUB w trakcie. `!!` celowo oznacza też "w trakcie" —
 * priorytet bez miejsca na liście byłby bezużyteczny. Konsekwencja:
 * `!!>` daje dokładnie to samo, co `!!`, bo `>` nie dokłada już nic.
 *
 * Wydzielone z notes.js::quickCapture i popup.js, gdzie warunek istniał
 * w dwóch kopiach o odwróconej kolejności składników. Podgląd
 * (quick-capture-preview.js) trzyma się tej samej reguły, żeby nie
 * obiecywać elementu innego niż powstanie.
 *
 * Wołaj PRZED `delete item.focus` — flaga focus to jednorazowy seed
 * z parsera, źródłem prawdy jest tablica focusId w storage.
 *
 * @param {{ type?: string, important?: boolean, focus?: boolean }} item
 * @returns {boolean}
 */
export function wantsFocusSeed(item) {
  return item.type === 'task' && !!(item.important || item.focus);
}

/**
 * Zmiany, które Enter w polu tytułu zastosuje do otwartego elementu.
 * @typedef {object} TitleEdit
 * @property {boolean} hasChanges czy Enter coś zmieni (inaczej tylko przejdzie do treści)
 * @property {string} title tytuł po wycięciu rozpoznanych fragmentów
 * @property {boolean} toTask notatka zaczęta od `!` staje się zadaniem
 * @property {number|null} due termin tylko wtedy, gdy padł w tekście — sama
 *   godzina nie przestawia istniejącego terminu zadania
 * @property {string|null} time
 * @property {string|null} recurrence
 * @property {boolean} important `!!`
 * @property {boolean} focus `!>` (oraz `!!`, jak w szybkim dodawaniu)
 * @property {string[]} tagNames
 * @property {string[]} rejected fragmenty, które wyglądają na datę/godzinę, ale nie istnieją
 */

/**
 * Parser w polu tytułu otwartej notatki lub zadania.
 *
 * Ta sama składnia co w szybkim dodawaniu, z dwiema różnicami:
 * - w zadaniu `!` na początku nie jest potrzebny — to już jest zadanie,
 *   więc "Kino jutro o 18" od razu daje termin i godzinę; w notatce
 *   rozpoznawane są tylko tagi, chyba że tytuł zaczyna się od `!`
 *   (wtedy notatka staje się zadaniem),
 * - fragmenty, które parser rozpoznałby już w tytule sprzed edycji,
 *   zostają dosłownie (`baseline`). Inaczej zadanie "Plan na jutro"
 *   dostałoby termin przy każdym Enterze, choć nikt go nie wpisywał.
 *
 * Czysta funkcja: zastosowaniem zmian zajmuje się notes.js::applyTitleEdit.
 *
 * @param {string} raw obecna wartość pola tytułu
 * @param {{ type?: string }} note otwarty element (typ decyduje o składni)
 * @param {{ baseline?: string, locale?: string|null }} [options]
 * @returns {TitleEdit|null} null, gdy nie ma nic do powiedzenia ani zmiany
 */
export function titleEditChanges(raw, note, { baseline = '', locale = null } = {}) {
  const text = (raw ?? '').trim();
  if (!text) return null;

  const isTask = note.type === 'task';
  const toTask = !isTask && text.startsWith('!');
  const asTask = isTask || toTask;

  /** @param {string} value */
  const prepare = (value) => {
    const trimmed = value.trim();
    return asTask && !trimmed.startsWith('!') ? '!' + trimmed : trimmed;
  };

  const before = baseline.trim() ? parseCapture(prepare(baseline), locale) : null;
  const parsed = parseCapture(prepare(text), locale, {
    keep: before?.tokens.map((tok) => tok.text) ?? [],
  });

  // Flaga z prefiksu liczy się tylko, gdy prefiks jest nowy
  const important = parsed.isUrgent && !before?.isUrgent;
  const focus = (parsed.isInProgress || parsed.isUrgent) && !(before?.isInProgress || before?.isUrgent);

  const hasChanges = toTask || important || focus || parsed.tokens.length > 0;
  if (!hasChanges && !parsed.rejected.length) return null;

  return {
    hasChanges,
    title: hasChanges ? parsed.title : text,
    toTask,
    due: parsed.dateGiven ? parsed.due : null,
    time: parsed.time,
    recurrence: parsed.recurrence,
    important,
    focus,
    tagNames: parsed.tagNames,
    rejected: parsed.rejected,
  };
}

/**
 * Buduje obiekt notatki/zadania z surowego inputu quick capture.
 * @param {string} raw — tekst z pola capture
 * @param {string|null} [locale] przekazywany do parseCapture (testy)
 * @returns {object|null} obiekt notatki gotowy do zapisania, albo null
 *   gdy input nie daje sensownego tytułu. Pole tagNames to jednorazowy seed,
 *   jak focus: caller zamienia nazwy na id w `tags` i kasuje je przed zapisem
 *   (sidebar i popup trzymają tagi w różnych miejscach).
 */
export function buildItemFromCapture(raw, locale = null) {
  const { isTask, isUrgent, isInProgress, title, due, time, recurrence, tagNames } =
    parseCapture(raw, locale);
  if (!title) return null;

  return {
    id: newNoteId(),
    type: isTask ? 'task' : 'note',
    title,
    content: '',
    created: Date.now(),
    tags: [],
    tagNames,
    ...(isTask && {
      completed: false,
      due: captureDue({ isUrgent, isInProgress, due }),
      time: time,
      reminder: 0,
      recurrence: recurrence ?? null,
      ...(isUrgent && { important: true }),
      ...(isInProgress && { focus: true }),
    }),
  };
}
