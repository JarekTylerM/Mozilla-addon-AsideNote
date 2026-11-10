/**
 * note-menu-dom.test.mjs — stan nagłówka notatki i zachowanie menu ⋮
 * Wymaga: jsdom
 *
 * Pokrywa: noteHeaderState (co nagłówek pokazuje dla każdego stanu) oraz
 * initNoteMenu (otwieranie, klawiatura, zamykanie, oddawanie fokusu).
 * Pozycjonowania jsdom nie policzy, bo nie ma układu — sprawdza je przeglądarka.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const _dom = new JSDOM('<!DOCTYPE html><body></body></html>', { pretendToBeVisual: true });
global.window = _dom.window;
global.document = _dom.window.document;
global.Node = _dom.window.Node;

import { test, expect, results } from './_runner.mjs';
import {
  NOTE_ACTIONS,
  normalizePinnedActions,
  noteHeaderState,
  initNoteMenu,
} from './note-menu.mjs';

const doc = _dom.window.document;

// ── noteHeaderState ───────────────────────────────────────────────

console.log('\n1. noteHeaderState');

const state = (over) =>
  noteHeaderState({ note: null, activeId: null, pendingType: 'note', focusIds: [], ...over });

test('nowa notatka: bez kosza i bez oznaczeń, checkbox ukryty', () => {
  const s = state();
  expect(s.isTask).toBe(false);
  expect(s.hasNote).toBe(false);
  expect(s.available.delete).toBe(false);
  expect(s.available.important).toBe(false);
  expect(s.available.focus).toBe(false);
});

test('nowe zadanie: checkbox widoczny, ale nie ma czego ukończyć', () => {
  const s = state({ pendingType: 'task' });
  expect(s.isTask).toBe(true);
  expect(s.canComplete).toBe(false);
});

test('otwarta notatka: typ z notatki, nie z pendingType', () => {
  const s = state({ note: { type: 'note' }, activeId: 'a', pendingType: 'task' });
  expect(s.isTask).toBe(false);
  expect(s.canComplete).toBe(false);
  expect(s.available.important).toBe(true);
  expect(s.available.focus).toBe(true);
});

test('otwarte zadanie można ukończyć', () => {
  const s = state({ note: { type: 'task' }, activeId: 'a' });
  expect(s.canComplete).toBe(true);
  expect(s.completed).toBe(false);
});

test('ukończone zadanie nie pokazuje "w trakcie" ani nie pozwala go nadać', () => {
  const s = state({
    note: { type: 'task', completed: true },
    activeId: 'a',
    focusIds: ['a'],
  });
  expect(s.completed).toBe(true);
  expect(s.available.focus).toBe(false);
  expect(s.inFocus).toBe(false);
});

test('ważne i w trakcie czytane z notatki i focusIds', () => {
  const s = state({
    note: { type: 'task', important: true },
    activeId: 'a',
    focusIds: ['a'],
  });
  expect(s.important).toBe(true);
  expect(s.inFocus).toBe(true);
});

test('"w trakcie" innej notatki nie liczy się dla otwartej', () => {
  const s = state({ note: { type: 'note' }, activeId: 'a', focusIds: ['b'] });
  expect(s.inFocus).toBe(false);
});

// ── Przypinanie do nagłówka ───────────────────────────────────────

console.log('\n2. Przypinanie do nagłówka');

test('normalizePinnedActions odrzuca śmieci i duplikaty, trzyma stałą kolejność', () => {
  expect(normalizePinnedActions(['delete', 'nieznane', 'important', 'delete'])).toEqual([
    'important',
    'delete',
  ]);
  expect(normalizePinnedActions('important')).toEqual([]);
  expect(normalizePinnedActions(undefined)).toEqual([]);
});

const openTask = (over) =>
  state({ note: { type: 'task', important: true }, activeId: 'a', focusIds: ['a'], ...over });

test('domyślnie nic nie jest przypięte, a stany widać jako symbole przy tytule', () => {
  const s = openTask();
  expect(s.isPinned('important')).toBe(false);
  expect(s.showImportantSymbol).toBe(true);
  expect(s.showFocusSymbol).toBe(true);
  expect(s.menuEmpty).toBe(false);
  expect(s.showMenuSeparator).toBe(true);
});

test('przypięty stan nie dubluje się symbolem przy tytule', () => {
  const s = openTask({ pinnedActions: ['important'] });
  expect(s.showImportantSymbol).toBe(false);
  expect(s.showFocusSymbol).toBe(true);
});

test('menu jest puste dopiero, gdy przypięto wszystko, co jest dostępne', () => {
  expect(openTask({ pinnedActions: [...NOTE_ACTIONS] }).menuEmpty).toBe(true);
  expect(openTask({ pinnedActions: ['important', 'focus', 'convert', 'copy'] }).menuEmpty).toBe(false);
  // Nowy element ma tylko zmianę typu i kopiowanie, więc te dwa wystarczą
  expect(state({ pinnedActions: ['convert', 'copy'] }).menuEmpty).toBe(true);
});

test('kreska w menu tylko wtedy, gdy kosz ma od czego się oddzielać', () => {
  expect(openTask({ pinnedActions: ['delete'] }).showMenuSeparator).toBe(false);
  expect(
    openTask({ pinnedActions: ['important', 'focus', 'convert', 'copy'] }).showMenuSeparator,
  ).toBe(false);
});

// ── initNoteMenu ──────────────────────────────────────────────────

console.log('\n3. initNoteMenu');

/** Świeży DOM i menu. Dokument jest wspólny, więc stare menu ginie z body. */
function mk() {
  doc.body.innerHTML = `
    <input id="outside">
    <button id="trigger" aria-expanded="false"></button>
    <div id="menu" role="menu">
      <button id="a" role="menuitem">a</button>
      <button id="hidden" role="menuitem" hidden>h</button>
      <button id="b" role="menuitemcheckbox">b</button>
      <button id="c" role="menuitem">c</button>
    </div>`;
  const trigger = doc.getElementById('trigger');
  const menu = doc.getElementById('menu');
  return { trigger, menu, api: initNoteMenu(trigger, menu) };
}

