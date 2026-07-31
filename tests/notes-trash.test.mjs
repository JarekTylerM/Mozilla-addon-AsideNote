/**
 * notes-trash.test.mjs — testy czystych transformacji z notes-trash.js
 *
 * Pokrywają ścieżki TRACĄCE DANE, których notes.js nie miał w testach:
 * usunięcie → kosz → przywrócenie (round-trip), limit kosza, konwersja typu.
 * Bez DOM/browser — testujemy rdzeń, orkiestracja (save/render) zostaje w notes.js.
 */

import { test, expect, results } from './_runner.mjs';
import {
  moveToTrash,
  restoreFromTrash,
  flippedType,
  isDiscardableNote,
} from './notes-trash.mjs';

const mkNote = (id, over = {}) => ({
  id, type: 'note', title: 't-' + id, content: '', created: 1000, tags: [], ...over,
});

// ── moveToTrash ───────────────────────────────────────────────────

console.log('\n1. moveToTrash');

test('przenosi notatkę do kosza: znika z notes, ląduje na przodzie kosza', () => {
  const notes = [mkNote('a'), mkNote('b'), mkNote('c')];
  const { notes: nn, deletedNotes: dd, trashed } = moveToTrash(notes, [], 'b', 50, 5000);
  expect(nn.map((n) => n.id)).toEqual(['a', 'c']);
  expect(dd.length).toBe(1);
  expect(dd[0].id).toBe('b');
  expect(trashed.id).toBe('b');
});

test('ustawia deletedAt na przekazany now', () => {
  const { deletedNotes } = moveToTrash([mkNote('a')], [], 'a', 50, 12345);
  expect(deletedNotes[0].deletedAt).toBe(12345);
});

test('nowo usunięta trafia PRZED wcześniejsze w koszu', () => {
  const trash = [{ ...mkNote('old'), deletedAt: 1 }];
  const { deletedNotes } = moveToTrash([mkNote('new')], trash, 'new', 50, 9);
  expect(deletedNotes.map((n) => n.id)).toEqual(['new', 'old']);
});

test('id spoza listy → trashed null, notes bez zmian, kosz bez zmian', () => {
  const notes = [mkNote('a')];
  const trash = [{ ...mkNote('x'), deletedAt: 1 }];
  const { notes: nn, deletedNotes: dd, trashed } = moveToTrash(notes, trash, 'zzz', 50, 9);
  expect(trashed).toBeNull();
  expect(nn.map((n) => n.id)).toEqual(['a']);
  expect(dd.map((n) => n.id)).toEqual(['x']);
});

test('respektuje limit kosza — najstarsze wypadają', () => {
  const trash = Array.from({ length: 3 }, (_, i) => ({ ...mkNote('t' + i), deletedAt: i }));
  const { deletedNotes } = moveToTrash([mkNote('new')], trash, 'new', 3, 9);
  expect(deletedNotes.length).toBe(3);
  expect(deletedNotes.map((n) => n.id)).toEqual(['new', 't0', 't1']); // t2 wypadł
});

test('nie mutuje tablic wejściowych', () => {
  const notes = [mkNote('a'), mkNote('b')];
  const trash = [];
  moveToTrash(notes, trash, 'a', 50, 9);
  expect(notes.length).toBe(2);
  expect(trash.length).toBe(0);
});

test('zachowuje pola notatki (typ, tytuł, tagi)', () => {
  const note = mkNote('a', { type: 'task', title: 'Zadanie', tags: ['x'], completed: true });
  const { deletedNotes } = moveToTrash([note], [], 'a', 50, 9);
  expect(deletedNotes[0].type).toBe('task');
  expect(deletedNotes[0].title).toBe('Zadanie');
  expect(deletedNotes[0].tags).toEqual(['x']);
  expect(deletedNotes[0].completed).toBe(true);
});

// ── restoreFromTrash ──────────────────────────────────────────────

console.log('\n2. restoreFromTrash');

test('przywraca: znika z kosza, ląduje na przodzie notes, bez deletedAt', () => {
  const trash = [{ ...mkNote('a'), deletedAt: 5 }];
  const { notes: nn, deletedNotes: dd, restored } = restoreFromTrash([mkNote('b')], trash, 'a');
  expect(nn.map((n) => n.id)).toEqual(['a', 'b']);
  expect(dd.length).toBe(0);
  expect(restored.id).toBe('a');
  expect('deletedAt' in restored).toBe(false);
});

test('przywraca ze środka kosza, zostawiając resztę', () => {
  const trash = ['a', 'b', 'c'].map((id) => ({ ...mkNote(id), deletedAt: 1 }));
  const { deletedNotes, restored } = restoreFromTrash([], trash, 'b');
  expect(restored.id).toBe('b');
  expect(deletedNotes.map((n) => n.id)).toEqual(['a', 'c']);
});

