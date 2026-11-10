// @ts-check
/* ══════════════════════════════════════════════════════════════
   command-shortcuts.js — rzeczywiste skróty komend manifestu
   ──────────────────────────────────────────────────────────────
   Skróty z manifest.json (toggle-sidebar, _execute_browser_action) to tylko
   PROPOZYCJE. Firefox może je zmienić albo nie przypisać wcale:
   - wersja testowa ma inne (build-dev-manifest.mjs: Alt+Shift+W / A),
   - użytkownik może je przestawić w about:addons → ⚙ → Zarządzaj skrótami,
   - skrót zajęty przez inny dodatek nie zostaje przypisany.
   Dlatego interfejs nie wypisuje ich na sztywno, tylko czyta
   browser.commands.getAll(). Miejsca w HTML oznacza data-command="nazwa".
   ══════════════════════════════════════════════════════════════ */

import { t } from './i18n.js';

/** Skróty z manifest.json — pokazywane, zanim getAll() odpowie. */
const SUGGESTED = /** @type {Record<string, string>} */ ({
  'toggle-sidebar': 'Alt+Shift+Q',
  _execute_browser_action: 'Alt+Shift+S',
});

/** @type {Record<string, string>} nazwa komendy → skrót ('' = nieprzypisany) */
let _actual = {};
let _loaded = false;

/**
 * Wczytuje rzeczywiste skróty. Bezpieczne do wołania wielokrotnie.
 * @returns {Promise<void>}
 */
export async function loadCommandShortcuts() {
  try {
    const commands = await browser.commands.getAll();
    _actual = Object.fromEntries(
      commands.filter((c) => c.name).map((c) => [String(c.name), c.shortcut ?? '']),
    );
    _loaded = true;
  } catch {
    // Bez API (np. podgląd poza rozszerzeniem) zostają skróty z manifestu
  }
}

/**
 * Skrót komendy do pokazania w interfejsie.
 * @param {string} name nazwa komendy z manifest.json
 * @returns {string} skrót albo opis "nie ustawiony"
 */
export function commandShortcutLabel(name) {
  const shortcut = _loaded ? _actual[name] : SUGGESTED[name];
  return shortcut || t('shortcut_unassigned');
}

/**
 * Wpisuje rzeczywiste skróty we wszystkie elementy z data-command.
 * Przy nieprzypisanym skrócie podpowiedź (title) mówi, gdzie go ustawić.
 * @param {ParentNode} [root=document]
 */
export function applyCommandShortcuts(root = document) {
  for (const el of root.querySelectorAll('[data-command]')) {
    const name = /** @type {HTMLElement} */ (el).dataset.command ?? '';
    const assigned = _loaded ? !!_actual[name] : true;
    el.textContent = commandShortcutLabel(name);
    if (assigned) el.removeAttribute('title');
    else el.setAttribute('title', t('shortcut_unassigned_hint'));
  }
}

/**
 * Podstawienia do komunikatów, które wymieniają oba skróty
 * ($TOGGLE$ = panel, $POPUP$ = szybkie dodawanie). W zdaniu nieprzypisany
 * skrót to fraza "skrót ustawiany w about:addons", nie etykieta "nie ustawiony".
 * @returns {string[]}
 */
export function commandShortcutSubstitutions() {
  /** @param {string} name */
  const inline = (name) =>
    (_loaded ? _actual[name] : SUGGESTED[name]) || t('shortcut_unassigned_inline');
  return [inline('toggle-sidebar'), inline('_execute_browser_action')];
}
