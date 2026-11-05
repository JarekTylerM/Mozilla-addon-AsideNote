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
  _indentListItems,
  _outdentListItems,
  _selectedListItems,
  _normalizeListNesting,
  _splitListItemKeepingNested,
  _splitBlockAtCaret,
  _mergeListItemBack,
  _continuableList,
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

test('FIX: środkowy podpunkt — punkty pod nim idą za nim (kolejność zachowana)', () => {
  // Wcześniej: A › B, D, a potem C — D przeskakiwał nad C
  const ed = reset('<ul><li>A<ul><li>B</li><li>C</li><li>D</li></ul></li></ul>');
  const c = Array.from(ed.querySelectorAll('li')).find((l) => l.firstChild.textContent === 'C');
  _outdentListItem(c);
  expect(ed.innerHTML).toBe('<ul><li>A<ul><li>B</li></ul></li><li>C<ul><li>D</li></ul></li></ul>');
});

test('FIX: następniki dołączają do istniejącej podlisty wyciąganego punktu', () => {
  const ed = reset('<ul><li>A<ul><li>B<ul><li>B1</li></ul></li><li>C</li></ul></li></ul>');
  const b = Array.from(ed.querySelectorAll('li')).find((l) => l.firstChild.textContent === 'B');
  _outdentListItem(b);
  expect(ed.innerHTML).toBe('<ul><li>A</li><li>B<ul><li>B1</li><li>C</li></ul></li></ul>');
});

test('FIX: kursor zostaje w miejscu po wcięciu (nie skacze na początek)', () => {
  const ed = reset('<ul><li>one</li><li>two</li></ul>');
  const two = ed.querySelectorAll('li')[1];
  setCaret(two.firstChild, 2);
  _indentListItem(two);
  const sel = window.getSelection();
  expect(sel.anchorNode).toBe(two.firstChild);
  expect(sel.anchorOffset).toBe(2);
});

test('wcięcie w checkliście → podlista też jest checklistą', () => {
  const ed = reset(
    '<ul data-list="checklist"><li data-checked="false">a</li><li data-checked="true">b</li></ul>',
  );
  _indentListItem(ed.querySelectorAll('li')[1]);
  expect(ed.innerHTML).toBe(
    '<ul data-list="checklist"><li data-checked="false">a<ul data-list="checklist"><li data-checked="true">b</li></ul></li></ul>',
  );
});

// ── Wiele punktów naraz ───────────────────────────────────────────

console.log('\n2b. Tab / Shift+Tab na zaznaczeniu wielu punktów');

function selectText(startNode, startOffset, endNode, endOffset) {
  const r = document.createRange();
  r.setStart(startNode, startOffset);
  r.setEnd(endNode, endOffset);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  return r;
}

test('_selectedListItems: zaznaczenie B..D → trzy punkty', () => {
  const ed = reset('<ul><li>A</li><li>B</li><li>C</li><li>D</li></ul>');
  const lis = ed.querySelectorAll('li');
  const r = selectText(lis[1].firstChild, 0, lis[3].firstChild, 1);
  expect(_selectedListItems(r).map((l) => l.textContent)).toEqual(['B', 'C', 'D']);
});

test('_selectedListItems: rodzic zaznaczony → jego podpunkty pominięte', () => {
  const ed = reset('<ul><li>A<ul><li>A1</li></ul></li><li>B</li></ul>');
  const lis = ed.querySelectorAll('li');
  const r = selectText(lis[0].firstChild, 0, lis[2].firstChild, 1);
  expect(_selectedListItems(r).map((l) => l.firstChild.textContent)).toEqual(['A', 'B']);
});

test('FIX: Tab na zaznaczeniu B..D wcina wszystkie trzy', () => {
  const ed = reset('<ul><li>A</li><li>B</li><li>C</li><li>D</li></ul>');
  const lis = ed.querySelectorAll('li');
  const r = selectText(lis[1].firstChild, 0, lis[3].firstChild, 1);
  expect(_indentListItems(_selectedListItems(r))).toBe(true);
  expect(ed.innerHTML).toBe('<ul><li>A<ul><li>B</li><li>C</li><li>D</li></ul></li></ul>');
});

