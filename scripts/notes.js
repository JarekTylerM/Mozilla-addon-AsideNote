// @ts-check
/* ══════════════════════════════════════════════════════════════
   notes.js — stan notatek + CRUD + render listy z sekcjami
   ══════════════════════════════════════════════════════════════ */

import {
  saveNotes,
  saveCollapsedSections,
  saveFocusId,
  saveFilterPrefs,
  saveDeletedNotes,
  loadUiSettings,
  MAX_DELETED,
} from "./storage.js";
import * as undo from "./undo.js";
import { debounce, foldText, queryTerms, matchesTerms } from "./utils.js";
import { getTag, makeTagPill, resolveTagNames, tagState } from "./tags.js";
import { clearAlarm, scheduleAlarm, isAlarmable } from "./alarms.js";
import { t, getUILocale, getShortWeekdays } from "./i18n.js";
import { applyCommandShortcuts } from "./command-shortcuts.js";
import {
  buildItemFromCapture,
  newNoteId,
  wantsFocusSeed,
} from "./quick-capture-core.js";
import {
  sanitizeHTML,
  validateText,
  MAX_TITLE_LEN,
  MAX_CONTENT_LEN,
  htmlToPreviewText,
} from "./sanitize.js";
import { setCursorOffset } from "./editor-selection.js";
import {
  moveToTrash,
  restoreFromTrash,
  flippedType,
  isDiscardableNote,
} from "./notes-trash.js";
import { updateDueDisplay } from "./date-picker.js";
import { nextDueDate, contentForNextInstance } from "./recurrence.js";
import {
  NOTE_ACTIONS,
  normalizePinnedActions,
  noteHeaderState,
} from "./note-menu.js";
import {
  SECTION_ORDER,
  alwaysVisibleSections,
  bucketFor,
  newItemForSection,
} from "./note-sections.js";
import { startStage } from "./onboarding.js";
import { nextFocusId } from "./list-focus.js";

/** Działanie z nagłówka → id jego pozycji w menu ⋮ */
const NOTE_ACTION_ITEMS = {
  important: "important-btn",
  focus: "focus-btn",
  convert: "convert-type",
  copy: "copy-md-btn",
  delete: "delete",
};

/* ── State ────────────────────────────────────── */

/**
 * @typedef {object} AppState
 * @property {Note[]} notes
 * @property {string|null} activeId
 * @property {string} searchQuery
 * @property {string[]} filterTags
 * @property {'all'|'note'|'task'} filterType
 * @property {boolean} filterHideCompleted
 * @property {boolean} filterInProgress
 * @property {number|null} filterDate
 * @property {'note'|'task'|null} pendingType
 * @property {string[]} collapsedSections
 * @property {boolean} zenMode
 * @property {string[]} focusIds
 * @property {DeletedNote[]} deletedNotes
 * @property {string[]} pinnedActions działania przypięte do nagłówka notatki
 * @property {PendingMeta} pendingMeta termin zadania, które jeszcze nie powstało
 */

/**
 * Zadanie powstaje w storage dopiero przy pierwszym wpisanym znaku, a termin
 * trzeba pamiętać wcześniej: nadaje go "+" w sekcji albo użytkownik wybiera
 * go przed wpisaniem tytułu.
 * @typedef {object} PendingMeta
 * @property {number|null} due
 * @property {string|null} time
 * @property {number} reminder
 * @property {string|null} recurrence
 * @property {number[]|null} recurrenceDays
 */

/** @param {number|null} [due] @returns {PendingMeta} */
const _newPendingMeta = (due = null) => ({
  due,
  time: null,
  reminder: 0,
  recurrence: null,
  recurrenceDays: null,
});

/** @type {AppState} */
export const state = {
  notes: [],
  activeId: null,
  searchQuery: "",
  filterTags: [],
  filterType: "all",
  filterHideCompleted: false,
  filterInProgress: false,
  filterDate: null,
  pendingType: "note",
  collapsedSections: [],
  zenMode: false,
  focusIds: [],
  deletedNotes: [],
  pinnedActions: [],
  pendingMeta: _newPendingMeta(),
};

/* ── DOM refs ─────────────────────────────────── */

const notesList = /** @type {HTMLElement} */ (document.getElementById("notesList"));
const titleInput = /** @type {HTMLInputElement} */ (document.getElementById("title"));
const editor = /** @type {HTMLElement} */ (document.getElementById("editor"));
const dueInput = /** @type {HTMLInputElement} */ (document.getElementById("due-date"));
const dueWrapper = /** @type {HTMLElement} */ (document.getElementById("due-wrapper"));
/** @param {string} id @returns {HTMLElement} */
const _byId = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** @param {Event} e @returns {Element|null} */
const _target = (e) => /** @type {Element|null} */ (e.target);

/* ── Sekcje (buckety) ─────────────────────────── */

/** @param {string} key */
function _sectionLabel(key) {
  return t(`section_${key}`);
}

/* ── Helpers ──────────────────────────────────── */

