// @ts-check
/* ══════════════════════════════════════════════════════════════
   app.js — entry point, boot, top-level event listeners
   ══════════════════════════════════════════════════════════════ */

import {
  loadNotes,
  loadTags,
  loadCollapsedSections,
  loadFilterPrefs,
  loadFocusId,
  loadUiSettings,
  saveUiSettings,
  saveNotes,
  saveFocusId,
  loadDeletedNotes,
  pruneCursorSettings,
  consumeSelfWrite,
  retryPendingWrites,
  loadTempOverInstalled,
} from "./storage.js";
import { debounce } from "./utils.js";

import {
  state,
  renderList,
  selectNote,
  saveActiveNote,
  discardEmptyActiveNote,
  deleteActiveNote,
  updateDeleteState,
  debouncedSave,
  convertType,
  toggleCompleted,
  resetPendingMeta,
  setDueDate,
  setDueTime,
  setReminder,
  toggleFocus,
  quickCapture,
  toggleImportant,
  clearFilters,
  updateActiveFilters,
  setRecurrence,
  restoreDeletedNote,
  isNoteEmpty,
} from "./notes.js";

import { tagState } from "./tags.js";
import { initEditor } from "./editor.js";
import {
  openPanel,
  closePanel,
  initTagSelector,
  initAddTagForm,
  initFilter,
  renderTagSelector,
  initDataActions,
  togglePanel,
  initUiSettings,
  updateStorageUsage,
} from "./panel.js";
import { scheduleAlarm, clearAlarm, rescheduleAll } from "./alarms.js";
import { applyStaticTranslations, t, getUILocale } from "./i18n.js";
import { describeCapture } from "./quick-capture-preview.js";
import { renderQuickCaptureHelp } from "./quick-capture-help.js";
import { initTooltips } from "./tooltip.js";
import {
  initDatePicker,
  syncDatePicker,
  syncRecurrence,
  syncReminder,
  updateDueDisplay,
} from "./date-picker.js";
import {
  validateText,
  MAX_TITLE_LEN,
  MAX_CONTENT_LEN,
  isValidId,
} from "./sanitize.js";
import * as undo from "./undo.js";
import { initOnboarding, initOnboardingPanel } from "./onboarding.js";
import { initNoteMenu } from "./note-menu.js";
import { applyBuildFlavor } from "./build-flavor.js";

applyBuildFlavor();

/* ── DOM refs ────────────────────────────────── */

// Elementy sidebara są zawsze w sidebar.html — rzutujemy z pominięciem null.
const titleInput = /** @type {HTMLInputElement} */ (document.getElementById("title"));
const searchInput = /** @type {HTMLInputElement} */ (document.getElementById("search"));
const editor = /** @type {HTMLElement} */ (document.getElementById("editor"));
const quickCaptureInput = /** @type {HTMLInputElement} */ (document.getElementById("quick-capture"));
/** @param {string} id @returns {HTMLElement} */
const _byId = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** @param {Event} e — wartość inputu który wywołał zdarzenie */
const _val = (e) => /** @type {HTMLInputElement} */ (e.target).value;
/** @param {Event} e @returns {any} — detail z CustomEvent */
const _detail = (e) => /** @type {CustomEvent} */ (e).detail;

/* ── Boot ────────────────────────────────────── */

applyStaticTranslations();
// Wiersze składni quick capture nie mają data-i18n (są generowane), więc
// renderujemy je z własnym t() — kolejność względem applyStaticTranslations
// jest bez znaczenia.
renderQuickCaptureHelp(
  /** @type {HTMLElement} */ (document.getElementById("qc-help-syntax")),
  t,
);
// initTooltips musi być po applyStaticTranslations — i18n ustawia title,
// a tooltip.js przenosi je do data-tooltip-content i usuwa natywne title.
initTooltips();

Promise.all([
  loadNotes(),
  loadTags(),
  loadCollapsedSections(),
  loadFilterPrefs(),
  loadFocusId(),
  loadUiSettings(),
  loadDeletedNotes(),
]).then(
  ([notes, tags, collapsed, prefs, focusId, uiSettings, deletedNotes]) => {
    state.notes = notes;
    tagState.tags = tags;
    state.collapsedSections = collapsed;
    state.filterHideCompleted = prefs.hideCompleted ?? false;
    state.deletedNotes = deletedNotes;

    // focusIds: odfiltruj wpisy wskazujące nieistniejące notatki
    // (pozostałość po usunięciach/imporcie w innej sesji)
    const validIds = new Set(notes.map((n) => n.id));
    state.focusIds = focusId.filter((id) => validIds.has(id));
    if (state.focusIds.length !== focusId.length) {
      saveFocusId(state.focusIds);
    }

    // Usuń osierocone pozycje kursora (cursor_<id> notatek które nie istnieją)
    // — bez tego uiSettings rośnie z każdą kiedykolwiek otwartą notatką.
    pruneCursorSettings([...notes, ...deletedNotes].map((n) => n.id));

    rescheduleAll(state.notes);
    initUiSettings(uiSettings);
    renderList();
    document.getElementById("main-view")?.classList.add("is-ready");
    updateStorageUsage();
    renderTagSelector();

    // Security button — pokaż/ukryj zależnie od uiSettings
    const secWrapper = document.getElementById("security-btn-wrapper");
    const secToggle = /** @type {HTMLInputElement|null} */ (document.getElementById("security-acknowledge-toggle"));
    if (secWrapper)
      secWrapper.hidden = uiSettings.securityAcknowledged ?? false;
    if (secToggle) secToggle.checked = uiSettings.securityAcknowledged ?? false;
    _initSecurityBtn();
    initOnboarding(uiSettings);
    initOnboardingPanel();

    // Przebuduj listę przy zmianie motywu — tagi mają warianty dark/light
    document.addEventListener("themeChanged", () => renderList());
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", () => renderList());
    // Start zawsze od ekranu listy — przy świeżym otwarciu sidebara nic nie
    // jest otwarte. Dawne uiSettings.listExpanded / focusMode opisywały
    // układy, których już nie ma (patrz "Dwa ekrany" niżej) — nie są czytane.
    _showListScreen();
    _setTypeToggleHidden(uiSettings.typeToggleHidden ?? false);
    if (uiSettings.zenMode) {
      state.zenMode = true;
      document.getElementById("zen-btn")?.classList.add("is-active");
      document.getElementById("main-view")?.classList.add("no-transition");
      renderList();
      requestAnimationFrame(() => {
        document.getElementById("main-view")?.classList.remove("no-transition");
      });
    }

    // Sprawdź czy popup zostawił pending select (Shift+Enter).
    // Walidacja isValidId: chroni przed wstrzyknięciem dowolnego stringa
    // przez ręczną manipulację storage (devtools). selectNote i tak by nic
    // nie zrobiło dla nieistniejącego ID, ale lepiej odrzucić wcześniej.
    browser.storage.local.get("_pendingSelectId").then((res) => {
      if (res._pendingSelectId) {
        browser.storage.local.remove("_pendingSelectId");
        if (isValidId(res._pendingSelectId)) {
          selectNote(res._pendingSelectId);
        }
      }
    });
  },
);

