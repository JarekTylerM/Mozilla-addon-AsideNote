// @ts-check
/* ══════════════════════════════════════════════════════════════
   shortcut-editor.js — zmiana skrótów dodatku w panelu Skróty
   ──────────────────────────────────────────────────────────────
   Skróty Alt+Shift+Q (panel) i Alt+Shift+S (szybkie dodawanie) są
   przechwytywane globalnie przez przeglądarkę, więc potrafią kolidować
   ze skrótem innego dodatku, samej przeglądarki albo programu spoza niej
   (wtedy po prostu nie działają). Panel pozwala je przestawić bez
   wychodzenia do about:addons.

   Wiersz do edycji oznacza w HTML data-shortcut-row="nazwa-komendy";
   w środku: <code data-command> (pokazuje skrót), przycisk
   data-shortcut-edit, przycisk data-shortcut-reset i miejsce na komunikat
   data-shortcut-status.

   Przechwytywanie klawiszy: nasłuch na window w fazie przechwytywania,
   żeby Alt+C i reszta skrótów sidebara nie odpaliły w trakcie nagrywania
   nowej kombinacji. Zamiana klawiszy na zapis skrótu — shortcut-keys.js.

   Chromium nie ma commands.update(): tam skrót zmienia się wyłącznie na
   stronie chrome://extensions/shortcuts. Rozszerzenie jej nie otworzy —
   wymagałoby to browser.tabs, a karta bezpieczeństwa (docs/SECURITY.md)
   obiecuje, że kod nie dotyka kart. Dlatego panel pokazuje sam adres do
   wklejenia, a przyciski chowa.
   ══════════════════════════════════════════════════════════════ */

import { t } from './i18n.js';
import {
  applyCommandShortcuts,
  canEditCommandShortcuts,
  commandShortcutLabel,
  currentCommandShortcuts,
  resetCommandShortcut,
  suggestedCommandShortcut,
  updateCommandShortcut,
} from './command-shortcuts.js';
import { conflictingCommand, previewLabel, shortcutFromEvent } from './shortcut-keys.js';

/** Opis komendy w komunikacie o zajętym skrócie. */
const COMMAND_LABEL_KEY = /** @type {Record<string, string>} */ ({
  'toggle-sidebar': 'shortcuts_general_toggle',
  _execute_browser_action: 'shortcuts_general_popup',
});

const isMac = /Mac/i.test(globalThis.navigator?.platform ?? '');

/** @type {{name: string, row: HTMLElement} | null} */
let _capturing = null;

/** @param {HTMLElement} row @param {string} sel */
const _pick = (row, sel) => /** @type {HTMLElement|null} */ (row.querySelector(sel));

/**
 * @param {HTMLElement} row
 * @param {string} text
 * @param {'' | 'error' | 'ok'} tone
 */
function setStatus(row, text, tone = '') {
  const el = _pick(row, '[data-shortcut-status]');
  if (!el) return;
  el.textContent = text;
  el.hidden = !text;
  el.classList.toggle('shortcut-row__status--error', tone === 'error');
  el.classList.toggle('shortcut-row__status--ok', tone === 'ok');
}

/** Przycisk „Domyślny” ma sens tylko wtedy, gdy skrót nie jest domyślny. */
function syncRow(/** @type {HTMLElement} */ row) {
  const name = row.dataset.shortcutRow ?? '';
  const suggested = suggestedCommandShortcut(name);
  const resetBtn = _pick(row, '[data-shortcut-reset]');
  if (resetBtn) {
    resetBtn.hidden = !suggested || currentCommandShortcuts()[name] === suggested;
    resetBtn.setAttribute('title', t('shortcut_reset_title', [suggested]));
  }
}

/** @param {ParentNode} [root] */
function syncRows(root = document) {
  for (const el of root.querySelectorAll('[data-shortcut-row]')) {
    syncRow(/** @type {HTMLElement} */ (el));
  }
}

/* ── Nagrywanie kombinacji ──────────────────────────────────── */

function stopCapture() {
  if (!_capturing) return;
  const { row } = _capturing;
  _capturing = null;
  window.removeEventListener('keydown', onKeyDown, true);
  window.removeEventListener('keyup', onKeyUp, true);
  window.removeEventListener('blur', cancelCapture);
  document.removeEventListener('pointerdown', onPointerDown, true);

  const code = _pick(row, '[data-command]');
  code?.classList.remove('is-capturing');
  const editBtn = _pick(row, '[data-shortcut-edit]');
  if (editBtn) {
    editBtn.textContent = t('shortcut_edit_btn');
    editBtn.setAttribute('aria-pressed', 'false');
  }
  applyCommandShortcuts(row);
  syncRow(row);
}

function cancelCapture() {
  if (!_capturing) return;
  const { row } = _capturing;
  stopCapture();
  setStatus(row, '');
}

