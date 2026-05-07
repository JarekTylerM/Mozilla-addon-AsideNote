/* ══════════════════════════════════════════════════════════════
   panel.js — panel personalizacji + tag selector + filter bar
   ══════════════════════════════════════════════════════════════ */

import {
  tagState,
  getTag,
  createTag,
  updateTag,
  deleteTag,
  makeTagPill,
} from "./tags.js";
import { state, renderList, saveActiveNote } from "./notes.js";
import { saveNotes, saveFilterPrefs, saveTags } from "./storage.js";
import { rescheduleAll } from "./alarms.js";
const mainView = document.getElementById("main-view");
const panelEl = document.getElementById("panel");
const tagsList = document.getElementById("tags-list");
const tagDropdown = document.getElementById("tag-dropdown");
const tagOptions = document.getElementById("tag-options");
const selectorPills = document.getElementById("tag-selector-pills");

/* ══ Panel personalizacji ═══════════════════════ */

export function openPanel() {
  mainView.hidden = true;
  panelEl.hidden = false;
  _renderTagsPanel();
}

export function closePanel() {
  panelEl.hidden = true;
  mainView.hidden = false;
}

function _renderTagsPanel() {
  tagsList.innerHTML = "";

  if (tagState.tags.length === 0) {
    const msg = document.createElement("p");
    msg.className = "panel-empty";
    msg.textContent = "Brak tagów — dodaj pierwszy poniżej";
    tagsList.appendChild(msg);
    return;
  }

  tagState.tags.forEach(_renderTagRow);
}

function _renderTagRow(tag) {
  const row = document.createElement("div");
  row.className = "tag-manage-row";

  const left = document.createElement("div");
  left.className = "tag-manage-left";
  left.appendChild(makeTagPill(tag));

  const nameEl = document.createElement("span");
  nameEl.className = "tag-manage-name";
  nameEl.textContent = tag.name;

  const editInput = document.createElement("input");
  editInput.className = "tag-manage-input";
  editInput.value = tag.name;
  editInput.hidden = true;

  left.appendChild(nameEl);
  left.appendChild(editInput);

  const actions = document.createElement("div");
  actions.className = "tag-manage-actions";

  const editBtn = document.createElement("button");
  editBtn.className = "btn";
  editBtn.textContent = "Edytuj";

  let editing = false;
  editBtn.onclick = () => {
    if (!editing) {
      editing = true;
      nameEl.hidden = true;
      editInput.hidden = false;
      editInput.focus();
      editBtn.textContent = "Zapisz";
    } else {
      const name = editInput.value.trim();
      if (!name) return;
      updateTag(tag.id, name);
      _renderTagsPanel();
      renderTagSelector();
      renderList();
    }
  };

  editInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") editBtn.click();
    if (e.key === "Escape") {
      editing = false;
      editInput.hidden = true;
      nameEl.hidden = false;
      editBtn.textContent = "Edytuj";
    }
  });

  const delBtn = document.createElement("button");
  delBtn.className = "btn btn--danger";
  delBtn.textContent = "Usuń";
  delBtn.onclick = () => {
    deleteTag(tag.id);
    state.notes.forEach((n) => {
      if (n.tags) n.tags = n.tags.filter((id) => id !== tag.id);
    });
    saveNotes(state.notes);
    _renderTagsPanel();
    renderTagSelector();
    renderList();
  };

  actions.appendChild(editBtn);
  actions.appendChild(delBtn);
  row.appendChild(left);
  row.appendChild(actions);
  tagsList.appendChild(row);
}

export function initAddTagForm() {
  const input = document.getElementById("new-tag-input");
  const btn = document.getElementById("add-tag-btn");

  const doAdd = () => {
    const name = input.value.trim();
    if (!name) return;
    createTag(name);
    input.value = "";
    _renderTagsPanel();
  };

  btn.onclick = doAdd;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doAdd();
  });
}

/* ══ Tag selector (w edytorze) ══════════════════ */

export function initTagSelector() {
  document.addEventListener("click", (e) => {
    const sel = document.getElementById("tag-selector");
    if (!sel?.contains(e.target)) tagDropdown.hidden = true;
  });

  document.getElementById("goto-panel").onclick = () => {
    tagDropdown.hidden = true;
    openPanel();
  };
}

export function renderTagSelector() {
  selectorPills.innerHTML = "";

  const note = state.activeId
    ? state.notes.find((n) => n.id === state.activeId)
    : null;
  const activeTags = note?.tags ?? [];

  activeTags.forEach((id) => {
    const tag = getTag(id);
    if (!tag) return;
    const pill = makeTagPill(tag, { removable: true });
    pill.title = "Kliknij aby usunąć";
    pill.onclick = () => _toggleTag(id);
    selectorPills.appendChild(pill);
  });

  const addBtn = document.createElement("button");
  addBtn.className = "tag-add-btn";
  addBtn.textContent = activeTags.length === 0 ? "+ dodaj tag" : "+ tag";
  addBtn.disabled = tagState.tags.length === 0;
  addBtn.title =
    tagState.tags.length === 0 ? "Utwórz tagi w panelu personalizacji" : "";
  addBtn.onclick = (e) => {
    e.stopPropagation();
    const willOpen = tagDropdown.hidden;
    tagDropdown.hidden = !tagDropdown.hidden;
    if (willOpen) _renderTagOptions(activeTags);
  };
  selectorPills.appendChild(addBtn);
}

