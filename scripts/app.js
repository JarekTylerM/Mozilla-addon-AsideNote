/* ══════════════════════════════════════════════════════════════
   app.js — entry point, boot, top-level event listeners
   ══════════════════════════════════════════════════════════════ */

import {
  loadNotes,
  loadTags,
  loadCollapsedSections,
  loadFilterPrefs,
} from "./storage.js";

import {
  state,
  renderList,
  deleteActiveNote,
  updateDeleteState,
  updateNoteStatus,
  debouncedSave,
  convertType,
  setDueDate,
  quickCapture,
  toggleImportant,
  setDueTime,
  setReminder,
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
} from "./panel.js";

const titleInput = document.getElementById("title");
const searchInput = document.getElementById("search");
const editor = document.getElementById("editor");

/* ── Boot ─────────────────────────────────────── */

Promise.all([
  loadNotes(),
  loadTags(),
  loadCollapsedSections(),
  loadFilterPrefs(),
]).then(([notes, tags, collapsed, prefs]) => {
  state.notes = notes;
  tagState.tags = tags;
  state.collapsedSections = collapsed;
  state.filterHideCompleted = prefs.hideCompleted ?? false;
  renderList();
  renderTagSelector();
});

initEditor();
initTagSelector();
initAddTagForm();
initFilter();
initDataActions();

/* ── + Notatka / + Zadanie ────────────────────── */

function _resetForm(type) {
  state.activeId = null;
  state.pendingType = type;
  titleInput.value = "";
  editor.innerHTML = "";
  updateDeleteState();
  renderTagSelector();
  titleInput.focus();
}

document.getElementById("new-note").onclick = () => _resetForm("note");
document.getElementById("new-task").onclick = () => _resetForm("task");

/* ── Tytuł — autosave + status live ───────────── */

titleInput.addEventListener("input", () => {
  debouncedSave();
  updateNoteStatus();
});

/* ── Usuwanie notatki ─────────────────────────── */

document.getElementById("delete").onclick = () => {
  if (state.activeId) clearAlarm(state.activeId);
  deleteActiveNote();
  renderTagSelector();
};

/* ── Wyszukiwanie ─────────────────────────────── */

searchInput.addEventListener("input", (e) => {
  state.searchQuery = e.target.value;
  renderList();
});

/* ── Type toggle (Wszystko/Notatki/Zadania) ───── */

document.querySelectorAll("#type-toggle .type-toggle__btn").forEach((btn) => {
  btn.onclick = () => {
    const type = btn.dataset.type;

    if (type === "zen") {
      state.zenMode = !state.zenMode;
      if (state.zenMode) state.filterType = "task";
    } else {
      state.zenMode = false;
      state.filterType = type;
    }

    document
      .querySelectorAll("#type-toggle .type-toggle__btn")
      .forEach((b) =>
        b.classList.toggle(
          "type-toggle__btn--active",
          type === "zen"
            ? b.dataset.type === "zen" && state.zenMode
            : b === btn,
        ),
      );

    renderList();
  };
});

/* ── Convert type ─────────────────────────────── */

document.getElementById("convert-type").onclick = () =>
  convertType(state.activeId);

/* ── Due date ─────────────────────────────────── */

document.getElementById("due-date").addEventListener("change", (e) => {
  setDueDate(e.target.value);
});

/* ── Tag selector się odświeża po wyborze ─────── */

document.addEventListener("noteSelected", () => renderTagSelector());

/* ── Panel personalizacji ─────────────────────── */

document.getElementById("panel-btn").onclick = openPanel;
document.getElementById("close-panel").onclick = closePanel;

/* ── Tooltip skrótów ──────────────────────────── */

const toggleBtn = document.getElementById("toggle-shortcuts");
const tooltip = document.getElementById("shortcut-tooltip");

toggleBtn?.addEventListener("click", () => {
  const isOpen = tooltip.classList.toggle("show");
  toggleBtn.setAttribute("aria-expanded", String(isOpen));
});

document.getElementById("quick-capture").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const val = e.target.value.trim();
  if (!val) return;
  quickCapture(val);
  e.target.value = "";
  // focus zostaje w polu — gotowe na kolejny wpis
});

document.getElementById("important-btn").onclick = () => {
  if (state.activeId) toggleImportant(state.activeId);
};

import { scheduleAlarm, clearAlarm, rescheduleAll } from "./alarms.js";

// W boot po załadowaniu notatek:
Promise.all([
  loadNotes(),
  loadTags(),
  loadCollapsedSections(),
  loadFilterPrefs(),
]).then(([notes, tags, collapsed, prefs]) => {
  state.notes = notes;
  tagState.tags = tags;
  state.collapsedSections = collapsed;
  state.filterHideCompleted = prefs.hideCompleted ?? false;
  rescheduleAll(state.notes); // ← dodaj
  renderList();
  renderTagSelector();
});

// Handler dla czasu:
document.getElementById("due-time").addEventListener("change", (e) => {
  setDueTime(e.target.value);
  if (state.activeId) {
    const note = state.notes.find((n) => n.id === state.activeId);
    if (note) scheduleAlarm(note);
  }
});

// Po zmianie daty też reschedule:
document.getElementById("due-date").addEventListener("change", (e) => {
  setDueDate(e.target.value);
  if (state.activeId) {
    const note = state.notes.find((n) => n.id === state.activeId);
    if (note) scheduleAlarm(note);
  }
});

document.getElementById("due-reminder").addEventListener("change", (e) => {
  setReminder(e.target.value);
  if (state.activeId) {
    const note = state.notes.find((n) => n.id === state.activeId);
    if (note) scheduleAlarm(note);
  }
});
