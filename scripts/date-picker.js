/**
 * date-picker.js — custom date + time picker popover
 *
 * Layout:
 *   - Kalendarz z nawigacją miesięcy
 *   - Stopka: [Dziś] [Jutro] [🗓×]
 *             [🕐 --:--]
 *             [↺ —] [Codz.] [Tydz.] [Mies.] [Rok]
 *
 * #due-date i #due-time zostają jako hidden inputs — wartości + event targets.
 * Istniejące change handlery w app.js działają bez zmian.
 * #due-display-btn — wizualny element pokazujący "30 maj · 12:12".
 *
 * Publiczne API:
 *   initDatePicker()              — wywołaj raz z boot
 *   syncDatePicker(dateStr|null)  — sync przy selectNote / due-clear
 *   syncRecurrence(value|null)    — sync recurrence przy selectNote
 *   updateDueDisplay()            — odśwież #due-display-btn (wywoływane z notes.js)
 */

import { getUILocale, getShortWeekdays, t } from './i18n.js';

let _popover        = null;
let _dateInput      = null; // #due-date (hidden)
let _timeInput      = null; // #due-time (hidden)
let _viewYear       = null;
let _viewMonth      = null;
let _selected       = null; // "YYYY-MM-DD" | null
let _recurrence     = null; // "daily"|"weekly"|"monthly"|"yearly"|null
let _recurrenceDays = [1, 2, 3, 4, 5]; // domyślnie pn-pt
let _currentReminder = 0;

/* ── Public API ────────────────────────────────── */

export function initDatePicker() {
  _popover   = document.getElementById('date-picker-popover');
  _dateInput = document.getElementById('due-date');
  _timeInput = document.getElementById('due-time');
  if (!_popover || !_dateInput) return;

  // Display button otwiera picker
  const displayBtn = document.getElementById('due-display-btn');
  if (displayBtn) {
    displayBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      _popover.hidden ? _open() : _close();
    });
    displayBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        _popover.hidden ? _open() : _close();
      }
      if (e.key === 'Escape') _close();
    });
  }

  // Prev / next month
  document
    .getElementById('date-picker-prev')
    ?.addEventListener('click', (e) => {
      e.stopPropagation();
      _viewMonth--;
      if (_viewMonth < 0) { _viewMonth = 11; _viewYear--; }
      _renderCalendar();
    });
  document
    .getElementById('date-picker-next')
    ?.addEventListener('click', (e) => {
      e.stopPropagation();
      _viewMonth++;
      if (_viewMonth > 11) { _viewMonth = 0; _viewYear++; }
      _renderCalendar();
    });

  // Preset: Dziś / Jutro
  _popover.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const date = _presetDate(btn.dataset.preset);
      if (date) _selectDate(date);
    });
  });

  // Clear date
  document
    .getElementById('date-picker-clear')
    ?.addEventListener('click', () => {
      _selected = null;
      _dateInput.value = '';
      if (_timeInput) _timeInput.value = '';
      const tpi = document.getElementById('date-picker-time-input');
      if (tpi) tpi.value = '';
      _dateInput.dispatchEvent(new Event('change', { bubbles: true }));
      updateDueDisplay();
      _renderCalendar();
      _renderFooter();
      _close();
    });

  // Time input w pickerze
  const timePickerInput = document.getElementById('date-picker-time-input');
  if (timePickerInput) {
    timePickerInput.addEventListener('change', () => {
      if (_timeInput) {
        _timeInput.value = timePickerInput.value;
        _timeInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      _updateReminderHint(_currentReminder);
      updateDueDisplay();
    });
  }

  // Reminder select
  const reminderSelect = document.getElementById('date-picker-reminder-select');
  if (reminderSelect) {
    reminderSelect.addEventListener('change', () => {
      const val = Number(reminderSelect.value);
      document.dispatchEvent(
        new CustomEvent('reminderFromPicker', { detail: { value: val } }),
      );
      _syncReminderRow(val);
      _updateAlarmPill(val);
      _updateReminderHint(val);
    });
  }

// Recurrence buttons
  _popover.querySelectorAll('[data-recurrence]').forEach((btn) => {
    btn.addEventListener('click', () => {
      _selectRecurrence(btn.dataset.recurrence || null);
    });
  });

  // Day-of-week buttons (custom recurrence)
  _popover.querySelectorAll('[data-day]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const day = Number(btn.dataset.day);
      const idx = _recurrenceDays.indexOf(day);
      if (idx !== -1 && _recurrenceDays.length > 1) {
        _recurrenceDays = _recurrenceDays.filter(d => d !== day);
      } else if (idx === -1) {
        _recurrenceDays = [..._recurrenceDays, day].sort((a, b) => a - b);
      }
      _renderDaysRow();
      document.dispatchEvent(new CustomEvent('recurrenceFromPicker', {
        detail: { value: 'custom', days: _recurrenceDays },
      }));
    });
  });

  // Grid — delegacja
  document
    .getElementById('date-picker-grid')
    ?.addEventListener('click', (e) => {
      const day = e.target.closest('[data-date]');
      if (!day || day.disabled) return;
      _selectDate(day.dataset.date);
    });

  // Sync przy zmianie notatki
  document.addEventListener('dueDateChanged', (e) => {
    syncDatePicker(e.detail.dateStr);
  });
  document.addEventListener('recurrenceChanged', (e) => {
    syncRecurrence(e.detail.value);
  });

  // Zamknij poza
  document.addEventListener('click', (e) => {
    if (
      !e.target.closest('#date-picker-popover') &&
      !e.target.closest('#due-display-btn') &&
      !e.target.closest('.due-wrapper')
    ) _close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !_popover.hidden) {
      e.stopPropagation();
      _close();
    }
  });
}

