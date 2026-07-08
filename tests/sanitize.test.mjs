/**
 * sanitize.test.mjs — testy sanitize.js
 *
 * Pokrycie: validateText, isValidId, safeHref, sanitizeImportedNote,
 *           sanitizeImportedTag, sanitizeHTML (przez jsdom DOMParser)
 */

import { createRequire } from 'module';
import { test, testBug, expect, results } from './_runner.mjs';
import {
  validateText,
  isValidId,
  safeHref,
  sanitizeImportedNote,
  sanitizeImportedTag,
  sanitizeHTML,
  MAX_TITLE_LEN,
  MAX_TAG_NAME_LEN,
  MAX_CONTENT_LEN,
  MAX_ID_LEN,
} from './sanitize.mjs';

// jsdom dostarcza DOMParser — sanitizeHTML używa go dopiero przy wywołaniu,
// więc global można ustawić po imporcie modułu.
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
global.DOMParser = new JSDOM().window.DOMParser;

// ── validateText ─────────────────────────────────────────────────

console.log('\n1. validateText');

test('normalny string → error null', () => {
  const r = validateText('Hello world', 100);
  expect(r.error).toBeNull();
  expect(r.value).toBe('Hello world');
  expect(r.truncated).toBe('Hello world');
});

test('null → error null, pusta wartość', () => {
  const r = validateText(null, 100);
  expect(r.error).toBeNull();
  expect(r.value).toBe('');
});

test('undefined → error null, pusta wartość', () => {
  const r = validateText(undefined, 100);
  expect(r.error).toBeNull();
  expect(r.value).toBe('');
});

test('liczba → validation_notString', () => {
  const r = validateText(42, 100);
  expect(r.error).toBe('validation_notString');
});

test('za długi string → validation_tooLong', () => {
  const r = validateText('a'.repeat(201), 200);
  expect(r.error).toBe('validation_tooLong');
  expect(r.truncated).toBe('a'.repeat(200));
});

test('dokładnie na limicie → ok', () => {
  const r = validateText('a'.repeat(200), 200);
  expect(r.error).toBeNull();
});

test('null byte usunięty', () => {
  const r = validateText('hello\u0000world', 100);
  expect(r.value).toBe('helloworld');
  expect(r.error).toBeNull();
});

test('bidi override usunięty', () => {
  const r = validateText('hello\u202Eworld', 100);
  expect(r.value).toBe('helloworld');
});

test('zero-width space usunięty', () => {
  const r = validateText('hello\u200Bworld', 100);
  expect(r.value).toBe('helloworld');
});

test('BOM usunięty', () => {
  const r = validateText('\uFEFFhello', 100);
  expect(r.value).toBe('hello');
});

test('polskie znaki zachowane', () => {
  const r = validateText('zażółć gęślą jaźń', 100);
  expect(r.value).toBe('zażółć gęślą jaźń');
  expect(r.error).toBeNull();
});

test('pusta linia → ok', () => {
  const r = validateText('', 100);
  expect(r.error).toBeNull();
  expect(r.value).toBe('');
});

// ── isValidId ────────────────────────────────────────────────────

console.log('\n2. isValidId');

test('typowe ID notatki → valid', () => {
  expect(isValidId('lk3abc_xy12')).toBe(true);
});

test('tag ID → valid', () => {
  expect(isValidId('tag_1778968381992')).toBe(true);
});

test('pusta linia → invalid', () => {
  expect(isValidId('')).toBe(false);
});

test('null → invalid', () => {
  expect(isValidId(null)).toBe(false);
});

test('undefined → invalid', () => {
  expect(isValidId(undefined)).toBe(false);
});

test('za długie → invalid', () => {
  expect(isValidId('a'.repeat(101))).toBe(false);
});

test('spacja → invalid', () => {
  expect(isValidId('id with space')).toBe(false);
});

test('slash → invalid', () => {
  expect(isValidId('id/slash')).toBe(false);
});

