/* ══════════════════════════════════════════════════════════════
   popup.js — logika mikro-okna quick capture
   ══════════════════════════════════════════════════════════════ */

import { buildItemFromCapture } from './quick-capture-core.js';
import { scheduleAlarm, isAlarmable } from './alarms.js';
import { parseCapture } from './parser.js';

const input         = document.getElementById('popup-input');
const capture       = document.getElementById('popup-capture');
const feedback      = document.getElementById('popup-feedback');
const titleEl       = document.getElementById('popup-title');
const hint          = document.getElementById('popup-hint');
const helpBtn       = document.getElementById('popup-help-btn');
const helpPanel     = document.getElementById('popup-help-panel');
const syntaxBody    = document.getElementById('popup-help-syntax');
const escHint   = document.getElementById('popup-esc-hint');
const preview   = document.getElementById('popup-preview');
// ── i18n ────────────────────────────────────────

function t(key, subs) {
  return browser.i18n.getMessage(key, subs) || key;
}

// ── Safe rich-text helper ────────────────────────
//
// Zamiast innerHTML = t(key), który przyjmuje surowy HTML z pliku locale
// (zewnętrzne źródło danych), używamy DOMParser + whitelist.
// Dozwolone tagi: kbd, code, strong, em, br, span — wystarczające do
// formatowania podpowiedzi. Wszystko inne sprowadzane do textContent.
// Atrybuty: żadne (popup nie potrzebuje href ani class z tłumaczeń).
//
// Wektor: plik _locales/*/messages.json jest bundlowany w XPI, ale po
// instalacji leży na dysku profilu użytkownika i jest odczytywalny.
// Podmianka pliku locale przez złośliwe oprogramowanie + innerHTML
// = potencjalny XSS. _setRichText eliminuje tę powierzchnię ataku.

const HINT_ALLOWED_TAGS = new Set(['KBD', 'CODE', 'STRONG', 'EM', 'BR', 'SPAN', 'DIV', 'LI', 'UL', 'P']);

function _setRichText(el, html) {
  if (!html || typeof html !== 'string') { el.textContent = ''; return; }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  el.textContent = '';
  _copyNodes(doc.body, el);
}

function _copyNodes(src, dst) {
  for (const child of src.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      dst.appendChild(document.createTextNode(child.textContent));
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      if (HINT_ALLOWED_TAGS.has(child.tagName)) {
        const clone = document.createElement(child.tagName.toLowerCase());
        // Brak kopiowania atrybutów — popup nie potrzebuje href/class z locale
        _copyNodes(child, clone);
        dst.appendChild(clone);
      } else {
        // Niedozwolony tag — zachowaj tylko tekst
        dst.appendChild(document.createTextNode(child.textContent));
      }
    }
  }
}

// ── Color scheme — zastosuj przed renderem ───────
// Odczyt synchroniczny nie istnieje w WebExtensions —
// stosujemy data-theme zanim DOM zostanie wyrenderowany
// przez ukrycie body do czasu załadowania schematu.

browser.storage.local.get('uiSettings').then((res) => {
  const scheme = res.uiSettings?.colorScheme ?? 'auto';
  if (scheme === 'auto') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.dataset.theme = scheme;
  }
}).catch(() => {
  // Brak danych — zostaje auto (system preference)
});

// ── Init ────────────────────────────────────────

titleEl.textContent = t('popup_title');
input.placeholder = t('popup_placeholder');
_setRichText(hint, t('popup_hint_main'));
helpBtn.title = t('popup_help_title');
_setRichText(escHint, t('popup_esc_hint'));
_setRichText(syntaxBody, t('popup_help_syntax_body'));

input.addEventListener('input', () => {
  _updateTypeIndicator();
  _updatePreview();
});
_updateTypeIndicator();
_updatePreview();

// ── Help panel toggle ──────────────────────────

helpBtn.addEventListener('click', () => {
  const wasOpen = helpBtn.getAttribute('aria-expanded') === 'true';
  helpBtn.setAttribute('aria-expanded', String(!wasOpen));
  helpPanel.hidden = wasOpen;
});

