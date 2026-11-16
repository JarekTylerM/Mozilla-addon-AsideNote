/**
 * editor-find.test.mjs — szukanie w otwartej notatce
 *
 * Sedno: pozycja trafienia w tekście ZŁOŻONYM musi być tą samą pozycją
 * w tekście oryginalnym, inaczej Range wyląduje obok. Dlatego foldChar
 * zwraca jeden znak na jeden znak — NFD z utils.foldText zmienia długość
 * ("ą" → "a" + znak łączący) i do mapowania się nie nadaje.
 *
 * Uruchomienie: node tests/editor-find.test.mjs
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const _dom = new JSDOM(
  '<!DOCTYPE html><body><div id="editor" contenteditable="true"></div></body>',
  { pretendToBeVisual: true },
);
global.window = _dom.window;
global.document = _dom.window.document;
global.Node = _dom.window.Node;
global.NodeFilter = _dom.window.NodeFilter;

import { test, expect, results } from './_runner.mjs';
import {
  foldChar,
  foldForFind,
  findMatches,
  collectTextNodes,
  buildFindIndex,
  rangeAt,
  matchAtOrAfter,
} from './editor-find.mjs';

const editor = () => document.getElementById('editor');

/* ══ 1. Składanie znaków ═══════════════════════════════════════ */

console.log('\n1. foldChar / foldForFind');

test('wielkość liter bez znaczenia', () => {
  expect(foldForFind('ŁÓDŹ')).toBe('lodz');
});
test('ogonki bez znaczenia', () => {
  expect(foldForFind('zażółć gęślą')).toBe('zazolc gesla');
});
test('długość wyniku = długość wejścia', () => {
  const src = 'Zażółć gęślą jaźń — ŁÓDŹ!';
  expect(foldForFind(src).length).toBe(src.length);
});
test('znak bez odpowiednika zostaje', () => {
  expect(foldChar('—')).toBe('—');
  expect(foldChar('7')).toBe('7');
});

/* ══ 2. Trafienia ══════════════════════════════════════════════ */

console.log('\n2. findMatches');

test('wszystkie wystąpienia frazy', () => {
  const hits = findMatches('ala ma kota, ala ma psa', 'ala');
  expect(hits.length).toBe(2);
  expect(hits[0].start).toBe(0);
  expect(hits[1].start).toBe(13);
});
test('trafienia nie zachodzą na siebie', () => {
  expect(findMatches('aaaa', 'aa').length).toBe(2);
});
test('puste zapytanie → brak trafień', () => {
  expect(findMatches('cokolwiek', '').length).toBe(0);
});
test('fraza ze spacją działa', () => {
  expect(findMatches('termin oddania pracy', 'oddania pracy').length).toBe(1);
});

/* ══ 3. Mapowanie na DOM ═══════════════════════════════════════ */

console.log('\n3. buildFindIndex / rangeAt');

test('tekst z wielu bloków skleja się w kolejności czytania', () => {
  editor().innerHTML = '<p>pierwszy</p><p>drugi</p>';
  const index = buildFindIndex(editor());
  expect(index.text).toBe('pierwszydrugi');
  expect(index.nodes.length).toBe(2);
});

test('Range trafia dokładnie we frazę — także przez formatowanie', () => {
  editor().innerHTML = '<p>termin <b>oddania</b> pracy</p>';
  const index = buildFindIndex(editor());
  const hits = findMatches(index.text, foldForFind('oddania'));
  expect(hits.length).toBe(1);
  const range = rangeAt(index, hits[0]);
  expect(range.toString()).toBe('oddania');
});

test('fraza na granicy dwóch węzłów też się znajduje', () => {
  editor().innerHTML = '<p>fak<b>tura</b> marzec</p>';
  const index = buildFindIndex(editor());
  const hits = findMatches(index.text, foldForFind('faktura'));
  expect(hits.length).toBe(1);
  expect(rangeAt(index, hits[0]).toString()).toBe('faktura');
});

test('ogonki w treści, zapytanie bez ogonków', () => {
  editor().innerHTML = '<p>Zażółć gęślą jaźń</p>';
  const index = buildFindIndex(editor());
  const hits = findMatches(index.text, foldForFind('gesla'));
  expect(hits.length).toBe(1);
  expect(rangeAt(index, hits[0]).toString()).toBe('gęślą');
});

test('treść summary (toggle) nie wchodzi do szukania', () => {
  editor().innerHTML = '<details><summary>ukryte</summary><p>widoczne</p></details>';
  const index = buildFindIndex(editor());
  expect(index.text.includes('ukryte')).toBe(false);
  expect(index.text.includes('widoczne')).toBe(true);
});

test('collectTextNodes pomija puste węzły', () => {
  editor().innerHTML = '<p>a</p><p></p><p>b</p>';
  expect(collectTextNodes(editor()).length).toBe(2);
});

/* ══ 4. „Następne" liczone od kursora ══════════════════════════ */

console.log('\n4. matchAtOrAfter');

const MATCHES = [
  { start: 5, end: 8 },
  { start: 20, end: 23 },
  { start: 40, end: 43 },
];

test('kursor przed wszystkim → pierwsze trafienie', () => {
  expect(matchAtOrAfter(MATCHES, 0)).toBe(0);
});
test('kursor w środku → najbliższe dalej', () => {
  expect(matchAtOrAfter(MATCHES, 21)).toBe(2);
});
test('kursor za ostatnim → zawija na początek', () => {
  expect(matchAtOrAfter(MATCHES, 100)).toBe(0);
});
test('brak kursora w notatce → pierwsze trafienie', () => {
  expect(matchAtOrAfter(MATCHES, -1)).toBe(0);
});
test('brak trafień → -1', () => {
  expect(matchAtOrAfter([], 0)).toBe(-1);
});

results();
