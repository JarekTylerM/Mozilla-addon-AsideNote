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
import { debounce } from "./utils.js";
import { getTag, makeTagPill } from "./tags.js";
import { clearAlarm, scheduleAlarm, isAlarmable } from "./alarms.js";
import { t, getUILocale, getShortWeekdays } from "./i18n.js";
import { buildItemFromCapture, newNoteId } from "./quick-capture-core.js";
import { sanitizeHTML, validateText, MAX_TITLE_LEN } from "./sanitize.js";
import { setCursorOffset } from "./editor-selection.js";
import { updateDueDisplay } from "./date-picker.js";
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
 */

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

const SECTION_ORDER = [
  "overdue",
  "today",
  "tomorrow",
  "week",
  "month",
  "later",
  "unscheduled",
  "notes",
  "done",
];

/** @param {string} key */
function _sectionLabel(key) {
  return t(`section_${key}`);
}

/** @param {Note} note */
function _bucketFor(note) {
  if (note.type === "note") return "notes";
  if (note.completed) return "done";
  if (!note.due) return "unscheduled";

  const now = new Date();
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const dayMs = 86400000;
  const tomorrow = today + dayMs;

  // Niedziela tego tygodnia jako koniec
  const dayOfWeek = now.getDay() || 7;
  const endOfWeek = today + (7 - dayOfWeek + 1) * dayMs;
  const endOfMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
    23,
    59,
    59,
  ).getTime();

  if (note.due < today) return "overdue";
  if (note.due < tomorrow) return "today";
  if (note.due < tomorrow + dayMs) return "tomorrow";
  if (note.due < endOfWeek) return "week";
  if (note.due < endOfMonth) return "month";
  return "later";
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

/* Podglądy tekstowe notatki (etykieta listy, tooltip, title przycisku 👁).
   DOMParser zamiast detached div z innerHTML — nie tworzy żywych węzłów
   i nie zapala flag audytu na innerHTML bez sanityzacji.

   Jedno parsowanie, trzy przycięcia: wszystkie trzy podglądy to ten sam
   znormalizowany tekst, różnią się tylko długością. Wynik jest memoizowany
   po (id, content), bo renderList() przebudowuje listę przy każdym filtrze,
   toggle'u i zapisie, a treść zmienia się tylko dla notatki edytowanej.
   Cache trzyma przycięte stringi (≤160 znaków), nie pełny tekst notatki. */

/** @typedef {{ src: string, short: string, full: string, title: string }} PreviewParts */

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

  let text = "";
  if (src) {
    const doc = new DOMParser().parseFromString(src, "text/html");
    text = (doc.body.textContent || "").replace(/\s+/g, " ").trim();
  }
  const parts = {
    src,
    short: _clip(text, 30),
    full: _clip(text, 120),
    title: _clip(text, 160),
  };
  _previewCache.set(note.id, parts);
  return parts;
}

export function isNoteEmpty() {
  return titleInput.value.trim() === "" && editor.innerText.trim() === "";
}

/* ── State ops ────────────────────────────────── */

/** @param {string} value */
export function setDueDate(value) {
  if (!state.activeId) return;
  const note = state.notes.find((n) => n.id === state.activeId);
  if (!note || note.type !== "task") return;
  note.due = _fromDateInputValue(value);
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
  renderList();
}

/** @param {string} value */
export function setDueTime(value) {
  if (!state.activeId) return;
  const note = state.notes.find((n) => n.id === state.activeId);
  if (!note || note.type !== "task") return;
  note.time = value || null;
  saveNotes(state.notes);
  renderList();
}
/** @param {number|string} value */
export function setReminder(value) {
  if (!state.activeId) return;
  const note = state.notes.find((n) => n.id === state.activeId);
  if (!note || note.type !== "task") return;
  note.reminder = Number(value);
  saveNotes(state.notes);
}

/** @param {string|null} value @param {number[]|null} [days] */
export function setRecurrence(value, days = null) {
  if (!state.activeId) return;
  const note = state.notes.find((n) => n.id === state.activeId);
  if (!note || note.type !== "task") return;
  note.recurrence = value || null;
  note.recurrenceDays =
    value === "custom" && Array.isArray(days) && days.length > 0 ? days : null;
  saveNotes(state.notes);
  updateDeleteState();
}

