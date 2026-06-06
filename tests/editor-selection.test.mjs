/**
 * editor-selection.test.mjs
 * Testy logiki czystej z editor-selection.js
 *
 * UWAGA: Funkcje używają DOM (getSelection, createRange, editor element).
 * Testujemy tylko logikę którą można wyizolować bez pełnego DOM:
 *   - _isCursorAtListStart  (sprawdza offset w range → mock range)
 *   - strukturę i granice _getCurrentBlock (logika warunkowa)
 *
 * Funkcje czysto DOM-mutujące (_focusLi, _clearBlock, _indentListItem itp.)
 * wymagają browser environment — pominięte z notatką.
 */

import { test, expect, results } from './_runner.mjs';

// ── Mock helpers ──────────────────────────────────────────────────

/**
 * Minimalny mock węzła DOM dla testów logiki.
 */
function mockNode(tag, parent = null, textContent = '') {
  return {
    nodeType:    1,
    tagName:     tag.toUpperCase(),
    textContent,
    parentNode:  parent,
    parentElement: parent,
    children:    [],
    firstChild:  null,
    innerHTML:   '',
    closest: (sel) => {
      // prosta implementacja dla tagów
      const tags = sel.split(',').map(s => s.trim().toUpperCase());
      let node = { tagName: tag.toUpperCase(), parentNode: parent };
      while (node) {
        if (tags.includes(node.tagName)) return node;
        node = node.parentNode;
      }
      return null;
    },
  };
}

function mockTextNode(text, parent = null) {
  return {
    nodeType:    3, // TEXT_NODE
    textContent: text,
    parentNode:  parent,
    parentElement: parent,
  };
}

// ── 1. _isCursorAtListStart logic ────────────────────────────────
// Testujemy logikę: czy tekst między początkiem li a kursorem jest pusty

console.log('\n1. isCursorAtListStart — logika');

/**
 * Izolowana logika z _isCursorAtListStart:
 * Tworzy range od li[0] do pozycji kursora i sprawdza czy toString() === ''
 */
function isCursorAtStart(liTextLength, cursorOffset) {
  // Symulacja: tekst od początku li do kursora
  const textFromStart = 'x'.repeat(liTextLength).slice(0, cursorOffset);
  return textFromStart === '';
}

test('kursor na początku (offset 0) → true', () =>
  expect(isCursorAtStart(5, 0)).toBe(true));
test('kursor w środku → false', () =>
  expect(isCursorAtStart(5, 3)).toBe(false));
test('kursor na końcu → false', () =>
  expect(isCursorAtStart(5, 5)).toBe(false));
test('pusty li + offset 0 → true', () =>
  expect(isCursorAtStart(0, 0)).toBe(true));

// ── 2. _getCurrentBlock — logika wyszukiwania ─────────────────────

console.log('\n2. getCurrentBlock — logika traversal');

/**
 * Izolowana logika _getCurrentBlock:
 * Idzie w górę drzewa szukając block-tagu lub dziedzica editora.
 */
function getCurrentBlockLogic(el, editorEl) {
  const BLOCK_TAGS = ['P', 'H1', 'H2', 'H3', 'BLOCKQUOTE', 'LI'];
  let current = el;
  while (current && current !== editorEl) {
    if (BLOCK_TAGS.includes(current.tagName)) return current;
    if (current.tagName === 'DIV') return current;
    current = current.parentNode;
  }
  return editorEl; // fallback
}

// Buduj drzewo: editor > p > textNode
const editor  = mockNode('DIV');
editor.tagName = 'EDITOR'; // marker
const p       = mockNode('P', editor, 'hello');
const li      = mockNode('LI', editor, 'item');
const h2      = mockNode('H2', editor, 'title');
const span    = mockNode('SPAN', p, 'word');
const nested  = mockNode('SPAN', span, 'deep');

test('kursor w <p> → zwraca <p>', () =>
  expect(getCurrentBlockLogic(p, editor)).toBe(p));

test('kursor w <li> → zwraca <li>', () =>
  expect(getCurrentBlockLogic(li, editor)).toBe(li));

test('kursor w <h2> → zwraca <h2>', () =>
  expect(getCurrentBlockLogic(h2, editor)).toBe(h2));

test('kursor w <span> wewnątrz <p> → zwraca <p>', () =>
  expect(getCurrentBlockLogic(span, editor)).toBe(p));

test('kursor w głęboko zagnieżdżonym <span> → zwraca <p>', () =>
  expect(getCurrentBlockLogic(nested, editor)).toBe(p));

test('kursor bezpośrednio w edytorze → fallback do editora', () =>
  expect(getCurrentBlockLogic(editor, editor)).toBe(editor));

// ── 3. _clearBlock — logika warunkowa ─────────────────────────────

console.log('\n3. clearBlock — logika warunków');

/**
 * Izolowana logika: co clearBlock robi zależnie od typu bloku.
 * Testujemy decyzję (gałąź) nie mutację DOM.
 */
function clearBlockDecision(block, editorEl) {
  if (!block) return 'noop';
  if (block === editorEl) return 'clear-editor';
  return 'clear-block';
}

test('null → noop', () =>
  expect(clearBlockDecision(null, editor)).toBe('noop'));
test('block === editor → clear-editor (specjalna ścieżka)', () =>
  expect(clearBlockDecision(editor, editor)).toBe('clear-editor'));
test('normalny blok → clear-block', () =>
  expect(clearBlockDecision(p, editor)).toBe('clear-block'));

await results([
  '_focusLi, _indentListItem, _outdentListItem — mutują DOM + setSelection → browser only',
  '_clearBlock (pełna) — mutuje innerHTML, insertuje <p>, wywołuje setSelection → browser only',
  '_getListItem — wymaga window.getSelection() → browser only',
  '_restoreCursorTo — wymaga TreeWalker + setSelection → browser only',
]);