/* ── Synchronizacja między kontekstami (okna / popup) ─────────────
   Sidebar jest per-okno — każde okno trzyma własny stan w pamięci i
   zapisuje CAŁĄ tablicę notes. Bez nasłuchu na storage.onChanged edycja
   w dwóch oknach kończy się nadpisaniem zmian drugiego okna (wygrywa
   ostatni zapis). Zapisy własne odfiltrowuje consumeSelfWrite()
   (znaczniki per-klucz w storage.js).

   Reload NIE dotyka edytora ani pola tytułu — trwająca edycja aktywnej
   notatki nie może zostać nadpisana; jej treść trafi do storage przy
   najbliższym debouncedSave. Okno kolizji zawęża się z "cały zbiór
   danych" do "jedna notatka edytowana równolegle w dwóch oknach". */

const SYNCED_KEYS = ["notes", "tags", "focusId", "deletedNotes"];

async function _reloadStateFromStorage() {
  const [notes, tags, focusId, deletedNotes] = await Promise.all([
    loadNotes(),
    loadTags(),
    loadFocusId(),
    loadDeletedNotes(),
  ]);
  state.notes = notes;
  tagState.tags = tags;
  state.focusIds = focusId;
  state.deletedNotes = deletedNotes;
  renderList();
  renderTagSelector();
  updateDeleteState();
}

// Debounce: jedna operacja w drugim oknie to zwykle kilka zapisów pod rząd
// (notes + focusId + deletedNotes) — scal je w jeden reload.
const _debouncedExternalReload = debounce(_reloadStateFromStorage, 150);

const _tempBuildBanner = document.getElementById("temp-build-banner");

function _syncTempBuildBanner() {
  loadTempOverInstalled()
    .then((active) => {
      if (_tempBuildBanner) _tempBuildBanner.hidden = !active;
    })
    .catch(() => {});
}
_syncTempBuildBanner();

browser.storage.onChanged.addListener((changes, area) => {
  // Znacznik może przyjść już po starcie panelu: background dostaje
  // onInstalled równolegle z otwieraniem sidebara
  if (area === "session") {
    _syncTempBuildBanner();
    return;
  }
  if (area !== "local") return;

  // Live select — popup (Shift+Enter) lub kliknięcie powiadomienia zapisuje
  // _pendingSelectId gdy sidebar jest już otwarty. Boot-owy odczyt tego
  // klucza obsługuje tylko zimny start; tu reagujemy na żywo.
  const pending = changes._pendingSelectId?.newValue;
  if (typeof pending === "string" && isValidId(pending)) {
    browser.storage.local.remove("_pendingSelectId");
    // Notatka mogła zostać dodana w tym samym batchu zapisów — najpierw
    // świeży stan, potem select
    _debouncedExternalReload.cancel?.();
    _reloadStateFromStorage().then(() => selectNote(pending));
    return;
  }

  // filter (nie some) — znacznik self-write KAŻDEGO zmienionego klucza musi
  // zostać skonsumowany, inaczej zalega i maskuje przyszłe zewnętrzne zmiany
  const externalKeys = SYNCED_KEYS.filter(
    (key) => key in changes && !consumeSelfWrite(key),
  );
  if (externalKeys.length > 0) _debouncedExternalReload();
});

initEditor();
initTagSelector();
initAddTagForm();
initFilter();
initDataActions();
initDatePicker();

document.addEventListener("recurrenceFromPicker", (e) => {
  setRecurrence(_detail(e).value || null, _detail(e).days ?? null);
});
document.addEventListener("reminderChanged", (e) => {
  syncReminder(_detail(e).value);
});

document.addEventListener("reminderFromPicker", (e) => {
  setReminder(_detail(e).value);
  _rescheduleActive();
  updateDeleteState();
});

/* ── + Notatka / + Zadanie (puste formularze) ──── */

