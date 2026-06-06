/**
 * sanitize.test.mjs — testy sanitize.js
 *
 * Pokrycie: validateText, isValidId, safeHref, sanitizeImportedNote,
 *           sanitizeImportedTag
 * Pominięte: sanitizeHTML — wymaga DOMParser (browser API)
 */

import { test, testBug, expect, results } from './_runner.mjs';
import {
  validateText,
  isValidId,
  safeHref,
  sanitizeImportedNote,
  sanitizeImportedTag,
  MAX_TITLE_LEN,
  MAX_TAG_NAME_LEN,
  MAX_CONTENT_LEN,
  MAX_ID_LEN,
} from './sanitize.mjs';

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

// ── WYNIKI ────────────────────────────────────────────────────────

results(['sanitizeHTML pominięte — wymaga DOMParser (browser API)']);
