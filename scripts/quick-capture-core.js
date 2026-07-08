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
 * Buduje obiekt notatki/zadania z surowego inputu quick capture.
 * @param {string} raw — tekst z pola capture
 * @param {string|null} [locale] przekazywany do parseCapture (testy)
 * @returns {object|null} obiekt notatki gotowy do zapisania, albo null
 *   gdy input nie daje sensownego tytułu
 */
export function buildItemFromCapture(raw, locale = null) {
  const { isTask, isUrgent, isInProgress, title, due, time, recurrence } =
    parseCapture(raw, locale);
  if (!title) return null;

  return {
    id: newNoteId(),
    type: isTask ? 'task' : 'note',
    title,
    content: '',
    created: Date.now(),
    tags: [],
    ...(isTask && {
      completed: false,
      due:
        (isUrgent || isInProgress) && !due
          ? (() => {
              const d = new Date();
              d.setHours(0, 0, 0, 0);
              return d.getTime();
            })()
          : due,
      time: time,
      reminder: 0,
      recurrence: recurrence ?? null,
      ...(isUrgent && { important: true }),
      ...(isInProgress && { focus: true }),
    }),
  };
}