/* ── Dwa ekrany: lista ↔ notatka ──────────────────
   Panel ma dokładnie dwa układy, zawsze jeden z nich:
     • lista   — #main-view.list-expanded: szybkie dodawanie, szukanie,
                 lista na pełną wysokość; edytor schowany
     • notatka — body.is-editing: edytor na pełną wysokość z ← w nagłówku;
                 szybkie dodawanie, szukanie i lista schowane
   Wcześniej był też widok pośredni (lista ~30% + edytor pod nią) i osobny
   "tryb skupienia" — w panelu szerokim na ~400px oba były za ciasne i
   wymagały pamiętania, w którym z trzech stanów się jest. */

const _backBtn = /** @type {HTMLElement|null} */ (document.getElementById("back-btn"));

function _showListScreen() {
  document.body.classList.remove("is-editing");
  document.getElementById("main-view")?.classList.add("list-expanded");
  if (_backBtn) _backBtn.hidden = true;
}

function _showEditorScreen() {
  document.getElementById("main-view")?.classList.remove("list-expanded");
  document.body.classList.add("is-editing");
  if (_backBtn) _backBtn.hidden = false;
}

const _isEditorScreen = () => document.body.classList.contains("is-editing");

/** @param {'note'|'task'} type @param {number|null} [due] */
function _resetForm(type, due = null) {
  _showEditorScreen();
  // "Nowa notatka" porzuca bieżącą — jeśli była pusta, nie ma po co zostawać
  discardEmptyActiveNote();
  state.activeId = null;
  state.pendingType = type;
  resetPendingMeta(due);
  titleInput.value = "";
  editor.innerHTML = "";
  undo.reset("");
  /** @type {HTMLInputElement} */ (_byId("due-time")).value = "";
  updateDeleteState();
  syncDatePicker(/** @type {HTMLInputElement} */ (_byId("due-date")).value || null);
  renderTagSelector();
  renderList();
  titleInput.focus();
}

// "+" w nagłówku sekcji listy: typ i termin pasujące do tej sekcji
document.addEventListener("newItemInSection", (e) => {
  const { type, due } = _detail(e);
  _resetForm(type, due);
});

function _collapseEditor() {
  const prevId = state.activeId;
  // Kolejność: najpierw sprzątanie, potem zapis. Odwrotnie zapisalibyśmy
  // pustą notatkę tylko po to, żeby ją zaraz usunąć.
  discardEmptyActiveNote();
  // Zapisz synchronicznie przed wyczyszczeniem — debounce (600ms) mógł
  // nie zdążyć odpalić gdy user szybko kliknie collapse po ostatnim znaku
  saveActiveNote();
  debouncedSave.cancel?.();
  state.activeId = null;
  state.pendingType = null;
  resetPendingMeta();
  titleInput.value = "";
  editor.innerHTML = "";
  undo.reset("");
  updateDeleteState();
  renderList();
  _showListScreen();

  // Przywróć fokus na element z którego wyszliśmy
  const el = prevId
    ? /** @type {HTMLElement|null} */ (
        document.querySelector(`#notesList .note-item[data-id="${prevId}"]`)
      )
    : null;
  if (el) el.focus();
  // Porzucony pusty wpis nie ma wiersza — fokus zostałby w schowanym polu
  // tytułu/edytora, gdzie pisanie trafiałoby w niewidoczny formularz
  else if (document.activeElement instanceof HTMLElement &&
           document.activeElement.closest("#main-view") &&
           document.activeElement.getClientRects().length === 0) {
    document.activeElement.blur();
  }
}

// ← w nagłówku notatki — to samo co Esc
_backBtn?.addEventListener("click", _collapseEditor);

// Ctrl+↑/↓ w edytorze (editor.js) wskazuje sąsiedni element listy. Lista
// jest na ekranie notatki schowana, więc zamiast fokusu na niewidocznym
// wierszu otwieramy sąsiednią notatkę od razu — przeglądanie bez powrotu.
document.addEventListener("openAdjacentNote", (e) => {
  const id = _detail(e)?.id;
  if (!id || id === state.activeId) return;
  selectNote(id);
  editor.focus();
});

/* ── Edytor: tytuł — autosave + walidacja długości ──── */

// Element komunikatu walidacji pod polem tytułu — musi istnieć w sidebar.html
// (#title-error). Pojawia się gdy user przekroczy MAX_TITLE_LEN znaków.
const titleError = /** @type {HTMLElement} */ (document.getElementById("title-error"));

titleInput.addEventListener("input", () => {
  // Live walidacja długości — pokaż komunikat zanim user kliknie poza pole.
  // Sanityzacja control chars i twarde przycięcie do limitu dzieje się
  // w notes.js::saveActiveNote — tu tylko sygnał dla usera.
  if (titleError) {
    if (titleInput.value.length > MAX_TITLE_LEN) {
      titleError.textContent = t("validation_titleTooLong", [
        String(MAX_TITLE_LEN),
      ]);
      titleError.hidden = false;
    } else {
      titleError.hidden = true;
    }
  }

  debouncedSave();
});

/* ── Edytor: limit długości treści ────────────────────────────────
   Twarde przycięcie robi notes.js::saveActiveNote (jedno miejsce, jak
   przy tytule) i stamtąd leci to zdarzenie. Tutaj tylko komunikat —
   bez niego notatka traciłaby końcówkę bez słowa. */

const contentError = /** @type {HTMLElement|null} */ (
  document.getElementById("content-error")
);

document.addEventListener("noteContentTruncated", () => {
  if (!contentError) return;
  contentError.textContent = t("validation_contentTooLong", [
    String(Math.floor(MAX_CONTENT_LEN / 1000)),
  ]);
  contentError.hidden = false;
});