test('kropka → invalid', () => {
  expect(isValidId('id.dot')).toBe(false);
});

test('myślnik → valid', () => {
  expect(isValidId('my-id-123')).toBe(true);
});

test('dokładnie MAX_ID_LEN znaków → valid', () => {
  expect(isValidId('a'.repeat(MAX_ID_LEN))).toBe(true);
});

test('MAX_ID_LEN + 1 znaków → invalid', () => {
  expect(isValidId('a'.repeat(MAX_ID_LEN + 1))).toBe(false);
});

// ── safeHref ─────────────────────────────────────────────────────

console.log('\n3. safeHref');

test('https → ok', () => {
  expect(safeHref('https://example.com')).toBe('https://example.com');
});

test('http → ok', () => {
  expect(safeHref('http://example.com')).toBe('http://example.com');
});

test('mailto → ok (nie na liście blocked)', () => {
  expect(safeHref('mailto:user@example.com')).toBeTruthy();
});

test('javascript: → null', () => {
  expect(safeHref('javascript:alert(1)')).toBeNull();
});

test('JAVASCRIPT: → null (case insensitive)', () => {
  expect(safeHref('JAVASCRIPT:alert(1)')).toBeNull();
});

test('javascript z whitespace przed → null', () => {
  expect(safeHref('  javascript:alert(1)')).toBeNull();
});

test('data: → null', () => {
  expect(safeHref('data:text/html,<h1>test</h1>')).toBeNull();
});

test('vbscript: → null', () => {
  expect(safeHref('vbscript:msgbox(1)')).toBeNull();
});

test('file: → null', () => {
  expect(safeHref('file:///etc/passwd')).toBeNull();
});

test('puste string → null', () => {
  expect(safeHref('')).toBeNull();
});

test('null → null', () => {
  expect(safeHref(null)).toBeNull();
});

test('relative URL → ok', () => {
  expect(safeHref('/relative/path')).toBeTruthy();
});

test('blob: → null', () => {
  expect(safeHref('blob:https://example.com/uuid')).toBeNull();
});

test('about: → null', () => {
  expect(safeHref('about:blank')).toBeNull();
});

test('moz-extension: → null', () => {
  expect(safeHref('moz-extension://abc123/page.html')).toBeNull();
});

test('chrome-extension: → null', () => {
  expect(safeHref('chrome-extension://abc123/page.html')).toBeNull();
});

// ── sanitizeImportedNote ──────────────────────────────────────────

console.log('\n4. sanitizeImportedNote');

const validNote = {
  id: 'abc123',
  type: 'note',
  title: 'Tytuł notatki',
  content: '',
  created: Date.now(),
  tags: [],
};

test('poprawna notatka → ok: true', () => {
  const r = sanitizeImportedNote(validNote);
  expect(r.ok).toBe(true);
  expect(r.note.id).toBe('abc123');
  expect(r.note.type).toBe('note');
  expect(r.note.title).toBe('Tytuł notatki');
});

test('null → ok: false', () => {
  expect(sanitizeImportedNote(null).ok).toBe(false);
});

test('array → ok: false', () => {
  expect(sanitizeImportedNote([]).ok).toBe(false);
});

test('brak id → ok: false', () => {
  expect(sanitizeImportedNote({...validNote, id: ''}).ok).toBe(false);
});

test('nieprawidłowe id (ze spacją) → ok: false', () => {
  expect(sanitizeImportedNote({...validNote, id: 'invalid id'}).ok).toBe(false);
});

test('type=task → ok z polami task', () => {
  const r = sanitizeImportedNote({
    ...validNote,
    type: 'task',
    completed: false,
    due: Date.now(),
    time: '09:00',
    reminder: 15,
  });
  expect(r.ok).toBe(true);
  expect(r.note.type).toBe('task');
  expect(r.note.completed).toBe(false);
  expect(r.note.reminder).toBe(15);
});