/** @param {number|null|undefined} ts */
function _toDateInputValue(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** @param {string} v @returns {number|null} */
function _fromDateInputValue(v) {
  if (!v) return null;
  const [y, m, d] = v.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

/** @param {number} timestamp */
function _formatDueRelative(timestamp) {
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const diffDays = Math.round((timestamp - startOfToday) / 86400000);

  if (diffDays === 0) return t("due_today");
  if (diffDays === 1) return t("due_tomorrow");
  if (diffDays === -1) return t("due_yesterday");
  if (diffDays < -1) return t("due_daysAgo", [String(Math.abs(diffDays))]);
  if (diffDays < 7) return getShortWeekdays()[new Date(timestamp).getDay()];

  return new Intl.DateTimeFormat(getUILocale(), {
    day: "numeric",
    month: "short",
  }).format(new Date(timestamp));
}

/* Podglądy tekstowe notatki: etykieta wiersza listy i tooltip ikony 👁.
   Ekstrakcja tekstu idzie przez htmlToPreviewText (sanitize.js) — jedna
   implementacja dla listy, tooltipa i kosza.

   Jedno parsowanie, dwa przycięcia: oba podglądy to ten sam znormalizowany
   tekst, różnią się długością i tym, czy zachowują podział na linie. Wynik
   jest memoizowany po (id, content), bo renderList() przebudowuje listę przy
   każdym filtrze, toggle'u i zapisie, a treść zmienia się tylko dla notatki
   edytowanej. Cache trzyma przycięte stringi (≤300 znaków), nie pełny tekst. */

/** @typedef {{ src: string, short: string, title: string }} PreviewParts */

/** @type {Map<string, PreviewParts>} */
const _previewCache = new Map();

/** @param {string} text @param {number} max */
const _clip = (text, max) =>
  text.length > max ? text.slice(0, max) + "…" : text;

/** @param {Note} note @returns {PreviewParts} */
function _previewParts(note) {
  const src = note.content || "";
  const cached = _previewCache.get(note.id);
  if (cached && cached.src === src) return cached;

  const text = htmlToPreviewText(src);
  const parts = {
    src,
    // Wiersz listy jest jednoliniowy — łamania spłaszczamy do spacji. Wielokropek
    // stawia CSS (text-overflow) tam, gdzie kończy się miejsce, więc poszerzenie
    // panelu odsłania więcej tekstu. Ten limit tylko pilnuje rozmiaru DOM przy
    // długich notatkach i jest szerszy niż jakikolwiek wiersz.
    short: text.replace(/\n/g, " ").slice(0, 300),
    // Tooltip ikony podglądu — blok wieloliniowy, łamania zachowane
    title: _clip(text, 160),
  };
  _previewCache.set(note.id, parts);
  return parts;
}

/* Tekst do wyszukiwania: pełna treść (nie przycięta) po foldText, liczona
   leniwie tylko gdy jest zapytanie i memoizowana po (id, content) — renderList
   przy wyszukiwaniu odpala się na każdy znak, a treść zmienia się rzadko.
   htmlToPreviewText dekoduje encje (&amp;, &nbsp;), których dawny
   replace(/<[^>]+>/) nie ruszał, więc "a & b" nie było znajdowane. */

/** @type {Map<string, { src: string, folded: string }>} */
const _searchCache = new Map();

/** @param {Note} note @returns {string} */
function _searchText(note) {
  const src = note.content || "";
  const cached = _searchCache.get(note.id);
  let body;
  if (cached && cached.src === src) {
    body = cached.folded;
  } else {
    body = foldText(htmlToPreviewText(src));
    _searchCache.set(note.id, { src, folded: body });
  }
  // Nazwy tagów mogą się zmienić niezależnie od notatki — dokładane na bieżąco
  const tagNames = (note.tags ?? [])
    .map((id) => getTag(id)?.name ?? "")
    .join(" ");
  return foldText(note.title || "") + "\n" + foldText(tagNames) + "\n" + body;
}

export function isNoteEmpty() {
  return titleInput.value.trim() === "" && editor.innerText.trim() === "";
}

/* ── State ops ────────────────────────────────── */

/**
 * Gdzie zapisać termin: otwarte zadanie albo zadanie, które dopiero powstanie.
 * Dla drugiego wybór terminu wcześniej przepadał bez śladu.
 * @returns {Note|PendingMeta|null}
 */
function _dueTarget() {
  if (!state.activeId) {
    return state.pendingType === "task" ? state.pendingMeta : null;
  }
  const note = state.notes.find((n) => n.id === state.activeId);
  return note?.type === "task" ? note : null;
}

/**
 * Zaczyna od nowa termin niezapisanego elementu.
 * @param {number|null} [due]
 */
export function resetPendingMeta(due = null) {
  state.pendingMeta = _newPendingMeta(due);
}

/** @param {string} value */
export function setDueDate(value) {
  const target = _dueTarget();
  if (!target) return;
  target.due = _fromDateInputValue(value);
  saveNotes(state.notes);
  renderList();
}

/** @param {string} id */
export function postponeToTomorrow(id) {
  const note = state.notes.find((n) => n.id === id);
  if (!note || note.type !== "task") return;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  note.due = tomorrow.getTime();
  saveNotes(state.notes);
  scheduleAlarm(note);
  // Otwarte zadanie: pole daty, picker i "Na jutro" muszą pokazać nowy termin
  if (state.activeId === id) {
    if (dueInput) dueInput.value = _toDateInputValue(note.due);
    import("./date-picker.js").then(({ syncDatePicker }) => {
      syncDatePicker(_toDateInputValue(note.due) || null);
    });
    updateDeleteState();
  }
  renderList();
}

/** @param {string} value */
export function setDueTime(value) {
  const target = _dueTarget();
  if (!target) return;
  target.time = value || null;
  saveNotes(state.notes);
  renderList();
}
/** @param {number|string} value */
export function setReminder(value) {
  const target = _dueTarget();
  if (!target) return;
  target.reminder = Number(value);
  saveNotes(state.notes);
}

/** @param {string|null} value @param {number[]|null} [days] */
export function setRecurrence(value, days = null) {
  const target = _dueTarget();
  if (!target) return;
  target.recurrence = value || null;
  target.recurrenceDays =
    value === "custom" && Array.isArray(days) && days.length > 0 ? days : null;
  saveNotes(state.notes);
  updateDeleteState();
}

/** @param {string} id */
export function selectNote(id) {
  const note = state.notes.find((n) => n.id === id);
  if (!note) return;
  // Przełączenie na inną notatkę to też wyjście z edytora.
  if (state.activeId && state.activeId !== id) {
    // Pusta znika (nikt już do niej nie wróci)...
    discardEmptyActiveNote();
    // ...a niepustą trzeba zapisać SYNCHRONICZNIE. Autozapis jest
    // debounce'owany na 600 ms i wisi jeszcze, gdy user klika inną notatkę.
    // Poniżej podmieniamy activeId i treść edytora, więc to wywołanie
    // odpaliłoby się już w kontekście NOWEJ notatki, a ostatnie znaki
    // poprzedniej przepadłyby bez śladu.
    saveActiveNote();
    debouncedSave.cancel();
  }
  state.activeId = id;
  titleInput.value = note.title;
  // Re-sanityzacja przy odczycie — defense-in-depth dla storage tamper via devtools.
  // Koszt: DOMParser per otwarcie notatki (~1ms). Kompletna ochrona nawet gdy
  // dane w storage zostały zmodyfikowane poza normalnym przepływem zapisu.
  editor.innerHTML = sanitizeHTML(note.content || "");

  // Reset undo stack — każda notatka ma swoją historię
  undo.reset(editor.innerHTML);

  // Context Resume — przywróć ostatnią pozycję kursora
  loadUiSettings().then((settings) => {
    const offset = settings[`cursor_${id}`] ?? null;
    requestAnimationFrame(() => {
      setCursorOffset(editor, offset);
    });
  });

  if (dueInput) dueInput.value = _toDateInputValue(note.due);
  document.dispatchEvent(
    new CustomEvent("dueDateChanged", {
      detail: { dateStr: _toDateInputValue(note.due) || null },
    }),
  );
  updateDueDisplay();
  // Sync date picker — żeby picker wiedział która data jest wybrana
  import("./date-picker.js").then(({ syncDatePicker }) => {
    syncDatePicker(_toDateInputValue(note.due) || null);
  });
  const timeInput = /** @type {HTMLInputElement|null} */ (document.getElementById("due-time"));
  if (timeInput) timeInput.value = note.time ?? "";
  // stan alarm-btn i recurrence-btn aktualizuje updateDeleteState()
  // const reminderSelect = document.getElementById('due-reminder');
  // if (reminderSelect) reminderSelect.value = note.reminder ?? 0;
  renderList();
  updateDeleteState();
  document.dispatchEvent(new CustomEvent("noteSelected"));
}

/**
 * Wyrzuca aktywną notatkę, jeśli nie zostało w niej nic — wołane z każdej
 * ścieżki wyjścia z edytora (zwinięcie, nowa notatka, przełączenie na inną).
 *
 * Bez tego notatka utworzona przez autozapis zostaje na liście na zawsze:
 * guard w saveActiveNote chroni tylko przypadek "jeszcze nie istnieje"
 * (!state.activeId), a po skasowaniu treści już nie działa.
 *
 * Wprost, nie do kosza — patrz isDiscardableNote. Osierocony wpis
 * `cursor_<id>` w uiSettings sprząta pruneCursorKeys przy następnym boocie.
 *
 * @returns {boolean} czy coś usunięto
 */
export function discardEmptyActiveNote() {
  if (!state.activeId) return false;
  const note = state.notes.find((n) => n.id === state.activeId);
  const discardable = isDiscardableNote(note, {
    textEmpty: isNoteEmpty(),
    inFocus: state.focusIds.includes(state.activeId),
  });
  if (!discardable) return false;

  state.notes = state.notes.filter((n) => n.id !== state.activeId);
  state.activeId = null;
  saveNotes(state.notes);
  return true;
}

export function saveActiveNote() {
  if (!state.activeId && isNoteEmpty()) return;

  // Sanityzacja przy zapisie — dane w storage są zawsze czyste.
  // editor.innerHTML może zawierać artefakty z paste/undo; sanitizeHTML
  // przepuszcza tylko ALLOWED_TAGS z ALLOWED_ATTRS (patrz sanitize.js).
  // Dzięki temu selectNote może bezpiecznie assignować content do
  // editor.innerHTML bez dodatkowej sanityzacji przy odczycie.
  //
  // MAX_CONTENT_LEN egzekwujemy TUTAJ, nie tylko przy imporcie. Wcześniej
  // limit obowiązywał wyłącznie na ścieżce importu, więc notatka mogła
  // urosnąć ponad niego przez pisanie i wklejanie — a przy eksporcie
  // i ponownym imporcie zostawała ucięta. Limit ma trzymać w obie strony.
  //
  // Przycinamy PRZED sanityzacją: DOMParser domknie tag ucięty w połowie,
  // odwrotna kolejność zostawiałaby zepsuty HTML (ten sam wzorzec co
  // w handlerze paste i w sanitizeImportedNote).
  const rawContent = editor.innerHTML;
  const contentTooLong = rawContent.length > MAX_CONTENT_LEN;
  const cleanContent = sanitizeHTML(
    contentTooLong ? rawContent.slice(0, MAX_CONTENT_LEN) : rawContent,
  );
  if (contentTooLong) {
    document.dispatchEvent(new CustomEvent("noteContentTruncated"));
  }

  // Walidacja title — strip control chars, przytnij do MAX_TITLE_LEN.
  // Live feedback dla usera obsługuje osobny handler w app.js przez
  // event 'input' na #title (pokazuje komunikat zanim user kliknie zapis).
  const titleResult = validateText(titleInput.value, MAX_TITLE_LEN);
  const cleanTitle = titleResult.truncated;

  if (!state.activeId) {
    /** @type {Note} */
    const newNote = {
      id: newNoteId(),
      type: state.pendingType ?? "note",
      title: cleanTitle,
      content: cleanContent,
      created: Date.now(),
      tags: [],
      ...(state.pendingType === "task" && {
        completed: false,
        ...state.pendingMeta,
      }),
    };
    state.notes.unshift(newNote);
    state.activeId = newNote.id;
    state.pendingType = "note";
    resetPendingMeta();
    saveNotes(state.notes);
    if (isAlarmable(newNote)) scheduleAlarm(newNote);
    renderList();
    return;
  }

  const note = state.notes.find((n) => n.id === state.activeId);
  if (!note) return;
  // Czas edycji tylko przy faktycznej zmianie — samo otwarcie i zamknięcie
  // notatki (zapis przy wyjściu z edytora) nie może jej wypychać na górę
  if (note.title !== cleanTitle || note.content !== cleanContent) {
    note.updated = Date.now();
  }
  note.title = cleanTitle;
  note.content = cleanContent;
  saveNotes(state.notes);

  // Autosave odpala co 600 ms w trakcie pisania — pełny rebuild listy przy
  // każdym zapisie to zbędny koszt i migotanie. Sekcja (bucket) i kolejność
  // elementu nie zależą od tytułu ani treści, więc wystarczy podmiana
  // etykiety w miejscu. Pełny render tylko gdy aktywne wyszukiwanie (edycja
  // może zmienić dopasowanie) lub elementu nie ma w DOM (odfiltrowany /
  // zwinięta sekcja).
  if (!state.searchQuery && _syncActiveItemLabel(note)) {
    updateDeleteState();
    return;
  }
  renderList();
}

export const debouncedSave = debounce(saveActiveNote, 600);

/**
 * Wspólny rdzeń usuwania notatki: alarm + usunięcie ze stanu + (jeśli to
 * aktywna notatka) wyczyszczenie edytora + zapis. NIE woła renderList()
 * ani nie zarządza fokusem — to robi caller, bo deleteActiveNote i
 * _deleteAndMoveFocus mają tu różne potrzeby.
 *
 * @param {string} id
 * @param {object} [opts]
 * @param {boolean} [opts.resetUndo=false] - czy zresetować historię undo
 *   (potrzebne gdy usuwamy notatkę otwartą w edytorze przez przycisk delete)
 */
function _deleteNoteCore(id, { resetUndo = false } = {}) {
  clearAlarm(id);

  // Przenieś do kosza zamiast permanentnie usuwać — czysty rdzeń w notes-trash.js
  const { notes, deletedNotes, trashed } = moveToTrash(
    state.notes,
    state.deletedNotes,
    id,
    MAX_DELETED,
  );
  state.notes = notes;
  if (trashed) {
    state.deletedNotes = deletedNotes;
    saveDeletedNotes(state.deletedNotes);
    // Sygnał dla toastu "Cofnij" (app.js) — usunięcie z listy i z edytora
    // przechodzi przez ten rdzeń, więc jeden punkt emisji wystarcza
    document.dispatchEvent(
      new CustomEvent("noteTrashed", {
        detail: { id, title: trashed.title || "" },
      }),
    );
  }

  if (state.activeId === id) {
    state.activeId = null;
    titleInput.value = "";
    editor.innerHTML = "";
    if (resetUndo) undo.reset("");
  }
  saveNotes(state.notes);
}

export function deleteActiveNote() {
  if (!state.activeId) return;
  _deleteNoteCore(state.activeId, { resetUndo: true });
  renderList();
}

/**
 * Przywraca notatkę z kosza — odwrotność _deleteNoteCore. Wspólny rdzeń
 * dla przycisku "Przywróć" w panelu (panel.js) i akcji Cofnij w toaście
 * po usunięciu (app.js).
 *
 * @param {string} id
 * @returns {object|null} przywrócona notatka lub null gdy nie ma jej w koszu
 */
export function restoreDeletedNote(id) {
  const { notes, deletedNotes, restored } = restoreFromTrash(
    state.notes,
    state.deletedNotes,
    id,
  );
  if (!restored) return null;

  state.notes = notes;
  state.deletedNotes = deletedNotes;
  const note = restored;

  saveNotes(state.notes);
  saveDeletedNotes(state.deletedNotes);

  // Usunięcie wyczyściło alarm (clearAlarm w _deleteNoteCore) — przywrócone
  // zadanie z datą i godziną musi odzyskać przypomnienie od razu, nie
  // dopiero po restarcie przeglądarki (rescheduleOnBoot).
  if (isAlarmable(note)) scheduleAlarm(note);

  renderList();
  return note;
}

/** @param {string|null} id */
export function convertType(id) {
  // brak aktywnej notatki — toggle pending type
  if (!id) {
    state.pendingType = state.pendingType === "note" ? "task" : "note";
    updateDeleteState();
    return;
  }

  const note = state.notes.find((n) => n.id === id);
  if (!note) return;

  // Object.assign na notatce w stanie — zachowuje referencję, na której
  // polega renderList; flippedType (notes-trash.js) liczy tylko zmiany pól.
  Object.assign(note, flippedType(note));

  saveNotes(state.notes);
  renderList();
  updateDeleteState();
  document.dispatchEvent(new CustomEvent("noteSelected"));
}

/** @param {string} id */
export function toggleCompleted(id) {
  const note = state.notes.find((n) => n.id === id);
  if (!note || note.type !== "task") return;

  note.completed = !note.completed;
  if (note.completed) {
    note.completedAt = Date.now();
    clearAlarm(note.id);
    state.focusIds = state.focusIds.filter((fid) => fid !== id);
    saveFocusId(state.focusIds);

    // Spawn kolejnej instancji dla zadań cyklicznych
    if (note.recurrence && note.due) {
      /** @type {Note} */
      const spawn = {
        id: newNoteId(),
        type: "task",
        title: note.title,
        // Ta sama treść (np. lista kroków), checklista od nowa — recurrence.js
        content: contentForNextInstance(note.content),
        created: Date.now(),
        tags: [...(note.tags || [])],
        completed: false,
        // Najbliższy termin cyklu, który nie jest w przeszłości — odhaczenie
        // zaległego zadania nie tworzy kolejnej zaległej instancji
        due: nextDueDate(note.due, note.recurrence, note.recurrenceDays),
        recurrenceDays: note.recurrenceDays ?? null,
        time: note.time ?? null,
        reminder: note.reminder ?? 0,
        recurrence: note.recurrence,
        ...(note.important && { important: true }),
      };
      state.notes.unshift(spawn);
      if (isAlarmable(spawn)) scheduleAlarm(spawn);
      // Zapamiętaj link do spawna — odznaczenie ukończenia musi go cofnąć,
      // inaczej po pomyłkowym odhaczeniu zostają dwie instancje zadania
      note.spawnedNextId = spawn.id;
    }
  } else {
    delete note.completedAt;

    // Cofnij automatycznie utworzoną następną instancję — tylko jeśli
    // nadal jest nieukończona (ukończonej/przetworzonej nie ruszamy).
    // Usunięcie bez kosza: spawn to duplikat, nie treść użytkownika.
    if (note.spawnedNextId) {
      const spawn = state.notes.find((n) => n.id === note.spawnedNextId);
      if (spawn && spawn.type === "task" && !spawn.completed) {
        clearAlarm(spawn.id);
        state.notes = state.notes.filter((n) => n.id !== spawn.id);
      }
      delete note.spawnedNextId;
    }

    // Ukończenie skasowało przypomnienie. Bez tego wracałoby dopiero po
    // restarcie przeglądarki (rescheduleAll przy starcie).
    if (isAlarmable(note)) scheduleAlarm(note);
  }

  saveNotes(state.notes);
  renderList();
  // Checkbox stoi też w nagłówku otwartego zadania, a ukończenie zdejmuje
  // "w trakcie" — nagłówek musi to pokazać od razu.
  updateDeleteState();
}

/** @param {string} id */
export function toggleFocus(id) {
  if (!id) return;
  const note = state.notes.find((n) => n.id === id);
  if (!note) return;

  const idx = state.focusIds.indexOf(id);
  if (idx !== -1) {
    state.focusIds.splice(idx, 1);
  } else {
    state.focusIds.push(id);

    // tylko dla tasków — ustaw datę na dziś jeśli brak
    if (note.type === "task" && !note.due) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      note.due = today.getTime();
      saveNotes(state.notes);
      if (state.activeId === id && dueInput) {
        dueInput.value = _toDateInputValue(note.due);
      }
    }
  }

  saveFocusId(state.focusIds);
  renderList();
  updateDeleteState();
  document.dispatchEvent(new CustomEvent("focusChanged"));
}

/* ── UI state sync ────────────────────────────── */

/**
 * Czytelna etykieta cykliczności notatki ("" gdy brak).
 * Jedno źródło etykiety dla badge w edytorze i ikony ↺ na liście —
 * wcześniej ta sama logika była zduplikowana w dwóch miejscach.
 */
/** @param {Note|null} note */
function _recurrenceLabel(note) {
  if (!note?.recurrence) return "";
  const DAY_NAMES = [0, 1, 2, 3, 4, 5, 6].map((d) => t(`day_short_${d}`));

  if (note.recurrence === "custom" && Array.isArray(note.recurrenceDays)) {
    return note.recurrenceDays.map((d) => DAY_NAMES[d] ?? "").join(", ");
  }
  if (note.recurrence === "weekly" && note.due) {
    return `${t("recurrence_weekly")} (${DAY_NAMES[new Date(note.due).getDay()]})`;
  }
  return (
    /** @type {Record<string, string>} */ ({
      daily: t("recurrence_daily"),
      weekly: t("recurrence_weekly"),
      monthly: t("recurrence_monthly"),
      yearly: t("recurrence_yearly"),
      custom: t("recurrence_custom"),
    })[note.recurrence] ?? ""
  );
}

/**
 * Synchronizuje cały stan UI edytora z aktywną notatką.
 * Rozbite na wyspecjalizowane helpery — każdy dotyka jednej grupy
 * elementów; updateDeleteState pozostaje jedynym publicznym wejściem
 * (nazwa historyczna, wołana z wielu miejsc).
 */
export function updateDeleteState() {
  const activeNote = state.notes.find((n) => n.id === state.activeId) ?? null;
  _syncEditorActionButtons(activeNote);
  _syncTaskMeta(activeNote);
  _syncRecurrenceBadge(activeNote);
}

/* Nagłówek notatki: checkbox, symbole przy tytule i pozycje menu ⋮ */
/** @param {Note|null} note */
function _syncEditorActionButtons(note) {
  const header = noteHeaderState({
    note,
    activeId: state.activeId,
    pendingType: state.pendingType,
    focusIds: state.focusIds,
    pinnedActions: state.pinnedActions,
  });

  const completeBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById("note-complete"));
  if (completeBtn) {
    completeBtn.hidden = !header.isTask;
    completeBtn.disabled = !header.canComplete;
    completeBtn.classList.toggle("note-checkbox--on", header.completed);
    completeBtn.textContent = header.completed ? "✓" : "";
    const label = t(header.completed ? "task_markIncomplete" : "task_markComplete");
    completeBtn.setAttribute("aria-label", label);
    completeBtn.title = label;
  }

  const typeIcon = document.getElementById("note-type-icon");
  if (typeIcon) typeIcon.hidden = header.isTask;

  document
    .getElementById("title-field")
    ?.classList.toggle("is-completed", header.completed);

  const statusImportant = document.getElementById("status-important");
  if (statusImportant) statusImportant.hidden = !header.showImportantSymbol;
  const statusFocus = document.getElementById("status-focus");
  if (statusFocus) statusFocus.hidden = !header.showFocusSymbol;

  // Dostępność działania i jego miejsce to dwie osobne rzeczy: `hidden` na
  // pozycji menu znaczy "teraz niedostępne" (patrzą na to też skróty w app.js),
  // a is-pinned tylko "pokazane w nagłówku zamiast w menu".
  // Warunkiem kosza jest ISTNIENIE notatki, nie jej treść. Wcześniej dochodziło
  // tu `|| isNoteEmpty()` i notatka bez tekstu, ale z tagiem (albo terminem,
  // gwiazdką) wpadała w pułapkę: discardEmptyActiveNote jej nie rusza, bo
  // tag to intencja, a kosz był wyłączony, bo nie ma tekstu. Nie dało się
  // jej usunąć z edytora — trzeba było wracać na listę.
  for (const action of NOTE_ACTIONS) {
    const pinned = header.isPinned(action);
    const available = header.available[action];
    const item = document.getElementById(NOTE_ACTION_ITEMS[action]);
    if (item) {
      item.hidden = !available;
      item.classList.toggle("is-pinned", pinned);
    }
    const pin = document.getElementById(`pin-${action}`);
    if (pin) pin.hidden = !available || !pinned;
  }

  document
    .getElementById("important-btn")
    ?.setAttribute("aria-checked", String(header.important));
  _syncTogglePin("pin-important", header.important, {
    on: "important_remove_title",
    off: "noteMenu_important",
  });

  document
    .getElementById("focus-btn")
    ?.setAttribute("aria-checked", String(header.inFocus));
  _syncTogglePin("pin-focus", header.inFocus, {
    on: "focus_remove_title",
    off: "noteMenu_inProgress",
  });

  const convertText = t(
    header.isTask ? "convertType_toNote_title" : "convertType_toTask_title",
  );
  const convertLabel = document.getElementById("convert-type-label");
  if (convertLabel) convertLabel.textContent = convertText;
  for (const id of ["convert-type-icon", "pin-convert"]) {
    const icon = document.getElementById(id);
    icon?.classList.toggle("icon--type-note", header.isTask);
    icon?.classList.toggle("icon--type-task", !header.isTask);
  }
  const convertPin = document.getElementById("pin-convert");
  if (convertPin) {
    convertPin.title = convertText;
    convertPin.setAttribute("aria-label", convertText);
  }

  const separator = document.getElementById("note-menu-separator");
  if (separator) separator.hidden = !header.showMenuSeparator;
  const menuBtn = document.getElementById("note-menu-btn");
  if (menuBtn) menuBtn.hidden = header.menuEmpty;
}

