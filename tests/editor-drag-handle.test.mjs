/**
 * editor-drag-handle.test.mjs — uchwyt ⠿ do przenoszenia bloków
 *
 * Testujemy czyste reguły: który element przenosi uchwyt, gdzie wyląduje
 * po puszczeniu i wśród czego może się przesuwać. Muszą być te same co
 * Alt+↑/↓ (editor.js: _handleAltArrow) — inaczej mysz i klawiatura
 * przenosiłyby różne rzeczy.
 *
 * Uruchomienie: node tests/editor-drag-handle.test.mjs
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const _dom = new JSDOM(
  '<!DOCTYPE html><body><div id="editor" contenteditable="true"></div></body>',
);
global.window = _dom.window;
global.document = _dom.window.document;

import { test, expect, results } from './_runner.mjs';
import {
  findDragTarget,
  dropIndex,
  dragSiblings,
  selectionGroup,
  dragChain,
  dragKind,
  resolveDrop,
} from './editor-drag-handle.mjs';

const editor = /** @type {HTMLElement} */ (document.getElementById('editor'));
const set = (html) => {
  editor.innerHTML = html;
};
const $ = (sel) => editor.querySelector(sel);

/* ══ 1. Który blok przenosi uchwyt ═════════════════════════════ */

console.log('\n1. findDragTarget');

test('tekst w akapicie → akapit', () => {
  set('<p>Pierwszy <b id="b">pogrubiony</b></p><p>Drugi</p>');
  expect(findDragTarget($('#b'), editor)).toBe($('p'));
});

test('element listy → ten element, nie cała lista', () => {
  set('<ul><li>Mleko</li><li id="x">Chleb</li></ul>');
  expect(findDragTarget($('#x'), editor)).toBe($('#x'));
});

test('zagnieżdżony element listy → najbliższy li', () => {
  set('<ul><li>Zakupy<ul><li id="x"><i id="i">jajka</i></li><li>mąka</li></ul></li></ul>');
  expect(findDragTarget($('#i'), editor)).toBe($('#x'));
});

test('jedyny element listy → cała lista (nie ma z kim się zamienić)', () => {
  set('<p>a</p><ul><li id="x">Mleko</li></ul><p>b</p>');
  expect(findDragTarget($('#x'), editor)).toBe($('ul'));
});

test('jedyny element podlisty → element nadrzędny razem z podlistą', () => {
  set('<ul><li id="p">Zakupy<ul><li id="x">jajka</li></ul></li><li>Dom</li></ul>');
  expect(findDragTarget($('#x'), editor)).toBe($('#p'));
});

test('jedyny element podlisty w jedynym elemencie → cała lista', () => {
  set('<p>a</p><ul><li>Zakupy<ul><li id="x">jajka</li></ul></li></ul>');
  expect(findDragTarget($('#x'), editor)).toBe($('ul'));
});

test('lista w rozwijanej sekcji → cała sekcja (jak Alt+↑/↓)', () => {
  set('<details><summary>Więcej</summary><ul><li id="x">a</li></ul></details>');
  expect(findDragTarget($('#x'), editor)).toBe($('details'));
});

test('sam edytor (margines) → brak bloku', () => {
  set('<p>a</p>');
  expect(findDragTarget(editor, editor)).toBeNull();
});

test('element spoza edytora → brak bloku', () => {
  set('<p>a</p>');
  expect(findDragTarget(document.body, editor)).toBeNull();
});

test('samotne <br> w edytorze → brak bloku', () => {
  set('<p>a</p><br>');
  expect(findDragTarget($('br'), editor)).toBeNull();
});

/* ══ 2. Gdzie wyląduje blok ════════════════════════════════════ */

console.log('\n2. dropIndex');

const rects = [
  { top: 0, bottom: 20 },
  { top: 20, bottom: 40 },
  { top: 40, bottom: 80 },
];

test('nad środkiem pierwszego bloku → na początek', () => {
  expect(dropIndex(rects, 5)).toBe(0);
});

test('między środkami → przed następnym blokiem', () => {
  expect(dropIndex(rects, 25)).toBe(1);
});

test('wysoki blok liczy się od swojego środka', () => {
  expect(dropIndex(rects, 55)).toBe(2);
  expect(dropIndex(rects, 65)).toBe(3);
});

test('poniżej wszystkiego → na koniec', () => {
  expect(dropIndex(rects, 500)).toBe(3);
});

test('brak rodzeństwa → 0', () => {
  expect(dropIndex([], 10)).toBe(0);
});

/* ══ 3. Wśród czego blok się przesuwa ══════════════════════════ */

console.log('\n3. dragSiblings');

test('blok edytora → wszystkie bloki edytora, bez <br>', () => {
  set('<p>a</p><h2>b</h2><br><ul><li>c</li></ul>');
  expect(dragSiblings($('p')).map((e) => e.tagName)).toEqual(['P', 'H2', 'UL']);
});