// ── Preview ─────────────────────────────────────

function _updatePreview() {
  if (!preview) return;
  const raw = input.value.trim();

  if (!raw) {
    preview.hidden = true;
    preview.textContent = '';
    return;
  }

  const { isTask, title, due, time } = parseCapture(raw);

  let text = '';

  if (!isTask) {
    text = title
      ? t('quickCapture_preview_note_titled', [title])
      : t('quickCapture_preview_note_empty');
  } else {
    let dateCtx = '';
    if (due) {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const dayMs = 86400000;
      let dateStr;
      if (due >= today && due < today + dayMs) {
        dateStr = t('due_today');
      } else if (due >= today + dayMs && due < today + 2 * dayMs) {
        dateStr = t('due_tomorrow');
      } else {
        dateStr = new Intl.DateTimeFormat(browser.i18n.getUILanguage(), {
          day: 'numeric', month: 'short'
        }).format(new Date(due));
      }
      dateCtx = time
        ? t('quickCapture_preview_date_time', [dateStr, time])
        : dateStr;
    }

    if (dateCtx && title) {
      text = t('quickCapture_preview_task_dated_titled', [dateCtx, title]);
    } else if (dateCtx) {
      text = t('quickCapture_preview_task_dated', [dateCtx]);
    } else if (title) {
      text = t('quickCapture_preview_task_titled', [title]);
    } else {
      text = t('quickCapture_preview_task_empty');
    }
  }

  preview.textContent = text;
  preview.hidden = false;
  preview.dataset.type = isTask ? 'task' : 'note';
}

// ── Type indicator (ikona w inpucie) ───────────

function _updateTypeIndicator() {
  const isTask = input.value.startsWith('!');
  capture.classList.toggle('popup-capture--task', isTask);
}

// ── Keyboard handler ────────────────────────────

input.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape') {
    window.close();
    return;
  }

  if (e.key !== 'Enter') return;
  e.preventDefault();
  preview.hidden = true;

  const raw = input.value.trim();
  if (!raw) return;

  const item = buildItemFromCapture(raw);
  if (!item) return;

  const isTask = item.type === 'task';

  // Flaga focus z parsera to jednorazowy seed — źródłem prawdy stanu
  // "w trakcie" jest tablica focusId w storage, nie pole na notatce.
  const wantsFocus = (item.focus || item.important) && isTask;
  delete item.focus;

  try {
    const res = await browser.storage.local.get(['notes', 'focusId']);
    const notes = res.notes || [];
    notes.unshift(item);
    await browser.storage.local.set({ notes });

    if (wantsFocus) {
      const focusIds = Array.isArray(res.focusId) ? res.focusId : [];
      if (!focusIds.includes(item.id)) {
        focusIds.push(item.id);
        await browser.storage.local.set({ focusId: focusIds });
      }
    }

    if (isAlarmable(item)) {
      scheduleAlarm(item);
    }

    // Sidebar odświeża się sam przez storage.onChanged (zapisy powyżej
    // pochodzą z innego kontekstu niż sidebar) — osobny komunikat zbędny.

    if (e.shiftKey) {
      browser.runtime.sendMessage({ action: 'openAndSelect', noteId: item.id }).catch(() => {});
      browser.sidebarAction.open();
      window.close();
    } else {
      _showFeedback(
        isTask ? t('popup_added_task') : t('popup_added_note'),
        isTask ? 'task' : 'note'
      );
      input.value = '';
      _updateTypeIndicator();
    }
  } catch (err) {
    _showFeedback(t('popup_error'), 'error');
  }
});

// ── Feedback ────────────────────────────────────

function _showFeedback(text, variant) {
  feedback.textContent = text;
  feedback.className = 'popup-feedback popup-feedback--visible popup-feedback--' + variant;
  setTimeout(() => {
    feedback.className = 'popup-feedback popup-feedback--' + variant;
  }, 1500);
}