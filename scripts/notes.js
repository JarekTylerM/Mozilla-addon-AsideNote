/* ══════════════════════════════════════════════════════════════
   notes.js — stan notatek + CRUD + render listy z sekcjami
   ══════════════════════════════════════════════════════════════ */

import { saveNotes, saveCollapsedSections } from "./storage.js";
import { debounce } from "./utils.js";
import { getTag, makeTagPill } from "./tags.js";
import { clearAlarm } from "./alarms.js";

/* ── State ────────────────────────────────────── */

export const state = {
  notes: [],
  activeId: null,
  searchQuery: "",
  filterTags: [],
  filterType: "all",
  filterHideCompleted: false,
  pendingType: "note",
  collapsedSections: [],
  zenMode: false,
};

/* ── DOM refs ─────────────────────────────────── */

const notesList = document.getElementById("notesList");
const titleInput = document.getElementById("title");
const editor = document.getElementById("editor");
const dueInput = document.getElementById("due-date");
const dueWrapper = document.getElementById("due-wrapper");

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

const SECTION_LABELS = {
  overdue: "Zaległe",
  today: "Dzisiaj",
  tomorrow: "Jutro",
  week: "Ten tydzień",
  month: "Ten miesiąc",
  later: "Później",
  unscheduled: "Do zaplanowania",
  notes: "Notatki",
  done: "Zakończone",
};

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

function _toDateInputValue(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function _fromDateInputValue(v) {
  if (!v) return null;
  const [y, m, d] = v.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

function _formatDueRelative(ts) {
  const now = new Date();
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const diffDays = Math.round((ts - today) / 86400000);

  if (diffDays === 0) return "dziś";
  if (diffDays === 1) return "jutro";
  if (diffDays === -1) return "wczoraj";
  if (diffDays < -1) return `${Math.abs(diffDays)} dni temu`;
  if (diffDays < 7)
    return ["nd", "pn", "wt", "śr", "czw", "pt", "sb"][new Date(ts).getDay()];
  return new Date(ts).toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "short",
  });
}

export function isNoteEmpty() {
  return titleInput.value.trim() === "" && editor.innerText.trim() === "";
}

/* ── State ops ────────────────────────────────── */

export function setDueDate(value) {
  if (!state.activeId) return;
  const note = state.notes.find((n) => n.id === state.activeId);
  if (!note || note.type !== "task") return;
  note.due = _fromDateInputValue(value);
  saveNotes(state.notes);
  renderList();
}

export function setDueTime(value) {
  if (!state.activeId) return;
  const note = state.notes.find((n) => n.id === state.activeId);
  if (!note || note.type !== "task") return;
  note.time = value || null;
  saveNotes(state.notes);
  renderList();
}
export function setReminder(value) {
  if (!state.activeId) return;
  const note = state.notes.find(n => n.id === state.activeId);
  if (!note || note.type !== "task") return;
  note.reminder = Number(value);
  saveNotes(state.notes);
}

export function selectNote(id) {
  const note = state.notes.find((n) => n.id === id);
  if (!note) return;
  state.activeId = id;
  titleInput.value = note.title;
  editor.innerHTML = note.content || "";
  if (dueInput) dueInput.value = _toDateInputValue(note.due);
  const timeInput = document.getElementById("due-time");
  if (timeInput) timeInput.value = note.time ?? "";
  const reminderSelect = document.getElementById("due-reminder");
  if (reminderSelect) reminderSelect.value = note.reminder ?? 0;
  renderList();
  updateDeleteState();
  document.dispatchEvent(new CustomEvent("noteSelected"));
}

