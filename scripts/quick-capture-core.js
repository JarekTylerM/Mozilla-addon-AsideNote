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
import { foldText } from './utils.js';

/**
 * @typedef {{ id: string, name: string }} CaptureTag
 */

/**
 * Wyciąga z tytułu odwołania `#tag` do ISTNIEJĄCYCH tagów.
 *
 * Reguły (spójne z parserem dat: czego nie rozumiemy, zostaje w tytule,
 * żeby było widać, że nie zadziałało):
 * - `#nazwa` pasuje do tagu bez względu na wielkość liter i polskie znaki
 *   (`#linia3` ≠ `linia-3`, ale `#Awaria` = `awaria`, `#pomiar` ≠ `pomiary`);
 *   spacje w nazwie tagu zapisuje się jako `-` albo `_` (`#linia-3`).
 * - Nieznany `#token` zostaje w tytule — capture nie tworzy tagów w locie
 *   (literówka nie może zaśmiecić listy tagów).
 * - Gdy po zdjęciu tagów tytuł byłby pusty, tytuł zostaje bez zmian —
 *   samo `#awaria` to wtedy po prostu treść wpisu.
 *
 * @param {string} title tytuł po parsowaniu daty/flag
 * @param {CaptureTag[]} tags dostępne tagi
 * @returns {{ title: string, tagIds: string[] }}
 */
export function extractCaptureTags(title, tags) {
  if (!title || !Array.isArray(tags) || tags.length === 0 || !title.includes('#')) {
    return { title, tagIds: [] };
  }
  /** @type {Map<string, string>} */
  const byKey = new Map();
  for (const tag of tags) {
    if (!tag || typeof tag.name !== 'string' || typeof tag.id !== 'string') continue;
    const key = foldText(tag.name.trim()).replace(/[\s_]+/g, '-');
    if (key && !byKey.has(key)) byKey.set(key, tag.id);
  }

  /** @type {string[]} */
  const tagIds = [];
  const stripped = title.replace(/(^|\s)#([^\s#]+)/g, (match, lead, token) => {
    const id = byKey.get(foldText(token).replace(/_+/g, '-'));
    if (!id) return match;
    if (!tagIds.includes(id)) tagIds.push(id);
    return lead;
  });

  const cleanTitle = stripped.replace(/\s{2,}/g, ' ').trim();
  if (!cleanTitle) return { title, tagIds: [] };
  return { title: cleanTitle, tagIds };
}

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
 * Buduje obiekt notatki/zadania z surowego inputu quick capture.
 * @param {string} raw — tekst z pola capture
 * @param {string|null} [locale] przekazywany do parseCapture (testy)
 * @param {CaptureTag[]} [tags] istniejące tagi — do rozpoznania `#tag`
 * @returns {object|null} obiekt notatki gotowy do zapisania, albo null
 *   gdy input nie daje sensownego tytułu
 */
export function buildItemFromCapture(raw, locale = null, tags = []) {
  const parsed = parseCapture(raw, locale);
  const { isTask, isUrgent, isInProgress, due, time, recurrence } = parsed;
  if (!parsed.title) return null;
  const { title, tagIds } = extractCaptureTags(parsed.title, tags);

  return {
    id: newNoteId(),
    type: isTask ? 'task' : 'note',
    title,
    content: '',
    created: Date.now(),
    tags: tagIds,
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
