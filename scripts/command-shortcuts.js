// @ts-check
/* ══════════════════════════════════════════════════════════════
   command-shortcuts.js — rzeczywiste skróty komend manifestu
   ──────────────────────────────────────────────────────────────
   Skróty z manifest.json (toggle-sidebar, _execute_browser_action) to tylko
   PROPOZYCJE. Firefox może je zmienić albo nie przypisać wcale:
   - wersja testowa ma inne (build-dev-manifest.mjs: Alt+Shift+W / A),
   - użytkownik może je przestawić w panelu Skróty (shortcut-editor.js)
     albo w about:addons → ⚙ → Zarządzaj skrótami,
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
    // Wiersz w trakcie nagrywania nowego skrótu pokazuje podgląd kombinacji —
    // odświeżenie (np. po powrocie fokusu do panelu) nie może go nadpisać.
    if (el.classList.contains('is-capturing')) continue;
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

/* ── Zmiana skrótów ─────────────────────────────────────────────
   Firefox pozwala rozszerzeniu przestawić własny skrót bez dodatkowego
   uprawnienia (browser.commands.update / reset). Chromium takiego API nie
   ma — tam zmiana idzie przez chrome://extensions/shortcuts, więc panel
   pokazuje przycisk otwierający tę stronę (patrz shortcut-editor.js). */

/** Komendy, które użytkownik może przestawić w panelu Skróty. */
export const EDITABLE_COMMANDS = ['toggle-sidebar', '_execute_browser_action'];

/** @returns {boolean} czy przeglądarka pozwala zmienić skrót z poziomu dodatku */
export function canEditCommandShortcuts() {
  return typeof browser?.commands?.update === 'function';
}

/**
 * Aktualne skróty (nazwa komendy → skrót, '' = nieprzypisany).
 * Kopia — wołający nie zmienia stanu modułu.
 * @returns {Record<string, string>}
 */
export function currentCommandShortcuts() {
  return { ...(_loaded ? _actual : SUGGESTED) };
}

/** Nazwa tej samej komendy w manifeście Chromium (patrz platform/chromium). */
const CHROMIUM_ALIAS = /** @type {Record<string, string>} */ ({
  _execute_browser_action: '_execute_action',
});

/**
 * Skrót z manifestu — to, co przywróci resetCommandShortcut(). Czytany z
 * manifestu, a nie ze stałej SUGGESTED: wersja testowa (build-dev-manifest.mjs)
 * i Chromium mają własne domyślne kombinacje.
 * @param {string} name
 */
export function suggestedCommandShortcut(name) {
  try {
    const commands = browser.runtime.getManifest().commands ?? {};
    const def = commands[name] ?? commands[CHROMIUM_ALIAS[name]];
    const fromManifest = def?.suggested_key?.default;
    if (fromManifest) return fromManifest;
  } catch {
    // Podgląd poza rozszerzeniem — zostaje kopia z manifestu poniżej
  }
  return SUGGESTED[name] ?? '';
}

/**
 * Przypisuje nowy skrót komendzie i odświeża stan modułu.
 * @param {string} name nazwa komendy z manifest.json
 * @param {string} shortcut np. "Alt+Shift+Q"
 * @returns {Promise<boolean>} false = przeglądarka odrzuciła skrót
 */
export async function updateCommandShortcut(name, shortcut) {
  try {
    await browser.commands.update({ name, shortcut });
  } catch (e) {
    console.warn('AsideNotes: commands.update', e);
    return false;
  }
  await loadCommandShortcuts();
  return true;
}

/**
 * Przywraca skrót z manifestu.
 * @param {string} name
 * @returns {Promise<boolean>}
 */
export async function resetCommandShortcut(name) {
  try {
    await browser.commands.reset(name);
  } catch (e) {
    console.warn('AsideNotes: commands.reset', e);
    return false;
  }
  await loadCommandShortcuts();
  return true;
}