export function saveActiveNote() {
  if (!state.activeId && isNoteEmpty()) return;

  if (!state.activeId) {
    const newNote = {
      id: Date.now().toString(),
      type: state.pendingType,
      title: titleInput.value,
      content: editor.innerHTML,
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
  } else {
    const note = state.notes.find((n) => n.id === state.activeId);
    if (!note) return;
    note.title = titleInput.value;
    note.content = editor.innerHTML;
  }

  saveNotes(state.notes);
  renderList();
}

export const debouncedSave = debounce(saveActiveNote, 600);

export function deleteActiveNote() {
  if (!state.activeId) return;
  clearAlarm(state.activeId); // ← dodaj
  state.notes = state.notes.filter((n) => n.id !== state.activeId);
  state.activeId = null;
  titleInput.value = "";
  editor.innerHTML = "";
  saveNotes(state.notes);
  renderList();
}

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

export function toggleCompleted(id) {
  const note = state.notes.find((n) => n.id === id);
  if (!note || note.type !== "task") return;

  note.completed = !note.completed;
  if (note.completed) {
    note.completedAt = Date.now();
    clearAlarm(note.id);
  } else {
    delete note.completedAt;
  }

  saveNotes(state.notes);
  renderList();
}

/* ── UI state sync ────────────────────────────── */

export function updateDeleteState() {
  const deleteBtn = document.getElementById("delete");
  const convertBtn = document.getElementById("convert-type");
  const empty = !state.activeId || isNoteEmpty();

  if (deleteBtn) deleteBtn.disabled = empty;

  if (convertBtn) {
    convertBtn.disabled = false;
    const type = state.activeId
      ? (state.notes.find((n) => n.id === state.activeId)?.type ?? "note")
      : state.pendingType;
    convertBtn.dataset.type = type;
    convertBtn.title =
      type === "note" ? "Zmień w zadanie" : "Cofnij do notatki";
  }

  const noteMeta = document.getElementById("note-meta");
  const isTask =
    (state.activeId &&
      state.notes.find((n) => n.id === state.activeId)?.type === "task") ||
    (!state.activeId && state.pendingType === "task");

  if (noteMeta) noteMeta.hidden = !isTask;
  if (dueWrapper) dueWrapper.hidden = !isTask;
  if (dueInput && !state.activeId) dueInput.value = "";
  const importantBtn = document.getElementById("important-btn");
  if (importantBtn) {
    const note = state.notes.find((n) => n.id === state.activeId);
    const isTask = note?.type === "task";
    importantBtn.hidden = !state.activeId;
    importantBtn.classList.toggle("is-active", !!note?.important);
    importantBtn.title = note?.important
      ? "Usuń oznaczenie ważne"
      : "Oznacz jako ważne";
  }
  updateNoteStatus();
}

export function updateNoteStatus() {
  const statusEl = document.getElementById("note-status");
  if (!statusEl) return;

  const isCreating = !state.activeId;
  const action = isCreating ? "Tworzysz" : "Edytujesz";

  const note = !isCreating
    ? state.notes.find((n) => n.id === state.activeId)
    : null;
  const type = note?.type ?? state.pendingType;
  const typeLabel = type === "task" ? "zadanie" : "notatkę";

  const title = titleInput.value.trim();

  statusEl.textContent = title
    ? `${action} ${typeLabel}: ${title}`
    : `${action} ${typeLabel}`;
}

/* ── Render ───────────────────────────────────── */

export function renderList() {
  notesList.innerHTML = "";

  const filtered = state.notes.filter((note) => {
    const q = state.searchQuery.toLowerCase();
    const text = (note.content || "").replace(/<[^>]+>/g, "").toLowerCase();

    const matchesSearch =
      (note.title || "").toLowerCase().includes(q) || text.includes(q);
    const matchesTags =
      state.filterTags.length === 0 ||
      state.filterTags.every((id) => note.tags?.includes(id));
    const matchesType =
      state.filterType === "all" || note.type === state.filterType;
    const matchesCompleted =
      !state.filterHideCompleted || !(note.type === "task" && note.completed);

    return matchesSearch && matchesTags && matchesType && matchesCompleted;
  });

  // Empty state
  const noFilters =
    state.searchQuery === "" &&
    state.filterTags.length === 0 &&
    state.filterType === "all" &&
    !state.filterHideCompleted;
  if (filtered.length === 0 && noFilters) {
    const empty = document.createElement("div");
    empty.className = "notes-empty";
    empty.textContent = "Lista jest pusta, dodaj notatkę";
    notesList.appendChild(empty);
    updateDeleteState();
    return;
  }

  // Grupowanie
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
      // ważne zawsze wyżej, potem po dacie/created
      items.sort((a, b) => {
        if (!!b.important !== !!a.important) return b.important ? 1 : -1;
        const aVal = a.due ?? a.created;
        const bVal = b.due ?? b.created;
        return key === "unscheduled" ? bVal - aVal : aVal - bVal;
      });
    }
  });
  notesList.classList.toggle("zen-active", state.zenMode);
  if (state.zenMode) {
    ["overdue", "today"].forEach((key) => {
      const items = buckets[key];
      if (items?.length) _renderSection(key, items);
    });
    updateDeleteState();
    return;
  }
  // Render w stałej kolejności
  SECTION_ORDER.forEach((key) => {
    const items = buckets[key];
    if (!items || items.length === 0) return;
    _renderSection(key, items);
  });

  updateDeleteState();
}