test('element listy → tylko elementy tej samej listy', () => {
  set('<ul><li id="x">a</li><li>b</li></ul><p>c</p>');
  expect(dragSiblings($('#x')).map((e) => e.textContent)).toEqual(['a', 'b']);
});

/* ══ 4. Grupa z zaznaczenia ════════════════════════════════════ */

console.log('\n4. selectionGroup');

/** Zakres od (sel1, off1) do (sel2, off2); selektory wskazują element, offset w jego pierwszym tekście. */
const rangeOf = (sel1, off1, sel2, off2) => {
  const r = document.createRange();
  const t1 = $(sel1).firstChild;
  const t2 = $(sel2).firstChild;
  r.setStart(t1, off1);
  r.setEnd(t2, off2);
  return r;
};
const texts = (els) => (els ? els.map((e) => e.textContent) : null);

test('puste zaznaczenie → brak grupy', () => {
  set('<p id="a">Pierwszy</p><p id="b">Drugi</p>');
  expect(selectionGroup(rangeOf('#a', 2, '#a', 2), editor)).toBeNull();
});

test('zaznaczenie w jednym bloku → brak grupy (zwykłe przenoszenie)', () => {
  set('<p id="a">Pierwszy</p><p id="b">Drugi</p>');
  expect(selectionGroup(rangeOf('#a', 0, '#a', 5), editor)).toBeNull();
});

test('kilka akapitów → te akapity', () => {
  set('<p id="a">A</p><p id="b">B</p><p id="c">C</p><p id="d">D</p>');
  expect(texts(selectionGroup(rangeOf('#b', 0, '#c', 1), editor))).toEqual(['B', 'C']);
});

test('elementy jednej listy → tylko zaznaczone elementy', () => {
  set('<ul><li id="x">Mleko</li><li id="y">Chleb</li><li>Jajka</li></ul>');
  expect(texts(selectionGroup(rangeOf('#x', 2, '#y', 3), editor))).toEqual(['Mleko', 'Chleb']);
});

test('akapit + część listy → akapit i CAŁA lista', () => {
  set('<p id="a">Zakupy</p><ul><li id="x">Mleko</li><li>Chleb</li></ul><p>Koniec</p>');
  const g = selectionGroup(rangeOf('#a', 0, '#x', 3), editor);
  expect(g.map((e) => e.tagName)).toEqual(['P', 'UL']);
});

test('koniec na samym początku następnego bloku → bez tego bloku', () => {
  set('<p id="a">A</p><p id="b">B</p><p id="c">C</p>');
  expect(texts(selectionGroup(rangeOf('#a', 0, '#c', 0), editor))).toEqual(['A', 'B']);
});

test('koniec na początku drugiego bloku przy dwóch → brak grupy', () => {
  set('<p id="a">A</p><p id="b">B</p>');
  expect(selectionGroup(rangeOf('#a', 0, '#b', 0), editor)).toBeNull();
});

test('zaznaczenie poza edytorem → brak grupy', () => {
  set('<p id="a">A</p>');
  const outside = document.createElement('p');
  outside.textContent = 'obok';
  document.body.append(outside);
  const r = document.createRange();
  r.selectNodeContents(outside);
  expect(selectionGroup(r, editor)).toBeNull();
  outside.remove();
});

/* ══ 5. Poziomy do złapania w wierszu ══════════════════════════ */

console.log('\n5. dragChain / dragKind');

test('akapit → tylko akapit', () => {
  set('<p id="a">A</p>');
  expect(dragChain($('#a'), editor).map((e) => e.id)).toEqual(['a']);
});

test('element listy → element, potem cała lista', () => {
  set('<ul id="l"><li id="x">Mleko</li><li>Chleb</li></ul>');
  expect(dragChain($('#x'), editor).map((e) => e.id)).toEqual(['x', 'l']);
});

test('element podlisty → element, element nadrzędny, cała lista', () => {
  set('<ul id="l"><li id="p">Zakupy<ul><li id="x">jajka</li><li>mąka</li></ul></li><li>Dom</li></ul>');
  expect(dragChain($('#x'), editor).map((e) => e.id)).toEqual(['x', 'p', 'l']);
});

test('rodzaj: lista / element / blok', () => {
  set('<ul><li id="x">a</li></ul><ol id="o"><li>b</li></ol><p id="p">c</p>');
  expect(dragKind($('ul'))).toBe('list');
  expect(dragKind($('#o'))).toBe('list');
  expect(dragKind($('#x'))).toBe('item');
  expect(dragKind($('#p'))).toBe('block');
});

/* ══ 6. Cytaty ═════════════════════════════════════════════════ */

console.log('\n6. Cytaty: linie, łańcuch, upuszczanie');

