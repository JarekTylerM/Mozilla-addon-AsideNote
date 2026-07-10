// @ts-check
/* ══════════════════════════════════════════════════════════════
   panel.js — panel personalizacji + tag selector + filter bar
   ══════════════════════════════════════════════════════════════ */
import { switchPanelTab } from "./app.js";
import {
  tagState,
  getTag,
  createTag,
  updateTag,
  deleteTag,
  makeTagPill,
  PALETTE,
  updateTagColor,
} from "./tags.js";
import {
  state,
  renderList,
  saveActiveNote,
  selectNote,
  restoreDeletedNote,
} from "./notes.js";
import {
  saveNotes,
  saveFilterPrefs,
  saveTags,
  saveUiSettings,
  saveFocusId,
  saveLastBackupBeforeImport,
  migrateNotes,
  CURRENT_SCHEMA,
  saveDeletedNotes,
  loadLastBackupBeforeImport,
} from "./storage.js";
import { rescheduleAll } from "./alarms.js";
import { t } from "./i18n.js";
import { setTooltipsEnabled } from "./tooltip.js";
import {
  sanitizeHTML,
  sanitizeImportedNote,
  sanitizeImportedTag,
  MAX_TAG_NAME_LEN,
  MAX_IMPORT_NOTES,
  MAX_IMPORT_TAGS,
} from "./sanitize.js";
/** @param {string} id @returns {HTMLElement} */
const _byId = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** @param {Event} e @returns {Element|null} */
const _target = (e) => /** @type {Element|null} */ (e.target);
/** @param {Event} e @returns {HTMLInputElement} — input, ktory wywolal zdarzenie */
const _inp = (e) => /** @type {HTMLInputElement} */ (e.target);
/** @param {string} id @returns {HTMLInputElement} */
const _byInput = (id) =>
  /** @type {HTMLInputElement} */ (document.getElementById(id));

// Elementy panelu są zawsze w sidebar.html — rzutujemy z pominięciem null.
const mainView = _byId("main-view");
const panelEl = _byId("panel");
const tagsList = _byId("tags-list");
const tagDropdown = _byId("tag-dropdown");
const tagOptions = _byId("tag-options");
const selectorPills = _byId("tag-selector-pills");

/* ══ Panel personalizacji ═══════════════════════ */

export function openPanel() {
  mainView.hidden = true;
  panelEl.hidden = false;
  _renderTagsPanel();
  updateStorageUsage();
  renderDeletedNotes();
  initUndoImport();
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
    msg.textContent = t("panel_tags_empty");
    tagsList.appendChild(msg);
    return;
  }

  tagState.tags.forEach(_renderTagRow);
}

/** @param {Tag} tag */
function _renderTagRow(tag) {
  const row = document.createElement("div");
  row.className = "tag-manage-row";

  const left = document.createElement("div");
  left.className = "tag-manage-left";
  left.appendChild(makeTagPill(tag));

  const count = state.notes.filter(
    (n) => Array.isArray(n.tags) && n.tags.includes(tag.id),
  ).length;
  const countEl = document.createElement("span");
  countEl.className = "tag-manage-count";
  countEl.textContent = String(count);
  if (tag.color?.bg && tag.color?.fg) {
    countEl.style.backgroundColor = _hexAlpha(tag.color.bg, 0.35);
    countEl.style.color = tag.color.fg;
    countEl.style.borderColor = _hexAlpha(tag.color.fg, 0.25);
  }
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
  editBtn.className = "icon-btn icon-btn--sm icon-btn--ghost icon--edit";
  editBtn.setAttribute("aria-label", t("panel_tags_edit"));
  editBtn.title = t("panel_tags_edit");

  // Inline error pod editInput — pokazywany gdy walidacja zwróci błąd
  const editError = document.createElement("div");
  editError.className = "validation-error";
  editError.hidden = true;

  let editing = false;
  editBtn.onclick = () => {
    if (!editing) {
      editing = true;
      nameEl.hidden = true;
      editInput.hidden = false;
      editError.hidden = true;
      editInput.focus();
      editBtn.className =
        "icon-btn icon-btn--sm icon-btn--ghost icon--edit is-active";
    } else {
      const name = editInput.value.trim();
      if (!name) {
        editError.textContent = t("validation_empty");
        editError.hidden = false;
        return;
      }
      const result = updateTag(tag.id, name);
      if (!result.ok) {
        editError.textContent = t(result.error ?? "");
        editError.hidden = false;
        return;
      }
      _renderTagsPanel();
      renderTagSelector();
      renderList();
    }
  };

  // Live feedback przy wpisywaniu — pokazuj komunikat o limicie zanim user kliknie save
  editInput.addEventListener("input", () => {
    const value = editInput.value;
    if (value.length > MAX_TAG_NAME_LEN) {
      editError.textContent = t("validation_tooLong");
      editError.hidden = false;
    } else {
      editError.hidden = true;
    }
  });

  editInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") editBtn.click();
    if (e.key === "Escape") {
      editing = false;
      editInput.hidden = true;
      nameEl.hidden = false;
      editError.hidden = true;
      editBtn.className = "icon-btn icon-btn--sm icon-btn--ghost icon--edit";
    }
  });

  const upBtn = document.createElement("button");
  upBtn.className = "icon-btn icon-btn--sm icon-btn--ghost icon--tag-up";
  upBtn.setAttribute("aria-label", t("panel_tags_moveUp"));
  upBtn.title = t("panel_tags_moveUp");
  upBtn.onclick = () => {
    const idx = tagState.tags.findIndex((t) => t.id === tag.id);
    if (idx <= 0) return;
    [tagState.tags[idx - 1], tagState.tags[idx]] = [
      tagState.tags[idx],
      tagState.tags[idx - 1],
    ];
    saveTags(tagState.tags);
    _renderTagsPanel();
  };

  const downBtn = document.createElement("button");
  downBtn.className = "icon-btn icon-btn--sm icon-btn--ghost icon--tag-down";
  downBtn.setAttribute("aria-label", t("panel_tags_moveDown"));
  downBtn.title = t("panel_tags_moveDown");
  downBtn.onclick = () => {
    const idx = tagState.tags.findIndex((t) => t.id === tag.id);
    if (idx >= tagState.tags.length - 1) return;
    [tagState.tags[idx], tagState.tags[idx + 1]] = [
      tagState.tags[idx + 1],
      tagState.tags[idx],
    ];
    saveTags(tagState.tags);
    _renderTagsPanel();
  };

  const delBtn = document.createElement("button");
  delBtn.className =
    "icon-btn icon-btn--sm icon-btn--ghost icon--bin tag-manage-del";
  delBtn.setAttribute("aria-label", t("panel_tags_delete"));
  delBtn.title = t("panel_tags_delete");
  delBtn.onclick = () => _openTagDeleteModal(tag);

  const colorBtn = document.createElement("button");
  colorBtn.className =
    "icon-btn icon-btn--sm icon-btn--ghost icon--color-palette";
  colorBtn.setAttribute("aria-label", t("panel_tags_changeColor"));
  colorBtn.title = t("panel_tags_changeColor");
  colorBtn.onclick = (e) => {
    e.stopPropagation();
    _openColorPicker(tag, colorBtn);
  };

  actions.appendChild(upBtn);
  actions.appendChild(downBtn);
  actions.appendChild(colorBtn);
  actions.appendChild(editBtn);
  actions.appendChild(delBtn);
  row.appendChild(left);
  row.appendChild(actions);
  row.appendChild(editError); // pełna szerokość pod row dla komunikatu walidacji
  tagsList.appendChild(row);
}