function _renderTagOptions(activeTags) {
  tagOptions.innerHTML = "";

  if (tagState.tags.length === 0) {
    const msg = document.createElement("div");
    msg.className = "tag-option-empty";
    msg.textContent = "Brak tagów";
    tagOptions.appendChild(msg);
    return;
  }

  tagState.tags.forEach((tag) => {
    const isActive = activeTags.includes(tag.id);
    const item = document.createElement("div");
    item.className =
      "tag-option-item" + (isActive ? " tag-option-item--active" : "");

    const check = document.createElement("span");
    check.className = "tag-option-check";
    check.textContent = isActive ? "✓" : "";

    item.appendChild(check);
    item.appendChild(makeTagPill(tag));
    item.onclick = () => {
      _toggleTag(tag.id);
      tagDropdown.hidden = true;
    };

    tagOptions.appendChild(item);
  });
}

function _toggleTag(tagId) {
  if (!state.activeId) {
    saveActiveNote();
    if (!state.activeId) return;
  }

  const note = state.notes.find(n => n.id === state.activeId);
  if (!note) return;
  if (!note.tags) note.tags = [];

  const idx = note.tags.indexOf(tagId);
  if (idx === -1) note.tags.push(tagId);
  else note.tags.splice(idx, 1);

  saveNotes(state.notes);
  renderTagSelector();
  renderList();
}

/* ══ Filter bar ═════════════════════════════════ */

export function initFilter() {
  const filterBtn = document.getElementById("filter-btn");
  const filterBar = document.getElementById("filter-bar");
  const filterOpts = document.getElementById("filter-options");

  filterBtn.onclick = () => {
    const willOpen = filterBar.hidden;
    filterBar.hidden = !filterBar.hidden;
    filterBtn.classList.toggle("is-active", !filterBar.hidden);
    if (willOpen) _renderFilterOptions(filterOpts);
  };
}

function _renderFilterOptions(container) {
  container.innerHTML = "";

  // Toggle: ukryj zakończone
  const toggleRow = document.createElement("label");
  toggleRow.className = "filter-toggle";
  toggleRow.innerHTML = `
    <input type="checkbox" ${state.filterHideCompleted ? "checked" : ""} />
    <span>Ukryj zakończone</span>
  `;
  toggleRow.querySelector("input").onchange = (e) => {
    state.filterHideCompleted = e.target.checked;
    saveFilterPrefs({ hideCompleted: state.filterHideCompleted });
    renderList();
  };
  container.appendChild(toggleRow);

  // Tagi
  if (tagState.tags.length === 0) {
    const msg = document.createElement("span");
    msg.className = "filter-empty";
    msg.textContent = "Brak tagów";
    container.appendChild(msg);
    return;
  }

  const sep = document.createElement("div");
  sep.className = "filter-separator";
  sep.textContent = "Tagi";
  container.appendChild(sep);

  tagState.tags.forEach((tag) => {
    const isActive = state.filterTags.includes(tag.id);
    const pill = makeTagPill(tag);
    pill.classList.toggle("tag-pill--filter-active", isActive);
    pill.onclick = () => {
      const idx = state.filterTags.indexOf(tag.id);
      if (idx === -1) state.filterTags.push(tag.id);
      else state.filterTags.splice(idx, 1);
      _renderFilterOptions(container);
      renderList();
    };
    container.appendChild(pill);
  });
}

export function initDataActions() {
  document.getElementById("export-btn").onclick = _exportData;
  document.getElementById("import-input").addEventListener("change", e => {
    const file = e.target.files[0];
    if (file) _importData(file);
    e.target.value = ""; // reset żeby można było importować ten sam plik ponownie
  });
}

function _exportData() {
  const data = {
    version:    "0.0.6",
    exportedAt: new Date().toISOString(),
    notes:      state.notes,
    tags:       tagState.tags,
  };

  const blob = new Blob(
    [JSON.stringify(data, null, 2)],
    { type: "application/json" }
  );
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href     = url;
  a.download = `notatnik-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function _importData(file) {
  const confirmed = window.confirm(
    "Import zastąpi wszystkie istniejące notatki i tagi.\nCzy chcesz kontynuować?"
  );
  if (!confirmed) return;

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);

      if (!Array.isArray(data.notes)) throw new Error("Brak pola 'notes'");

      state.notes   = data.notes;
      tagState.tags = Array.isArray(data.tags) ? data.tags : [];

      saveNotes(state.notes);
      saveTags(tagState.tags);
      rescheduleAll(state.notes);

      // reset aktywnej notatki
      state.activeId = null;
      document.getElementById("title").value    = "";
      document.getElementById("editor").innerHTML = "";

      renderList();
      renderTagSelector();
      _renderTagsPanel();

      alert(`Zaimportowano ${data.notes.length} notatek i ${tagState.tags.length} tagów.`);
    } catch (err) {
      alert("Błąd importu: " + err.message);
    }
  };
  reader.readAsText(file);
}