export function syncDatePicker(dateStr) {
  _selected = dateStr || null;
}

export function syncRecurrence(value) {
  _recurrence = value || null;
}

export function syncRecurrenceDays(days) {
  _recurrenceDays = Array.isArray(days) && days.length > 0 ? days : [1, 2, 3, 4, 5];
}

export function syncReminder(value) {
  _currentReminder = Number(value) || 0;
}

export function updateDueDisplay() {
  const dateTextEl = document.getElementById('due-date-text');
  const btn        = document.getElementById('due-display-btn');
  if (!dateTextEl || !btn) return;

  const dateVal = _dateInput?.value;
  const timeVal = _timeInput?.value;

  if (!dateVal) {
    dateTextEl.textContent = t('dueDate_placeholder');
    btn.classList.remove('has-value');
    return;
  }

  const [y, m, d] = dateVal.split('-').map(Number);
  const dateObj   = new Date(y, m - 1, d);
  const now       = new Date();
  now.setHours(0, 0, 0, 0);
  const tomorrow  = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  const dateFormatted = new Intl.DateTimeFormat(getUILocale(), {
    day: 'numeric', month: 'short',
  }).format(dateObj);

  let relLabel = '';
  if (dateObj.getTime() === now.getTime())
    relLabel = ` (${t('common_today')})`;
  else if (dateObj.getTime() === tomorrow.getTime())
    relLabel = ` (${t('common_tomorrow')})`;

  const datePart = `${dateFormatted}${relLabel}`;
  dateTextEl.textContent = timeVal ? `${datePart} · ${timeVal}` : datePart;
  btn.classList.add('has-value');
}

/* ── Prywatne ──────────────────────────────────── */

function _open() {
  const now = new Date();
  _viewYear  = now.getFullYear();
  _viewMonth = now.getMonth();

  if (_selected) {
    const [y, m] = _selected.split('-').map(Number);
    _viewYear  = y;
    _viewMonth = m - 1;
  }

  // Sync time picker z aktualną wartością
  const tpi = document.getElementById('date-picker-time-input');
  if (tpi && _timeInput) tpi.value = _timeInput.value || '';

  _syncReminderRow(_currentReminder);
  const reminderSel = document.getElementById('date-picker-reminder-select');
  if (reminderSel) reminderSel.value = String(_currentReminder);
  _updateReminderHint(_currentReminder);
  _renderCalendar();
  _renderFooter();
  _popover.hidden = false;

  requestAnimationFrame(() => {
    const anchor =
      document.getElementById('due-display-btn') ||
      document.getElementById('due-wrapper');
    if (!anchor) return;
    const rect       = anchor.getBoundingClientRect();
    const ph         = _popover.offsetHeight || 300;
    const pw         = _popover.offsetWidth  || 240;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top  = spaceBelow >= ph + 4 ? rect.bottom + 4 : rect.top - ph - 4;
    const left = Math.max(4, Math.min(rect.left, window.innerWidth - pw - 4));
    _popover.style.top  = `${top}px`;
    _popover.style.left = `${left}px`;
  });
}

function _close() {
  if (_popover) _popover.hidden = true;
  const hint = document.getElementById('date-picker-reminder-hint');
  if (hint) hint.hidden = true;
}

function _selectDate(dateStr) {
  _selected          = dateStr;
  _dateInput.value   = dateStr;
  _renderCalendar();
  _renderFooter();
  updateDueDisplay();
  _dateInput.dispatchEvent(new Event('change', { bubbles: true }));
  const tpi = document.getElementById('date-picker-time-input');
  if (tpi) tpi.focus();
}