/** @param {string} id */
export function selectNote(id) {
  const note = state.notes.find((n) => n.id === id);
  if (!note) return;
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

export function saveActiveNote() {
  if (!state.activeId && isNoteEmpty()) return;

  // Sanityzacja przy zapisie — dane w storage są zawsze czyste.
  // editor.innerHTML może zawierać artefakty z paste/undo; sanitizeHTML
  // przepuszcza tylko ALLOWED_TAGS z ALLOWED_ATTRS (patrz sanitize.js).
  // Dzięki temu selectNote może bezpiecznie assignować content do
  // editor.innerHTML bez dodatkowej sanityzacji przy odczycie.
  const cleanContent = sanitizeHTML(editor.innerHTML);

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
        due: null,
        time: null,
        reminder: 0,
      }),
    };
    state.notes.unshift(newNote);
    state.activeId = newNote.id;
    state.pendingType = "note";
    saveNotes(state.notes);
    renderList();
    return;
  }

  const note = state.notes.find((n) => n.id === state.activeId);
  if (!note) return;
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

  // Przenieś do kosza zamiast permanentnie usuwać
  const note = state.notes.find((n) => n.id === id);
  if (note) {
    const deleted = { ...note, deletedAt: Date.now() };
    state.deletedNotes = [deleted, ...state.deletedNotes].slice(0, MAX_DELETED);
    saveDeletedNotes(state.deletedNotes);
    // Sygnał dla toastu "Cofnij" (app.js) — usunięcie z listy i z edytora
    // przechodzi przez ten rdzeń, więc jeden punkt emisji wystarcza
    document.dispatchEvent(
      new CustomEvent("noteTrashed", {
        detail: { id, title: note.title || "" },
      }),
    );
  }

  state.notes = state.notes.filter((n) => n.id !== id);
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
  const idx = state.deletedNotes.findIndex((n) => n.id === id);
  if (idx === -1) return null;

  const { deletedAt, ...note } = state.deletedNotes[idx];

  state.notes.unshift(note);
  state.deletedNotes.splice(idx, 1);

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

  if (note.type === "note") {
    note.type = "task";
    if (note.completed === undefined) note.completed = false;
  } else {
    note.type = "note";
  }

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
        content: "",
        created: Date.now(),
        tags: [...(note.tags || [])],
        completed: false,
        due: _nextDueDate(note.due, note.recurrence, note.recurrenceDays),
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
  }

  saveNotes(state.notes);
  renderList();
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

export function updateNoteStatus() {
  const el = document.getElementById("note-status");
  if (!el) return;
  const note = state.activeId
    ? state.notes.find((n) => n.id === state.activeId)
    : null;
  const isTask = note ? note.type === "task" : state.pendingType === "task";
  if (!state.activeId && isNoteEmpty()) {
    el.innerHTML = "";
    return;
  }
  const title = titleInput.value.trim();
  const kindKey = isTask ? "noteStatus_kind_task" : "noteStatus_kind_note";
  const kindStr = t(kindKey);
  const _esc = (/** @type {string} */ s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  if (title) {
    el.innerHTML = `${_esc(t("noteStatus_editing", [kindStr]))}: <button type="button" class="note-status__title">\u00ab${_esc(title)}\u00bb</button>`;
  } else {
    el.innerHTML = `${_esc(t("noteStatus_editing", [kindStr]))}: <button type="button" class="note-status__title">\u00ab${_esc(t("noteStatus_noTitle"))}\u00bb</button> ${_esc(t("titleHint_short"))}`;
  }

  el.querySelector(".note-status__title")?.addEventListener("click", () => {
    document.getElementById("title")?.focus();
  });
}

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
  updateNoteStatus();
}