/** @param {Tag} tag */
function _openTagDeleteModal(tag) {
  const modal = _byId("tag-delete-modal");
  const desc = _byId("tag-delete-desc");
  const list = _byId("tag-delete-list");
  const btnConfirm = _byId("tag-delete-confirm");
  const btnCancel = _byId("tag-delete-cancel");
  const btnClose = _byId("tag-delete-close");
  const backdrop = _byId("tag-delete-backdrop");

  // Znajdź powiązane elementy
  const affected = state.notes.filter(
    (n) => Array.isArray(n.tags) && n.tags.includes(tag.id),
  );
  const notes = affected.filter((n) => n.type === "note");
  const tasks = affected.filter((n) => n.type === "task");

  // Opis
  if (affected.length === 0) {
    desc.textContent = t("tag_delete_unused", [tag.name]);
  } else {
    desc.textContent = t("tag_delete_desc", [
      tag.name,
      String(notes.length),
      String(tasks.length),
    ]);
  }

  // Lista elementów
  list.innerHTML = "";
  affected.forEach((n) => {
    const item = document.createElement("div");
    item.className = "tag-delete-item";

    const icon = document.createElement("span");
    icon.className = `tag-delete-item__icon tag-delete-item__icon--${n.type}`;

    const title = document.createElement("span");
    title.className = "tag-delete-item__title";
    title.textContent = n.title || t("note_untitled");

    item.appendChild(icon);
    item.appendChild(title);
    list.appendChild(item);
  });

  modal.hidden = false;

  // Zamknij
  const close = () => {
    modal.hidden = true;
  };
  btnClose.onclick = close;
  btnCancel.onclick = close;
  backdrop.onclick = close;

  // Potwierdź usunięcie
  btnConfirm.onclick = () => {
    close();
    deleteTag(tag.id);
    state.notes.forEach((n) => {
      if (n.tags) n.tags = n.tags.filter((id) => id !== tag.id);
    });
    saveNotes(state.notes);
    _renderTagsPanel();
    renderTagSelector();
    renderList();
  };
}

/** @param {string} hex @param {number} alpha */
function _hexAlpha(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function initAddTagForm() {
  const input = _byInput("new-tag-input");
  const btn = _byId("add-tag-btn");
  const errorEl = _byId("new-tag-error");

  const showError = (/** @type {string} */ key) => {
    if (errorEl) {
      errorEl.textContent = t(key);
      errorEl.hidden = false;
    }
  };
  const hideError = () => {
    if (errorEl) errorEl.hidden = true;
  };

  const doAdd = () => {
    const name = input.value.trim();
    if (!name) {
      showError("validation_empty");
      return;
    }
    const result = createTag(name);
    if (!result.ok) {
      showError(result.error ?? "");
      return;
    }
    hideError();
    input.value = "";
    _renderTagsPanel();
    renderTagSelector();
  };

  btn.onclick = doAdd;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doAdd();
  });

  // Live feedback przy wpisywaniu — pokazuj limit zanim user kliknie add
  input.addEventListener("input", () => {
    if (input.value.length > MAX_TAG_NAME_LEN) {
      showError("validation_tooLong");
    } else {
      hideError();
    }
  });
}

