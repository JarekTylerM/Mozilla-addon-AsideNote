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
} from './storage.js';
import * as undo from './undo.js';
import { debounce } from './utils.js';
import { getTag, makeTagPill } from './tags.js';
import { clearAlarm, scheduleAlarm, isAlarmable } from './alarms.js';
import { t, getUILocale, getShortWeekdays } from './i18n.js';
import { buildItemFromCapture, newNoteId } from './quick-capture-core.js';
import { sanitizeHTML, validateText, MAX_TITLE_LEN } from './sanitize.js';
import { setCursorOffset } from './editor.js';
import { updateDueDisplay } from './date-picker.js';
/* ── State ────────────────────────────────────── */

export const state = {
  notes: [],
  activeId: null,
  searchQuery: '',
  filterTags: [],
  filterType: 'all',
  filterHideCompleted: false,
  filterInProgress: false,
  filterDate: null,
  pendingType: 'note',
  collapsedSections: [],
  zenMode: false,
  focusIds: [],
  deletedNotes: [],
};

/* ── DOM refs ─────────────────────────────────── */

const notesList = document.getElementById('notesList');
const titleInput = document.getElementById('title');
const editor = document.getElementById('editor');
const dueInput = document.getElementById('due-date');
const dueWrapper = document.getElementById('due-wrapper');

/* ── Sekcje (buckety) ─────────────────────────── */

const SECTION_ORDER = [
  'overdue',
  'today',
  'tomorrow',
  'week',
  'month',
  'later',
  'unscheduled',
  'notes',
  'done',
];

function _sectionLabel(key) {
  return t(`section_${key}`);
}

function _bucketFor(note) {
  if (note.type === 'note') return 'notes';
  if (note.completed) return 'done';
  if (!note.due) return 'unscheduled';

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

  if (note.due < today) return 'overdue';
  if (note.due < tomorrow) return 'today';
  if (note.due < tomorrow + dayMs) return 'tomorrow';
  if (note.due < endOfWeek) return 'week';
  if (note.due < endOfMonth) return 'month';
  return 'later';
}

/* ── Helpers ──────────────────────────────────── */