/* Przyciski akcji edytora: delete / convert / focus / important / collapse */
/** @param {Note|null} note */
function _syncEditorActionButtons(note) {
  const deleteBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById("delete"));
  if (deleteBtn) deleteBtn.disabled = !state.activeId || isNoteEmpty();

  const convertBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById("convert-type"));
  if (convertBtn) {
    convertBtn.disabled = false;
    const type = state.activeId
      ? (note?.type ?? "note")
      : (state.pendingType ?? "note");
    convertBtn.dataset.type = type;
    convertBtn.title = t(
      type === "note" ? "convertType_toTask_title" : "convertType_toNote_title",
    );
  }

  const focusBtn = document.getElementById("focus-btn");
  if (focusBtn) {
    const isFocusable =
      !!state.activeId && !(note?.type === "task" && note?.completed);
    focusBtn.hidden = !isFocusable;
    const inFocus = state.focusIds.includes(state.activeId ?? "");
    focusBtn.classList.toggle(
      "is-active",
      state.activeId !== null && inFocus,
    );
    focusBtn.title = t(inFocus ? "focus_remove_title" : "focus_title");
  }

  const importantBtn = document.getElementById("important-btn");
  if (importantBtn) {
    importantBtn.hidden = !state.activeId;
    importantBtn.classList.toggle("is-active", !!note?.important);
    importantBtn.title = t(
      note?.important ? "important_remove_title" : "important_title",
    );
  }

  const collapseBtn = document.getElementById("collapse-editor-btn");
  if (collapseBtn) {
    const listExpanded = document
      .getElementById("main-view")
      ?.classList.contains("list-expanded");
    collapseBtn.hidden = !!listExpanded;
  }
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
  if (dueInput && !state.activeId) dueInput.value = "";
  updateDueDisplay();

  const timeInput = /** @type {HTMLInputElement|null} */ (document.getElementById("due-time"));
  const alarmPill = document.getElementById("due-alarm-pill");
  const alarmLabel = document.getElementById("alarm-label");
  if (alarmPill) {
    const reminder = note?.reminder ?? 0;
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

  document.dispatchEvent(
    new CustomEvent("reminderChanged", {
      detail: { value: note?.reminder ?? 0 },
    }),
  );
}