/* ══ Tag selector (w edytorze) ══════════════════ */

export function initTagSelector() {
  document.addEventListener("click", (e) => {
    const sel = _byId("tag-selector");
    if (!sel?.contains(/** @type {Node} */ (e.target))) tagDropdown.hidden = true;
  });

  // Esc zamyka dropdown gdy fokus jest w środku
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || tagDropdown.hidden) return;
    const focused = document.activeElement;
    if (!tagDropdown.contains(focused)) return;
    e.preventDefault();
    e.stopPropagation();
    tagDropdown.hidden = true;
    // Wróć fokus na addBtn (tam skąd dropdown został otwarty)
    const addBtn = /** @type {HTMLElement|null} */ (document.querySelector("#tag-selector-pills .tag-add-btn"));
    if (addBtn) addBtn.focus();
  });

  _byId("goto-panel").onclick = () => {
    tagDropdown.hidden = true;
    openPanel();
    switchPanelTab("tags");
  };
}

export function renderTagSelector() {
  selectorPills.innerHTML = "";

  const note = state.activeId
    ? state.notes.find((n) => n.id === state.activeId)
    : null;
  const activeTags = note?.tags ?? [];

  /** @type {Tag[]} */ ([...activeTags].map((id) => getTag(id)).filter(Boolean))
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((tag) => {
      const pill = makeTagPill(tag, { removable: true });
      pill.title = t("tagSelector_pill_removeTitle");
      pill.onclick = () => _toggleTag(tag.id);
      selectorPills.appendChild(pill);
    });

  const addBtn = document.createElement("button");
  addBtn.className = "tag-add-btn";

  if (tagState.tags.length === 0) {
    addBtn.textContent = t("tagSelector_addBtn_long");
    addBtn.title = t("tagSelector_addBtn_emptyTitle");
    addBtn.onclick = (e) => {
      e.stopPropagation();
      const willOpen = tagDropdown.hidden;
      tagDropdown.hidden = !tagDropdown.hidden;
      if (willOpen) _renderTagOptions(activeTags);
    };
  } else {
    addBtn.textContent =
      activeTags.length === 0
        ? t("tagSelector_addBtn_long")
        : t("tagSelector_addBtn_short");
    addBtn.onclick = (e) => {
      e.stopPropagation();
      const willOpen = tagDropdown.hidden;
      tagDropdown.hidden = !tagDropdown.hidden;
      if (willOpen) _renderTagOptions(activeTags);
    };
  }

  selectorPills.appendChild(addBtn);
}

/** @param {string[]} activeTags */
function _renderTagOptions(activeTags) {
  tagOptions.innerHTML = "";

  if (tagState.tags.length === 0) {
    const msg = document.createElement("div");
    msg.className = "tag-option-empty";
    msg.textContent = t("tagSelector_options_empty");
    tagOptions.appendChild(msg);
    return;
  }

  tagState.tags.forEach((tag) => {
    const isActive = activeTags.includes(tag.id);
    const item = document.createElement("button");
    item.type = "button";
    item.className =
      "tag-option-item" + (isActive ? " is-active" : "");
    item.dataset.tagId = tag.id;

    const check = document.createElement("span");
    check.className = "tag-option-check";
    check.textContent = isActive ? "✓" : "";

    item.appendChild(check);
    item.appendChild(makeTagPill(tag));
    item.onclick = () => {
      _toggleTag(tag.id);
      // In-place toggle — zachowuje fokus klawiatury, dropdown zostaje otwarty
      const nowActive = item.classList.toggle("is-active");
      check.textContent = nowActive ? "✓" : "";
    };

    tagOptions.appendChild(item);
  });
}

/** @param {string} msg */
function _showTagHint(msg) {
  const pills = _byId("tag-selector-pills");
  if (!pills) return;
  let hint = _byId("tag-selector-hint");
  if (!hint) {
    hint = document.createElement("span");
    hint.id = "tag-selector-hint";
    hint.className = "tag-selector-hint";
    pills.appendChild(hint);
  }
  hint.textContent = msg;
  hint.hidden = false;
  const _h = /** @type {any} */ (hint);
  clearTimeout(_h._timer);
  _h._timer = setTimeout(() => {
    hint.hidden = true;
  }, 2500);
}

/** @param {string} tagId */
function _toggleTag(tagId) {
  if (!state.activeId) {
    saveActiveNote();
    if (!state.activeId) {
      _showTagHint(t("tagSelector_noNote"));
      return;
    }
  }

  const note = state.notes.find((n) => n.id === state.activeId);
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
  const filterBtn = _byId("filter-btn");
  const filterBar = _byId("filter-bar");
  const filterOpts = _byId("filter-options");

  filterBtn.onclick = () => {
    const willOpen = filterBar.hidden;
    filterBar.hidden = !filterBar.hidden;
    filterBtn.classList.toggle("is-active", !filterBar.hidden);
    if (willOpen) _renderFilterOptions(filterOpts);
  };
}