function _toDateInputValue(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function _fromDateInputValue(v) {
  if (!v) return null;
  const [y, m, d] = v.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

function _formatDueRelative(timestamp) {
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const diffDays = Math.round((timestamp - startOfToday) / 86400000);

  if (diffDays === 0) return t('due_today');
  if (diffDays === 1) return t('due_tomorrow');
  if (diffDays === -1) return t('due_yesterday');
  if (diffDays < -1) return t('due_daysAgo', [String(Math.abs(diffDays))]);
  if (diffDays < 7) return getShortWeekdays()[new Date(timestamp).getDay()];

  return new Intl.DateTimeFormat(getUILocale(), {
    day: 'numeric',
    month: 'short',
  }).format(new Date(timestamp));
}

/* Wyciąga plain text z HTML content i zwraca pierwsze ~60 znaków.
   Używane jako fallback gdy note.title jest puste.
   DOMParser zamiast tmp.innerHTML — audytorzy oznaczają każde
   innerHTML bez sanityzacji, nawet na detached node (choć CSP
   i tak blokuje inline scripts). */
function _stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html || '';
  return (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
}

function _contentPreview(content, maxLen = 60) {
  if (!content) return '';
  const doc = new DOMParser().parseFromString(content, 'text/html');
  const text = doc.body.textContent.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
}

export function isNoteEmpty() {
  return titleInput.value.trim() === '' && editor.innerText.trim() === '';
}

/* ── State ops ────────────────────────────────── */

export function setDueDate(value) {
  if (!state.activeId) return;
  const note = state.notes.find((n) => n.id === state.activeId);
  if (!note || note.type !== 'task') return;
  note.due = _fromDateInputValue(value);
  saveNotes(state.notes);
  renderList();
}

export function setDueTime(value) {
  if (!state.activeId) return;
  const note = state.notes.find((n) => n.id === state.activeId);
  if (!note || note.type !== 'task') return;
  note.time = value || null;
  saveNotes(state.notes);
  renderList();
}
export function setReminder(value) {
  if (!state.activeId) return;
  const note = state.notes.find((n) => n.id === state.activeId);
  if (!note || note.type !== 'task') return;
  note.reminder = Number(value);
  saveNotes(state.notes);
}

export function setRecurrence(value, days = null) {
  if (!state.activeId) return;
  const note = state.notes.find((n) => n.id === state.activeId);
  if (!note || note.type !== 'task') return;
  note.recurrence = value || null;
  note.recurrenceDays =
    value === 'custom' && Array.isArray(days) && days.length > 0 ? days : null;
  saveNotes(state.notes);
  updateDeleteState();
}

export function selectNote(id) {
  const note = state.notes.find((n) => n.id === id);
  if (!note) return;
  state.activeId = id;
  titleInput.value = note.title;
  // Re-sanityzacja przy odczycie — defense-in-depth dla storage tamper via devtools.
  // Koszt: DOMParser per otwarcie notatki (~1ms). Kompletna ochrona nawet gdy
  // dane w storage zostały zmodyfikowane poza normalnym przepływem zapisu.
  editor.innerHTML = sanitizeHTML(note.content || '');

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
    new CustomEvent('dueDateChanged', {
      detail: { dateStr: _toDateInputValue(note.due) || null },
    }),
  );
  updateDueDisplay();
  // Sync date picker — żeby picker wiedział która data jest wybrana
  import('./date-picker.js').then(({ syncDatePicker }) => {
    syncDatePicker(_toDateInputValue(note.due) || null);
  });
  const timeInput = document.getElementById('due-time');
  if (timeInput) timeInput.value = note.time ?? '';
  // stan alarm-btn i recurrence-btn aktualizuje updateDeleteState()
  // const reminderSelect = document.getElementById('due-reminder');
  // if (reminderSelect) reminderSelect.value = note.reminder ?? 0;
  renderList();
  updateDeleteState();
  document.dispatchEvent(new CustomEvent('noteSelected'));
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
    const newNote = {
      id: newNoteId(),
      type: state.pendingType,
      title: cleanTitle,
      content: cleanContent,
      created: Date.now(),
      tags: [],
      ...(state.pendingType === 'task' && {
        completed: false,
        due: null,
        time: null,
        reminder: 0,
      }),
    };
    state.notes.unshift(newNote);
    state.activeId = newNote.id;
    state.pendingType = 'note';
  } else {
    const note = state.notes.find((n) => n.id === state.activeId);
    if (!note) return;
    note.title = cleanTitle;
    note.content = cleanContent;
  }

  saveNotes(state.notes);
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
    state.deletedNotes = [deleted, ...state.deletedNotes].slice(0, 50);
    saveDeletedNotes(state.deletedNotes);
  }

  state.notes = state.notes.filter((n) => n.id !== id);
  if (state.activeId === id) {
    state.activeId = null;
    titleInput.value = '';
    editor.innerHTML = '';
    if (resetUndo) undo.reset('');
  }
  saveNotes(state.notes);
}

export function deleteActiveNote() {
  if (!state.activeId) return;
  _deleteNoteCore(state.activeId, { resetUndo: true });
  renderList();
}

export function convertType(id) {
  // brak aktywnej notatki — toggle pending type
  if (!id) {
    state.pendingType = state.pendingType === 'note' ? 'task' : 'note';
    updateDeleteState();
    return;
  }

  const note = state.notes.find((n) => n.id === id);
  if (!note) return;

  if (note.type === 'note') {
    note.type = 'task';
    if (note.completed === undefined) note.completed = false;
  } else {
    note.type = 'note';
  }

  saveNotes(state.notes);
  renderList();
  updateDeleteState();
  document.dispatchEvent(new CustomEvent('noteSelected'));
}