function _renderSection(key, items) {
  const isCollapsed = state.collapsedSections.includes(key);

  const header = document.createElement("button");
  header.className =
    "section-header" + (isCollapsed ? " section-header--collapsed" : "");
  header.dataset.section = key;
  header.innerHTML = `
    <span class="section-header__label">${SECTION_LABELS[key]}</span>
    <span class="section-header__meta">
      <span class="section-header__count">${items.length}</span>
      <span class="section-header__chevron">${isCollapsed ? "▸" : "▾"}</span>
    </span>
  `;
  header.onclick = () => _toggleSection(key);
  notesList.appendChild(header);

  if (isCollapsed) return;
  items.forEach(_renderNoteItem);
}

function _toggleSection(key) {
  const idx = state.collapsedSections.indexOf(key);
  if (idx === -1) state.collapsedSections.push(key);
  else state.collapsedSections.splice(idx, 1);
  saveCollapsedSections(state.collapsedSections);
  renderList();
}

function _renderNoteItem(note) {
  const div = document.createElement("div");
  div.className = "note-item";
  div.dataset.id = note.id;
  if (note.id === state.activeId) div.classList.add("active-note");
  if (note.type === "task" && note.completed)
    div.classList.add("note-item--completed");

  // Checkbox dla tasków
  if (note.type === "task") {
    const cb = document.createElement("button");
    cb.className =
      "note-checkbox" + (note.completed ? " note-checkbox--on" : "");
    cb.textContent = note.completed ? "✓" : "";
    cb.setAttribute(
      "aria-label",
      note.completed ? "Oznacz jako niewykonane" : "Oznacz jako wykonane",
    );
    cb.onclick = (e) => {
      e.stopPropagation();
      toggleCompleted(note.id);
    };
    div.appendChild(cb);
  }

  // Tytuł
  const title = document.createElement("span");
  title.className = "note-item__title";
  title.textContent = note.title || "Bez tytułu";
  title.onclick = () => selectNote(note.id);
  div.appendChild(title);

  // Gwiazdka
  if (note.type === "task" && note.important) {
    const star = document.createElement("span");
    star.className = "note-item__star";
    star.textContent = "★";
    star.setAttribute("aria-label", "Ważne");
    div.appendChild(star);
  }

  // Due indicator — jeden, z godziną jeśli ustawiona
  if (note.type === "task" && note.due && !note.completed) {
    let label = _formatDueRelative(note.due);
    if (note.time) label += ` ${note.time}`;
    if (label) {
      const dueSpan = document.createElement("span");
      dueSpan.className = "note-item__due";
      dueSpan.textContent = label;
      div.appendChild(dueSpan);
    }
  }

  // Delete button
  const delBtn = document.createElement("button");
  delBtn.className = "note-item__delete";
  delBtn.textContent = "✕";
  delBtn.setAttribute("aria-label", "Usuń notatkę");
  delBtn.onclick = (e) => {
    e.stopPropagation();
    clearAlarm(note.id);
    state.notes = state.notes.filter((n) => n.id !== note.id);
    if (state.activeId === note.id) {
      state.activeId = null;
      titleInput.value = "";
      editor.innerHTML = "";
    }
    saveNotes(state.notes);
    renderList();
  };
  div.appendChild(delBtn);

  // Tagi (max 2 + "+N")
  const tags = note.tags ?? [];
  if (tags.length > 0) {
    const row = document.createElement("div");
    row.className = "note-tags-row";
    tags.slice(0, 2).forEach((id) => {
      const tag = getTag(id);
      if (tag) row.appendChild(makeTagPill(tag, { truncate: 12 }));
    });
    if (tags.length > 2) {
      const more = document.createElement("span");
      more.className = "tag-more";
      more.textContent = `+${tags.length - 2}`;
      row.appendChild(more);
    }
    div.appendChild(row);
  }

  notesList.appendChild(div);
}

export function quickCapture(text) {
  const isTask = text.startsWith("!");
  const title = isTask ? text.slice(1).trim() : text.trim();
  if (!title) return;

  const item = {
    id: Date.now().toString(),
    type: isTask ? "task" : "note",
    title,
    content: "",
    created: Date.now(),
    tags: [],
    ...(isTask && { completed: false, due: null, important: false }),
  };

  state.notes.unshift(item);
  saveNotes(state.notes);
  renderList();
  // celowo NIE zmieniamy activeId — bieżący edytor zostaje nienaruszony
}
export function toggleImportant(id) {
  const note = state.notes.find((n) => n.id === id);
  if (!note || note.type !== "task") return;
  note.important = !note.important;
  saveNotes(state.notes);
  renderList();
  updateDeleteState();
}
