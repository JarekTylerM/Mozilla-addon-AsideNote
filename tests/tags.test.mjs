/**
 * tags.test.mjs — testy tags.js
 *
 * Pokrycie: PALETTE, tagState, getTag, createTag, updateTag,
 *           deleteTag, updateTagColor
 * Pominięte: makeTagPill — wymaga document.createElement (browser API)
 *
 * saveTags jest zmockowane w tags.mjs (zastąpione noop) —
 * testy weryfikują zmiany w tagState bez dotkięcia storage.
 */

import { test, expect, results } from './_runner.mjs';
import {
  PALETTE,
  tagState,
  getTag,
  createTag,
  updateTag,
  deleteTag,
  updateTagColor,
} from './tags.mjs';

// Reset tagState przed każdą sekcją
function resetTags() {
  tagState.tags = [];
}

// ── PALETTE ───────────────────────────────────────────────────────

console.log('\n1. PALETTE');

test('ma dokładnie 12 kolorów', () => {
  expect(PALETTE.length).toBe(12);
});

test('każdy kolor ma bg i fg', () => {
  for (const c of PALETTE) {
    if (!c.bg) throw new Error(`Brak bg w: ${JSON.stringify(c)}`);
    if (!c.fg) throw new Error(`Brak fg w: ${JSON.stringify(c)}`);
  }
});