/**
 * Ikona przełącznika przypięta do nagłówka: stan i opis zależny od stanu.
 * @param {string} id
 * @param {boolean} active
 * @param {{ on: string, off: string }} keys klucze locale opisu
 */
function _syncTogglePin(id, active, { on, off }) {
  const pin = document.getElementById(id);
  if (!pin) return;
  const label = t(active ? on : off);
  pin.classList.toggle("is-active", active);
  pin.setAttribute("aria-pressed", String(active));
  pin.title = label;
  pin.setAttribute("aria-label", label);
}

/**
 * Zmienia działania przypięte do nagłówka (Ustawienia → Menu trzech kropek).
 * @param {unknown} actions
 */
export function setPinnedActions(actions) {
  state.pinnedActions = normalizePinnedActions(actions);
  updateDeleteState();
}

/* Metadane zadania: widoczność due-bar, pill alarmu, przycisk daty */
/** @param {Note|null} note */
function _syncTaskMeta(note) {
  const isTask = state.activeId
    ? note?.type === "task"
    : state.pendingType === "task";

  const noteMeta = document.getElementById("note-meta");
  if (noteMeta) noteMeta.hidden = !isTask;
  if (dueWrapper) dueWrapper.hidden = !isTask;
  if (dueInput && !state.activeId) {
    dueInput.value = _toDateInputValue(state.pendingMeta.due);
  }
  updateDueDisplay();

  const timeInput = /** @type {HTMLInputElement|null} */ (document.getElementById("due-time"));
  const alarmPill = document.getElementById("due-alarm-pill");
  const alarmLabel = document.getElementById("alarm-label");
  const reminderValue = (note ?? state.pendingMeta).reminder ?? 0;
  if (alarmPill) {
    const reminder = reminderValue;
    const hasTime = !!timeInput?.value;
    alarmPill.hidden = !hasTime || reminder === 0;
    if (alarmLabel && hasTime && reminder > 0) {
      alarmLabel.textContent =
        reminder === 60
          ? t("dueReminder_1h")
          : t("dueReminder_Nmin", [String(reminder)]);
    }
  }

  const displayBtn = document.getElementById("due-display-btn");
  if (displayBtn) {
    displayBtn.classList.toggle("has-value", !!dueInput?.value);
  }

  // "Na jutro" — zapisane, nieukończone zadanie z terminem dziś lub zaległym.
  // Typowa droga: przypomnienie → klik → otwarte zadanie → przełożenie.
  const postponeBtn = document.getElementById("due-postpone");
  if (postponeBtn) {
    const endOfToday = new Date();
    endOfToday.setHours(24, 0, 0, 0);
    postponeBtn.hidden = !(
      note?.type === "task" &&
      !note.completed &&
      !!note.due &&
      note.due < endOfToday.getTime()
    );
  }

  document.dispatchEvent(
    new CustomEvent("reminderChanged", {
      detail: { value: reminderValue },
    }),
  );
}

