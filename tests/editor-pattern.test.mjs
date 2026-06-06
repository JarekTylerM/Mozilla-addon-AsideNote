/**
 * editor-pattern.test.mjs
 * Testy: findInlinePattern() · MD_LINK_RX
 *
 * Czyste funkcje — zero DOM, zero browser API.
 */

import { test, expect, results } from './_runner.mjs';
import { findInlinePattern, MD_LINK_RX } from './editor-pattern.mjs';

// ── 1. findInlinePattern — bold ───────────────────────────────────

console.log('\n1. findInlinePattern — **bold**');

test('trigger na 2. gwiazdce', () => {
  const r = findInlinePattern('**hello*', '*');
  expect(r?.tag).toBe('strong');
  expect(r?.content).toBe('hello');
  expect(r?.markerLen).toBe(2);
});
test('openIdx wskazuje na **', () => {
  const r = findInlinePattern('abc **hello*', '*');
  expect(r?.openIdx).toBe(4);
});
test('*** nie triggeruje bold', () => {
  const r = findInlinePattern('***hello*', '*');
  expect(r).toBe(null);
});
test('treść z spacją', () => {
  const r = findInlinePattern('**hello world*', '*');
  expect(r?.content).toBe('hello world');
});

// ── 2. findInlinePattern — italic ────────────────────────────────

console.log('\n2. findInlinePattern — *italic*');

test('trigger na gwiazdce', () => {
  const r = findInlinePattern('*hello', '*');
  expect(r?.tag).toBe('em');
  expect(r?.content).toBe('hello');
  expect(r?.markerLen).toBe(1);
});
test('italic po tekście', () => {
  const r = findInlinePattern('abc *hello', '*');
  expect(r?.tag).toBe('em');
});
test('nie triggeruje gdy brak otwierającego *', () => {
  const r = findInlinePattern('hello', '*');
  expect(r).toBe(null);
});

// ── 3. findInlinePattern — strike ────────────────────────────────

console.log('\n3. findInlinePattern — ~~strike~~');

test('trigger na 2. tyldzie', () => {
  const r = findInlinePattern('~~hello~', '~');
  expect(r?.tag).toBe('s');
  expect(r?.content).toBe('hello');
  expect(r?.markerLen).toBe(2);
});
test('jedna tylda nie triggeruje', () => {
  const r = findInlinePattern('~hello', '~');
  expect(r).toBe(null);
});

// ── 3b. findInlinePattern — dead key ~~ (polska klawiatura) ──────

console.log('\n3b. findInlinePattern — dead key ~~');

test('dead key ~~ — trigger gdy textBefore = "~~treść"', () => {
  // Polska klawiatura: ~~ wstawiane naraz, textBefore kończy się na treści bez trailing ~
  const r = findInlinePattern('~~hello', '~~');
  expect(r?.tag).toBe('s');
  expect(r?.content).toBe('hello');
});
test('dead key ~~ — pusta treść → null', () => {
  expect(findInlinePattern('~~', '~~')).toBe(null);
});
test('dead key ~~ — treść z spacją', () => {
  const r = findInlinePattern('~~hello world', '~~');
  expect(r?.content).toBe('hello world');
});

// ── 4. findInlinePattern — _italic_ ──────────────────────────────

console.log('\n4. findInlinePattern — _italic_');

test('trigger na _', () => {
  const r = findInlinePattern('_hello', '_');
  expect(r?.tag).toBe('em');
  expect(r?.content).toBe('hello');
  expect(r?.markerLen).toBe(1);
});
test('_italic_ po tekście', () => {
  const r = findInlinePattern('abc _hello', '_');
  expect(r?.tag).toBe('em');
});
test('snake_case nie triggeruje (wewnątrz słowa)', () => {
  const r = findInlinePattern('my_var', '_');
  expect(r).toBeNull();
});
test('__ nie triggeruje _italic_ (zwraca null lub strong)', () => {
  // '__hello_' to textBefore dla __bold__, nie _italic_
  const r = findInlinePattern('__hello', '_');
  // _italic_ regex wymaga [^_\w] przed _ — poprzedzające _ blokuje match
  expect(r).toBeNull();
});