const press = (target, key) => {
  const e = new _dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
};
const activeId = () => doc.activeElement?.id;

test('klik otwiera menu i ustawia fokus na pierwszej pozycji', () => {
  const { trigger, api } = mk();
  trigger.click();
  expect(api.isOpen()).toBe(true);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  expect(activeId()).toBe('a');
});

test('drugi klik zamyka menu', () => {
  const { trigger, api } = mk();
  trigger.click();
  trigger.click();
  expect(api.isOpen()).toBe(false);
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
});

test('strzałki omijają ukryte pozycje i zawijają się', () => {
  const { trigger, menu } = mk();
  trigger.click();
  press(menu, 'ArrowDown');
  expect(activeId()).toBe('b');
  press(menu, 'ArrowDown');
  press(menu, 'ArrowDown');
  expect(activeId()).toBe('a');
  press(menu, 'ArrowUp');
  expect(activeId()).toBe('c');
});

test('fokus omija pozycje przypięte do nagłówka', () => {
  const { trigger, menu } = mk();
  doc.getElementById('a').classList.add('is-pinned');
  trigger.click();
  expect(activeId()).toBe('b');
  press(menu, 'ArrowUp');
  expect(activeId()).toBe('c');
});

test('Home i End skaczą na skraje', () => {
  const { trigger, menu } = mk();
  trigger.click();
  press(menu, 'End');
  expect(activeId()).toBe('c');
  press(menu, 'Home');
  expect(activeId()).toBe('a');
});

test('strzałka w górę na przycisku otwiera menu na ostatniej pozycji', () => {
  const { trigger, api } = mk();
  trigger.focus();
  press(trigger, 'ArrowUp');
  expect(api.isOpen()).toBe(true);
  expect(activeId()).toBe('c');
});

test('Escape zamyka samo menu i nie dociera do skrótu globalnego', () => {
  const { trigger, menu, api } = mk();
  let reachedDocument = false;
  const spy = (e) => {
    if (e.key === 'Escape') reachedDocument = true;
  };
  doc.addEventListener('keydown', spy);
  trigger.click();
  press(menu, 'Escape');
  doc.removeEventListener('keydown', spy);
  expect(api.isOpen()).toBe(false);
  expect(activeId()).toBe('trigger');
  expect(reachedDocument).toBe(false);
});

test('wybór pozycji zamyka menu, a akcja pozycji się wykonuje', () => {
  const { trigger, api } = mk();
  let ran = false;
  doc.getElementById('b').onclick = () => {
    ran = true;
  };
  trigger.click();
  doc.getElementById('b').click();
  expect(ran).toBe(true);
  expect(api.isOpen()).toBe(false);
  expect(activeId()).toBe('trigger');
});

test('Tab zamyka menu i zostawia domyślne działanie klawisza', () => {
  const { trigger, menu, api } = mk();
  trigger.click();
  const e = press(menu, 'Tab');
  expect(api.isOpen()).toBe(false);
  expect(e.defaultPrevented).toBe(false);
  expect(activeId()).toBe('trigger');
});

test('mousedown poza menu zamyka je bez przejmowania fokusu', () => {
  const { trigger, api } = mk();
  trigger.click();
  doc.getElementById('outside').dispatchEvent(
    new _dom.window.MouseEvent('mousedown', { bubbles: true }),
  );
  expect(api.isOpen()).toBe(false);
  expect(activeId() === 'trigger').toBe(false);
});

test('fokus przeniesiony poza menu zamyka je', () => {
  const { trigger, api } = mk();
  trigger.click();
  doc.getElementById('outside').focus();
  expect(api.isOpen()).toBe(false);
});

await results();