test('id spoza kosza → restored null, wszystko bez zmian', () => {
  const notes = [mkNote('a')];
  const trash = [{ ...mkNote('x'), deletedAt: 1 }];
  const { notes: nn, deletedNotes: dd, restored } = restoreFromTrash(notes, trash, 'zzz');
  expect(restored).toBeNull();
  expect(nn.map((n) => n.id)).toEqual(['a']);
  expect(dd.map((n) => n.id)).toEqual(['x']);
});

test('nie mutuje tablic wejściowych', () => {
  const notes = [mkNote('b')];
  const trash = [{ ...mkNote('a'), deletedAt: 5 }];
  restoreFromTrash(notes, trash, 'a');
  expect(notes.length).toBe(1);
  expect(trash.length).toBe(1);
  expect('deletedAt' in trash[0]).toBe(true); // oryginał w koszu nietknięty
});

// ── round-trip (najważniejszy: brak utraty danych) ────────────────

console.log('\n3. round-trip usuń → przywróć');

test('usunięcie i przywrócenie odtwarza notatkę bez deletedAt, kosz pusty', () => {
  const original = mkNote('a', { type: 'task', title: 'Ważne', completed: false });
  const del = moveToTrash([original], [], 'a', 50, 777);
  expect(del.notes.length).toBe(0);
  const res = restoreFromTrash(del.notes, del.deletedNotes, 'a');
  expect(res.notes.length).toBe(1);
  expect(res.deletedNotes.length).toBe(0);
  expect(res.notes[0].id).toBe('a');
  expect(res.notes[0].title).toBe('Ważne');
  expect(res.notes[0].type).toBe('task');
  expect('deletedAt' in res.notes[0]).toBe(false);
});

// ── flippedType ───────────────────────────────────────────────────

console.log('\n4. flippedType');

test('note → task: dokłada completed=false', () => {
  const r = flippedType(mkNote('a', { type: 'note' }));
  expect(r.type).toBe('task');
  expect(r.completed).toBe(false);
});

test('note → task z już ustawionym completed → zachowuje wartość', () => {
  const r = flippedType(mkNote('a', { type: 'note', completed: true }));
  expect(r.type).toBe('task');
  expect(r.completed).toBe(true);
});

test('task → note: zmienia tylko type, nie zwraca completed', () => {
  const r = flippedType(mkNote('a', { type: 'task', completed: true }));
  expect(r.type).toBe('note');
  expect('completed' in r).toBe(false); // completed zostaje na notatce w stanie nietknięte
});

test('nie mutuje wejścia', () => {
  const note = mkNote('a', { type: 'note' });
  flippedType(note);
  expect(note.type).toBe('note');
  expect('completed' in note).toBe(false);
});

// ── isDiscardableNote ─────────────────────────────────────────────

console.log('\n5. isDiscardableNote');

const EMPTY = { textEmpty: true };

test('pusta notatka bez śladu intencji → do wyrzucenia', () => {
  expect(isDiscardableNote(mkNote('a'), EMPTY)).toBe(true);
});

test('jest tekst → zostaje', () => {
  expect(isDiscardableNote(mkNote('a'), { textEmpty: false })).toBe(false);
});

// Wszystko poniżej to ślad decyzji użytkownika — notatka musi przetrwać,
// nawet gdy nie ma w niej ani słowa.

test('ma tag → zostaje', () => {
  expect(isDiscardableNote(mkNote('a', { tags: ['praca'] }), EMPTY)).toBe(false);
});

test('ma termin → zostaje', () => {
  expect(isDiscardableNote(mkNote('a', { due: 1785276000000 }), EMPTY)).toBe(false);
});

test('ma godzinę → zostaje', () => {
  expect(isDiscardableNote(mkNote('a', { time: '14:30' }), EMPTY)).toBe(false);
});

test('oznaczona gwiazdką → zostaje', () => {
  expect(isDiscardableNote(mkNote('a', { important: true }), EMPTY)).toBe(false);
});

test('oznaczona "w trakcie" → zostaje (focusIds żyje poza notatką)', () => {
  expect(isDiscardableNote(mkNote('a'), { textEmpty: true, inFocus: true })).toBe(false);
});

test('puste pola nie liczą się jako intencja', () => {
  const n = mkNote('a', { tags: [], due: null, time: null, important: false });
  expect(isDiscardableNote(n, EMPTY)).toBe(true);
});

test('zadanie bez terminu też idzie do wyrzucenia', () => {
  expect(isDiscardableNote(mkNote('a', { type: 'task', completed: false }), EMPTY)).toBe(true);
});

test('brak notatki → false, bez wyjątku', () => {
  expect(isDiscardableNote(null, EMPTY)).toBe(false);
  expect(isDiscardableNote(undefined, EMPTY)).toBe(false);
});

test('domyślnie inFocus=false — brak pola nie chroni notatki', () => {
  expect(isDiscardableNote(mkNote('a'), { textEmpty: true })).toBe(true);
});

results();
