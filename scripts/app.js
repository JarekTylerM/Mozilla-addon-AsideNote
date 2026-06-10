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
  loadDeletedNotes,
} from "./storage.js";

import {
  state,
  renderList,
  selectNote,
  saveActiveNote,
  deleteActiveNote,
  updateDeleteState,
  debouncedSave,
  convertType,
  updateNoteStatus,
  setDueDate,
  setDueTime,
  setReminder,
  toggleFocus,
  quickCapture,
  toggleImportant,
  clearFilters,
  updateActiveFilters,
  setRecurrence,
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
import {
  applyStaticTranslations,
  t,
  relativeDayLabel,
  getUILocale,
} from "./i18n.js";
import { parseCapture } from "./parser.js";
import { initTooltips } from "./tooltip.js";
import {
  initDatePicker,
  syncDatePicker,
  syncRecurrence,
  syncReminder,
  updateDueDisplay,
} from "./date-picker.js";
import { validateText, MAX_TITLE_LEN, isValidId } from "./sanitize.js";
import * as undo from "./undo.js";
import { initOnboarding, initOnboardingPanel } from "./onboarding.js";

/* ── DOM refs ────────────────────────────────── */

const titleInput = document.getElementById("title");
const searchInput = document.getElementById("search");
const editor = document.getElementById("editor");
const quickCaptureInput = document.getElementById("quick-capture");

/* ── Boot ────────────────────────────────────── */

applyStaticTranslations();
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
    state.focusIds = focusId;
    state.deletedNotes = deletedNotes;

    rescheduleAll(state.notes);
    initUiSettings(uiSettings);
    renderList();
    document.getElementById('main-view')?.classList.add('is-ready');
    updateStorageUsage();
    renderTagSelector();

    // Security button — pokaż/ukryj zależnie od uiSettings
    const secWrapper = document.getElementById("security-btn-wrapper");
    const secToggle = document.getElementById("security-acknowledge-toggle");
    if (secWrapper)
      secWrapper.hidden = uiSettings.securityAcknowledged ?? false;
    if (secToggle) secToggle.checked = uiSettings.securityAcknowledged ?? false;
    _initSecurityBtn();
    _initFocusModeBtn(uiSettings.focusMode ?? false);
    initOnboarding(uiSettings);
    initOnboardingPanel();

    // Przebuduj listę przy zmianie motywu — tagi mają warianty dark/light
    document.addEventListener("themeChanged", () => renderList());
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", () => renderList());
    _initListExpand(uiSettings.listExpanded ?? false);
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

// Komunikacja z popup — odśwież listę gdy popup dodał element.
// Weryfikacja sender.id: akceptujemy wyłącznie wiadomości z własnych stron
// rozszerzenia. Bez tego dowolne inne zainstalowane rozszerzenie mogłoby
// wymusić przeładowanie listy przez browser.runtime.sendMessage(naszId, msg).
browser.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id !== browser.runtime.id) return;
  if (msg.action === "noteAdded") {
    loadNotes().then((notes) => {
      state.notes = notes;
      renderList();
    });
  }
});

initEditor();
initTagSelector();
initAddTagForm();
initFilter();
initDataActions();
initDatePicker();

document.addEventListener("recurrenceFromPicker", (e) => {
  setRecurrence(e.detail.value || null, e.detail.days ?? null);
});
document.addEventListener("reminderChanged", (e) => {
  syncReminder(e.detail.value);
});

document.addEventListener("reminderFromPicker", (e) => {
  setReminder(e.detail.value);
  _rescheduleActive();
  updateDeleteState();
});

/* ── + Notatka / + Zadanie (puste formularze) ──── */

function _resetForm(type) {
  const mainView = document.getElementById("main-view");
  if (mainView?.classList.contains("list-expanded")) {
    _setListExpanded(false, document.getElementById("list-expand-btn"));
    saveUiSettings({ listExpanded: false });
  }
  state.activeId = null;
  state.pendingType = type;
  titleInput.value = "";
  editor.innerHTML = "";
  undo.reset("");
  updateDeleteState();
  renderTagSelector();
  renderList();
  titleInput.focus();
  _updateTitleHint();
}