test('bg i fg to stringi hex lub rgb', () => {
  const colorRx = /^(#[0-9a-f]{3,8}|rgba?\([\d\s,.%]+\)|[a-z]+)$/i;
  for (const c of PALETTE) {
    if (!colorRx.test(c.bg)) throw new Error(`Nieprawidłowy bg: "${c.bg}"`);
    if (!colorRx.test(c.fg)) throw new Error(`Nieprawidłowy fg: "${c.fg}"`);
  }
});

test('wszystkie bg są unikalne', () => {
  const bgs = PALETTE.map(c => c.bg);
  const unique = new Set(bgs);
  if (unique.size !== bgs.length)
    throw new Error(`Duplikaty bg: ${bgs.length} vs ${unique.size} unikalnych`);
});

// ── getTag ────────────────────────────────────────────────────────

console.log('\n2. getTag');

test('brak tagów → null', () => {
  resetTags();
  expect(getTag('nieistniejace')).toBeNull();
});

test('istniejące id → zwraca tag', () => {
  resetTags();
  createTag('testowy');
  const id = tagState.tags[0].id;
  const tag = getTag(id);
  if (!tag) throw new Error('Powinno zwrócić tag');
  expect(tag.name).toBe('testowy');
});

test('nieistniejące id → null', () => {
  resetTags();
  createTag('abc');
  expect(getTag('fake_id')).toBeNull();
});

// ── createTag ─────────────────────────────────────────────────────

console.log('\n3. createTag');

test('poprawna nazwa → ok: true', () => {
  resetTags();
  const r = createTag('mój tag');
  expect(r.ok).toBe(true);
  if (!r.tag) throw new Error('Brak r.tag');
});

test('tag trafia do tagState', () => {
  resetTags();
  createTag('pierwszy');
  expect(tagState.tags.length).toBe(1);
  expect(tagState.tags[0].name).toBe('pierwszy');
});

test('tag ma id, name, color', () => {
  resetTags();
  createTag('test');
  const tag = tagState.tags[0];
  if (!tag.id) throw new Error('Brak id');
  if (!tag.name) throw new Error('Brak name');
  if (!tag.color?.bg) throw new Error('Brak color.bg');
  if (!tag.color?.fg) throw new Error('Brak color.fg');
});

test('id ma format tag_<timestamp>', () => {
  resetTags();
  createTag('x');
  const {id} = tagState.tags[0];
  if (!/^tag_[a-z0-9]+_[a-z0-9]+$/.test(id)) throw new Error(`Nieprawidłowy format id (oczekiwano tag_<base36>_<suffix>): "${id}"`);
});

test('pusta nazwa → ok: false, error: validation_empty', () => {
  const r = createTag('');
  expect(r.ok).toBe(false);
  expect(r.error).toBe('validation_empty');
});

test('sama spacja → ok: false', () => {
  const r = createTag('   ');
  expect(r.ok).toBe(false);
  expect(r.error).toBe('validation_empty');
});

test('null → ok: false', () => {
  const r = createTag(null);
  expect(r.ok).toBe(false);
});

test('za długa nazwa → ok: false, error: validation_tooLong', () => {
  const r = createTag('a'.repeat(51));
  expect(r.ok).toBe(false);
  expect(r.error).toBe('validation_tooLong');
});

test('dokładnie MAX_TAG_NAME_LEN znaków → ok: true', () => {
  resetTags();
  const r = createTag('a'.repeat(50));
  expect(r.ok).toBe(true);
});

test('pierwsza kolor = PALETTE[0]', () => {
  resetTags();
  createTag('pierwszy');
  expect(tagState.tags[0].color.bg).toBe(PALETTE[0].bg);
});

test('drugi tag → PALETTE[1]', () => {
  resetTags();
  createTag('a'); createTag('b');
  expect(tagState.tags[1].color.bg).toBe(PALETTE[1].bg);
});

test('13. tag → PALETTE[0] (cycling)', () => {
  resetTags();
  for (let i = 0; i < 13; i++) createTag(`tag${i}`);
  expect(tagState.tags[12].color.bg).toBe(PALETTE[0].bg);
});

test('wiele tagów → tagState rośnie', () => {
  resetTags();
  createTag('a'); createTag('b'); createTag('c');
  expect(tagState.tags.length).toBe(3);
});

// ── updateTag ─────────────────────────────────────────────────────

console.log('\n4. updateTag');

test('poprawna aktualizacja → ok: true', () => {
  resetTags();
  createTag('stara nazwa');
  const id = tagState.tags[0].id;
  const r = updateTag(id, 'nowa nazwa');
  expect(r.ok).toBe(true);
});

test('nazwa zmieniona w tagState', () => {
  resetTags();
  createTag('stara');
  const id = tagState.tags[0].id;
  updateTag(id, 'nowa');
  expect(tagState.tags[0].name).toBe('nowa');
});

test('nieistniejące id → ok: false, validation_tagNotFound', () => {
  const r = updateTag('fake_id', 'cokolwiek');
  expect(r.ok).toBe(false);
  expect(r.error).toBe('validation_tagNotFound');
});

test('pusta nazwa → ok: false, validation_empty', () => {
  resetTags();
  createTag('test');
  const id = tagState.tags[0].id;
  const r = updateTag(id, '');
  expect(r.ok).toBe(false);
  expect(r.error).toBe('validation_empty');
});

test('za długa nazwa → ok: false', () => {
  resetTags();
  createTag('test');
  const id = tagState.tags[0].id;
  const r = updateTag(id, 'a'.repeat(51));
  expect(r.ok).toBe(false);
});

test('aktualizacja nie zmienia id ani koloru', () => {
  resetTags();
  createTag('original');
  const {id, color} = tagState.tags[0];
  updateTag(id, 'zmieniona');
  expect(tagState.tags[0].id).toBe(id);
  expect(tagState.tags[0].color.bg).toBe(color.bg);
});

// ── deleteTag ─────────────────────────────────────────────────────

console.log('\n5. deleteTag');

test('usuwa tag z tagState', () => {
  resetTags();
  createTag('do usunięcia');
  const id = tagState.tags[0].id;
  deleteTag(id);
  expect(tagState.tags.length).toBe(0);
});

test('usuwa właściwy tag przy wielu tagach', () => {
  resetTags();
  createTag('a'); createTag('b'); createTag('c');
  const idB = tagState.tags[1].id;
  deleteTag(idB);
  expect(tagState.tags.length).toBe(2);
  if (tagState.tags.find(t => t.id === idB))
    throw new Error('Tag b nadal istnieje po usunięciu');
});

test('nieistniejące id → brak błędu, tagState bez zmian', () => {
  resetTags();
  createTag('test');
  deleteTag('fake_id'); // nie powinno rzucać
  expect(tagState.tags.length).toBe(1);
});

test('usunięcie wszystkich → pusta lista', () => {
  resetTags();
  createTag('a'); createTag('b');
  const ids = tagState.tags.map(t => t.id);
  for (const id of ids) deleteTag(id);
  expect(tagState.tags.length).toBe(0);
});

// ── updateTagColor ────────────────────────────────────────────────

console.log('\n6. updateTagColor');

test('zmienia kolor tagu', () => {
  resetTags();
  createTag('kolorowy');
  const id = tagState.tags[0].id;
  const newColor = { bg: '#ff0000', fg: '#ffffff' };
  updateTagColor(id, newColor);
  expect(tagState.tags[0].color.bg).toBe('#ff0000');
  expect(tagState.tags[0].color.fg).toBe('#ffffff');
});

test('nieistniejące id → brak błędu', () => {
  resetTags();
  updateTagColor('fake_id', { bg: '#000', fg: '#fff' }); // nie rzuca
  expect(tagState.tags.length).toBe(0);
});

test('zmiana koloru nie wpływa na inne tagi', () => {
  resetTags();
  createTag('a'); createTag('b');
  const idA = tagState.tags[0].id;
  const originalBgB = tagState.tags[1].color.bg;
  updateTagColor(idA, { bg: '#ff0000', fg: '#fff' });
  expect(tagState.tags[1].color.bg).toBe(originalBgB);
});

// ── WYNIKI ────────────────────────────────────────────────────────

await results(['makeTagPill pominięte — wymaga document.createElement (browser API)']);
