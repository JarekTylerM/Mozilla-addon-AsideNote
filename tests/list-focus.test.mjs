/**
 * list-focus.test.mjs — fokus po przebudowie listy
 *
 * renderList() buduje listę od zera. Główna własność: po akcji z klawiatury
 * fokus nigdy nie spada na <body>, dopóki na liście jest jakikolwiek wiersz.
 */

import { test, expect, results } from './_runner.mjs';
import { nextFocusId } from './list-focus.mjs';

const BEFORE = ['a', 'b', 'c', 'd'];

console.log('\n1. Wiersz zostaje na liście');

test('fokus idzie za wpisem, gdy ten nadal istnieje', () => {
  expect(nextFocusId(BEFORE, 'b', ['a', 'b', 'c', 'd'])).toBe('b');
});

test('fokus idzie za wpisem także po zmianie kolejności', () => {
  expect(nextFocusId(BEFORE, 'b', ['c', 'd', 'a', 'b'])).toBe('b');
});

console.log('\n2. Wiersz zniknął');

test('usunięty środkowy → następny', () => {
  expect(nextFocusId(BEFORE, 'b', ['a', 'c', 'd'])).toBe('c');
});

test('usunięty ostatni → poprzedni', () => {
  expect(nextFocusId(BEFORE, 'd', ['a', 'b', 'c'])).toBe('c');
});

test('następny też zniknął (zwinięta sekcja) → kolejny istniejący', () => {
  expect(nextFocusId(BEFORE, 'b', ['a', 'd'])).toBe('d');
});

test('za wierszem nic nie zostało → najbliższy poprzedni', () => {
  expect(nextFocusId(BEFORE, 'c', ['a'])).toBe('a');
});

test('lista pusta → null', () => {
  expect(nextFocusId(BEFORE, 'b', [])).toBeNull();
});

console.log('\n3. Akcja przenosi wpis (odhaczenie, przełożenie)');

test('moveOff: wpis nadal jest na liście, ale fokus zostaje w miejscu', () => {
  // "b" odhaczone trafiło na koniec, do rozwiniętych "Zakończonych"
  expect(nextFocusId(BEFORE, 'b', ['a', 'c', 'd', 'b'], { moveOff: true })).toBe('c');
});

test('moveOff na ostatnim wierszu → poprzedni', () => {
  expect(nextFocusId(BEFORE, 'd', ['d', 'a', 'b', 'c'], { moveOff: true })).toBe('c');
});

test('moveOff: jedyny wiersz → null zamiast powrotu na ten sam', () => {
  expect(nextFocusId(['a'], 'a', ['a'], { moveOff: true })).toBeNull();
});

console.log('\n4. Dane brzegowe');

test('brak fokusu na liście → null', () => {
  expect(nextFocusId(BEFORE, null, ['a', 'b'])).toBeNull();
});

test('nieznany identyfikator, którego nie ma też po przebudowie → null', () => {
  expect(nextFocusId(BEFORE, 'x', ['a', 'b'])).toBeNull();
});

test('nowy wiersz, którego nie było przed przebudową, zachowuje fokus', () => {
  expect(nextFocusId(BEFORE, 'x', ['a', 'x'])).toBe('x');
});

await results();