document.getElementById("new-note").onclick = () => _resetForm("note");
document.getElementById("new-task").onclick = () => _resetForm("task");

function _collapseEditor() {
  const prevId = state.activeId;
  // Zapisz synchronicznie przed wyczyszczeniem — debounce (600ms) mógł
  // nie zdążyć odpalić gdy user szybko kliknie collapse po ostatnim znaku
  saveActiveNote();
  debouncedSave.cancel?.();
  state.activeId = null;
  state.pendingType = null;
  titleInput.value = "";
  editor.innerHTML = "";
  undo.reset("");
  updateDeleteState();
  renderList();

  const expandBtn = document.getElementById("list-expand-btn");
  if (document.body.classList.contains("is-focus-mode")) {
    const focusModeBtn = document.getElementById("focusmode-btn");
    _setFocusMode(false, focusModeBtn);
    saveUiSettings({ focusMode: false });
  }
  _setListExpanded(true, expandBtn);
  saveUiSettings({ listExpanded: true });

  // Przywróć fokus na element z którego wyszliśmy
  if (prevId) {
    const el = document.querySelector(
      `#notesList .note-item[data-id="${prevId}"]`,
    );
    if (el) el.focus();
  }
}

document
  .getElementById("collapse-editor-btn")
  ?.addEventListener("click", _collapseEditor);

/* ── Edytor: tytuł — autosave + status live + walidacja długości ──── */

// Element komunikatu walidacji pod polem tytułu — musi istnieć w sidebar.html
// (#title-error). Pojawia się gdy user przekroczy MAX_TITLE_LEN znaków.
const titleError = document.getElementById("title-error");
const titleHint = document.getElementById("title-hint");

function _updateTitleHint() {
  updateNoteStatus();
}

titleInput.addEventListener("input", () => {
  _updateTitleHint();
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
  updateNoteStatus();
});

/* ── Edytor: convert / important / focus / delete  */

document.getElementById("convert-type").onclick = () =>
  convertType(state.activeId);

document.getElementById("important-btn").onclick = () => {
  if (state.activeId) toggleImportant(state.activeId);
};

document.getElementById("focus-btn").onclick = () => {
  if (!state.activeId) saveActiveNote();
  if (state.activeId) toggleFocus(state.activeId);
};

document.addEventListener("focusChanged", () => updateDeleteState());

document.getElementById("delete").onclick = () => {
  if (state.activeId) clearAlarm(state.activeId);
  deleteActiveNote();
  renderTagSelector();
};

/* ── Edytor: due date / time / reminder / clear ─ */

function _rescheduleActive() {
  if (!state.activeId) return;
  const note = state.notes.find((n) => n.id === state.activeId);
  if (!note) return;
  clearAlarm(note.id);
  scheduleAlarm(note);
}

document.getElementById("due-date").addEventListener("change", (e) => {
  syncDatePicker(e.target.value || null);
  setDueDate(e.target.value);
  _rescheduleActive();
});

document.getElementById("due-time").addEventListener("change", (e) => {
  setDueTime(e.target.value);
  _rescheduleActive();
  updateDeleteState();
});

//   setReminder(e.target.value);
//   _rescheduleActive();
// });

document.getElementById("due-clear").onclick = () => {
  if (!state.activeId) return;
  const note = state.notes.find((n) => n.id === state.activeId);
  if (!note) return;

  note.due = null;
  note.time = null;
  note.reminder = 0;

  document.getElementById("due-date").value = "";
  document.getElementById("due-time").value = "";
  syncDatePicker(null);
  syncRecurrence(null);
  setReminder(0);
  updateDueDisplay();
  clearAlarm(note.id);
  saveNotes(state.notes);
  renderList();
};