// Komunikat znika, gdy treść wróci pod limit albo przy zmianie notatki
editor.addEventListener("input", () => {
  if (contentError && !contentError.hidden && editor.innerHTML.length <= MAX_CONTENT_LEN) {
    contentError.hidden = true;
  }
});
document.addEventListener("noteSelected", () => {
  if (contentError) contentError.hidden = true;
});

/* ── Nagłówek notatki: checkbox, symbole, menu ⋮ ─ */

initNoteMenu(_byId("note-menu-btn"), _byId("note-menu"));

// Ikony przypięte do nagłówka przekazują klik pozycji menu — stąd jedna
// logika niezależnie od tego, gdzie użytkownik trzyma dane działanie.
document.querySelectorAll("[data-note-pin]").forEach((el) => {
  const pin = /** @type {HTMLElement} */ (el);
  pin.addEventListener("click", () => {
    _byId(pin.dataset.notePin ?? "").click();
  });
});

_byId("convert-type").onclick = () =>
  convertType(state.activeId);

const _toggleActiveImportant = () => {
  if (state.activeId) toggleImportant(state.activeId);
};

const _toggleActiveFocus = () => {
  if (!state.activeId) saveActiveNote();
  if (state.activeId) toggleFocus(state.activeId);
};

_byId("important-btn").onclick = _toggleActiveImportant;
_byId("focus-btn").onclick = _toggleActiveFocus;

// Symbol znika razem ze stanem, który zdejmuje. Fokus idzie do tytułu, żeby
// nie przepadł z chowanym przyciskiem przy pracy z klawiatury.
_byId("status-important").onclick = () => {
  _toggleActiveImportant();
  titleInput.focus();
};
_byId("status-focus").onclick = () => {
  _toggleActiveFocus();
  titleInput.focus();
};

_byId("note-complete").onclick = () => {
  if (!state.activeId) return;
  // Następna instancja zadania cyklicznego kopiuje tytuł, a ostatnie
  // wpisane znaki mogą jeszcze czekać w debounce autozapisu.
  saveActiveNote();
  toggleCompleted(state.activeId);
};

document.addEventListener("focusChanged", () => updateDeleteState());

_byId("delete").onclick = () => {
  if (state.activeId) clearAlarm(state.activeId);
  deleteActiveNote();
  renderTagSelector();
  _expandListIfIdle();
};

/* Po usunięciu otwartej notatki ekran notatki byłby pustą formą — wracamy
   na listę. "Bezczynny" = brak otwartej notatki i pusty formularz.
   pendingType się do tego nie nadaje: w spoczynku ma wartość "note". */
function _expandListIfIdle() {
  if (state.activeId || !isNoteEmpty()) return;
  _showListScreen();
  updateDeleteState();
}

/* ── Edytor: due date / time / reminder / clear ─ */

function _rescheduleActive() {
  if (!state.activeId) return;
  const note = state.notes.find((n) => n.id === state.activeId);
  if (!note) return;
  clearAlarm(note.id);
  scheduleAlarm(note);
}

_byId("due-date").addEventListener("change", (e) => {
  syncDatePicker(_val(e) || null);
  setDueDate(_val(e));
  _rescheduleActive();
});

_byId("due-time").addEventListener("change", (e) => {
  setDueTime(_val(e));
  _rescheduleActive();
  updateDeleteState();
});

_byId("due-clear").onclick = () => {
  if (!state.activeId) {
    // Zadanie jeszcze nie powstało, więc czyścimy tylko to, co ma w nim wylądować
    resetPendingMeta();
    /** @type {HTMLInputElement} */ (_byId("due-time")).value = "";
    syncDatePicker(null);
    syncRecurrence(null);
    updateDeleteState();
    return;
  }
  const note = state.notes.find((n) => n.id === state.activeId);
  if (!note) return;

  note.due = null;
  note.time = null;
  note.reminder = 0;

  /** @type {HTMLInputElement} */ (document.getElementById("due-date")).value = "";
  /** @type {HTMLInputElement} */ (document.getElementById("due-time")).value = "";
  syncDatePicker(null);
  syncRecurrence(null);
  setReminder(0);
  updateDueDisplay();
  clearAlarm(note.id);
  saveNotes(state.notes);
  renderList();
};

/* ── Wyszukiwanie + type toggle ────────────────── */

const searchClear = /** @type {HTMLElement} */ (document.getElementById("search-clear"));

// Debounce renderu — renderList() przebudowuje całą listę; przy szybkim
// pisaniu w wyszukiwarce nie ma sensu renderować każdego znaku.
// Stan i przycisk czyszczenia aktualizują się natychmiast.
const _debouncedSearchRender = debounce(renderList, 150);

searchInput.addEventListener("input", (e) => {
  state.searchQuery = _val(e);
  if (searchClear) searchClear.hidden = !_val(e);
  _debouncedSearchRender();
});

/* Wyszukiwarka ↔ lista bez myszy: ↓ przechodzi do pierwszego wyniku,
   Enter otwiera pierwszy wynik, Esc czyści zapytanie (drugi Esc działa jak
   dotąd — zamyka edytor). Pętla "Alt+S → wpisz → Enter" to najszybsza
   droga do notatki w biegu. */
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || (e.key === "Enter" && !e.isComposing)) {
    // Debounce renderu mógł jeszcze nie odpalić — lista musi już odpowiadać
    // temu, co jest w polu, zanim wybierzemy "pierwszy wynik"
    _debouncedSearchRender.flush();
    const first = /** @type {HTMLElement|null} */ (
      document.querySelector("#notesList .note-item")
    );
    if (!first?.dataset.id) return;
    e.preventDefault();
    if (e.key === "ArrowDown") {
      first.focus();
    } else {
      selectNote(first.dataset.id);
      setTimeout(() => titleInput.focus(), 50);
    }
    return;
  }
  if (e.key === "Escape" && searchInput.value) {
    e.preventDefault();
    // Nie przepuszczaj do globalnego Esc — ten zamknąłby otwartą notatkę
    e.stopPropagation();
    _debouncedSearchRender.cancel();
    searchInput.value = "";
    state.searchQuery = "";
    if (searchClear) searchClear.hidden = true;
    renderList();
  }
});