/* Badge cykliczności przy dacie + event dla date-pickera */
/** @param {Note|null} activeNote */
function _syncRecurrenceBadge(activeNote) {
  const note = /** @type {Note} */ (activeNote ?? state.pendingMeta);
  const badge = document.getElementById("due-recurrence-badge");
  if (badge) {
    badge.hidden = !note?.recurrence || !note?.due;
    const label = _recurrenceLabel(note);
    badge.title = label;
    badge.dataset.tooltipContent = label;
  }
  document.dispatchEvent(
    new CustomEvent("recurrenceChanged", {
      detail: { value: note?.recurrence ?? null },
    }),
  );
}
/* ── Render ───────────────────────────────────── */
export function clearFilters() {
  state.searchQuery = "";
  state.filterTags = [];
  state.filterType = "all";
  state.filterHideCompleted = false;
  state.filterInProgress = false;
  state.filterDate = null;
  const dateInput = /** @type {HTMLInputElement|null} */ (document.getElementById("filter-date"));
  if (dateInput) dateInput.value = "";

  // Sync DOM — input wartości i klasy
  const searchInput = /** @type {HTMLInputElement|null} */ (document.getElementById("search"));
  if (searchInput) searchInput.value = "";

  document.querySelectorAll("#type-toggle .type-toggle__btn").forEach((b) => {
    b.classList.toggle("is-active", /** @type {HTMLElement} */ (b).dataset.type === "all");
  });

  // Filter bar zostaje otwarty/zamknięty jak był; tylko jego stan checkboxa się
  // odświeży naturalnie przez _renderFilterOptions gdy user go ponownie otworzy.
  // Save preferencji
  saveFilterPrefs({ hideCompleted: false });

  renderList();
}

