/**
 * shortcut-editor-dom.test.mjs — nagrywanie nowego skrótu w panelu Skróty
 * Wymaga: jsdom
 *
 * Pokrywa ścieżkę, której nie widać w testach czystej logiki: klik „Zmień”,
 * podgląd kombinacji, zapis przez browser.commands.update, odmowa
 * przeglądarki, kolizja z drugą komendą, Esc, przywrócenie domyślnego
 * oraz Chromium bez commands.update.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const _dom = new JSDOM('<!DOCTYPE html><body></body></html>', { pretendToBeVisual: true });
global.window = _dom.window;
global.document = _dom.window.document;
global.Node = _dom.window.Node;
const doc = _dom.window.document;

// ── Mock browser.* ────────────────────────────────────────────────
// Skrót "Alt+Shift+X" udaje kombinację, której przeglądarka nie przyjmuje
// (zarezerwowana) — tak zachowuje się commands.update w Firefoksie.
const DEFAULTS = { 'toggle-sidebar': 'Alt+Shift+Q', _execute_browser_action: 'Alt+Shift+S' };
let assigned = { ...DEFAULTS };
const updates = [];

global.browser = {
  i18n: {
    getMessage: (key, subs) =>
      subs ? `${key}:${[].concat(subs).join(',')}` : key,
    getUILanguage: () => 'pl',
  },
  commands: {
    getAll: async () =>
      Object.entries(assigned).map(([name, shortcut]) => ({ name, shortcut })),
    update: async ({ name, shortcut }) => {
      if (shortcut === 'Alt+Shift+X') throw new Error('shortcut is reserved');
      updates.push({ name, shortcut });
      assigned[name] = shortcut;
    },
    reset: async (name) => {
      assigned[name] = DEFAULTS[name];
    },
  },
};

import { expect, testAsync, results } from './_runner.mjs';
import { loadCommandShortcuts } from './command-shortcuts.mjs';
import { initShortcutEditor } from './shortcut-editor.mjs';

// ── Harness ───────────────────────────────────────────────────────

/** Wiersz taki jak w sidebar.html (panel → Skróty → Ogólne). */
function row(name) {
  const li = doc.createElement('li');
  li.className = 'shortcut-row';
  li.dataset.shortcutRow = name;
  li.innerHTML =
    `<code data-command="${name}"></code>` +
    '<span>opis</span>' +
    '<button type="button" data-shortcut-edit aria-pressed="false">zmień</button>' +
    '<button type="button" data-shortcut-reset hidden>domyślny</button>' +
    '<span data-shortcut-status hidden></span>';
  return li;
}

function mount(names = ['toggle-sidebar', '_execute_browser_action']) {
  doc.body.innerHTML = '';
  const ul = doc.createElement('ul');
  names.forEach((n) => ul.appendChild(row(n)));
  doc.body.appendChild(ul);
  return ul;
}

const $ = (el, sel) => el.querySelector(sel);
const code = (el) => $(el, '[data-command]').textContent;
const status = (el) => $(el, '[data-shortcut-status]').textContent;
const editBtn = (el) => $(el, '[data-shortcut-edit]');
const resetBtn = (el) => $(el, '[data-shortcut-reset]');

const tick = () => new Promise((r) => setTimeout(r, 0));

/** keydown w fazie przechwytywania dociera do okna tak jak w przeglądarce. */
async function press(init) {
  doc.body.dispatchEvent(
    new _dom.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
  );
  await tick();
}

async function release() {
  doc.body.dispatchEvent(new _dom.window.KeyboardEvent('keyup', { bubbles: true }));
  await tick();
}

/** Świeży panel z aktualnymi skrótami. */
async function freshPanel() {
  assigned = { ...DEFAULTS };
  updates.length = 0;
  await loadCommandShortcuts();
  const ul = mount();
  initShortcutEditor(ul);
  return { ul, toggle: ul.children[0], popup: ul.children[1] };
}

// ── Testy ─────────────────────────────────────────────────────────

console.log('\n1. Stan początkowy');

testAsync('wiersz pokazuje aktualny skrót, „Domyślny” schowany', async () => {
  const { toggle } = await freshPanel();
  expect(code(toggle)).toBe('Alt+Shift+Q');
  expect(resetBtn(toggle).hidden).toBe(true);
});

console.log('\n2. Nagrywanie kombinacji');

testAsync('klik „Zmień” przełącza wiersz w tryb nagrywania', async () => {
  const { toggle } = await freshPanel();
  editBtn(toggle).click();
  expect(code(toggle)).toBe('shortcut_capture_prompt');
  expect(editBtn(toggle).getAttribute('aria-pressed')).toBe('true');
  expect(status(toggle)).toBe('shortcut_capture_hint');
});

testAsync('same modyfikatory pokazują podgląd, puszczenie go kasuje', async () => {
  const { toggle } = await freshPanel();
  editBtn(toggle).click();
  await press({ code: 'AltLeft', altKey: true });
  expect(code(toggle)).toBe('Alt+…');
  await release();
  expect(code(toggle)).toBe('shortcut_capture_prompt');
});