searchClear?.addEventListener("click", () => {
  searchInput.value = "";
  state.searchQuery = "";
  renderList();
  searchClear.hidden = true;
  searchInput.focus();
});

/** @type {boolean|null} */
let _preZenToolbarState = null;

// ── Type filter buttons (all / note / task) ───────────────────────
const TYPE_ICONS = {
  all: "icon--type-all",
  note: "icon--type-note",
  task: "icon--type-task",
};
const typeToggleBtn = /** @type {HTMLElement} */ (document.getElementById("type-toggle-btn"));
const typeToggleRow = /** @type {HTMLElement} */ (document.getElementById("type-toggle"));

function _updateTypeToggleBtn() {
  if (!typeToggleBtn) return;
  typeToggleBtn.classList.remove(...Object.values(TYPE_ICONS));
  typeToggleBtn.classList.add(TYPE_ICONS[state.filterType] ?? TYPE_ICONS.all);
}

/** @param {boolean} hidden */
function _setTypeToggleHidden(hidden) {
  if (typeToggleRow) typeToggleRow.hidden = hidden;
  typeToggleBtn?.setAttribute("aria-expanded", String(!hidden));
}

// Ukrycie wiersza Wszystko/Notatki/Zadania jest zapamiętywane — kto raz go
// schował, żeby odzyskać miejsce na listę, nie musi robić tego przy każdym
// otwarciu sidebara. Ikona przycisku nadal pokazuje aktywny filtr typu.
typeToggleBtn?.addEventListener("click", () => {
  const hide = !!typeToggleRow && !typeToggleRow.hidden;
  _setTypeToggleHidden(hide);
  saveUiSettings({ typeToggleHidden: hide });
});

document.querySelectorAll("#type-toggle .type-toggle__btn").forEach((el) => {
  const btn = /** @type {HTMLElement} */ (el);
  btn.onclick = () => {
    state.zenMode = false;
    state.filterType = /** @type {'all'|'note'|'task'} */ (btn.dataset.type ?? 'all');

    document.querySelectorAll("#type-toggle .type-toggle__btn").forEach((b) => {
      b.classList.toggle("is-active", b === btn);
    });

    _updateTypeToggleBtn();
    renderList();
  };
});

// ── Zen btn (przeniesiony z type-toggle do search-row) ────────────
document.getElementById("zen-btn")?.addEventListener("click", () => {
  state.zenMode = !state.zenMode;
  saveUiSettings({ zenMode: state.zenMode });
  const toolbarToggle = /** @type {HTMLInputElement|null} */ (document.getElementById("toolbar-toggle"));
  if (state.zenMode) {
    _preZenToolbarState = toolbarToggle?.checked ?? true;
    if (toolbarToggle?.checked) {
      toolbarToggle.checked = false;
      toolbarToggle.dispatchEvent(new Event("change"));
    }
  } else {
    if (toolbarToggle && _preZenToolbarState !== null) {
      toolbarToggle.checked = _preZenToolbarState;
      toolbarToggle.dispatchEvent(new Event("change"));
      _byId("toolbar").hidden = !_preZenToolbarState;
    }
    _preZenToolbarState = null;
  }
  document
    .getElementById("zen-btn")
    ?.classList.toggle("is-active", state.zenMode);
  renderList();
});

/* ── Filter date ───────────────────────────────── */

const filterDateInput = /** @type {HTMLInputElement} */ (document.getElementById("filter-date"));
const filterDateClear = /** @type {HTMLElement} */ (document.getElementById("filter-date-clear"));
function _updateFilterClearBtn() {
  const btn = document.getElementById("filter-clear-btn");
  if (!btn) return;
  const hasFilters =
    state.filterTags.length > 0 ||
    state.filterHideCompleted ||
    !!state.filterDate;
  btn.hidden = !hasFilters;
}

document.getElementById("filter-clear-btn")?.addEventListener("click", () => {
  clearFilters();
  if (filterDateInput) filterDateInput.value = "";
  if (filterDateClear) filterDateClear.hidden = true;
  _updateFilterClearBtn();
  updateActiveFilters();
});

filterDateInput?.addEventListener("change", (e) => {
  const val = _val(e);
  if (val) {
    const [y, m, d] = val.split("-").map(Number);
    state.filterDate = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
    filterDateClear.hidden = false;
  } else {
    state.filterDate = null;
    filterDateClear.hidden = true;
  }
  renderList();
  _updateFilterClearBtn();
  updateActiveFilters();
});

filterDateClear?.addEventListener("click", () => {
  filterDateInput.value = "";
  state.filterDate = null;
  filterDateClear.hidden = true;
  renderList();
  _updateFilterClearBtn();
  updateActiveFilters();
});

document.addEventListener("filterChanged", () => {
  _updateFilterClearBtn();
  updateActiveFilters();
});

/* ── Quick capture preview ─────────────────────── */

const _qcPreview = /** @type {HTMLElement} */ (document.getElementById("quick-capture-preview"));