/** @param {number} tsA @param {number} tsB */
function _sameDay(tsA, tsB) {
  const a = new Date(tsA);
  const b = new Date(tsB);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/* ── Fokus klawiatury a przebudowa listy ──────────
   renderList() buduje listę od zera, więc wiersz z fokusem przestaje istnieć
   i fokus spada na <body>. Po odhaczeniu Spacją, przełożeniu albo zwinięciu
   sekcji trzeba było wracać na listę skrótem Alt+L. Fokus jest zapamiętywany
   przed przebudową i oddawany po niej; który wiersz go dostaje, liczy
   list-focus.js. */

/**
 * Wpis, od którego fokus ma odejść przy najbliższej przebudowie: akcja
 * przenosi go do innej sekcji (odhaczenie, przełożenie), a użytkownik
 * pracuje dalej w tym samym miejscu listy.
 * @type {string|null}
 */
let _moveFocusOffId = null;

/** @returns {string[]} identyfikatory wierszy w kolejności listy */
export function listRowIds() {
  return [...notesList.querySelectorAll(".note-item")].map(
    (el) => /** @type {HTMLElement} */ (el).dataset.id ?? "",
  );
}

/**
 * @typedef {{ kind: 'item', id: string, ids: string[] }
 *   | { kind: 'section'|'add', key: string }} ListFocus
 */

/** @returns {ListFocus|null} */
function _captureListFocus() {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !notesList.contains(active)) return null;
  // Tylko fokus z klawiatury. Po kliknięciu myszą nie ma czego ratować,
  // a przeniesienie fokusu rysowałoby obwódkę na sąsiednim wierszu.
  if (!active.matches(":focus-visible")) return null;

  const row = /** @type {HTMLElement|null} */ (active.closest(".note-item"));
  if (row?.dataset.id) return { kind: "item", id: row.dataset.id, ids: listRowIds() };
  const header = /** @type {HTMLElement|null} */ (active.closest(".section-header"));
  if (header?.dataset.section) return { kind: "section", key: header.dataset.section };
  const add = /** @type {HTMLElement|null} */ (active.closest(".section-add"));
  if (add?.dataset.addToSection) return { kind: "add", key: add.dataset.addToSection };
  return null;
}

/** @param {ListFocus|null} saved */
function _restoreListFocus(saved) {
  const moveOffId = _moveFocusOffId;
  _moveFocusOffId = null;
  if (!saved) return;
  // Fokus jest już gdzie indziej (np. w otwieranej notatce) — nie zabieramy go
  if (document.activeElement && document.activeElement !== document.body) return;

  /** @type {Element|null} */
  let target = null;
  if (saved.kind === "item") {
    const id = nextFocusId(saved.ids, saved.id, listRowIds(), {
      moveOff: moveOffId === saved.id,
    });
    if (id) target = notesList.querySelector(`.note-item[data-id="${CSS.escape(id)}"]`);
  } else if (saved.kind === "section") {
    target = notesList.querySelector(
      `.section-header[data-section="${CSS.escape(saved.key)}"]`,
    );
  } else {
    target = notesList.querySelector(
      `.section-add[data-add-to-section="${CSS.escape(saved.key)}"]`,
    );
  }
  /** @type {HTMLElement|null} */ (target)?.focus();
}

export function renderList() {
  const focus = _captureListFocus();
  _renderListBody();
  _restoreListFocus(focus);
}

function _renderListBody() {
  notesList.innerHTML = "";

  // Notatki usunięte w tej sesji zostawiają martwe wpisy w _previewCache.
  // Zamiast sprzątać przy każdej ścieżce usuwania — kasuj cache, gdy urośnie
  // ponad rozmiar zbioru. Najbliższy render odbuduje go leniwie.
  if (_previewCache.size > state.notes.length + 128) _previewCache.clear();
  if (_searchCache.size > state.notes.length + 128) _searchCache.clear();

  // Klasy zen / main-view — ustawiaj zawsze, niezależnie od zawartości listy
  notesList.classList.toggle("zen-active", state.zenMode);
  document
    .getElementById("main-view")
    ?.classList.toggle("zen-mode", state.zenMode);

  // Hoist poza pętlę filtra — zapytanie normalizowane raz, tekst notatki
  // liczony tylko przy niepustym zapytaniu (_searchText, memoizowany).
  // Każde słowo zapytania musi wystąpić (dowolna kolejność); wielkość liter
  // i polskie znaki bez znaczenia; przeszukiwane: tytuł, treść, nazwy tagów.
  const terms = queryTerms(state.searchQuery);

  const filtered = state.notes.filter((note) => {
    const matchesSearch =
      terms.length === 0 || matchesTerms(_searchText(note), terms);
    const matchesTags =
      state.filterTags.length === 0 ||
      state.filterTags.every((id) => note.tags?.includes(id));
    const matchesType = state.zenMode
      ? note.type === "task"
      : state.filterType === "all" || note.type === state.filterType;
    const matchesCompleted =
      !state.filterHideCompleted || !(note.type === "task" && note.completed);
    const matchesInProgress =
      !state.filterInProgress || state.focusIds.includes(note.id);

    const matchesDate = !state.filterDate
      ? true
      : note.type === "task" &&
        !!note.due &&
        _sameDay(note.due, state.filterDate);

    return (
      matchesSearch &&
      matchesTags &&
      matchesType &&
      matchesCompleted &&
      matchesInProgress &&
      matchesDate
    );
  });

  // Empty state — brak filtrów lub baza pusta → "Lista jest pusta"
  const noFilters =
    state.searchQuery === "" &&
    state.filterTags.length === 0 &&
    state.filterType === "all" &&
    !state.filterHideCompleted &&
    !state.filterInProgress &&
    !state.filterDate;

  if (
    filtered.length === 0 &&
    !state.zenMode &&
    (state.notes.length === 0 || noFilters)
  ) {
    notesList.appendChild(_buildStartScreen());
    updateDeleteState();
    return;
  }

  if (filtered.length === 0 && !state.zenMode) {
    const empty = document.createElement("div");
    empty.className = "notes-empty notes-empty--filtered";

    const onlyTypeFilter =
      state.filterType !== "all" &&
      state.searchQuery === "" &&
      state.filterTags.length === 0 &&
      !state.filterHideCompleted;

    let msgKey = "list_empty_filtered";
    if (onlyTypeFilter) {
      msgKey =
        state.filterType === "note"
          ? "list_empty_noNotes"
          : "list_empty_noTasks";
    }

    const msg = document.createElement("span");
    msg.className = "notes-empty__msg";
    msg.textContent = t(msgKey);

    const clearBtn = document.createElement("button");
    clearBtn.className = "btn notes-empty__clear";
    clearBtn.textContent = t("list_empty_filtered_clearBtn");
    clearBtn.onclick = () => {
      clearFilters();
      const filterDateInput = /** @type {HTMLInputElement|null} */ (document.getElementById("filter-date"));
      if (filterDateInput) filterDateInput.value = "";
      const filterDateClear = document.getElementById("filter-date-clear");
      if (filterDateClear) filterDateClear.hidden = true;
      document.dispatchEvent(new CustomEvent("filterChanged"));
    };

    empty.appendChild(msg);
    // Sam filtr typu: pasujący przycisk, żeby nie trzeba było go wyłączać,
    // by dodać pierwszy element tego typu
    if (onlyTypeFilter) {
      empty.appendChild(
        state.filterType === "note"
          ? _newItemButton("notes", "list_empty_newNote")
          : _newItemButton("unscheduled", "list_empty_newTask"),
      );
    }
    empty.appendChild(clearBtn);
    notesList.appendChild(empty);
    updateDeleteState();
    return;
  }

  // Grupowanie w buckety
  /** @type {Record<string, Note[]>} */
  const buckets = {};
  filtered.forEach((note) => {
    const key = bucketFor(note);
    (buckets[key] ||= []).push(note);
  });

  // Sortowanie wewnątrz sekcji
  Object.entries(buckets).forEach(([key, items]) => {
    if (key === "done") {
      items.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
    } else if (key === "notes") {
      // Ważne (gwiazdka) przypięte na górze, potem ostatnio edytowane —
      // notatka, do której wraca się codziennie, nie opada pod nowsze
      items.sort((a, b) => {
        if (!!b.important !== !!a.important) return b.important ? 1 : -1;
        return (b.updated ?? b.created) - (a.updated ?? a.created);
      });
    } else {
      items.sort((a, b) => {
        if (state.focusIds.includes(a.id)) return -1;
        if (state.focusIds.includes(b.id)) return 1;
        if (!!b.important !== !!a.important) return b.important ? 1 : -1;
        const aVal = a.due ?? a.created;
        const bVal = b.due ?? b.created;
        return key === "unscheduled" ? bVal - aVal : aVal - bVal;
      });
    }
  });

  // ── Zen mode ──────────────────────────────────
  if (state.zenMode) {
    // Wyszukiwanie aktywne + brak wyników — nie mylić z "Wszystko ogarnięte"
    if (filtered.length === 0 && state.searchQuery) {
      const empty = document.createElement("div");
      empty.className = "notes-empty notes-empty--filtered";
      const msg = document.createElement("span");
      msg.className = "notes-empty__msg";
      msg.textContent = t("list_empty_filtered");
      empty.appendChild(msg);
      notesList.appendChild(empty);
      updateDeleteState();
      return;
    }

    const hasItems = ["overdue", "today"].some(
      (key) => buckets[key]?.length > 0,
    );

    if (!hasItems) {
      const empty = document.createElement("div");
      empty.className = "zen-empty";
      const zenCheck = document.createElement("span");
      zenCheck.className = "zen-empty__check";
      zenCheck.textContent = "✓";
      const zenTitle = document.createElement("span");
      zenTitle.className = "zen-empty__title";
      zenTitle.textContent = t("zen_allClear_title");
      const zenSub = document.createElement("span");
      zenSub.className = "zen-empty__sub";
      zenSub.textContent = t("zen_allClear_sub");
      empty.appendChild(zenCheck);
      empty.appendChild(zenTitle);
      empty.appendChild(zenSub);
      notesList.appendChild(empty);
      updateDeleteState();
      return;
    }

    ["overdue", "today"].forEach((key) => {
      const items = buckets[key];
      if (items?.length) _renderSection(key, items);
    });

    updateDeleteState();
    return;
  }

  // ── Normalny widok ────────────────────────────
  const alwaysVisible = alwaysVisibleSections(state);
  SECTION_ORDER.forEach((key) => {
    const items = buckets[key] ?? [];
    if (items.length === 0 && !alwaysVisible.includes(key)) return;
    _renderSection(key, items);
  });

  updateDeleteState();
}

