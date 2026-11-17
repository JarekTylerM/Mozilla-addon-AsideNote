/**
 * editor-url.test.mjs
 * Testy: looksLikeUrl() · normalizeUrl() · ALLOWED_LINK_SCHEMES
 *
 * Czyste funkcje — zero DOM, zero browser API.
 */

import { test, expect, results } from './_runner.mjs';
import { looksLikeUrl, normalizeUrl, ALLOWED_LINK_SCHEMES } from './editor-url.mjs';

// ── 1. looksLikeUrl ───────────────────────────────────────────────

console.log('\n1. looksLikeUrl — akceptuje');

test('https://', () => expect(looksLikeUrl('https://example.com')).toBe(true));
test('http://',  () => expect(looksLikeUrl('http://example.com')).toBe(true));
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

// Allowlista: schematy obsługi protokołów w systemie nie przechodzą
test('search-ms:',     () => expect(looksLikeUrl('search-ms:query=x.exe')).toBe(false));
test('ms-msdt:',       () => expect(looksLikeUrl('ms-msdt:/id PCWDiagnostic')).toBe(false));
test('ms-officecmd:',  () => expect(looksLikeUrl('ms-officecmd:{}')).toBe(false));
test('intent:',        () => expect(looksLikeUrl('intent://x#Intent;end')).toBe(false));
test('chrome://',      () => expect(looksLikeUrl('chrome://settings')).toBe(false));
test('ftp:// (poza allowlistą)', () => expect(looksLikeUrl('ftp://files.example.com')).toBe(false));
test('tel:',           () => expect(looksLikeUrl('tel:+48123456789')).toBe(true));

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
  expect(normalizeUrl('//cdn.example.com')).toBe('https://cdn.example.com'));
test('mailto: bez zmian',      () =>
  expect(normalizeUrl('mailto:jan@x.com')).toBe('mailto:jan@x.com'));
test('domena → https://',      () =>
  expect(normalizeUrl('google.com')).toBe('https://google.com'));
test('domena z ścieżką → https://', () =>
  expect(normalizeUrl('google.com/search?q=1')).toBe('https://google.com/search?q=1'));

// ── 3. ALLOWED_LINK_SCHEMES ───────────────────────────────────────

console.log('\n5. ALLOWED_LINK_SCHEMES');

test('zawiera https',          () => expect(ALLOWED_LINK_SCHEMES.has('https')).toBe(true));
test('zawiera http',           () => expect(ALLOWED_LINK_SCHEMES.has('http')).toBe(true));
test('zawiera mailto',         () => expect(ALLOWED_LINK_SCHEMES.has('mailto')).toBe(true));
test('nie zawiera javascript', () => expect(ALLOWED_LINK_SCHEMES.has('javascript')).toBe(false));
test('nie zawiera search-ms',  () => expect(ALLOWED_LINK_SCHEMES.has('search-ms')).toBe(false));
test('normalizeUrl(domena z portem) → https', () =>
  expect(normalizeUrl('localhost:3000')).toBe('https://localhost:3000'));

// ── WYNIKI ────────────────────────────────────────────────────────

await results();