/** @param {string} raw */
function _updateQcPreview(raw) {
  const description = describeCapture(raw, {
    t,
    locale: getUILocale(),
    tags: tagState.tags,
  });

  if (!description) {
    _hideQcPreview();
    return;
  }

  _qcPreview.textContent = description.text;
  _qcPreview.hidden = false;
  _qcPreview.dataset.type = description.type;
}

// Czyścimy tekst, nie tylko chowamy — kontener jest aria-live, a sam
// atrybut hidden nie gwarantuje, że czytnik nie odczyta starej treści
// przy kolejnym pokazaniu.
function _hideQcPreview() {
  _qcPreview.hidden = true;
  _qcPreview.textContent = "";
}

quickCaptureInput.addEventListener("input", (e) => {
  _updateQcPreview(_val(e));
});

quickCaptureInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape" || e.key === "Enter") {
    _hideQcPreview();
  }
});

/* ── Quick capture ─────────────────────────────── */

quickCaptureInput.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const val = _val(e).trim();
  if (!val) return;
  const item = /** @type {Note|null} */ (quickCapture(val));
  // Bez tytułu nic nie powstało (np. samo "#praca"), więc tekst zostaje w polu
  // razem z podglądem, zamiast zniknąć bez śladu
  if (!item) {
    _updateQcPreview(val);
    return;
  }
  quickCaptureInput.value = "";
  if (e.shiftKey) {
    selectNote(item.id);
    titleInput.focus();
  }
});

/* ── Panel personalizacji ──────────────────────── */

_byId("panel-btn").onclick = () => {
  shortcutTooltip.classList.remove("show");
  toggleShortcutsBtn.setAttribute("aria-expanded", "false");
  togglePanel();
  if (!_byId("panel").hidden) {
    switchPanelTab("general");
  }
};
_byId("close-panel").onclick = closePanel;

/* ── Tooltip skrótów ───────────────────────────── */

const toggleShortcutsBtn = /** @type {HTMLElement} */ (document.getElementById("toggle-shortcuts"));
const shortcutTooltip = /** @type {HTMLElement} */ (document.getElementById("shortcut-tooltip"));

toggleShortcutsBtn?.addEventListener("click", () => {
  const panel = document.getElementById("panel");
  if (panel && !panel.hidden) {
    // Panel otwarty — przełącz na zakładkę skrótów zamiast pokazywać modal
    switchPanelTab("shortcuts");
    return;
  }
  const isOpen = shortcutTooltip.classList.toggle("show");
  toggleShortcutsBtn.setAttribute("aria-expanded", String(isOpen));
});

// ── Panel tabs ──────────────────────────────────

const _PANEL_TABS = [
  {
    id: "general",
    tab: document.getElementById("panel-tab-general"),
    pane: document.getElementById("panel-pane-general"),
  },
  {
    id: "tags",
    tab: document.getElementById("panel-tab-tags"),
    pane: document.getElementById("panel-pane-tags"),
  },
  {
    id: "shortcuts",
    tab: document.getElementById("panel-tab-shortcuts"),
    pane: document.getElementById("panel-pane-shortcuts"),
  },
];

/** @param {string} id */
export function switchPanelTab(id) {
  _PANEL_TABS.forEach(({ id: tid, tab, pane }) => {
    if (!tab || !pane) return;
    const active = tid === id;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
    pane.classList.toggle("panel-pane--hidden", !active);
  });
}

_PANEL_TABS.forEach(({ id, tab }) => {
  tab?.addEventListener("click", () => switchPanelTab(id));
});

// ── Tooltip "Wszystkie skróty" button ───────────

document
  .getElementById("tooltip-all-shortcuts-btn")
  ?.addEventListener("click", () => {
    const toggleBtn = document.getElementById("toggle-shortcuts");
    const tooltip = document.getElementById("shortcut-tooltip");
    if (toggleBtn && tooltip && tooltip.classList.contains("show")) {
      toggleBtn.click();
    }
    if (document.getElementById("panel")?.hidden !== false) {
      togglePanel();
    }
    switchPanelTab("shortcuts");
  });

// Sub-taby w zakładce skrótów
document.querySelectorAll(".shortcuts-subtab").forEach((el) => {
  const btn = /** @type {HTMLElement} */ (el);
  btn.addEventListener("click", () => {
    document
      .querySelectorAll(".shortcuts-subtab")
      .forEach((b) => b.classList.toggle("is-active", b === btn));
    const tab = btn.dataset.shortcutsTab;
    _byId("shortcuts-pane-general").hidden = tab !== "general";
    _byId("shortcuts-pane-editor").hidden = tab !== "editor";
  });
});

/* ── Tag selector się odświeża po wyborze ──────── */

// Otwarcie notatki (klik, Enter, Shift+Enter w capture, popup) = ekran notatki
document.addEventListener("noteSelected", () => {
  _showEditorScreen();
  renderTagSelector();
});

document.addEventListener("forceSave", () => {
  saveActiveNote();
});

/* ── Odporność zapisu ──────────────────────────────
   Baner błędu: storage.js emituje storage:save-error gdy
   browser.storage.local.set się nie powiedzie (quota, IO) — bez tego
   użytkownik traciłby zmiany bez żadnego sygnału. save-ok (udany zapis
   lub retry) chowa baner. */

const _saveErrorBanner = /** @type {HTMLElement} */ (document.getElementById("save-error-banner"));

document.addEventListener("storage:save-error", () => {
  if (_saveErrorBanner) _saveErrorBanner.hidden = false;
});
document.addEventListener("storage:save-ok", () => {
  if (_saveErrorBanner) _saveErrorBanner.hidden = true;
});
document.getElementById("save-error-retry")?.addEventListener("click", () => {
  retryPendingWrites();
});