// ── 5. findInlinePattern — __bold__ ──────────────────────────────

console.log('\n5. findInlinePattern — __bold__');

test('trigger na 2. podkreśleniu', () => {
  const r = findInlinePattern('__hello_', '_');
  expect(r?.tag).toBe('strong');
  expect(r?.content).toBe('hello');
  expect(r?.markerLen).toBe(2);
});
test('___ nie triggeruje __bold__ (guard: prev char = _)', () => {
  // '___hello_' — m.index-1 to '_', guard odrzuca
  const r = findInlinePattern('___hello', '_');
  expect(r).toBeNull();
});
test('__bold__ po tekście', () => {
  const r = findInlinePattern('abc __hello_', '_');
  expect(r?.tag).toBe('strong');
});

// ── 6. findInlinePattern — ___bold italic___ ─────────────────────

console.log('\n6. findInlinePattern — ___bold italic___');

test('trigger na 3. podkreśleniu', () => {
  const r = findInlinePattern('___hello__', '_');
  expect(r?.tag).toBe('strong-em');
  expect(r?.content).toBe('hello');
  expect(r?.markerLen).toBe(3);
});
test('___bold italic___ po tekście', () => {
  const r = findInlinePattern('abc ___hello__', '_');
  expect(r?.tag).toBe('strong-em');
});

// ── 7. findInlinePattern — ***bold italic*** ──────────────────────

console.log('\n7. findInlinePattern — ***bold italic***');

test('trigger na 3. gwiazdce', () => {
  const r = findInlinePattern('***hello**', '*');
  expect(r?.tag).toBe('strong-em');
  expect(r?.content).toBe('hello');
  expect(r?.markerLen).toBe(3);
});
test('***bold italic*** po tekście', () => {
  const r = findInlinePattern('abc ***hello**', '*');
  expect(r?.tag).toBe('strong-em');
});

// ── 8. findInlinePattern — `code` ────────────────────────────────

console.log('\n8. findInlinePattern — `code`');

test('trigger na backticku', () => {
  const r = findInlinePattern('`hello', '`');
  expect(r?.tag).toBe('code');
  expect(r?.content).toBe('hello');
  expect(r?.markerLen).toBe(1);
});
test('pusty backtick nie triggeruje', () => {
  const r = findInlinePattern('`', '`');
  expect(r).toBe(null);
});

// ── 9. findInlinePattern — edge cases ────────────────────────────

console.log('\n9. findInlinePattern — edge cases');

test('nieznany klawisz → null', () => {
  expect(findInlinePattern('**hello*', 'x')).toBe(null);
});
test('newline w treści → null', () => {
  expect(findInlinePattern('**he\nllo*', '*')).toBe(null);
});
test('za długa treść (301 znaków) → null', () => {
  const long = 'a'.repeat(301);
  expect(findInlinePattern(`**${long}*`, '*')).toBe(null);
});
test('pusta treść → null (bold)', () => {
  expect(findInlinePattern('***', '*')).toBe(null);
});

// ── 10. MD_LINK_RX ────────────────────────────────────────────────

console.log('\n10. MD_LINK_RX');

test('prosty link', () => {
  const m = '[tekst](https://example.com)'.match(MD_LINK_RX);
  expect(m?.[1]).toBe('tekst');
  expect(m?.[2]).toBe('https://example.com');
});
test('link bez tekstu', () => {
  const m = '[](https://example.com)'.match(MD_LINK_RX);
  expect(m?.[1]).toBe('');
});
test('link na końcu zdania', () => {
  const m = 'Odwiedź [tutaj](https://x.com)'.match(MD_LINK_RX);
  expect(m?.[1]).toBe('tutaj');
});
test('brak nawiasów → null', () => {
  expect('tekst bez linka'.match(MD_LINK_RX)).toBe(null);
});
test('spacja w URL → null', () => {
  expect('[a](https://ex ample.com)'.match(MD_LINK_RX)).toBe(null);
});
test('zagnieżdżone nawiasy → null', () => {
  expect('[a]([b](c))'.match(MD_LINK_RX)).toBe(null);
});

// ── WYNIKI ────────────────────────────────────────────────────────

await results();