/* ── Wyszukiwanie + type toggle ────────────────── */

const searchClear = document.getElementById("search-clear");

searchInput.addEventListener("input", (e) => {
  state.searchQuery = e.target.value;
  renderList();
  if (searchClear) searchClear.hidden = !e.target.value;
});

searchClear?.addEventListener("click", () => {
  searchInput.value = "";
  state.searchQuery = "";
  renderList();
  searchClear.hidden = true;
  searchInput.focus();
});

let _preZenToolbarState = null;

// ── Type filter buttons (all / note / task) ───────────────────────
const TYPE_ICONS = {
  all: "icon--type-all",
  note: "icon--type-note",
  task: "icon--type-task",
};
const typeToggleBtn = document.getElementById("type-toggle-btn");
const typeToggleRow = document.getElementById("type-toggle");

function _updateTypeToggleBtn() {
  if (!typeToggleBtn) return;
  typeToggleBtn.classList.remove(...Object.values(TYPE_ICONS));
  typeToggleBtn.classList.add(TYPE_ICONS[state.filterType] ?? TYPE_ICONS.all);
}

typeToggleBtn?.addEventListener("click", () => {
  const isVisible = typeToggleRow && !typeToggleRow.hidden;
  if (typeToggleRow) typeToggleRow.hidden = isVisible;
  typeToggleBtn.setAttribute("aria-expanded", String(!isVisible));
});

document.querySelectorAll("#type-toggle .type-toggle__btn").forEach((btn) => {
  btn.onclick = () => {
    state.zenMode = false;
    state.filterType = btn.dataset.type;

    document.querySelectorAll("#type-toggle .type-toggle__btn").forEach((b) => {
      b.classList.toggle("type-toggle__btn--active", b === btn);
    });

    _updateTypeToggleBtn();
    renderList();
  };
});

// ── Zen btn (przeniesiony z type-toggle do search-row) ────────────
document.getElementById("zen-btn")?.addEventListener("click", () => {
  state.zenMode = !state.zenMode;
  saveUiSettings({ zenMode: state.zenMode });
  const toolbarToggle = document.getElementById("toolbar-toggle");
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
      document.getElementById("toolbar").hidden = !_preZenToolbarState;
    }
    _preZenToolbarState = null;
  }
  document
    .getElementById("zen-btn")
    ?.classList.toggle("is-active", state.zenMode);
  renderList();
});

/* ── Filter date ───────────────────────────────── */

const filterDateInput = document.getElementById("filter-date");
const filterDateClear = document.getElementById("filter-date-clear");
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
  const val = e.target.value;
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

const _qcPreview = document.getElementById("quick-capture-preview");

function _updateQcPreview(raw) {
  if (!raw.trim()) {
    _qcPreview.hidden = true;
    return;
  }

  const { isTask, title, due, time } = parseCapture(raw);

  let text = "";

  if (!isTask) {
    // Notatka
    text = title
      ? t("quickCapture_preview_note_titled", [title])
      : t("quickCapture_preview_note_empty");
  } else {
    // Zadanie — zbuduj kontekst daty
    let dateCtx = "";
    if (due) {
      const rel = relativeDayLabel(due);
      const dateStr =
        rel ??
        new Intl.DateTimeFormat(getUILocale(), {
          day: "numeric",
          month: "short",
        }).format(new Date(due));
      dateCtx = time
        ? t("quickCapture_preview_date_time", [dateStr, time])
        : dateStr;
    }

    if (dateCtx && title) {
      text = t("quickCapture_preview_task_dated_titled", [dateCtx, title]);
    } else if (dateCtx) {
      text = t("quickCapture_preview_task_dated", [dateCtx]);
    } else if (title) {
      text = t("quickCapture_preview_task_titled", [title]);
    } else {
      text = t("quickCapture_preview_task_empty");
    }
  }

  _qcPreview.textContent = text;
  _qcPreview.hidden = false;
  _qcPreview.dataset.type = isTask ? "task" : "note";
}