/* Zamknięcie sidebara (np. Alt+Shift+Q) może ubiec debounce autosave'u
   (600 ms) — flush dopisuje oczekujące zmiany zanim dokument zniknie.
   visibilitychange łapie dodatkowo throttling timerów ukrytej karty.
   flush() jest no-opem gdy nic nie czeka — zero zbędnych zapisów. */
window.addEventListener("pagehide", () => debouncedSave.flush());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") debouncedSave.flush();
});

/* ── Toast "Przeniesiono do kosza" + Cofnij ────────
   Usunięcie z listy (✕ / Delete) i z edytora jest natychmiastowe, bez
   potwierdzenia — kosz istnieje, ale jest schowany w panelu. Toast daje
   widoczną ścieżkę odwrotu bez modalnego "czy na pewno?". */

const _undoToast = /** @type {HTMLElement} */ (document.getElementById("undo-toast"));
const _undoToastText = _undoToast?.querySelector(".undo-toast__text");
/** @type {ReturnType<typeof setTimeout>|null} */
let _undoToastTimer = null;
/** @type {string|null} */
let _undoToastNoteId = null;

function _hideUndoToast() {
  clearTimeout(_undoToastTimer ?? undefined);
  _undoToastTimer = null;
  _undoToastNoteId = null;
  if (_undoToast) _undoToast.hidden = true;
}

/** @param {number} ms */
function _armUndoToastTimer(ms) {
  clearTimeout(_undoToastTimer ?? undefined);
  _undoToastTimer = setTimeout(_hideUndoToast, ms);
}

document.addEventListener("noteTrashed", (e) => {
  if (!_undoToast || !_undoToastText) return;
  _undoToastNoteId = _detail(e).id;
  const title = (_detail(e).title || "").trim();
  const short = title.length > 24 ? title.slice(0, 24) + "…" : title;
  _undoToastText.textContent = short
    ? `${t("toast_trashed")} «${short}»`
    : t("toast_trashed");
  _undoToast.hidden = false;
  _armUndoToastTimer(5000);
});

// Hover/fokus wstrzymuje auto-hide — użytkownik klawiatury potrzebuje
// czasu na dotarcie Tabem do przycisku Cofnij
_undoToast?.addEventListener("mouseenter", () => clearTimeout(_undoToastTimer ?? undefined));
_undoToast?.addEventListener("focusin", () => clearTimeout(_undoToastTimer ?? undefined));
_undoToast?.addEventListener("mouseleave", () => _armUndoToastTimer(2500));
_undoToast?.addEventListener("focusout", () => _armUndoToastTimer(2500));

document.getElementById("undo-toast-btn")?.addEventListener("click", () => {
  const id = _undoToastNoteId;
  _hideUndoToast();
  if (!id) return;
  const note = /** @type {Note|null} */ (restoreDeletedNote(id));
  // Fokus na przywrócony element — kontynuacja nawigacji z miejsca akcji
  if (note) {
    /** @type {HTMLElement|null} */ (
      document.querySelector(`#notesList .note-item[data-id="${note.id}"]`)
    )?.focus();
  }
});

/* ── Globalne skróty klawiszowe ────────────────── */