test('linia cytatu z kilkoma liniami → ta linia', () => {
  set('<blockquote><p id="a">A</p><p>B</p></blockquote>');
  expect(findDragTarget($('#a'), editor)).toBe($('#a'));
  expect(dragKind($('#a'), editor)).toBe('line');
});

test('cytat z jedną linią → cały cytat (nie ma z kim się zamienić)', () => {
  set('<blockquote><p id="a">A</p></blockquote>');
  expect(findDragTarget($('#a'), editor)).toBe($('blockquote'));
});

test('cytat z samą treścią → cały cytat', () => {
  set('<blockquote>tekst <b id="b">pogrubiony</b></blockquote>');
  expect(findDragTarget($('#b'), editor)).toBe($('blockquote'));
});

test('łańcuch linii cytatu → linia, potem cały cytat', () => {
  set('<blockquote id="q"><p id="a">A</p><p>B</p></blockquote>');
  expect(dragChain($('#a'), editor).map((e) => e.id)).toEqual(['a', 'q']);
});

test('zaznaczenie przez dwie linie cytatu → te linie', () => {
  set('<blockquote><p id="a">A1</p><p id="b">B1</p><p>C1</p></blockquote>');
  const r = document.createRange();
  r.setStart($('#a').firstChild, 0);
  r.setEnd($('#b').firstChild, 1);
  expect(texts(selectionGroup(r, editor))).toEqual(['A1', 'B1']);
});

/* Prostokąty bloków ustalamy ręcznie (jsdom nie liczy układu): każdy blok
   20 px, cytat obejmuje swoje linie. */
const layout = (map) => (el) => map.get(el) ?? { top: 0, bottom: 0 };

test('akapit nad środkiem cytatu → do cytatu, między linie', () => {
  set('<p id="p">X</p><blockquote id="q"><p id="a">A</p><p id="b">B</p></blockquote>');
  const rects = new Map([
    [$('#p'), { top: 0, bottom: 20 }],
    [$('#q'), { top: 20, bottom: 60 }],
    [$('#a'), { top: 20, bottom: 40 }],
    [$('#b'), { top: 40, bottom: 60 }],
  ]);
  const t = resolveDrop(editor, [$('#p')], 45, layout(rects));
  expect(t.parent).toBe($('#q'));
  expect(t.intoQuote).toBe(true);
  expect(t.before).toBe($('#b'));
});

test('przy samym brzegu cytatu → przed cytat, nie do środka', () => {
  set('<blockquote id="q"><p id="a">A</p><p id="b">B</p></blockquote><p id="p">X</p>');
  const rects = new Map([
    [$('#q'), { top: 0, bottom: 40 }],
    [$('#a'), { top: 0, bottom: 20 }],
    [$('#b'), { top: 20, bottom: 40 }],
    [$('#p'), { top: 40, bottom: 60 }],
  ]);
  const t = resolveDrop(editor, [$('#p')], 2, layout(rects));
  expect(t.parent).toBe(editor);
  expect(t.intoQuote).toBe(false);
  expect(t.before).toBe($('#q'));
});

test('linia cytatu przeciągnięta pod cytat → wychodzi z cytatu', () => {
  set('<blockquote id="q"><p id="a">A</p><p id="b">B</p></blockquote><p id="p">X</p>');
  const rects = new Map([
    [$('#q'), { top: 0, bottom: 40 }],
    [$('#a'), { top: 0, bottom: 20 }],
    [$('#b'), { top: 20, bottom: 40 }],
    [$('#p'), { top: 40, bottom: 60 }],
  ]);
  const t = resolveDrop(editor, [$('#a')], 58, layout(rects));
  expect(t.parent).toBe(editor);
  expect(t.before).toBeNull();
});

test('linia w obrębie cytatu → przestawienie w cytacie', () => {
  set('<blockquote id="q"><p id="a">A</p><p id="b">B</p><p id="c">C</p></blockquote>');
  const rects = new Map([
    [$('#q'), { top: 0, bottom: 60 }],
    [$('#a'), { top: 0, bottom: 20 }],
    [$('#b'), { top: 20, bottom: 40 }],
    [$('#c'), { top: 40, bottom: 60 }],
  ]);
  const t = resolveDrop(editor, [$('#a')], 45, layout(rects));
  expect(t.parent).toBe($('#q'));
  expect(t.before).toBe($('#c'));
});

test('upuszczenie w tym samym miejscu → brak zmiany', () => {
  set('<p id="a">A</p><p id="b">B</p><p id="c">C</p>');
  const rects = new Map([
    [$('#a'), { top: 0, bottom: 20 }],
    [$('#b'), { top: 20, bottom: 40 }],
    [$('#c'), { top: 40, bottom: 60 }],
  ]);
  expect(resolveDrop(editor, [$('#b')], 30, layout(rects))).toBeNull();
});

results();