/** Klik poza wierszem = rezygnacja z nagrywania. */
function onPointerDown(/** @type {Event} */ e) {
  const target = /** @type {Node} */ (e.target);
  if (_capturing && !_capturing.row.contains(target)) cancelCapture();
}

/** Podgląd „Alt+Shift+…” znika, gdy modyfikatory puszczone. */
function onKeyUp(/** @type {KeyboardEvent} */ e) {
  if (!_capturing) return;
  if (e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
  const code = _pick(_capturing.row, '[data-command]');
  if (code) code.textContent = t('shortcut_capture_prompt');
}

async function onKeyDown(/** @type {KeyboardEvent} */ e) {
  if (!_capturing) return;
  // Nagrywamy skrót — żadne inne nasłuchy (Alt+C, Esc zamykające panel,
  // Tab) nie mają prawa zadziałać.
  e.preventDefault();
  e.stopImmediatePropagation();

  const { name, row } = _capturing;
  const code = _pick(row, '[data-command]');

  if (e.key === 'Escape' || e.code === 'Escape') {
    cancelCapture();
    return;
  }

  const result = shortcutFromEvent(e, { isMac });

  if ('pending' in result) {
    if (code) {
      code.textContent = previewLabel(result.pending) || t('shortcut_capture_prompt');
    }
    return;
  }

  if ('error' in result) {
    if (code) code.textContent = t('shortcut_capture_prompt');
    setStatus(row, t(`shortcut_err_${result.error}`), 'error');
    return;
  }

  const clash = conflictingCommand(result.shortcut, currentCommandShortcuts(), name);
  if (clash) {
    if (code) code.textContent = t('shortcut_capture_prompt');
    setStatus(
      row,
      t('shortcut_err_duplicate', [t(COMMAND_LABEL_KEY[clash] ?? clash)]),
      'error',
    );
    return;
  }

  if (code) code.textContent = result.shortcut;
  const ok = await updateCommandShortcut(name, result.shortcut);
  if (!ok) {
    if (code) code.textContent = t('shortcut_capture_prompt');
    setStatus(row, t('shortcut_err_rejected'), 'error');
    return;
  }
  stopCapture();
  setStatus(row, t('shortcut_saved', [result.shortcut]), 'ok');
  syncRows();
}

/** @param {HTMLElement} row */
function startCapture(row) {
  if (_capturing?.row === row) {
    cancelCapture();
    return;
  }
  cancelCapture();
  const name = row.dataset.shortcutRow ?? '';
  _capturing = { name, row };

  const code = _pick(row, '[data-command]');
  if (code) {
    code.classList.add('is-capturing');
    code.textContent = t('shortcut_capture_prompt');
    code.removeAttribute('title');
  }
  const editBtn = _pick(row, '[data-shortcut-edit]');
  if (editBtn) {
    editBtn.textContent = t('shortcut_capture_cancel');
    editBtn.setAttribute('aria-pressed', 'true');
    editBtn.focus();
  }
  setStatus(row, t('shortcut_capture_hint'));

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', cancelCapture);
  document.addEventListener('pointerdown', onPointerDown, true);
}

/* ── Wejście ────────────────────────────────────────────────── */

/**
 * Podłącza przyciski w wierszach data-shortcut-row.
 * Woływane raz, po applyStaticTranslations.
 * @param {ParentNode} [root=document]
 */
export function initShortcutEditor(root = document) {
  const rows = /** @type {HTMLElement[]} */ ([...root.querySelectorAll('[data-shortcut-row]')]);
  if (!rows.length) return;

  // Wiersz ma pokazywać skrót od razu, nawet gdy getAll() jeszcze nie wrócił.
  applyCommandShortcuts(root);

  const editable = canEditCommandShortcuts();

  for (const row of rows) {
    const name = row.dataset.shortcutRow ?? '';
    const editBtn = _pick(row, '[data-shortcut-edit]');
    const resetBtn = _pick(row, '[data-shortcut-reset]');

    if (!editable) {
      // Chrome i Edge: skrót zmienia się tylko na własnej stronie przeglądarki.
      if (resetBtn) resetBtn.hidden = true;
      if (editBtn) editBtn.hidden = true;
      setStatus(row, t('shortcut_edit_browser_hint'));
      continue;
    }

    editBtn?.addEventListener('click', () => startCapture(row));
    resetBtn?.addEventListener('click', async () => {
      cancelCapture();
      const ok = await resetCommandShortcut(name);
      applyCommandShortcuts(row);
      syncRows();
      setStatus(
        row,
        ok ? t('shortcut_saved', [commandShortcutLabel(name)]) : t('shortcut_err_rejected'),
        ok ? 'ok' : 'error',
      );
    });
  }

  syncRows(root);
}

/** Odświeżenie po ponownym wczytaniu skrótów (np. powrót do panelu). */
export function refreshShortcutEditor(/** @type {ParentNode} */ root = document) {
  if (_capturing) return;
  syncRows(root);
}