document.addEventListener("keydown", (e) => {
  const active = document.activeElement;
  const inEditor = active?.id === "editor" || active?.id === "title";
  const inCapture = active?.id === "quick-capture";

  // e.key?.toLowerCase() we wszystkich skrótach Alt — bez tego skróty
  // przestają działać z włączonym CapsLockiem (e.key = "C" zamiast "c")
  //
  // Wyłącznie "goły" Alt+litera:
  // - bez Shift — Alt+Shift+S to komenda manifestu (popup szybkiego
  //   dodawania). Firefox najpierw daje zdarzenie panelowi; nasz
  //   preventDefault dla "s" zjadał ją i przy fokusie w sidebarze zamiast
  //   popupu otwierała się wyszukiwarka.
  // - bez Ctrl/AltGr — na polskiej klawiaturze AltGr = Ctrl+Alt; AltGr+F/T/
  //   P/K nie dają znaku, więc e.key to zwykła litera i skrót odpalał się
  //   w trakcie pisania (np. AltGr+K kopiował notatkę jako Markdown).
  const plainAlt =
    e.altKey &&
    !e.shiftKey &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.getModifierState?.("AltGraph");
  const altKey = plainAlt ? e.key?.toLowerCase() : null;

  // Skróty prowadzące do elementów ekranu listy działają też z ekranu
  // notatki — najpierw zamykają notatkę (autosave), inaczej fokus trafiałby
  // w schowane pole i skrót nic by nie robił.
  if (altKey && ["c", "t", "s", "f", "l"].includes(altKey) && _isEditorScreen()) {
    _collapseEditor();
    // Alt+L: _collapseEditor już ustawił fokus na wierszu, z którego
    // przyszliśmy — dokładnie tam, gdzie Alt+L ma prowadzić
    if (altKey === "l") {
      e.preventDefault();
      return;
    }
  }

  // Alt+C — fokus quick capture
  if (altKey === "c") {
    e.preventDefault();
    quickCaptureInput.focus();
    quickCaptureInput.select();
    return;
  }

  // Alt+T — quick capture z prefiksem ! (od razu zadanie)
  if (altKey === "t") {
    e.preventDefault();
    quickCaptureInput.focus();
    if (!quickCaptureInput.value.startsWith("!")) quickCaptureInput.value = "!";
    quickCaptureInput.setSelectionRange(
      quickCaptureInput.value.length,
      quickCaptureInput.value.length,
    );
    return;
  }

  // Alt+S — fokus na wyszukiwarkę
  if (altKey === "s") {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
    return;
  }

  // Alt+F — toggle filter bar + fokus na pierwszy element
  if (altKey === "f") {
    e.preventDefault();
    _byId("filter-btn").click();
    const filterBar = _byId("filter-bar");
    if (!filterBar.hidden) {
      // Fokus na pierwszy interaktywny element w filter bar
      setTimeout(() => {
        const first = /** @type {HTMLElement|null} */ (filterBar.querySelector('input, button, [tabindex="0"]'));
        if (first) first.focus();
      }, 0);
    }
    return;
  }

  // Alt+L — fokus na listę notatek (aktywna pozycja lub pierwsza);
  // domyka pętlę capture → lista → edytor bez myszy
  if (altKey === "l") {
    e.preventDefault();
    const target = /** @type {HTMLElement|null} */ (
      document.querySelector("#notesList .note-item.is-active") ||
      document.querySelector("#notesList .note-item")
    );
    target?.focus();
    return;
  }

  // Alt+P — toggle panel personalizacji
  if (altKey === "p") {
    e.preventDefault();
    togglePanel();
    return;
  }

  // Alt+K — kopiuj treść notatki jako Markdown
  if (altKey === "k") {
    e.preventDefault();
    document.getElementById("copy-md-btn")?.click();
    return;
  }

  // Alt+I / Alt+W / Ctrl+Enter — stan otwartej notatki. Pozycje menu i checkbox
  // same mówią, czy akcja jest teraz dostępna: hidden lub disabled = nie ma
  // czego przełączyć (np. "w trakcie" w ukończonym zadaniu).
  const headerAction =
    altKey === "i"
      ? "important-btn"
      : altKey === "w"
        ? "focus-btn"
        : e.ctrlKey && !e.altKey && e.key === "Enter"
          ? "note-complete"
          : null;
  if (headerAction && _isEditorScreen()) {
    e.preventDefault();
    const btn = /** @type {HTMLButtonElement} */ (_byId(headerAction));
    if (!btn.hidden && !btn.disabled) btn.click();
    return;
  }

  // Esc — wróć na listę z ekranu notatki (gdy fokus NIE jest w edytorze;
  // ten przypadek obsługuje gałąź "Escape — z edytora/tytułu" niżej).
  // Warunkiem jest ekran, nie stan: pendingType w spoczynku to "note",
  // więc dawne (activeId || pendingType) było prawdziwe także na liście.
  if (
    e.key === "Escape" &&
    !e.altKey &&
    _isEditorScreen() &&
    !editor.contains(document.activeElement) &&
    document.activeElement !== titleInput
  ) {
    _collapseEditor();
    return;
  }

  // Alt+Z — toggle zen mode
  if (altKey === "z") {
    e.preventDefault();
    document.getElementById("zen-btn")?.click();
    return;
  }

  // Alt+E — toggle toolbar edytora (działa też w zen mode)
  if (altKey === "e") {
    e.preventDefault();
    const toggle = /** @type {HTMLInputElement|null} */ (document.getElementById("toolbar-toggle"));
    const toolbar = document.getElementById("toolbar");
    if (toggle && toolbar) {
      toggle.checked = !toggle.checked;
      toolbar.hidden = !toggle.checked;
      // Zapisz preferencję przez event — nie blokuje jeśli handler nie odpali
      toggle.dispatchEvent(new Event("change"));
      if (state.zenMode) _preZenToolbarState = toggle.checked;
    }
    return;
  }

  // Escape — z edytora/tytułu
  if (e.key === "Escape" && inEditor) {
    const slashMenu = document.getElementById("slash-menu");
    const linkModal = document.getElementById("link-modal");
    const slashOpen = slashMenu && !slashMenu.hidden;
    const linkOpen = linkModal && !linkModal.hidden;
    // Slash menu lub link modal otwarte — zatrzymaj event, niech ich handler zamknie
    if (slashOpen || linkOpen) {
      return;
    }
    e.preventDefault();
    _collapseEditor();
    return;
  }

  // Escape — z quick capture wyczyść pole
  if (e.key === "Escape" && inCapture) {
    quickCaptureInput.value = "";
    quickCaptureInput.blur();
  }
});
/* ── Security button ────────────────────────── */

function _initSecurityBtn() {
  const btn = document.getElementById("security-btn");
  const tip = document.getElementById("security-tooltip");
  const gotoBtn = document.getElementById("security-tooltip-goto");
  const ackToggle = /** @type {HTMLInputElement|null} */ (document.getElementById("security-acknowledge-toggle"));
  const wrapper = document.getElementById("security-btn-wrapper");

  if (!btn || !tip) return;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    tip.hidden = !tip.hidden;
  });

  document.addEventListener("click", () => {
    if (tip) tip.hidden = true;
  });

  gotoBtn?.addEventListener("click", () => {
    tip.hidden = true;
    if (document.getElementById("panel")?.hidden !== false) togglePanel();
    switchPanelTab("general");
    setTimeout(() => {
      ackToggle
        ?.closest(".panel-toggle")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);
  });

  ackToggle?.addEventListener("change", () => {
    const acknowledged = ackToggle.checked;
    if (wrapper) wrapper.hidden = acknowledged;
    saveUiSettings({ securityAcknowledged: acknowledged });
  });
}

// clear tag after delete note or task from flist
document.addEventListener("noteDeleted", () => {
  renderTagSelector();
  _expandListIfIdle();
});
