/**
 * note-sections.test.mjs — podział listy na sekcje i przycisk "+" w sekcji
 *
 * Główna własność: element utworzony przyciskiem "+" ma trafić do sekcji,
 * w której kliknięto. Sprawdzana dla każdego dnia roku, razem ze zmianami
 * czasu, końcami miesięcy i weekendami.
 */

import { test, expect, results } from './_runner.mjs';
import {
  SECTION_ORDER,
  bucketFor,
  newItemForSection,
  alwaysVisibleSections,
} from './note-sections.mjs';

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
const task = (due) => ({ type: 'task', due });

// Sobota 7 listopada 2026, południe
const SAT = at(2026, 11, 7);
// Środa 4 listopada 2026, południe
const WED = at(2026, 11, 4);

// ── bucketFor ─────────────────────────────────────────────────────

console.log('\n1. bucketFor');

test('notatka, ukończone i zadanie bez terminu', () => {
  expect(bucketFor({ type: 'note' }, WED)).toBe('notes');
  expect(bucketFor({ type: 'task', completed: true, due: at(2026, 11, 4) }, WED)).toBe('done');
  expect(bucketFor({ type: 'task', due: null }, WED)).toBe('unscheduled');
});

test('granice dni liczone od północy', () => {
  expect(bucketFor(task(at(2026, 11, 3, 23)), WED)).toBe('overdue');
  expect(bucketFor(task(at(2026, 11, 4, 0)), WED)).toBe('today');
  expect(bucketFor(task(at(2026, 11, 5, 0)), WED)).toBe('tomorrow');
  expect(bucketFor(task(at(2026, 11, 6, 0)), WED)).toBe('week');
  expect(bucketFor(task(at(2026, 11, 8, 0)), WED)).toBe('week');
  expect(bucketFor(task(at(2026, 11, 9, 0)), WED)).toBe('month');
  expect(bucketFor(task(at(2026, 11, 30, 0)), WED)).toBe('month');
  expect(bucketFor(task(at(2026, 12, 1, 0)), WED)).toBe('later');
});

// ── newItemForSection ─────────────────────────────────────────────

console.log('\n2. newItemForSection');

test('sekcje bez przycisku: zaległe i zakończone', () => {
  expect(newItemForSection('overdue', WED)).toBe(null);
  expect(newItemForSection('done', WED)).toBe(null);
});

test('typ i termin dla konkretnego dnia', () => {
  expect(newItemForSection('notes', WED)).toEqual({ type: 'note', due: null });
  expect(newItemForSection('unscheduled', WED)).toEqual({ type: 'task', due: null });
  expect(newItemForSection('today', WED).due).toBe(at(2026, 11, 4, 0));
  expect(newItemForSection('tomorrow', WED).due).toBe(at(2026, 11, 5, 0));
  expect(newItemForSection('week', WED).due).toBe(at(2026, 11, 8, 0));
  expect(newItemForSection('month', WED).due).toBe(at(2026, 11, 30, 0));
  expect(newItemForSection('later', WED).due).toBe(at(2026, 12, 1, 0));
});

test('termin to zawsze północ', () => {
  for (const section of ['today', 'tomorrow', 'week', 'month', 'later']) {
    const d = new Date(newItemForSection(section, SAT).due);
    expect(d.getHours() + d.getMinutes()).toBe(0);
  }
});

test('"+" tworzy element w tej sekcji — każdy dzień dwóch lat', () => {
  const addable = SECTION_ORDER.filter((s) => newItemForSection(s, WED));
  for (let offset = 0; offset < 730; offset++) {
    const now = new Date(2026, 0, 1 + offset, 12).getTime();
    // Sekcja bywa pusta z definicji (w sobotę nie ma dni "tego tygodnia"
    // poza jutrem). Wtedy nie da się w niej nic kliknąć, więc jej nie liczymy.
    const reachable = new Set(
      Array.from({ length: 70 }, (_, i) =>
        bucketFor(task(new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate() + i).getTime()), now),
      ),
    );
    reachable.add('notes').add('unscheduled');
    for (const section of addable) {
      if (!reachable.has(section)) continue;
      const item = newItemForSection(section, now);
      const got = bucketFor(item, now);
      if (got !== section) {
        throw new Error(`${new Date(now).toDateString()}: "+" w ${section} trafia do ${got}`);
      }
    }
  }
});

// ── alwaysVisibleSections ─────────────────────────────────────────

console.log('\n3. alwaysVisibleSections');

test('bez filtrów: miejsce na nowe zadanie i nową notatkę', () => {
  expect(alwaysVisibleSections({ filterType: 'all' })).toEqual(['unscheduled', 'notes']);
});

test('filtr typu zostawia tylko pasującą sekcję', () => {
  expect(alwaysVisibleSections({ filterType: 'task' })).toEqual(['unscheduled']);
  expect(alwaysVisibleSections({ filterType: 'note' })).toEqual(['notes']);
});

test('wyszukiwanie, tagi, data, "w trakcie" i zen nie pokazują pustych sekcji', () => {
  const base = { filterType: 'all' };
  expect(alwaysVisibleSections({ ...base, searchQuery: 'x' })).toEqual([]);
  expect(alwaysVisibleSections({ ...base, filterTags: ['t'] })).toEqual([]);
  expect(alwaysVisibleSections({ ...base, filterDate: 1 })).toEqual([]);
  expect(alwaysVisibleSections({ ...base, filterInProgress: true })).toEqual([]);
  expect(alwaysVisibleSections({ ...base, zenMode: true })).toEqual([]);
});

await results();
