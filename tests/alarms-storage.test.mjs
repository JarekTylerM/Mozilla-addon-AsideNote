/**
 * alarms.test.mjs — testy isAlarmable() z alarms.js
 * storage.test.mjs — testy migrateNotes() z storage.js
 *
 * Oba moduły mają browser.alarms / browser.storage dependencies —
 * testujemy tylko czyste funkcje eksportowane.
 */

import { test, expect, results } from './_runner.mjs';
import { isAlarmable } from './alarms.mjs';
import { migrateNotes } from './storage.mjs';

// ── isAlarmable ───────────────────────────────────────────────────

console.log('\n1. isAlarmable');

test('task z due i time → true', () => {
  expect(isAlarmable({
    type: 'task', completed: false,
    due: Date.now() + 86400000, time: '09:00'
  })).toBe(true);
});

test('note → false', () => {
  expect(isAlarmable({ type: 'note', due: Date.now(), time: '09:00' })).toBe(false);
});

test('task bez due → false', () => {
  expect(isAlarmable({ type: 'task', completed: false, due: null, time: '09:00' })).toBe(false);
});

test('task bez time → false', () => {
  expect(isAlarmable({ type: 'task', completed: false, due: Date.now(), time: null })).toBe(false);
});

test('task completed → false', () => {
  expect(isAlarmable({
    type: 'task', completed: true,
    due: Date.now(), time: '09:00'
  })).toBe(false);
});

test('task z due=0 → false (falsy)', () => {
  expect(isAlarmable({ type: 'task', completed: false, due: 0, time: '09:00' })).toBe(false);
});

test('task z time="" → false (falsy)', () => {
  expect(isAlarmable({ type: 'task', completed: false, due: Date.now(), time: '' })).toBe(false);
});

// ── migrateNotes ──────────────────────────────────────────────────

console.log('\n2. migrateNotes');

test('v0 → v1: notatki bez type dostają type="note"', () => {
  const notes = [
    { id: 'a', title: 'test', content: '' },
    { id: 'b', title: 'task', content: '', type: 'task' },
  ];
  const result = migrateNotes(notes, 0);
  expect(result[0].type).toBe('note');
  expect(result[1].type).toBe('task');
});

test('v1 → v1: notatki z type zachowują typ', () => {
  const notes = [
    { id: 'a', type: 'note', title: 'test' },
    { id: 'b', type: 'task', title: 'task', completed: false },
  ];
  const result = migrateNotes(notes, 1);
  expect(result[0].type).toBe('note');
  expect(result[1].type).toBe('task');
});

test('pusta tablica → pusta tablica', () => {
  const result = migrateNotes([], 0);
  expect(result).toEqual([]);
});

test('migracja nie mutuje oryginału', () => {
  const notes = [{ id: 'a', title: 'test' }];
  migrateNotes(notes, 0);
  expect(notes[0].type).toBeFalsy(); // oryginał bez type
});

test('fromVersion >= 1 → brak migracji type', () => {
  const notes = [{ id: 'a', title: 'test' }]; // brak type
  const result = migrateNotes(notes, 1);
  // v0→v1 nie jest aplikowane przy fromVersion=1
  expect(result[0].type).toBeFalsy();
});

// ── migrateNotes v1 → v2 ─────────────────────────────────────────

console.log('\n3. migrateNotes v1 → v2 (recurrence)');

test('v1→v2: task bez recurrence dostaje recurrence=null', () => {
  const notes = [{ id: 'a', type: 'task', title: 'x' }];
  const result = migrateNotes(notes, 1);
  expect(result[0].recurrence).toBeNull();
});

test('v1→v2: note nie dostaje recurrence', () => {
  const notes = [{ id: 'a', type: 'note', title: 'x' }];
  const result = migrateNotes(notes, 1);
  expect('recurrence' in result[0]).toBe(false);
});

test('v1→v2: task z już ustawionym recurrence → bez zmian', () => {
  const notes = [{ id: 'a', type: 'task', recurrence: 'daily' }];
  const result = migrateNotes(notes, 1);
  expect(result[0].recurrence).toBe('daily');
});

test('v1→v2: nie mutuje oryginału', () => {
  const notes = [{ id: 'a', type: 'task', title: 'x' }];
  migrateNotes(notes, 1);
  expect('recurrence' in notes[0]).toBe(false);
});

// ── migrateNotes v2 → v3 ─────────────────────────────────────────

console.log('\n4. migrateNotes v2 → v3 (recurrenceDays)');

test('v2→v3: task bez recurrenceDays dostaje recurrenceDays=null', () => {
  const notes = [{ id: 'a', type: 'task', recurrence: null }];
  const result = migrateNotes(notes, 2);
  expect(result[0].recurrenceDays).toBeNull();
});

test('v2→v3: note nie dostaje recurrenceDays', () => {
  const notes = [{ id: 'a', type: 'note', title: 'x' }];
  const result = migrateNotes(notes, 2);
  expect('recurrenceDays' in result[0]).toBe(false);
});

test('v2→v3: task z już ustawionym recurrenceDays → bez zmian', () => {
  const notes = [{ id: 'a', type: 'task', recurrenceDays: [1, 3, 5] }];
  const result = migrateNotes(notes, 2);
  expect(result[0].recurrenceDays).toEqual([1, 3, 5]);
});

test('v2→v3: nie mutuje oryginału', () => {
  const notes = [{ id: 'a', type: 'task', recurrence: null }];
  migrateNotes(notes, 2);
  expect('recurrenceDays' in notes[0]).toBe(false);
});

// ── migrateNotes v0 → v3 (pełny skok) ───────────────────────────

console.log('\n5. migrateNotes v0 → v3 (pełny skok)');

test('v0→v3: task dostaje type, recurrence i recurrenceDays', () => {
  const notes = [{ id: 'a', title: 'task' }];
  const result = migrateNotes(notes, 0);
  expect(result[0].type).toBe('note'); // brak type → note
  expect('recurrenceDays' in result[0]).toBe(false); // note nie dostaje
});

test('v0→v3: task (z type) dostaje recurrence i recurrenceDays', () => {
  const notes = [{ id: 'a', type: 'task', title: 'x' }];
  const result = migrateNotes(notes, 0);
  expect(result[0].recurrence).toBeNull();
  expect(result[0].recurrenceDays).toBeNull();
});

test('v0→v3: mieszana lista — każdy dostaje właściwe pola', () => {
  const notes = [
    { id: 'a', title: 'notatka' },
    { id: 'b', type: 'task', title: 'zadanie' },
  ];
  const result = migrateNotes(notes, 0);
  expect(result[0].type).toBe('note');
  expect('recurrenceDays' in result[0]).toBe(false);
  expect(result[1].type).toBe('task');
  expect(result[1].recurrence).toBeNull();
  expect(result[1].recurrenceDays).toBeNull();
});

// ── WYNIKI ────────────────────────────────────────────────────────

results();
