/**
 * focus-trap-dom.test.mjs — testy DOM dla focus-trap.js
 * Wymaga: jsdom
 *
 * Pokrywa: getFocusable (filtrowanie/kolejność) oraz createFocusTrap
 * (zawijanie Tab/Shift+Tab, przywracanie fokusu). Model modali używa
 * atrybutu `hidden`, więc getFocusable filtruje po hidden — testujemy to.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const _dom = new JSDOM('<!DOCTYPE html><body></body></html>', { pretendToBeVisual: true });
global.window = _dom.window;
global.document = _dom.window.document;
global.Node = _dom.window.Node;

import { test, expect, results } from './_runner.mjs';
import { getFocusable, createFocusTrap } from './focus-trap.mjs';

const doc = _dom.window.document;

/** Buduje modal z zadanym HTML wewnątrz kontenera role="dialog". */
function mkModal(inner) {
  doc.body.innerHTML = `
    <button id="outside">outside</button>
    <div id="modal"><div id="dialog" role="dialog">${inner}</div></div>
  `;
  return doc.getElementById('dialog');
}

const key = (target, opts = {}) =>
  target.dispatchEvent(new _dom.window.KeyboardEvent('keydown', {
    key: 'Tab', bubbles: true, cancelable: true, ...opts,
  }));

// ── getFocusable ──────────────────────────────────────────────────

console.log('\n1. getFocusable');

test('zwraca fokusowalne w kolejności DOM', () => {
  const d = mkModal('<button id="a">a</button><input id="b"><a id="c" href="#">c</a>');
  expect(getFocusable(d).map((e) => e.id)).toEqual(['a', 'b', 'c']);
});

test('pomija disabled', () => {
  const d = mkModal('<button id="a">a</button><button id="b" disabled>b</button>');
  expect(getFocusable(d).map((e) => e.id)).toEqual(['a']);
});

test('pomija elementy z atrybutem hidden', () => {
  const d = mkModal('<button id="a">a</button><button id="b" hidden>b</button>');
  expect(getFocusable(d).map((e) => e.id)).toEqual(['a']);
});

test('pomija element, którego przodek ma hidden', () => {
  const d = mkModal('<div hidden><button id="a">a</button></div><button id="b">b</button>');
  expect(getFocusable(d).map((e) => e.id)).toEqual(['b']);
});

test('pomija tabindex="-1"', () => {
  const d = mkModal('<button id="a">a</button><button id="b" tabindex="-1">b</button>');
  expect(getFocusable(d).map((e) => e.id)).toEqual(['a']);
});

test('pomija input[type=hidden]', () => {
  const d = mkModal('<input id="a"><input id="b" type="hidden">');
  expect(getFocusable(d).map((e) => e.id)).toEqual(['a']);
});

test('pusty modal → pusta lista', () => {
  const d = mkModal('<p>tekst bez kontrolek</p>');
  expect(getFocusable(d).length).toBe(0);
});

// ── createFocusTrap: zawijanie ────────────────────────────────────

console.log('\n2. createFocusTrap — zawijanie Tab');

test('Tab na ostatnim elemencie → wraca na pierwszy', () => {
  const d = mkModal('<button id="a">a</button><button id="b">b</button>');
  const trap = createFocusTrap(d);
  trap.activate();
  doc.getElementById('b').focus();
  const notPrevented = key(doc.getElementById('b'));
  expect(doc.activeElement.id).toBe('a');
  expect(notPrevented).toBe(false); // preventDefault → dispatchEvent zwraca false
  trap.release();
});

test('Shift+Tab na pierwszym elemencie → wraca na ostatni', () => {
  const d = mkModal('<button id="a">a</button><button id="b">b</button>');
  const trap = createFocusTrap(d);
  trap.activate();
  doc.getElementById('a').focus();
  key(doc.getElementById('a'), { shiftKey: true });
  expect(doc.activeElement.id).toBe('b');
  trap.release();
});

test('Tab w środku (nie na granicy) → nie ingeruje', () => {
  const d = mkModal('<button id="a">a</button><button id="b">b</button><button id="c">c</button>');
  const trap = createFocusTrap(d);
  trap.activate();
  doc.getElementById('a').focus();
  const notPrevented = key(doc.getElementById('a'));
  expect(notPrevented).toBe(true); // brak preventDefault — natywny Tab przejmuje
  trap.release();
});

test('Tab gdy fokus poza kontenerem → ściąga na pierwszy', () => {
  const d = mkModal('<button id="a">a</button><button id="b">b</button>');
  const trap = createFocusTrap(d);
  trap.activate();
  doc.getElementById('outside').focus();
  key(doc.getElementById('outside'));
  expect(doc.activeElement.id).toBe('a');
  trap.release();
});

test('po release Tab już nie zawija', () => {
  const d = mkModal('<button id="a">a</button><button id="b">b</button>');
  const trap = createFocusTrap(d);
  trap.activate();
  trap.release();
  doc.getElementById('b').focus();
  const notPrevented = key(doc.getElementById('b'));
  expect(notPrevented).toBe(true); // listener zdjęty — brak preventDefault
});

// ── createFocusTrap: fokus początkowy i przywracanie ──────────────

console.log('\n3. createFocusTrap — fokus init i restore');

test('activate(initialFocus) fokusuje podany element', () => {
  const d = mkModal('<button id="a">a</button><button id="b">b</button>');
  const trap = createFocusTrap(d);
  trap.activate({ initialFocus: doc.getElementById('b') });
  expect(doc.activeElement.id).toBe('b');
  trap.release();
});

test('release przywraca fokus tam, gdzie był przed activate', () => {
  const d = mkModal('<button id="a">a</button>');
  doc.getElementById('outside').focus(); // fokus "trigger" przed otwarciem
  const trap = createFocusTrap(d);
  trap.activate({ initialFocus: doc.getElementById('a') });
  expect(doc.activeElement.id).toBe('a');
  trap.release();
  expect(doc.activeElement.id).toBe('outside'); // wrócił do triggera
});

test('restoreFocus:false → release nie przywraca fokusu', () => {
  const d = mkModal('<button id="a">a</button>');
  doc.getElementById('outside').focus();
  const trap = createFocusTrap(d);
  trap.activate({ restoreFocus: false });
  doc.getElementById('a').focus();
  trap.release();
  expect(doc.activeElement.id).toBe('a'); // nie cofnięto do outside
});

results();