quickCaptureInput.addEventListener("input", (e) => {
  _updateQcPreview(e.target.value);
});

quickCaptureInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape" || e.key === "Enter") {
    _qcPreview.hidden = true;
  }
});

/* ── Quick capture ─────────────────────────────── */

quickCaptureInput.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const val = e.target.value.trim();
  if (!val) return;
  const item = quickCapture(val);
  e.target.value = "";
  if (e.shiftKey && item) {
    selectNote(item.id);
    titleInput.focus();
  }
});

/* ── Panel personalizacji ──────────────────────── */

document.getElementById("panel-btn").onclick = () => {
  togglePanel();
  if (!document.getElementById("panel").hidden) {
    switchPanelTab("general");
  }
};
document.getElementById("close-panel").onclick = closePanel;

/* ── Tooltip skrótów ───────────────────────────── */

const toggleShortcutsBtn = document.getElementById("toggle-shortcuts");
const shortcutTooltip = document.getElementById("shortcut-tooltip");

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

export function switchPanelTab(id) {
  _PANEL_TABS.forEach(({ id: tid, tab, pane }) => {
    if (!tab || !pane) return;
    const active = tid === id;
    tab.classList.toggle("panel-tab--active", active);
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
document.querySelectorAll(".shortcuts-subtab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document
      .querySelectorAll(".shortcuts-subtab")
      .forEach((b) =>
        b.classList.toggle("shortcuts-subtab--active", b === btn),
      );
    const tab = btn.dataset.shortcutsTab;
    document.getElementById("shortcuts-pane-general").hidden =
      tab !== "general";
    document.getElementById("shortcuts-pane-editor").hidden = tab !== "editor";
  });
});

/* ── Tag selector się odświeża po wyborze ──────── */

editor.addEventListener("input", _updateTitleHint);

document.addEventListener("noteSelected", () => {
  const mainView = document.getElementById("main-view");
  if (mainView?.classList.contains("list-expanded")) {
    const btn = document.getElementById("list-expand-btn");
    _setListExpanded(false, btn);
    saveUiSettings({ listExpanded: false });
    // Po zmianie list-expanded odśwież stan przycisków — collapse-editor-btn
    // musi wiedzieć że lista już nie jest rozszerzona
    updateDeleteState();
  }
  renderTagSelector();
  _updateTitleHint();
});

document.addEventListener("forceSave", () => {
  saveActiveNote();
});

/* ── Globalne skróty klawiszowe ────────────────── */