export function toggleCompleted(id) {
  const note = state.notes.find((n) => n.id === id);
  if (!note || note.type !== 'task') return;

  note.completed = !note.completed;
  if (note.completed) {
    note.completedAt = Date.now();
    clearAlarm(note.id);
    state.focusIds = state.focusIds.filter((fid) => fid !== id);
    saveFocusId(state.focusIds);

    // Spawn kolejnej instancji dla zadań cyklicznych
    if (note.recurrence && note.due) {
      const spawn = {
        id: newNoteId(),
        type: 'task',
        title: note.title,
        content: '',
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
    }
  } else {
    delete note.completedAt;
  }

  saveNotes(state.notes);
  renderList();
}

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
    if (note.type === 'task' && !note.due) {
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
  document.dispatchEvent(new CustomEvent('focusChanged'));
}

/* ── UI state sync ────────────────────────────── */

export function updateNoteStatus() {
  const el = document.getElementById('note-status');
  if (!el) return;
  const note = state.activeId
    ? state.notes.find((n) => n.id === state.activeId)
    : null;
  const isTask = note ? note.type === 'task' : state.pendingType === 'task';
  if (!state.activeId && isNoteEmpty()) {
    el.innerHTML = '';
    return;
  }
  const title = titleInput.value.trim();
  const kindKey = isTask ? 'noteStatus_kind_task' : 'noteStatus_kind_note';
  const kindStr = t(kindKey);
  const _esc = (s) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  if (title) {
    el.innerHTML = `${_esc(t('noteStatus_editing', [kindStr]))}: <button type="button" class="note-status__title">\u00ab${_esc(title)}\u00bb</button>`;
  } else {
    el.innerHTML = `${_esc(t('noteStatus_editing', [kindStr]))}: <button type="button" class="note-status__title">\u00ab${_esc(t('noteStatus_noTitle'))}\u00bb</button> ${_esc(t('titleHint_short'))}`;
  }

  el.querySelector('.note-status__title')?.addEventListener('click', () => {
    document.getElementById('title')?.focus();
  });
}

export function updateDeleteState() {
  const deleteBtn = document.getElementById('delete');
  const convertBtn = document.getElementById('convert-type');
  const empty = !state.activeId || isNoteEmpty();
  if (deleteBtn) deleteBtn.disabled = empty;
  if (convertBtn) {
    convertBtn.disabled = false;
    const type = state.activeId
      ? (state.notes.find((n) => n.id === state.activeId)?.type ?? 'note')
      : (state.pendingType ?? 'note');
    convertBtn.dataset.type = type;
    convertBtn.title = t(
      type === 'note' ? 'convertType_toTask_title' : 'convertType_toNote_title',
    );
  }
  const focusBtn = document.getElementById('focus-btn');
  if (focusBtn) {
    const note = state.notes.find((n) => n.id === state.activeId);
    const isFocusable =
      !!state.activeId && !(note?.type === 'task' && note?.completed);
    focusBtn.hidden = !isFocusable;
    const isActiveInFocus = state.focusIds.includes(state.activeId);
    focusBtn.classList.toggle(
      'is-active',
      state.activeId !== null && isActiveInFocus,
    );
    focusBtn.title = t(isActiveInFocus ? 'focus_remove_title' : 'focus_title');
  }
  const noteMeta = document.getElementById('note-meta');
  const isTask =
    (state.activeId &&
      state.notes.find((n) => n.id === state.activeId)?.type === 'task') ||
    (!state.activeId && state.pendingType === 'task');
  if (noteMeta) noteMeta.hidden = !isTask;
  if (dueWrapper) dueWrapper.hidden = !isTask;
  if (dueInput && !state.activeId) dueInput.value = '';
  updateDueDisplay();
  const importantBtn = document.getElementById('important-btn');
  if (importantBtn) {
    const note = state.notes.find((n) => n.id === state.activeId);
    const isTask = note?.type === 'task';
    importantBtn.hidden = !state.activeId;
    importantBtn.classList.toggle('is-active', !!note?.important);
    importantBtn.title = t(
      note?.important ? 'important_remove_title' : 'important_title',
    );
  }
  updateNoteStatus();
  const timeInput = document.getElementById('due-time');
  const activeNote = state.notes.find((n) => n.id === state.activeId);
  const collapseBtn = document.getElementById('collapse-editor-btn');
  if (collapseBtn) {
    const listExpanded = document
      .getElementById('main-view')
      ?.classList.contains('list-expanded');
    collapseBtn.hidden = !!listExpanded;
  }
  const displayBtn = document.getElementById('due-display-btn');

  // Alarm pill wewnątrz due-bar
  const alarmPill = document.getElementById('due-alarm-pill');
  const alarmLabel = document.getElementById('alarm-label');
  if (alarmPill) {
    const reminder = activeNote?.reminder ?? 0;
    const hasTime = !!timeInput?.value;
    alarmPill.hidden = !hasTime || reminder === 0;
    if (alarmLabel && hasTime && reminder > 0) {
      alarmLabel.textContent =
        reminder === 60
          ? t('dueReminder_1h')
          : t('dueReminder_Nmin', [String(reminder)]);
    }
  }
  if (displayBtn) {
    displayBtn.classList.toggle('has-value', !!dueInput?.value);
  }
  document.dispatchEvent(
    new CustomEvent('reminderChanged', {
      detail: { value: activeNote?.reminder ?? 0 },
    }),
  );

  const recurrenceBadge = document.getElementById('due-recurrence-badge');
  if (recurrenceBadge) {
    recurrenceBadge.hidden = !activeNote?.recurrence || !activeNote?.due;
    if (activeNote?.recurrence) {
      const DAY_NAMES = [
        t('day_short_0'),
        t('day_short_1'),
        t('day_short_2'),
        t('day_short_3'),
        t('day_short_4'),
        t('day_short_5'),
        t('day_short_6'),
      ];
      let _label = '';
      if (
        activeNote.recurrence === 'custom' &&
        Array.isArray(activeNote.recurrenceDays)
      ) {
        _label = activeNote.recurrenceDays
          .map((d) => DAY_NAMES[d] ?? '')
          .join(', ');
      } else if (activeNote.recurrence === 'weekly' && activeNote.due) {
        const dayName = DAY_NAMES[new Date(activeNote.due).getDay()];
        _label = `${t('recurrence_weekly')} (${dayName})`;
      } else {
        _label =
          {
            daily: t('recurrence_daily'),
            monthly: t('recurrence_monthly'),
            yearly: t('recurrence_yearly'),
          }[activeNote.recurrence] ?? '';
      }
      recurrenceBadge.title = _label;
      recurrenceBadge.dataset.tooltipContent = _label;
    } else {
      recurrenceBadge.title = '';
      recurrenceBadge.dataset.tooltipContent = '';
    }
  }
  document.dispatchEvent(
    new CustomEvent('recurrenceChanged', {
      detail: { value: activeNote?.recurrence ?? null },
    }),
  );
}
/* ── Render ───────────────────────────────────── */
export function clearFilters() {
  state.searchQuery = '';
  state.filterTags = [];
  state.filterType = 'all';
  state.filterHideCompleted = false;
  state.filterInProgress = false;
  state.filterDate = null;
  const dateInput = document.getElementById('filter-date');
  if (dateInput) dateInput.value = '';

  // Sync DOM — input wartości i klasy
  const searchInput = document.getElementById('search');
  if (searchInput) searchInput.value = '';

  document.querySelectorAll('#type-toggle .type-toggle__btn').forEach((b) => {
    b.classList.toggle('type-toggle__btn--active', b.dataset.type === 'all');
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
  const noteBtn = document.getElementById('new-note');
  const taskBtn = document.getElementById('new-task');
  if (!noteBtn || !taskBtn) return;

  // W zen mode filterType jest wymuszany na 'task' (patrz app.js handler type-toggle)
  const activeType = state.zenMode ? 'task' : state.filterType;

  noteBtn.classList.toggle('new-item-link--active', activeType === 'note');
  taskBtn.classList.toggle('new-item-link--active', activeType === 'task');
}

function _nextDueDate(due, recurrence, recurrenceDays = null) {
  const d = new Date(due);
  switch (recurrence) {
    case 'daily':
      d.setDate(d.getDate() + 1);
      break;
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'monthly':
      d.setMonth(d.getMonth() + 1);
      break;
    case 'yearly':
      d.setFullYear(d.getFullYear() + 1);
      break;
    case 'custom': {
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
  notesList.innerHTML = '';

  // Klasy zen / main-view — ustawiaj zawsze, niezależnie od zawartości listy
  notesList.classList.toggle('zen-active', state.zenMode);
  document
    .getElementById('main-view')
    ?.classList.toggle('zen-mode', state.zenMode);

  const filtered = state.notes.filter((note) => {
    const q = state.searchQuery.toLowerCase();
    const text = (note.content || '').replace(/<[^>]+>/g, '').toLowerCase();

    const matchesSearch =
      (note.title || '').toLowerCase().includes(q) || text.includes(q);
    const matchesTags =
      state.filterTags.length === 0 ||
      state.filterTags.every((id) => note.tags?.includes(id));
    const matchesType = state.zenMode
      ? note.type === 'task'
      : state.filterType === 'all' || note.type === state.filterType;
    const matchesCompleted =
      !state.filterHideCompleted || !(note.type === 'task' && note.completed);
    const matchesInProgress =
      !state.filterInProgress || state.focusIds.includes(note.id);

    const matchesDate = !state.filterDate
      ? true
      : note.type === 'task' &&
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
    state.searchQuery === '' &&
    state.filterTags.length === 0 &&
    state.filterType === 'all' &&
    !state.filterHideCompleted &&
    !state.filterInProgress &&
    !state.filterDate;

  if (
    filtered.length === 0 &&
    !state.zenMode &&
    (state.notes.length === 0 || noFilters)
  ) {
    const empty = document.createElement('div');
    empty.className = 'notes-empty';
    empty.textContent = t('list_empty');
    notesList.appendChild(empty);
    updateDeleteState();
    _updateNewItemHint();
    return;
  }

  if (filtered.length === 0 && !state.zenMode) {
    const empty = document.createElement('div');
    empty.className = 'notes-empty notes-empty--filtered';

    const onlyTypeFilter =
      state.filterType !== 'all' &&
      state.searchQuery === '' &&
      state.filterTags.length === 0 &&
      !state.filterHideCompleted;

    let msgKey = 'list_empty_filtered';
    if (onlyTypeFilter) {
      msgKey =
        state.filterType === 'note'
          ? 'list_empty_noNotes'
          : 'list_empty_noTasks';
    }

    const msg = document.createElement('span');
    msg.className = 'notes-empty__msg';
    msg.textContent = t(msgKey);

    const clearBtn = document.createElement('button');
    clearBtn.className = 'btn notes-empty__clear';
    clearBtn.textContent = t('list_empty_filtered_clearBtn');
    clearBtn.onclick = () => {
      clearFilters();
      const filterDateInput = document.getElementById('filter-date');
      if (filterDateInput) filterDateInput.value = '';
      const filterDateClear = document.getElementById('filter-date-clear');
      if (filterDateClear) filterDateClear.hidden = true;
      document.dispatchEvent(new CustomEvent('filterChanged'));
    };

    empty.appendChild(msg);
    empty.appendChild(clearBtn);
    notesList.appendChild(empty);
    updateDeleteState();
    _updateNewItemHint();
    return;
  }

  // Grupowanie w buckety
  const buckets = {};
  filtered.forEach((note) => {
    const key = _bucketFor(note);
    (buckets[key] ||= []).push(note);
  });

  // Sortowanie wewnątrz sekcji
  Object.entries(buckets).forEach(([key, items]) => {
    if (key === 'done') {
      items.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
    } else if (key === 'notes') {
      items.sort((a, b) => b.created - a.created);
    } else {
      items.sort((a, b) => {
        if (state.focusIds.includes(a.id)) return -1;
        if (state.focusIds.includes(b.id)) return 1;
        if (!!b.important !== !!a.important) return b.important ? 1 : -1;
        const aVal = a.due ?? a.created;
        const bVal = b.due ?? b.created;
        return key === 'unscheduled' ? bVal - aVal : aVal - bVal;
      });
    }
  });

  // ── Zen mode ──────────────────────────────────
  if (state.zenMode) {
    // Wyszukiwanie aktywne + brak wyników — nie mylić z "Wszystko ogarnięte"
    if (filtered.length === 0 && state.searchQuery) {
      const empty = document.createElement('div');
      empty.className = 'notes-empty notes-empty--filtered';
      const msg = document.createElement('span');
      msg.className = 'notes-empty__msg';
      msg.textContent = t('list_empty_filtered');
      empty.appendChild(msg);
      notesList.appendChild(empty);
      updateDeleteState();
      _updateNewItemHint();
      return;
    }

    const hasItems = ['overdue', 'today'].some(
      (key) => buckets[key]?.length > 0,
    );

    if (!hasItems) {
      const empty = document.createElement('div');
      empty.className = 'zen-empty';
      const zenCheck = document.createElement('span');
      zenCheck.className = 'zen-empty__check';
      zenCheck.textContent = '✓';
      const zenTitle = document.createElement('span');
      zenTitle.className = 'zen-empty__title';
      zenTitle.textContent = t('zen_allClear_title');
      const zenSub = document.createElement('span');
      zenSub.className = 'zen-empty__sub';
      zenSub.textContent = t('zen_allClear_sub');
      empty.appendChild(zenCheck);
      empty.appendChild(zenTitle);
      empty.appendChild(zenSub);
      notesList.appendChild(empty);
      updateDeleteState();
      _updateNewItemHint();
      return;
    }

    ['overdue', 'today'].forEach((key) => {
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

function _renderSection(key, items) {
  const isCollapsed = state.collapsedSections.includes(key);

  let countLabel = `${items.length}`;

  if (key === 'today') {
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).getTime();
    const todayEnd = todayStart + 86400000;
    const allToday = state.notes.filter(
      (n) => n.type === 'task' && n.due >= todayStart && n.due < todayEnd,
    );
    const done = allToday.filter((n) => n.completed).length;
    const total = allToday.length;
    countLabel = done > 0 ? `${done}/${total}` : `${total}`;
  }

  const header = document.createElement('button');
  header.className =
    'section-header' + (isCollapsed ? ' section-header--collapsed' : '');
  header.dataset.section = key;

  const label = document.createElement('span');
  label.className = 'section-header__label';
  label.textContent = _sectionLabel(key);

  const meta = document.createElement('span');
  meta.className = 'section-header__meta';

  const count = document.createElement('span');
  count.className = 'section-header__count';
  count.textContent = countLabel;

  const chevron = document.createElement('span');
  chevron.className = 'section-header__chevron';
  chevron.textContent = isCollapsed ? '▸' : '▾';

  meta.appendChild(count);
  meta.appendChild(chevron);
  header.appendChild(label);
  header.appendChild(meta);

  header.onclick = () => _toggleSection(key);
  notesList.appendChild(header);
  if (!isCollapsed) items.forEach(_renderNoteItem);
}

function _toggleSection(key) {
  const idx = state.collapsedSections.indexOf(key);
  if (idx === -1) state.collapsedSections.push(key);
  else state.collapsedSections.splice(idx, 1);
  saveCollapsedSections(state.collapsedSections);
  renderList();
}

function _renderNoteItem(note) {
  const div = document.createElement('div');
  div.className = 'note-item';
  div.dataset.id = note.id;
  div.tabIndex = 0;
  if (note.id === state.activeId) div.classList.add('active-note');
  if (note.type === 'task' && note.completed)
    div.classList.add('note-item--completed');

  // Checkbox dla tasków
  if (note.type === 'task') {
    const cb = document.createElement('button');
    cb.className =
      'note-checkbox' + (note.completed ? ' note-checkbox--on' : '');
    cb.textContent = note.completed ? '✓' : '';
    cb.setAttribute(
      'aria-label',
      t(note.completed ? 'task_markIncomplete' : 'task_markComplete'),
    );
    cb.onclick = (e) => {
      e.stopPropagation();
      toggleCompleted(note.id);
    };
    div.appendChild(cb);
  }

  // Tytuł — fallback: fragment treści, ostateczność: "Bez tytułu"
  const title = document.createElement('span');
  title.className = 'note-item__title';
  const _titleText = note.title?.trim();
  const _previewFull = !_titleText ? _contentPreview(note.content, 120) : null;
  const _previewShort = !_titleText ? _contentPreview(note.content, 30) : null;

  title.textContent = _titleText || _previewShort || t('note_untitled');

  // Hover tooltip — pełny podgląd gdy tytuł pochodzi z treści
  if (!_titleText && _previewFull && _previewFull !== _previewShort) {
    title.dataset.tooltipContent = _previewFull;
  }
  title.onclick = () => selectNote(note.id);
  div.appendChild(title);

  // Ikona recurrence
  if (note.recurrence) {
    const rec = document.createElement('span');
    rec.className = 'note-item__recurrence';
    rec.textContent = '↺';
    const DAY_NAMES = [
      t('day_short_0'),
      t('day_short_1'),
      t('day_short_2'),
      t('day_short_3'),
      t('day_short_4'),
      t('day_short_5'),
      t('day_short_6'),
    ];
    let recLabel;
    if (note.recurrence === 'custom' && Array.isArray(note.recurrenceDays)) {
      recLabel = note.recurrenceDays.map((d) => DAY_NAMES[d] ?? '').join(', ');
    } else if (note.recurrence === 'weekly' && note.due) {
      const dayName = DAY_NAMES[new Date(note.due).getDay()];
      recLabel = `${t('recurrence_weekly')} (${dayName})`;
    } else {
      recLabel =
        {
          daily: t('recurrence_daily'),
          monthly: t('recurrence_monthly'),
          yearly: t('recurrence_yearly'),
          custom: t('recurrence_custom'),
        }[note.recurrence] ?? t('recurrence_ariaLabel');
    }
    rec.setAttribute('aria-label', recLabel);
    rec.title = recLabel;
    div.appendChild(rec);
  }

  // Gwiazdka
  if (note.important) {
    const star = document.createElement('span');
    star.className = 'note-item__star';
    star.textContent = '★';
    star.setAttribute('aria-label', t('important_ariaLabel'));
    div.appendChild(star);
  }
  // focus
  if (state.focusIds.includes(note.id)) div.classList.add('note-item--focused');
  // Due indicator — jeden, z godziną jeśli ustawiona
  if (note.type === 'task' && note.due && !note.completed) {
    let label = _formatDueRelative(note.due);
    if (note.time) label += ` ${note.time}`;
    if (label) {
      const dueSpan = document.createElement('span');
      dueSpan.className = 'note-item__due';
      dueSpan.textContent = label;
      div.appendChild(dueSpan);
    }
  }

  // Preview button
  const previewBtn = document.createElement('button');
  previewBtn.className = 'note-item__preview icon--preview';
  previewBtn.setAttribute('aria-label', t('note_preview_ariaLabel'));
  previewBtn.onclick = (e) => e.stopPropagation();
  const previewText = _stripHtml(note.content);
  previewBtn.title = previewText
    ? previewText.length > 160
      ? previewText.slice(0, 160) + '…'
      : previewText
    : t('note_preview_empty');
  div.appendChild(previewBtn);

  // Delete button
  const delBtn = document.createElement('button');
  delBtn.className = 'note-item__delete';
  delBtn.textContent = '✕';
  delBtn.setAttribute('aria-label', t('note_deleteItem_ariaLabel'));
  delBtn.onclick = (e) => {
    e.stopPropagation();
    _deleteAndMoveFocus(note.id, div);
  };
  div.appendChild(delBtn);

  // Tagi (max 2 + "+N")
  const tags = note.tags ?? [];
  if (tags.length > 0) {
    const row = document.createElement('div');
    row.className = 'note-tags-row';
    tags.slice(0, 2).forEach((id) => {
      const tag = getTag(id);
      if (tag) row.appendChild(makeTagPill(tag, { truncate: 12 }));
    });
    if (tags.length > 2) {
      const more = document.createElement('span');
      more.className = 'tag-more';
      more.textContent = `+${tags.length - 2}`;
      row.appendChild(more);
    }
    div.appendChild(row);
  }
  // Nawigacja klawiaturowa
  div.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        selectNote(note.id);
        setTimeout(() => titleInput.focus(), 50);
        break;

      case ' ':
        if (note.type === 'task') {
          e.preventDefault();
          toggleCompleted(note.id);
        }
        break;

      case 'Delete':
        e.preventDefault();
        _deleteAndMoveFocus(note.id, div);
        break;

      case 'ArrowDown': {
        e.preventDefault();
        let next = div.nextElementSibling;
        while (next && !next.classList.contains('note-item'))
          next = next.nextElementSibling;
        if (next) next.focus();
        break;
      }

      case 'ArrowUp': {
        e.preventDefault();
        let prev = div.previousElementSibling;
        while (prev && !prev.classList.contains('note-item'))
          prev = prev.previousElementSibling;
        if (prev) prev.focus();
        break;
      }
    }
  });
  notesList.appendChild(div);
}

function _deleteAndMoveFocus(id, el) {
  // zapamiętaj sąsiada przed usunięciem
  let nextEl = el.nextElementSibling;
  while (nextEl && !nextEl.classList.contains('note-item'))
    nextEl = nextEl.nextElementSibling;
  if (!nextEl) {
    let prevEl = el.previousElementSibling;
    while (prevEl && !prevEl.classList.contains('note-item'))
      prevEl = prevEl.previousElementSibling;
    nextEl = prevEl;
  }
  const nextId = nextEl?.dataset?.id;

  _deleteNoteCore(id);
  renderList();

  // przeskocz fokus do sąsiedniego elementu po re-renderze
  if (nextId) {
    const target = document.querySelector(
      `#notesList .note-item[data-id="${nextId}"]`,
    );
    if (target) target.focus();
  }
}

export function quickCapture(raw) {
  const item = buildItemFromCapture(raw);
  if (!item) return null;

  state.notes.unshift(item);
  if ((item.important || item.focus) && item.type === 'task') {
    if (!state.focusIds.includes(item.id)) {
      state.focusIds.push(item.id);
    }
    saveFocusId(state.focusIds);
  }
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
      el.classList.add('note-item--flash');
      setTimeout(() => el.classList.remove('note-item--flash'), 800);
    }
  }, 30);
  return item;
}

export function toggleImportant(id) {
  const note = state.notes.find((n) => n.id === id);
  if (!note) return;
  note.important = !note.important;
  saveNotes(state.notes);
  renderList();
  updateDeleteState();
}

export function updateActiveFilters() {
  const bar = document.getElementById('active-filters');
  if (!bar) return;

  // Usuń tylko pille — zostaw label
  bar.querySelectorAll('.active-filter-pill').forEach((el) => el.remove());
  const pills = [];

  // Data
  if (state.filterDate) {
    const d = new Date(state.filterDate);
    const label = new Intl.DateTimeFormat(getUILocale(), {
      day: 'numeric',
      month: 'short',
    }).format(d);
    pills.push({
      label,
      onRemove: () => {
        state.filterDate = null;
        const inp = document.getElementById('filter-date');
        if (inp) inp.value = '';
        const clr = document.getElementById('filter-date-clear');
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
        if (pill) pill.classList.remove('tag-pill--filter-active');
      },
    });
  });

  // Ukryj zakończone
  if (state.filterHideCompleted) {
    pills.push({
      label: t('filter_hideCompleted_short'),
      onRemove: () => {
        state.filterHideCompleted = false;
        saveFilterPrefs({ hideCompleted: false });
        const cb = document.querySelector(
          '#filter-options input[type="checkbox"]',
        );
        if (cb) cb.checked = false;
      },
    });
  }

  if (state.filterInProgress) {
    pills.push({
      label: t('filter_inProgress_short'),
      onRemove: () => {
        state.filterInProgress = false;
        renderList();
      },
    });
  }

  bar.hidden = pills.length === 0;

  pills.forEach(({ label, color, onRemove }) => {
    const pill = document.createElement('span');
    pill.className = 'active-filter-pill';
    if (color) {
      pill.style.setProperty('--tag-bg', color.bg);
      pill.style.setProperty('--tag-fg', color.fg);
      pill.classList.add('active-filter-pill--tag');
    }

    const text = document.createElement('span');
    text.textContent = label;

    const btn = document.createElement('button');
    btn.className = 'active-filter-pill__remove';
    btn.textContent = '×';
    btn.setAttribute('aria-label', t('filter_remove_ariaLabel'));
    btn.onclick = () => {
      onRemove();
      renderList();
      updateActiveFilters();
      document.dispatchEvent(new CustomEvent('filterChanged'));
    };

    pill.appendChild(text);
    pill.appendChild(btn);
    bar.appendChild(pill);
  });
}