test('type=task z nieprawidłowym reminder → 0', () => {
  const r = sanitizeImportedNote({...validNote, type: 'task', reminder: 999});
  expect(r.note.reminder).toBe(0);
});

test('type=task z nieprawidłowym due (string) → null', () => {
  const r = sanitizeImportedNote({...validNote, type: 'task', due: '2025-01-01'});
  expect(r.note.due).toBeNull();
});

test('type=task z nieprawidłowym time → null', () => {
  const r = sanitizeImportedNote({...validNote, type: 'task', time: '25:99'});
  expect(r.note.time).toBeNull();
});

test('type=task z poprawnym time → zachowany', () => {
  const r = sanitizeImportedNote({...validNote, type: 'task', time: '9:00'});
  expect(r.note.time).toBe('09:00');
});

test('za długi tytuł → przycinany do MAX_TITLE_LEN', () => {
  const r = sanitizeImportedNote({...validNote, title: 'a'.repeat(MAX_TITLE_LEN + 10)});
  expect(r.ok).toBe(true);
  expect(r.note.title.length).toBe(MAX_TITLE_LEN);
});

test('tags → tylko valid IDs zachowane', () => {
  const r = sanitizeImportedNote({...validNote, tags: ['valid_id', 'invalid id', 'ok_123']});
  expect(r.ok).toBe(true);
  expect(r.note.tags).toEqual(['valid_id', 'ok_123']);
});

test('created poza zakresem → zastąpiony Date.now()', () => {
  const r = sanitizeImportedNote({...validNote, created: 9999999999999});
  expect(r.note.created).toBeGreaterThan(0);
});

test('nieznany type → sprowadzony do "note"', () => {
  const r = sanitizeImportedNote({...validNote, type: 'unknown'});
  expect(r.note.type).toBe('note');
});

test('type=task z focus=true → zachowany', () => {
  const r = sanitizeImportedNote({...validNote, type: 'task', focus: true});
  expect(r.note.focus).toBe(true);
});

test('type=task z focus=false → zachowany', () => {
  const r = sanitizeImportedNote({...validNote, type: 'task', focus: false});
  expect(r.note.focus).toBe(false);
});

test('type=task z important=true → zachowany', () => {
  const r = sanitizeImportedNote({...validNote, type: 'task', important: true});
  expect(r.note.important).toBe(true);
});

test('type=task z recurrence=custom + poprawne recurrenceDays → zachowane', () => {
  const r = sanitizeImportedNote({...validNote, type: 'task',
    recurrence: 'custom', recurrenceDays: [1, 3, 5]});
  expect(r.note.recurrence).toBe('custom');
  expect(r.note.recurrenceDays).toEqual([1, 3, 5]);
});

test('type=task z recurrence=custom + niepoprawne dni → fallback [1,2,3,4,5]', () => {
  const r = sanitizeImportedNote({...validNote, type: 'task',
    recurrence: 'custom', recurrenceDays: [9, 10, 11]});
  expect(r.note.recurrenceDays).toEqual([1, 2, 3, 4, 5]);
});

test('type=task z recurrence=custom + pusta tablica → fallback [1,2,3,4,5]', () => {
  const r = sanitizeImportedNote({...validNote, type: 'task',
    recurrence: 'custom', recurrenceDays: []});
  expect(r.note.recurrenceDays).toEqual([1, 2, 3, 4, 5]);
});

test('type=task z recurrence=custom + duplikaty → deduplikowane', () => {
  const r = sanitizeImportedNote({...validNote, type: 'task',
    recurrence: 'custom', recurrenceDays: [1, 1, 3, 3]});
  expect(r.note.recurrenceDays).toEqual([1, 3]);
});

test('type=task z recurrence=weekly + recurrenceDays → recurrenceDays=null', () => {
  const r = sanitizeImportedNote({...validNote, type: 'task',
    recurrence: 'weekly', recurrenceDays: [1, 3, 5]});
  expect(r.note.recurrenceDays).toBeNull();
});