/** @param {HTMLElement} container */
function _renderFilterOptions(container) {
  container.innerHTML = "";

  // Toggle: ukryj zakończone
  const toggleRow = document.createElement("label");
  toggleRow.className = "filter-toggle";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = state.filterHideCompleted;
  const labelText = document.createElement("span");
  labelText.textContent = t("filter_hideCompleted");
  toggleRow.appendChild(checkbox);
  toggleRow.appendChild(labelText);
  checkbox.onchange = (e) => {
    state.filterHideCompleted = _inp(e).checked;
    saveFilterPrefs({ hideCompleted: state.filterHideCompleted });
    renderList();
    document.dispatchEvent(new CustomEvent("filterChanged"));
  };
  container.appendChild(toggleRow);

  // Toggle: tylko w trakcie
  const inProgressRow = document.createElement("label");
  inProgressRow.className = "filter-toggle";
  const inProgressCb = document.createElement("input");
  inProgressCb.type = "checkbox";
  inProgressCb.checked = state.filterInProgress;
  const inProgressText = document.createElement("span");
  inProgressText.textContent = t("filter_inProgress");
  inProgressRow.appendChild(inProgressCb);
  inProgressRow.appendChild(inProgressText);
  inProgressCb.onchange = (e) => {
    state.filterInProgress = _inp(e).checked;
    renderList();
    document.dispatchEvent(new CustomEvent("filterChanged"));
  };
  container.appendChild(inProgressRow);

  // Tagi
  if (tagState.tags.length === 0) {
    const msg = document.createElement("span");
    msg.className = "filter-empty";
    msg.textContent = t("filter_tags_empty");
    container.appendChild(msg);
    return;
  }

  const sep = document.createElement("div");
  sep.className = "filter-separator";
  sep.textContent = t("filter_tags_separator");
  container.appendChild(sep);

  tagState.tags.forEach((tag) => {
    const isActive = state.filterTags.includes(tag.id);
    const count = state.notes.filter(
      (n) => Array.isArray(n.tags) && n.tags.includes(tag.id),
    ).length;
    const pill = makeTagPill(tag, { interactive: true });
    pill.classList.toggle("tag-pill--filter-active", isActive);
    pill.dataset.tagId = tag.id;
    const badge = document.createElement("span");
    badge.className = "tag-pill__count";
    badge.textContent = String(count);
    pill.appendChild(badge);
    pill.onclick = () => {
      const idx = state.filterTags.indexOf(tag.id);
      if (idx === -1) state.filterTags.push(tag.id);
      else state.filterTags.splice(idx, 1);
      pill.classList.toggle("tag-pill--filter-active");
      renderList();
      document.dispatchEvent(new CustomEvent("filterChanged"));
    };
    container.appendChild(pill);
  });
}

/* ── Cofnij ostatni import ─────────────────────── */

/** @param {any} [backupOverride] */
export async function initUndoImport(backupOverride = null) {
  const btn = _byId("undo-import-btn");
  const wrapper = _byId("undo-import-wrapper");
  const info = _byId("undo-import-info");
  if (!btn || !wrapper) return;

  const backup = backupOverride ?? (await loadLastBackupBeforeImport());
  if (!backup) {
    wrapper.hidden = true;
    return;
  }

  const date = new Date(backup.savedAt).toLocaleString();
  const count = backup.notes?.length ?? 0;
  info.textContent = t("panel_data_undoImport_info", [date, String(count)]);
  wrapper.hidden = false;

  btn.onclick = async () => {
    if (!window.confirm(t("panel_data_undoImport_confirm"))) return;

    state.notes = backup.notes ?? [];
    tagState.tags = backup.tags ?? [];

    await saveNotes(state.notes);
    await saveTags(tagState.tags);
    await browser.storage.local.remove("_lastBackupBeforeImport");

    wrapper.hidden = true;
    renderList();
    _renderTagsPanel();
    updateStorageUsage();

    info.textContent = t("panel_data_undoImport_done");
    info.hidden = false;
    setTimeout(() => {
      info.textContent = "";
    }, 3000);
  };
}

export function initDataActions() {
  _byId("export-btn").onclick = _exportData;
  _byId("import-input").addEventListener("change", (e) => {
    const file = _inp(e).files?.[0];
    if (file) _importData(file);
    /** @type {HTMLInputElement} */ (e.target).value = "";
  });
  document
    .getElementById("deleted-empty-btn")
    ?.addEventListener("click", _emptyDeletedNotes);
}

/* ── Storage usage ─────────────────────────────── */

const STORAGE_QUOTA = 5 * 1024 * 1024; // 5 MB — standardowy limit MV2

/** @param {number} bytes */
function _fmtBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Zwraca liczbę bajtów zajętych w storage.local.
 * Firefox nie implementuje storage.local.getBytesInUse (bug 1385832) —
 * fallback: serializacja wszystkich kluczy i pomiar długości w UTF-8.
 * Przybliżenie jest wystarczające dla paska zajętości.
 */
async function _getStorageBytes() {
  if (typeof browser.storage.local.getBytesInUse === "function") {
    try {
      return await browser.storage.local.getBytesInUse(null);
    } catch {
      // spadnij do fallbacku poniżej
    }
  }
  const all = await browser.storage.local.get(null);
  return new TextEncoder().encode(JSON.stringify(all)).length;
}

