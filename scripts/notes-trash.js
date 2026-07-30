// @ts-check
/* ══════════════════════════════════════════════════════════════
   notes-trash.js — czyste transformacje kosza i typu notatki
   ──────────────────────────────────────────────────────────────
   Wydzielone z notes.js, żeby ścieżki TRACĄCE DANE (usunięcie →
   kosz → przywrócenie, konwersja typu) były testowalne bez harnessu
   DOM/browser. Wzorzec: quick-capture-core.js.

   Kontrakt: funkcje są czyste — nie dotykają DOM, storage ani alarmów,
   nie mutują argumentów, zwracają NOWE tablice/obiekty. Orkiestracja
   (saveNotes, renderList, clearAlarm, event 'noteTrashed') zostaje
   w notes.js, który te funkcje woła.
   ══════════════════════════════════════════════════════════════ */

/**
 * Przenosi notatkę o danym id do kosza (na początek, bez duplikatów TTL —
 * to robi storage). Przycina kosz do maxDeleted (najstarsze wypadają).
 *
 * @param {Note[]} notes - aktywne notatki
 * @param {DeletedNote[]} deletedNotes - bieżący kosz
 * @param {string} id - id notatki do usunięcia
 * @param {number} maxDeleted - górny limit kosza (MAX_DELETED)
 * @param {number} [now] - znacznik czasu (wstrzykiwalny dla testów)
 * @returns {{ notes: Note[], deletedNotes: DeletedNote[], trashed: Note|null }}
 *   trashed=null gdy notatki nie było (nic się nie zmienia)
 */
export function moveToTrash(notes, deletedNotes, id, maxDeleted, now = Date.now()) {
  const note = notes.find((n) => n.id === id) ?? null;
  const nextNotes = notes.filter((n) => n.id !== id);
  if (!note) {
    return { notes: nextNotes, deletedNotes, trashed: null };
  }
  const deleted = /** @type {DeletedNote} */ ({ ...note, deletedAt: now });
  const nextDeleted = [deleted, ...deletedNotes].slice(0, maxDeleted);
  return { notes: nextNotes, deletedNotes: nextDeleted, trashed: note };
}

/**
 * Przywraca notatkę z kosza — odwrotność moveToTrash. Zdejmuje pole
 * deletedAt i wstawia notatkę na początek aktywnych.
 *
 * @param {Note[]} notes
 * @param {DeletedNote[]} deletedNotes
 * @param {string} id
 * @returns {{ notes: Note[], deletedNotes: DeletedNote[], restored: Note|null }}
 *   restored=null gdy notatki nie ma w koszu (nic się nie zmienia)
 */
export function restoreFromTrash(notes, deletedNotes, id) {
  const idx = deletedNotes.findIndex((n) => n.id === id);
  if (idx === -1) {
    return { notes, deletedNotes, restored: null };
  }
  const { deletedAt, ...note } = deletedNotes[idx];
  const nextDeleted = deletedNotes.slice(0, idx).concat(deletedNotes.slice(idx + 1));
  const nextNotes = [/** @type {Note} */ (note), ...notes];
  return { notes: nextNotes, deletedNotes: nextDeleted, restored: /** @type {Note} */ (note) };
}

/**
 * Zwraca zmiany pól przy konwersji typu note↔task. NIE mutuje wejścia —
 * caller robi Object.assign na notatce w stanie, żeby zachować referencje,
 * na których polega renderList.
 *
 * note → task: dokłada completed=false, jeśli pole nie istniało.
 * task → note: zmienia tylko type (completed zostaje nietknięte, żeby
 * ponowna konwersja z powrotem odzyskała poprzedni stan wykonania).
 *
 * @param {Note} note
 * @returns {{ type: "note" | "task", completed?: boolean }}
 */
export function flippedType(note) {
  if (note.type === "note") {
    return {
      type: "task",
      completed: note.completed === undefined ? false : note.completed,
    };
  }
  return { type: "note" };
}