test('Tab, gdy pierwszego zaznaczonego nie ma pod co wciąć → nic się nie zmienia', () => {
  const ed = reset('<ul><li>A</li><li>B</li></ul>');
  const lis = ed.querySelectorAll('li');
  const r = selectText(lis[0].firstChild, 0, lis[1].firstChild, 1);
  expect(_indentListItems(_selectedListItems(r))).toBe(false);
  expect(ed.innerHTML).toBe('<ul><li>A</li><li>B</li></ul>');
});

test('FIX: Shift+Tab na zaznaczeniu B..C (bez D) → B, C wyżej, D pod C', () => {
  const ed = reset('<ul><li>A<ul><li>B</li><li>C</li><li>D</li></ul></li></ul>');
  const lis = Array.from(ed.querySelectorAll('li'));
  const b = lis.find((l) => l.firstChild.textContent === 'B');
  const c = lis.find((l) => l.firstChild.textContent === 'C');
  const r = selectText(b.firstChild, 0, c.firstChild, 1);
  expect(_outdentListItems(_selectedListItems(r))).toBe(true);
  expect(ed.innerHTML).toBe('<ul><li>A</li><li>B</li><li>C<ul><li>D</li></ul></li></ul>');
});

test('zaznaczenie przeżywa operację (te same węzły i offsety)', () => {
  const ed = reset('<ul><li>A</li><li>B</li><li>C</li></ul>');
  const lis = ed.querySelectorAll('li');
  const r = selectText(lis[1].firstChild, 0, lis[2].firstChild, 1);
  _indentListItems(_selectedListItems(r));
  const sel = window.getSelection().getRangeAt(0);
  expect(sel.startContainer.textContent).toBe('B');
  expect(sel.endContainer.textContent).toBe('C');
  expect(sel.endOffset).toBe(1);
});

// ── _normalizeListNesting ─────────────────────────────────────────

console.log('\n2c. _normalizeListNesting (ul wprost w ul)');

test('lista w liście → podlista poprzedniego punktu', () => {
  const ed = reset('<ul><li>A</li><ul><li>A1</li></ul><li>B</li></ul>');
  expect(_normalizeListNesting(ed)).toBe(true);
  expect(ed.innerHTML).toBe('<ul><li>A<ul><li>A1</li></ul></li><li>B</li></ul>');
});

test('po naprawie Tab działa na takim punkcie', () => {
  const ed = reset('<ul><li>A</li><ul><li>A1</li><li>A2</li></ul></ul>');
  _normalizeListNesting(ed);
  const a2 = Array.from(ed.querySelectorAll('li')).find((l) => l.textContent === 'A2');
  expect(_indentListItem(a2)).toBe(true);
  expect(ed.innerHTML).toBe('<ul><li>A<ul><li>A1<ul><li>A2</li></ul></li></ul></li></ul>');
});

test('lista w liście bez poprzedniego punktu → punkt z <br> (edytowalny)', () => {
  const ed = reset('<ul><ul><li>x</li></ul></ul>');
  _normalizeListNesting(ed);
  expect(ed.innerHTML).toBe('<ul><li><br><ul><li>x</li></ul></li></ul>');
});