test('type=task z recurrence=null → recurrenceDays=null', () => {
  const r = sanitizeImportedNote({...validNote, type: 'task', recurrence: null});
  expect(r.note.recurrenceDays).toBeNull();
});

test('content ≤ limitu → truncated=false, treść nietknięta', () => {
  const r = sanitizeImportedNote({...validNote, content: '<p>krótka</p>'});
  expect(r.truncated).toBe(false);
  expect(r.note.content).toContain('krótka');
});

test('content > MAX_CONTENT_LEN → truncated=true (import raportuje, nie gubi po cichu)', () => {
  const big = '<p>' + 'a'.repeat(MAX_CONTENT_LEN + 100) + '</p>';
  const r = sanitizeImportedNote({...validNote, content: big});
  expect(r.truncated).toBe(true);
  // Treść realnie skrócona względem oryginału (sanitizeHTML domyka ucięty <p>,
  // więc wynik bywa o kilka znaków dłuższy niż surowy slice — dlatego < big, nie ≤ limit).
  expect(r.note.content.length < big.length).toBe(true);
});

test('content dokładnie MAX_CONTENT_LEN → truncated=false (granica)', () => {
  const exact = 'a'.repeat(MAX_CONTENT_LEN);
  const r = sanitizeImportedNote({...validNote, content: exact});
  expect(r.truncated).toBe(false);
});

// ── sanitizeImportedTag ───────────────────────────────────────────

console.log('\n5. sanitizeImportedTag');

const validTag = {
  id: 'tag_123',
  name: 'mój tag',
  color: { bg: '#dbeafe', fg: '#1d4ed8' },
};

test('poprawny tag → ok', () => {
  const r = sanitizeImportedTag(validTag);
  expect(r).toBeTruthy();
  expect(r.id).toBe('tag_123');
  expect(r.name).toBe('mój tag');
});

test('null → null', () => {
  expect(sanitizeImportedTag(null)).toBeNull();
});

test('brak id → null', () => {
  expect(sanitizeImportedTag({...validTag, id: ''})).toBeNull();
});

test('pusta nazwa → null', () => {
  expect(sanitizeImportedTag({...validTag, name: ''})).toBeNull();
});

test('sama spacja w nazwie → null', () => {
  expect(sanitizeImportedTag({...validTag, name: '   '})).toBeNull();
});

test('brak color → null', () => {
  expect(sanitizeImportedTag({...validTag, color: null})).toBeNull();
});

test('color.bg = "javascript:..." → null', () => {
  expect(sanitizeImportedTag({...validTag, color: {bg: 'javascript:alert(1)', fg: '#fff'}})).toBeNull();
});

test('color hex format → ok', () => {
  const r = sanitizeImportedTag({...validTag, color: {bg: '#fff', fg: '#000'}});
  expect(r).toBeTruthy();
});

test('color rgb format → ok', () => {
  const r = sanitizeImportedTag({...validTag, color: {bg: 'rgb(255,255,255)', fg: 'rgb(0,0,0)'}});
  expect(r).toBeTruthy();
});

test('za długa nazwa → przycinana do MAX_TAG_NAME_LEN', () => {
  const r = sanitizeImportedTag({...validTag, name: 'a'.repeat(MAX_TAG_NAME_LEN + 5)});
  expect(r).toBeTruthy();
  expect(r.name.length).toBe(MAX_TAG_NAME_LEN);
});

// ── sanitizeHTML (jsdom) ──────────────────────────────────────────

console.log('\n6. sanitizeHTML');

test('<script> usunięty, tekst zachowany', () => {
  const out = sanitizeHTML('<p>przed<script>alert(1)</script>po</p>');
  expect(out).toContain('przed');
  expect(out).toContain('po');
  expect(out.includes('<script')).toBe(false);
});