/**
 * @param {string} tag
 * @param {string} className
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function _el(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

/**
 * Podpisany przycisk tworzący element tak samo jak "+" w danej sekcji.
 * @param {string} section
 * @param {string} labelKey
 * @returns {HTMLButtonElement}
 */
function _newItemButton(section, labelKey) {
  const btn = /** @type {HTMLButtonElement} */ (
    _el("button", "btn btn--icon-left notes-empty__new")
  );
  btn.type = "button";
  btn.append(
    _el("span", "btn__icon icon--add"),
    _el("span", "", t(labelKey)),
  );
  btn.addEventListener("click", () => {
    document.dispatchEvent(
      new CustomEvent("newItemInSection", {
        detail: { ...newItemForSection(section), section },
      }),
    );
  });
  return btn;
}

/**
 * Ekran pustej listy. Kolejność odpowiada pytaniom nowej osoby: jak dodać
 * pierwszy wpis, jak wygląda szybkie dodawanie, gdzie się tego nauczyć.
 *
 * Bez pustych sekcji z licznikiem 0: na pustej liście wyglądały jak martwe
 * wiersze, a nie sposób dodania wpisu. Tę rolę mają tu podpisane przyciski.
 *
 * Przykłady to klikalne karty: pokazują tekst do wpisania i to, co z niego
 * powstanie. `!` to prefiks wpisywany w tekst, nie klawisz, więc przykład
 * uczy go lepiej niż kafelek klawisza. Klik wstawia tekst do pola szybkiego
 * dodawania bez zapisu: pod polem od razu widać podgląd, a Enter dodaje wpis.
 *
 * @returns {HTMLElement}
 */