testAsync('pełna kombinacja trafia do browser.commands.update', async () => {
  const { toggle } = await freshPanel();
  editBtn(toggle).click();
  await press({ code: 'KeyY', altKey: true, shiftKey: true });
  expect(updates).toEqual([{ name: 'toggle-sidebar', shortcut: 'Alt+Shift+Y' }]);
  expect(code(toggle)).toBe('Alt+Shift+Y');
  expect(status(toggle)).toBe('shortcut_saved:Alt+Shift+Y');
  expect(editBtn(toggle).getAttribute('aria-pressed')).toBe('false');
});

testAsync('po zmianie na własny skrót widać „Domyślny”', async () => {
  const { toggle } = await freshPanel();
  editBtn(toggle).click();
  await press({ code: 'KeyY', altKey: true, shiftKey: true });
  expect(resetBtn(toggle).hidden).toBe(false);
});

testAsync('nagrywany klawisz nie dociera do skrótów sidebara', async () => {
  const { toggle } = await freshPanel();
  let leaked = 0;
  const spy = () => { leaked++; };
  _dom.window.addEventListener('keydown', spy);
  editBtn(toggle).click();
  await press({ code: 'KeyY', altKey: true, shiftKey: true });
  _dom.window.removeEventListener('keydown', spy);
  expect(leaked).toBe(0);
});

console.log('\n3. Odmowy');

testAsync('sama litera: komunikat o braku modyfikatora, bez zapisu', async () => {
  const { toggle } = await freshPanel();
  editBtn(toggle).click();
  await press({ code: 'KeyY' });
  expect(status(toggle)).toBe('shortcut_err_needsModifier');
  expect(updates.length).toBe(0);
  expect(code(toggle)).toBe('shortcut_capture_prompt');
});

testAsync('skrót zajęty przez drugą komendę dodatku', async () => {
  const { toggle } = await freshPanel();
  editBtn(toggle).click();
  await press({ code: 'KeyS', altKey: true, shiftKey: true });
  expect(status(toggle)).toBe('shortcut_err_duplicate:shortcuts_general_popup');
  expect(updates.length).toBe(0);
});

testAsync('przeglądarka odrzuca kombinację — wiersz mówi o tym wprost', async () => {
  const { toggle } = await freshPanel();
  editBtn(toggle).click();
  // updateCommandShortcut loguje odmowę — w teście jest oczekiwana.
  const warn = console.warn;
  console.warn = () => {};
  await press({ code: 'KeyX', altKey: true, shiftKey: true });
  console.warn = warn;
  expect(status(toggle)).toBe('shortcut_err_rejected');
  expect(assigned['toggle-sidebar']).toBe('Alt+Shift+Q');
});

testAsync('Esc wychodzi z nagrywania i przywraca dotychczasowy skrót', async () => {
  const { toggle } = await freshPanel();
  editBtn(toggle).click();
  await press({ code: 'Escape', key: 'Escape' });
  expect(code(toggle)).toBe('Alt+Shift+Q');
  expect(status(toggle)).toBe('');
  expect(updates.length).toBe(0);
});

testAsync('klik poza wierszem przerywa nagrywanie', async () => {
  const { ul, toggle } = await freshPanel();
  editBtn(toggle).click();
  ul.dispatchEvent(new _dom.window.MouseEvent('pointerdown', { bubbles: true }));
  await tick();
  expect(code(toggle)).toBe('Alt+Shift+Q');
});

console.log('\n4. Przywrócenie domyślnego');

testAsync('„Domyślny” wraca do skrótu z manifestu i znika', async () => {
  const { toggle } = await freshPanel();
  editBtn(toggle).click();
  await press({ code: 'KeyY', altKey: true, shiftKey: true });
  resetBtn(toggle).click();
  await tick();
  expect(assigned['toggle-sidebar']).toBe('Alt+Shift+Q');
  expect(code(toggle)).toBe('Alt+Shift+Q');
  expect(resetBtn(toggle).hidden).toBe(true);
});

testAsync('„Domyślny” liczy się względem manifestu, nie stałej w kodzie', async () => {
  // Wersja DEV ma własne kombinacje (build-dev-manifest.mjs) — przy skrócie
  // zgodnym z JEJ manifestem nie ma czego przywracać.
  browser.runtime = {
    getManifest: () => ({
      commands: { 'toggle-sidebar': { suggested_key: { default: 'Alt+Shift+W' } } },
    }),
  };
  assigned = { ...DEFAULTS, 'toggle-sidebar': 'Alt+Shift+W' };
  await loadCommandShortcuts();
  const ul = mount(['toggle-sidebar']);
  initShortcutEditor(ul);
  const r = ul.children[0];
  delete browser.runtime;
  expect(code(r)).toBe('Alt+Shift+W');
  expect(resetBtn(r).hidden).toBe(true);
});

console.log('\n5. Chromium bez commands.update');

testAsync('bez API przyciski znikają, zostaje adres strony skrótów', async () => {
  assigned = { ...DEFAULTS };
  await loadCommandShortcuts();
  const update = browser.commands.update;
  delete browser.commands.update;
  const ul = mount(['toggle-sidebar']);
  initShortcutEditor(ul);
  browser.commands.update = update;
  const r = ul.children[0];
  expect(editBtn(r).hidden).toBe(true);
  expect(resetBtn(r).hidden).toBe(true);
  expect(status(r)).toBe('shortcut_edit_browser_hint');
});

await results();
