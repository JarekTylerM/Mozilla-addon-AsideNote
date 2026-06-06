/**
 * editor-url.test.mjs
 * Testy: looksLikeUrl() · normalizeUrl() · BLOCKED_SCHEMES
 *
 * Czyste funkcje — zero DOM, zero browser API.
 */

import { test, expect, results } from './_runner.mjs';
import { looksLikeUrl, normalizeUrl, BLOCKED_SCHEMES } from './editor-url.mjs';

// ── 1. looksLikeUrl ───────────────────────────────────────────────

console.log('\n1. looksLikeUrl — akceptuje');

test('https://', () => expect(looksLikeUrl('https://example.com')).toBe(true));
test('http://',  () => expect(looksLikeUrl('http://example.com')).toBe(true));
test('ftp://',   () => expect(looksLikeUrl('ftp://files.example.com')).toBe(true));
test('//',       () => expect(looksLikeUrl('//cdn.example.com')).toBe(true));
test('mailto:',  () => expect(looksLikeUrl('mailto:jan@example.com')).toBe(true));
test('domena',   () => expect(looksLikeUrl('google.com')).toBe(true));
test('domena z portem', () => expect(looksLikeUrl('example.org:8080')).toBe(true));
test('subdomena', () => expect(looksLikeUrl('docs.example.com/path')).toBe(true));

console.log('\n2. looksLikeUrl — odrzuca niebezpieczne');

test('javascript:',  () => expect(looksLikeUrl('javascript:alert(1)')).toBe(false));
test('data:',        () => expect(looksLikeUrl('data:text/html,<h1>x</h1>')).toBe(false));
test('vbscript:',    () => expect(looksLikeUrl('vbscript:msgbox(1)')).toBe(false));
test('file:',        () => expect(looksLikeUrl('file:///etc/passwd')).toBe(false));
test('javascript z whitespace', () =>
  expect(looksLikeUrl('  javascript:alert(1)')).toBe(false));
test('javascript z null byte', () =>
  expect(looksLikeUrl('\0javascript:alert(1)')).toBe(false));
test('blob:',        () => expect(looksLikeUrl('blob:https://example.com/uuid')).toBe(false));
test('about:blank',  () => expect(looksLikeUrl('about:blank')).toBe(false));
test('moz-extension:', () => expect(looksLikeUrl('moz-extension://abc/page.html')).toBe(false));
test('chrome-extension:', () => expect(looksLikeUrl('chrome-extension://abc/page.html')).toBe(false));

console.log('\n3. looksLikeUrl — odrzuca nie-URL');

test('pusty string',   () => expect(looksLikeUrl('')).toBe(false));
test('samo słowo',     () => expect(looksLikeUrl('notaurl')).toBe(false));
test('spacja',         () => expect(looksLikeUrl('hello world')).toBe(false));

// ── 2. normalizeUrl ───────────────────────────────────────────────

console.log('\n4. normalizeUrl');

test('https:// bez zmian',     () =>
  expect(normalizeUrl('https://example.com')).toBe('https://example.com'));
test('http:// bez zmian',      () =>
  expect(normalizeUrl('http://example.com')).toBe('http://example.com'));
test('// bez zmian',           () =>
  expect(normalizeUrl('//cdn.example.com')).toBe('//cdn.example.com'));
test('mailto: bez zmian',      () =>
  expect(normalizeUrl('mailto:jan@x.com')).toBe('mailto:jan@x.com'));
test('domena → https://',      () =>
  expect(normalizeUrl('google.com')).toBe('https://google.com'));
test('domena z ścieżką → https://', () =>
  expect(normalizeUrl('google.com/search?q=1')).toBe('https://google.com/search?q=1'));

// ── 3. BLOCKED_SCHEMES ────────────────────────────────────────────

console.log('\n5. BLOCKED_SCHEMES');

test('zawiera javascript', () => expect(BLOCKED_SCHEMES.has('javascript')).toBe(true));
test('zawiera data',       () => expect(BLOCKED_SCHEMES.has('data')).toBe(true));
test('zawiera vbscript',   () => expect(BLOCKED_SCHEMES.has('vbscript')).toBe(true));
test('zawiera file',       () => expect(BLOCKED_SCHEMES.has('file')).toBe(true));
test('zawiera blob',       () => expect(BLOCKED_SCHEMES.has('blob')).toBe(true));
test('zawiera about',      () => expect(BLOCKED_SCHEMES.has('about')).toBe(true));
test('nie zawiera https',  () => expect(BLOCKED_SCHEMES.has('https')).toBe(false));
test('nie zawiera http',   () => expect(BLOCKED_SCHEMES.has('http')).toBe(false));

// ── WYNIKI ────────────────────────────────────────────────────────

await results();