export async function updateStorageUsage() {
  const bar = _byId("storage-bar");
  const label = _byId("storage-label");
  if (!bar || !label) return;

  try {
    const used = await _getStorageBytes();
    const free = Math.max(0, STORAGE_QUOTA - used);
    const pct = Math.min(100, (used / STORAGE_QUOTA) * 100);

    const level = pct > 80 ? "danger" : pct > 55 ? "warn" : "";

    bar.style.width = `${pct}%`;
    bar.className =
      "storage-usage__bar" + (level ? ` storage-usage__bar--${level}` : "");

    label.textContent = t("storage_usage_label", [
      _fmtBytes(used),
      _fmtBytes(STORAGE_QUOTA),
      _fmtBytes(free),
    ]);
    label.className =
      "storage-usage__label" + (level ? ` storage-usage__label--${level}` : "");
  } catch {
    label.textContent = t("storage_usage_unavailable");
  }
}

function _exportData() {
  const data = {
    version: browser.runtime.getManifest().version,
    schemaVersion: CURRENT_SCHEMA,
    exportedAt: new Date().toISOString(),
    // Stan "w trakcie" żyje w focusIds (runtime) — do eksportu materializujemy
    // go jako flagę focus na zadaniach, żeby przetrwał cykl eksport/import
    // (import odczytuje flagę i odbudowuje focusIds — patrz _importData).
    notes: state.notes.map((n) =>
      state.focusIds.includes(n.id) ? { ...n, focus: true } : n,
    ),
    tags: tagState.tags,
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `asidenotes-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** @param {File} file */
function _importData(file) {
  const confirmed = window.confirm(t("import_confirm"));
  if (!confirmed) return;

  // Limit rozmiaru pliku — 5 MB to dużo nawet dla pełnych eksportów.
  // Chroni przed wyczerpaniem pamięci przy próbie wczytania monstrualnego JSON.
  if (file.size > STORAGE_QUOTA) {
    _showImportFeedback(t("import_error_fileTooLarge"), "error");
    return;
  }

  const reader = new FileReader();
  reader.onerror = () => {
    _showImportFeedback(t("import_error_prefix") + reader.error?.message, "error");
  };
  reader.onload = async (e) => {
    try {
      const data = JSON.parse(/** @type {string} */ (/** @type {FileReader} */ (e.target).result));

      if (!Array.isArray(data.notes))
        throw new Error(t("import_error_missingNotes"));

      // Hard limit liczby notatek/tagów — chroni przed DoS przez ogromny plik
      // który przeszedł walidację rozmiaru (np. milion pustych obiektów).
      if (data.notes.length > MAX_IMPORT_NOTES) {
        throw new Error(
          t("import_error_tooManyNotes", [String(MAX_IMPORT_NOTES)]),
        );
      }
      if (Array.isArray(data.tags) && data.tags.length > MAX_IMPORT_TAGS) {
        throw new Error(
          t("import_error_tooManyTags", [String(MAX_IMPORT_TAGS)]),
        );
      }

      // Backup bieżącego stanu PRZED nadpisaniem — import jest destruktywny
      // (zastępuje wszystkie notatki/tagi). Migawka pozwala cofnąć pomyłkę.
      // await: gdy zapis migawki się nie powiedzie, przerywamy import —
      // nadpisanie danych bez działającego backupu byłoby nieodwracalne.
      const _snapshot = {
        schemaVersion: CURRENT_SCHEMA,
        savedAt: new Date().toISOString(),
        notes: state.notes,
        tags: tagState.tags,
      };
      await saveLastBackupBeforeImport(_snapshot);

      // Migracja: importowany plik może pochodzić ze starszej wersji
      // schematu. Przepuszczamy przez ten sam mechanizm co loadNotes.
      const importedVersion = data.schemaVersion ?? 0;
      if (importedVersion > CURRENT_SCHEMA) {
        throw new Error(t("import_error_schemaVersion"));
      }
      const migrated = migrateNotes(data.notes, importedVersion);

      // Pełna walidacja każdej notatki — sanitizeImportedNote sprawdza:
      // - id (alfanumeryczny + _-, max 100 zn)
      // - type (note/task)
      // - title (string, control chars wycięte, max 200 zn)
      // - content (sanitizeHTML, przycięty do MAX_CONTENT_LEN = 50 KB;
      //   przycięcie jest raportowane userowi, patrz truncatedNotes niżej)
      // - created (timestamp w sensownym zakresie)
      // - tags (tablica valid ID)
      // - dla task: completed/focus/important (boolean), due (timestamp),
      //   time (HH:MM 00:00-23:59), reminder (jeden z [0,5,15,30,60])
      // Notatki bez wymaganych pól lub z niepoprawnym ID są ODRZUCANE.
      /** @type {Note[]} */
      const acceptedNotes = [];
      const seenNoteIds = new Set();
      let rejectedNotes = 0;
      let truncatedNotes = 0;
      for (const raw of migrated) {
        const result = sanitizeImportedNote(raw);
        if (!result.ok || !result.note) {
          rejectedNotes++;
          continue;
        }
        if (seenNoteIds.has(result.note.id)) {
          rejectedNotes++;
          continue;
        }
        if (result.truncated) truncatedNotes++;
        seenNoteIds.add(result.note.id);
        acceptedNotes.push(result.note);
      }

      // Walidacja tagów — odrzuca tagi bez id/name/color lub z niepoprawnym schematem.
      /** @type {Tag[]} */
      const acceptedTags = [];
      const seenTagIds = new Set();
      let rejectedTags = 0;
      if (Array.isArray(data.tags)) {
        for (const raw of data.tags) {
          const tag = sanitizeImportedTag(raw);
          if (!tag) {
            rejectedTags++;
            continue;
          }
          if (seenTagIds.has(tag.id)) {
            rejectedTags++;
            continue;
          }
          seenTagIds.add(tag.id);
          acceptedTags.push(tag);
        }
      }

      // Wyczyść referencje do tagów których nie ma w zaimportowanej liście.
      // Flagi focus z eksportu zasilają focusIds i są zdejmowane z notatek —
      // jedynym źródłem prawdy stanu "w trakcie" w runtime jest focusIds.
      const validTagIds = new Set(acceptedTags.map((t) => t.id));
      /** @type {string[]} */
      const importedFocusIds = [];
      const cleanedNotes = acceptedNotes.map((note) => {
        if (note.type === "task" && note.focus === true && !note.completed) {
          importedFocusIds.push(note.id);
        }
        const { focus, ...rest } = note;
        return {
          ...rest,
          tags: (note.tags ?? []).filter((id) => validTagIds.has(id)),
        };
      });

      state.notes = cleanedNotes;
      tagState.tags = acceptedTags;
      state.focusIds = importedFocusIds;

      // await — komunikat sukcesu dopiero gdy dane faktycznie trafiły do
      // storage; błąd zapisu (np. przekroczona quota) trafia do catch niżej.
      await saveNotes(state.notes);
      await saveTags(tagState.tags);
      await saveFocusId(state.focusIds);
      rescheduleAll(state.notes);

      // reset aktywnej notatki
      state.activeId = null;
      _byInput("title").value = "";
      _byId("editor").innerHTML = "";

      renderList();
      renderTagSelector();
      initUndoImport(_snapshot);
      _renderTagsPanel();

      // Info o sukcesie + ostrzeżenie jeśli były odrzucone
      const successMsg = t("import_success", [
        String(state.notes.length),
        String(tagState.tags.length),
      ]);
      const warnings = [];
      if (rejectedNotes > 0 || rejectedTags > 0) {
        warnings.push(
          t("import_warning_rejected", [
            String(rejectedNotes),
            String(rejectedTags),
          ]),
        );
      }
      if (truncatedNotes > 0) {
        warnings.push(t("import_warning_truncated", [String(truncatedNotes)]));
      }
      if (warnings.length) {
        _showImportFeedback(successMsg + " " + warnings.join(" "), "warning");
      } else {
        _showImportFeedback(successMsg, "success");
      }
    } catch (err) {
      _showImportFeedback(
        t("import_error_prefix") + (err instanceof Error ? err.message : String(err)),
        "error",
      );
    }
  };
  reader.readAsText(file);
}

/**
 * Inline feedback po imporcie zamiast natywnego alert(). Element
 * #import-feedback musi istnieć w panelu (sekcja "Dane" w sidebar.html).
 * Gdyby go nie było — graceful fallback do console.
 */
/** @param {string} text @param {string} variant */
function _showImportFeedback(text, variant) {
  const el = _byId("import-feedback");
  if (!el) {
    if (variant === "error") console.error(text);
    else console.info(text);
    return;
  }
  el.textContent = text;
  el.className = "import-feedback import-feedback--" + variant;
  el.hidden = false;
  setTimeout(() => {
    el.hidden = true;
  }, 5000);
}

export function togglePanel() {
  if (panelEl.hidden) openPanel();
  else closePanel();
}

/** @param {Record<string, any>} settings */
export function initUiSettings(settings) {
  // Toolbar toggle
  const toggle = _byInput("toolbar-toggle");
  if (toggle) {
    toggle.checked = settings.showToolbar ?? true;
    _applyToolbar(toggle.checked);
    toggle.onchange = () => {
      _applyToolbar(toggle.checked);
      saveUiSettings({ showToolbar: toggle.checked });
    };
  }

  // Toolbar tooltips toggle
  const tooltipsToggle = _byInput("toolbar-tooltips-toggle");
  if (tooltipsToggle) {
    tooltipsToggle.checked = settings.showToolbarTooltips ?? true;
    _applyToolbarTooltips(tooltipsToggle.checked);
    tooltipsToggle.onchange = () => {
      _applyToolbarTooltips(tooltipsToggle.checked);
      saveUiSettings({ showToolbarTooltips: tooltipsToggle.checked });
    };
  }

  // Editor placeholder toggle
  const placeholderToggle = _byInput("editor-placeholder-toggle");
  if (placeholderToggle) {
    placeholderToggle.checked = settings.showEditorPlaceholder ?? true;
    document.documentElement.dataset.editorPlaceholder =
      placeholderToggle.checked ? "" : "off";
    placeholderToggle.onchange = () => {
      document.documentElement.dataset.editorPlaceholder =
        placeholderToggle.checked ? "" : "off";
      saveUiSettings({ showEditorPlaceholder: placeholderToggle.checked });
    };
  }

  // Zoom
  const zoomSelect = _byInput("ui-zoom-select");
  if (zoomSelect) {
    zoomSelect.value = String(settings.uiZoom ?? 100);
    _applyZoom(settings.uiZoom ?? 100);
    zoomSelect.onchange = () => {
      const val = Number(zoomSelect.value);
      _applyZoom(val);
      saveUiSettings({ uiZoom: val });
    };
  }

  // Color scheme
  _applyColorScheme(settings.colorScheme ?? "auto");
  _initSchemeToggle(settings.colorScheme ?? "auto");
}

/** @param {boolean} show */
function _applyToolbar(show) {
  _byId("toolbar").hidden = !show;
}

/** @param {number} value */
function _applyZoom(value) {
  // Bazowy font-size to 81.25% (z base.css). Skalujemy proporcjonalnie.
  const base = 81.25;
  document.documentElement.style.fontSize =
    value === 100 ? "" : `${(base * value) / 100}%`;
}

/**
 * Ustawia data-theme na <html> na podstawie wybranego trybu.
 * 'auto'  → brak atrybutu (CSS media query prefers-color-scheme decyduje)
 * 'light' → data-theme="light"
 * 'dark'  → data-theme="dark"
 */
/** @param {string} scheme */
function _applyColorScheme(scheme) {
  const html = document.documentElement;
  if (scheme === "auto") {
    html.removeAttribute("data-theme");
  } else {
    html.dataset.theme = scheme;
  }
}

/** @param {string} activeScheme */
function _initSchemeToggle(activeScheme) {
  const btns = /** @type {NodeListOf<HTMLElement>} */ (
    document.querySelectorAll(".scheme-btn")
  );
  if (!btns.length) return;

  // Zaznacz aktywny przycisk
  btns.forEach((btn) => {
    btn.classList.toggle(
      "is-active",
      btn.dataset.scheme === activeScheme,
    );
  });

  // Handler kliku
  btns.forEach((btn) => {
    btn.onclick = () => {
      const scheme = btn.dataset.scheme ?? "auto";
      _applyColorScheme(scheme);
      saveUiSettings({ colorScheme: scheme });
      btns.forEach((b) => b.classList.toggle("is-active", b === btn));
      document.dispatchEvent(new CustomEvent("themeChanged"));
    };
  });
}

/**
 * Włącza/wyłącza custom tooltips globalnie przez tooltip.js.
 */
/** @param {boolean} show */
function _applyToolbarTooltips(show) {
  setTooltipsEnabled(show);
}
/* ── Sanityzacja HTML z importu ────────────────── */

// Dozwolone tagi w content notatki. Wszystko poza tym idzie out.
// Sanityzacja HTML (ALLOWED_TAGS, ALLOWED_ATTRS, safeHref, _cleanNode)
// → przeniesiona do sanitize.js (importowane wyżej jako sanitizeHTML)
/* ══ Color picker ═══════════════════════════════ */

/** @type {HTMLElement|null} */
let _colorPickerEl = null;

/** @param {Tag} tag @param {HTMLElement} anchor */
function _openColorPicker(tag, anchor) {
  if (_colorPickerEl) {
    _colorPickerEl.remove();
    _colorPickerEl = null;
  }

  const picker = document.createElement("div");
  picker.className = "color-picker-popup";
  _colorPickerEl = picker;

  const grid = document.createElement("div");
  grid.className = "color-picker-grid";

  const isDark =
    document.documentElement.dataset.theme === "dark" ||
    (!document.documentElement.dataset.theme &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  PALETTE.forEach((color) => {
    const swatch = document.createElement("button");
    swatch.className = "color-picker-swatch";
    const swatchBg = isDark && color.darkBg ? color.darkBg : color.bg;
    const swatchFg = isDark && color.darkFg ? color.darkFg : color.fg;
    swatch.style.setProperty("--swatch-bg", swatchBg);
    swatch.style.setProperty("--swatch-fg", swatchFg);
    if (tag.color.bg === color.bg) swatch.classList.add("is-active");
    swatch.title = color.bg;
    swatch.onclick = () => {
      updateTagColor(tag.id, color);
      _colorPickerEl?.remove();
      _colorPickerEl = null;
      _renderTagsPanel();
      renderTagSelector();
      renderList();
    };
    grid.appendChild(swatch);
  });

  picker.appendChild(grid);

  const sep = document.createElement("div");
  sep.className = "color-picker-sep";
  picker.appendChild(sep);

  const customRow = document.createElement("label");
  customRow.className = "color-picker-custom";

  const customLabel = document.createElement("span");
  customLabel.textContent = t("panel_tags_customColor");

  const customInput = document.createElement("input");
  customInput.type = "color";
  customInput.value = tag.color.bg;
  customInput.className = "color-picker-input";

  customInput.addEventListener("change", () => {
    const bg = customInput.value;
    const r = parseInt(bg.slice(1, 3), 16);
    const g = parseInt(bg.slice(3, 5), 16);
    const b = parseInt(bg.slice(5, 7), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const fg = luminance > 0.5 ? "#1f2937" : "#f9fafb";
    updateTagColor(tag.id, { bg, fg });
    _colorPickerEl?.remove();
    _colorPickerEl = null;
    _renderTagsPanel();
    renderTagSelector();
    renderList();
  });

  customRow.appendChild(customLabel);
  customRow.appendChild(customInput);
  picker.appendChild(customRow);

  document.body.appendChild(picker);
  const rect = anchor.getBoundingClientRect();
  picker.style.position = "fixed";
  picker.style.top = `${rect.bottom + 4}px`;
  picker.style.left = `${Math.min(rect.left, window.innerWidth - (picker.getBoundingClientRect().width || 180) - 8)}px`;
  picker.style.zIndex = "9999";

  setTimeout(() => {
    document.addEventListener("click", function _close() {
      _colorPickerEl?.remove();
      _colorPickerEl = null;
      document.removeEventListener("click", _close);
    });
  }, 0);
}

/* ── Niedawno usunięte ─────────────────────────── */

export function renderDeletedNotes() {
  const container = _byId("deleted-notes-list");
  const countEl = _byId("deleted-notes-count");
  const emptyEl = _byId("deleted-notes-empty");
  const emptyBtn = _byId("deleted-empty-btn");
  if (!container) return;

  const items = state.deletedNotes ?? [];
  if (countEl) countEl.textContent = items.length ? `(${items.length})` : "";
  if (emptyBtn) emptyBtn.hidden = items.length === 0;

  if (items.length === 0) {
    container.hidden = true;
    if (emptyEl) emptyEl.hidden = false;
    return;
  }

  container.hidden = false;
  if (emptyEl) emptyEl.hidden = true;

  container.innerHTML = "";
  items.forEach((note) => {
    const row = document.createElement("div");
    row.className = "deleted-item";

    const info = document.createElement("div");
    info.className = "deleted-item__info";

    const iconClass = note.type === "task" ? "icon--task" : "icon--note";
    const title = note.title?.trim() || t("deletedNote_untitled");
    const ago = _timeAgo(note.deletedAt);
    const preview = _contentPreview(note.content);

    const previewTip = preview
      ? preview.length > 160
        ? preview.slice(0, 160) + "…"
        : preview
      : t("note_preview_empty");

    info.innerHTML = `<span class="deleted-item__icon ${iconClass}"></span>
      <span class="deleted-item__title">${_esc(title)}</span>
      <span class="deleted-item__ago">${_esc(ago)}</span>`;

    const previewEl = document.createElement("div");
    previewEl.className = "deleted-item__preview";
    previewEl.hidden = true;
    previewEl.textContent = preview || t("deletedNote_noContent");

    info.style.cursor = "pointer";
    info.addEventListener("click", () => {
      previewEl.hidden = !previewEl.hidden;
      row.classList.toggle("deleted-item--expanded", !previewEl.hidden);
    });

    const actions = document.createElement("div");
    actions.className = "deleted-item__actions";

    const previewIconBtn = document.createElement("button");
    previewIconBtn.className = "note-item__preview icon--preview";
    previewIconBtn.setAttribute("aria-label", t("note_preview_ariaLabel"));
    previewIconBtn.title = previewTip;
    previewIconBtn.addEventListener("click", (e) => e.stopPropagation());
    actions.appendChild(previewIconBtn);

    const restoreBtn = document.createElement("button");
    restoreBtn.className =
      "icon-btn icon-btn--sm icon-btn--ghost icon--restore";
    restoreBtn.title = t("deletedNote_restore");
    restoreBtn.setAttribute("aria-label", t("deletedNote_restore"));
    restoreBtn.onclick = () => _restoreNote(note.id);

    const permBtn = document.createElement("button");
    permBtn.className =
      "icon-btn icon-btn--sm icon-btn--ghost icon--delete-forever deleted-item__delete-btn";
    permBtn.title = t("deletedNote_deletePermanently");
    permBtn.setAttribute("aria-label", t("deletedNote_deletePermanently"));
    permBtn.onclick = () => _permanentDelete(note.id);

    actions.appendChild(restoreBtn);
    actions.appendChild(permBtn);
    row.appendChild(info);
    row.appendChild(previewEl);
    row.appendChild(actions);
    container.appendChild(row);
  });
}

/** @param {string} id */
function _restoreNote(id) {
  // Rdzeń przywracania (stan + zapis + alarm + renderList) współdzielony
  // z akcją Cofnij w toaście — patrz notes.js::restoreDeletedNote
  if (!restoreDeletedNote(id)) return;
  renderDeletedNotes();
}

/** @param {string} id */
function _permanentDelete(id) {
  state.deletedNotes = state.deletedNotes.filter((n) => n.id !== id);
  saveDeletedNotes(state.deletedNotes);
  renderDeletedNotes();
  updateStorageUsage();
}

function _emptyDeletedNotes() {
  if (!state.deletedNotes.length) return;
  if (!window.confirm(t("deletedNotes_confirmEmpty"))) return;
  state.deletedNotes = [];
  saveDeletedNotes([]);
  renderDeletedNotes();
  updateStorageUsage();
}

/** @param {number} ts */
function _timeAgo(ts) {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return t("timeAgo_justNow");
  if (sec < 3600) return t("timeAgo_minutes", [String(Math.floor(sec / 60))]);
  if (sec < 86400) return t("timeAgo_hours", [String(Math.floor(sec / 3600))]);
  if (sec < 30 * 86400)
    return t("timeAgo_days", [String(Math.floor(sec / 86400))]);
  return new Date(ts).toLocaleDateString();
}

/** @param {string} s */
function _esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** @param {string} html */
function _contentPreview(html) {
  if (!html) return "";
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 120 ? text.slice(0, 120) + "…" : text;
}
