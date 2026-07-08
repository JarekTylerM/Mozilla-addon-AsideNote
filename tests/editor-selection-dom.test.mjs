/**
 * editor-selection-dom.test.mjs — testy DOM dla mutujących helperów selekcji
 * Wymaga: jsdom (node_modules/jsdom)
 *
 * Pokrywa funkcje wcześniej oznaczone jako "browser only" i nietestowane:
 *   _indentListItem, _outdentListItem, getCursorOffset, setCursorOffset
 * Uzupełnia editor-handlers.test.mjs (który pokrywa _getCurrentBlock,
 * _clearBlock, _isCursorAtListStart).
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

// ── Bootstrap DOM PRZED importem modułów używających document ────
const _dom = new JSDOM(
  '<!DOCTYPE html><body><div id="editor" contenteditable="true"><p>init</p></div></body></html>',
  { pretendToBeVisual: true },
);
global.window = _dom.window;
global.document = _dom.window.document;
global.Node = _dom.window.Node;
global.NodeFilter = _dom.window.NodeFilter; // setCursorOffset/_restoreCursorTo go używają

import { test, expect, results } from './_runner.mjs';
import {
  _indentListItem,
  _outdentListItem,
  getCursorOffset,
  setCursorOffset,
} from './editor-selection.mjs';

const editor = () => document.getElementById('editor');
function reset(html) {
  editor().innerHTML = html;
  return editor();
}
function setCaret(node, offset = 0) {
  const sel = window.getSelection();
  const r = document.createRange();
  r.setStart(node, offset);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

// ── _indentListItem ───────────────────────────────────────────────

console.log('\n1. _indentListItem');

test('drugi element → zagnieżdżony pod pierwszym', () => {
  const ed = reset('<ul><li>one</li><li>two</li></ul>');
  _indentListItem(ed.querySelectorAll('li')[1]);
  expect(ed.innerHTML).toBe('<ul><li>one<ul><li>two</li></ul></li></ul>');
});

test('brak poprzedniego rodzeństwa → no-op', () => {
  const ed = reset('<ul><li>only</li></ul>');
  _indentListItem(ed.querySelector('li'));
  expect(ed.innerHTML).toBe('<ul><li>only</li></ul>');
});

test('reużywa istniejącą podlistę tego samego typu', () => {
  const ed = reset('<ul><li>one<ul><li>a</li></ul></li><li>two</li></ul>');
  const twoLi = Array.from(ed.querySelector('ul').children)[1];
  _indentListItem(twoLi);
  // "two" dołącza do istniejącej <ul>, nie tworzy drugiej
  expect(ed.querySelector('ul li ul').children.length).toBe(2);
});

test('podlista innego typu → dołącza do istniejącej, bez równoległej listy', () => {
  const ed = reset('<ul><li>one<ol><li>a</li></ol></li><li>two</li></ul>');
  const twoLi = Array.from(ed.querySelector('ul').children)[1];
  _indentListItem(twoLi);
  const oneLi = ed.querySelector('ul > li');
  // Dokładnie jedna podlista pod "one" (istniejąca <ol>), "two" w niej
  const sublists = oneLi.querySelectorAll(':scope > ul, :scope > ol');
  expect(sublists.length).toBe(1);
  expect(oneLi.querySelector(':scope > ol').children.length).toBe(2);
});

// ── _outdentListItem ──────────────────────────────────────────────

console.log('\n2. _outdentListItem');

test('zagnieżdżony → wychodzi za rodzica, pusta podlista usunięta', () => {
  const ed = reset('<ul><li>one<ul><li>sub</li></ul></li></ul>');
  _outdentListItem(ed.querySelector('ul ul li'));
  expect(ed.innerHTML).toBe('<ul><li>one</li><li>sub</li></ul>');
});

test('element najwyższego poziomu (brak li-rodzica) → no-op', () => {
  const ed = reset('<ul><li>one</li></ul>');
  _outdentListItem(ed.querySelector('li'));
  expect(ed.innerHTML).toBe('<ul><li>one</li></ul>');
});

// ── getCursorOffset / setCursorOffset ─────────────────────────────

console.log('\n3. getCursorOffset / setCursorOffset');

// get → set → get musi być stabilne, a set musi wrócić na ten sam węzeł.
function roundtrip(ed, node, offset) {
  setCaret(node, offset);
  const off = getCursorOffset(ed);
  setCursorOffset(ed, off);
  const back = getCursorOffset(ed);
  const sel = window.getSelection();
  return { off, back, landed: sel.anchorNode, landedOffset: sel.anchorOffset };
}

test('pojedyncza linia: offset = pozycja znaku', () => {
  const ed = reset('<p>hello world</p>');
  setCaret(ed.querySelector('p').firstChild, 5);
  expect(getCursorOffset(ed)).toBe(5);
});

test('round-trip w tekście: stabilny i wraca na ten sam węzeł', () => {
  const ed = reset('<p>alpha</p><p>beta</p>');
  const beta = ed.children[1].firstChild;
  const r = roundtrip(ed, beta, 2);
  expect(r.off).toBe(r.back);
  expect(r.landed).toBe(beta);
  expect(r.landedOffset).toBe(2);
});

test('FIX: koniec poprzedniej linii i pusta linia mają RÓŻNE offsety', () => {
  const ed = reset('<p>abc</p><p><br></p><p>def</p>');
  setCaret(ed.children[0].firstChild, 3); // koniec "abc"
  expect(getCursorOffset(ed)).toBe(3);
  setCaret(ed.children[1], 0); // pusta środkowa linia
  expect(getCursorOffset(ed)).toBe(4); // własny offset, nie 3
});

test('FIX: round-trip na pustej linii wraca NA pustą linię', () => {
  const ed = reset('<p>abc</p><p><br></p><p>def</p>');
  const emptyP = ed.children[1];
  const r = roundtrip(ed, emptyP, 0);
  expect(r.landed).toBe(emptyP); // nie koniec "abc"
  expect(r.off).toBe(r.back);
});

test('FIX: pusty <li> ma własny offset i round-trip wraca na niego', () => {
  const ed = reset('<ul><li>one</li><li><br></li><li>three</li></ul>');
  const emptyLi = ed.querySelectorAll('li')[1];
  const r = roundtrip(ed, emptyLi, 0);
  expect(r.landed).toBe(emptyLi);
  expect(r.off).toBe(r.back);
});

test('round-trip przez nagłówek i blockquote (blok w bloku = 1 linia)', () => {
  const ed = reset('<h1>Title</h1><blockquote><p>quote</p></blockquote><p>end</p>');
  const q = ed.querySelector('blockquote p').firstChild;
  const r = roundtrip(ed, q, 3);
  expect(r.landed).toBe(q);
  expect(r.landedOffset).toBe(3);
  expect(r.off).toBe(r.back);
});

test('round-trip w zagnieżdżonej liście', () => {
  const ed = reset('<ul><li>parent<ul><li>child</li></ul></li></ul>');
  const child = ed.querySelector('ul ul li').firstChild;
  const r = roundtrip(ed, child, 2);
  expect(r.landed).toBe(child);
  expect(r.landedOffset).toBe(2);
  expect(r.off).toBe(r.back);
});

test('offset poza zakresem → koniec treści (bez wyjątku)', () => {
  const ed = reset('<p>abc</p>');
  setCursorOffset(ed, 9999);
  expect(getCursorOffset(ed)).toBe(3);
});

await results([
  '_focusLi / _restoreCursorTo — testowane pośrednio przez indent/outdent (focus + selection)',
]);