test('poprawna struktura → false, bez zmian', () => {
  const ed = reset('<ul><li>A<ul><li>B</li></ul></li></ul>');
  expect(_normalizeListNesting(ed)).toBe(false);
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

// ── _splitListItemKeepingNested ───────────────────────────────────

console.log('\n5. _splitListItemKeepingNested');

/** Zakres kursora w węźle — helper czytelniejszy niż ręczny Range. */
function caretRange(node, offset) {
  const r = document.createRange();
  r.setStart(node, offset);
  r.collapse(true);
  return r;
}

test('zgłoszony przypadek: Enter na końcu punktu z podlistą', () => {
  // Natywny insertParagraph dawał tu <li><ol><li><br></li></ol></li> —
  // punkt 2 bez własnego tekstu, niemożliwy do edycji.
  const ed = reset('<ol><li>aaaa<ol><li>bbbb</li></ol></li></ol>');
  const li = ed.querySelector('li');
  _splitListItemKeepingNested(li, caretRange(li.firstChild, 4));
  expect(ed.innerHTML).toBe(
    '<ol><li>aaaa<ol><li>bbbb</li></ol></li><li><br></li></ol>',
  );
});

test('podlista zostaje przy oryginalnym punkcie', () => {
  const ed = reset('<ol><li>aaaa<ol><li>bbbb</li></ol></li></ol>');
  const li = ed.querySelector('li');
  _splitListItemKeepingNested(li, caretRange(li.firstChild, 4));
  expect(li.querySelector(':scope > ol')).toBeTruthy();
  expect(ed.querySelectorAll(':scope > ol > li')[1].querySelector('ol')).toBeNull();
});

test('nowy punkt jest edytowalny — ma własny kontener treści', () => {
  const ed = reset('<ol><li>aaaa<ol><li>bbbb</li></ol></li></ol>');
  const li = ed.querySelector('li');
  const newLi = _splitListItemKeepingNested(li, caretRange(li.firstChild, 4));
  // Pierwsze dziecko nie może być listą — inaczej nie ma gdzie postawić kursora
  expect(newLi.firstChild.nodeName).toBe('BR');
});

test('kursor w środku tekstu — ogon wędruje do nowego punktu', () => {
  const ed = reset('<ol><li>aabb<ol><li>cccc</li></ol></li></ol>');
  const li = ed.querySelector('li');
  _splitListItemKeepingNested(li, caretRange(li.firstChild, 2));
  expect(ed.innerHTML).toBe(
    '<ol><li>aa<ol><li>cccc</li></ol></li><li>bb</li></ol>',
  );
});

test('kursor na początku tekstu — oryginał nie zostaje z samą podlistą', () => {
  const ed = reset('<ol><li>aaaa<ol><li>bbbb</li></ol></li></ol>');
  const li = ed.querySelector('li');
  _splitListItemKeepingNested(li, caretRange(li.firstChild, 0));
  // Oba punkty muszą mieć gdzie trzymać kursor
  expect(ed.innerHTML).toBe(
    '<ol><li><br><ol><li>bbbb</li></ol></li><li>aaaa</li></ol>',
  );
});

test('zachowuje formatowanie w przenoszonym ogonie', () => {
  const ed = reset('<ul><li>aa<strong>bb</strong><ul><li>cc</li></ul></li></ul>');
  const li = ed.querySelector('li');
  _splitListItemKeepingNested(li, caretRange(li.firstChild, 2));
  expect(ed.innerHTML).toBe(
    '<ul><li>aa<ul><li>cc</li></ul></li><li><strong>bb</strong></li></ul>',
  );
});

test('bez podlisty działa jak zwykły podział', () => {
  const ed = reset('<ul><li>aabb</li></ul>');
  const li = ed.querySelector('li');
  _splitListItemKeepingNested(li, caretRange(li.firstChild, 2));
  expect(ed.innerHTML).toBe('<ul><li>aa</li><li>bb</li></ul>');
});

test('podlista <ul> pod <ol> też zostaje na miejscu', () => {
  const ed = reset('<ol><li>aaaa<ul><li>bbbb</li></ul></li></ol>');
  const li = ed.querySelector('li');
  _splitListItemKeepingNested(li, caretRange(li.firstChild, 4));
  expect(ed.innerHTML).toBe(
    '<ol><li>aaaa<ul><li>bbbb</li></ul></li><li><br></li></ol>',
  );
});

test('nowy punkt trafia bezpośrednio po oryginale, na tym samym poziomie', () => {
  const ed = reset('<ol><li>one<ol><li>sub</li></ol></li><li>two</li></ol>');
  const li = ed.querySelector('li');
  const newLi = _splitListItemKeepingNested(li, caretRange(li.firstChild, 3));
  expect(newLi.parentElement).toBe(li.parentElement);
  expect(newLi.previousElementSibling).toBe(li);
  expect(newLi.nextElementSibling.textContent).toBe('two');
});

// ── _continuableList ──────────────────────────────────────────────

console.log('\n6. _continuableList');

/** Ostatni blok w edytorze — ten, w którym „wpisujemy” trigger. */
const lastBlock = (ed) => ed.lastElementChild;

test('akapit tuż pod <ol> → kontynuuje tę listę', () => {
  const ed = reset('<ol><li>a</li><li>b</li><li>c</li></ol><p>4.</p>');
  expect(_continuableList(lastBlock(ed), 'ordered')).toBe(ed.querySelector('ol'));
});

test('pusta linia między listą a akapitem → nowa lista', () => {
  // Dokładnie ten wyjątek: przerwa co najmniej jednej nie-listowej linii
  const ed = reset('<ol><li>a</li></ol><p><br></p><p>1.</p>');
  expect(_continuableList(lastBlock(ed), 'ordered')).toBeNull();
});

test('linia z tekstem między listą a akapitem → nowa lista', () => {
  const ed = reset('<ol><li>a</li></ol><p>komentarz</p><p>1.</p>');
  expect(_continuableList(lastBlock(ed), 'ordered')).toBeNull();
});

test('brak czegokolwiek nad blokiem → nowa lista', () => {
  const ed = reset('<p>1.</p>');
  expect(_continuableList(lastBlock(ed), 'ordered')).toBeNull();
});

test('punktowany trigger pod <ul> → kontynuuje', () => {
  const ed = reset('<ul><li>a</li></ul><p>-</p>');
  expect(_continuableList(lastBlock(ed), 'bullet')).toBe(ed.querySelector('ul'));
});

test('checklist pod checklistą → kontynuuje', () => {
  const ed = reset('<ul data-list="checklist"><li>a</li></ul><p>-[ ]</p>');
  expect(_continuableList(lastBlock(ed), 'checklist')).toBe(ed.querySelector('ul'));
});

// ── Typ musi się zgadzać ──────────────────────────────────────────

test('numerowany trigger pod <ul> → nowa lista', () => {
  const ed = reset('<ul><li>a</li></ul><p>1.</p>');
  expect(_continuableList(lastBlock(ed), 'ordered')).toBeNull();
});

test('punktowany trigger pod <ol> → nowa lista', () => {
  const ed = reset('<ol><li>a</li></ol><p>-</p>');
  expect(_continuableList(lastBlock(ed), 'bullet')).toBeNull();
});

test('zwykły punktowany pod checklistą → nowa lista', () => {
  const ed = reset('<ul data-list="checklist"><li>a</li></ul><p>-</p>');
  expect(_continuableList(lastBlock(ed), 'bullet')).toBeNull();
});

test('checklist pod zwykłym <ul> → nowa lista', () => {
  const ed = reset('<ul><li>a</li></ul><p>-[ ]</p>');
  expect(_continuableList(lastBlock(ed), 'checklist')).toBeNull();
});

test('kontynuacja działa też dla listy z atrybutem start', () => {
  const ed = reset('<ol start="5"><li>a</li></ol><p>6.</p>');
  expect(_continuableList(lastBlock(ed), 'ordered')).toBe(ed.querySelector('ol'));
});

test('null zamiast bloku → null, bez wyjątku', () => {
  expect(_continuableList(null, 'ordered')).toBeNull();
});

// ── _splitBlockAtCaret ────────────────────────────────────────────

console.log('\n7. _splitBlockAtCaret');

test('cytat: Enter w środku linii przenosi ogon do nowego akapitu', () => {
  // Dotąd powstawał pusty <p>, a "abcdef" zostawało w całości wyżej
  const ed = reset('<blockquote><p>abcdef</p></blockquote>');
  const p = ed.querySelector('p');
  _splitBlockAtCaret(p, caretRange(p.firstChild, 3), 'p');
  expect(ed.innerHTML).toBe('<blockquote><p>abc</p><p>def</p></blockquote>');
});

test('kursor na końcu → nowy blok pusty, oryginał nietknięty', () => {
  const ed = reset('<blockquote><p>abc</p></blockquote>');
  const p = ed.querySelector('p');
  _splitBlockAtCaret(p, caretRange(p.firstChild, 3), 'p');
  expect(ed.innerHTML).toBe('<blockquote><p>abc</p><p><br></p></blockquote>');
});

test('kursor na początku → oryginał dostaje <br>, nie zostaje pusty', () => {
  const ed = reset('<blockquote><p>abc</p></blockquote>');
  const p = ed.querySelector('p');
  _splitBlockAtCaret(p, caretRange(p.firstChild, 0), 'p');
  expect(ed.innerHTML).toBe('<blockquote><p><br></p><p>abc</p></blockquote>');
});

test('zachowuje formatowanie w przenoszonym ogonie', () => {
  const ed = reset('<blockquote><p>ab<em>cd</em></p></blockquote>');
  const p = ed.querySelector('p');
  _splitBlockAtCaret(p, caretRange(p.firstChild, 2), 'p');
  expect(ed.innerHTML).toBe(
    '<blockquote><p>ab</p><p><em>cd</em></p></blockquote>',
  );
});

// ── _mergeListItemBack ────────────────────────────────────────────

console.log('\n8. _mergeListItemBack');

test('scalanie zwykłych punktów — treść łączy się w jeden', () => {
  const ed = reset('<ul><li>abc</li><li>def</li></ul>');
  const [prev, li] = ed.querySelectorAll('li');
  _mergeListItemBack(li, prev);
  expect(ed.innerHTML).toBe('<ul><li>abcdef</li></ul>');
});

test('poprzednik z podlistą — tekst ląduje PRZED nią, nie pod nią', () => {
  const ed = reset('<ul><li>abc<ul><li>sub</li></ul></li><li>def</li></ul>');
  const [prev] = ed.querySelectorAll(':scope > ul > li');
  const li = ed.querySelectorAll(':scope > ul > li')[1];
  _mergeListItemBack(li, prev);
  expect(ed.innerHTML).toBe('<ul><li>abcdef<ul><li>sub</li></ul></li></ul>');
});

test('scalany punkt z podlistą — podlista przechodzi do poprzednika', () => {
  const ed = reset('<ul><li>abc</li><li>def<ul><li>sub</li></ul></li></ul>');
  const items = ed.querySelectorAll(':scope > ul > li');
  _mergeListItemBack(items[1], items[0]);
  expect(ed.innerHTML).toBe('<ul><li>abcdef<ul><li>sub</li></ul></li></ul>');
});

test('obie strony z podlistą — jedna podlista, nie dwie równoległe', () => {
  const ed = reset(
    '<ul><li>abc<ul><li>s1</li></ul></li><li>def<ul><li>s2</li></ul></li></ul>',
  );
  const items = ed.querySelectorAll(':scope > ul > li');
  _mergeListItemBack(items[1], items[0]);
  expect(ed.querySelectorAll(':scope > ul > li > ul').length).toBe(1);
  expect(ed.innerHTML).toBe(
    '<ul><li>abcdef<ul><li>s1</li><li>s2</li></ul></li></ul>',
  );
});

test('styk kursora wypada na końcu treści poprzednika', () => {
  const ed = reset('<ul><li>abc<ul><li>sub</li></ul></li><li>def</li></ul>');
  const items = ed.querySelectorAll(':scope > ul > li');
  const seam = _mergeListItemBack(items[1], items[0]);
  expect(seam.node.textContent).toBe('abc');
  expect(seam.offset).toBe(3);
});

test('domykające <br> poprzednika nie zostaje w środku scalonej treści', () => {
  const ed = reset('<ul><li>abc<br></li><li>def</li></ul>');
  const items = ed.querySelectorAll('li');
  _mergeListItemBack(items[1], items[0]);
  expect(ed.innerHTML).toBe('<ul><li>abcdef</li></ul>');
});

test('scalanie pustego punktu w pusty → punkt zostaje edytowalny', () => {
  const ed = reset('<ul><li><br></li><li><br></li></ul>');
  const items = ed.querySelectorAll('li');
  _mergeListItemBack(items[1], items[0]);
  expect(ed.innerHTML).toBe('<ul><li><br></li></ul>');
});

test('checklista scala się tak samo, bez zmiany stanu poprzednika', () => {
  const ed = reset(
    '<ul data-list="checklist"><li data-checked="true">abc</li>' +
      '<li data-checked="false">def</li></ul>',
  );
  const items = ed.querySelectorAll('li');
  _mergeListItemBack(items[1], items[0]);
  expect(ed.innerHTML).toBe(
    '<ul data-list="checklist"><li data-checked="true">abcdef</li></ul>',
  );
});

await results([
  '_focusLi / _restoreCursorTo — testowane pośrednio przez indent/outdent (focus + selection)',
]);