/* Badge cykliczności przy dacie + event dla date-pickera */
/** @param {Note|null} note */
function _syncRecurrenceBadge(note) {
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

/* Podświetl ten przycisk ("notatkę" / "zadanie"), który pasuje do aktywnego filtra typu.
   Gdy filterType=='all' lub zenMode (filtruje task) — żaden nie podświetlony, lub task. */
function _updateNewItemHint() {
  const noteBtn = document.getElementById("new-note");
  const taskBtn = document.getElementById("new-task");
  if (!noteBtn || !taskBtn) return;

  // W zen mode filterType jest wymuszany na 'task' (patrz app.js handler type-toggle)
  const activeType = state.zenMode ? "task" : state.filterType;

  noteBtn.classList.toggle("is-active", activeType === "note");
  taskBtn.classList.toggle("is-active", activeType === "task");
}

/** @param {number} due @param {string} recurrence @param {number[]|null} [recurrenceDays] @returns {number} */
function _nextDueDate(due, recurrence, recurrenceDays = null) {
  const d = new Date(due);
  switch (recurrence) {
    case "daily":
      d.setDate(d.getDate() + 1);
      break;
    case "weekly":
      d.setDate(d.getDate() + 7);
      break;
    case "monthly":
      d.setMonth(d.getMonth() + 1);
      break;
    case "yearly":
      d.setFullYear(d.getFullYear() + 1);
      break;
    case "custom": {
      const days =
        recurrenceDays && recurrenceDays.length > 0
          ? recurrenceDays
          : [1, 2, 3, 4, 5]; // fallback: pn-pt
      // Znajdź następny dzień tygodnia z listy zaczynając od jutra
      for (let i = 1; i <= 7; i++) {
        d.setDate(d.getDate() + 1);
        if (days.includes(d.getDay())) break;
      }
      break;
    }
  }
  d.setHours(0, 0, 0, 0);
  return d.getTime();
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

export function renderList() {
  notesList.innerHTML = "";

  // Notatki usunięte w tej sesji zostawiają martwe wpisy w _previewCache.
  // Zamiast sprzątać przy każdej ścieżce usuwania — kasuj cache, gdy urośnie
  // ponad rozmiar zbioru. Najbliższy render odbuduje go leniwie.
  if (_previewCache.size > state.notes.length + 128) _previewCache.clear();

  // Klasy zen / main-view — ustawiaj zawsze, niezależnie od zawartości listy
  notesList.classList.toggle("zen-active", state.zenMode);
  document
    .getElementById("main-view")
    ?.classList.toggle("zen-mode", state.zenMode);

  // Hoist poza pętlę filtra — toLowerCase raz, a strip HTML z treści tylko
  // gdy faktycznie jest czego szukać (przy pustym q każda notatka pasuje).
  const q = state.searchQuery.toLowerCase();

  const filtered = state.notes.filter((note) => {
    const matchesSearch =
      !q ||
      (note.title || "").toLowerCase().includes(q) ||
      (note.content || "").replace(/<[^>]+>/g, "").toLowerCase().includes(q);
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
    const empty = document.createElement("div");
    empty.className = "notes-empty";
    empty.textContent = t("list_empty");
    notesList.appendChild(empty);
    updateDeleteState();
    _updateNewItemHint();
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
    empty.appendChild(clearBtn);
    notesList.appendChild(empty);
    updateDeleteState();
    _updateNewItemHint();
    return;
  }

  // Grupowanie w buckety
  /** @type {Record<string, Note[]>} */
  const buckets = {};
  filtered.forEach((note) => {
    const key = _bucketFor(note);
    (buckets[key] ||= []).push(note);
  });

  // Sortowanie wewnątrz sekcji
  Object.entries(buckets).forEach(([key, items]) => {
    if (key === "done") {
      items.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
    } else if (key === "notes") {
      items.sort((a, b) => b.created - a.created);
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
      _updateNewItemHint();
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
      _updateNewItemHint();
      return;
    }

    ["overdue", "today"].forEach((key) => {
      const items = buckets[key];
      if (items?.length) _renderSection(key, items);
    });

    updateDeleteState();
    _updateNewItemHint();
    return;
  }

  // ── Normalny widok ────────────────────────────
  SECTION_ORDER.forEach((key) => {
    const items = buckets[key];
    if (!items || items.length === 0) return;
    _renderSection(key, items);
  });

  updateDeleteState();
  _updateNewItemHint();
}

/** @param {string} key @param {Note[]} items */
function _renderSection(key, items) {
  const isCollapsed = state.collapsedSections.includes(key);

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
  header.dataset.section = key;
  // Czytniki ekranu muszą wiedzieć że nagłówek zwija/rozwija sekcję —
  // sam chevron tekstowy (▸/▾) tego nie komunikuje
  header.setAttribute("aria-expanded", String(!isCollapsed));

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
  meta.appendChild(chevron);
  header.appendChild(label);
  header.appendChild(meta);

  // Klik obsługiwany przez delegację na #notesList (data-section)
  notesList.appendChild(header);
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
  const previewFull = !titleText ? parts.full : null;
  const previewShort = !titleText ? parts.short : null;

  titleEl.textContent = titleText || previewShort || t("note_untitled");

  // Hover tooltip — pełny podgląd gdy tytuł pochodzi z treści
  if (!titleText && previewFull && previewFull !== previewShort) {
    titleEl.dataset.tooltipContent = previewFull;
  } else {
    delete titleEl.dataset.tooltipContent;
  }

  const previewBtn = /** @type {HTMLElement|null} */ (item.querySelector(".note-item__preview"));
  if (previewBtn) {
    previewBtn.title = parts.title || t("note_preview_empty");
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

  // Tytuł + przycisk podglądu — tekst i tooltipy wypełnia _applyItemLabel
  // (wspólne z aktualizacją in-place przy autosave)
  const title = document.createElement("span");
  title.className = "note-item__title";

  const titleWrapper = document.createElement("div");
  titleWrapper.className = "note-item__title-wrap";
  titleWrapper.appendChild(title);

  const previewBtn = document.createElement("button");
  previewBtn.className = "note-item__preview icon--preview";
  previewBtn.setAttribute("aria-label", t("note_preview_ariaLabel"));
  titleWrapper.appendChild(previewBtn);
  div.appendChild(titleWrapper);
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
    div.appendChild(row);
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
  const header = /** @type {HTMLElement|null} */ (_target(e)?.closest(".section-header"));
  if (header?.dataset.section) {
    _toggleSection(header.dataset.section);
    return;
  }

  const item = /** @type {HTMLElement|null} */ (_target(e)?.closest(".note-item"));
  if (!item?.dataset.id) return;
  const id = item.dataset.id;

  if (_target(e)?.closest(".note-checkbox")) {
    toggleCompleted(id);
  } else if (_target(e)?.closest(".note-item__postpone")) {
    postponeToTomorrow(id);
  } else if (_target(e)?.closest(".note-item__delete")) {
    _deleteAndMoveFocus(id, item);
  } else if (_target(e)?.closest(".note-item__preview")) {
    // tylko hover tooltip — klik nie robi nic
  } else if (_target(e)?.closest(".note-item__title")) {
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
  const item = /** @type {Note|null} */ (buildItemFromCapture(raw));
  if (!item) return null;

  state.notes.unshift(item);
  if ((item.important || item.focus) && item.type === "task") {
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