document.addEventListener("keydown", (e) => {
  const active = document.activeElement;
  const inEditor = active?.id === "editor" || active?.id === "title";
  const inCapture = active?.id === "quick-capture";

  // Alt+C — fokus quick capture
  if (e.altKey && e.key === "c") {
    e.preventDefault();
    quickCaptureInput.focus();
    quickCaptureInput.select();
    return;
  }

  // Alt+T — quick capture z prefiksem ! (od razu zadanie)
  if (e.altKey && e.key === "t") {
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
  if (e.altKey && e.key === "s") {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
    return;
  }

  // Alt+F — toggle filter bar + fokus na pierwszy element
  if (e.altKey && e.key === "f") {
    e.preventDefault();
    document.getElementById("filter-btn").click();
    const filterBar = document.getElementById("filter-bar");
    if (!filterBar.hidden) {
      // Fokus na pierwszy interaktywny element w filter bar
      setTimeout(() => {
        const first = filterBar.querySelector('input, button, [tabindex="0"]');
        if (first) first.focus();
      }, 0);
    }
    return;
  }

  // Alt+P — toggle panel personalizacji
  if (e.altKey && e.key === "p") {
    e.preventDefault();
    togglePanel();
    return;
  }

  // Alt+M — toggle tryb skupienia (focus mode)
  if (e.altKey && e.key?.toLowerCase() === "m") {
    e.preventDefault();
    document.getElementById("focusmode-btn")?.click();
    return;
  }

  // Alt+L — toggle list expand
  if (e.altKey && e.key?.toLowerCase() === "l") {
    e.preventDefault();
    document.getElementById("list-expand-btn")?.click();
    return;
  }

  // Esc — zwiń edytor gdy aktywny (tylko gdy focus NIE jest w edytorze)
  if (
    e.key === "Escape" &&
    !e.altKey &&
    (state.activeId || state.pendingType) &&
    !editor.contains(document.activeElement) &&
    document.activeElement !== titleInput
  ) {
    _collapseEditor();
    return;
  }

  // Alt+Z — toggle zen mode
  if (e.altKey && e.key?.toLowerCase() === "z") {
    e.preventDefault();
    document;
    document.getElementById("zen-btn")?.click();
    return;
  }

  // Alt+E — toggle toolbar edytora (działa też w zen mode)
  if (e.altKey && e.key?.toLowerCase() === "e") {
    e.preventDefault();
    const toggle = document.getElementById("toolbar-toggle");
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
  const ackToggle = document.getElementById("security-acknowledge-toggle");
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

function _initFocusModeBtn(initialFocusMode = false) {
  const btn = document.getElementById("focusmode-btn");
  if (!btn) return;

  // Przywróć stan z poprzedniej sesji — tylko gdy jest aktywna notatka.
  // Przy ponownym otwarciu sidebara state.activeId jest null (świeży start)
  // więc focus mode bez notatki dałby pusty fullscreen.
  if (initialFocusMode && state.activeId) {
    _setFocusMode(true, btn);
  } else if (initialFocusMode && !state.activeId) {
    // Wyczyść zapisany stan — nie ma co do czego wracać
    saveUiSettings({ focusMode: false });
  }

  btn.addEventListener("click", () => {
    const next = !document.body.classList.contains("is-focus-mode");
    _setFocusMode(next, btn);
    saveUiSettings({ focusMode: next });
  });
}

function _setFocusMode(active, btn) {
  document.body.classList.toggle("is-focus-mode", active);
  btn.classList.toggle("icon--focusmode-enter", !active);
  btn.classList.toggle("icon--focusmode-exit", active);
  btn.title = t(active ? "focusMode_exit_title" : "focusMode_enter_title");
  btn.setAttribute(
    "aria-label",
    t(active ? "focusMode_exit_ariaLabel" : "focusMode_enter_ariaLabel"),
  );
  const backBtn = document.getElementById("back-btn");
  if (backBtn) backBtn.hidden = !active;
}

function _initListExpand(initial = false) {
  const btn = document.getElementById("list-expand-btn");
  if (!btn) return;
  _setListExpanded(initial, btn);
  btn.addEventListener("click", () => {
    const next = !document
      .getElementById("main-view")
      ?.classList.contains("list-expanded");
    _setListExpanded(next, btn);
    saveUiSettings({ listExpanded: next });
  });
}

function _setListExpanded(active, btn) {
  document
    .getElementById("main-view")
    ?.classList.toggle("list-expanded", active);
  btn.classList.toggle("icon--list-expand", !active);
  btn.classList.toggle("icon--list-collapse", active);
  btn.setAttribute(
    "data-i18n-attr",
    active
      ? "aria-label:listCollapse_title;title:listCollapse_title"
      : "aria-label:listExpand_title;title:listExpand_title",
  );
  btn.title = t(active ? "listCollapse_title" : "listExpand_title");
  btn.setAttribute(
    "aria-label",
    t(active ? "listCollapse_title" : "listExpand_title"),
  );
}

const backBtn = document.getElementById("back-btn");
if (backBtn) {
  backBtn.addEventListener("click", () => {
    const focusModeBtn = document.getElementById("focusmode-btn");
    if (document.body.classList.contains("is-focus-mode")) {
      _setFocusMode(false, focusModeBtn);
      saveUiSettings({ focusMode: false });
    }
  });
}