test('<img onerror> → tag usunięty w całości', () => {
  const out = sanitizeHTML('<p>x<img src=1 onerror="alert(1)">y</p>');
  expect(out.includes('<img')).toBe(false);
  expect(out.includes('onerror')).toBe(false);
  expect(out).toContain('x');
  expect(out).toContain('y');
});

test('onclick na dozwolonym tagu → atrybut usunięty', () => {
  const out = sanitizeHTML('<p onclick="alert(1)">tekst</p>');
  expect(out.includes('onclick')).toBe(false);
  expect(out).toContain('<p>tekst</p>');
});

test('style i class usunięte z dozwolonego tagu', () => {
  const out = sanitizeHTML('<p style="color:red" class="x">tekst</p>');
  expect(out.includes('style=')).toBe(false);
  expect(out.includes('class=')).toBe(false);
});

test('data-language na <code> zachowany (trigger ```js)', () => {
  const out = sanitizeHTML('<pre><code data-language="js">const x;</code></pre>');
  expect(out).toContain('data-language="js"');
});

test('data-language na innym tagu → usunięty', () => {
  const out = sanitizeHTML('<p data-language="js">tekst</p>');
  expect(out.includes('data-language')).toBe(false);
});

test('link javascript: → zamieniony na tekst', () => {
  const out = sanitizeHTML('<p><a href="javascript:alert(1)">klik</a></p>');
  expect(out.includes('<a')).toBe(false);
  expect(out).toContain('klik');
});

test('link https → zachowany z wymuszonym target/rel', () => {
  const out = sanitizeHTML('<p><a href="https://example.com">ok</a></p>');
  expect(out).toContain('href="https://example.com"');
  expect(out).toContain('target="_blank"');
  expect(out).toContain('rel="noopener noreferrer"');
});

test('checklist: ul[data-list] i li[data-checked] zachowane', () => {
  const out = sanitizeHTML(
    '<ul data-list="checklist"><li data-checked="true">zrobione</li></ul>',
  );
  expect(out).toContain('data-list="checklist"');
  expect(out).toContain('data-checked="true"');
});

test('callout: blockquote[data-callout] zachowany', () => {
  const out = sanitizeHTML(
    '<blockquote data-callout="warning" data-callout-label="Uwaga"><p>x</p></blockquote>',
  );
  expect(out).toContain('data-callout="warning"');
  expect(out).toContain('data-callout-label="Uwaga"');
});

test('iframe → tag usunięty, treść jako tekst', () => {
  const out = sanitizeHTML('<iframe src="https://evil.example">fallback</iframe>');
  expect(out.includes('<iframe')).toBe(false);
});

test('dozwolone formatowanie inline zachowane', () => {
  const out = sanitizeHTML('<p><strong>b</strong><em>i</em><code>c</code></p>');
  expect(out).toContain('<strong>b</strong>');
  expect(out).toContain('<em>i</em>');
  expect(out).toContain('<code>c</code>');
});

test('zagnieżdżenie ponad limit głębokości → spłaszczone, tekst zachowany', () => {
  const html = '<div>'.repeat(100) + 'rdzeń' + '</div>'.repeat(100);
  const out = sanitizeHTML(html);
  expect(out).toContain('rdzeń');
  const depth = (out.match(/<div>/g) || []).length;
  expect(depth <= 60).toBe(true);
});

test('nie-string → pusty string', () => {
  expect(sanitizeHTML(null)).toBe('');
  expect(sanitizeHTML(42)).toBe('');
  expect(sanitizeHTML(undefined)).toBe('');
});

test('form/input → tagi usunięte', () => {
  const out = sanitizeHTML('<form action="https://x"><input value="a">tekst</form>');
  expect(out.includes('<form')).toBe(false);
  expect(out.includes('<input')).toBe(false);
  expect(out).toContain('tekst');
});

// ── WYNIKI ────────────────────────────────────────────────────────

results();