function _selectRecurrence(value) {
  _recurrence = value || null;

  if (_recurrence && !_selected) {
    const todayStr = _toDateStr(_today());
    _selected        = todayStr;
    _dateInput.value = todayStr;
    _dateInput.dispatchEvent(new Event('change', { bubbles: true }));
    updateDueDisplay();

    const todayBtn = _popover.querySelector('[data-preset="today"]');
    if (todayBtn) {
      todayBtn.classList.add('is-active');
      setTimeout(() => todayBtn.classList.remove('is-active'), 2000);
    }
    _renderCalendar();
  }

  _renderFooter();
  document.dispatchEvent(
    new CustomEvent('recurrenceFromPicker', { detail: { value: _recurrence } }),
  );
}

function _toDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function _today() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function _presetDate(preset) {
  const d = _today();
  if (preset === 'today') return _toDateStr(d);
  if (preset === 'tomorrow') {
    d.setDate(d.getDate() + 1);
    return _toDateStr(d);
  }
  return null;
}

function _syncReminderRow(value) {
  _currentReminder = Number(value) || 0;
  const sel = document.getElementById('date-picker-reminder-select');
  if (sel) sel.value = String(_currentReminder);
}

function _updateAlarmPill(reminder) {
  const pill  = document.getElementById('due-alarm-pill');
  const label = document.getElementById('alarm-label');
  if (!pill) return;
  if (!_timeInput?.value || reminder === 0) {
    pill.hidden = true;
    return;
  }
  pill.hidden = false;
  if (label) {
    label.textContent =
      reminder === 60
        ? t('dueReminder_1h')
        : t('dueReminder_Nmin', [String(reminder)]);
  }
}

function _updateReminderHint(reminder) {
  let hint = document.getElementById('date-picker-reminder-hint');
  if (reminder > 0 && !_timeInput?.value) {
    if (!hint) {
      hint = document.createElement('p');
      hint.id        = 'date-picker-reminder-hint';
      hint.className = 'date-picker-reminder-hint';
      document.getElementById('date-picker-time-wrapper')
        ?.insertAdjacentElement('afterend', hint);
    }
    hint.textContent = t('datePicker_reminderNoTime');
    hint.hidden      = false;
  } else {
    if (hint) hint.hidden = true;
  }
}

function _renderCalendar() {
  const grid  = document.getElementById('date-picker-grid');
  const label = document.getElementById('date-picker-month-label');
  if (!grid || !label) return;

  const monthStr = new Intl.DateTimeFormat(getUILocale(), {
    month: 'long', year: 'numeric',
  }).format(new Date(_viewYear, _viewMonth, 1));
  label.textContent = monthStr.charAt(0).toUpperCase() + monthStr.slice(1);

  const weekdays    = getShortWeekdays();
  const weekdaysMon = [...weekdays.slice(1), weekdays[0]];

  const todayStr = _toDateStr(_today());
  const firstDay = new Date(_viewYear, _viewMonth, 1);
  const lastDate = new Date(_viewYear, _viewMonth + 1, 0).getDate();

  let startDow = firstDay.getDay();
  startDow     = startDow === 0 ? 6 : startDow - 1;

  grid.innerHTML = '';

  weekdaysMon.forEach((wd) => {
    const th = document.createElement('span');
    th.className  = 'date-picker-calendar__weekday';
    th.textContent = wd;
    grid.appendChild(th);
  });

  for (let i = 0; i < startDow; i++) {
    const empty = document.createElement('span');
    empty.className = 'date-picker-calendar__day date-picker-calendar__day--empty';
    grid.appendChild(empty);
  }

  for (let d = 1; d <= lastDate; d++) {
    const dateStr = `${_viewYear}-${String(_viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const btn     = document.createElement('button');
    btn.type        = 'button';
    btn.className   = 'date-picker-calendar__day';
    btn.textContent = d;
    btn.dataset.date = dateStr;
    if (dateStr === todayStr)  btn.classList.add('date-picker-calendar__day--today');
    if (dateStr === _selected) btn.classList.add('date-picker-calendar__day--selected');
    grid.appendChild(btn);
  }
}

function _renderFooter() {
  _popover.querySelectorAll('[data-preset]').forEach((btn) => {
    const date = _presetDate(btn.dataset.preset);
    btn.classList.toggle('is-active', !!date && date === _selected);
  });

  _popover.querySelectorAll('[data-recurrence]').forEach((btn) => {
    const val = btn.dataset.recurrence || null;
    btn.classList.toggle('is-active', val === _recurrence);
  });

  _renderDaysRow();
}

function _renderDaysRow() {
  const row = document.getElementById('date-picker-days-row');
  if (!row) return;
  row.hidden = _recurrence !== 'custom';
  if (_recurrence !== 'custom') return;
  row.querySelectorAll('[data-day]').forEach((btn) => {
    const day = Number(btn.dataset.day);
    btn.classList.toggle('is-active', _recurrenceDays.includes(day));
  });
}