function _buildStartScreen() {
  const el = _el;

  const screen = el("div", "notes-empty notes-empty--start");
  screen.append(
    el("h2", "notes-empty__title", t("list_empty")),
    el("p", "notes-empty__lead", t("list_empty_lead")),
  );

  const actions = el("div", "notes-empty__actions");
  actions.append(
    _newItemButton("notes", "list_empty_newNote"),
    _newItemButton("unscheduled", "list_empty_newTask"),
  );
  screen.append(
    actions,
    el("h3", "notes-empty__label", t("list_empty_examples_label")),
  );

  const examples = el("ul", "notes-empty__examples");
  for (const [exKey, resultKey] of [
    ["list_empty_ex_note", "list_empty_ex_note_result"],
    ["list_empty_ex_task", "list_empty_ex_task_result"],
  ]) {
    const example = /** @type {HTMLButtonElement} */ (
      el("button", "notes-empty__example")
    );
    example.type = "button";
    example.title = t("list_empty_ex_insert_title");
    example.append(
      el("code", "notes-empty__example-text", t(exKey)),
      el("span", "notes-empty__result", t(resultKey)),
    );
    example.addEventListener("click", () => {
      const qc = /** @type {HTMLInputElement|null} */ (
        document.getElementById("quick-capture")
      );
      if (!qc) return;
      qc.value = t(exKey);
      qc.focus();
      qc.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const li = document.createElement("li");
    li.appendChild(example);
    examples.appendChild(li);
  }
  screen.appendChild(examples);

  const tutorial = el("div", "notes-empty__tutorial");
  const tutorialBtn = /** @type {HTMLButtonElement} */ (
    el("button", "btn notes-empty__tutorial-btn", t("list_empty_tutorial_btn"))
  );
  tutorialBtn.type = "button";
  tutorialBtn.addEventListener("click", () => startStage(1));
  tutorial.append(
    el("h3", "notes-empty__subtitle", t("list_empty_tutorial_title")),
    el("p", "notes-empty__text", t("list_empty_tutorial_desc")),
    tutorialBtn,
  );
  screen.appendChild(tutorial);

  const tip = el("p", "notes-empty__tip");
  // Rzeczywisty skrót popupu (w wersji testowej inny, może być zmieniony)
  const popupKbd = el("kbd", "notes-empty__kbd", "");
  popupKbd.dataset.command = "_execute_browser_action";
  tip.append(
    popupKbd,
    document.createTextNode(` ${t("list_empty_popup")}`),
  );
  applyCommandShortcuts(tip);
  screen.appendChild(tip);

  return screen;
}

/** @param {string} key @param {Note[]} items */
function _renderSection(key, items) {
  const isEmpty = items.length === 0;
  // Pusta sekcja nie ma czego zwijać, więc zapamiętane zwinięcie jej nie dotyczy
  const isCollapsed = !isEmpty && state.collapsedSections.includes(key);

  let countLabel = `${items.length}`;

  if (key === "today") {
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).getTime();
    const todayEnd = todayStart + 86400000;
    const allToday = state.notes.filter(
      (n) => n.type === "task" && n.due != null && n.due >= todayStart && n.due < todayEnd,
    );
    const done = allToday.filter((n) => n.completed).length;
    const total = allToday.length;
    countLabel = done > 0 ? `${done}/${total}` : `${total}`;
  }

  const header = document.createElement("button");
  header.className =
    "section-header" + (isCollapsed ? " section-header--collapsed" : "");
  // "Do nadrobienia" jest domyślnie zwinięte (mniej presji), ale wtedy jedynym
  // śladem jest licznik — wyróżniony, żeby przeterminowane zadanie nie umknęło
  if (key === "overdue" && items.length > 0)
    header.classList.add("section-header--alert");
  header.dataset.section = key;
  // Czytniki ekranu muszą wiedzieć że nagłówek zwija/rozwija sekcję —
  // sam chevron tekstowy (▸/▾) tego nie komunikuje
  if (isEmpty) {
    header.classList.add("section-header--empty");
    header.disabled = true;
  } else {
    header.setAttribute("aria-expanded", String(!isCollapsed));
  }

  const label = document.createElement("span");
  label.className = "section-header__label";
  label.textContent = _sectionLabel(key);

  const meta = document.createElement("span");
  meta.className = "section-header__meta";

  const count = document.createElement("span");
  count.className = "section-header__count";
  count.textContent = countLabel;

  const chevron = document.createElement("span");
  chevron.className = "section-header__chevron";
  chevron.textContent = isCollapsed ? "▸" : "▾";
  // Dekoracja — stan komunikuje aria-expanded na nagłówku
  chevron.setAttribute("aria-hidden", "true");

  meta.appendChild(count);
  if (!isEmpty) meta.appendChild(chevron);
  header.appendChild(label);
  header.appendChild(meta);

  // "+" jest obok nagłówka, nie w nim: nagłówek to <button>, a przycisk
  // w przycisku to niepoprawny HTML. Pozycję w wierszu ustawia CSS.
  const row = document.createElement("div");
  row.className = "section-row" + (isEmpty ? " section-row--empty" : "");
  row.appendChild(header);
  if (newItemForSection(key)) {
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "section-add icon--add";
    addBtn.dataset.addToSection = key;
    const addLabel = t(`section_add_${key}`);
    addBtn.title = addLabel;
    addBtn.setAttribute("aria-label", addLabel);
    row.appendChild(addBtn);
  }

  // Kliki obsługiwane przez delegację na #notesList
  notesList.appendChild(row);
  if (!isCollapsed) items.forEach(_renderNoteItem);
}

/** @param {string} key */
function _toggleSection(key) {
  const idx = state.collapsedSections.indexOf(key);
  if (idx === -1) state.collapsedSections.push(key);
  else state.collapsedSections.splice(idx, 1);
  saveCollapsedSections(state.collapsedSections);
  renderList();
}

/* Etykieta elementu listy: tytuł (fallback: fragment treści), tooltip
   pełnego podglądu i title przycisku 👁. Jedno źródło prawdy dla renderu
   (_renderNoteItem) i aktualizacji in-place przy autosave. */
/** @param {HTMLElement} item @param {Note} note */
function _applyItemLabel(item, note) {
  const titleEl = /** @type {HTMLElement|null} */ (item.querySelector(".note-item__title"));
  if (!titleEl) return;

  const titleText = note.title?.trim();
  const parts = _previewParts(note);

  titleEl.textContent = titleText || parts.short || t("note_untitled");

  // Tytuł nie ma własnego tooltipa — od pokazywania treści jest ikona 👁
  // obok. Wcześniej tooltip pojawiał się tylko dla notatek bez tytułu,
  // więc dublował tę samą rolę w połowie przypadków.

  // Ikona podglądu — jedyny tooltip treści w wierszu listy. Szedł przez
  // atrybut title, więc trafiał w bazowy układ jednoliniowy; przez
  // data-tooltip-content dostaje wariant blokowy (patrz overlays.css).
  const previewBtn = /** @type {HTMLElement|null} */ (item.querySelector(".note-item__preview"));
  if (previewBtn) {
    previewBtn.dataset.tooltipContent = parts.title || t("note_preview_empty");
    previewBtn.dataset.tooltipVariant = "preview";
    // Natywny title pokazałby się obok naszego tooltipa
    previewBtn.removeAttribute("title");
  }
}

/* Aktualizacja etykiety aktywnej notatki w miejscu (bez renderList).
   false → elementu nie ma w DOM, caller musi zrobić pełny render. */
/** @param {Note} note */
function _syncActiveItemLabel(note) {
  const item = notesList.querySelector(
    `.note-item[data-id="${CSS.escape(note.id)}"]`,
  );
  if (!item) return false;
  _applyItemLabel(/** @type {HTMLElement} */ (item), note);
  return true;
}

/** @param {Note} note */
function _renderNoteItem(note) {
  const div = document.createElement("div");
  div.className = "note-item";
  div.dataset.id = note.id;
  div.tabIndex = 0;
  if (note.id === state.activeId) div.classList.add("is-active");
  if (note.type === "task" && note.completed)
    div.classList.add("note-item--completed");

  // Checkbox dla tasków — klik obsługiwany przez delegację na #notesList
  if (note.type === "task") {
    const cb = document.createElement("button");
    cb.className =
      "note-checkbox" + (note.completed ? " note-checkbox--on" : "");
    cb.textContent = note.completed ? "✓" : "";
    cb.setAttribute(
      "aria-label",
      t(note.completed ? "task_markIncomplete" : "task_markComplete"),
    );
    div.appendChild(cb);
  }

  // Przycisk podglądu + tytuł — tekst i tooltipy wypełnia _applyItemLabel
  // (wspólne z aktualizacją in-place przy autosave). Ikona stoi przed tytułem:
  // za nim zajmowała miejsce między wielokropkiem a resztą wiersza.
  const titleWrapper = document.createElement("div");
  titleWrapper.className = "note-item__title-wrap";

  const previewBtn = document.createElement("button");
  previewBtn.className = "note-item__preview icon--preview";
  previewBtn.setAttribute("aria-label", t("note_preview_ariaLabel"));
  titleWrapper.appendChild(previewBtn);

  const title = document.createElement("span");
  title.className = "note-item__title";
  titleWrapper.appendChild(title);

  // Tytuł i tagi dzielą jeden zawijany kontener: gdy się mieszczą, wiersz
  // ma jedną linię; tagi schodzą pod tytuł dopiero, gdy brakuje miejsca.
  // Wcześniej tagi zawsze stały w osobnej linii i podwajały wysokość
  // każdego otagowanego wiersza.
  const main = document.createElement("div");
  main.className = "note-item__main";
  main.appendChild(titleWrapper);
  div.appendChild(main);
  _applyItemLabel(div, note);

  // Ikona recurrence — etykieta współdzielona z badge (patrz _recurrenceLabel)
  if (note.recurrence) {
    const rec = document.createElement("span");
    rec.className = "note-item__recurrence";
    rec.textContent = "↺";
    const recLabel = _recurrenceLabel(note) || t("recurrence_ariaLabel");
    rec.setAttribute("aria-label", recLabel);
    rec.title = recLabel;
    div.appendChild(rec);
  }

  // Gwiazdka
  if (note.important) {
    const star = document.createElement("span");
    star.className = "note-item__star";
    star.textContent = "★";
    star.setAttribute("aria-label", t("important_ariaLabel"));
    div.appendChild(star);
  }
  // focus
  if (state.focusIds.includes(note.id)) div.classList.add("note-item--focused");
  // Due indicator — jeden, z godziną jeśli ustawiona
  if (note.type === "task" && note.due && !note.completed) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let label = _formatDueRelative(note.due);
    if (note.time) label += ` ${note.time}`;
    if (label) {
      const dueSpan = document.createElement("span");
      dueSpan.className = "note-item__due";
      dueSpan.textContent = label;
      div.appendChild(dueSpan);
    }
    if (note.due < today.getTime()) {
      const tomorrowBtn = document.createElement("button");
      tomorrowBtn.className = "note-item__postpone";
      tomorrowBtn.textContent = "→";
      tomorrowBtn.setAttribute("aria-label", t("note_postponeToTomorrow"));
      tomorrowBtn.title = t("note_postponeToTomorrow");
      div.appendChild(tomorrowBtn);
    }
  }

  // Delete button — klik obsługiwany przez delegację na #notesList
  const delBtn = document.createElement("button");
  delBtn.className = "note-item__delete";
  delBtn.textContent = "✕";
  delBtn.setAttribute("aria-label", t("note_deleteItem_ariaLabel"));
  div.appendChild(delBtn);

  // Tagi (max 2 + "+N")
  const tags = note.tags ?? [];
  if (tags.length > 0) {
    const row = document.createElement("div");
    row.className = "note-tags-row";
    /** @type {Tag[]} */ ([...tags].map((id) => getTag(id)).filter(Boolean))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 2)
      .forEach((tag) => {
        row.appendChild(makeTagPill(tag, { truncate: 12 }));
      });
    if (tags.length > 2) {
      const more = document.createElement("span");
      more.className = "tag-more";
      more.textContent = `+${tags.length - 2}`;
      row.appendChild(more);
    }
    main.appendChild(row);
  }
  // Klawiatura i kliki — delegacja na #notesList (patrz niżej)
  notesList.appendChild(div);
}

/** @param {string} id @param {HTMLElement} el */
function _deleteAndMoveFocus(id, el) {
  // zapamiętaj sąsiada przed usunięciem
  let nextEl = el.nextElementSibling;
  while (nextEl && !nextEl.classList.contains("note-item"))
    nextEl = nextEl.nextElementSibling;
  if (!nextEl) {
    let prevEl = el.previousElementSibling;
    while (prevEl && !prevEl.classList.contains("note-item"))
      prevEl = prevEl.previousElementSibling;
    nextEl = prevEl;
  }
  const nextId = /** @type {HTMLElement|null} */ (nextEl)?.dataset?.id;

  _deleteNoteCore(id);
  renderList();
  document.dispatchEvent(new CustomEvent("noteDeleted"));

  // przeskocz fokus do sąsiedniego elementu po re-renderze
  if (nextId) {
    const target = document.querySelector(
      `#notesList .note-item[data-id="${nextId}"]`,
    );
    if (target) /** @type {HTMLElement} */ (target).focus();
  }
}

/* ── Delegacja zdarzeń listy ──────────────────────
   renderList() przebudowuje listę od zera przy każdym filtrze i zapisie —
   pojedyncze listenery na kontenerze zamiast handlerów per-element
   eliminują koszt ponownego podpinania i churn GC przy każdym renderze. */

notesList.addEventListener("click", (e) => {
  const addBtn = /** @type {HTMLElement|null} */ (_target(e)?.closest(".section-add"));
  if (addBtn) {
    // Ekran notatki i formularz należą do app.js
    document.dispatchEvent(
      new CustomEvent("newItemInSection", {
        detail: {
          ...newItemForSection(addBtn.dataset.addToSection ?? ""),
          section: addBtn.dataset.addToSection ?? "",
        },
      }),
    );
    return;
  }

  const header = /** @type {HTMLElement|null} */ (_target(e)?.closest(".section-header"));
  if (header?.dataset.section) {
    _toggleSection(header.dataset.section);
    return;
  }

  const item = /** @type {HTMLElement|null} */ (_target(e)?.closest(".note-item"));
  if (!item?.dataset.id) return;
  const id = item.dataset.id;

  if (_target(e)?.closest(".note-checkbox")) {
    // Wpis zmienia sekcję — fokus zostaje w miejscu listy (patrz _moveFocusOffId)
    _moveFocusOffId = id;
    toggleCompleted(id);
  } else if (_target(e)?.closest(".note-item__postpone")) {
    _moveFocusOffId = id;
    postponeToTomorrow(id);
  } else if (_target(e)?.closest(".note-item__delete")) {
    _deleteAndMoveFocus(id, item);
  } else {
    // Cały wiersz otwiera notatkę — wcześniej tylko tekst tytułu, więc klik
    // w wolne miejsce wiersza, termin albo tagi (kursor: pointer!) nic nie
    // robił. Duży cel kliknięcia = szybsza praca w biegu (prawo Fittsa).
    // Ikona podglądu też otwiera: jej rola to tooltip na hover, a martwy
    // punkt w środku klikalnego wiersza tylko myli.
    selectNote(id);
  }
});

// Nawigacja klawiaturowa po liście (elementy mają tabindex=0)
notesList.addEventListener("keydown", (e) => {
  const div = /** @type {HTMLElement|null} */ (_target(e)?.closest(".note-item"));
  if (!div?.dataset.id) return;
  const id = div.dataset.id;

  switch (e.key) {
    case "Enter":
      e.preventDefault();
      selectNote(id);
      setTimeout(() => titleInput.focus(), 50);
      break;

    case " ": {
      const note = state.notes.find((n) => n.id === id);
      if (note?.type === "task") {
        e.preventDefault();
        // Kolejna Spacja ma odhaczyć następne zadanie, a nie cofnąć to samo
        _moveFocusOffId = id;
        toggleCompleted(id);
      }
      break;
    }

    case "Delete":
      e.preventDefault();
      _deleteAndMoveFocus(id, div);
      break;

    case "ArrowDown": {
      e.preventDefault();
      let next = div.nextElementSibling;
      while (next && !next.classList.contains("note-item"))
        next = next.nextElementSibling;
      if (next) /** @type {HTMLElement} */ (next).focus();
      break;
    }

    case "ArrowUp": {
      e.preventDefault();
      let prev = div.previousElementSibling;
      while (prev && !prev.classList.contains("note-item"))
        prev = prev.previousElementSibling;
      if (prev) /** @type {HTMLElement} */ (prev).focus();
      // ↑ na pierwszym elemencie wraca do wyszukiwarki — domyka pętlę
      // wyszukiwarka ↓ lista ↑ wyszukiwarka (patrz app.js)
      else document.getElementById("search")?.focus();
      break;
    }

    // Skok na początek/koniec listy — standard nawigacji list w Firefoksie
    case "Home":
    case "End": {
      e.preventDefault();
      const items = notesList.querySelectorAll(".note-item");
      const target = e.key === "Home" ? items[0] : items[items.length - 1];
      /** @type {HTMLElement|null} */ (target)?.focus();
      break;
    }
  }
});

/** @param {string} raw */
export function quickCapture(raw) {
  const item = /** @type {Note|null} */ (
    buildItemFromCapture(raw)
  );
  if (!item) return null;

  // Tagi przed notatką: lista renderowana niżej musi już znać nowe. Nazwy to
  // jednorazowy seed (patrz buildItemFromCapture), nie pole notatki.
  const tagCountBefore = tagState.tags.length;
  item.tags = resolveTagNames(/** @type {any} */ (item).tagNames);
  delete (/** @type {any} */ (item).tagNames);
  if (tagState.tags.length !== tagCountBefore) {
    document.dispatchEvent(new CustomEvent("tagsChanged"));
  }

  state.notes.unshift(item);
  if (wantsFocusSeed(item)) {
    if (!state.focusIds.includes(item.id)) {
      state.focusIds.push(item.id);
    }
    saveFocusId(state.focusIds);
  }
  // Flaga focus z parsera to jednorazowy seed dla focusIds — nie zapisujemy
  // jej na notatce (jedno źródło prawdy; eksport materializuje ją z focusIds)
  delete item.focus;
  saveNotes(state.notes);

  if (isAlarmable(item)) {
    scheduleAlarm(item);
  }

  renderList();

  setTimeout(() => {
    const el = document.querySelector(
      `#notesList .note-item[data-id="${item.id}"]`,
    );
    if (el) {
      el.classList.add("note-item--flash");
      setTimeout(() => el.classList.remove("note-item--flash"), 800);
    }
  }, 30);
  return item;
}

/** @param {string} id */
export function toggleImportant(id) {
  const note = state.notes.find((n) => n.id === id);
  if (!note) return;
  note.important = !note.important;
  saveNotes(state.notes);
  renderList();
  updateDeleteState();
}

export function updateActiveFilters() {
  const bar = document.getElementById("active-filters");
  if (!bar) return;

  // Usuń tylko pille — zostaw label
  bar.querySelectorAll(".active-filter-pill").forEach((el) => el.remove());
  const pills = [];

  // Data
  if (state.filterDate) {
    const d = new Date(state.filterDate);
    const label = new Intl.DateTimeFormat(getUILocale(), {
      day: "numeric",
      month: "short",
    }).format(d);
    pills.push({
      label,
      onRemove: () => {
        state.filterDate = null;
        const inp = /** @type {HTMLInputElement|null} */ (document.getElementById("filter-date"));
        if (inp) inp.value = "";
        const clr = document.getElementById("filter-date-clear");
        if (clr) clr.hidden = true;
      },
    });
  }

  // Tagi
  state.filterTags.forEach((id) => {
    const tag = getTag(id);
    if (!tag) return;
    pills.push({
      label: tag.name,
      color: tag.color,
      onRemove: () => {
        const idx = state.filterTags.indexOf(id);
        if (idx !== -1) state.filterTags.splice(idx, 1);
        // Sync pill w filter-bar
        const pill = document.querySelector(`.tag-pill[data-tag-id="${id}"]`);
        if (pill) pill.classList.remove("tag-pill--filter-active");
      },
    });
  });

  // Ukryj zakończone
  if (state.filterHideCompleted) {
    pills.push({
      label: t("filter_hideCompleted_short"),
      onRemove: () => {
        state.filterHideCompleted = false;
        saveFilterPrefs({ hideCompleted: false });
        const cb = document.querySelector(
          '#filter-options input[type="checkbox"]',
        );
        if (cb) /** @type {HTMLInputElement} */ (cb).checked = false;
      },
    });
  }

  if (state.filterInProgress) {
    pills.push({
      label: t("filter_inProgress_short"),
      onRemove: () => {
        state.filterInProgress = false;
        renderList();
      },
    });
  }

  bar.hidden = pills.length === 0;

  pills.forEach((/** @type {{label:string,color?:any,onRemove:()=>void}} */ { label, color, onRemove }) => {
    const pill = document.createElement("span");
    pill.className = "active-filter-pill";
    if (color) {
      pill.style.setProperty("--tag-bg", color.bg);
      pill.style.setProperty("--tag-fg", color.fg);
      pill.classList.add("active-filter-pill--tag");
    }

    const text = document.createElement("span");
    text.textContent = label;

    const btn = document.createElement("button");
    btn.className = "active-filter-pill__remove";
    btn.textContent = "×";
    btn.setAttribute("aria-label", t("filter_remove_ariaLabel"));
    btn.onclick = () => {
      onRemove();
      renderList();
      updateActiveFilters();
      document.dispatchEvent(new CustomEvent("filterChanged"));
    };

    pill.appendChild(text);
    pill.appendChild(btn);
    bar.appendChild(pill);
  });
}
